import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import TelemetriaCliente from '@/components/telemetria-cliente';

// Fontes VENDORIZADAS (next/font/local, arquivos em src/fonts) — os .woff2 variáveis
// vêm do npm (@fontsource-variable), NÃO do Google no build. Antes usávamos
// next/font/google, que BAIXA as fontes de fonts.gstatic.com durante o `next build`;
// quando esse download estola (rede/firewall/rate-limit do Google), o build PENDURA em
// "Creating an optimized production build" a 0% de CPU. Local = build offline, nunca
// trava. Cada uma liga na variável CSS que o tailwind já consome (--font-sans/display/mono).
const figtree = localFont({
  src: '../fonts/figtree-var.woff2',
  weight: '300 900',
  display: 'swap',
  variable: '--font-sans',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});
const archivo = localFont({
  src: '../fonts/archivo-var.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-display',
  fallback: ['system-ui', 'sans-serif'],
});
const jetbrainsMono = localFont({
  src: '../fonts/jetbrains-mono-var.woff2',
  weight: '100 800',
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
        <TelemetriaCliente />
        <Toaster />
      </body>
    </html>
  );
}
