import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {resolve} from 'node:path';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {rollupOptions: {input: {
    experiment: resolve('index.html'),
    portal: resolve('data-portal/index.html'),
    users: resolve('data-portal/users.html'),
    preview: resolve('data-portal/preview.html')
  }}},
  server: {proxy: {
    '/api': process.env.EXPERIMENT_API_URL || 'http://127.0.0.1:8000',
    '/data-portal/api': process.env.EXPERIMENT_API_URL || 'http://127.0.0.1:8000',
    '/data-portal/auth': process.env.EXPERIMENT_API_URL || 'http://127.0.0.1:8000',
    '/data-portal/download': process.env.EXPERIMENT_API_URL || 'http://127.0.0.1:8000',
    '/database': process.env.EXPERIMENT_API_URL || 'http://127.0.0.1:8000'
  }}
});
