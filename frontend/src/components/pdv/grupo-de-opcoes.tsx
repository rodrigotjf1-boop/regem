'use client';

import { Minus, Plus } from 'lucide-react';
import { permiteRepetir, vezesDe } from '@/lib/adicionais';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Uma etapa de opções do produto no seletor do balcão e da mesa/garçom.
// Etapa comum: marcar/desmarcar, como sempre. Etapa "com repetição" (definida no complemento do
// catálogo): a mesma opção pode entrar mais de uma vez — "+1 fatia de bacon" duas vezes —, com
// − n + como no cardápio do cliente. `escolhidas` é a lista inteira do item (o id repetido conta).
export function GrupoDeOpcoes({
  grupo,
  escolhidas,
  onMudar,
}: {
  grupo: any;
  escolhidas: string[];
  onMudar: (novas: string[]) => void;
}) {
  const opcoes: any[] = grupo.opcoes ?? [];
  const repete = permiteRepetir(grupo);
  const noGrupo = escolhidas.filter((id) => opcoes.some((o) => o.id === id)).length;
  // Máximo da etapa: vale para a soma das escolhas dela (a mesma conta do cardápio).
  const cheio = grupo.max != null && noGrupo >= Number(grupo.max);

  const alternar = (id: string) =>
    onMudar(escolhidas.includes(id) ? escolhidas.filter((x) => x !== id) : [...escolhidas, id]);
  const por = (id: string) => {
    if (!cheio) onMudar([...escolhidas, id]);
  };
  const tirar = (id: string) => {
    const i = escolhidas.lastIndexOf(id);
    if (i >= 0) onMudar([...escolhidas.slice(0, i), ...escolhidas.slice(i + 1)]);
  };

  return (
    <div className="mb-3">
      <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
        {grupo.nome}{' '}
        <span className="font-normal">
          ({grupo.tipo === 'remover' ? 'retirar' : 'adicionar'}
          {repete ? ` · pode repetir${grupo.max != null ? `, até ${grupo.max}` : ''}` : ''})
        </span>
      </p>
      <div className="space-y-1">
        {opcoes.map((o) => {
          const n = vezesDe(escolhidas, o.id);
          const preco = Number(o.precoDelta) > 0 && (
            <span className="font-mono text-xs text-primary">+ {brl(Number(o.precoDelta))}</span>
          );
          if (!repete)
            return (
              <label
                key={o.id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 ${n > 0 ? 'border-primary bg-primary/10' : 'border-border'}`}
              >
                <input
                  type="checkbox"
                  checked={n > 0}
                  onChange={() => alternar(o.id)}
                  className="h-4 w-4 accent-primary"
                />
                <span className="flex-1 text-sm">{o.nome}</span>
                {preco}
              </label>
            );
          return (
            <div
              key={o.id}
              className={`flex items-center gap-2 rounded-lg border p-1.5 pl-2.5 ${n > 0 ? 'border-primary bg-primary/10' : 'border-border'}`}
            >
              <span className="min-w-0 flex-1 text-sm">{o.nome}</span>
              {preco}
              <div className="flex flex-none items-center gap-1">
                <button
                  type="button"
                  onClick={() => tirar(o.id)}
                  disabled={n === 0}
                  aria-label={`Tirar ${o.nome}`}
                  className="grid h-9 w-9 place-items-center rounded-md border border-border bg-card text-foreground disabled:opacity-35"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-6 text-center font-mono text-sm font-bold" aria-live="polite" aria-label={`${n} de ${o.nome}`}>
                  {n}
                </span>
                <button
                  type="button"
                  onClick={() => por(o.id)}
                  disabled={cheio}
                  aria-label={`Pôr ${o.nome}`}
                  className="grid h-9 w-9 place-items-center rounded-md border border-border bg-card text-foreground disabled:opacity-35"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
