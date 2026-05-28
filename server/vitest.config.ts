import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 6000,
    hookTimeout: 6000,
  },
});
