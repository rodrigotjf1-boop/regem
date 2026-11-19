'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Franquia, diaDaVolta, franquiaAcabou, nomeDoMes, useSituacaoDoGraph } from '@/components/integracoes/graph-clique';

// MISTER › IA E USO › "FOTOS E ÁUDIOS · DMS GRAPH" (versão 5 do Mister, M5b.2; protótipo
// `mockups/regem-mister-ouve-ve-mostra.html`, "Na loja"). A franquia do mês é da EMPRESA e vale para o atendente e para o
// Mister (decisão 6): a conta é do DMS Graph, e aqui se vê quanto foi usado. Sem a situação (ainda lendo, o servidor da
// loja, o Graph não liberado para a empresa), o quadro não aparece — o resto da tela segue.
// Diferença do protótipo, de propósito: o protótipo separava o uso por recurso (atendente, Mister fotos, Mister áudios);
// o Graph conta o total da empresa, e é o total que aparece. A reserva da foto (a IA da empresa) aparece no quadro do uso
// da IA, como "Mister · fotos (reserva do DMS Graph)".

const CAMINHO_DO_CARTAO = '/delivery/configuracoes?aba=integracoes';

export function FotosEAudiosDoGraph() {
  const { s } = useSituacaoDoGraph();
  if (!s || !s.pronto) return null;
  const f = s.ligacao?.franquia ?? null;
  const acabou = franquiaAcabou(s);
  return (
    <Card className="p-5">
      <section aria-labelledby="fotos-e-audios-titulo" className="space-y-3">
        <div>
          <h2 id="fotos-e-audios-titulo" className="font-display text-lg font-semibold">
            Fotos e áudios · DMS Graph
          </h2>
          <p className="m-0 mt-1 max-w-prose text-sm text-muted-foreground">
            Com o DMS Graph ligado, o Mister ouve os áudios e vê as fotos que vocês mandam, e o atendente lê as fotos dos clientes. A franquia do mês é uma
            só, da empresa: cada foto e cada áudio contam uma leitura.
          </p>
        </div>
        {s.ligacao ? (
          <>
            <Franquia f={f} nome="Fotos e áudios lidos" />
            {acabou && f && (
              <div role="alert" className="rounded-lg border-l-4 border-warn bg-warn/10 px-3 py-2.5 text-sm text-foreground">
                <b className="block">A franquia de {nomeDoMes(f.mes)} acabou</b>
                Até {diaDaVolta(f.mes)}, o Mister não ouve áudios (pede para escrever) e as fotos são lidas pela IA da empresa.
              </div>
            )}
          </>
        ) : (
          <p className="m-0 text-sm">
            A empresa ainda não está ligada ao DMS Graph, então o Mister só lê texto. Quem liga é o presidente, em{' '}
            <Link href={CAMINHO_DO_CARTAO} className="font-medium underline underline-offset-2">
              Delivery › Configurações › Integrações
            </Link>
            , no cartão &ldquo;DMS Graph&rdquo;.
          </p>
        )}
      </section>
    </Card>
  );
}
