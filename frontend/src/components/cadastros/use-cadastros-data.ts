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
      const [
        unidades,
        setores,
        funcoes,
        colaboradores,
        turnos,
        etiquetas,
        janelasPico,
        fornecedores,
      ] = await Promise.all([
        api.get('/unidades'),
        api.get('/setores'),
        api.get('/funcoes'),
        api.get('/colaboradores'),
        api.get('/turnos'),
        api.get('/etiquetas'),
        api.janelasPico(),
        api.fornecedores(),
      ]);
      setL({
        unidades,
        setores,
        funcoes,
        colaboradores,
        turnos,
        etiquetas,
        janelasPico,
        fornecedores,
      });
      setVer((v) => v + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  return { L, erro, ver, reload };
}
