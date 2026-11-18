import { addons } from 'storybook/preview-api';

import type { AgentView, Effect, GpuCanvas, Marks, Rect } from 'gpucanvas';

import { createFlow, type Flow, type FlowOptions } from './flow.ts';

import {
  AGENT_GLOBAL,
  BACKGROUND,
  DEFAULT_STATE,
  EFFECT_GLOBAL_KEY,
  EFFECT_NAMES,
  EVENTS,
  FLOW_HOST_ID,
  GLOBAL_KEY,
  HOST_ID,
  NODE_ID,
  ROOT_ID,
  type CanvasRequest,
  type CanvasResponse,
  type CanvasState,
  type EffectName,
} from './constants.ts';

type GpuCanvasModule = typeof import('gpucanvas');

/** The read/point surface an agent drives the canvas through. */
type AgentApi = {
  version: string;
  // Turns the canvas on or off without the toolbar, for agents driving the preview directly.
  setEnabled: (enabled: boolean) => void;
  readonly enabled: boolean;
  readonly mode: 'gpu' | 'dom';
  readonly supportsGpu: boolean;
  describe: () => unknown;
  capture: (target?: string | Rect, options?: { scale?: number }) => Promise<string>;
  stats: () => unknown;
  setEffect: (name: EffectName) => void;
  fit: () => void;
  note: (elementId: string, text: string) => void;
  connect: (fromId: string, toId: string, label?: string) => void;
  clearMarks: () => void;
  /** The flow map: every story as a card, panned and zoomed like an infinite canvas. */
  openFlow: (options?: FlowOptions) => Promise<unknown>;
  closeFlow: () => void;
  flowStats: () => unknown;
  focusStory: (id?: string) => void;
};

type FlowState = { view: Flow; canvas: GpuCanvas; marks: Marks; host: HTMLElement };

let state: CanvasState = { ...DEFAULT_STATE };
let canvas: GpuCanvas | undefined;
let node: HTMLElement | undefined;
let host: HTMLElement | undefined;
let agentView: AgentView | undefined;
let marks: Marks | undefined;
let treeObserver: MutationObserver | undefined;
let resizeObserver: ResizeObserver | undefined;
let lastWidth = 0;
let lastHeight = 0;
/** The flow map owns its own canvas, so it can stay open while the story canvas is on or off. */
let flowState: FlowState | undefined;
/** Guards a mount that is still awaiting the canvas against a toggle that turned it off. */
let mountToken = 0;
/**
 * gpucanvas is a large WebGPU client that most preview renders never need, so it is imported the
 * first time the canvas is actually used rather than when this module loads.
 */
let gpucanvas: GpuCanvasModule | undefined;

async function lib(): Promise<GpuCanvasModule> {
  gpucanvas ??= await import('gpucanvas');
  return gpucanvas;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Reads the globals Storybook puts on the preview URL (`globals=gpucanvas:on;gpucanvasEffect:glass`),
 * so the first paint after a reload or a shared link already has the canvas on.
 */
function readGlobalsFromUrl(): Record<string, string> {
  const raw = new URLSearchParams(window.location.search).get('globals');
  if (!raw) {
    return {};
  }

  return Object.fromEntries(
    raw
      .split(';')
      .filter(Boolean)
      .map((entry) => {
        const at = entry.indexOf(':');
        const key = at === -1 ? entry : entry.slice(0, at);
        const value = at === -1 ? '' : entry.slice(at + 1);
        return [decodeURIComponent(key), unquote(decodeURIComponent(value))];
      })
  );
}

function isEnabledValue(value: unknown): boolean {
  return value === 'on' || value === 'true' || value === '1' || value === true;
}

function effectName(value: unknown): EffectName {
  return typeof value === 'string' && (EFFECT_NAMES as readonly string[]).includes(value)
    ? (value as EffectName)
    : 'none';
}

function stateFromGlobals(globals: Record<string, unknown>): CanvasState {
  return {
    enabled: isEnabledValue(globals[GLOBAL_KEY]),
    effect: effectName(globals[EFFECT_GLOBAL_KEY]),
    mode: 'auto',
  };
}

function measureRoot(root: HTMLElement): { width: number; height: number } {
  const rect = root.getBoundingClientRect();

  return {
    width: Math.max(240, Math.round(rect.width) || window.innerWidth),
    height: Math.max(160, Math.round(rect.height) || window.innerHeight),
  };
}

function effectFor(module: GpuCanvasModule, name: EffectName): Effect | null {
  if (name === 'none') {
    return null;
  }

  return (module.effects as Record<string, Effect | undefined>)[name] ?? null;
}

async function applyEffect(): Promise<void> {
  if (!canvas || !node) {
    return;
  }

  const module = await lib();
  canvas.setEffect(node, effectFor(module, state.effect));
  canvas.invalidate();
}

async function imageDataToDataUrl(image: ImageData): Promise<string> {
  const module = await lib();
  const blob = await module.toBlob(image);

  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the snapshot'));
    reader.readAsDataURL(blob);
  });
}

