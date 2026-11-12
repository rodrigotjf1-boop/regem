'use client';

import { useCallback, useEffect, useState } from 'react';

// A CAIXINHA de cada item do cartão do KDS (padrão da foto do dono, 12/11/2026): quem prepara marca o que já fez. É ajuda
// DESTA tela — não muda o pedido, não vai ao servidor nem às outras telas. Fica na sessão do navegador (sessionStorage)
// só para não sumir num recarregar; a leitura acontece depois do primeiro desenho (o servidor não conhece a sessão — V35).

const CHAVE = (pedidoId: string) => `regem.kds.marcados.${pedidoId}`;

function ler(pedidoId: string): Set<string> {
  try {
    const bruto = sessionStorage.getItem(CHAVE(pedidoId));
    const lista = bruto ? JSON.parse(bruto) : [];
    return new Set(Array.isArray(lista) ? lista.map(String) : []);
  } catch {
    return new Set();
  }
}

function gravar(pedidoId: string, marcados: Set<string>) {
  try {
    if (marcados.size === 0) sessionStorage.removeItem(CHAVE(pedidoId));
    else sessionStorage.setItem(CHAVE(pedidoId), JSON.stringify([...marcados]));
  } catch {
    /* sessão cheia ou bloqueada: a marca vale só enquanto a tela está aberta */
  }
}

export function useMarcadosDoCartao(pedidoId: string) {
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setMarcados(ler(pedidoId));
  }, [pedidoId]);

  const alternar = useCallback(
    (chave: string) => {
      setMarcados((antes) => {
        const novo = new Set(antes);
        if (novo.has(chave)) novo.delete(chave);
        else novo.add(chave);
        gravar(pedidoId, novo);
        return novo;
      });
    },
    [pedidoId],
  );

  return { marcados, alternar };
}
