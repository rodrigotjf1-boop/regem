'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';

// O CHAT OFICIAL DO iFOOD na tela Atendimento (Onda 1, PR 5 — protótipo v2, "💬 Chat do iFood"). É o WIDGET do iFood
// (doc "Widget", conferida em 02/11/2026): um script do iFood, um botão flutuante dele e o chat entre a loja e o cliente,
// com os avisos e o acompanhamento do pedido. O Regem só liga e desliga pela API oficial (`init` uma vez, com os dados
// certos; `show`/`hide`) — nada de mudar estilo ou posição do widget (a doc pede). O id do widget é da distribuição; sem
// ele, o servidor diz `disponivel: false` e o botão nem aparece. Na primeira vez, cada computador autoriza no Portal do
// Parceiro com um usuário "Dono(a)" ou "Administrador(a)" do iFood (regra do iFood).

type IFoodWidget = { init: (c: { widgetId: string; merchantIds: string[]; autoShow?: boolean }) => void; show: () => void; hide: () => void; ready?: Promise<unknown> };
declare global {
  interface Window {
    iFoodWidget?: IFoodWidget;
  }
}

type Config = { disponivel: true; widgetId: string; merchantIds: string[] } | { disponivel: false; motivo: 'sem_widget' | 'sem_ifood' | 'sem_nuvem' };

const SCRIPT = 'https://widgets.ifood.com.br/widget.js';
let carregando: Promise<IFoodWidget> | null = null;
/** Com quais dados o widget já foi iniciado nesta aba (a doc: iniciar de novo com outros dados derruba a sessão). */
let iniciadoCom: string | null = null;

const comPrazo = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<T>((_, nao) => setTimeout(() => nao(new Error('tempo')), ms))]);

function carregarWidget(): Promise<IFoodWidget> {
  if (window.iFoodWidget) return Promise.resolve(window.iFoodWidget);
  if (!carregando) {
    carregando = comPrazo(
      new Promise<IFoodWidget>((ok, nao) => {
        const s = document.createElement('script');
        s.src = SCRIPT;
        s.async = true;
        s.onload = () => (window.iFoodWidget ? ok(window.iFoodWidget) : nao(new Error('sem iFoodWidget')));
        s.onerror = () => nao(new Error('script'));
        document.head.appendChild(s);
      }),
      20_000,
    ).catch((e) => {
      carregando = null; // a próxima tentativa baixa de novo
      throw e;
    });
  }
  return carregando;
}

export function ChatDoIfood() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [aberto, setAberto] = useState(false);
  const [abrindo, setAbrindo] = useState(false);

  useEffect(() => {
    let vivo = true;
    api
      .atendimentoChatIfood()
      .then((c: Config) => vivo && setCfg(c))
      .catch(() => vivo && setCfg({ disponivel: false, motivo: 'sem_nuvem' }));
    return () => {
      vivo = false;
      // Saiu da tela: o widget (no corpo da página) some junto; a sessão dele fica guardada no navegador.
      try {
        window.iFoodWidget?.hide();
      } catch {
        /* sem widget */
      }
    };
  }, []);

  if (!cfg) return null;
  if (!cfg.disponivel) {
    if (cfg.motivo !== 'sem_nuvem') return null; // sem o widget da distribuição ou sem o iFood ligado: não há chat
    return <p className="text-xs text-secondary-foreground">O chat do iFood não carregou agora (a nuvem não respondeu). Abra a tela de novo daqui a pouco.</p>;
  }
  const c = cfg;

  async function alternar() {
    if (aberto) {
      window.iFoodWidget?.hide();
      setAberto(false);
      return;
    }
    setAbrindo(true);
    try {
      const w = await carregarWidget();
      const chave = `${c.widgetId}|${c.merchantIds.join(',')}`;
      if (iniciadoCom !== chave) {
        w.init({ widgetId: c.widgetId, merchantIds: c.merchantIds, autoShow: false });
        iniciadoCom = chave;
      }
      await comPrazo(Promise.resolve(w.ready), 20_000);
      w.show();
      setAberto(true);
    } catch {
      toast.error('O chat do iFood não abriu agora. Confira a internet deste computador e tente de novo.');
    } finally {
      setAbrindo(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button type="button" variant="outline" aria-pressed={aberto} disabled={abrindo} onClick={() => void alternar()}>
        <span aria-hidden="true">💬</span> {abrindo ? 'Abrindo o chat do iFood…' : aberto ? 'Esconder o chat do iFood' : 'Chat do iFood'}
      </Button>
      <span className="min-w-0 flex-1 basis-64 text-xs text-secondary-foreground">
        O chat oficial do iFood. Na primeira vez, cada computador autoriza com um usuário Dono ou Administrador do iFood. As
        mensagens dele não entram sozinhas na fila.
      </span>
    </div>
  );
}
