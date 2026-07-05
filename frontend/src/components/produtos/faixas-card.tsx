'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function FaixasCard({
  faixas,
  setFaixas,
  onSalvar,
}: {
  faixas: { qtdMin: string; preco: string }[];
  setFaixas: (v: { qtdMin: string; preco: string }[]) => void;
  onSalvar: () => void;
}) {
  return (
    <Card className="p-4">
      <h2 className="font-display text-lg font-semibold">Preço por volume (B2B)</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Preço unitário por faixa de quantidade (atacado/indústria). O maior <b>qtd. mínima</b> ≤ quantidade vendida é aplicado.
      </p>
      <div className="space-y-2">
        {faixas.map((fx, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Input type="number" placeholder="Qtd. mínima" value={fx.qtdMin} onChange={(e) => { const a = [...faixas]; a[i] = { ...fx, qtdMin: e.target.value }; setFaixas(a); }} />
            <Input type="number" placeholder="Preço/un" value={fx.preco} onChange={(e) => { const a = [...faixas]; a[i] = { ...fx, preco: e.target.value }; setFaixas(a); }} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setFaixas(faixas.filter((_, x) => x !== i))}>remover</Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setFaixas([...faixas, { qtdMin: '', preco: '' }])}>＋ faixa</Button>
        <Button type="button" size="sm" onClick={onSalvar}>Salvar faixas</Button>
      </div>
    </Card>
  );
}
