import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `--mode single` builds one self-contained HTML file (for the shareable preview link).
// The default build is the installable, offline-first PWA.
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    mode === 'single'
      ? viteSingleFile()
      : VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['icon.svg', 'apple-touch-icon.png'],
          manifest: {
            name: 'Lift Log',
            short_name: 'Lift Log',
            description: 'Today’s workout and what you did last time.',
            theme_color: '#101317',
            background_color: '#101317',
            display: 'standalone',
            orientation: 'portrait',
            start_url: '/',
            icons: [
              { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          workbox: { globPatterns: ['**/*.{js,css,html,svg,png}'] },
        }),
  ],
  build: mode === 'single' ? { outDir: 'dist-single' } : {},
}))
