'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PedidoDetalhe } from '@/components/delivery/pedido-detalhe';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (d?: string) =>
  d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;

const STATUS_LABEL: Record<string, { txt: string; cls: string }> = {
  novo: { txt: 'Novo', cls: 'bg-info/10 text-info' },
  confirmado: { txt: 'Em preparo', cls: 'bg-warn/10 text-warn' },
  pronto: { txt: 'Pronto', cls: 'bg-primary/10 text-primary' },
  concluido: { txt: 'Concluído', cls: 'bg-ok/10 text-ok' },
  cancelado: { txt: 'Cancelado', cls: 'bg-danger/10 text-danger' },
};

// "2026-08-15" → "sex, 15/08"
function rotuloData(iso: string) {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(a, (m ?? 1) - 1, d ?? 1);
  const dia = dt.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  return `${dia}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

export default function EncomendasPage() {
  const [grupos, setGrupos] = useState<any[]>([]);
  const [data, setData] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [detalhe, setDetalhe] = useState<any>(null);

  const reload = useCallback(async () => {
    try {
      const g = await api.encomendasPorData(data || undefined);
      setGrupos(Array.isArray(g) ? g : []);
    } catch {
      /* silencioso — poll tenta de novo */
    } finally {
      setCarregando(false);
    }
  }, [data]);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 20000);
    return () => clearInterval(t);
  }, [reload]);

  const totalPedidos = grupos.reduce((s, g) => s + (g.total || 0), 0);

  return (
    <Shell>
      <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Encomendas · agenda</h1>
            <p className="text-sm text-muted-foreground">
              Pedidos do cardápio para datas futuras — o que produzir em cada dia.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs text-muted-foreground">
              <span className="mb-1 block">Filtrar por data</span>
              <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-44" />
            </label>
            {data && (
              <Button type="button" variant="outline" size="sm" onClick={() => setData('')}>
                Todas
              </Button>
            )}
          </div>
        </div>

        {carregando ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : grupos.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-4xl">📅</p>
            <p className="mt-2 text-lg font-semibold">Nenhuma encomenda{data ? ' para esta data' : ''}.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Encomendas do cardápio aparecem aqui, agrupadas pela data de entrega/retirada.
            </p>
          </Card>
        ) : (
          <div className="space-y-5">
            {grupos.map((g) => (
              <section key={g.data}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="font-display text-lg font-semibold capitalize">{rotuloData(g.data)}</h2>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    {g.total} {g.total === 1 ? 'encomenda' : 'encomendas'}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {g.pedidos.map((p: any) => {
                    const st = STATUS_LABEL[p.status] ?? { txt: p.status, cls: 'bg-secondary text-muted-foreground' };
                    return (
                      <Card key={p.id} className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-semibold">
                              #{p.numero ?? p.displayId ?? '—'} · {p.cliente ?? 'Cliente'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {hora(p.agendamento) ? `⏰ ${hora(p.agendamento)} · ` : ''}
                              {p.tipo === 'entrega' ? '🛵 Entrega' : '🏪 Retirada'}
                              {p.clienteTelefone ? ` · ${p.clienteTelefone}` : ''}
                            </p>
                          </div>
                          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                            {st.txt}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="font-mono text-sm font-bold">{brl(Number(p.total))}</span>
                          <Button type="button" variant="outline" size="sm" onClick={() => setDetalhe(p)}>
                            Ver / atender
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </section>
            ))}
            <p className="text-xs text-muted-foreground">Total: {totalPedidos} encomenda(s).</p>
          </div>
        )}
      </div>

      {detalhe && (
        <PedidoDetalhe
          pedido={detalhe}
          onClose={() => setDetalhe(null)}
          onChanged={async () => {
            setDetalhe(null);
            await reload();
          }}
        />
      )}
    </Shell>
  );
}
