'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getCategoria, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function statusConclusao(pct: number) {
  if (pct >= 85) return { label: 'Acima da meta', cor: 'var(--ok)' };
  if (pct >= 70) return { label: 'Atenção', cor: 'var(--warn)' };
  return { label: 'Plano de ação', cor: 'var(--destructive)' };
}

function baixarCsv(nome: string, linhas: Record<string, any>[]) {
  if (!linhas.length) return;
  const cols = Object.keys(linhas[0]);
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(';'), ...linhas.map((l) => cols.map((c) => esc(l[c])).join(';'))].join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nome}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors ${on ? 'bg-primary' : 'bg-secondary'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-card shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

export default function DiretoriaPage() {
  const [data, setData] = useState<any>(null);
  const [mod, setMod] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [cat, setCat] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([api.get('/diretoria/multiunidade'), api.get('/modulos')]);
      setData(d);
      setMod(m);
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

  async function toggleModulo(unidadeId: string | null, modulo: string, ativo: boolean) {
    try {
      await api.post('/modulos', { unidadeId, modulo, ativo });
      setMod((m: any) => {
        const n = { ...m, rede: { ...m.rede }, porUnidade: { ...m.porUnidade } };
        if (unidadeId) {
          n.porUnidade[unidadeId] = { ...(n.porUnidade[unidadeId] ?? {}), [modulo]: ativo };
        } else {
          n.rede[modulo] = ativo;
        }
        return n;
      });
      toast.success(ativo ? 'Módulo ativado.' : 'Módulo desativado.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao alterar módulo');
      carregar();
    }
  }

  if (cat && cat !== 'presidente') {
    return (
      <Shell eyebrow="Diretoria · acesso restrito" title="Visão C&O">
        <Card className="p-10 text-center">
          <p className="font-display text-lg font-semibold">Área restrita</p>
          <p className="mt-1 text-sm text-muted-foreground">
            A Visão C&amp;O é exclusiva da diretoria (presidente/C&amp;O). Gerentes não visualizam estes relatórios.
          </p>
        </Card>
      </Shell>
    );
  }

  const unidades: any[] = data?.unidades ?? [];
  const rede = data?.rede;

  return (
    <Shell eyebrow="Diretoria · acesso restrito" title="Visão C&O">
      <div className="space-y-5">
        <p className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
          🔒 Área restrita — Presidente / C&O · gerentes não visualizam
        </p>
        {erro && <p className="text-destructive">{erro}</p>}

        {/* KPIs consolidados da rede */}
        {rede && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { l: 'Faturamento rede (mês)', v: brl(rede.faturamento), sub: `${rede.vendas} venda(s)`, cor: 'var(--ok)' },
              { l: 'Desperdícios (mês)', v: rede.desperdicios, sub: 'registros na rede', cor: 'var(--destructive)' },
              { l: 'Conclusão média', v: `${rede.conclusaoMedia}%`, sub: 'tarefas do mês', cor: 'var(--info)' },
              { l: 'Estoque crítico', v: rede.estoqueCritico, sub: `${rede.lojas} loja(s)`, cor: 'var(--warn)' },
            ].map((k) => (
              <Card key={k.l} className="relative overflow-hidden p-4">
                <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: `hsl(${k.cor})` }} />
                <p className="font-display text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">{k.l}</p>
                <p className="mt-1 font-mono text-xl font-bold tabular-nums">{k.v}</p>
                <p className="text-xs text-muted-foreground">{k.sub}</p>
              </Card>
            ))}
          </div>
        )}

        {/* Comparativo entre lojas */}
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
            <div>
              <p className="font-display text-sm font-bold">Comparativo entre lojas — mês</p>
              <p className="text-xs text-muted-foreground">Faturamento, conclusão de tarefas, escala e estoque</p>
            </div>
            {unidades.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  baixarCsv(
                    'comparativo-lojas',
                    unidades.map((u) => ({
                      loja: u.nome,
                      faturamento: u.faturamento,
                      vendas: u.vendas,
                      conclusaoPct: u.tarefas.pct,
                      escala: `${u.escala.preenchidas}/${u.escala.vagas}`,
                      desperdicios: u.desperdicio.total,
                      estoqueCritico: u.estoqueAbaixoMinimo,
                    })),
                  )
                }
              >
                Exportar CSV
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Comparativo entre lojas</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  {['Loja', 'Faturamento', 'Conclusão (mês)', 'Escala hoje', 'Desperdício', 'Estoque crítico', 'Status'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 font-display text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unidades.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Nenhuma unidade cadastrada.</td></tr>
                )}
                {unidades.map((r) => {
                  const st = statusConclusao(r.tarefas.pct);
                  return (
                    <tr key={r.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-semibold">{r.nome}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{brl(r.faturamento)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-1.5 w-20 overflow-hidden rounded bg-secondary">
                            <span className="block h-full rounded" style={{ width: `${r.tarefas.pct}%`, background: `hsl(${st.cor})` }} />
                          </span>
                          <span className="font-mono text-xs">{r.tarefas.pct}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{r.escala.preenchidas}/{r.escala.vagas}</td>
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
                        <span className="rounded-md px-2 py-0.5 text-[11px] font-bold" style={{ background: `hsl(${st.cor}/.15)`, color: `hsl(${st.cor})` }}>
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

        {/* Módulos do produto */}
        {mod && (
          <Card className="p-0">
            <div className="border-b border-border px-5 py-3.5">
              <p className="font-display text-sm font-bold">Módulos do produto</p>
              <p className="text-xs text-muted-foreground">
                Ligar/desligar por rede (padrão) ou por loja (exceção). Desativar corta o acesso na hora.
              </p>
            </div>

            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {mod.modulos.map((m: any) => (
                <div key={m.chave} className="flex items-center gap-3 rounded-lg border border-border px-3.5 py-3">
                  <span className="text-lg">{m.emoji}</span>
                  <span className="min-w-0 flex-1 text-sm font-medium">{m.label}</span>
                  <Toggle
                    label={`${m.label} na rede`}
                    on={mod.rede[m.chave] !== false}
                    onChange={(v) => toggleModulo(null, m.chave, v)}
                  />
                </div>
              ))}
            </div>

            {mod.unidades.length > 1 && (
              <div className="border-t border-border p-4">
                <p className="mb-2 font-display text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Exceções por loja
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Módulos por loja</caption>
                    <thead>
                      <tr className="text-left">
                        <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Loja</th>
                        {mod.modulos.map((m: any) => (
                          <th key={m.chave} className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground" title={m.label}>
                            {m.emoji}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mod.unidades.map((u: any) => (
                        <tr key={u.id} className="border-t border-border/60">
                          <td className="px-3 py-2 font-medium">{u.nome}</td>
                          {mod.modulos.map((m: any) => {
                            const efetivo = mod.porUnidade?.[u.id]?.[m.chave] ?? (mod.rede[m.chave] !== false);
                            return (
                              <td key={m.chave} className="px-3 py-2 text-center">
                                <div className="inline-flex">
                                  <Toggle
                                    label={`${m.label} em ${u.nome}`}
                                    on={efetivo}
                                    onChange={(v) => toggleModulo(u.id, m.chave, v)}
                                  />
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </Shell>
  );
}
