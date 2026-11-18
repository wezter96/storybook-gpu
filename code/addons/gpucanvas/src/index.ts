// The canvas has no annotations to compose: it registers itself in the preview document, which is
// why this entry is a side-effect import rather than a `definePreviewAddon` value.
import './preview.ts';

export type { CanvasState, EffectName } from './constants.ts';
