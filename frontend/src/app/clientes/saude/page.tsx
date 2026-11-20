'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from '@/components/app-shell/shell';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { NO_SERVIDOR_DA_LOJA } from '@/components/ui/so-pela-nuvem';
import { SaudeDaBase } from '@/components/clientes/saude-da-base';

// Delivery › Clientes › Saúde da base (F4 do perfil do cliente). O servidor confere o papel (presidente), a permissão de
// delivery e o módulo "Perfil do cliente" — a tela só evita ler sem o módulo.
export default function SaudeDaBasePage() {
  const [ligado, setLigado] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .modulosMeus()
      .then((m: any) => setLigado(m?.perfil_cliente === true))
      .catch(() => setLigado(true)); // não leu os módulos: a tela tenta e o servidor responde
  }, []);
  return (
    <Shell eyebrow="Delivery › Clientes" title="Saúde da base">
      {NO_SERVIDOR_DA_LOJA ? (
        // V37: as tabelas do perfil só existem na nuvem — aqui a tela diz onde ver, em vez de "não consegui ler".
        <Card className="p-6 text-sm">A Saúde da base fica no Regem na nuvem (app.dmsregem.com), não no servidor da loja.</Card>
      ) : ligado === false ? (
        <Card className="space-y-2 p-6 text-sm">
          <p className="font-semibold">A Saúde da base faz parte do módulo “Perfil do cliente”, que está desligado.</p>
          <p className="text-secondary-foreground">
            O presidente liga em{' '}
            <Link href="/diretoria" className="font-semibold underline underline-offset-2">
              Visão C&amp;O › Módulos do produto
            </Link>
            .
          </p>
        </Card>
      ) : ligado === null ? null : (
        <SaudeDaBase />
      )}
    </Shell>
  );
}
