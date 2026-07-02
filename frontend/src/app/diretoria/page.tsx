'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getCategoria, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';

/* eslint-disable @typescript-eslint/no-explicit-any */
function statusConclusao(pct: number) {
  if (pct >= 85) return { label: 'Acima da meta', cor: 'var(--ok)' };
  if (pct >= 70) return { label: 'Atenção', cor: 'var(--warn)' };
  return { label: 'Plano de ação', cor: 'var(--destructive)' };
}

export default function DiretoriaPage() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [cat, setCat] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setRows(await api.get('/diretoria/multiunidade'));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    const c = getCategoria();
    setCat(c);
    if (c === 'presidente') carregar();
  }, [carregar]);

  return (
    <Shell eyebrow="Diretoria · acesso restrito" title="Visão C&O">
      {cat !== 'presidente' ? (
        <Card className="p-10 text-center">
          <p className="font-display text-lg font-semibold">Área restrita</p>
          <p className="mt-1 text-sm text-muted-foreground">
            A Visão C&amp;O é exclusiva da diretoria (presidente). Gerentes não
            visualizam estes relatórios.
          </p>
        </Card>
      ) : (
        <>
          {erro && <p className="mb-4 text-destructive">{erro}</p>}
          <Card className="p-0">
            <div className="border-b border-border px-5 py-3.5">
              <p className="font-display text-sm font-bold">
                Comparativo entre lojas
              </p>
              <p className="text-xs text-muted-foreground">
                Tarefas e desperdício no mês · escala e estoque agora
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    {['Loja', 'Conclusão (mês)', 'Escala hoje', 'Desperdício (mês)', 'Estoque crítico', 'Status'].map(
                      (h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-4 py-2.5 font-display text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows?.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                        Nenhuma unidade cadastrada.
                      </td>
                    </tr>
                  )}
                  {rows?.map((r) => {
                    const st = statusConclusao(r.tarefas.pct);
                    return (
                      <tr key={r.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 font-semibold">{r.nome}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="inline-block h-1.5 w-20 overflow-hidden rounded bg-secondary">
                              <span
                                className="block h-full rounded"
                                style={{ width: `${r.tarefas.pct}%`, background: `hsl(${st.cor})` }}
                              />
                            </span>
                            <span className="font-mono text-xs">{r.tarefas.pct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          {r.escala.preenchidas}/{r.escala.vagas}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{r.desperdicio.total}</td>
                        <td className="px-4 py-3">
                          <span
                            className="rounded-md px-2 py-0.5 font-mono text-xs font-bold"
                            style={{
                              background: r.estoqueAbaixoMinimo > 0 ? 'hsl(var(--destructive)/.12)' : 'hsl(var(--ok)/.15)',
                              color: r.estoqueAbaixoMinimo > 0 ? 'hsl(var(--destructive))' : 'hsl(var(--ok))',
                            }}
                          >
                            {r.estoqueAbaixoMinimo}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                            style={{ background: `hsl(${st.cor}/.15)`, color: `hsl(${st.cor})` }}
                          >
                            {st.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="mt-3 text-xs text-muted-foreground">
            Faturamento e CMV consolidados entram quando o módulo de Vendas &amp;
            Comandas estiver ativo.
          </p>
        </>
      )}
    </Shell>
  );
}
