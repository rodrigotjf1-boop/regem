'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plug } from 'lucide-react';
import { ApiError, api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { CartaoAplicativo } from '@/components/integracoes/cartao-aplicativo';
import { DialogoRevogar } from '@/components/integracoes/dialogo-revogar';
import type { Acesso, Aplicativo } from '@/components/integracoes/textos';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Estado =
  | { fase: 'carregando' }
  | { fase: 'so_nuvem' }
  | { fase: 'sem_acesso' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; aplicativos: Aplicativo[] };

type Pedido = { app: Aplicativo; acesso: Acesso | null; origem: HTMLButtonElement };

// Configurações → Aplicativos conectados (trilha C, C1b; mockup `mockups/regem-autorizar-liame.html`,
// aprovado em 01/10/2026): as ferramentas que leem dados das lojas com a autorização do
// presidente, o que cada uma recebe, o último acesso e o botão de revogar. Só o presidente (o
// servidor recusa os demais) e só na nuvem.
export default function AplicativosConectadosPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [revogando, setRevogando] = useState(false);
  const [agora, setAgora] = useState(() => new Date());
  const tituloLista = useRef<HTMLHeadingElement>(null);

  const carregar = useCallback(async () => {
    try {
      const r: any = await api.get('/aplicativos-conectados');
      setAgora(new Date());
      setEstado({ fase: 'pronto', aplicativos: r.aplicativos ?? [] });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : -1;
      if (status === 401) return;
      if (status === 403) setEstado({ fase: 'sem_acesso' });
      else if (status === 404) setEstado({ fase: 'so_nuvem' });
      else setEstado({ fase: 'erro', mensagem: e instanceof Error ? e.message : 'Não foi possível carregar.' });
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    if (process.env.NEXT_PUBLIC_EDGE === '1') {
      setEstado({ fase: 'so_nuvem' });
      return;
    }
    void carregar();
  }, [carregar, router]);

  function manter() {
    const origem = pedido?.origem;
    setPedido(null);
    origem?.focus();
  }

  async function revogar() {
    if (!pedido) return;
    const { app, acesso } = pedido;
    setRevogando(true);
    try {
      if (acesso) await api.post(`/aplicativos-conectados/${acesso.id}/revogar`, {});
      else await api.post('/aplicativos-conectados/revogar-todos', { cliente: app.cliente });
      toast.success(
        acesso?.lojaNome ? `Revogado. O ${app.rotulo} não lê mais a ${acesso.lojaNome}.` : `Revogado. O ${app.rotulo} não lê mais nenhuma loja.`,
      );
      setPedido(null);
      await carregar();
      // O botão que abriu o diálogo sumiu com a linha: o foco vai para o título da lista.
      tituloLista.current?.focus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível revogar. Tente de novo.');
    } finally {
      setRevogando(false);
    }
  }

  return (
    <Shell eyebrow="Configurações" title="Aplicativos conectados">
      <div className="space-y-4">
        <p ref={tituloLista} tabIndex={-1} className="text-sm text-muted-foreground outline-none">
          Ferramentas que leem dados das suas lojas com a sua autorização. Você revoga quando quiser.
        </p>

        {estado.fase === 'carregando' && <Skeleton className="h-44 w-full rounded-xl" />}

        {estado.fase === 'so_nuvem' && (
          <EmptyState
            icon={<Plug className="h-6 w-6" aria-hidden="true" />}
            title="Disponível pelo Regem na internet"
            description="Os aplicativos conectados são vistos e revogados em app.dmsregem.com. O servidor da loja não guarda essas autorizações."
          />
        )}

        {estado.fase === 'sem_acesso' && (
          <EmptyState
            icon={<Plug className="h-6 w-6" aria-hidden="true" />}
            title="Só o presidente vê os aplicativos conectados"
            description="Autorizar e revogar a leitura dos dados das lojas é decisão do presidente da empresa."
          />
        )}

        {estado.fase === 'erro' && (
          <EmptyState
            icon={<Plug className="h-6 w-6" aria-hidden="true" />}
            title="Não deu para carregar os aplicativos"
            description={estado.mensagem}
            action={
              <button type="button" className="text-sm font-bold underline underline-offset-2" onClick={() => void carregar()}>
                Tentar de novo
              </button>
            }
          />
        )}

        {estado.fase === 'pronto' && estado.aplicativos.length === 0 && (
          <EmptyState
            icon={<Plug className="h-6 w-6" aria-hidden="true" />}
            title="Nenhum aplicativo conectado"
            description="Quando você autorizar uma ferramenta a ler dados das lojas, ela aparece aqui, com o que recebe e o botão de revogar."
          />
        )}

        {estado.fase === 'pronto' &&
          estado.aplicativos.map((app) => (
            <CartaoAplicativo key={app.cliente} app={app} agora={agora} aoRevogar={(acesso, origem) => setPedido({ app, acesso, origem })} />
          ))}
      </div>

      {pedido && (
        <DialogoRevogar
          app={pedido.app.rotulo}
          leitura={pedido.app.cliente === 'liame' ? 'os pedidos' : 'os dados'}
          loja={pedido.acesso?.lojaNome ?? null}
          revogando={revogando}
          aoManter={manter}
          aoRevogar={() => void revogar()}
        />
      )}
    </Shell>
  );
}
