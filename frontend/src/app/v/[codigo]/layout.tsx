import type { Metadata, Viewport } from 'next';

// Página pública de vagas: fora da busca (é da loja, chega por QR e link) e com zoom liberado (acessibilidade).
export const metadata: Metadata = {
  title: 'Vagas',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#FBF6EE',
  width: 'device-width',
  initialScale: 1,
};

export default function VagasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
