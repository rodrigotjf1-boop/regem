import type { Metadata, Viewport } from 'next';

// Tela de senhas (Cozinha em estações, entrega 4): a TV do balcão, sem login, fundo branco.
export const metadata: Metadata = {
  title: 'Senhas',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#FFFFFF',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // TV/quiosque: sem zoom acidental
};

export default function SenhasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
