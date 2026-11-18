import path from 'node:path';

import type { PresetPropertyFn } from 'storybook/internal/types';

export const previewAnnotations: PresetPropertyFn<'previewAnnotations'> = async (
  existingAnnotations = []
) => {
  return [...existingAnnotations, path.join(import.meta.dirname, 'preview.js')];
};
