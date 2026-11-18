'use client';

import Link from 'next/link';
import { Gaveta } from '@/components/ui/sobreposto';
import { Button } from '@/components/ui/button';
import { Selo, brl } from '@/components/ui/lista';
import { Estrelas } from './estrelas';
import { NOMES_DA_NOTA, porOnde, quandoFoi, type Avaliacao } from './tipos';

// A gaveta de uma avaliação (Delivery › Avaliações): a nota, o que pesou, o comentário, o pedido e o caso no Atendimento.
export function GavetaAvaliacao({ a, aoFechar }: { a: Avaliacao; aoFechar: () => void }) {
  const numero = a.pedido.numero ? `#${a.pedido.numero}` : 'sem número';
  const aberto = a.caso && a.caso.status !== 'resolvido';
  return (
    <Gaveta
      titulo={`Pedido ${numero}${a.pedido.cliente ? ` · ${a.pedido.cliente}` : ''}`}
      aoFechar={aoFechar}
      rodape={
        <Button type="button" variant="outline" onClick={aoFechar}>
          Fechar
        </Button>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="space-y-1">
          <Estrelas nota={a.nota} grande />
          <p>
            <strong>{NOMES_DA_NOTA[a.nota]}</strong> · {quandoFoi(a.em)} · {porOnde(a.origem)}
          </p>
        </div>

        <section aria-labelledby={`pesou-${a.id}`} className="space-y-1.5">
          <h3 id={`pesou-${a.id}`} className="text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
            O que mais pesou
          </h3>
          {a.pesou.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {a.pesou.map((p) => (
                <li key={p} className="rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-semibold">
                  {p}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-secondary-foreground">Não marcou.</p>
          )}
        </section>

        <section aria-labelledby={`coment-${a.id}`} className="space-y-1.5">
          <h3 id={`coment-${a.id}`} className="text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
            Comentário
          </h3>
          {a.comentario ? (
            <blockquote className="whitespace-pre-line break-words border-l-4 border-primary pl-3">“{a.comentario}”</blockquote>
          ) : (
            <p className="text-secondary-foreground">Sem comentário.</p>
          )}
        </section>

        <section aria-labelledby={`pedido-${a.id}`} className="space-y-1.5">
          <h3 id={`pedido-${a.id}`} className="text-xs font-semibold uppercase tracking-wide text-secondary-foreground">
            O pedido
          </h3>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
            <dt className="text-secondary-foreground">Itens</dt>
            <dd className="break-words">{a.pedido.itens || '—'}</dd>
            <dt className="text-secondary-foreground">Total</dt>
            <dd className="font-mono">{brl(a.pedido.total)}</dd>
            <dt className="text-secondary-foreground">Entregue em</dt>
            <dd className="font-mono">{a.pedido.minutos != null ? `${a.pedido.minutos} min` : '—'}</dd>
            <dt className="text-secondary-foreground">Canal</dt>
            <dd>Cardápio Regem</dd>
          </dl>
        </section>

        {a.caso && (
          <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">Caso “Avaliação” no Atendimento</p>
              <Selo tom={aberto ? 'aviso' : 'ok'}>{aberto ? 'aberto' : 'resolvido'}</Selo>
            </div>
            <Link
              href={`/atendimento?caso=${encodeURIComponent(a.caso.id)}`}
              className="inline-flex min-h-10 items-center rounded-md border border-input px-3 text-sm font-semibold hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Abrir no Atendimento
            </Link>
          </section>
        )}
      </div>
    </Gaveta>
  );
}
