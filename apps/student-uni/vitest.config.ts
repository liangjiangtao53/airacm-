import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/utils/**/*.spec.ts', 'scripts/**/*.spec.mjs'],
  },
});
