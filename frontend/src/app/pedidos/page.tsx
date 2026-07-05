'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
const hora = (d?: string) =>
  d ? new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';

const STATUS_LABEL: Record<string, string> = {
  recebido: 'Recebido',
  preparo: 'Em preparo',
  pronto: 'Pronto',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};
const STATUS_COR: Record<string, string> = {
  recebido: 'bg-info/10 text-info',
  preparo: 'bg-warn/10 text-warn',
  pronto: 'bg-ok/10 text-ok',
  entregue: 'bg-secondary text-muted-foreground',
  cancelado: 'bg-destructive/10 text-destructive',
};

export default function PedidosPage() {
  const router = useRouter();
  const [pedidos, setPedidos] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');

  const reload = useCallback(async () => {
    try {
      const r: any = await api.producaoPedidos();
      setPedidos(r as any[]);
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
    const t = setInterval(reload, 15000); // atualiza a cada 15s
    return () => clearInterval(t);
  }, [reload, router]);

  async function cancelar(p: any) {
    const motivo = window.prompt('Motivo do cancelamento (opcional):') ?? undefined;
    if (motivo === null) return;
    try {
      await api.cancelarPedidoProducao(p.id, motivo || undefined);
      toast.success('Pedido cancelado. A cozinha foi avisada.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao cancelar');
    }
  }

  const ativos = (pedidos ?? []).filter((p) =>
    ['recebido', 'preparo', 'pronto'].includes(p.status),
  );
  const concluidos = (pedidos ?? []).filter((p) =>
    ['entregue', 'cancelado'].includes(p.status),
  );

  return (
    <Shell eyebrow="PDV · produção" title="Pedidos">
      <div className="max-w-3xl space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}
        <p className="text-sm text-muted-foreground">
          Acompanhe os pedidos na cozinha. Você pode cancelar um pedido em produção (ou até 30 min após ficar pronto) — a cozinha é avisada na hora.
        </p>

        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Em produção {pedidos ? `(${ativos.length})` : ''}
          </p>
          {!pedidos && <SkeletonList rows={3} />}
          {pedidos && ativos.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum pedido em produção.</p>
          )}
          <div className="space-y-2">
            {ativos.map((p) => (
              <PedidoLinha key={p.id} p={p} onCancelar={() => cancelar(p)} podeCancelar />
            ))}
          </div>
        </Card>

        {concluidos.length > 0 && (
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-muted-foreground">Recentes</p>
            <div className="space-y-2">
              {concluidos.map((p) => (
                <PedidoLinha
                  key={p.id}
                  p={p}
                  onCancelar={() => cancelar(p)}
                  podeCancelar={p.status === 'entregue'}
                />
              ))}
            </div>
          </Card>
        )}
      </div>
    </Shell>
  );
}

function PedidoLinha({
  p,
  onCancelar,
  podeCancelar,
}: {
  p: any;
  onCancelar: () => void;
  podeCancelar: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {p.numero ? `#${p.numero} · ` : ''}
            {p.mesa ? `Mesa ${p.mesa}` : 'Balcão'}
          </span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_COR[p.status] ?? ''}`}>
            {STATUS_LABEL[p.status] ?? p.status}
          </span>
          <span className="text-xs text-muted-foreground">{hora(p.criadoEm)}</span>
        </div>
        <div className="mt-1 space-y-0.5">
          {(p.itens ?? []).map((it: any) => (
            <div key={it.id} className="text-sm">
              {Number(it.quantidade)}× {it.descricao}
              {it.complementosTexto && (
                <span className="text-xs text-muted-foreground"> · {it.complementosTexto}</span>
              )}
            </div>
          ))}
        </div>
      </div>
      {podeCancelar && p.status !== 'cancelado' && (
        <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={onCancelar}>
          Cancelar
        </Button>
      )}
    </div>
  );
}
