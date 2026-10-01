import localFont from 'next/font/local';

// Fontes dos templates do cardápio (docs/templates-cardapio/00-base-cardapio.md §4.3). Arquivos
// variáveis vindos do npm (@fontsource-variable, licença OFL) e guardados em `src/fonts` — o build
// NUNCA busca no Google (ver `app/layout.tsx`). `preload: false`: o navegador só baixa a fonte do
// template que a loja usa. O Regem Fluxo usa as fontes do app (Figtree, Archivo, JetBrains Mono).

const bricolage = localFont({
  src: '../../../fonts/bricolage-grotesque-var.woff2',
  weight: '200 800',
  display: 'swap',
  variable: '--font-bricolage',
  preload: false,
  fallback: ['system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
});
const dmSans = localFont({
  src: '../../../fonts/dm-sans-var.woff2',
  weight: '100 1000',
  display: 'swap',
  variable: '--font-dm-sans',
  preload: false,
  fallback: ['system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
});
const rubik = localFont({
  src: '../../../fonts/rubik-var.woff2',
  weight: '300 900',
  display: 'swap',
  variable: '--font-rubik',
  preload: false,
  fallback: ['system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
});
const lexend = localFont({
  src: '../../../fonts/lexend-var.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-lexend',
  preload: false,
  fallback: ['system-ui', 'Segoe UI', 'Arial', 'sans-serif'],
});

/** Classes que declaram as variáveis `--font-*` dos templates (vão na raiz do cardápio). */
export const FONTES_TEMPLATES = `${bricolage.variable} ${dmSans.variable} ${rubik.variable} ${lexend.variable}`;
