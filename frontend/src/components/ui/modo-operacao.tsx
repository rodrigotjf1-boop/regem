'use client';

// Indicador BEM VISÍVEL do modo de operação, para o operador sempre saber onde
// está: 🖥️ Local (servidor da loja, offline-first) ou ☁️ Nuvem (espelho online).
// O modo é decidido no build (NEXT_PUBLIC_EDGE=1 no app servido pelo edge) — não é
// um toggle em runtime, então não há como "alternar por engano".
const EDGE = process.env.NEXT_PUBLIC_EDGE === '1';

export function ModoOperacao({ className = '' }: { className?: string }) {
  const local = EDGE;
  return (
    <span
      title={
        local
          ? 'Operando no SERVIDOR LOCAL da loja (funciona sem internet).'
          : 'Operando na NUVEM (espelho online).'
      }
      className={`inline-flex select-none items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-bold ${
        local
          ? 'bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-400'
          : 'bg-sky-500/15 text-sky-700 ring-1 ring-sky-500/30 dark:text-sky-400'
      } ${className}`}
    >
      <span aria-hidden>{local ? '🖥️' : '☁️'}</span>
      {local ? 'Modo local' : 'Modo nuvem'}
    </span>
  );
}
