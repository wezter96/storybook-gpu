import type { GpuCanvas, Marks, Rect } from 'gpucanvas';

/**
 * A story as a card on the flow map. A card is one viewport in size, so each story is shown the way
 * it looks when you open it, and the map is what you pan around to compare them.
 */
export type FlowCard = {
  id: string;
  title: string;
  name: string;
  /** The component the story belongs to; stories of one component sit in one column. */
  group: string;
  importPath: string;
  exportName: string;
  rect: Rect;
};

export type FlowOptions = {
  /** Card size in world units. Defaults to the surface, so a card is one screen. */
  cardWidth?: number;
  cardHeight?: number;
  /** Most stories mounted as live DOM at once. Everything else stays a cheap placeholder. */
  maxLive?: number;
  /** Most connector arrows drawn at once. */
  maxEdges?: number;
};

export type Flow = {
  readonly cards: readonly FlowCard[];
  /** Re-reads the camera and mounts, unmounts and connects what is in view now. */
  sync(): void;
  /** Frames one card, or the whole map. */
  focus(id?: string): void;
  stats(): Record<string, unknown>;
  destroy(): void;
};

type IndexEntry = {
  id: string;
  title: string;
  name: string;
  importPath: string;
  type?: string;
  exportName?: string;
};

type Live = { element: HTMLElement; dispose: () => void };

const COLUMN_GAP = 320;
const CARD_GAP = 200;
const COLUMN_LIMIT = 6;

/** `importPath` is relative to the config directory, which is one level inside the served root. */
function moduleUrl(importPath: string): string {
  const clean = importPath.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');

  return new URL(clean, document.baseURI).href;
}

async function loadIndex(): Promise<IndexEntry[]> {
  const response = await fetch(new URL('index.json', document.baseURI).href);
  if (!response.ok) {
    throw new Error(`Could not read the story index (${response.status} ${response.statusText})`);
  }

  const json = (await response.json()) as { entries?: Record<string, IndexEntry> };
  const entries = Object.values(json.entries ?? {});

  return entries.filter((entry) => (entry.type ?? 'story') === 'story');
}

/**
 * One column per component, stories stacked in reading order. Components are ordered as the index
 * has them, so a map keeps the shape of the project: a column is a component, a row is its state.
 */
