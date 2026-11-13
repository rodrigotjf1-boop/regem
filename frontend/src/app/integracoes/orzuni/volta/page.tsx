'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';

// A VOLTA DO ORZUNI (o clique Regem → Orzuni, mig 416): o Orzuni devolve o presidente aqui com o código (ou com o motivo
// de não ter ligado). O Regem troca o código pela ligação no servidor e mostra o resultado; a pessoa nunca vê código nem
// segredo. Ligou: volta à aba Integrações. Não ligou: a frase do servidor e o caminho de volta.

export default function VoltaDoOrzuniPage() {
  const router = useRouter();
  const [falha, setFalha] = useState<string | null>(null);
  const feito = useRef(false);

  useEffect(() => {
    if (feito.current) return; // a troca é de uso único: nunca duas vezes
    feito.current = true;
    if (!getToken()) {
      setFalha('Sua sessão terminou durante a autorização. Entre de novo e comece pelo botão "Conectar ao Orzuni".');
      return;
    }
    const q = new URLSearchParams(window.location.search);
    // O código e o state saem do endereço na hora: não ficam no histórico do navegador.
    window.history.replaceState(null, '', window.location.pathname);
    api
      .orzuniCliqueConcluir({ code: q.get('code'), state: q.get('state'), iss: q.get('iss'), error: q.get('error') })
      .then((r: any) => {
        if (r?.ligada) {
          toast.success(r.lojaIfoodNome ? `Orzuni ligado: a loja do iFood "${r.lojaIfoodNome}" está ligada a esta loja.` : 'Orzuni ligado.');
          router.replace('/delivery/configuracoes?aba=integracoes');
        } else {
          setFalha(r?.mensagem || 'Não foi possível concluir a ligação com o Orzuni agora.');
        }
      })
      .catch((e: any) => setFalha(e?.message || 'Não foi possível concluir a ligação com o Orzuni agora.'));
  }, [router]);

  return (
    <Shell eyebrow="Integrações" title="Orzuni">
      <div className="mx-auto grid max-w-lg gap-4 py-6">
        {falha ? (
          <div role="alert" className="grid gap-3 rounded-2xl border border-border bg-card p-5">
            <b className="font-display text-base">A loja não foi ligada ao Orzuni</b>
            <p className="m-0 text-sm text-muted-foreground">{falha}</p>
            <Button className="justify-self-start" onClick={() => router.replace('/delivery/configuracoes?aba=integracoes')}>
              Voltar às integrações
            </Button>
          </div>
        ) : (
          <div role="status" className="grid justify-items-center gap-2 rounded-2xl border border-border bg-card p-8 text-center">
            <span className="h-6 w-6 animate-spin rounded-full border-[3px] border-secondary border-t-primary motion-reduce:animate-none" aria-hidden="true" />
            <b>Ligando ao Orzuni…</b>
            <p className="m-0 text-sm text-muted-foreground">Não feche esta página.</p>
          </div>
        )}
      </div>
    </Shell>
  );
}
