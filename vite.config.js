import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        gazeTest: fileURLToPath(new URL('./gaze-test/index.html', import.meta.url)),
        soundTest: fileURLToPath(new URL('./sound-test/index.html', import.meta.url)),
      },
    },
  },
  root: projectRoot,
});
