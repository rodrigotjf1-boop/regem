'use client';

import { useEffect, useState } from 'react';
import { api, getCategoria, getUnidadeAtual } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// DE QUAL LOJA SÃO OS NÚMEROS (decisão do dono, 08/10/2026): todo relatório é da LOJA EM USO;
// quem vê a rede (presidente), em empresa com mais de uma loja, pode pedir o TOTAL das lojas.
// A regra é do servidor (`@UnidadeAtual()`): quem é de uma loja recebe sempre a dele, com ou sem
// este pedido. Aqui só se decide se a opção aparece e o que a tela escreve.

export type EscopoDeLoja = {
  /** A opção "Somar todas as lojas" existe para este usuário. */
  podeTotal: boolean;
  /** Está pedindo o total (sempre falso para quem não pode). */
  total: boolean;
  mudarTotal: (v: boolean) => void;
  /** O que a tela escreve: "loja Matriz", "todas as lojas somadas". */
  texto: string;
  /** Para passar direto à barra do período; indefinido quando a opção não existe. */
  opcao: { ligado: boolean; aoMudar: (v: boolean) => void } | undefined;
};

export function useEscopoDeLoja(): EscopoDeLoja {
  const [lojas, setLojas] = useState<{ varias: boolean; nome: string }>({ varias: false, nome: '' });
  const [total, setTotal] = useState(false);

  useEffect(() => {
    // Só o presidente enxerga mais de uma loja: para os outros não há o que perguntar ao servidor.
    if (getCategoria() !== 'presidente') return;
    let vivo = true;
    api
      .unidades()
      .then((u: any) => {
        if (!vivo) return;
        const lista: any[] = Array.isArray(u) ? u : [];
        const atual = getUnidadeAtual();
        setLojas({ varias: lista.length >= 2, nome: lista.find((x) => x.id === atual)?.nome ?? '' });
      })
      .catch(() => undefined); // sem a lista, a opção não aparece — o relatório segue na loja em uso
    return () => {
      vivo = false;
    };
  }, []);

  const somando = lojas.varias && total;
  return {
    podeTotal: lojas.varias,
    total: somando,
    mudarTotal: setTotal,
    texto: somando ? 'todas as lojas somadas' : lojas.nome ? `loja ${lojas.nome}` : 'loja em uso',
    opcao: lojas.varias ? { ligado: somando, aoMudar: setTotal } : undefined,
  };
}
