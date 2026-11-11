'use client';

import { cn } from '@/lib/utils';

// O "No ar / Pausado" de um canal (Gestão do catálogo › Produtos e preços). Um botão de liga/desliga (`aria-pressed` =
// pausado); a bolinha dá a cor, o texto fica em tinta (contraste nos dois estados).
export function ChipPausa({
  pausado,
  onde,
  nome,
  ocupado = false,
  aoMudar,
}: {
  pausado: boolean;
  /** "no Regem" / "no iFood": entra no rótulo do leitor de tela. */
  onde: string;
  nome: string;
  ocupado?: boolean;
  aoMudar: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pausado}
      aria-label={`Pausado ${onde}: ${nome}`}
      disabled={ocupado}
      onClick={aoMudar}
      className={cn(
        'inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
        pausado ? 'border-warn bg-warn/15 text-foreground' : 'border-input bg-card text-foreground hover:bg-secondary',
      )}
    >
      <span className={cn('h-2 w-2 flex-none rounded-full', pausado ? 'bg-warn' : 'bg-ok')} aria-hidden="true" />
      {ocupado ? 'Salvando…' : pausado ? 'Pausado' : 'No ar'}
    </button>
  );
}
