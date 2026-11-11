import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vitest runs the browser-facing unit tests (playlist audio clips, pack import).
 * jsdom provides DOM events; Web Audio is mocked per test because jsdom has no
 * implementation of it.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
    clearMocks: true,
  },
});
