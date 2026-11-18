# Storybook GPU Canvas Addon

Renders the story in the preview on a [gpucanvas](https://github.com/berkantay/gpucanvas) infinite
canvas, and exposes what is on that canvas to AI agents.

This is an experiment: gpucanvas is at 0.4 and its API can still change.

## Try it

Add the addon to `.storybook/main.ts`:

```ts
export default {
  addons: ['@storybook/addon-gpucanvas'],
};
```

Open a story, then press **GPU** in the toolbar. The story moves onto a canvas; pan with a drag,
zoom with the wheel, and pick a shader effect (glass, frost, shockwave, glitch, …) next to the
toggle. Press **GPU on** again to put the story back.

The toggle writes a `gpucanvas` global, so a reload keeps the mode and the URL can be shared with
`&globals=gpucanvas:on`.

## How it works

The addon has no renderer integration. Storybook already renders the story into
`#storybook-root` in the preview document, so the addon moves that element into a node on the
canvas. The story keeps its own DOM — state, events, CSS and accessibility behave as usual — and
the canvas only changes how it is drawn.

Where WebGPU and Chrome's HTML-in-Canvas are available (Chrome 157+), gpucanvas rasterizes nodes
into a GPU atlas and draws them in one instanced pass. Everywhere else it falls back to
CSS-transformed DOM with the same API. Snapshots need the GPU path; the DOM fallback rejects them.

## The agent surface

With the canvas on, the preview window exposes `window.__STORYBOOK_GPUCANVAS__`:

```js
// What is in view, as a short JSON tree of ids, tags, roles, text and rects.
await page.evaluate(() => __STORYBOOK_GPUCANVAS__.describe());

// A PNG data URL of the whole story, a node id from describe(), or a world rect.
await page.evaluate(() => __STORYBOOK_GPUCANVAS__.capture(undefined, { scale: 2 }));
await page.evaluate(() => __STORYBOOK_GPUCANVAS__.capture('e25'));

// Point at things, so a report lands on the element it is about.
await page.evaluate(() => __STORYBOOK_GPUCANVAS__.note('e6', 'This heading is 2px off the grid'));
await page.evaluate(() => __STORYBOOK_GPUCANVAS__.connect('e25', 'e35', 'goes to'));

__STORYBOOK_GPUCANVAS__.setEffect('glass');
__STORYBOOK_GPUCANVAS__.fit();
__STORYBOOK_GPUCANVAS__.stats();
```

`describe()` and `capture()` are what an agent needs to read a story and see it; `note()`,
`connect()` and `clearMarks()` are what it needs to point at it. Both are the primitives the MCP
toolsets currently lack — `stories.preview` hands a URL to a human instead.

## Limitations

- **One story per canvas.** The canvas wraps the single preview root. Putting the whole story index
  on one canvas needs concurrent story mounting, which the preview runtime does not do today.
- **Docs pages are untouched**; the toolbar only appears in story view.
- **Snapshots are GPU-only**, so `capture()` throws on the DOM fallback (Firefox, Safari, iOS).
- The story is moved out of its usual position in the preview document. Stories that depend on
  where they sit in the body (fixed overlays, `position: sticky`) can look different.

## Flow map

`Flow` in the toolbar (or `__STORYBOOK_GPUCANVAS__.openFlow()`) puts every story in the index on one
canvas: each story is a card one viewport in size, laid out one column per component, with connector
arrows in reading order. It is meant for projects with hundreds or thousands of stories, where seeing
them side by side beats clicking through the sidebar.

Only the stories near the viewport are mounted as real DOM; everything else is a cheap placeholder
until it comes into view, and leaving the view unmounts them again. The canvas pages and snapshots the
rest on the GPU, so panning a map of thousands of cards costs the same as a map of ten.

```js
const flow = window.__STORYBOOK_GPUCANVAS__;
await flow.openFlow({ maxLive: 24 }); // 16 live stories by default
flow.flowStats();                     // stories, live, placeholders, edges, canvas stats
flow.focusStory('button--primary');   // frame one card
flow.closeFlow();
```
