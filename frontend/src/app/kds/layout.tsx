import type { Metadata, Viewport } from 'next';
import { RegisterSW } from '@/components/pwa/register-sw';

export const metadata: Metadata = {
  title: 'Regem KDS',
  manifest: '/kds.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Regem KDS',
  },
};

export const viewport: Viewport = {
  themeColor: '#0B141B',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // quiosque: sem zoom acidental
};

export default function KdsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <RegisterSW />
    </>
  );
}
