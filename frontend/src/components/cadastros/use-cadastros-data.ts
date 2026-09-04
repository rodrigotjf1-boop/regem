'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import type { Lists } from '@/components/cadastros/constants';

// Camada de dados de Cadastros: carrega todas as listas em paralelo. `ver`
// incrementa a cada reload (usado como key para resetar os EntityForm).
export function useCadastrosData() {
  const [L, setL] = useState<Lists | null>(null);
  const [erro, setErro] = useState('');
  const [ver, setVer] = useState(0);

  const reload = useCallback(async () => {
    try {
      // allSettled (não all): um 403 numa lista (ex.: perfil sem `unidades`/`turnos`,
      // ou a sessão de SUPORTE, que não vê tudo) NÃO pode derrubar o hub inteiro —
      // cada seção falha isolada e some, em vez de "Não foi possível carregar" na tela
      // toda. Só erra de fato se TUDO falhar (rede/sessão inválida).
      const rs = await Promise.allSettled([
        api.get('/unidades'),
        api.get('/setores'),
        api.get('/funcoes'),
        api.get('/colaboradores'),
        api.get('/turnos'),
        api.get('/etiquetas'),
        api.janelasPico(),
        api.fornecedores(),
        api.diasEspeciais(),
      ]);
      if (rs.every((r) => r.status === 'rejected')) {
        const e = (rs[0] as PromiseRejectedResult).reason;
        setErro(e instanceof Error ? e.message : 'Erro ao carregar');
        return;
      }
      const val = (i: number): any =>
        rs[i].status === 'fulfilled' ? (rs[i] as PromiseFulfilledResult<any>).value : [];
      setL({
        unidades: val(0),
        setores: val(1),
        funcoes: val(2),
        colaboradores: val(3),
        turnos: val(4),
        etiquetas: val(5),
        janelasPico: val(6),
        fornecedores: val(7),
        diasEspeciais: val(8),
      });
      setErro('');
      setVer((v) => v + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  return { L, erro, ver, reload };
}
