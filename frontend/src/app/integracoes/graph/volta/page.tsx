'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';

// A VOLTA DO DMS GRAPH (o clique Regem → DMS Graph, G5b; mig 450; protótipo `mockups/regem-graph-clique.html`, vistas 4
// e 7): o Graph devolve o presidente aqui com o código (ou com o motivo de não ter ligado). O Regem troca o código pela
// ligação no servidor e mostra o resultado; a pessoa nunca vê código nem segredo. Ligou: volta à aba Integrações. Não
// ligou: a frase do servidor (`fraseDaVolta`) e o caminho de volta. A conversa com o cliente nunca para.

const INTEGRACOES = '/delivery/configuracoes?aba=integracoes';

export default function VoltaDoGraphPage() {
  const router = useRouter();
  const [falha, setFalha] = useState<string | null>(null);
  const feito = useRef(false);

  useEffect(() => {
    if (feito.current) return; // a troca é de uso único: nunca duas vezes
    feito.current = true;
    if (!getToken()) {
      setFalha('Sua sessão terminou durante a autorização. Entre de novo e comece pelo botão "Conectar ao DMS Graph".');
      return;
    }
    const q = new URLSearchParams(window.location.search);
    // O código e o state saem do endereço na hora: não ficam no histórico do navegador.
    window.history.replaceState(null, '', window.location.pathname);
    api
      .graphCliqueConcluir({ code: q.get('code'), state: q.get('state'), iss: q.get('iss'), error: q.get('error') })
      .then((r: any) => {
        if (r?.ligada) {
          toast.success('DMS Graph ligado. As fotos que os clientes mandam no WhatsApp passam a ser lidas por ele, em todas as lojas.');
          router.replace(INTEGRACOES);
        } else {
          setFalha(r?.mensagem || 'Não foi possível concluir a ligação com o DMS Graph agora.');
        }
      })
      .catch((e: any) => setFalha(e?.message || 'Não foi possível concluir a ligação com o DMS Graph agora.'));
  }, [router]);

  return (
    <Shell eyebrow="Integrações" title="DMS Graph">
      <div className="mx-auto grid w-full max-w-lg gap-4 py-6">
        {falha ? (
          <div role="alert" className="grid gap-3 rounded-2xl border border-border bg-card p-5">
            <b className="font-display text-base">A empresa não foi ligada ao DMS Graph</b>
            <p className="m-0 text-sm text-muted-foreground">{falha}</p>
            <p className="m-0 text-xs text-muted-foreground">Nada mudou no que já existia, e as fotos dos clientes seguem como antes.</p>
            <Button className="justify-self-start" onClick={() => router.replace(INTEGRACOES)}>
              Voltar às integrações
            </Button>
          </div>
        ) : (
          <div role="status" className="grid justify-items-center gap-2 rounded-2xl border border-border bg-card p-8 text-center">
            <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-secondary border-t-primary motion-reduce:animate-none" aria-hidden="true" />
            <b>Ligando ao DMS Graph…</b>
            <p className="m-0 text-sm text-muted-foreground">Não feche esta página.</p>
          </div>
        )}
      </div>
    </Shell>
  );
}
