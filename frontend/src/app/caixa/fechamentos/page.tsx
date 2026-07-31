'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ResponsiveTable, type Column } from '@/components/ui/responsive-table';

/* eslint-disable @typescript-eslint/no-explicit-any */

const brl = (n: any) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Resumo textual das diferenças por forma (ex.: "dinheiro −R$ 2,00 · pix +R$ 1,00").
function difPorForma(m: Record<string, number> | null | undefined) {
  if (!m) return '';
  return Object.entries(m)
    .filter(([, v]) => Math.abs(Number(v)) > 0.001)
    .map(([f, v]) => `${f} ${Number(v) >= 0 ? '+' : '−'}${brl(Math.abs(Number(v)))}`)
    .join(' · ');
}

export default function FechamentosPage() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [reconc, setReconc] = useState('');
  const ehPresidente = getCategoria() === 'presidente';

  const reconciliar = useCallback(async (id: string) => {
    setReconc(id);
    try {
      const r: any = await api.reconciliarCaixa(id);
      if (r?.ok) toast.success('Reconciliação OK — o caixa bate com o histórico do dinheiro.');
      else
        toast.error(
          `Divergência de ${brl(r?.totalDivergencia)} entre o histórico e o fechamento. Registrado na auditoria.`,
        );
    } catch {
      toast.error('Não consegui reconciliar agora. Tente de novo.');
    } finally {
      setReconc('');
    }
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r: any = await api.fechamentosCaixa(inicio || undefined, fim || undefined);
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
    // Só gestão vê (o servidor também barra via @Roles).
    if (!['presidente', 'gerente'].includes(getCategoria() ?? '')) {
      router.replace('/meu-dia');
      return;
    }
    carregar();
  }, [router, carregar]);

  const cols: Column<any>[] = [
    {
      key: 'fechadaEm',
      header: 'Fechado em',
      render: (r) =>
        r.fechadaEm
          ? new Date(r.fechadaEm).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })
          : '—',
    },
    {
      key: 'turno',
      header: 'Turno',
      render: (r) =>
        `${String(r.turnoNumero ?? '—').padStart(2, '0')} · ${r.origem === 'delivery' ? 'Delivery' : 'PDV'}`,
    },
    { key: 'operador', header: 'Operador', render: (r) => r.operador ?? '—' },
    { key: 'valorEsperado', header: 'Esperado', align: 'right', mono: true, render: (r) => brl(r.valorEsperado) },
    { key: 'valorInformado', header: 'Contado', align: 'right', mono: true, render: (r) => brl(r.valorInformado) },
    {
      key: 'diferenca',
      header: 'Diferença',
      align: 'right',
      mono: true,
      render: (r) => {
        const d = Number(r.diferenca || 0);
        const resumo = difPorForma(r.diferencaPorForma);
        return (
          <span
            className={Math.abs(d) < 0.01 ? 'text-ok' : 'text-destructive'}
            title={resumo || undefined}
          >
            {d > 0 ? '+' : ''}
            {brl(d)}
          </span>
        );
      },
    },
    // Verificador (P3): só o presidente confere se o ledger ainda bate com o fechamento.
    ...(ehPresidente
      ? [
          {
            key: 'reconciliar',
            header: '',
            align: 'right' as const,
            render: (r: any) => (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={reconc === r.id}
                onClick={() => reconciliar(r.id)}
                title="Recalcula o esperado pelo histórico do dinheiro e compara com o fechamento"
              >
                {reconc === r.id ? '…' : 'Reconciliar'}
              </Button>
            ),
          } as Column<any>,
        ]
      : []),
  ];

  return (
    <Shell eyebrow="Financeiro" title="Fechamentos de caixa">
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
        caption="Lista de fechamentos de caixa por dia, turno e operador, com as diferenças"
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        variant="scroll-sticky"
        empty="Nenhum fechamento no período."
        cardTitle={(r) =>
          `${r.fechadaEm ? new Date(r.fechadaEm).toLocaleDateString('pt-BR') : '—'} · ${r.operador ?? '—'}`
        }
      />
    </Shell>
  );
}
