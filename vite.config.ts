/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: { charts: ['recharts'] },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/functions/_shared/**/*.test.ts'],
  },
});
