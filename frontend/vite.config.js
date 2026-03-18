import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Proxy used for local `npm run dev` only.
  // In Docker, nginx handles /api/ → backend:3001.
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
