'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Variacao } from '@/components/produtos/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function VariacoesEditor({
  f,
  set,
}: {
  f: any;
  set: (patch: any) => void;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <Label className="text-xs">Variações (tamanho/unidade · grade)</Label>
        <Button type="button" variant="ghost" size="sm" onClick={() => set({ variacoes: [...f.variacoes, { nome: '', codigo: '', precoVenda: '', fatorFicha: '1', tamanho: '', cor: '' }] })}>
          ＋ variação
        </Button>
      </div>
      {f.variacoes.length === 0 && <p className="text-xs text-muted-foreground">Ex.: 300ml, 500ml — ou grade tamanho×cor (varejo). Cada uma com preço e SKU.</p>}
      {f.variacoes.map((v: Variacao, i: number) => (
        <div key={i} className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-7">
          <Input placeholder="Nome" value={v.nome} onChange={(e) => { const a = [...f.variacoes]; a[i] = { ...v, nome: e.target.value }; set({ variacoes: a }); }} />
          <Input placeholder="Tamanho" value={v.tamanho} onChange={(e) => { const a = [...f.variacoes]; a[i] = { ...v, tamanho: e.target.value }; set({ variacoes: a }); }} />
          <Input placeholder="Cor" value={v.cor} onChange={(e) => { const a = [...f.variacoes]; a[i] = { ...v, cor: e.target.value }; set({ variacoes: a }); }} />
          <Input placeholder="SKU" value={v.codigo} onChange={(e) => { const a = [...f.variacoes]; a[i] = { ...v, codigo: e.target.value }; set({ variacoes: a }); }} />
          <Input type="number" placeholder="Preço" value={v.precoVenda} onChange={(e) => { const a = [...f.variacoes]; a[i] = { ...v, precoVenda: e.target.value }; set({ variacoes: a }); }} />
          <Input type="number" placeholder="Fator ficha" value={v.fatorFicha} onChange={(e) => { const a = [...f.variacoes]; a[i] = { ...v, fatorFicha: e.target.value }; set({ variacoes: a }); }} />
          <Button type="button" variant="ghost" size="sm" onClick={() => set({ variacoes: f.variacoes.filter((_: any, x: number) => x !== i) })}>remover</Button>
        </div>
      ))}
    </div>
  );
}
