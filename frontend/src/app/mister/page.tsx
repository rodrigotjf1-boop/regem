'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, getCategoria, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { NO_SERVIDOR_DA_LOJA } from '@/components/ui/so-pela-nuvem';
import { IaEUso } from '@/components/mister/ia-e-uso';

// MISTER — o administrador virtual da loja (protótipo `mockups/regem-mister.html`, aprovado em 13/11/2026).
// Primeira entrega: a parte "IA e uso" (a chave de IA da empresa e o medidor). As partes "Resumo", "Pessoas" e
// "Avisos e relatórios" do protótipo entram nas entregas seguintes; por isso ainda não há a faixa de partes.
// Só o presidente, só na nuvem, e só com o módulo ligado (ele nasce desligado, em Visão C&O › Módulos do produto).
// O servidor é quem barra de verdade (rotas `ia/*`: presidente + só nuvem); aqui a tela só explica.

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Card className="p-8 text-center">
      <p className="font-display text-lg font-semibold">{titulo}</p>
      <div className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{children}</div>
    </Card>
  );
}

export default function MisterPage() {
  const [cat, setCat] = useState<string | null>(null);
  // null = ainda não sei; 'erro' = não deu para ler
  const [ligado, setLigado] = useState<boolean | 'erro' | null>(null);

  const lerModulo = useCallback(async () => {
    setLigado(null);
    try {
      const m = (await api.get('/modulos/meus')) as Record<string, boolean>;
      setLigado(m?.mister === true);
    } catch {
      setLigado('erro');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    const c = getCategoria();
    setCat(c);
    if (c === 'presidente' && !NO_SERVIDOR_DA_LOJA) void lerModulo();
  }, [lerModulo]);

  let corpo: React.ReactNode;
  if (cat && cat !== 'presidente') {
    corpo = <Aviso titulo="Área restrita">O Mister é do presidente da empresa.</Aviso>;
  } else if (NO_SERVIDOR_DA_LOJA) {
    corpo = <Aviso titulo="O Mister funciona pela nuvem">Abra esta mesma tela no Regem na nuvem. Aqui, no servidor da loja, ela não aparece.</Aviso>;
  } else if (ligado === null) {
    corpo = <SkeletonList rows={2} />;
  } else if (ligado === 'erro') {
    corpo = (
      <Aviso titulo="Não consegui abrir o Mister agora">
        <button type="button" className="inline-flex min-h-11 items-center font-semibold underline" onClick={() => void lerModulo()}>
          Tentar de novo
        </button>
      </Aviso>
    );
  } else if (!ligado) {
    corpo = (
      <Aviso titulo="O módulo Mister está desligado">
        <p>Ligue em Visão C&amp;O › Módulos do produto.</p>
        <Link href="/diretoria" className={`${buttonVariants({ variant: 'default' })} mt-4`}>
          Abrir Visão C&amp;O
        </Link>
      </Aviso>
    );
  } else {
    corpo = (
      <div className="space-y-5">
        <p className="max-w-3xl text-sm text-muted-foreground">
          O administrador virtual da sua loja. Nesta primeira parte você cadastra a chave de IA da empresa e acompanha o uso dela. Os avisos, as perguntas e as pessoas ligadas ao
          WhatsApp do Mister chegam nas próximas entregas.
        </p>
        <IaEUso />
      </div>
    );
  }

  return (
    <Shell eyebrow="Mister" title="IA e uso">
      {corpo}
    </Shell>
  );
}
