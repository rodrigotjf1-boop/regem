'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "O QUE OLHA NO CARDÁPIO" na ficha (F4b do docs/plano-perfil-cliente.md, §4.3; protótipo, camada 3 da ficha). Os
// produtos com mais pontos de interesse do cliente — só os cliques ligados a ele (quem entrou com o código e não desligou
// as "Recomendações", ligadas por padrão — D16) — e o "viu e não pediu" (abriu o mesmo produto 2 vezes ou mais em 30 dias e não pediu).
// O servidor decide tudo (`common/interesse-do-cliente.ts`); aqui só se mostra.

const pontos = (v: number) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function OQueOlha({ olha, recomendacoes }: { olha: any | null | undefined; recomendacoes: boolean }) {
  if (!recomendacoes)
    return (
      <p className="text-sm text-muted-foreground">
        O cliente desligou “Recomendações do meu jeito”. Os cliques dele contam só nos números anônimos da loja.
      </p>
    );
  if (olha === null) return <p className="text-sm text-muted-foreground">Não consegui ler esta camada agora. Feche e abra a ficha de novo.</p>;
  const itens: any[] = olha?.itens ?? [];
  if (!itens.length)
    return <p className="text-sm text-muted-foreground">Ainda sem cliques no cardápio Regem desde que ligou as recomendações.</p>;
  const max = Math.max(...itens.map((i) => Number(i.pontos) || 0), 0.1);
  return (
    <>
      <ul className="space-y-1.5" aria-label="O que olha no cardápio">
        {itens.map((i) => (
          <li key={i.produtoId} className="grid grid-cols-[minmax(0,1fr)_96px_40px] items-center gap-2 text-sm">
            <span className="min-w-0 break-words">
              {i.nome}
              {i.viuNaoPediu && (
                <>
                  {' '}
                  <span className="text-xs text-muted-foreground">(viu e não pediu)</span>
                </>
              )}
            </span>
            <span className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
              <span className="block h-full bg-primary" style={{ width: `${Math.max(3, Math.round((100 * Number(i.pontos)) / max))}%` }} />
            </span>
            <span className="text-right font-mono text-xs text-muted-foreground">{pontos(i.pontos)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Pontos de interesse com meia-vida de 14 dias: abrir vale 1, ficar 10 s vale 2, pôr no carrinho vale 4.
      </p>
    </>
  );
}
