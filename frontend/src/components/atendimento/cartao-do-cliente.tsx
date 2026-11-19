'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { NO_SERVIDOR_DA_LOJA } from '@/components/ui/so-pela-nuvem';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CARTÃO DO CLIENTE NO CASO (F6b do docs/plano-perfil-cliente.md; protótipo, aba "Atendimento"): o cartão curto ao lado
// da conversa — o de sempre, o jeito que o cliente pediu, os cuidados, as reclamações agrupadas, as avaliações e as
// etiquetas. Só com o módulo "Perfil do cliente" ligado (o servidor devolve `cartao: null` sem ele). No servidor da loja o
// perfil não existe: a tela diz onde ver, em vez de sumir calada (V37).

const ETIQUETA: Record<string, string> = {
  novo: 'Novo', campeao: 'Campeão', atrasado: 'Atrasado no ritmo', em_risco: 'Em risco', reclamou_recente: 'Reclamou recentemente',
  reclamou_repetido: 'Reclamou 2+ vezes do mesmo motivo', pede_agendado: 'Pede agendado', so_retira: 'Só retira', fim_de_semana: 'Pede no fim de semana',
};

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-border py-1.5 text-sm last:border-b-0 sm:grid-cols-[110px_minmax(0,1fr)] sm:gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export function CartaoDoCliente({ casoId }: { casoId: string }) {
  const [cartao, setCartao] = useState<any | null | undefined>(undefined);

  useEffect(() => {
    if (NO_SERVIDOR_DA_LOJA) return;
    let vivo = true;
    setCartao(undefined);
    api
      .perfilClienteCartaoDoCaso(casoId)
      .then((r: any) => vivo && setCartao(r?.cartao ?? null))
      .catch(() => vivo && setCartao(null));
    return () => {
      vivo = false;
    };
  }, [casoId]);

  if (NO_SERVIDOR_DA_LOJA) {
    return <p className="text-xs text-muted-foreground">O cartão do cliente aparece no Regem pela nuvem (o perfil do cliente fica lá).</p>;
  }
  if (!cartao) return null;

  return (
    <section className="rounded-lg border border-border bg-card p-3" aria-label="Cartão do cliente">
      <p className="mb-1 font-display text-sm font-semibold">Cartão do cliente</p>
      {cartao.deSempre && <Linha rotulo="De sempre">{cartao.deSempre}</Linha>}
      {cartao.jeito?.length > 0 && <Linha rotulo="Jeito">{cartao.jeito.join(' · ')}</Linha>}
      {cartao.time && <Linha rotulo="Time">{cartao.time}</Linha>}
      {cartao.cuidados?.length > 0 && <Linha rotulo="Cuidado">{cartao.cuidados.join(' · ')}</Linha>}
      {cartao.reclamacoes?.length > 0 && (
        <Linha rotulo="Reclamações">
          {cartao.reclamacoes.map((g: any) => (g.vezes >= 2 ? `reclamou ${g.vezes} vezes de ${g.nome}` : `1 vez de ${g.nome}`)).join(' · ')}{' '}
          <span className="text-xs text-muted-foreground">(90 dias)</span>
        </Linha>
      )}
      {cartao.avaliacoes && (
        <Linha rotulo="Avaliações">
          média {Number(cartao.avaliacoes.media ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ({cartao.avaliacoes.quantas})
          {cartao.avaliacoes.ultimas?.length ? ` · últimas: ${cartao.avaliacoes.ultimas.join(', ')}` : ''}
        </Linha>
      )}
      {cartao.etiquetas?.length > 0 && (
        <Linha rotulo="Etiquetas">
          <span className="flex flex-wrap gap-1">
            {cartao.etiquetas.map((e: string) => (
              <span key={e} className="rounded-full bg-warn/10 px-2 py-0.5 text-xs font-semibold text-warn">{ETIQUETA[e] ?? e}</span>
            ))}
          </span>
        </Linha>
      )}
      <p className="mt-1 text-xs text-muted-foreground">Use para atender melhor. Não comente com o cliente o que está aqui.</p>
    </section>
  );
}
