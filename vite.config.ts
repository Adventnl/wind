import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/signal': { target: 'ws://127.0.0.1:3001', ws: true },
      '/health': 'http://127.0.0.1:3001',
      '/config': 'http://127.0.0.1:3001',
    },
  },
});
