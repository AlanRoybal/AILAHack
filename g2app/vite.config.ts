import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    fs: { allow: ['..'] },
    host: true,
    port: 5173,
    // Same-origin path to the bridge so the WebView needs no CORS or extra whitelist.
    proxy: { '/bridge': { target: `ws://localhost:${process.env.BRIDGE_PORT ?? '8787'}`, ws: true, rewrite: p => p.replace(/^\/bridge/, '/ws') } },
  },
  build: { target: 'esnext' },
})
