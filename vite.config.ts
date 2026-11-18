import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /**
     * PWA support so the *web* build is installable and works offline.
     *
     * This is the fallback target next to the Tauri desktop app: identical code,
     * but it runs in a browser tab and is therefore subject to CORS. The service
     * worker only precaches the static shell — API calls always go to the
     * network, because caching a model response would be wrong.
     */
    VitePWA({
      registerType: 'autoUpdate',
      /* 只由应用按 runtime 决定是否注册（Tauri 下 SW 必然失败）。 */
      injectRegister: null,
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'RPNow — AI 角色扮演',
        short_name: 'RPNow',
        description:
          '专注于 AI 角色扮演的本地优先应用：角色卡 / 世界书 / 预设导入导出，插件化可扩展。',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#1a1520',
        theme_color: '#1a1520',
        categories: ['entertainment', 'productivity'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The app shell is small; precache all static assets.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Never cache API traffic: responses are user-specific and often streamed.
        navigateFallbackDenylist: [/^\/api/],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: {
        // Keeps the SW out of `vite dev` so HMR is not confused.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') },
  },
  /**
   * Dependencies imported dynamically (the Tauri HTTP plugin, jszip, the YAML
   * parser) still have to be pre-bundled. Listing them prevents Vite from
   * discovering them at runtime, re-optimising, and serving one 504
   * "Outdated Optimize Dep" to the browser.
   */
  optimizeDeps: {
    include: ['@tauri-apps/plugin-http', 'jszip', 'yaml', 'dompurify', 'marked'],
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    // Pre-bundle every entry point up front. Without this, a module imported
    // lazily (the Tauri plugin, jszip) triggers a re-optimisation mid-session
    // and Vite returns 504 "Outdated Optimize Dep" once, which looks like a
    // broken app to anyone refreshing during it.
    warmup: {
      clientFiles: ['./src/main.tsx'],
    },
    fs: {
      // Vendored reference repositories (_ref/) hold their own apps; keep the
      // dev server from crawling and trying to resolve their dependencies.
      deny: ['_ref/**', '.agents/**', 'docs/**'],
    },
    watch: {
      // Editors write temp files (`.Name.tsx.<pid>.tmpdir/`) beside the target.
      // On Windows the fs watcher can fail with EBUSY on those and crash the dev
      // server, so they are excluded from watching entirely.
      ignored: [
        '**/_ref/**',
        '**/.agents/**',
        '**/docs/**',
        '**/design-system/**',
        '**/screenshots/**',
        '**/.*.tmpdir/**',
        '**/*.tmp',
        // Rust build output churns constantly during `tauri build`.
        '**/src-tauri/target/**',
      ],
    },
  },
  build: {
    /**
     * Android WebView on older devices is the lowest common denominator. A
     * WebView 91 (2021, shipped in emulator images and on un-updated phones)
     * has no `??`/`?.` support, so an es2022 bundle renders a blank screen.
     * es2019 is transpiled by esbuild for the syntax it needs to lower while
     * keeping the bundle small; modern browsers are unaffected.
     */
    target: ['es2019', 'chrome70', 'safari13'],
    sourcemap: false,
    chunkSizeWarningLimit: 900,    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries so the app shell loads
        // from cache on subsequent visits and the first paint is not blocked
        // behind the markdown/zip stack.
        manualChunks: {
          react: ['react', 'react-dom'],
          markdown: ['marked', 'dompurify'],
          archive: ['jszip'],
        },
      },
    },
  },
});
