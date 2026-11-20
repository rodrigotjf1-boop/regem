'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "O QUE MOVE O CLIENTE" na ficha (F3 parte 2 do docs/plano-perfil-cliente.md, §4.7; protótipo, a camada "O que move a
// cliente"). Para cada tipo de evento medido: quantas vezes o normal ele pede nesses dias (contra ele mesmo, no mesmo dia da
// semana sem evento, encolhido para a média da loja), em quantos dias pediu e a chance de o efeito ser real. O selo só com
// prova (≥ 3 dias, chance ≥ 90% e o controle de falsos positivos do lote — o servidor decide). Tipo que não aparece: a loja
// não muda nesses dias, ou o cliente não pediu neles.

const NOME: Record<string, { tipo: string; selo: string }> = {
  dinheiro: { tipo: 'Dinheiro no bolso (salário, vale, 13º)', selo: 'Pede no dinheiro no bolso' },
  feriado: { tipo: 'Feriados', selo: 'Pede em feriado' },
  comemorativa: { tipo: 'Datas comemorativas', selo: 'Pede em data comemorativa' },
  loja: { tipo: 'Eventos da loja', selo: 'Pede nos eventos da loja' },
};
const vezes = (v: any) => `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×`;

export function OQueMove({ linhas }: { linhas: any[] | undefined }) {
  if (!linhas?.length)
    return (
      <p className="text-sm text-muted-foreground">
        Ainda sem padrão com feriados, datas comemorativas, dinheiro no bolso ou os eventos da loja. Jogos, clima e séries
        entram quando a base de eventos do Hub DMS estiver no ar.
      </p>
    );
  return (
    <ul className="space-y-2" aria-label="O que move o cliente">
      {linhas.map((l) => {
        const nome = NOME[l.tipo] ?? { tipo: l.tipo, selo: l.tipo };
        const prob = Math.round(Number(l.prob) * 100);
        const texto = l.selo
          ? `Pede ${vezes(l.rr)} o normal nesses dias · ${l.dias_com_pedido} dias com pedido · chance de efeito real ${prob}%`
          : l.dias_com_pedido < 3
            ? `${vezes(l.rr)} · dados insuficientes (${l.dias_com_pedido} de 3 dias com pedido)`
            : `${vezes(l.rr)} · sem diferença clara (chance de efeito real ${prob}%)`;
        return (
          <li key={l.tipo} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border p-2.5">
            <span className="min-w-0 flex-1 basis-60">
              <span className="block text-sm font-semibold">{nome.tipo}</span>
              <span className="block text-xs text-muted-foreground">{texto}</span>
            </span>
            {l.selo && <span className="rounded-full bg-ok/15 px-2.5 py-0.5 text-xs font-semibold text-foreground">{nome.selo}</span>}
          </li>
        );
      })}
    </ul>
  );
}
