'use client';

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Selo, texto2 } from '@/components/ui/lista';
import { cn } from '@/lib/utils';
import { ehDespacho, opcoesDoVai, type Edicao, type KdsDaRota, type Movimento } from '@/lib/rota-cozinha';

/**
 * Um KDS no modo "Editar a ordem": arrastável, com "Antes", "Depois", "Junto com…" e "Tirar da rota", e o "vai para"
 * (só para um KDS de uma etapa depois). O despacho fica na última etapa e não manda a ninguém.
 */
export function BlocoEdicao({
  k,
  i,
  ed,
  kds,
  horizontal,
  juntoAberto,
  pegado,
  aoMover,
  aoTirar,
  aoJunto,
  aoVai,
  aoPegar,
  aoSoltar,
}: {
  k: KdsDaRota;
  i: number;
  ed: Edicao;
  kds: KdsDaRota[];
  horizontal: boolean;
  juntoAberto: boolean;
  pegado: boolean;
  aoMover: (mov: Movimento) => void;
  aoTirar: () => void;
  aoJunto: () => void;
  aoVai: (alvo: string | null) => void;
  aoPegar: () => void;
  aoSoltar: () => void;
}) {
  const desp = ehDespacho(k);
  const ultimo = i === ed.etapas.length - 1;
  const sozinho = ed.etapas[i].kds.length === 1;
  const nome = (id: string) => kds.find((x) => x.id === id)?.nome ?? 'KDS';
  const opcoes = opcoesDoVai(ed, k.id);
  const outros = ed.etapas.flatMap((e, j) => (j === i ? [] : e.kds.map((x) => ({ id: x, etapa: j }))));
  const erro = desp && !ultimo;
  const idVai = `vai-${k.id}`;
  const Antes = horizontal ? ArrowLeft : ArrowUp;
  const Depois = horizontal ? ArrowRight : ArrowDown;
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', k.id);
        aoPegar();
      }}
      onDragEnd={aoSoltar}
      aria-label={`${k.nome}, etapa ${i + 1}`}
      className={cn(
        'grid min-w-0 grid-cols-[minmax(0,1fr)] cursor-grab content-start gap-2 rounded-xl border bg-card p-3',
        desp && 'border-primary',
        !k.ativo && 'border-dashed bg-secondary',
        pegado && 'opacity-50',
        erro && 'shadow-[inset_0_0_0_2px_hsl(var(--destructive))]',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="min-w-0">
          <span className={`flex items-center gap-1 text-xs font-extrabold uppercase tracking-wider ${texto2}`}>
            <GripVertical className="h-4 w-4 flex-none" aria-hidden="true" /> KDS · {desp ? 'despacho' : 'estação de preparo'}
          </span>
          <h4 className="font-display text-lg font-extrabold leading-tight [overflow-wrap:anywhere]">{k.nome}</h4>
        </div>
        {!k.ativo && <Selo tom="aviso">Desligado</Selo>}
      </header>
      {desp ? (
        <p className={`text-sm ${texto2}`}>Ao despachar: termina aqui e chama a senha na TV. Fica sempre na última etapa.</p>
      ) : (
        <div className="grid gap-1">
          <label htmlFor={idVai} className="text-xs font-extrabold">
            Quando ficar pronto, vai para
          </label>
          <select
            id={idVai}
            value={ed.vai[k.id] ?? ''}
            onChange={(e) => aoVai(e.target.value || null)}
            className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Termina aqui</option>
            {opcoes.map((o) => (
              <option key={o.id} value={o.id}>
                {nome(o.id)} (etapa {o.etapa})
              </option>
            ))}
          </select>
        </div>
      )}
      {erro && (
        <p className="text-sm font-bold text-destructive" role="status">
          O despacho só pode ficar na última etapa: assim não dá para salvar.
        </p>
      )}
      <div role="group" aria-label={`Mover ${k.nome}`} className="flex flex-wrap gap-1.5">
        <Button type="button" variant="outline" size="sm" className="flex-auto" disabled={sozinho && i === 0} aria-label={`Mover ${k.nome} para antes`} onClick={() => aoMover({ tipo: 'antes' })}>
          <Antes className="h-4 w-4" aria-hidden="true" /> Antes
        </Button>
        <Button type="button" variant="outline" size="sm" className="flex-auto" disabled={sozinho && ultimo} aria-label={`Mover ${k.nome} para depois`} onClick={() => aoMover({ tipo: 'depois' })}>
          Depois <Depois className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button type="button" variant="outline" size="sm" className={cn('flex-auto', juntoAberto && 'ring-1 ring-foreground')} disabled={!outros.length} aria-expanded={juntoAberto} onClick={aoJunto}>
          Junto com…
        </Button>
        <Button type="button" variant="outline" size="sm" className="flex-auto" onClick={aoTirar}>
          Tirar da rota
        </Button>
      </div>
      {juntoAberto && (
        <div role="group" aria-label={`Pôr ${k.nome} na mesma etapa de outro KDS`} className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-dashed p-2">
          <span className={`w-full text-xs font-extrabold ${texto2}`}>Na mesma etapa de (em paralelo):</span>
          {outros.map((o) => (
            <Button key={o.id} type="button" variant="outline" size="sm" className="h-auto min-h-11 whitespace-normal text-left [overflow-wrap:anywhere]" onClick={() => aoMover({ tipo: 'junto', etapa: o.etapa })}>
              {nome(o.id)} · etapa {o.etapa + 1}
            </Button>
          ))}
        </div>
      )}
    </article>
  );
}
