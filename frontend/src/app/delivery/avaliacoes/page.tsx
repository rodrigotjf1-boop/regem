'use client';

import { Shell } from '@/components/app-shell/shell';
import { Avaliacoes } from '@/components/delivery/avaliacoes/avaliacoes';

// Delivery › Avaliações (mig 453): as notas que os clientes deram aos pedidos do Regem. A permissão é a do Delivery; o
// servidor confere (RBAC no servidor) e devolve só a loja em uso do gerente.
export default function AvaliacoesPage() {
  return (
    <Shell eyebrow="Delivery" title="Avaliações">
      <Avaliacoes />
    </Shell>
  );
}
