'use client';

import { useParams } from 'next/navigation';
import { RelatorioPeloLink } from '@/components/mister/publico/relatorio-pelo-link';

// A página que o link para encaminhar do Mister abre (M3c, mig 443): o relatório que o presidente pediu, para quem não
// tem usuário no Regem. Sem login, sem o Shell e sem guardar nada no aparelho.
export default function RelatorioDoLinkDoMisterPage() {
  const params = useParams();
  return <RelatorioPeloLink codigo={String(params?.codigo ?? '')} />;
}
