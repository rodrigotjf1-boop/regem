'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { SELOS } from '@/components/produtos/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function LojaFields({
  f,
  set,
}: {
  f: any;
  set: (patch: any) => void;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <Label className="text-xs">Loja / cardápio digital</Label>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-3">
          <Label className="text-xs text-muted-foreground">Foto do produto</Label>
          <ImageUpload value={f.imagemRef || undefined} onChange={(url) => set({ imagemRef: url })} alt={f.nome || 'produto'} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Preço promocional (de/por)</Label>
          <Input type="number" value={f.precoPromocional} onChange={(e) => set({ precoPromocional: e.target.value })} placeholder="opcional" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Duração (min) — serviços</Label>
          <Input type="number" value={f.duracaoMin} onChange={(e) => set({ duracaoMin: e.target.value })} placeholder="—" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Vende em múltiplos de (B2B)</Label>
          <Input type="number" value={f.vendaMultiplo} onChange={(e) => set({ vendaMultiplo: e.target.value })} placeholder="1" />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {SELOS.map((s) => {
          const on = f.selos.includes(s.v);
          return (
            <button
              key={s.v}
              type="button"
              onClick={() => set({ selos: on ? f.selos.filter((x: string) => x !== s.v) : [...f.selos, s.v] })}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}
            >
              {s.l}
            </button>
          );
        })}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.disponivelCardapio} onChange={(e) => set({ disponivelCardapio: e.target.checked })} className="h-4 w-4 accent-primary" />
        Disponível no cardápio (desmarque para bloquear a venda online)
      </label>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.destaque} onChange={(e) => set({ destaque: e.target.checked })} className="h-4 w-4 accent-primary" />
        Produto em destaque (sugerido no carrinho — “peça também”)
      </label>
    </div>
  );
}
