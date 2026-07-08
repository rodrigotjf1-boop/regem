'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Painel do estoque: valor total, insumos por categoria, alertas e CMV do mês.
export function PainelSecao({ itens }: { itens: any[] }) {
  const [cmv, setCmv] = useState<any>(null);

  useEffect(() => {
    api.estoqueCmv().then(setCmv).catch(() => setCmv(null));
  }, []);

  const valorTotal = itens.reduce((s, i) => s + Number(i.valorEstoque ?? 0), 0);
  const criticos = itens.filter((i) => Number(i.saldo) < Number(i.estoqueMinimo)).length;
  const zerados = itens.filter((i) => Number(i.saldo) <= 0).length;

  const cat: Record<string, { nome: string; cor: string | null; valor: number; n: number }> = {};
  for (const i of itens) {
    const nome = i.categoriaNome ?? 'Sem categoria';
    cat[nome] ??= { nome, cor: i.categoriaCor ?? null, valor: 0, n: 0 };
    cat[nome].valor += Number(i.valorEstoque ?? 0);
    cat[nome].n += 1;
  }
  const categorias = Object.values(cat).sort((a, b) => b.valor - a.valor);
  const maxCat = Math.max(1, ...categorias.map((c) => c.valor));

  const KPI = ({ label, valor, tom }: { label: string; valor: string; tom?: string }) => (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 font-display text-xl font-extrabold ${tom ?? ''}`}>{valor}</p>
    </Card>
  );

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPI label="Valor em estoque" valor={brl(valorTotal)} />
        <KPI label="Insumos" valor={String(itens.length)} />
        <KPI label="Abaixo do mínimo" valor={String(criticos)} tom={criticos ? 'text-warn' : ''} />
        <KPI label="Zerados" valor={String(zerados)} tom={zerados ? 'text-destructive' : ''} />
      </div>

      {/* CMV do mês */}
      <Card className="p-4">
        <p className="mb-2 font-display text-sm font-bold">CMV do mês</p>
        {!cmv ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div>
              <p className="text-xs text-muted-foreground">CMV real</p>
              <p className="font-mono font-bold">{brl(cmv.cmvReal)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">CMV teórico</p>
              <p className="font-mono font-bold">{brl(cmv.cmvTeorico)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Desvio</p>
              <p className={`font-mono font-bold ${Math.abs(cmv.desvio) < 0.01 ? 'text-ok' : 'text-destructive'}`}>
                {cmv.desvio > 0 ? '+' : ''}{brl(cmv.desvio)}
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Insumos por categoria */}
      <Card className="p-4">
        <p className="mb-3 font-display text-sm font-bold">Valor por categoria</p>
        {categorias.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum insumo cadastrado.</p>
        ) : (
          <div className="space-y-2">
            {categorias.map((c) => (
              <div key={c.nome}>
                <div className="mb-0.5 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.cor || 'hsl(var(--muted-foreground))' }} />
                    {c.nome} <span className="text-muted-foreground">· {c.n}</span>
                  </span>
                  <span className="font-mono">{brl(c.valor)}</span>
                </div>
                <div className="h-2 rounded-full bg-secondary">
                  <div className="h-2 rounded-full" style={{ width: `${(c.valor / maxCat) * 100}%`, background: c.cor || 'hsl(var(--primary))' }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
