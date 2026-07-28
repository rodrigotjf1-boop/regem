'use client';

import { Pencil, Copy, EyeOff, Eye, Trash2, Link2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { KebabMenu } from '@/components/ui/kebab-menu';
import { brl } from '@/components/produtos/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Um produto está "pausado" quando não aparece em nenhum canal de venda.
const pausado = (p: any) => p.disponivelBalcao === false && p.disponivelCardapio === false;

export function ProdutosLista({
  produtos,
  onEditar,
  onRemover,
  onReativar,
  onDuplicar,
  onPausar,
  onCopiarLink,
}: {
  produtos: any[] | null;
  onEditar: (id: string) => void;
  onRemover: (id: string, nome: string) => void;
  onReativar?: (p: any, ativo: boolean) => void;
  onDuplicar?: (p: any) => void;
  onPausar?: (p: any, ativar: boolean) => void;
  onCopiarLink?: (p: any) => void;
}) {
  if (!produtos) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
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

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {produtos.map((p) => {
        const off = pausado(p);
        const esgotado = p.pausadoEstoque && !p.permiteNegativo;
        return (
          <div
            key={p.id}
            className={`flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-sm transition hover:border-primary/40 ${off ? 'opacity-70' : ''}`}
          >
            {p.imagemRef ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imagemRef} alt="" className="h-12 w-12 flex-none rounded-lg object-cover" />
            ) : (
              <span className="grid h-12 w-12 flex-none place-items-center rounded-lg bg-secondary text-lg text-muted-foreground">🍽</span>
            )}

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold" title={p.nome}>{p.nome}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-mono text-sm font-bold">{brl(Number(p.precoVenda))}</span>
                {p.codigo && <span className="font-mono text-[11px] text-muted-foreground">#{p.codigo}</span>}
                {p.tipo !== 'simples' && <span className="rounded bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">{p.tipo}</span>}
                {!p.fichaId && !p.itemId && p.controlaEstoque && (
                  <span className="rounded bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-warn">sem ficha</span>
                )}
              </div>
            </div>

            {/* Selo de status */}
            <span
              className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-bold ${
                esgotado
                  ? 'bg-destructive/10 text-destructive'
                  : off
                    ? 'bg-warn/15 text-warn'
                    : 'bg-ok/10 text-ok'
              }`}
            >
              {esgotado ? 'esgotado' : off ? 'pausado' : 'ativo'}
            </span>

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
      })}
    </div>
  );
}