function layout(entries: IndexEntry[], cardWidth: number, cardHeight: number): FlowCard[] {
  const columns: IndexEntry[][] = [];
  let current: IndexEntry[] = [];
  let lastGroup: string | undefined;

  for (const entry of entries) {
    if (entry.title !== lastGroup && current.length > 0) {
      columns.push(current);
      current = [];
    }
    if (current.length >= COLUMN_LIMIT) {
      columns.push(current);
      current = [];
    }

    current.push(entry);
    lastGroup = entry.title;
  }
  if (current.length > 0) {
    columns.push(current);
  }

  return columns.flatMap((column, columnIndex) =>
    column.map((entry, rowIndex) => ({
      id: entry.id,
      title: entry.title,
      name: entry.name,
      group: entry.title,
      importPath: entry.importPath,
      exportName: entry.exportName ?? '',
      rect: {
        x: columnIndex * (cardWidth + COLUMN_GAP),
        y: rowIndex * (cardHeight + CARD_GAP),
        width: cardWidth,
        height: cardHeight,
      },
    }))
  );
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function center(rect: Rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function distance(a: Rect, b: Rect): number {
  const one = center(a);
  const two = center(b);

  return Math.hypot(one.x - two.x, one.y - two.y);
}

function cardLabel(card: FlowCard): string {
  return `${card.title} · ${card.name}`;
}

function createPlaceholder(card: FlowCard): HTMLElement {
  const element = document.createElement('div');
  element.dataset.flowCard = card.id;
  element.style.cssText = [
    `width:${card.rect.width}px;height:${card.rect.height}px`,
    'box-sizing:border-box',
    'display:flex',
    'flex-direction:column',
    'justify-content:flex-end',
    'gap:8px',
    'padding:32px',
    'border-radius:16px',
    'background:#ffffff',
    'box-shadow:0 1px 3px rgba(15, 23, 42, 0.14)',
    'color:#0f172a',
    'font:500 20px/1.3 ui-sans-serif, system-ui, sans-serif',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = card.title;
  title.style.cssText = 'font-weight:600;opacity:0.95';

  const name = document.createElement('div');
  name.textContent = card.name;
  name.style.cssText = 'font-weight:400;opacity:0.55;font-size:16px';

  element.append(title, name);

  return element;
}

type Renderer = {
  render(card: FlowCard, container: HTMLElement): Promise<Live | null>;
};

/**
 * Renders a story outside the preview's own render loop, by importing its module and mounting the
 * component the way the story would have been mounted. Stories that are not plain React elements
 * (portals, custom renderers) keep their placeholder instead of breaking the map.
 */
function createRenderer(): Renderer {
  const modules = new Map<string, Promise<Record<string, unknown>>>();

  const load = (importPath: string) => {
    let module = modules.get(importPath);
    if (!module) {
      module = import(/* @vite-ignore */ moduleUrl(importPath)) as Promise<Record<string, unknown>>;
      modules.set(importPath, module);
    }

    return module;
  };

  return {
    async render(card, container) {
      if (!card.exportName) {
        return null;
      }

      const module = await load(card.importPath);
      const meta = (module.default ?? {}) as {
        component?: unknown;
        args?: Record<string, unknown>;
        parameters?: Record<string, unknown>;
      };
      const story = module[card.exportName] as
        | {
            render?: (args: Record<string, unknown>, context: unknown) => unknown;
            args?: Record<string, unknown>;
            parameters?: Record<string, unknown>;
          }
        | undefined;

      const args = { ...(meta.args ?? {}), ...(story?.args ?? {}) };
      const parameters = { ...(meta.parameters ?? {}), ...(story?.parameters ?? {}) };
      const context = {
        args,
        globals: {},
        parameters,
        viewMode: 'story',
        loaded: {},
        id: card.id,
        title: card.title,
        name: card.name,
        kind: card.title,
        story: card.name,
        hooks: {},
      };

      const React = await import('react');
      const { createRoot } = await import('react-dom/client');

      let element: unknown;
      if (typeof story?.render === 'function') {
        element = story.render(args, context);
      } else if (meta.component) {
        element = React.createElement(meta.component as never, args as never);
      } else {
        return null;
      }

      const root = createRoot(container);
      root.render(element as never);

      // Two frames is enough for React to commit and the browser to lay the story out.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      return {
        element: container,
        dispose: () => root.unmount(),
      };
    },
  };
}

export async function createFlow(
  canvas: GpuCanvas,
  marks: Marks,
  options: FlowOptions = {}
): Promise<Flow> {
  const entries = await loadIndex();
  const surface = canvas.surface.getBoundingClientRect();
  const cardWidth = options.cardWidth ?? Math.max(960, Math.round(surface.width) || 1280);
  const cardHeight = options.cardHeight ?? Math.max(540, Math.round(surface.height) || 720);
  const maxLive = options.maxLive ?? 16;
  const maxEdges = options.maxEdges ?? 400;

  const cards = layout(entries, cardWidth, cardHeight);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const placeholders = new Map<string, HTMLElement>();
  const live = new Map<string, Live>();
  const renderer = createRenderer();
  let frame = 0;
  let destroyed = false;
  let edgeCount = 0;

  function removeLive(id: string): void {
    const entry = live.get(id);
    if (!entry) {
      return;
    }

    canvas.removeNode(entry.element);
    try {
      entry.dispose();
    } catch {
      // A story that fails to unmount must not stop the map from updating.
    }
    entry.element.remove();
    live.delete(id);
  }

  function removePlaceholder(id: string): void {
    const element = placeholders.get(id);
    if (!element) {
      return;
    }

    canvas.removeNode(element);
    element.remove();
    placeholders.delete(id);
  }

  function viewport(): Rect {
    const camera = canvas.getCamera();
    const rect = canvas.surface.getBoundingClientRect();

    return {
      x: camera.x,
      y: camera.y,
      width: rect.width / camera.zoom,
      height: rect.height / camera.zoom,
    };
  }

  function sync(): void {
    if (destroyed) {
      return;
    }

    const view = viewport();
    const near: Rect = {
      x: view.x - view.width,
      y: view.y - view.height,
      width: view.width * 3,
      height: view.height * 3,
    };

    const visible = cards.filter((card) => intersects(card.rect, view));
    const candidates = cards
      .filter((card) => intersects(card.rect, near))
      .sort((one, two) => distance(one.rect, view) - distance(two.rect, view));

    const keep = new Set<string>();
    let liveCount = live.size;

    for (const card of candidates) {
      if (liveCount >= maxLive) {
        break;
      }
      if (live.has(card.id) || !card.exportName) {
        continue;
      }

      // Mounting a live story replaces its placeholder in the same place on the map.
      removePlaceholder(card.id);
      const container = document.createElement('div');
      container.dataset.flowLive = card.id;
      container.style.cssText = `width:${card.rect.width}px;height:${card.rect.height}px;overflow:hidden;border-radius:16px;background:#fff;box-shadow:0 1px 3px rgba(15, 23, 42, 0.14);`;

      canvas.addNode(container, card.rect);
      liveCount++;
      keep.add(card.id);

      void renderer
        .render(card, container)
        .then((mounted) => {
          if (destroyed) {
            mounted?.dispose();
            return;
          }
          if (!mounted) {
            // Not renderable out of the preview's loop: fall back to the placeholder.
            canvas.removeNode(container);
            container.remove();
            live.delete(card.id);
            return;
          }

          live.set(card.id, mounted);
          canvas.invalidate();
        })
        .catch(() => {
          canvas.removeNode(container);
          container.remove();
          live.delete(card.id);
        });

      live.set(card.id, { element: container, dispose: () => {} });
    }

    for (const id of [...live.keys()]) {
      if (keep.has(id)) {
        continue;
      }
      const card = byId.get(id);
      if (!card || !intersects(card.rect, near)) {
        removeLive(id);
      }
    }

    for (const card of visible) {
      if (live.has(card.id) || placeholders.has(card.id)) {
        continue;
      }

      const element = createPlaceholder(card);
      canvas.addNode(element, card.rect);
      placeholders.set(card.id, element);
    }

    for (const [id, element] of [...placeholders]) {
      const card = byId.get(id);
      if (!card || (!intersects(card.rect, view) && !intersects(card.rect, near))) {
        canvas.removeNode(element);
        element.remove();
        placeholders.delete(id);
      }
    }

    // The flow map's edges: a component's stories read top to bottom, and a component's first story
    // continues from the previous component's last one.
    marks.clear();
    let edges = 0;
    for (let index = 0; index < cards.length - 1 && edges < maxEdges; index++) {
      const from = cards[index];
      const to = cards[index + 1];
      if (!intersects(from.rect, near) && !intersects(to.rect, near)) {
        continue;
      }

      marks.connect(
        { x: from.rect.x + from.rect.width / 2, y: from.rect.y + from.rect.height },
        { x: to.rect.x + to.rect.width / 2, y: to.rect.y },
        { dashed: from.group !== to.group }
      );
      edges++;
    }

    edgeCount = edges;
    canvas.invalidate();
  }

  function schedule(): void {
    if (frame) {
      return;
    }

    frame = requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  }

  const flow: Flow = {
    cards,
    sync,
    focus: (id) => {
      if (!id) {
        canvas.fit(80);
        return;
      }

      const card = byId.get(id);
      if (!card) {
        return;
      }

      const rect = canvas.surface.getBoundingClientRect();
      const camera = canvas.getCamera();
      const width = rect.width / camera.zoom;
      const height = rect.height / camera.zoom;

      canvas.setCamera({
        x: card.rect.x + card.rect.width / 2 - width / 2,
        y: card.rect.y + card.rect.height / 2 - height / 2,
        zoom: camera.zoom,
      });
    },
    stats: () => ({
      stories: cards.length,
      live: live.size,
      placeholders: placeholders.size,
      edges: edgeCount,
      camera: canvas.getCamera(),
      canvas: canvas.getStats(),
    }),
    destroy: () => {
      destroyed = true;
      if (frame) {
        cancelAnimationFrame(frame);
      }
      for (const id of [...live.keys()]) {
        removeLive(id);
      }
      for (const id of [...placeholders.keys()]) {
        removePlaceholder(id);
      }
      marks.clear();
    },
  };

  schedule();

  return flow;
}
