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

const COR: Record<string, string> = {
  aprovado: 'bg-ok/10 text-ok',
  negado: 'bg-destructive/10 text-destructive',
  cancelado: 'bg-secondary text-muted-foreground',
  pendente: 'bg-warn/10 text-warn',
};

export default function TefPage() {
  const router = useRouter();
  // cat resolvido no cliente (evita divergência de hidratação com o SSR).
  const [cat, setCat] = useState<string | null>(null);
  const isGestor = ['presidente', 'gerente', 'supervisao'].includes(cat ?? '');
  const [pagamentos, setPagamentos] = useState<any[] | null>(null);
  const [cfg, setCfg] = useState<any>({ ativo: false, provedor: 'mock' });
  const [erro, setErro] = useState('');

  const reload = useCallback(async () => {
    try {
      const [ps, c] = await Promise.all([
        api.tefListar(),
        api.tefConfig().catch(() => ({ ativo: false, provedor: 'mock' })),
      ]);
      setPagamentos(ps as any[]);
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
    setCat(getCategoria());
    reload();
    const t = setInterval(reload, 10000);
    return () => clearInterval(t);
  }, [reload, router]);

  async function toggleAtivo(ativo: boolean) {
    try {
      const c = await api.setTefConfig({ ...cfg, ativo });
      setCfg(c);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  async function simular(p: any, status: string) {
    try {
      await api.tefSimular(p.id, status);
      toast.success(status === 'aprovado' ? 'Aprovado (simulado).' : 'Negado (simulado).');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    }
  }

  return (
    <Shell eyebrow="Pagamentos · TEF" title="TEF / Maquininha">
      <div className="max-w-3xl space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}

        {isGestor && (
          <Card className="p-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={!!cfg.ativo} onChange={(e) => toggleAtivo(e.target.checked)} className="h-4 w-4 accent-primary" />
              TEF ativo (cobrança de cartão/pix na maquininha)
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              A maquininha é operada pelo agente TEF no servidor local (edge). Sem o agente/pinpad,
              use “simular” abaixo para aprovar uma cobrança pendente (teste). Provedor: {cfg.provedor}.
            </p>
          </Card>
        )}

        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Transações {pagamentos ? `(${pagamentos.length})` : ''}
          </p>
          {!pagamentos && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {pagamentos?.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma transação ainda.</p>
          )}
          <div className="space-y-2">
            {pagamentos?.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
                <span className="font-mono text-sm font-bold">{brl(Number(p.valor))}</span>
                <span className="text-xs capitalize text-muted-foreground">{p.forma}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${COR[p.status] ?? ''}`}>{p.status}</span>
                {p.nsu && <span className="font-mono text-[11px] text-muted-foreground">NSU {p.nsu}</span>}
                {p.bandeira && <span className="text-[11px] text-muted-foreground">{p.bandeira}</span>}
                <span className="ml-auto text-xs text-muted-foreground">{hora(p.criadoEm)}</span>
                {p.status === 'pendente' && isGestor && (
                  <div className="flex w-full gap-2 pt-1">
                    <Button type="button" size="sm" onClick={() => simular(p, 'aprovado')}>Simular aprovado</Button>
                    <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => simular(p, 'negado')}>Simular negado</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
