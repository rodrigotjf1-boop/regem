'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from '@/components/app-shell/shell';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { NO_SERVIDOR_DA_LOJA } from '@/components/ui/so-pela-nuvem';
import { CalendarioDaLoja } from '@/components/clientes/calendario/calendario-da-loja';

// Delivery › Clientes › Calendário de eventos (F2 do perfil do cliente, mig 461). O servidor confere o papel (presidente e
// gerente), a permissão de delivery e o módulo "Perfil do cliente" — a tela só evita mostrar a lista sem o módulo.
export default function CalendarioDeEventosPage() {
  const [ligado, setLigado] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .modulosMeus()
      .then((m: any) => setLigado(m?.perfil_cliente === true))
      .catch(() => setLigado(true)); // não leu os módulos: a lista tenta e o servidor responde
  }, []);
  return (
    <Shell eyebrow="Delivery › Clientes" title="Calendário de eventos">
      {NO_SERVIDOR_DA_LOJA ? (
        // V37: as tabelas do calendário só existem na nuvem — aqui a tela diz onde ver, em vez de "não consegui ler".
        <Card className="p-6 text-sm">O calendário de eventos fica no Regem na nuvem (app.dmsregem.com), não no servidor da loja.</Card>
      ) : ligado === false ? (
        <Card className="space-y-2 p-6 text-sm">
          <p className="font-semibold">O calendário faz parte do módulo “Perfil do cliente”, que está desligado.</p>
          <p className="text-secondary-foreground">
            O presidente liga em{' '}
            <Link href="/diretoria" className="font-semibold underline underline-offset-2">
              Visão C&amp;O › Módulos do produto
            </Link>
            .
          </p>
        </Card>
      ) : ligado === null ? null : (
        <CalendarioDaLoja />
      )}
    </Shell>
  );
}
