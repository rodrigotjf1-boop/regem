'use client';

import { Pencil, Copy, EyeOff, Eye, Trash2, Link2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { KebabMenu } from '@/components/ui/kebab-menu';
import { brl } from '@/components/produtos/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Um produto está "pausado" quando não aparece em nenhum canal de venda.
const pausado = (p: any) => p.disponivelBalcao === false && p.disponivelCardapio === false;
const SEM_CAT = '__sem_categoria__';

export function ProdutosLista({
  produtos,
  categorias,
  onEditar,
  onRemover,
  onReativar,
  onDuplicar,
  onPausar,
  onCopiarLink,
}: {
  produtos: any[] | null;
  categorias: any[];
  onEditar: (id: string) => void;
  onRemover: (id: string, nome: string) => void;
  onReativar?: (p: any, ativo: boolean) => void;
  onDuplicar?: (p: any) => void;
  onPausar?: (p: any, ativar: boolean) => void;
  onCopiarLink?: (p: any) => void;
}) {
  if (!produtos) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-3">
            <Skeleton className="h-12 w-12 rounded-lg" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (produtos.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum produto nesta categoria.</p>;
  }

  // Agrupa os produtos por categoria, seguindo a MESMA ordem da barra lateral
  // (campo `ordem`, reordenável por arraste); os sem categoria vão por último.
  const ordenadas = [...categorias].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const ordem = [...ordenadas, { id: SEM_CAT, nome: 'Sem categoria' }];
  const grupos = ordem
    .map((c) => ({
      cat: c,
      itens: produtos.filter((p) => (p.categoriaId || SEM_CAT) === c.id),
    }))
    .filter((g) => g.itens.length > 0);

  return (
    <div className="space-y-6">
      {grupos.map(({ cat, itens }) => (
        <section key={cat.id}>
          <div className="mb-2 flex items-center gap-2 px-0.5">
            <h3 className="font-display text-sm font-bold">{cat.nome}</h3>
            <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              {itens.length} {itens.length === 1 ? 'item' : 'itens'}
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {itens.map((p, i) => (
              <ProdutoRow
                key={p.id}
                p={p}
                primeiro={i === 0}
                onEditar={onEditar}
                onRemover={onRemover}
                onReativar={onReativar}
                onDuplicar={onDuplicar}
                onPausar={onPausar}
                onCopiarLink={onCopiarLink}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ProdutoRow({
  p,
  primeiro,
  onEditar,
  onRemover,
  onReativar,
  onDuplicar,
  onPausar,
  onCopiarLink,
}: {
  p: any;
  primeiro: boolean;
  onEditar: (id: string) => void;
  onRemover: (id: string, nome: string) => void;
  onReativar?: (p: any, ativo: boolean) => void;
  onDuplicar?: (p: any) => void;
  onPausar?: (p: any, ativar: boolean) => void;
  onCopiarLink?: (p: any) => void;
}) {
  const off = pausado(p);
  const esgotado = p.pausadoEstoque && !p.permiteNegativo;
  const promo = p.precoPromocional != null && Number(p.precoPromocional) > 0;

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-secondary/40 ${
        primeiro ? '' : 'border-t border-border'
      } ${off ? 'opacity-60' : ''}`}
    >
      {p.imagemRef ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.imagemRef} alt="" className="h-11 w-11 flex-none rounded-lg object-cover" />
      ) : (
        <span className="grid h-11 w-11 flex-none place-items-center rounded-lg bg-secondary text-lg text-muted-foreground">🍽</span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" title={p.nome}>{p.nome}</p>
        {p.descricao && (
          <p className="truncate text-xs text-muted-foreground" title={p.descricao}>{p.descricao}</p>
        )}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {p.codigo && <span className="font-mono text-[11px] text-muted-foreground">#{p.codigo}</span>}
          {p.tipo !== 'simples' && (
            <span className="rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">{p.tipo}</span>
          )}
          {!p.fichaId && !p.itemId && p.controlaEstoque && (
            <span className="rounded bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-warn">sem ficha</span>
          )}
          {esgotado && (
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold text-destructive">esgotado</span>
          )}
        </div>
      </div>

      {/* Preço (com "de/por" quando há promocional) */}
      <div className="flex-none text-right">
        {promo && (
          <span className="block font-mono text-[11px] text-muted-foreground line-through">
            {brl(Number(p.precoVenda))}
          </span>
        )}
        <span className="font-mono text-sm font-bold">
          {brl(Number(promo ? p.precoPromocional : p.precoVenda))}
        </span>
      </div>

      {/* Toggle de disponibilidade (ocultar/retomar nos dois canais) */}
      {onPausar && (
        <button
          type="button"
          role="switch"
          aria-checked={!off}
          aria-label={off ? `Retomar ${p.nome}` : `Ocultar ${p.nome}`}
          title={off ? 'Pausado — clique para retomar' : 'Disponível — clique para ocultar'}
          onClick={() => onPausar(p, off)}
          className={`relative h-5 w-9 flex-none rounded-full transition-colors ${off ? 'bg-muted-foreground/35' : 'bg-ok'}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${off ? 'left-0.5' : 'left-4'}`}
          />
        </button>
      )}

      <KebabMenu
        label={`Ações de ${p.nome}`}
        items={[
          { label: 'Editar', icon: <Pencil className="h-4 w-4" />, onClick: () => onEditar(p.id) },
          { label: 'Duplicar', icon: <Copy className="h-4 w-4" />, onClick: () => onDuplicar?.(p), hidden: !onDuplicar },
          off
            ? { label: 'Retomar', icon: <Eye className="h-4 w-4" />, onClick: () => onPausar?.(p, true), hidden: !onPausar }
            : { label: 'Ocultar', icon: <EyeOff className="h-4 w-4" />, onClick: () => onPausar?.(p, false), hidden: !onPausar },
          { label: 'Reativar estoque', icon: <Eye className="h-4 w-4" />, onClick: () => onReativar?.(p, true), hidden: !(onReativar && esgotado) },
          { label: 'Copiar link', icon: <Link2 className="h-4 w-4" />, onClick: () => onCopiarLink?.(p), hidden: !onCopiarLink },
          { label: 'Excluir', icon: <Trash2 className="h-4 w-4" />, onClick: () => onRemover(p.id, p.nome), destructive: true },
        ]}
      />
    </div>
  );
}
