'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { CardapioTemplates } from '@/components/loja/cardapio/cardapio-templates';
import { ehTemplate } from '@/components/loja/cardapio/tipos-template';

// Cardápio público da loja. Toda a regra mora em `useCardapio` e a tela é a do template que a loja
// escolheu em Delivery → Configurações (Galeria, Balcão, Oferta ou Regem Fluxo; loja que ainda
// tinha um layout antigo gravado abre no Regem Fluxo). `?tema=` mostra outro template sem mudar a
// escolha da loja — é a prévia que o painel abre.
export default function CardapioPublicoPage() {
  const params = useParams();
  const search = useSearchParams();
  const tema = search?.get('tema');
  return (
    <CardapioTemplates
      token={String(params?.token ?? '')}
      mesa={search?.get('mesa') ?? ''}
      search={search}
      temaForcado={ehTemplate(tema) ? tema : null}
    />
  );
}
