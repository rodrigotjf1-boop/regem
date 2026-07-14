'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { ResponsiveTable, type Column } from '@/components/ui/responsive-table';

/* eslint-disable @typescript-eslint/no-explicit-any */

const brl = (n: any) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const PERIODOS = [
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
];

// Cartão de insight (KPI) no topo.
function Insight({ titulo, valor, sub }: { titulo: string; valor: string; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="mt-1 font-mono text-xl font-bold">{valor}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

export default function MapaCalorDeliveryPage() {
  const router = useRouter();
  const [dias, setDias] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r: any = await api.deliveryMapaCalor(dias);
      setData(r);
    } finally {
      setLoading(false);
    }
  }, [dias]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    // Só gestão vê (o servidor também barra via @Roles).
    if (!['presidente', 'gerente'].includes(getCategoria() ?? '')) {
      router.replace('/meu-dia');
      return;
    }
    carregar();
  }, [router, carregar]);

  const bairros: any[] = data?.bairros ?? [];
  const maxPedidos = bairros.reduce((m, b) => Math.max(m, Number(b.pedidos)), 0) || 1;
  const geral = data?.geral;
  const campeao = bairros[0];

  const cols: Column<any>[] = [
    {
      key: 'bairro',
      header: 'Bairro',
      sticky: true,
      render: (b) => {
        const intensidade = Math.max(0.06, Number(b.pedidos) / maxPedidos);
        return (
          <div className="min-w-[9rem]">
            <span className="font-medium">{b.bairro}</span>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.round((Number(b.pedidos) / maxPedidos) * 100)}%`, opacity: intensidade }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: 'pedidos',
      header: 'Pedidos',
      align: 'right',
      mono: true,
      render: (b) => (
        <span>
          {b.pedidos}
          <span className="ml-1 text-xs text-muted-foreground">{b.pct}%</span>
        </span>
      ),
    },
    { key: 'receita', header: 'Receita', align: 'right', mono: true, render: (b) => brl(b.receita) },
    { key: 'ticketMedio', header: 'Ticket médio', align: 'right', mono: true, render: (b) => brl(b.ticketMedio) },
    { key: 'taxaMedia', header: 'Taxa média', align: 'right', mono: true, render: (b) => brl(b.taxaMedia) },
  ];

  return (
    <Shell eyebrow="Delivery · relatórios" title="Mapa de calor de entregas">
      {/* Seletor de período */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PERIODOS.map((p) => (
          <button
            key={p.dias}
            type="button"
            aria-pressed={dias === p.dias}
            onClick={() => setDias(p.dias)}
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
              dias === p.dias
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/50'
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          Entregas de todos os canais, pedidos não cancelados.
        </span>
      </div>

      {/* Cartões de insight */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Insight
          titulo="Bairro campeão"
          valor={campeao?.bairro ?? '—'}
          sub={campeao ? `${campeao.pedidos} pedidos · ${campeao.pct}%` : 'sem dados'}
        />
        <Insight titulo="Pedidos no período" valor={String(geral?.pedidos ?? 0)} sub={`${geral?.bairros ?? 0} bairros`} />
        <Insight titulo="Ticket médio" valor={brl(geral?.ticketMedio)} sub="por pedido" />
        <Insight titulo="Taxa média" valor={brl(geral?.taxaMedia)} sub="frete cobrado" />
      </div>

      <ResponsiveTable
        caption="Entregas agregadas por bairro no período: nº de pedidos, participação, receita, ticket médio e taxa média"
        columns={cols}
        rows={bairros}
        rowKey={(b) => b.bairro}
        loading={loading}
        variant="scroll-sticky"
        empty="Nenhuma entrega no período."
        cardTitle={(b) => b.bairro}
      />
    </Shell>
  );
}
