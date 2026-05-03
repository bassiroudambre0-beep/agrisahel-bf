import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'AgriSahel BF',
        short_name: 'AgriSahel',
        description: 'La technologie au service des agriculteurs du Burkina Faso',
        theme_color: '#1B4332',
        background_color: '#FDF6EC',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        // Mettre en cache tous les fichiers de l'app
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],

        // Stratégie : Cache d'abord, réseau ensuite (parfait pour zones à faible connexion)
        runtimeCaching: [
          {
            // Cache des polices Google Fonts (Fraunces + Nunito)
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'agrisahel-google-fonts-cache',
              expiration: { 
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 an
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Cache des fichiers de polices
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'agrisahel-fonts-files-cache',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 an
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Cache de l'API Anthropic (IA diagnostic) — réseau d'abord
            urlPattern: /^https:\/\/api\.anthropic\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'agrisahel-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 // 24h
              },
              networkTimeoutSeconds: 10,
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      }
    })
  ]
})