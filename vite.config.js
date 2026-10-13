import {defineConfig} from 'vite';
export default defineConfig({
  server: {proxy: {
    '/api': process.env.EXPERIMENT_API_URL || 'http://127.0.0.1:8000',
    '/data-portal': process.env.EXPERIMENT_API_URL || 'http://127.0.0.1:8000',
    '/database': process.env.EXPERIMENT_API_URL || 'http://127.0.0.1:8000'
  }}
});
