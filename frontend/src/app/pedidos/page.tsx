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
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
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
  const [agora, setAgora] = useState(() => Date.now());

  const reload = useCallback(async () => {
    try {
      setPedidos((await api.producaoPedidos()) as any[]);
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
    const t = setInterval(reload, 15000); // dados a cada 15s
    const c = setInterval(() => setAgora(Date.now()), 20000); // relógio p/ atraso
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
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

  const decorridoMin = (p: any) => Math.floor((agora - new Date(p.criadoEm).getTime()) / 60000);
  const atrasado = (p: any) =>
    ['recebido', 'preparo'].includes(p.status) && p.tempoPreparoMin && decorridoMin(p) > p.tempoPreparoMin;

  const ativos = (pedidos ?? []).filter((p) => ['recebido', 'preparo', 'pronto'].includes(p.status));
  const concluidos = (pedidos ?? []).filter((p) => ['entregue', 'cancelado'].includes(p.status));
  const atrasados = ativos.filter(atrasado);

  // Consolidado por setor (o gestor vê todas as telas de produção num lugar só).
  const porSetor = (() => {
    const m = new Map<string, any[]>();
    for (const p of ativos) {
      const k = p.setorNome ?? 'Sem setor';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return [...m.entries()];
  })();

  return (
    <Shell eyebrow="Produção · supervisão" title="Painel de produção">
      <div className="space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}
        <p className="text-sm text-muted-foreground">
          Visão do gestor de tudo que está na produção — por setor, com atrasos e o vínculo à venda.
          A cozinha opera no KDS; aqui você supervisiona e intervém.
        </p>

        {/* Resumo */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Resumo label="Em produção" valor={pedidos ? String(ativos.length) : '—'} cor="var(--info)" />
          <Resumo label="Atrasados" valor={pedidos ? String(atrasados.length) : '—'} cor={atrasados.length ? 'var(--destructive)' : 'var(--ok)'} />
          <Resumo label="Prontos" valor={pedidos ? String(ativos.filter((p) => p.status === 'pronto').length) : '—'} cor="var(--ok)" />
        </div>

        {!pedidos && <SkeletonList rows={3} />}
        {pedidos && ativos.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">Nenhum pedido em produção agora.</Card>
        )}

        {/* Por setor */}
        {porSetor.map(([setorNome, lista]) => (
          <Card key={setorNome} className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-sm font-bold">{setorNome}</p>
              <span className="font-mono text-xs text-muted-foreground">{lista.length} ativo(s)</span>
            </div>
            <div className="space-y-2">
              {lista.map((p) => (
                <PedidoLinha key={p.id} p={p} atrasado={atrasado(p)} decorrido={decorridoMin(p)} onCancelar={() => cancelar(p)} podeCancelar />
              ))}
            </div>
          </Card>
        ))}

        {concluidos.length > 0 && (
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-muted-foreground">Recentes (concluídos/cancelados)</p>
            <div className="space-y-2">
              {concluidos.map((p) => (
                <PedidoLinha key={p.id} p={p} atrasado={false} decorrido={decorridoMin(p)} onCancelar={() => cancelar(p)} podeCancelar={p.status === 'entregue'} />
              ))}
            </div>
          </Card>
        )}
      </div>
    </Shell>
  );
}

function Resumo({ label, valor, cor }: { label: string; valor: string; cor: string }) {
  return (
    <Card className="relative overflow-hidden p-3">
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: `hsl(${cor})` }} />
      <p className="font-display text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-2xl font-bold tabular-nums">{valor}</p>
    </Card>
  );
}

function PedidoLinha({
  p,
  atrasado,
  decorrido,
  onCancelar,
  podeCancelar,
}: {
  p: any;
  atrasado: boolean;
  decorrido: number;
  onCancelar: () => void;
  podeCancelar: boolean;
}) {
  const ref = p.senha
    ? `Senha ${p.senha}`
    : p.mesa
      ? `Mesa ${p.mesa}`
      : p.plataforma
        ? `${p.plataforma}${p.senhaPlataforma ? ` #${p.senhaPlataforma}` : ''}`
        : `#${p.numero ?? '—'}`;
  return (
    <div className={`rounded-lg border p-3 ${atrasado ? 'border-destructive/50 bg-destructive/5' : 'border-border'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{ref}</span>
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS_COR[p.status] ?? 'bg-secondary'}`}>
          {STATUS_LABEL[p.status] ?? p.status}
        </span>
        {['recebido', 'preparo'].includes(p.status) && (
          <span className={`font-mono text-xs ${atrasado ? 'font-bold text-destructive' : 'text-muted-foreground'}`}>
            {decorrido} min{p.tempoPreparoMin ? ` / ${p.tempoPreparoMin}` : ''}{atrasado ? ' · ATRASADO' : ''}
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">{hora(p.criadoEm)}</span>
      </div>

      {p.comanda && (
        <p className="mt-1 text-xs text-muted-foreground">
          {p.comanda.cliente ? `${p.comanda.cliente} · ` : ''}
          {p.comanda.total != null ? <span className="font-mono">{brl(Number(p.comanda.total))}</span> : null}
        </p>
      )}

      <div className="mt-1.5 space-y-0.5">
        {(p.itens ?? []).map((it: any) => (
          <div key={it.id} className="text-xs">
            <span className="font-medium">{Number(it.quantidade)}× {it.descricao}</span>
            {it.complementosTexto && <span className="text-muted-foreground"> · {it.complementosTexto}</span>}
          </div>
        ))}
      </div>

      {podeCancelar && (
        <Button type="button" size="sm" variant="ghost" className="mt-1.5 h-7 text-xs text-destructive" onClick={onCancelar}>
          Cancelar pedido
        </Button>
      )}
    </div>
  );
}
