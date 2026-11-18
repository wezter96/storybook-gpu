import type { BuildEntries } from '../../../scripts/build/utils/entry-utils.ts';

const config: BuildEntries = {
  entries: {
    node: [
      {
        exportEntries: ['./preset'],
        entryPoint: './src/preset.ts',
        dts: false,
      },
    ],
    browser: [
      {
        exportEntries: ['.'],
        entryPoint: './src/index.ts',
      },
      {
        exportEntries: ['./preview'],
        entryPoint: './src/preview.ts',
        dts: false,
      },
      {
        exportEntries: ['./manager'],
        entryPoint: './src/manager.tsx',
        dts: false,
      },
    ],
  },
};

export default config;
