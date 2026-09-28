import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  // In development the API runs on 3000; the proxy keeps everything on one origin, like production.
  server: { proxy: { '/api': 'http://localhost:3000' } },
})
