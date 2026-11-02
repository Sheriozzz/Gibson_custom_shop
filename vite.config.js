import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The site is served from https://sheriozzz.github.io/Gibson_custom_shop/ , so a production
// build needs that sub-path as its base. Local dev (npm run dev) keeps working at "/".
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Gibson_custom_shop/' : '/',
  build: {
    rollupOptions: {
      // two pages: the home page and the configurator
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        customShop: fileURLToPath(new URL('./custom-shop.html', import.meta.url)),
      },
    },
  },
}));
