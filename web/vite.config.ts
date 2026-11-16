import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Each parallel dev server needs its own pre-bundle cache, or they overwrite each other's (504 Outdated Optimize Dep).
  cacheDir: process.env.FS_VITE_CACHE ?? 'node_modules/.vite',
  server: {
    port: 5173,
    proxy: {
      // FS_API lets a second dev server talk to a second API (parallel work); default is the main API.
      '/api': { target: process.env.FS_API ?? 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  // `vite preview` serves the production build (e.g. behind a temporary share tunnel): same API proxy, and the
  // tunnel's host names are allowed.
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: process.env.FS_API ?? 'http://127.0.0.1:8000', changeOrigin: true },
    },
    allowedHosts: ['.trycloudflare.com'],
  },
})
