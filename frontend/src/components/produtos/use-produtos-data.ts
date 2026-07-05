'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Camada de dados da tela de Produtos: carrega catálogo, categorias, fichas,
// setores e equipamentos (KDS/impressora). `reload` recarrega tudo.
export function useProdutosData() {
  const [produtos, setProdutos] = useState<any[] | null>(null);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [fichas, setFichas] = useState<any[]>([]);
  const [setores, setSetores] = useState<any[]>([]);
  const [equipamentos, setEquipamentos] = useState<any[]>([]);
  const [erro, setErro] = useState('');

  const reload = useCallback(async () => {
    setErro('');
    try {
      const [ps, cs, fs, ss, eq] = await Promise.all([
        api.produtos(),
        api.produtoCategorias(),
        api.fichasLista(),
        api.setores(),
        api.equipamentos().catch(() => []),
      ]);
      setProdutos(ps);
      setCategorias(cs);
      setFichas(fs);
      setSetores(ss);
      setEquipamentos(
        (eq as any[]).filter((e) => e.tipo === 'kds' || e.tipo === 'impressora'),
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  return {
    produtos,
    categorias,
    fichas,
    setores,
    equipamentos,
    erro,
    setErro,
    reload,
  };
}
