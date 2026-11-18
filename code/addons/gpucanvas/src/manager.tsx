import React from 'react';

import { addons, types, useGlobals } from 'storybook/manager-api';

import {
  ADDON_ID,
  EFFECT_GLOBAL_KEY,
  EFFECT_NAMES,
  GLOBAL_KEY,
  PANEL_ID,
  TOOL_ID,
  type EffectName,
} from './constants.ts';
import { GpuCanvasPanel } from './panel.tsx';

const buttonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid currentColor',
  borderRadius: 4,
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 11,
  padding: '3px 8px',
};

const selectStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid currentColor',
  borderRadius: 4,
  color: 'inherit',
  font: 'inherit',
  fontSize: 11,
  padding: '3px 4px',
};

const GpuCanvasTool = () => {
  const [globals, updateGlobals] = useGlobals();
  const enabled = globals[GLOBAL_KEY] === 'on' || globals[GLOBAL_KEY] === true;
  const effect = (globals[EFFECT_GLOBAL_KEY] as EffectName | undefined) ?? 'none';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px' }}>
      <button
        type="button"
        title={
          enabled
            ? 'Put the story back in the normal preview document'
            : 'Render the story on a gpucanvas infinite canvas'
        }
        aria-pressed={enabled}
        onClick={() => updateGlobals({ [GLOBAL_KEY]: enabled ? 'off' : 'on' })}
        style={buttonStyle}
      >
        {enabled ? 'GPU on' : 'GPU'}
      </button>
      {enabled ? (
        <select
          title="Shader effect for the story node"
          aria-label="Shader effect"
          value={effect}
          onChange={(event) =>
            updateGlobals({ [EFFECT_GLOBAL_KEY]: event.target.value as EffectName })
          }
          style={selectStyle}
        >
          {EFFECT_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
};

addons.register(ADDON_ID, () => {
  addons.add(TOOL_ID, {
    title: 'GPU canvas',
    type: types.TOOL,
    // A story view has a single root to move onto the canvas; docs pages are left alone.
    match: ({ viewMode }) => viewMode === 'story',
    render: GpuCanvasTool,
  });

  addons.add(PANEL_ID, {
    title: 'GPU canvas',
    type: types.PANEL,
    match: ({ viewMode }) => viewMode === 'story',
    render: GpuCanvasPanel,
  });
});
