'use client';

import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "CHEGUEI" NA RETIRADA — o quadro "Clientes esperando" no topo de PDV · Balcão › Retirada / Encomendas (Onda 3,
// mig 354; protótipo, aba "Loja: cliente chegou"). Quem esperou mais aparece primeiro; cada linha diz onde o cliente está,
// se o pedido já está pronto e há quanto tempo ele espera (passou do tempo do ajuste: em destaque). A ação é a MESMA do
// cartão (aceitar, avisar pronto, entregar ou cobrar e entregar) — nada novo no servidor.

/** Minutos inteiros desde `iso` (0 até completar o primeiro). */
export function minutosDesde(iso: string | null | undefined, agora: number): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) && agora > 0 ? Math.max(0, Math.floor((agora - t) / 60_000)) : 0;
}

/** Onde o cliente está, em texto curto ("🏪 No balcão", "🛵 Na porta: moto vermelha"). */
export function ondeDaChegada(c: any): string {
  if (c?.onde === 'balcao') return `🏪 No balcão${c.obs ? ` · ${c.obs}` : ''}`;
  if (c?.onde === 'porta') return `🛵 Na porta${c.obs ? `: ${c.obs}` : ''}`;
  return c?.obs ? `🙋 ${c.obs}` : '🙋 Chegou';
}

const hora = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

export function ClientesEsperando({
  pedidos,
  deNovoMin,
  agora,
  busy,
  onAbrir,
  onAceitar,
  onAvisar,
  onEntregar,
}: {
  pedidos: any[];
  deNovoMin: number;
  agora: number;
  busy: string | null;
  onAbrir: (p: any) => void;
  onAceitar: (p: any) => void;
  onAvisar: (p: any) => void;
  onEntregar: (p: any) => void;
}) {
  if (!pedidos.length) return null;
  return (
    <section aria-labelledby="t-clientes-esperando" className="mb-4 rounded-xl border border-primary/50 bg-primary/10 p-3 sm:p-4">
      <h2 id="t-clientes-esperando" className="flex flex-wrap items-center gap-2 font-display text-base font-bold">
        🙋 Clientes esperando
        <span className="rounded-full bg-card px-2 py-0.5 font-mono text-xs">{pedidos.length}</span>
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Quem esperou mais aparece primeiro.</p>
      <ul className="mt-2 space-y-2">
        {pedidos.map((p) => {
          const c = p.chegada;
          const m = minutosDesde(c?.chegouEm, agora);
          const passou = m >= deNovoMin;
          const pronto = p.status === 'pronto';
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-3 py-2">
              <button type="button" onClick={() => onAbrir(p)} className="min-w-0 flex-1 basis-56 text-left" title="Ver detalhes do pedido">
                <b className="block break-words">
                  Pedido #{p.displayId ?? p.numero ?? '—'} · {p.clienteNome || 'Cliente'}
                </b>
                <span className="block break-words text-xs text-muted-foreground">
                  {ondeDaChegada(c)} · {pronto ? '✓ Pronto' : p.status === 'novo' ? 'Ainda não aceito' : 'Em preparo · a cozinha foi avisada'}
                </span>
              </button>
              <span className="flex flex-wrap gap-1.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${passou ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}
                >
                  {m < 1 ? 'chegou agora' : passou ? `esperando há ${m} min` : `chegou há ${m} min`}
                </span>
                {c?.deNovoEm && (
                  <span className="rounded-full bg-warn/10 px-2 py-0.5 text-xs font-semibold text-warn">avisou de novo às {hora(c.deNovoEm)}</span>
                )}
              </span>
              {p.status === 'novo' ? (
                <Button size="sm" onClick={() => onAceitar(p)} disabled={busy === p.id}>
                  Aceitar
                </Button>
              ) : pronto ? (
                <Button size="sm" onClick={() => onEntregar(p)} disabled={busy === p.id}>
                  {p.pago ? 'Entregar ao cliente' : 'Cobrar e entregar'}
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => onAvisar(p)} disabled={busy === p.id}>
                  Avisar que está pronto
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
