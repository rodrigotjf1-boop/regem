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
// As opções saem em GRADE que se ajusta ao espaço (pedido do dono, 17/11/2026: a janela das etapas mais larga, sem tanta
// rolagem): duas, três ou quatro por linha na janela larga do balcão, uma por linha no celular do garçom — pela largura
// da própria janela, não da tela. Com foto no cadastro, a foto vai ao lado do nome.
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
  const obrigatoria = !!grupo.obrigatorio || Number(grupo.min) > 0;

  const alternar = (id: string) =>
    onMudar(escolhidas.includes(id) ? escolhidas.filter((x) => x !== id) : [...escolhidas, id]);
  const por = (id: string) => {
    if (!cheio) onMudar([...escolhidas, id]);
  };
  const tirar = (id: string) => {
    const i = escolhidas.lastIndexOf(id);
    if (i >= 0) onMudar([...escolhidas.slice(0, i), ...escolhidas.slice(i + 1)]);
  };

  const foto = (o: any) =>
    o.imagemRef ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={o.imagemRef} alt="" loading="lazy" decoding="async" className="h-11 w-11 flex-none rounded-md object-cover" />
    ) : null;

  return (
    <fieldset className="mb-4 min-w-0">
      <legend className="mb-2 flex w-full flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-display text-sm font-bold">{grupo.nome}</span>
        <span className="text-xs text-muted-foreground">
          {grupo.tipo === 'remover' ? 'retirar' : grupo.tipo === 'escolha' ? 'escolher' : 'adicionar'}
          {repete ? ` · pode repetir${grupo.max != null ? `, até ${grupo.max}` : ''}` : grupo.max != null ? ` · até ${grupo.max}` : ''}
        </span>
        {obrigatoria && (
          <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[11px] font-semibold text-warn">Obrigatório</span>
        )}
        {grupo.max != null && (
          <span className="ml-auto font-mono text-xs text-muted-foreground" aria-label={`${noGrupo} de ${grupo.max} escolhidas`}>
            {noGrupo}/{grupo.max}
          </span>
        )}
      </legend>
      <div
        className={`grid gap-2 ${
          repete
            ? 'grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))]'
            : 'grid-cols-[repeat(auto-fill,minmax(min(100%,12.5rem),1fr))]'
        }`}
      >
        {opcoes.map((o) => {
          const n = vezesDe(escolhidas, o.id);
          const preco = Number(o.precoDelta) > 0 && (
            <span className="block font-mono text-xs font-semibold text-primary">+ {brl(Number(o.precoDelta))}</span>
          );
          if (!repete)
            return (
              <label
                key={o.id}
                className={`flex min-h-14 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border p-2 transition-colors focus-within:ring-2 focus-within:ring-ring ${
                  n > 0 ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/60'
                }`}
              >
                <input
                  type="checkbox"
                  checked={n > 0}
                  onChange={() => alternar(o.id)}
                  className="h-4 w-4 flex-none accent-primary"
                />
                {foto(o)}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 break-words text-sm font-medium leading-tight">{o.nome}</span>
                  {preco}
                </span>
              </label>
            );
          return (
            <div
              key={o.id}
              className={`flex min-h-14 min-w-0 items-center gap-2.5 rounded-lg border p-1.5 pl-2 ${n > 0 ? 'border-primary bg-primary/10' : 'border-border'}`}
            >
              {foto(o)}
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 break-words text-sm font-medium leading-tight">{o.nome}</span>
                {preco}
              </span>
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
    </fieldset>
  );
}
