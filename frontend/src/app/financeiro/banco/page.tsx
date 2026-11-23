'use client';

import { useEffect, useState } from 'react';
import { getCategoria, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import { NO_SERVIDOR_DA_LOJA } from '@/components/ui/so-pela-nuvem';
import { BancoERepasses } from '@/components/banco/banco-e-repasses';

// FINANCEIRO › BANCO E REPASSES (R1 da versão 8 do Mister; protótipo `mockups/regem-mister-v8.html`, aba "Na loja"; mig 499).
// Só o presidente (V8-2) e só na nuvem: aqui a tela só explica; quem barra de verdade é o servidor.
export default function BancoERepassesPage() {
  const [cat, setCat] = useState<string | null>(null);
  useEffect(() => {
    if (getToken()) setCat(getCategoria() ?? '');
  }, []);

  let corpo: React.ReactNode;
  if (NO_SERVIDOR_DA_LOJA)
    corpo = (
      <EmptyState
        icon="☁️"
        title="O banco e os repasses ficam na nuvem."
        description="Abra o Regem na nuvem (app.dmsregem.com), menu Financeiro, item Banco e repasses."
      />
    );
  else if (cat === null) corpo = <SkeletonList rows={3} />;
  else if (cat !== 'presidente') corpo = <EmptyState icon="🔒" title="Só o presidente vê o banco e os repasses." description="Saldo, extrato e repasses ficam com o presidente." />;
  else corpo = <BancoERepasses />;

  return (
    <Shell eyebrow="Financeiro" title="Banco e repasses">
      {corpo}
    </Shell>
  );
}