function createAgentApi(): AgentApi {
  return {
    // Identifies the addon build an agent is talking to.
    version: '0.1.0',
    get enabled() {
      return Boolean(canvas);
    },
    get mode() {
      return canvas?.mode ?? 'dom';
    },
    get supportsGpu() {
      return Boolean(gpucanvas?.supportsGpuCanvas());
    },
    // What is on the canvas, as a short JSON tree of ids, tags, roles, text and rects.
    describe: () => agentView?.describe() ?? [],
    // A PNG data URL of a node id (`describe()` returns them) or a world rect; whole story by default.
    capture: async (target, options) => {
      const view = agentView;
      if (!canvas || !node || !view) {
        throw new Error(
          'The GPU canvas is not mounted. Turn on the GPU canvas toolbar toggle, then retry.'
        );
      }

      const image = target
        ? await view.capture(target, options)
        : await canvas.snapshot(node, options);

      return await imageDataToDataUrl(image);
    },
    setEnabled: (enabled) => {
      setState({ ...state, enabled });
    },
    stats: () => canvas?.getStats() ?? null,
    setEffect: (name) => {
      state = { ...state, effect: name };
      void applyEffect();
    },
    fit: () => canvas?.fit(64),
    note: (elementId, text) => {
      const element = agentView?.element(elementId);
      if (element && marks) {
        marks.note(element, text);
      }
    },
    connect: (fromId, toId, label) => {
      const from = agentView?.element(fromId);
      const to = agentView?.element(toId);
      if (from && to && marks) {
        marks.connect(from, to, label ? { label } : undefined);
      }
    },
    clearMarks: () => marks?.clear(),
    openFlow: (options) => openFlow(options),
    closeFlow: () => closeFlow(),
    flowStats: () => flowState?.view.stats() ?? null,
    focusStory: (id) => flowState?.view.focus(id),
  };
}

/**
 * The flow map is a second canvas over the whole preview: every story in the index laid out as a
 * card one screen wide, so a project of thousands of stories is one surface you pan around.
 */
async function openFlow(options?: FlowOptions): Promise<unknown> {
  if (flowState) {
    flowState.view.sync();
    return flowState.view.stats();
  }

  const module = await lib();
  const hostElement = document.createElement('div');
  hostElement.id = FLOW_HOST_ID;
  hostElement.style.cssText = `position:fixed;inset:0;z-index:2;background:${BACKGROUND};`;
  document.body.appendChild(hostElement);

  const created = await module.createGpuCanvas(hostElement, {
    mode: 'auto',
    background: BACKGROUND,
    // Panning is what drives which stories are mounted, so the map follows the camera directly.
    onCameraChange: () => flowState?.view.sync(),
  });
  const flowMarks = module.createMarks(created);
  const view = await createFlow(created, flowMarks, options);

  flowState = { view, canvas: created, marks: flowMarks, host: hostElement };
  view.focus();

  return view.stats();
}

function closeFlow(): void {
  const current = flowState;
  if (!current) {
    return;
  }

  flowState = undefined;
  current.view.destroy();
  current.marks.destroy();
  current.canvas.destroy();
  current.host.remove();
}

function exposeAgentApi(): void {
  (window as unknown as Record<string, unknown>)[AGENT_GLOBAL] = createAgentApi();
}

function hideAgentApi(): void {
  delete (window as unknown as Record<string, unknown>)[AGENT_GLOBAL];
}

async function mount(): Promise<void> {
  if (!state.enabled || host) {
    return;
  }

  const root = document.getElementById(ROOT_ID);
  if (!root) {
    return;
  }

  const token = ++mountToken;
  const module = await lib();
  if (token !== mountToken || !state.enabled) {
    return;
  }

  const { width, height } = measureRoot(root);
  lastWidth = width;
  lastHeight = height;

  const hostElement = document.createElement('div');
  hostElement.id = HOST_ID;
  hostElement.style.cssText = `position:fixed;inset:0;z-index:1;background:${BACKGROUND};`;
  document.body.insertBefore(hostElement, document.body.firstChild);
  host = hostElement;

  // The node is a real element in this document, so the GPU can rasterize it and the story keeps
  // its own DOM: state, events, CSS and accessibility all work as usual.
  const nodeElement = document.createElement('div');
  nodeElement.id = NODE_ID;
  nodeElement.style.cssText = `position:relative;overflow:hidden;width:${width}px;height:${height}px;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(0, 0, 0, 0.12);`;
  root.parentElement?.insertBefore(nodeElement, root);
  nodeElement.appendChild(root);
  node = nodeElement;

  const created = await module.createGpuCanvas(hostElement, {
    mode: state.mode,
    background: BACKGROUND,
  });

  if (token !== mountToken || !state.enabled) {
    created.destroy();
    return;
  }

  canvas = created;
  canvas.addNode(nodeElement, { x: 0, y: 0, width, height });
  canvas.fit(64);

  agentView = module.createAgentView(canvas);
  marks = module.createMarks(canvas);

  await applyEffect();
  observeStorySize(root, nodeElement);
  exposeAgentApi();
}

