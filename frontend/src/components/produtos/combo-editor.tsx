'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { selectCls, type Combo } from '@/components/produtos/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function ComboEditor({
  f,
  set,
  produtos,
  editId,
}: {
  f: any;
  set: (patch: any) => void;
  produtos: any[] | null;
  editId: string | null;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <Label className="text-xs">Componentes do combo</Label>
        <Button type="button" variant="ghost" size="sm" onClick={() => set({ combo: [...f.combo, { componenteProdutoId: '', quantidade: '1' }] })}>
          ＋ item
        </Button>
      </div>
      {f.combo.map((c: Combo, i: number) => (
        <div key={i} className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <select className={`${selectCls} sm:col-span-2`} value={c.componenteProdutoId} onChange={(e) => { const a = [...f.combo]; a[i] = { ...c, componenteProdutoId: e.target.value }; set({ combo: a }); }}>
            <option value="">— produto —</option>
            {(produtos ?? []).filter((p) => p.id !== editId).map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <Input type="number" placeholder="Qtd" value={c.quantidade} onChange={(e) => { const a = [...f.combo]; a[i] = { ...c, quantidade: e.target.value }; set({ combo: a }); }} />
            <Button type="button" variant="ghost" size="sm" onClick={() => set({ combo: f.combo.filter((_: any, x: number) => x !== i) })}>×</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
