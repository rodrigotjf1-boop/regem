'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (d?: string) =>
  d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const COR: Record<string, string> = {
  autorizada: 'bg-ok/10 text-ok',
  cancelada: 'bg-destructive/10 text-destructive',
  rejeitada: 'bg-warn/10 text-warn',
  pendente: 'bg-secondary text-muted-foreground',
  contingencia: 'bg-info/10 text-info',
};

export default function NotasPage() {
  const router = useRouter();
  const [notas, setNotas] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');

  const reload = useCallback(async () => {
    try {
      setNotas((await api.notasFiscais()) as any[]);
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
  }, [reload, router]);

  async function cancelar(n: any) {
    const justificativa = window.prompt('Justificativa do cancelamento (mín. 15 caracteres):') ?? '';
    if (!justificativa) return;
    try {
      await api.cancelarNota(n.id, justificativa);
      toast.success('Nota cancelada.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao cancelar');
    }
  }

  return (
    <Shell eyebrow="Fiscal · NFC-e" title="Notas fiscais">
      <div className="max-w-3xl space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Últimas notas {notas ? `(${notas.length})` : ''}
          </p>
          {!notas && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {notas?.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma nota emitida ainda.</p>
          )}
          <div className="space-y-2">
            {notas?.map((n) => (
              <div key={n.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">NFC-e {n.serie}/{n.numero}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${COR[n.status] ?? ''}`}>{n.status}</span>
                    {n.ambiente === '2' && (
                      <span className="rounded bg-warn/10 px-1.5 py-0.5 text-xs text-warn">homologação</span>
                    )}
                    <span className="text-xs text-muted-foreground">{hora(n.emitidaEm)}</span>
                  </div>
                  {n.chave && (
                    <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{n.chave}</p>
                  )}
                  {n.motivo && <p className="text-[11px] text-muted-foreground">{n.motivo}</p>}
                </div>
                <span className="font-mono text-sm font-bold">{brl(Number(n.valorTotal))}</span>
                {n.status === 'autorizada' && (
                  <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => cancelar(n)}>
                    Cancelar
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
