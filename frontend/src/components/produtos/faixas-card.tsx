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
  faixas: { qtdMin: string; descontoPct: string }[];
  setFaixas: (v: { qtdMin: string; descontoPct: string }[]) => void;
  onSalvar: () => void;
}) {
  return (
    <Card className="p-4">
      <h2 className="font-display text-lg font-semibold">Atacado — desconto por volume</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Desconto progressivo por quantidade: <b>a partir de N unidades</b>, aplica o % da faixa.
        Vale a maior faixa cuja quantidade mínima seja ≤ à quantidade vendida.
        Requer o produto com <b>“Ativar preço de atacado”</b> ligado.
      </p>
      <div className="space-y-2">
        {faixas.map((fx, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Input
              type="number"
              inputMode="numeric"
              placeholder="A partir de (un)"
              value={fx.qtdMin}
              onChange={(e) => { const a = [...faixas]; a[i] = { ...fx, qtdMin: e.target.value }; setFaixas(a); }}
            />
            <Input
              type="number"
              inputMode="decimal"
              placeholder="% de desconto"
              value={fx.descontoPct}
              onChange={(e) => { const a = [...faixas]; a[i] = { ...fx, descontoPct: e.target.value }; setFaixas(a); }}
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => setFaixas(faixas.filter((_, x) => x !== i))}>remover</Button>
          </div>
        ))}
        {faixas.length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhuma faixa. Ex.: a partir de 15 un → 5%; a partir de 30 un → 8%.</p>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setFaixas([...faixas, { qtdMin: '', descontoPct: '' }])}>＋ faixa</Button>
        <Button type="button" size="sm" onClick={onSalvar}>Salvar faixas</Button>
      </div>
    </Card>
  );
}
