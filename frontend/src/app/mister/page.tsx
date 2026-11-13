'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, getCategoria, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Partes } from '@/components/ui/partes';
import { SkeletonList } from '@/components/ui/skeleton';
import { NO_SERVIDOR_DA_LOJA } from '@/components/ui/so-pela-nuvem';
import { IaEUso } from '@/components/mister/ia-e-uso';
import { PessoasDoMister } from '@/components/mister/pessoas';

// MISTER — o administrador virtual da loja (protótipo `mockups/regem-mister.html`, aprovado em 13/11/2026).
// Partes no ar: "Pessoas" (cada gestor liga o próprio WhatsApp ao Mister) e "IA e uso" (a chave de IA da empresa e o
// medidor). "Resumo" e "Avisos e relatórios" do protótipo entram nas entregas seguintes.
// Quem entra: o PRESIDENTE vê as duas partes; o GERENTE vê só "Pessoas" (a própria linha), sem a faixa de partes.
// Só na nuvem e só com o módulo ligado (ele nasce desligado, em Visão C&O › Módulos do produto).
// O servidor é quem barra de verdade (rotas `mister/*`: gerente e presidente; `ia/*`: só o presidente); aqui a tela só explica.

type Parte = 'pessoas' | 'ia';
const TITULO: Record<Parte, string> = { pessoas: 'Pessoas', ia: 'IA e uso' };

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
  const [parte, setParte] = useState<Parte>('pessoas');

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
    // Um link pode abrir direto numa parte (`/mister?parte=ia`). Só o presidente tem a parte da IA.
    if (c === 'presidente' && new URLSearchParams(window.location.search).get('parte') === 'ia') setParte('ia');
    if ((c === 'presidente' || c === 'gerente') && !NO_SERVIDOR_DA_LOJA) void lerModulo();
  }, [lerModulo]);

  const presidente = cat === 'presidente';
  const aberta: Parte = presidente ? parte : 'pessoas';

  let corpo: React.ReactNode;
  if (cat && !presidente && cat !== 'gerente') {
    corpo = <Aviso titulo="Área restrita">O Mister é do presidente e dos gerentes da empresa.</Aviso>;
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
    corpo = presidente ? (
      <Aviso titulo="O módulo Mister está desligado">
        <p>Ligue em Visão C&amp;O › Módulos do produto.</p>
        <Link href="/diretoria" className={`${buttonVariants({ variant: 'default' })} mt-4`}>
          Abrir Visão C&amp;O
        </Link>
      </Aviso>
    ) : (
      <Aviso titulo="O módulo Mister está desligado">O presidente da empresa liga o Mister em Visão C&amp;O.</Aviso>
    );
  } else {
    corpo = (
      <div className="space-y-5">
        <p className="max-w-3xl text-sm text-muted-foreground">
          {presidente
            ? 'O administrador virtual da sua loja. Aqui cada gestor liga o próprio WhatsApp ao Mister, e você cuida da chave de IA da empresa. Com o WhatsApp ligado, é só perguntar a ele sobre a loja: as vendas, os pedidos, o estoque. Os avisos chegam nas próximas entregas.'
            : 'O administrador virtual da loja. Ligue aqui o seu WhatsApp ao Mister e pergunte a ele sobre a loja: as vendas, os pedidos, o estoque. Os avisos chegam nas próximas entregas.'}
        </p>
        {presidente && (
          <Partes
            rotulo="Partes do Mister"
            partes={[
              { key: 'pessoas', label: TITULO.pessoas },
              { key: 'ia', label: TITULO.ia },
            ]}
            ativa={aberta}
            aoEscolher={setParte}
          />
        )}
        {aberta === 'ia' ? <IaEUso /> : <PessoasDoMister />}
      </div>
    );
  }

  return (
    <Shell eyebrow="Mister" title={TITULO[aberta]}>
      {corpo}
    </Shell>
  );
}
