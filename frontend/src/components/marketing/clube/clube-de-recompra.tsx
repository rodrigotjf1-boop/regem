'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Partes } from '@/components/ui/partes';
import { Skeleton } from '@/components/ui/skeleton';
import { PremiosDoClube } from './premios-do-clube';
import type { PainelDoClube } from './tipos';
import { VisaoDoClube } from './visao-do-clube';

// Delivery › Marketing › Clube (fase A0 do `docs/plano-clube-e-banner.md`; protótipo `mockups/regem-clube-banner.html`,
// parte "Marketing › Clube"; mig 471). A base: a Visão geral (as ferramentas e as regras que valem para as três) e os
// Prêmios. O Prêmio surpresa, o Álbum, a Meta e os Resultados entram cada um na sua fase. Presidente e gerente veem; só o
// presidente muda (o servidor confere — a tela só esconde os botões).
type Parte = 'visao' | 'premios';

export function ClubeDeRecompra() {
  const [painel, setPainel] = useState<PainelDoClube | null>(null);
  const [erro, setErro] = useState('');
  const [parte, setParte] = useState<Parte>('visao');
  const podeMudar = getCategoria() === 'presidente';

  const ler = useCallback(() => {
    setErro('');
    api
      .clubePainel()
      .then((p: any) => setPainel(p as PainelDoClube))
      .catch((e: unknown) => setErro(e instanceof Error ? e.message : 'Não foi possível ler o Clube.'));
  }, []);
  useEffect(ler, [ler]);

  if (erro && !painel)
    return (
      <Card className="flex flex-wrap items-center gap-3 p-4 text-sm" role="alert">
        <span>Não deu para ler o Clube agora: {erro}</span>
        <Button type="button" variant="outline" size="sm" onClick={ler}>Tentar de novo</Button>
      </Card>
    );
  if (!painel)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Carregando o Clube">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );

  return (
    <div className="space-y-4" data-tela="clube">
      {/* `data-tela`: o roteiro de tela mede o texto esmagado só aqui (o resto da página é de outras abas). */}
      <Partes<Parte>
        rotulo="Partes do Clube"
        ativa={parte}
        aoEscolher={setParte}
        partes={[
          { key: 'visao', label: 'Visão geral' },
          { key: 'premios', label: 'Prêmios', conta: painel.premios.length },
        ]}
      />
      {parte === 'visao' && <VisaoDoClube painel={painel} podeMudar={podeMudar} aoMudar={setPainel} />}
      {parte === 'premios' && <PremiosDoClube painel={painel} podeMudar={podeMudar} aoMudar={setPainel} />}
    </div>
  );
}
