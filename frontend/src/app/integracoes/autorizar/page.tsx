import type { Metadata } from 'next';
import { AutorizarTela } from '@/components/integracoes/autorizar-tela';

// Página "Autorizar o <aplicativo>" (trilha C, C1b): o aplicativo (o Liame) manda a pessoa para cá
// com o pedido na URL; o presidente escolhe as lojas e o que libera, e volta para o aplicativo.
// Fora do menu, só na nuvem.
export const metadata: Metadata = { title: 'Autorizar aplicativo · Regem', robots: { index: false, follow: false } };

export default function AutorizarPage() {
  return <AutorizarTela />;
}
