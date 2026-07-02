import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Regem',
  description: 'No comando de todo o negócio — do balcão ao balanço.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="font-sans antialiased min-h-dvh bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
