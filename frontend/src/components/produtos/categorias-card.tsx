'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { selectCls } from '@/components/produtos/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function CategoriasCard({
  categorias,
  catNome,
  setCatNome,
  catParent,
  setCatParent,
  onAdd,
  catLabel,
}: {
  categorias: any[];
  catNome: string;
  setCatNome: (v: string) => void;
  catParent: string;
  setCatParent: (v: string) => void;
  onAdd: () => void;
  catLabel: (c: any) => string;
}) {
  return (
    <Card className="p-4">
      <h2 className="mb-2 font-display text-sm font-bold">Categorias</h2>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Nova categoria / subcategoria</Label>
          <Input value={catNome} onChange={(e) => setCatNome(e.target.value)} placeholder="Ex.: Bebidas" />
        </div>
        <select className={`${selectCls} w-40`} value={catParent} onChange={(e) => setCatParent(e.target.value)}>
          <option value="">— categoria raiz —</option>
          {categorias.filter((c) => !c.parentId).map((c) => (
            <option key={c.id} value={c.id}>sub de {c.nome}</option>
          ))}
        </select>
        <Button type="button" onClick={onAdd}>Adicionar</Button>
      </div>
      {categorias.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {categorias.map((c) => (
            <span key={c.id} className="rounded bg-secondary px-2 py-1 text-xs text-secondary-foreground">
              {catLabel(c)}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
