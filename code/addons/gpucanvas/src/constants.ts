export const ADDON_ID = 'storybook/gpucanvas';
export const TOOL_ID = `${ADDON_ID}/tool`;
export const PANEL_ID = `${ADDON_ID}/panel`;

/** Global that turns the canvas on, so the mode survives reloads and can be shared as a URL. */
export const GLOBAL_KEY = 'gpucanvas';
/** Global that picks a shader effect for the story node. */
export const EFFECT_GLOBAL_KEY = 'gpucanvasEffect';

/**
 * The manager asks the preview for canvas data over the channel: the canvas only exists in the
 * preview document, so the panel cannot read it directly.
 */
export const EVENTS = {
  REQUEST: `${ADDON_ID}/request`,
  RESPONSE: `${ADDON_ID}/response`,
};

export type CanvasRequest = {
  id: string;
  kind: 'describe' | 'capture' | 'stats' | 'flow';
  /** A node id from `describe()`, for a capture. Falls back to the whole story. */
  target?: string;
  scale?: number;
  /** For `flow`: open the map, or close it. */
  open?: boolean;
};

export type CanvasResponse =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: string };

/** Storybook's story root in the preview document. */
export const ROOT_ID = 'storybook-root';
/** The element the canvas moves the story root into, and registers as a node. */
export const NODE_ID = 'gpucanvas-node';
export const HOST_ID = 'gpucanvas-host';
export const FLOW_HOST_ID = 'gpucanvas-flow-host';

export const BACKGROUND = '#f6f7f9';

/** Where the agent surface hangs off the preview window. */
export const AGENT_GLOBAL = '__STORYBOOK_GPUCANVAS__';

/**
 * Effects this addon offers in the toolbar. All of them exist in gpucanvas's `effects` map; the
 * DOM backend renders the ones with a CSS look as a filter and ignores the rest.
 */
export const EFFECT_NAMES = [
  'none',
  'glass',
  'frost',
  'dither',
  'shockwave',
  'glitch',
  'vhs',
  'glow',
  'hue',
  'ripple',
  'blur',
  'pixelate',
  'grayscale',
] as const;

export type EffectName = (typeof EFFECT_NAMES)[number];

export type CanvasState = {
  enabled: boolean;
  effect: EffectName;
  mode: 'auto' | 'gpu' | 'dom';
};

export const DEFAULT_STATE: CanvasState = {
  enabled: false,
  effect: 'none',
  mode: 'auto',
};
