import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    port: 5174,
    proxy: { '/api': `http://localhost:${process.env.BOOTH_PORT ?? '8790'}` },
  },
  build: { target: 'esnext' },
})
