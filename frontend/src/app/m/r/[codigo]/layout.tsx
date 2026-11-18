import type { Metadata, Viewport } from 'next';

// A página do link para encaminhar do Mister (M3c, mig 443): fora da busca, e sem mandar o endereço (que leva o código)
// a nenhum outro site — nem às fontes. Zoom liberado (acessibilidade).
export const metadata: Metadata = {
  title: 'Relatório do Regem',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  themeColor: '#0F2230',
  width: 'device-width',
  initialScale: 1,
};

export default function RelatorioDoLinkDoMisterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
