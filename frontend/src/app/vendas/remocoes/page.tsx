'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ResponsiveTable, type Column } from '@/components/ui/responsive-table';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function RemocoesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r: any = await api.remocoesItens(inicio || undefined, fim || undefined);
      setRows(Array.isArray(r) ? r : []);
    } finally {
      setLoading(false);
    }
  }, [inicio, fim]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    if (!['presidente', 'gerente', 'supervisao'].includes(getCategoria() ?? '')) {
      router.replace('/meu-dia');
      return;
    }
    carregar();
  }, [router, carregar]);

  const cols: Column<any>[] = [
    {
      key: 'data',
      header: 'Quando',
      render: (r) =>
        r.data
          ? new Date(r.data).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '—',
    },
    { key: 'ator', header: 'Quem removeu', render: (r) => r.ator ?? '—' },
    { key: 'descricao', header: 'Item', render: (r) => r.descricao ?? '—' },
    {
      key: 'justificativa',
      header: 'Justificativa',
      render: (r) => r.justificativa || <span className="text-muted-foreground">—</span>,
    },
  ];

  return (
    <Shell eyebrow="Vendas" title="Retiradas de item (mesas)">
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1">
          <Label className="text-xs">De</Label>
          <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Até</Label>
          <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} className="w-40" />
        </div>
        <Button type="button" variant="outline" onClick={carregar} disabled={loading}>
          {loading ? '…' : 'Filtrar'}
        </Button>
      </Card>

      <ResponsiveTable
        caption="Itens removidos de comandas de mesa, com quem removeu e a justificativa"
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        variant="scroll-sticky"
        empty="Nenhuma remoção no período."
        cardTitle={(r) => `${r.descricao ?? 'Item'} · ${r.ator ?? '—'}`}
      />
    </Shell>
  );
}
