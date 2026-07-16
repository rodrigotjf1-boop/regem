'use client';

import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import { api, getUnidadeAtual, setUnidadeAtual, getCategoria } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Seletor global de unidade no topbar. EXCLUSIVO do presidente/C&O — a visão da
// rede (alternar entre lojas) não é acessível aos demais perfis, que ficam
// restritos à própria unidade pelo servidor. Aparece com 2+ lojas na rede.
// NÃO há opção "todas as lojas": o padrão é a MATRIZ e o presidente escolhe a
// matriz ou uma filial específica (a consolidação da rede vive na Visão C&O).
// Ao trocar, recarrega a visão para todas as telas re-consultarem com a unidade.
export function UnidadeSeletor() {
  const [unidades, setUnidades] = useState<any[]>([]);
  const [sel, setSel] = useState('');
  const [pres, setPres] = useState(false);

  useEffect(() => {
    const p = getCategoria() === 'presidente';
    setPres(p);
    if (!p) return; // só presidente/C&O enxerga outras lojas
    api
      .unidades()
      .then((u: any) => {
        const list = Array.isArray(u) ? u : [];
        setUnidades(list);
        // Padrão = matriz (ou a 1ª unidade). Se nada foi escolhido ainda — ou o
        // que estava salvo é o antigo "todas" (null) —, fixa a matriz e recarrega
        // uma vez para as telas já consultarem com a unidade certa.
        const atual = getUnidadeAtual();
        const matriz = list.find((x: any) => x.tipo === 'matriz') ?? list[0];
        if (atual && list.some((x: any) => x.id === atual)) {
          setSel(atual);
        } else if (matriz) {
          setUnidadeAtual(matriz.id);
          window.location.reload();
        }
      })
      .catch(() => {});
  }, []);

  if (!pres || unidades.length < 2) return null;

  function trocar(v: string) {
    setSel(v);
    setUnidadeAtual(v);
    window.location.reload();
  }

  return (
    <label className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-2 text-xs">
      <Building2 className="h-3.5 w-3.5 text-primary" />
      <span className="sr-only">Unidade atual</span>
      <select
        value={sel}
        onChange={(e) => trocar(e.target.value)}
        className="max-w-[130px] bg-transparent font-medium outline-none"
        aria-label="Selecionar unidade"
      >
        {unidades.map((u) => (
          <option key={u.id} value={u.id}>
            {u.nome}
          </option>
        ))}
      </select>
    </label>
  );
}
