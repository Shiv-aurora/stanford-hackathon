import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// In api mode the frontend calls `/api/*`, which is proxied to the FastAPI backend
// (override the target with VITE_API_TARGET). The backend also allows CORS, so
// VITE_API_BASE can point straight at it instead.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const target = env.VITE_API_TARGET || 'http://127.0.0.1:8000';
  const proxy = {
    '/api': { target, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/api/, '') },
  };
  return {
    plugins: [react()],
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
  };
});
