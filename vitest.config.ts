import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/signaling.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 20,
        branches: 40,
        functions: 20,
        statements: 20,
      },
    },
  },
});
