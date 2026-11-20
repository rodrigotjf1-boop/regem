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
import { AvisosDoMister } from '@/components/mister/avisos';
import { DocumentosDoMister } from '@/components/mister/documentos';
import { HistoricoDosAvisos } from '@/components/mister/historico';
import { IaEUso } from '@/components/mister/ia-e-uso';
import { JeitoDoMister } from '@/components/mister/jeito';
import { MemoriaDoMister } from '@/components/mister/memoria';
import { PessoasDoMister } from '@/components/mister/pessoas';
import { RegrasDoMister } from '@/components/mister/regras';
import { ResumoDoMister } from '@/components/mister/resumo';

// MISTER — o administrador virtual da loja (protótipo `mockups/regem-mister.html`, aprovado em 13/11/2026).
// Partes no ar: "Resumo" (a entrada do presidente: as três etapas para o Mister funcionar, o que ele faz e os últimos
// avisos), "Pessoas" (cada gestor liga o próprio WhatsApp ao Mister), "IA e uso" (a chave de IA da empresa e o
// medidor) e "Avisos e relatórios" (para onde vai cada aviso — versão 2 do protótipo, aprovada em 14/11/2026).
// Quem entra: o PRESIDENTE vê as partes, começando pelo Resumo; o GERENTE vê só "Pessoas" (a própria linha), sem a faixa.
// Só na nuvem e só com o módulo ligado (ele nasce desligado, em Visão C&O › Módulos do produto).
// O servidor é quem barra de verdade (rotas `mister/*`: gerente e presidente; `ia/*`: só o presidente); aqui a tela só explica.

// "Documentos" (M3a parte 3, versão 3 do protótipo aprovada em 17/11/2026): os boletos que chegaram por foto. Só o presidente.
// "Jeito e memória" (versão 4, `mockups/regem-mister-jeito-memoria.html`, aprovado em 18/11/2026): o perfil e o jeito da
// empresa (M4a) e "O que o Mister sabe" (M4b, mig 449); os avisos escritos e o "fica de olho" entram na mesma parte, cada
// um na sua fase. Só o presidente.
// "Regras" (versão 6, M6f, `mockups/regem-mister-v6.html`, aprovado em 20/11/2026): as regras de aviso de cada pessoa. O
// presidente vê as de todos; o gerente, as dele — por isso o gerente também tem as partes (Pessoas e Regras).
type Parte = 'resumo' | 'pessoas' | 'regras' | 'ia' | 'avisos' | 'documentos' | 'historico' | 'jeito';
const TITULO: Record<Parte, string> = {
  resumo: 'Resumo',
  pessoas: 'Pessoas',
  regras: 'Regras',
  ia: 'IA e uso',
  avisos: 'Avisos e relatórios',
  documentos: 'Documentos',
  historico: 'Histórico',
  jeito: 'Jeito e memória',
};

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
  // O presidente entra pelo Resumo (o protótipo); o gerente só tem "Pessoas".
  const [parte, setParte] = useState<Parte>('resumo');

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
    const pedida = new URLSearchParams(window.location.search).get('parte');
    if (c === 'presidente' && (pedida === 'pessoas' || pedida === 'regras' || pedida === 'ia' || pedida === 'avisos' || pedida === 'documentos' || pedida === 'historico' || pedida === 'jeito')) setParte(pedida);
    if (c === 'gerente' && pedida === 'regras') setParte('regras');
    if ((c === 'presidente' || c === 'gerente') && !NO_SERVIDOR_DA_LOJA) void lerModulo();
  }, [lerModulo]);

  const presidente = cat === 'presidente';
  const aberta: Parte = presidente ? parte : parte === 'regras' ? 'regras' : 'pessoas';

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
            ? 'O administrador virtual da sua loja. Aqui cada gestor liga o próprio WhatsApp ao Mister, e você cuida da chave de IA da empresa. Com o WhatsApp ligado, é só perguntar a ele sobre a loja: as vendas, os pedidos, o estoque. Em "Avisos e relatórios" você escolhe para onde vai cada aviso.'
            : 'O administrador virtual da loja. Ligue aqui o seu WhatsApp ao Mister e pergunte a ele sobre a loja: as vendas, os pedidos, o estoque. Os avisos chegam nas próximas entregas.'}
        </p>
        {!presidente && (
          <Partes
            rotulo="Partes do Mister"
            partes={[
              { key: 'pessoas', label: TITULO.pessoas },
              { key: 'regras', label: TITULO.regras },
            ]}
            ativa={aberta}
            aoEscolher={setParte}
          />
        )}
        {presidente && (
          <Partes
            rotulo="Partes do Mister"
            partes={[
              { key: 'resumo', label: TITULO.resumo },
              { key: 'pessoas', label: TITULO.pessoas },
              { key: 'regras', label: TITULO.regras },
              { key: 'ia', label: TITULO.ia },
              { key: 'avisos', label: TITULO.avisos },
              { key: 'documentos', label: TITULO.documentos },
              { key: 'historico', label: TITULO.historico },
              { key: 'jeito', label: TITULO.jeito },
            ]}
            ativa={aberta}
            aoEscolher={setParte}
          />
        )}
        {aberta === 'resumo' ? (
          <ResumoDoMister aoAbrir={setParte} />
        ) : aberta === 'regras' ? (
          <RegrasDoMister />
        ) : aberta === 'ia' ? (
          <IaEUso />
        ) : aberta === 'avisos' ? (
          <AvisosDoMister />
        ) : aberta === 'documentos' ? (
          <DocumentosDoMister />
        ) : aberta === 'historico' ? (
          <HistoricoDosAvisos />
        ) : aberta === 'jeito' ? (
          <div className="space-y-8">
            <JeitoDoMister />
            <MemoriaDoMister />
          </div>
        ) : (
          <PessoasDoMister />
        )}
      </div>
    );
  }

  return (
    <Shell eyebrow="Mister" title={TITULO[aberta]}>
      {corpo}
    </Shell>
  );
}