function unmount(): void {
  mountToken++;
  resizeObserver?.disconnect();
  resizeObserver = undefined;

  canvas?.destroy();
  canvas = undefined;
  agentView = undefined;
  marks = undefined;

  const root = document.getElementById(ROOT_ID);
  const nodeElement = document.getElementById(NODE_ID);
  if (root && nodeElement?.parentElement) {
    nodeElement.parentElement.insertBefore(root, nodeElement);
  }
  nodeElement?.remove();

  host?.remove();
  host = undefined;
  node = undefined;
  hideAgentApi();
}

function observeStorySize(root: HTMLElement, nodeElement: HTMLElement): void {
  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(() => {
    if (!canvas || !node) {
      return;
    }

    const { width, height } = measureRoot(root);
    // Writing the node's size resizes the root it holds, so only follow a change that is not ours.
    if (Math.abs(width - lastWidth) < 2 && Math.abs(height - lastHeight) < 2) {
      return;
    }

    lastWidth = width;
    lastHeight = height;
    nodeElement.style.width = `${width}px`;
    nodeElement.style.height = `${height}px`;
    canvas.updateNode(nodeElement, { x: 0, y: 0, width, height });
    canvas.invalidate();
  });
  resizeObserver.observe(root);
}

/**
 * Stories come and go, and docs pages swap the root. One observer keeps the canvas pointing at
 * whatever is rendering now, instead of hooking a render phase that differs per framework.
 */
function observeDocument(): void {
  if (treeObserver || !document.body) {
    return;
  }

  treeObserver = new MutationObserver(() => {
    if (!state.enabled) {
      return;
    }

    const root = document.getElementById(ROOT_ID);
    if (!root) {
      return;
    }

    // A new mount is already on its way; wait for it rather than nesting a second canvas.
    if (!node || !host) {
      return;
    }

    if (!node.isConnected) {
      unmount();
      void mount();
      return;
    }

    if (!node.contains(root)) {
      node.appendChild(root);
      canvas?.invalidate();
    }
  });
  treeObserver.observe(document.body, { childList: true, subtree: true });
}

function setState(next: CanvasState): void {
  const wasEnabled = state.enabled;
  state = next;

  if (state.enabled) {
    observeDocument();
    if (!wasEnabled || !host) {
      void mount();
    }
    void applyEffect();
    return;
  }

  unmount();
}

type PreviewChannel = ReturnType<typeof addons.getChannel>;

/**
 * The channel is created by the preview's addon setup, which can run after this module, so reading
 * it too early throws. Wait for it instead of failing the whole preview module.
 */
async function getChannel(attempt = 0): Promise<PreviewChannel | undefined> {
  try {
    return addons.getChannel();
  } catch {
    if (attempt >= 200) {
      return undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    return await getChannel(attempt + 1);
  }
}

async function wireChannel(): Promise<void> {
  const channel = await getChannel();
  if (!channel) {
    return;
  }

  // Storybook owns the toggle: the manager writes globals, the preview reacts here.
  channel.on('globalsUpdated', ({ globals }: { globals: Record<string, unknown> }) => {
    setState({ ...state, ...stateFromGlobals(globals ?? {}) });
  });

  channel.on('storyRendered', () => canvas?.invalidate());

  channel.on(EVENTS.REQUEST, async (request: CanvasRequest) => {
    let response: CanvasResponse;
    try {
      response = { id: request.id, ok: true, data: await answer(request) };
    } catch (error) {
      response = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    channel.emit(EVENTS.RESPONSE, response);
  });
}

async function answer(request: CanvasRequest): Promise<unknown> {
  const api = createAgentApi();

  switch (request.kind) {
    case 'describe':
      return api.describe();
    case 'capture':
      return await api.capture(
        request.target,
        request.scale ? { scale: request.scale } : undefined
      );
    case 'stats':
      return { mode: api.mode, supportsGpu: api.supportsGpu, stats: api.stats() };
    case 'flow':
      return request.open === false ? (closeFlow(), null) : await api.openFlow();
    default: {
      const exhaustive: never = request.kind;
      throw new Error(`Unknown request: ${String(exhaustive)}`);
    }
  }
}

function init(): void {
  state = stateFromGlobals(readGlobalsFromUrl());

  // The agent surface and the channel do not need a DOM, so they never wait on the document.
  exposeAgentApi();
  void wireChannel();

  const boot = () => {
    observeDocument();
    if (state.enabled) {
      void mount();
    }
  };

  if (document.body) {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  }
}

init();
