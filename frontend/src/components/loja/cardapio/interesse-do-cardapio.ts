'use client';

import { useCallback, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { getClienteToken } from '@/components/loja/tipos';

// OS CLIQUES DO CARDÁPIO (F4 do docs/plano-perfil-cliente.md, §4.3; mig 466). O que a pessoa faz no cardápio, em lotes:
// produto aberto (com o tempo aberto — só aparecer na tela não conta), produto posto no carrinho e busca (o termo, depois
// de 1,5 s parada, e quantos itens achou). Só com o módulo "Perfil do cliente" ligado (`loja.interesse`). A sessão é a da
// visita (a mesma do funil). Vai junto o `clienteToken` de quem entrou — o SERVIDOR decide se liga ao cliente (só com as
// "Recomendações personalizadas" ligadas). Nunca atrapalha a tela: fila na memória, lote a cada 15 s, ao sair da página
// e a cada 25; erro ignorado.

type Evento = { tipo: 'produto_aberto' | 'produto_adicionado' | 'busca'; produtoId?: string; ms?: number; termo?: string; resultados?: number };

const LOTE = 25;
const INTERVALO_MS = 15_000;
const BUSCA_PARADA_MS = 1_500;

export function useInteresseDoCardapio(p: {
  token: string;
  sessao: string;
  ativo: boolean;
  topo: string | undefined;
  produtoAbertoId: string | null;
  busca: string;
  resultados: number;
}) {
  const { token, sessao, ativo } = p;
  const fila = useRef<Evento[]>([]);

  const enviar = useCallback(() => {
    if (!ativo || !fila.current.length) return;
    const eventos = fila.current.splice(0, LOTE);
    const clienteToken = getClienteToken(token) || undefined;
    void api.cardapioInteracoes(token, { sessao, clienteToken, eventos }).catch(() => {});
  }, [ativo, token, sessao]);

  const por = useCallback(
    (e: Evento) => {
      if (!ativo) return;
      fila.current.push(e);
      if (fila.current.length >= LOTE) enviar();
    },
    [ativo, enviar],
  );

  // O lote: de tempo em tempo, ao esconder a aba e ao sair da página.
  useEffect(() => {
    if (!ativo) return;
    const t = window.setInterval(enviar, INTERVALO_MS);
    const aoEsconder = () => {
      if (document.visibilityState === 'hidden') enviar();
    };
    document.addEventListener('visibilitychange', aoEsconder);
    window.addEventListener('pagehide', enviar);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', aoEsconder);
      window.removeEventListener('pagehide', enviar);
      enviar();
    };
  }, [ativo, enviar]);

  // Produto aberto: conta do momento em que a tela dele ficou por cima até sair (fechar, pôr no carrinho, trocar).
  const aberto = useRef<{ id: string; desde: number } | null>(null);
  useEffect(() => {
    const agora = Date.now();
    const atual = p.topo === 'produto' && p.produtoAbertoId ? p.produtoAbertoId : null;
    if (aberto.current && aberto.current.id !== atual) {
      por({ tipo: 'produto_aberto', produtoId: aberto.current.id, ms: agora - aberto.current.desde });
      aberto.current = null;
    }
    if (atual && !aberto.current) aberto.current = { id: atual, desde: agora };
  }, [p.topo, p.produtoAbertoId, por]);

  // Busca: o termo depois que a pessoa parou de digitar.
  useEffect(() => {
    const termo = p.busca.trim();
    if (termo.length < 2) return;
    const t = window.setTimeout(() => por({ tipo: 'busca', termo, resultados: p.resultados }), BUSCA_PARADA_MS);
    return () => window.clearTimeout(t);
  }, [p.busca, p.resultados, por]);

  const adicionado = useCallback((produtoId: string | null | undefined) => {
    if (produtoId) por({ tipo: 'produto_adicionado', produtoId });
  }, [por]);
  return { adicionado };
}
