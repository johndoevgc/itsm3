import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@itsm3/ai-prompts': resolve(__dirname, '../packages/ai-prompts/src/index.ts'),
      '@itsm3/graph-client': resolve(__dirname, '../packages/graph-client/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
