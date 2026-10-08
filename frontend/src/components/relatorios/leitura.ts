'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';

// LEITURA POR PARTE — cada bloco de um relatório lê, espera e falha sozinho: o que veio aparece;
// o que não veio diz que não veio, com "Tentar de novo". Falha nunca vira "sem vendas".

export type Leitura<T> = {
  /** O que o servidor devolveu para o período atual (nulo enquanto não chega). */
  dados: T | null;
  /** Motivo da falha ('' = sem falha). */
  erro: string;
  /** O servidor recusou por permissão (403): não é falha, é "sem acesso". */
  semAcesso: boolean;
  carregando: boolean;
  recarregar: () => void;
};

/** A tela acompanha as leituras para dizer "carregando…" e "atualizado às". */
export type Acompanhar = { comecou: () => void; terminou: (deuCerto: boolean) => void };

type Estado<T> = { chave: string; dados: T | null; erro: string; semAcesso: boolean; carregando: boolean };

/**
 * `chave` identifica o que está sendo pedido (o período): mudou, lê de novo e esquece o anterior.
 * `ligada` = false espera (a aba ainda não foi aberta). `versao` muda quando se pede "Atualizar":
 * lê de novo mantendo na tela o que já havia.
 */
export function useLeitura<T>(buscar: () => Promise<T>, chave: string, ligada = true, versao = 0, acompanhar?: Acompanhar): Leitura<T> {
  const [estado, setEstado] = useState<Estado<T>>({ chave: '', dados: null, erro: '', semAcesso: false, carregando: false });
  const fn = useRef(buscar);
  fn.current = buscar;
  const quem = useRef(acompanhar);
  quem.current = acompanhar;
  const vez = useRef(0);
  const lida = useRef({ chave: '', versao: -1 });

  const ler = useCallback(async (k: string) => {
    const minha = ++vez.current;
    setEstado((a) => ({ chave: k, dados: a.chave === k ? a.dados : null, erro: '', semAcesso: false, carregando: true }));
    quem.current?.comecou();
    try {
      const dados = await fn.current();
      quem.current?.terminou(true);
      if (minha === vez.current) setEstado({ chave: k, dados, erro: '', semAcesso: false, carregando: false });
    } catch (e) {
      quem.current?.terminou(false);
      if (minha !== vez.current) return;
      const semAcesso = e instanceof ApiError && e.status === 403;
      setEstado({ chave: k, dados: null, semAcesso, carregando: false, erro: semAcesso ? '' : e instanceof Error && e.message ? e.message : 'Tente de novo em instantes.' });
    }
  }, []);

  useEffect(() => {
    if (!ligada || !chave) return;
    if (lida.current.chave === chave && lida.current.versao === versao) return;
    lida.current = { chave, versao };
    void ler(chave);
  }, [ligada, chave, versao, ler]);

  const atual = estado.chave === chave;
  return {
    dados: atual ? estado.dados : null,
    erro: atual ? estado.erro : '',
    semAcesso: atual && estado.semAcesso,
    carregando: atual && estado.carregando,
    recarregar: () => { if (chave) void ler(chave); },
  };
}
