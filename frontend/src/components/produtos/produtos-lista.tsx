'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { brl } from '@/components/produtos/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function ProdutosLista({
  produtos,
  onEditar,
  onRemover,
  onReativar,
}: {
  produtos: any[] | null;
  onEditar: (id: string) => void;
  onRemover: (id: string, nome: string) => void;
  onReativar?: (p: any, ativo: boolean) => void;
}) {
  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-medium text-muted-foreground">
        Produtos {produtos ? `(${produtos.length})` : ''}
      </p>
      {!produtos && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="mt-2 h-3 w-1/4" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      )}
      {produtos?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum produto cadastrado.</p>}
      <div className="space-y-2">
        {produtos?.map((p) => (
          <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.nome}</span>
                {p.codigo && <span className="font-mono text-[11px] text-muted-foreground">{p.codigo}</span>}
                {p.categoriaNome && <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">{p.categoriaNome}</span>}
                {p.tipo !== 'simples' && <span className="rounded bg-info/10 px-1.5 py-0.5 text-xs text-info">{p.tipo}</span>}
                {!p.fichaId && p.controlaEstoque && <span className="rounded bg-warn/10 px-1.5 py-0.5 text-xs text-warn">sem ficha</span>}
                {(p.pausadoEstoque || p.disponivelCardapio === false) && !p.permiteNegativo && (
                  <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive">
                    Esgotado{p.pausadoEstoque ? ' (estoque)' : ''}
                  </span>
                )}
                {p.permiteNegativo && (
                  <span className="rounded bg-warn/10 px-1.5 py-0.5 text-xs font-semibold text-warn">
                    contagem negativa
                  </span>
                )}
              </div>
            </div>
            <span className="font-mono text-sm font-bold">{brl(Number(p.precoVenda))}</span>
            {/* Reativar esgotado sem estoque (contagem negativa) / voltar a controlar */}
            {onReativar && p.pausadoEstoque && !p.permiteNegativo && (
              <Button type="button" size="sm" variant="outline" onClick={() => onReativar(p, true)}>
                Reativar
              </Button>
            )}
            {onReativar && p.permiteNegativo && (
              <Button type="button" size="sm" variant="ghost" onClick={() => onReativar(p, false)}>
                Voltar a controlar
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={() => onEditar(p.id)}>Editar</Button>
            <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => onRemover(p.id, p.nome)}>×</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
