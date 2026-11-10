'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { EstadoDasPausas } from '@/lib/pausa-dos-pedidos';

/**
 * As pausas do painel (mig 392): lê ao abrir e a cada 15 s (como os pedidos), e recebe a resposta de pausar/reabrir.
 * Só a leitura mais NOVA vale (V64): uma leitura que saiu antes de pausar e volta depois não desfaz a faixa na tela.
 * `erro` separa "não li" de "nada pausado" (V37).
 */
export function usePausas(ativo: boolean) {
  const [estado, setEstado] = useState<EstadoDasPausas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const vez = useRef(0);

  const recarregar = useCallback(async () => {
    const minha = ++vez.current;
    try {
      const e = (await api.deliveryPausas()) as EstadoDasPausas;
      if (minha === vez.current) {
        setEstado(e);
        setErro(null);
      }
    } catch (e) {
      if (minha === vez.current) setErro(e instanceof Error ? e.message : 'Não deu para ler as pausas.');
    }
  }, []);

  /** A resposta de pausar ou reabrir: é a mais nova — as leituras que ainda estão voltando são descartadas. */
  const receber = useCallback((e: EstadoDasPausas) => {
    vez.current += 1;
    setEstado(e);
    setErro(null);
  }, []);

  useEffect(() => {
    if (!ativo) return;
    recarregar();
    const t = setInterval(recarregar, 15000);
    return () => clearInterval(t);
  }, [ativo, recarregar]);

  return { estado, erro, recarregar, receber };
}
