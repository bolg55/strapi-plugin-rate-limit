import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
    globals: true,
    clearMocks: true,
    restoreMocks: true,
  },
});
