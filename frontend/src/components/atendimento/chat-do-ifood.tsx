'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

// `desligado`: a loja tirou o chat da tela (ajuste "Chat oficial do iFood na tela Atendimento").
type Config =
  | { disponivel: true; widgetId: string; merchantIds: string[] }
  | { disponivel: false; motivo: 'sem_widget' | 'sem_ifood' | 'sem_nuvem' | 'desligado' };

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

type ConfigOk = Extract<Config, { disponivel: true }>;

// ABRE SOZINHO ao entrar na tela (pedido do dono, 04/11/2026: "toda vez que entra tem que clicar no chat do iFood"). O
// "Esconder" fica lembrado NESTE computador — preferência da tela, não dado do negócio (por isso o armazenamento do
// navegador, com try/catch: sem ele, o chat só abre sozinho como de costume).
const ESCONDIDO = 'chat_ifood_escondido';
function lerEscondido(): boolean {
  try {
    return localStorage.getItem(ESCONDIDO) === '1';
  } catch {
    return false;
  }
}
function gravarEscondido(v: boolean) {
  try {
    if (v) localStorage.setItem(ESCONDIDO, '1');
    else localStorage.removeItem(ESCONDIDO);
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

export function ChatDoIfood() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [aberto, setAberto] = useState(false);
  const [abrindo, setAbrindo] = useState(false);
  // A abertura SOZINHA não deu certo (sem internet, script do iFood fora): o aviso fica na tela, sem pop-up.
  const [naoAbriuSozinho, setNaoAbriuSozinho] = useState(false);
  const montado = useRef(true);
  const tentouSozinho = useRef(false);

  useEffect(() => {
    montado.current = true;
    let vivo = true;
    api
      .atendimentoChatIfood()
      .then((c: Config) => vivo && setCfg(c))
      .catch(() => vivo && setCfg({ disponivel: false, motivo: 'sem_nuvem' }));
    return () => {
      vivo = false;
      montado.current = false;
      // Saiu da tela: o widget (no corpo da página) some junto; a sessão dele fica guardada no navegador.
      try {
        window.iFoodWidget?.hide();
      } catch {
        /* sem widget */
      }
    };
  }, []);

  const abrir = useCallback(async (c: ConfigOk, sozinho: boolean) => {
    setAbrindo(true);
    setNaoAbriuSozinho(false);
    try {
      const w = await carregarWidget();
      const chave = `${c.widgetId}|${c.merchantIds.join(',')}`;
      if (iniciadoCom !== chave) {
        w.init({ widgetId: c.widgetId, merchantIds: c.merchantIds, autoShow: false });
        iniciadoCom = chave;
      }
      await comPrazo(Promise.resolve(w.ready), 20_000);
      // A pessoa saiu da tela enquanto o iFood carregava: o chat não aparece por cima de outra tela.
      if (!montado.current) return;
      w.show();
      setAberto(true);
      if (!sozinho) gravarEscondido(false);
    } catch {
      if (!montado.current) return;
      if (sozinho) setNaoAbriuSozinho(true);
      else toast.error('O chat oficial do iFood não abriu agora. Confira a internet deste computador e tente de novo.');
    } finally {
      if (montado.current) setAbrindo(false);
    }
  }, []);

  // Abre sozinho uma vez ao entrar, a menos que este computador tenha escondido.
  useEffect(() => {
    if (!cfg?.disponivel || tentouSozinho.current || lerEscondido()) return;
    tentouSozinho.current = true;
    void abrir(cfg, true);
  }, [cfg, abrir]);

  if (!cfg) return null;
  if (!cfg.disponivel) {
    if (cfg.motivo !== 'sem_nuvem') return null; // sem o widget da distribuição ou sem o iFood ligado: não há chat
    return <p className="text-xs text-secondary-foreground">O chat oficial do iFood não carregou agora (a nuvem não respondeu). Abra a tela de novo daqui a pouco.</p>;
  }
  const c = cfg;

  function alternar() {
    if (aberto) {
      window.iFoodWidget?.hide();
      setAberto(false);
      gravarEscondido(true); // escondido aqui: na próxima vez, não abre sozinho neste computador
      return;
    }
    void abrir(c, false);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-chat-ifood={aberto ? 'aberto' : 'fechado'}>
      <Button type="button" variant="outline" aria-pressed={aberto} disabled={abrindo} onClick={alternar}>
        <span aria-hidden="true">💬</span>{' '}
        {abrindo ? 'Abrindo o chat oficial do iFood…' : aberto ? 'Esconder o chat oficial do iFood' : 'Chat oficial do iFood'}
      </Button>
      <span className="min-w-0 flex-1 basis-64 text-xs text-secondary-foreground">
        {naoAbriuSozinho
          ? 'O chat oficial do iFood não abriu sozinho agora (confira a internet deste computador). Toque em "Chat oficial do iFood" para tentar de novo.'
          : 'O chat oficial do iFood abre sozinho nesta tela — o botão dele fica no canto. "Esconder" vale para este computador. Na primeira vez, cada computador autoriza com um usuário Dono ou Administrador do iFood. As mensagens dele não entram na fila: o iFood não as entrega a sistemas.'}
      </span>
    </div>
  );
}
