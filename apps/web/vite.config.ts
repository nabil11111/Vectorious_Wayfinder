import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    // Keep the built app for a cold offline load. API answers always come from the server.
    registerType: 'prompt',
    injectRegister: false,
    manifest: false,
    devOptions: { enabled: false },
    workbox: {
      globPatterns: ['**/*.{html,js,css,png,svg,ico,woff,woff2}'],
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api(?:\/|$)/],
      runtimeCaching: [],
      skipWaiting: false,
      clientsClaim: false,
      cleanupOutdatedCaches: true,
    },
  })],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  // In development the API runs on 3000; the proxy keeps everything on one origin, like production.
  server: { proxy: { '/api': 'http://localhost:3000' } },
})
