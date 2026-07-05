import type { Metadata, Viewport } from 'next';
import { Figtree, Archivo, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';

// Fontes self-hosted via next/font (sem @import bloqueante). Cada uma liga na
// variável CSS que o tailwind.config já consome (--font-sans/display/mono).
const figtree = Figtree({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});
const archivo = Archivo({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
  fallback: ['system-ui', 'sans-serif'],
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
  fallback: ['ui-monospace', 'monospace'],
});

export const metadata: Metadata = {
  title: 'Regem',
  description: 'No comando de todo o negócio — do balcão ao balanço.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // conteúdo respeita safe-areas (notch/gestos) no Android/iOS
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0D1A2B' }, // navy (login/KDS/terminal)
    { media: '(prefers-color-scheme: light)', color: '#EDF0F4' }, // base clara do app
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="pt-BR"
      className={`${figtree.variable} ${archivo.variable} ${jetbrainsMono.variable}`}
    >
      <body className="font-sans antialiased min-h-dvh bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
