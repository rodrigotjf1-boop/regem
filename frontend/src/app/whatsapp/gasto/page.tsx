'use client';

import { useEffect, useState } from 'react';
import { getCategoria, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import { NO_SERVIDOR_DA_LOJA } from '@/components/ui/so-pela-nuvem';
import { GastoDoWhatsapp } from '@/components/whatsapp/gasto/gasto-do-whatsapp';

// WHATSAPP › USO E GASTO (G1 do protótipo `mockups/regem-whatsapp-gasto.html`, aprovado em 18/11/2026; mig 445). Só o
// presidente (decisão 2) e só na nuvem (quem lê a Meta é ela): aqui a tela só explica; o servidor barra de verdade.
export default function UsoEGastoDoWhatsappPage() {
  const [cat, setCat] = useState<string | null>(null);
  useEffect(() => {
    if (getToken()) setCat(getCategoria() ?? '');
  }, []);

  let corpo: React.ReactNode;
  if (NO_SERVIDOR_DA_LOJA)
    corpo = (
      <EmptyState
        icon="☁️"
        title="O gasto do WhatsApp oficial fica na nuvem."
        description="Abra o Regem na nuvem (app.dmsregem.com), menu WhatsApp, botão Uso e gasto."
      />
    );
  else if (cat === null) corpo = <SkeletonList rows={3} />;
  else if (cat !== 'presidente') corpo = <EmptyState icon="🔒" title="Só o presidente vê o gasto do WhatsApp oficial." description="É o que a Meta cobra no cartão da empresa." />;
  else corpo = <GastoDoWhatsapp />;

  return (
    <Shell eyebrow="WhatsApp" title="Uso e gasto do WhatsApp oficial">
      {corpo}
    </Shell>
  );
}
