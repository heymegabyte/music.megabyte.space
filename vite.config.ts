import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: { host: true, port: 5173, strictPort: false },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    cssMinify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ashtonLetter: resolve(__dirname, 'ashton-letter/index.html'),
        embed: resolve(__dirname, 'embed.html'),
        castReceiver: resolve(__dirname, 'cast-receiver/index.html')
      },
      output: {
        // Split observability into a separate async chunk so the LCP-critical
        // main bundle never blocks on telemetry boot.
        manualChunks(id) {
          if (id.includes('src/observability')) return 'observability';
        }
      }
    }
  }
});
