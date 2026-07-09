'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hoje = () => new Date().toISOString().slice(0, 10);
const diasAtras = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// Exporta linhas (array de objetos) como CSV e dispara o download.
function baixarCsv(nome: string, linhas: Record<string, any>[]) {
  if (!linhas.length) return;
  const cols = Object.keys(linhas[0]);
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [
    cols.join(';'),
    ...linhas.map((l) => cols.map((c) => esc(l[c])).join(';')),
  ].join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nome}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
const CLASSE: Record<string, string> = {
  A: 'bg-ok/15 text-ok',
  B: 'bg-warn/15 text-warn',
  C: 'bg-secondary text-muted-foreground',
};

function Barra({ label, valor, max, right }: { label: string; valor: number; max: number; right: string }) {
  const pct = max > 0 ? Math.max(2, (valor / max) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="capitalize">{label}</span>
        <span className="font-mono text-muted-foreground">{right}</span>
      </div>
      <div className="h-2 rounded-full bg-secondary">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function RelatoriosPage() {
  const router = useRouter();
  const isGestor = ['presidente', 'gerente', 'supervisao'].includes(getCategoria() ?? '');
  const [inicio, setInicio] = useState(diasAtras(29));
  const [fim, setFim] = useState(hoje());
  const [vendas, setVendas] = useState<any>(null);
  const [produtos, setProdutos] = useState<any>(null);
  const [atendentes, setAtendentes] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [aba, setAba] = useState<'vendas' | 'financeiro'>('vendas');
  const [ano, setAno] = useState(new Date().getFullYear());
  const [fatAnual, setFatAnual] = useState<any>(null);
  const [fatDelivery, setFatDelivery] = useState<any>(null);

  const reload = useCallback(async () => {
    setErro('');
    try {
      const [v, p, a] = await Promise.all([
        api.relatorioVendas(inicio, fim),
        api.relatorioProdutos(inicio, fim),
        api.relatorioAtendentes(inicio, fim),
      ]);
      setVendas(v);
      setProdutos(p);
      setAtendentes(a);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [inicio, fim]);

  const reloadFin = useCallback(async () => {
    setErro('');
    try {
      const [fa, fd] = await Promise.all([
        api.relatorioFaturamento(ano),
        api.relatorioFaturamentoDelivery(inicio, fim),
      ]);
      setFatAnual(fa);
      setFatDelivery(fd);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [ano, inicio, fim]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  useEffect(() => {
    if (aba === 'financeiro' && getToken()) reloadFin();
  }, [aba, reloadFin]);

  if (!isGestor) {
    return (
      <Shell eyebrow="Relatórios" title="Relatórios de venda">
        <p className="text-sm text-muted-foreground">Acesso restrito à gestão.</p>
      </Shell>
    );
  }

  const maxForma = Math.max(1, ...(vendas?.porForma ?? []).map((x: any) => x.total));
  const maxCanal = Math.max(1, ...(vendas?.porCanal ?? []).map((x: any) => x.total));
  const maxHora = Math.max(1, ...(vendas?.porHora ?? []).map((x: any) => x.qtd));

  return (
    <Shell eyebrow="Gestão · relatórios" title="Relatórios de venda">
      <div className="max-w-4xl space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}

        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label className="text-xs">De</Label>
            <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Até</Label>
            <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="w-40" />
          </div>
          <Button type="button" onClick={aba === 'financeiro' ? reloadFin : reload}>
            Atualizar
          </Button>
        </Card>

        {/* Abas por módulo */}
        <div className="flex flex-wrap gap-2">
          {[
            { v: 'vendas', l: 'Vendas' },
            { v: 'financeiro', l: 'Financeiro' },
          ].map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setAba(t.v as any)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                aba === t.v
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.l}
            </button>
          ))}
        </div>

        {aba === 'vendas' && (
        <>
        {/* KPIs */}
        {vendas && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { l: 'Faturado', v: brl(vendas.resumo.faturado) },
              { l: 'Vendas', v: vendas.resumo.vendas },
              { l: 'Ticket médio', v: brl(vendas.resumo.ticketMedio) },
              { l: 'Canceladas', v: vendas.resumo.canceladas },
            ].map((k) => (
              <Card key={k.l} className="p-4">
                <p className="text-xs text-muted-foreground">{k.l}</p>
                <p className="mt-1 font-mono text-xl font-bold">{k.v}</p>
              </Card>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Por forma */}
          <Card className="space-y-3 p-4">
            <h2 className="font-display text-sm font-bold">Por forma de pagamento</h2>
            {(vendas?.porForma ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sem vendas.</p>}
            {(vendas?.porForma ?? []).map((x: any) => (
              <Barra key={x.forma} label={x.forma} valor={x.total} max={maxForma} right={`${brl(x.total)} · ${x.qtd}`} />
            ))}
          </Card>

          {/* Por canal */}
          <Card className="space-y-3 p-4">
            <h2 className="font-display text-sm font-bold">Por canal</h2>
            {(vendas?.porCanal ?? []).map((x: any) => (
              <Barra key={x.canal} label={x.canal} valor={x.total} max={maxCanal} right={`${brl(x.total)} · ${x.qtd}`} />
            ))}
          </Card>
        </div>

        {/* Curva ABC */}
        <Card className="p-4">
          <h2 className="mb-3 font-display text-sm font-bold">Curva ABC de produtos</h2>
          {(produtos?.itens ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sem vendas no período.</p>}
          <div className="space-y-1">
            {(produtos?.itens ?? []).slice(0, 20).map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-2 border-b border-border/50 py-1.5 text-sm last:border-0">
                <span className={`w-5 rounded text-center text-xs font-bold ${CLASSE[p.classe] ?? ''}`}>{p.classe}</span>
                <span className="min-w-0 flex-1 truncate">{p.descricao}</span>
                <span className="w-10 text-right text-xs text-muted-foreground">{p.qtd}x</span>
                <span className="w-24 text-right font-mono">{brl(p.faturamento)}</span>
                <span className="w-12 text-right text-xs text-muted-foreground">{p.pct}%</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Atendentes */}
          <Card className="p-4">
            <h2 className="mb-3 font-display text-sm font-bold">Por atendente</h2>
            {(atendentes?.atendentes ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sem vendas.</p>}
            <div className="space-y-1">
              {(atendentes?.atendentes ?? []).map((a: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                  <span className="text-xs text-muted-foreground">{a.vendas} vendas</span>
                  <span className="w-24 text-right font-mono">{brl(a.total)}</span>
                  <span className="w-20 text-right text-xs text-muted-foreground">tm {brl(a.ticketMedio)}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Por hora */}
          <Card className="p-4">
            <h2 className="mb-3 font-display text-sm font-bold">Vendas por hora</h2>
            {(vendas?.porHora ?? []).length === 0 && <p className="text-sm text-muted-foreground">Sem vendas.</p>}
            <div className="flex items-end gap-1" style={{ height: 120 }}>
              {(vendas?.porHora ?? []).map((h: any) => (
                <div key={h.hora} className="flex flex-1 flex-col items-center justify-end" title={`${h.hora}h · ${h.qtd} vendas`}>
                  <div className="w-full rounded-t bg-primary" style={{ height: `${(h.qtd / maxHora) * 100}%` }} />
                  <span className="mt-1 text-[9px] text-muted-foreground">{h.hora}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        </>
        )}

        {aba === 'financeiro' && (
        <>
          {/* Faturamento anual (mensal + trimestral) */}
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-sm font-bold">Faturamento por mês</h2>
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setAno((a) => a - 1)}>‹</Button>
                <span className="font-mono text-sm font-bold">{ano}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAno((a) => a + 1)}>›</Button>
                {fatAnual && (
                  <Button type="button" variant="outline" size="sm" onClick={() => baixarCsv(`faturamento-${ano}`, fatAnual.porMes.map((m: any) => ({ mes: MESES[m.mes - 1], faturamento: m.total, vendas: m.vendas })))}>
                    Exportar CSV
                  </Button>
                )}
              </div>
            </div>
            {fatAnual && (
              <>
                <div className="flex items-end gap-1.5" style={{ height: 140 }}>
                  {fatAnual.porMes.map((m: any) => {
                    const mx = Math.max(1, ...fatAnual.porMes.map((x: any) => x.total));
                    return (
                      <div key={m.mes} className="flex flex-1 flex-col items-center justify-end" title={`${MESES[m.mes - 1]} · ${brl(m.total)} · ${m.vendas} vendas`}>
                        <div className="w-full rounded-t bg-primary" style={{ height: `${(m.total / mx) * 100}%` }} />
                        <span className="mt-1 text-[9px] text-muted-foreground">{MESES[m.mes - 1]}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {fatAnual.trimestres.map((t: any) => (
                    <div key={t.trimestre} className="rounded-lg border border-border p-2.5 text-center">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">{t.trimestre}º trim.</p>
                      <p className="mt-0.5 font-mono text-sm font-bold">{brl(t.total)}</p>
                      <p className="text-[10px] text-muted-foreground">{t.vendas} vendas</p>
                    </div>
                  ))}
                </div>
                <p className="text-right text-sm">
                  Total {ano}: <strong className="font-mono">{brl(fatAnual.total)}</strong>
                </p>
              </>
            )}
          </Card>

          {/* Faturamento por delivery / plataforma (usa o período De/Até) */}
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-sm font-bold">Faturamento por delivery (plataforma)</h2>
                <p className="text-xs text-muted-foreground">Período De/Até acima · exclui pendentes e cancelados.</p>
              </div>
              {fatDelivery && fatDelivery.porPlataforma.length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={() => baixarCsv('faturamento-delivery', fatDelivery.porPlataforma.map((p: any) => ({ plataforma: p.plataforma, pedidos: p.pedidos, total: p.total, ticketMedio: p.ticketMedio })))}>
                  Exportar CSV
                </Button>
              )}
            </div>
            {fatDelivery && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-border p-2.5 text-center">
                    <p className="text-[10px] uppercase text-muted-foreground">Total delivery</p>
                    <p className="mt-0.5 font-mono text-sm font-bold">{brl(fatDelivery.total)}</p>
                  </div>
                  <div className="rounded-lg border border-border p-2.5 text-center">
                    <p className="text-[10px] uppercase text-muted-foreground">Pedidos</p>
                    <p className="mt-0.5 font-mono text-sm font-bold">{fatDelivery.pedidos}</p>
                  </div>
                  <div className="rounded-lg border border-border p-2.5 text-center">
                    <p className="text-[10px] uppercase text-muted-foreground">Ticket médio</p>
                    <p className="mt-0.5 font-mono text-sm font-bold">{brl(fatDelivery.ticketMedio)}</p>
                  </div>
                </div>
                {fatDelivery.porPlataforma.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem pedidos de delivery no período.</p>
                ) : (
                  <div className="space-y-1">
                    {fatDelivery.porPlataforma.map((p: any) => (
                      <div key={p.plataforma} className="flex items-center gap-2 border-b border-border/50 py-1.5 text-sm last:border-0">
                        <span className="min-w-0 flex-1 truncate capitalize">{p.plataforma}</span>
                        <span className="w-14 text-right text-xs text-muted-foreground">{p.pedidos} ped.</span>
                        <span className="w-24 text-right font-mono">{brl(p.total)}</span>
                        <span className="w-20 text-right text-xs text-muted-foreground">tm {brl(p.ticketMedio)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </Card>
        </>
        )}
      </div>
    </Shell>
  );
}
