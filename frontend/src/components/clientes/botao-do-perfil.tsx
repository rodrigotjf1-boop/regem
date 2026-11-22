'use client';

import { UserRound } from 'lucide-react';

// O atalho de perfil na lista de Delivery › Clientes: abre a ficha do perfil direto, sem passar pelo detalhe do cliente
// (pedido do dono em 22/11/2026). Fica dentro de uma linha clicável: o clique e o teclado não chegam à linha.
export function BotaoDoPerfil({ nome, aoAbrir }: { nome: string; aoAbrir: () => void }) {
  const rotulo = `Ver perfil de ${nome}`;
  return (
    <button
      type="button"
      title={rotulo}
      aria-label={rotulo}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8"
      onClick={(e) => {
        e.stopPropagation();
        aoAbrir();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <UserRound className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
