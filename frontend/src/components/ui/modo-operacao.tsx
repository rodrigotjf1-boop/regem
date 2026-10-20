'use client';

import { ServidorStatus } from '@/components/ui/servidor-status';

// Indicador BEM VISÍVEL do modo de operação, para o operador sempre saber onde
// está: 🖥️ Local (servidor da loja, offline-first) ou ☁️ Nuvem (espelho online).
// O modo é decidido no build (NEXT_PUBLIC_EDGE=1 no app servido pelo edge) — não é
// um toggle em runtime, então não há como "alternar por engano".
//
// No modo LOCAL, o lugar do selo "Modo local" é do indicador "● Servidor da loja" (conexão PC ↔
// servidor, protótipo aprovado em 20/10/2026): além de dizer que é o local, prova que este PC fala com
// o servidor e mostra o detalhe ao clicar. Na nuvem segue o selo "Modo nuvem".
const EDGE = process.env.NEXT_PUBLIC_EDGE === '1';

export function ModoOperacao({ className = '' }: { className?: string }) {
  if (EDGE) return <ServidorStatus />;
  return (
    <span
      title="Operando na NUVEM (espelho online)."
      className={`inline-flex select-none items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-bold bg-sky-500/15 text-sky-700 ring-1 ring-sky-500/30 dark:text-sky-400 ${className}`}
    >
      <span aria-hidden>☁️</span>
      Modo nuvem
    </span>
  );
}
