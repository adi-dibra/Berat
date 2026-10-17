import { defineConfig } from 'vitest/config';

// `npm run perf`: the 5,000 tab / 20,000 bookmark performance test.
export default defineConfig({
  test: {
    include: ['tests/perf/**/*.perf.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
