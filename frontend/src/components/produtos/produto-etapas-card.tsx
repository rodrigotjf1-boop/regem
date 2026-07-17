'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';

/* eslint-disable @typescript-eslint/no-explicit-any */

const REGRA_LABEL: Record<string, string> = {
  uma: 'Escolhe 1',
  varias_sem_repeticao: 'Vários (sem repetição)',
  varias_com_repeticao: 'Vários (com repetição)',
};

// Etapas do produto (Fase 4): anexa complementos reutilizáveis ao produto. Ao salvar,
// o backend materializa nos grupos/opções do motor (cardápio/comanda/KDS).
export function ProdutoEtapasCard({ produtoId }: { produtoId: string }) {
  const [complementos, setComplementos] = useState<any[]>([]);
  const [ligados, setLigados] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const [todos, atuais] = await Promise.all([
      api.complementosCatalogo().catch(() => []),
      api.produtoEtapas(produtoId).catch(() => []),
    ]);
    setComplementos(todos as any[]);
    setLigados(((atuais as any[]) ?? []).sort((a, b) => a.ordem - b.ordem).map((x: any) => x.complementoId));
  }, [produtoId]);
  useEffect(() => { carregar(); }, [carregar]);

  async function toggle(id: string) {
    const novo = ligados.includes(id) ? ligados.filter((x) => x !== id) : [...ligados, id];
    setLigados(novo);
    setSalvando(true);
    try {
      await api.setProdutoEtapas(produtoId, novo);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar etapas');
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-display text-sm font-bold">Etapas do produto (complementos)</h2>
        {salvando && <span className="text-xs text-muted-foreground">salvando…</span>}
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">Marque os complementos reutilizáveis que este produto usa. Eles viram etapas no cardápio e no PDV.</p>
      {complementos.length === 0 ? (
        <p className="text-sm text-muted-foreground">Cadastre complementos na seção “Complementos (etapas)” primeiro.</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {complementos.map((c) => {
            const on = ligados.includes(c.id);
            return (
              <li key={c.id}>
                <label className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${on ? 'border-primary bg-primary/5' : 'border-border'}`}>
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={on} onChange={() => toggle(c.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.nome}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{REGRA_LABEL[c.regra] ?? c.regra}{c.obrigatorio ? ' · obrigatório' : ''} · {(c.itens ?? []).length} opção(ões)</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
