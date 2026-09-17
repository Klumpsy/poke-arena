import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  base: process.env.BASE_PATH ?? '/',
  server: { fs: { allow: ['..'] } },
});
