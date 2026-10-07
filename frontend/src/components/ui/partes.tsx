'use client';

// Faixa de PARTES de uma tela que tem mais de uma lista ou grupo de ajustes (ex.: Produção & KDS →
// "Ajustes do KDS" e "Destino por setor"). Cada parte mostra a quantidade do que ela tem. Mesmo
// desenho da faixa de abas do Estoque: rola na horizontal no celular, quebra a linha no computador.
export function Partes<K extends string>({
  partes,
  ativa,
  aoEscolher,
  rotulo,
}: {
  partes: { key: K; label: string; conta?: number | null }[];
  ativa: K;
  aoEscolher: (parte: K) => void;
  /** Nome do grupo para leitor de tela ("Partes de Produção & KDS"). */
  rotulo: string;
}) {
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" role="group" aria-label={rotulo}>
      {partes.map((p) => {
        const ligada = p.key === ativa;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => aoEscolher(p.key)}
            aria-pressed={ligada ? 'true' : 'false'}
            className={`inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              ligada
                ? 'border-primary bg-primary font-bold text-primary-foreground'
                : 'border-input bg-card font-semibold text-secondary-foreground hover:border-secondary-foreground hover:text-foreground'
            }`}
          >
            {p.label}
            {p.conta != null && (
              <span className={`rounded-full px-2 py-px font-mono text-xs ${ligada ? 'bg-primary-foreground/15' : 'bg-secondary text-foreground'}`}>{p.conta}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
