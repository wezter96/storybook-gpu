import React, { useCallback, useRef, useState } from 'react';

import { useChannel, useGlobals } from 'storybook/manager-api';

import {
  EFFECT_GLOBAL_KEY,
  EFFECT_NAMES,
  EVENTS,
  GLOBAL_KEY,
  type CanvasRequest,
  type CanvasResponse,
  type EffectName,
} from './constants.ts';

const ANSWER_TIMEOUT_MS = 5000;

const containerStyle: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 12,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  height: '100%',
  boxSizing: 'border-box',
};

const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center' };

const controlStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid currentColor',
  borderRadius: 4,
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
  padding: '4px 10px',
};

const outputStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  margin: 0,
  padding: 8,
  borderRadius: 4,
  background: 'rgba(127, 127, 127, 0.08)',
  fontSize: 11,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

/**
 * The canvas lives in the preview document, so the panel reads it over the channel: describe what
 * is on it, capture a PNG, or open a summary. This is the same data the agent-facing window API
 * exposes, which keeps the panel and an agent looking at one source of truth.
 */
export const GpuCanvasPanel = () => {
  const [globals, updateGlobals] = useGlobals();
  const [output, setOutput] = useState<string>(
    'Turn on GPU in the toolbar, then describe what is on the canvas.'
  );
  const [busy, setBusy] = useState(false);
  const pending = useRef(new Map<string, (response: CanvasResponse) => void>());

  const enabled = globals[GLOBAL_KEY] === 'on' || globals[GLOBAL_KEY] === true;
  const effect = (globals[EFFECT_GLOBAL_KEY] as EffectName | undefined) ?? 'none';

  const emit = useChannel({
    [EVENTS.RESPONSE]: (response: CanvasResponse) => {
      const resolve = pending.current.get(response.id);
      pending.current.delete(response.id);
      resolve?.(response);
    },
  });

  const call = useCallback(
    (request: Omit<CanvasRequest, 'id'>) =>
      new Promise<CanvasResponse>((resolve) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        pending.current.set(id, resolve);
        emit(EVENTS.REQUEST, { ...request, id });
        setTimeout(() => {
          if (pending.current.delete(id)) {
            resolve({
              id,
              ok: false,
              error: 'The preview did not answer. Turn on GPU in the toolbar and try again.',
            });
          }
        }, ANSWER_TIMEOUT_MS);
      }),
    [emit]
  );

  const report = async (
    request: Omit<CanvasRequest, 'id'>,
    describe: (data: unknown) => string
  ) => {
    setBusy(true);
    try {
      const response = await call(request);
      setOutput(response.ok ? describe(response.data) : response.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={containerStyle}>
      <div style={rowStyle}>
        <button
          type="button"
          disabled={!enabled || busy}
          style={{ ...controlStyle, opacity: !enabled || busy ? 0.5 : 1 }}
          onClick={() =>
            report({ kind: 'describe' }, (data) =>
              Array.isArray(data) && data.length === 0
                ? 'The canvas is on, but nothing is on it yet.'
                : JSON.stringify(data, null, 2)
            )
          }
        >
          Describe canvas
        </button>
        <button
          type="button"
          disabled={!enabled || busy}
          style={{ ...controlStyle, opacity: !enabled || busy ? 0.5 : 1 }}
          onClick={() => report({ kind: 'stats' }, (data) => JSON.stringify(data, null, 2))}
        >
          Renderer stats
        </button>
        <button
          type="button"
          disabled={!enabled || busy}
          style={{ ...controlStyle, opacity: !enabled || busy ? 0.5 : 1 }}
          onClick={() =>
            report({ kind: 'capture', scale: 2 }, (data) => {
              const anchor = document.createElement('a');
              anchor.href = String(data);
              anchor.download = 'storybook-gpucanvas.png';
              anchor.click();
              return 'Saved a PNG of the story at 2x.';
            })
          }
        >
          Capture PNG
        </button>
      </div>
      <div style={rowStyle}>
        <label htmlFor="gpucanvas-panel-effect">Effect</label>
        <select
          id="gpucanvas-panel-effect"
          value={effect}
          disabled={!enabled}
          onChange={(event) => updateGlobals({ [EFFECT_GLOBAL_KEY]: event.target.value })}
          style={{ ...controlStyle, cursor: 'pointer' }}
        >
          {EFFECT_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <span style={{ opacity: 0.6 }}>{enabled ? 'canvas on' : 'canvas off'}</span>
      </div>
      <pre style={outputStyle}>{output}</pre>
    </div>
  );
};
