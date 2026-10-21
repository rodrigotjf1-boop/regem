import type { Metadata } from 'next';
import { AutorizarCliqueTela } from '@/components/integracoes/autorizar-clique-tela';
import { AutorizarTela } from '@/components/integracoes/autorizar-tela';

// Página "Autorizar o <aplicativo>" (trilha C, C1b): o aplicativo (o Liame) manda a pessoa para cá
// com o pedido na URL; o presidente escolhe as lojas e o que libera, e volta para o aplicativo.
// Fora do menu, só na nuvem.
//
// Hub DMS (F3, parte C): o link com `request_uri` é o da autorização POR CLIQUE (o pedido que o
// aplicativo empurrou, com a senha e uma ligação por loja); sem ele, segue a página de 01/10.
export const metadata: Metadata = { title: 'Autorizar aplicativo · Regem', robots: { index: false, follow: false } };

export default function AutorizarPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return searchParams.request_uri ? <AutorizarCliqueTela /> : <AutorizarTela />;
}
