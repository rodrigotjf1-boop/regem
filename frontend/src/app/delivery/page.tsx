'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (d?: string) =>
  d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';

const STATUS: Record<string, { label: string; cor: string }> = {
  novo: { label: 'Novo', cor: 'bg-info/10 text-info' },
  confirmado: { label: 'Em produção', cor: 'bg-warn/10 text-warn' },
  pronto: { label: 'Pronto', cor: 'bg-ok/10 text-ok' },
  despachado: { label: 'Despachado', cor: 'bg-primary/10 text-primary' },
  concluido: { label: 'Concluído', cor: 'bg-secondary text-muted-foreground' },
  cancelado: { label: 'Cancelado', cor: 'bg-destructive/10 text-destructive' },
};
const PROXIMO: Record<string, string> = {
  confirmado: 'Marcar pronto',
  pronto: 'Despachar',
  despachado: 'Concluir',
};

export default function DeliveryPage() {
  const router = useRouter();
  const cat = getCategoria();
  const isGestor = ['presidente', 'gerente', 'supervisao'].includes(cat ?? '');
  const [pedidos, setPedidos] = useState<any[] | null>(null);
  const [cfg, setCfg] = useState<any>({ ativo: false, autoAceitar: false });
  const [erro, setErro] = useState('');

  const reload = useCallback(async () => {
    try {
      const [ps, c] = await Promise.all([
        api.deliveryPedidos(),
        api.deliveryConfig().catch(() => ({ ativo: false, autoAceitar: false })),
      ]);
      setPedidos(ps as any[]);
      setCfg(c);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [reload, router]);

  async function acao(fn: Promise<any>, ok: string) {
    try {
      await fn;
      toast.success(ok);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  }

  async function toggleCfg(patch: any) {
    try {
      const c = await api.setDeliveryConfig({ ...cfg, ...patch });
      setCfg(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  async function simular() {
    await acao(api.simularDelivery({ produto: 'Combo delivery', preco: 39.9 }), 'Pedido simulado recebido.');
  }

  return (
    <Shell eyebrow="Delivery · canais" title="Delivery">
      <div className="max-w-3xl space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}

        {isGestor && (
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!cfg.ativo} onChange={(e) => toggleCfg({ ativo: e.target.checked })} className="h-4 w-4 accent-primary" />
                Delivery ativo
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!cfg.autoAceitar} onChange={(e) => toggleCfg({ autoAceitar: e.target.checked })} className="h-4 w-4 accent-primary" />
                Aceitar automaticamente
              </label>
              <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={simular}>
                Simular pedido (teste)
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              O iFood/canais entram pelo edge (token do servidor local). O simulador injeta um pedido de exemplo para testar o fluxo.
            </p>
          </Card>
        )}

        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Pedidos {pedidos ? `(${pedidos.length})` : ''}
          </p>
          {!pedidos && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {pedidos?.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum pedido no momento.</p>
          )}
          <div className="space-y-2">
            {pedidos?.map((p) => {
              const s = STATUS[p.status] ?? { label: p.status, cor: '' };
              return (
                <div key={p.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.displayId ?? 'Pedido'}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${s.cor}`}>{s.label}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-xs capitalize text-muted-foreground">{p.canal}</span>
                    <span className="text-xs text-muted-foreground">{p.tipo}</span>
                    <span className="text-xs text-muted-foreground">{hora(p.criadoEm)}</span>
                    <span className="ml-auto font-mono text-sm font-bold">{brl(Number(p.total))}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {p.clienteNome}{p.endereco ? ` · ${p.endereco}` : ''}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {(p.itens ?? []).map((it: any, k: number) => (
                      <div key={k} className="text-sm">
                        {Number(it.quantidade)}× {it.descricao}
                        {it.observacao && <span className="text-xs text-muted-foreground"> · {it.observacao}</span>}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    {p.status === 'novo' && (
                      <Button type="button" size="sm" onClick={() => acao(api.aceitarDelivery(p.id), 'Pedido aceito e enviado à produção.')}>
                        Aceitar
                      </Button>
                    )}
                    {PROXIMO[p.status] && (
                      <Button type="button" size="sm" variant="outline" onClick={() => acao(api.avancarDelivery(p.id), 'Status atualizado.')}>
                        {PROXIMO[p.status]}
                      </Button>
                    )}
                    {isGestor && p.status !== 'concluido' && p.status !== 'cancelado' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          const m = window.prompt('Motivo do cancelamento:') ?? undefined;
                          if (m !== undefined) acao(api.cancelarDelivery(p.id, m || undefined), 'Pedido cancelado.');
                        }}
                      >
                        Cancelar
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
