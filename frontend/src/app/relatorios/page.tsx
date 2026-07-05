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

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

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
          <Button type="button" onClick={reload}>Atualizar</Button>
        </Card>

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
      </div>
    </Shell>
  );
}
