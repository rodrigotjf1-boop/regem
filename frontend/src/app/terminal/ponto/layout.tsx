import type { Metadata, Viewport } from 'next';
import { RegisterSW } from '@/components/pwa/register-sw';

export const metadata: Metadata = {
  title: 'Regem Ponto',
  manifest: '/ponto.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Regem Ponto',
  },
};

export const viewport: Viewport = {
  themeColor: '#0F2230',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // quiosque: sem zoom acidental
};

export default function PontoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <RegisterSW />
    </>
  );
}
