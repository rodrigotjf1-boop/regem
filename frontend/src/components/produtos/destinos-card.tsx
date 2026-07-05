'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function DestinosCard({
  equipamentos,
  destinosSel,
  toggleDestino,
  salvandoDest,
  onSalvar,
}: {
  equipamentos: any[];
  destinosSel: string[];
  toggleDestino: (id: string) => void;
  salvandoDest: boolean;
  onSalvar: () => void;
}) {
  return (
    <Card className="p-4">
      <h2 className="font-display text-lg font-semibold">Destinos de produção</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Para onde este produto vai ao ser vendido: um ou mais KDS e/ou impressoras. Sem seleção, herda o padrão do setor de produção.
      </p>
      {equipamentos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum KDS/impressora cadastrado. Cadastre em Cadastros → Equipamentos.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {equipamentos.map((e) => (
              <label
                key={e.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm ${destinosSel.includes(e.id) ? 'border-primary bg-primary/10' : 'border-border'}`}
              >
                <input
                  type="checkbox"
                  checked={destinosSel.includes(e.id)}
                  onChange={() => toggleDestino(e.id)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="flex-1">{e.nome}</span>
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {e.tipo === 'impressora' ? 'impressora' : 'KDS'}
                </span>
              </label>
            ))}
          </div>
          <Button type="button" className="mt-3" onClick={onSalvar} disabled={salvandoDest}>
            {salvandoDest ? 'Salvando…' : 'Salvar destinos'}
          </Button>
        </>
      )}
    </Card>
  );
}
