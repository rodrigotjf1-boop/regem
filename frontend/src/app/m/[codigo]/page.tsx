'use client';

import { useParams } from 'next/navigation';
import { AutorizarPeloLink } from '@/components/mister/publico/autorizar-pelo-link';

// A página que o link do Mister abre (F4.2a, mig 433; protótipo `mockups/regem-mister-pin.html`): a proposta e o PIN de
// quem recebeu. Sem login, sem o Shell e sem guardar nada no aparelho.
export default function LinkDoMisterPage() {
  const params = useParams();
  return <AutorizarPeloLink codigo={String(params?.codigo ?? '')} />;
}
