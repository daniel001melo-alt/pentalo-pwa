import type { VitePWAOptions } from 'vite-plugin-pwa';

/**
 * Configuração do Service Worker e do Web App Manifest.
 * - registerType "prompt": a nova versão só assume quando o usuário toca em "Atualizar"
 *   (nunca recarrega no meio de um registro). Os dados ficam no IndexedDB, fora do cache,
 *   e por isso sobrevivem a qualquer atualização do app.
 * - Precache de todos os assets do build → funciona offline após a primeira abertura.
 */
export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'prompt',
  injectRegister: false,
  // favicon e ícones já entram pelo globPatterns (pasta public), sem duplicar no precache
  manifest: {
    id: './',
    name: 'Pentatlo Militar — Preparação 2026/27',
    short_name: 'Pentatlo',
    description: 'Acompanhamento offline de treino, dieta e aderência para o Pentatlo Militar.',
    lang: 'pt-BR',
    dir: 'ltr',
    start_url: './#/hoje',
    scope: './',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b1220',
    theme_color: '#0b1220',
    categories: ['sports', 'health', 'fitness'],
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Atalhos: suportados no Android/desktop. O iOS ignora atalhos de manifest.
    shortcuts: [
      { name: 'Hoje', short_name: 'Hoje', url: './#/hoje', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Registrar água', short_name: 'Água', url: './#/hoje?acao=agua', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Treinos', short_name: 'Treinos', url: './#/treinos', icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }] },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
    navigateFallback: 'index.html',
    cleanupOutdatedCaches: true,
    clientsClaim: false,
    skipWaiting: false,
    maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
  },
  devOptions: { enabled: false },
};
