import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
  optimizeDeps: {
    include: [
      '@mariozechner/pi-ai',
      '@mariozechner/pi-agent-core',
      '@mariozechner/pi-web-ui',
    ],
  },
});
