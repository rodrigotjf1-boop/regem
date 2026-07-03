'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}
function diasAtras(n: number) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

const ABC_COR: Record<string, string> = {
  A: 'hsl(var(--ok))',
  B: 'hsl(var(--info))',
  C: 'hsl(var(--muted-foreground))',
};

export default function EstoqueInteligenciaPage() {
  const router = useRouter();
  const [inicio, setInicio] = useState(diasAtras(29));
  const [fim, setFim] = useState(hojeISO());
  const [data, setData] = useState<any>(null);
  const [validades, setValidades] = useState<any[]>([]);
  const [cmv, setCmv] = useState<any>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async (ini: string, f: string) => {
    setErro('');
    try {
      const [intel, vals, cmvData] = await Promise.all([
        api.estoqueInteligencia(ini, f),
        api.estoqueValidades(),
        api.estoqueCmv(ini, f),
      ]);
      setData(intel);
      setValidades(vals);
      setCmv(cmvData);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  async function bootstrapSnapshot() {
    try {
      await api.gerarSnapshotEstoque();
      await carregar(inicio, fim);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao gerar snapshot');
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    carregar(inicio, fim);
  }, [carregar, inicio, fim, router]);

  const r = data?.resumo;
  const itens: any[] = data?.itens ?? [];

  return (
    <Shell eyebrow="Gestão · motor de custo" title="Inteligência de estoque">
      <div className="space-y-5">
        {/* Período */}
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label htmlFor="ini" className="text-xs">De</Label>
            <Input id="ini" type="date" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fim" className="text-xs">Até</Label>
            <Input id="fim" type="date" value={fim} min={inicio} max={hojeISO()} onChange={(e) => setFim(e.target.value)} />
          </div>
          {r && (
            <p className="ml-auto text-xs text-muted-foreground">
              {r.dias} dia(s) · lead time {r.leadTimePadrao}d (padrão; por fornecedor quando houver)
            </p>
          )}
        </Card>

        {erro && <p className="text-destructive">{erro}</p>}

        {/* KPIs de valorização */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Valor em estoque" value={r ? brl(r.valorEstoque) : '—'} />
          <Kpi label="Compras no período" value={r ? brl(r.comprasPeriodo) : '—'} />
          <Kpi
            label="A repor (ROP)"
            value={r ? String(r.itensRepor) : '—'}
            tone={r?.itensRepor ? 'warn' : undefined}
          />
          <Kpi
            label="Abaixo do mínimo"
            value={r ? String(r.itensAbaixoMinimo) : '—'}
            tone={r?.itensAbaixoMinimo ? 'danger' : undefined}
          />
        </div>

        {/* CMV real × teórico · desvio (§1.3) */}
        {cmv && (
          <Card className="p-5">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
              <h2 className="font-display text-lg font-semibold">CMV do período</h2>
              <span className="text-xs text-muted-foreground">
                EI + compras − EF · vs. consumo teórico
              </span>
              <button
                type="button"
                onClick={bootstrapSnapshot}
                className="ml-auto text-xs font-medium text-primary hover:underline"
              >
                Gerar snapshot de hoje
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Kpi label="CMV real" value={brl(cmv.cmvReal)} />
              <Kpi label="CMV teórico (consumo)" value={brl(cmv.cmvTeorico)} />
              <Kpi
                label="Desvio"
                value={brl(cmv.desvio)}
                tone={cmv.desvio > 0 ? 'danger' : undefined}
              />
              <Kpi label="Desperdício registrado" value={brl(cmv.desperdicioValor ?? 0)} />
              <Kpi
                label="Furo (não explicado)"
                value={brl(cmv.furo ?? 0)}
                tone={(cmv.furo ?? 0) > 0 ? 'danger' : undefined}
              />
              <Kpi label="Compras no período" value={brl(cmv.compras)} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              EI {brl(cmv.estoqueInicial)} · EF {brl(cmv.estoqueFinal)}
              {cmv.efFonte === 'atual' ? ' (valorização atual)' : ''}.
              {cmv.semSnapshotInicial
                ? ' ⚠️ Sem snapshot inicial — gere um snapshot e o CMV real fica preciso no próximo período.'
                : ''}{' '}
              Furo = desvio − desperdício registrado (porção fora do padrão + perda/contagem).
              Vincule item ao registrar o desperdício para ele entrar aqui.
            </p>
          </Card>
        )}

        {/* Validades FEFO */}
        {validades.length > 0 && (
          <Card className="p-0">
            <div className="border-b border-border px-5 py-3.5">
              <p className="font-display text-sm font-bold">Validades (FEFO)</p>
              <p className="text-xs text-muted-foreground">
                Lotes por vencimento · crítico ≤ 2 dias · atenção ≤ 5 dias
              </p>
            </div>
            <div className="divide-y divide-border">
              {validades.slice(0, 12).map((l) => {
                const cor =
                  l.status === 'vencido' || l.status === 'critico'
                    ? 'hsl(var(--destructive))'
                    : l.status === 'atencao'
                      ? 'hsl(var(--warn))'
                      : 'hsl(var(--muted-foreground))';
                return (
                  <div key={l.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <span className="font-medium">{l.itemNome}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {l.quantidade} {l.unidadeMedida}
                      </span>
                    </div>
                    <span className="font-mono text-xs" style={{ color: cor }}>
                      {l.status === 'vencido'
                        ? `vencido há ${Math.abs(l.diasParaVencer)}d`
                        : `vence em ${l.diasParaVencer}d`}
                    </span>
                    <span className="w-24 text-right font-mono text-xs text-muted-foreground">
                      {l.validade}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Tabela */}
        <Card className="p-0">
          <div className="border-b border-border px-5 py-3.5">
            <p className="font-display text-sm font-bold">Itens</p>
            <p className="text-xs text-muted-foreground">
              Valor, cobertura, curva ABC (por valor consumido) e ponto de pedido
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Inteligência de estoque por item</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  {['Item', 'Saldo', 'Custo méd.', 'Valor', 'Cobertura', 'ABC', ''].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 font-display text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data === null && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Carregando…</td></tr>
                )}
                {itens.length === 0 && data !== null && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Nenhum item de estoque.</td></tr>
                )}
                {itens.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">
                      {i.nome}
                      {i.fornecedorNome && (
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          {i.fornecedorNome} · lead {i.leadTime}d
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                      {i.saldo} {i.unidadeMedida}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                      {Number(i.custoMedio) > 0 ? brl(i.custoMedio) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                      {Number(i.valorEstoque) > 0 ? brl(i.valorEstoque) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                      {i.diasCobertura != null ? `${i.diasCobertura} d` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold"
                        style={{ background: `${ABC_COR[i.classeAbc]}20`, color: ABC_COR[i.classeAbc] }}
                      >
                        {i.classeAbc}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {i.repor && (
                        <span
                          className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                          style={{ background: 'hsl(var(--warn)/.15)', color: 'hsl(var(--warn))' }}
                        >
                          Repor{i.qtdSugerida > 0 ? ` ${i.qtdSugerida} ${i.unidadeMedida}` : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <p className="text-xs text-muted-foreground">
          Curva ABC pelo valor consumido no período (A ≤ 80% acumulado · B ≤ 95% · C resto).
          Ponto de pedido usa o lead time do fornecedor do item (padrão quando o item não tem fornecedor).
        </p>
      </div>
    </Shell>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn' | 'danger';
}) {
  const cor =
    tone === 'danger'
      ? 'hsl(var(--destructive))'
      : tone === 'warn'
        ? 'hsl(var(--warn))'
        : undefined;
  return (
    <Card className="p-4">
      <p className="font-display text-[10px] font-bold uppercase tracking-[.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-2xl font-bold" style={{ color: cor }}>
        {value}
      </p>
    </Card>
  );
}
