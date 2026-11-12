'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import './kds-tela.css';
import { api, getToken, podePerm } from '@/lib/api';
import { rotuloSenha, senhaCasa } from '@/lib/senha';
import { connectAsGestor, connectAsDevice, type Socket } from '@/lib/rt';
import { KdsMapaEntregadores } from '@/components/kds/kds-mapa-entregadores';
import { HistoricoKds } from '@/components/kds/historico-kds';
import { HistoricoAvisosKds } from '@/components/kds/historico-avisos-kds';
import { KdsCartaoPedido } from '@/components/kds/kds-cartao-pedido';
import { KdsCartaoItem } from '@/components/kds/kds-cartao-item';
import { KdsResumoItens } from '@/components/kds/kds-resumo-itens';
import { KdsProdutosGaveta } from '@/components/kds/kds-produtos-gaveta';
import { KdsDespacho } from '@/components/kds/kds-despacho';
import { ACAO_KDS, TEMAS_KDS, variaveisDoKds, type TemaKds } from '@/lib/kds-tema';
import {
  AVISOS_DA_TELA,
  COR_STATUS,
  FILTROS_ETAPA,
  acoesDoDespacho,
  avisosDoKds,
  avisosPadrao,
  faixaDaPausa,
  recebeAviso,
  alertaParaEstaTela,
  TIPOS_DE_AVISO,
  type AvisosDoKds,
  type CanalPausadoNoKds,
  type TipoDeAviso,
  agruparPorItem,
  cartaoNaTela,
  pedidoDoDespachoNaTela,
  contarEtapas,
  decidirTecla,
  escolherAlertaDoRodape,
  filtrarEtapa,
  formaDeUso,
  grupoPedido,
  identPedido,
  ordenarAlertas,
  passarUmSegundo,
  pedidoTemItem,
  prioridadeDoRodape,
  rotuloDaPrioridade,
  somarItens,
  textoDaAlteracao,
  textoDoToque,
  type CorStatus,
  type FiltroEtapa,
  type FormaUso,
  type PrioridadeKds,
} from '@/lib/kds-fila';

/* eslint-disable @typescript-eslint/no-explicit-any */

// KDS web (superfície de teste do tempo real). Base do futuro app nativo empacotado.
// KDS = informativo + avanço de produção. Consultar/alterar/cancelar é no PDV.
//
// Versão 2 (onda 2 da auditoria do KDS, protótipo aprovado pelo dono em 11/11/2026 — `mockups/regem-kds-cozinha.html`,
// aba 1): legível a 1–2 m e com pouca cor. Cabeçalho compacto (o que é do aparelho foi para o ⚙), cartão neutro com a cor
// do tempo só no selo, faixas claras, rodapé PARADO com "Ciente", um aviso curto a cada toque, "Finalizar todos" num
// diálogo da própria tela e o resumo ao lado a partir de 900 px. Desenho em `kds-tela.css`; as regras puras da fila, em
// `lib/kds-fila.ts` (check:kds).

type Alerta = {
  id: string;
  titulo: string;
  detalhe: string;
  prioridade: PrioridadeKds;
  em: string;
  restanteSeg: number; // tempo que ainda deve ficar no rodapé (só conta enquanto é o mostrado)
  fica?: boolean; // fica até alguém tocar (cancelado, alterado) — não conta o tempo
  ciente?: boolean; // mostra o "Ciente" (o que fica e o urgente que veio do cadastro)
  origem: string; // de onde veio ("Pedido cancelado", "Alertas da loja"…), na lista "N avisos"
  cartaoId?: string; // o pedido alterado: o "Visto" do rodapé é o mesmo do cartão
  // Veio do servidor e está GUARDADO (mig 412): o "Ciente" daqui vai ao servidor e sai das outras telas também.
  servidor?: boolean;
};

// ── Fase C: filtros ricos (aninhados por canal) ──────────────────────────────
// Delivery agrupa a plataforma; Balcão/Salão agrupa origem + plataforma (Totem).
const SUBFILTROS: Record<'delivery' | 'balcao', { key: string; label: string }[]> = {
  delivery: [
    { key: 'todos', label: 'Todos' },
    { key: 'marketplace', label: 'Marketplaces' }, // iFood · 99Food · Keeta
    { key: 'digital', label: 'Cardápios digitais' }, // Anota Aí · Cardápio Web · Regem
  ],
  balcao: [
    { key: 'todos', label: 'Todos' },
    { key: 'pdv', label: 'PDV / Balcão' },
    { key: 'mesa', label: 'Mesas / Comandas' },
    { key: 'totem', label: 'Totens' },
    { key: 'garcom', label: 'Garçom' },
  ],
};
// ── Preferências da tela (por aparelho, no localStorage — UI, não dado de negócio) ──────────
type ViewCfg = {
  escala: number; // tamanho da letra (0.85 .. 1.5)
  agregar: boolean; // agregar itens iguais (soma quantidade) vs. mostrar separados
  uso: '' | FormaUso; // forma de uso; '' = adivinha pelo aparelho (tela de toque → toque)
};
const VIEW_PADRAO: ViewCfg = { escala: 1, agregar: false, uso: '' };
const TAMANHOS = [0.85, 1, 1.25, 1.5] as const;
// Lê o que estava guardado (ou veio num atalho) e descarta o que não existe mais — as cores escolhidas à mão saíram com a
// tela neutra, e a "cor no cartão inteiro" saiu com a versão 2 ("KDS com muita cor").
function normalizarView(v: any): ViewCfg {
  const esc = Number(v?.escala);
  return {
    escala: esc >= 0.85 && esc <= 1.5 ? esc : 1,
    agregar: v?.agregar === true,
    uso: v?.uso === 'toque' || v?.uso === 'teclado' ? v.uso : '',
  };
}

// Temas do KDS (claro, o padrão, nas cores do Regem; escuro, opção do aparelho): em `lib/kds-tema`, medidos nos dois temas
// pelo check:kds.
const TEMAS: Record<'escuro' | 'claro', TemaKds> = TEMAS_KDS;
const ACAO = ACAO_KDS;
const MONO = 'JetBrains Mono, monospace';
const TITULO = 'Archivo, sans-serif';
const hm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// De onde veio o aviso, na lista "N avisos" (pelo tipo que o servidor manda — mig 408).
const ORIGEM_DO_AVISO: Record<string, string> = {
  loja: 'Alertas da loja',
  estoque: 'Estoque da cozinha',
  gestao: 'Aviso de gestão',
  farol: 'Farol',
  pausa: 'Pausa dos canais',
};

// O aviso que veio do servidor (`kds:alerta` ao vivo, ou o pendente recuperado — mig 412) → o aviso do rodapé. O urgente
// ganha o "Ciente" (A7): sai antes do tempo com um toque; o "até o Ciente" fica sem contar o tempo.
function alertaDoServidor(a: any): Alerta {
  const prioridade = prioridadeDoRodape(a.prioridade ?? 'alta');
  return {
    id: String(a.id),
    titulo: a.titulo,
    detalhe: a.detalhe ?? '',
    prioridade,
    em: a.em,
    restanteSeg: Number(a.duracaoSeg) > 0 ? Number(a.duracaoSeg) : 60,
    fica: a.fica === true,
    ciente: prioridade === 'danger' || a.fica === true,
    origem: ORIGEM_DO_AVISO[String(a.tipo)] ?? 'Alertas da loja',
    servidor: true,
  };
}

// Os sons (A12): o pedido novo, o aviso e o URGENTE (cancelado, alterado) — antes era o mesmo bipe para tudo.
type Som = 'novo' | 'aviso' | 'urgente';
const TONS: Record<Som, { f: number; ini: number; dur: number }[]> = {
  novo: [{ f: 880, ini: 0, dur: 0.38 }],
  aviso: [{ f: 660, ini: 0, dur: 0.3 }],
  urgente: [
    { f: 988, ini: 0, dur: 0.18 },
    { f: 740, ini: 0.22, dur: 0.18 },
    { f: 988, ini: 0.44, dur: 0.18 },
    { f: 740, ini: 0.66, dur: 0.18 },
  ],
};

export default function KdsPage() {
  const [conectado, setConectado] = useState(false);
  const [temSessao, setTemSessao] = useState<boolean | null>(null);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [pedidos, setPedidos] = useState<any[]>([]);
  // O despacho tem a lista dele (o pedido inteiro, com o andamento): nunca se mistura com a fila de cartões. Com uma lista
  // só, a tela que virava despacho desenhava por um instante os cartões da fila antiga como pedidos — chaves repetidas, e
  // sobrava um cartão "fantasma" (medido na tela de verdade, 21/10/2026).
  const [pedidosDespacho, setPedidosDespacho] = useState<any[]>([]);
  const [dialogoDespacho, setDialogoDespacho] = useState(false); // "… assim mesmo (gestor)" aberto: o teclado é dele
  const [cores, setCores] = useState<{ verdeAteMin: number; amareloAteMin: number; usaPreparo?: boolean; usaEntregue?: boolean }>({
    verdeAteMin: 5,
    amareloAteMin: 10,
  });
  // A última leitura da fila falhou (a tela mostra a faixa) e se alguma leitura já deu certo (só então "nenhum pedido").
  const [falhaFila, setFalhaFila] = useState<{ em: Date; motivo: string } | null>(null);
  const [filaLida, setFilaLida] = useState(false);
  // KDS aberto pela internet numa loja com o servidor ligado (R15): a via da etapa ficaria sem quem imprima.
  const [nuvemComServidor, setNuvemComServidor] = useState(false);
  // Cartões com um toque a caminho do servidor: o segundo toque no mesmo cartão espera (toque duplo não pula etapa).
  const avancandoRef = useRef<Set<string>>(new Set());
  const [avancando, setAvancando] = useState<Set<string>>(() => new Set());
  const [setores, setSetores] = useState<any[]>([]);
  const [setorSel, setSetorSel] = useState('');
  const [kdsList, setKdsList] = useState<any[]>([]); // Fase E — KDS da loja p/ o seletor
  const [produtosAberto, setProdutosAberto] = useState(false); // "Configurar este KDS" (Cozinha em estações)
  const [kdsSel, setKdsSel] = useState(''); // qual KDS este aparelho opera (cadeia)
  const [canal, setCanal] = useState<'balcao' | 'delivery' | 'todos'>('balcao');
  // Fase C — filtros de sub-origem, um por canal (na gaveta ⚙).
  const [subDelivery, setSubDelivery] = useState('todos');
  const [subBalcao, setSubBalcao] = useState('todos');
  // A fila vista POR PEDIDO (um cartão por pedido) ou POR ITEM (um cartão por item, somado).
  const [ver, setVer] = useState<'pedido' | 'item'>('pedido');
  const [etapaSel, setEtapaSel] = useState<FiltroEtapa>('todos');
  // Resumo de itens (painel ao lado) e o item escolhido nele, que destaca os pedidos.
  const [resumoAberto, setResumoAberto] = useState(false);
  const [itemSel, setItemSel] = useState('');
  const [senhaDigitada, setSenhaDigitada] = useState(''); // Fase F — teclado de senha
  const [senhaErro, setSenhaErro] = useState(false);
  const [senhaMsg, setSenhaMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [senhaFocada, setSenhaFocada] = useState(false);
  const [mudo, setMudo] = useState(false);
  // O navegador não deixou tocar som sem um toque na tela (política de som automático): a faixa pede o toque.
  const [somBloqueado, setSomBloqueado] = useState(false);
  // Preferências da tela (por aparelho; guardadas no localStorage).
  const [view, setView] = useState<ViewCfg>(VIEW_PADRAO);
  const [telaDeToque, setTelaDeToque] = useState(false); // só para adivinhar a forma de uso
  // A gaveta ⚙ (o que é do aparelho, os avisos desta tela e o histórico), a lista "N avisos" e o diálogo do "Finalizar todos".
  const [gaveta, setGaveta] = useState<null | 'tela' | 'avisos' | 'historico'>(null);
  // Na aba "Histórico": os avisos que foram ao rodapé (mig 412) ou as ações de quem mexeu na tela.
  const [histVer, setHistVer] = useState<'avisos' | 'acoes'>('avisos');
  // A aba "Avisos": o rascunho do que esta tela recebe (salvo no servidor, mig 408) e o estado do "Salvar".
  const [rascunhoAvisos, setRascunhoAvisos] = useState<AvisosDoKds | null>(null);
  const [salvandoAvisos, setSalvandoAvisos] = useState(false);
  const [erroAvisos, setErroAvisos] = useState('');
  // A faixa da pausa dos canais (onda 2): os pausados agora na loja e o aviso antes de reabrir.
  const [pausas, setPausas] = useState<{ canais: CanalPausadoNoKds[]; avisoMinutos: number }>({ canais: [], avisoMinutos: 5 });
  const [listaAberta, setListaAberta] = useState(false);
  const [dialogoFinalizar, setDialogoFinalizar] = useState(false);
  // O aviso curto depois de cada toque (L13).
  const [toque, setToque] = useState<{ texto: string; erro: boolean; n: number } | null>(null);
  const toqueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // O que ESTA tela mostra (por aparelho): os pedidos (padrão) ou o mapa dos entregadores —
  // o mapa só se o gestor ligou a chave da loja (mig 293, Delivery → Configurações).
  const [tela, setTela] = useState<'pedidos' | 'mapa'>('pedidos');
  const [mapaHabilitado, setMapaHabilitado] = useState<boolean | null>(null);
  const cfgBtRef = useRef<HTMLButtonElement | null>(null);
  const histBtRef = useRef<HTMLButtonElement | null>(null);
  const fimBtRef = useRef<HTMLButtonElement | null>(null);
  const maisBtRef = useRef<HTMLButtonElement | null>(null);
  const gavetaFecharRef = useRef<HTMLButtonElement | null>(null);
  const dialogoNaoRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    try {
      const s = localStorage.getItem('kds-view');
      if (s) setView(normalizarView(JSON.parse(s)));
      if (localStorage.getItem('kds-tela') === 'mapa') setTela('mapa');
      if (localStorage.getItem('kds-ver') === 'item') setVer('item');
      // Resumo: aberto por padrão em tela larga; a escolha do aparelho vale sobre o padrão.
      const r = localStorage.getItem('kds-resumo');
      setResumoAberto(r ? r === '1' : window.innerWidth >= 1280);
      setTelaDeToque(window.matchMedia?.('(pointer: coarse)').matches === true);
    } catch { /* ignora */ }
  }, []);
  function escolherTela(t: 'pedidos' | 'mapa') {
    setTela(t);
    try { localStorage.setItem('kds-tela', t); } catch { /* ignora */ }
  }
  function escolherVer(v: 'pedido' | 'item') {
    setVer(v);
    try { localStorage.setItem('kds-ver', v); } catch { /* ignora */ }
  }
  function abrirResumo(aberto: boolean) {
    setResumoAberto(aberto);
    if (!aberto) setItemSel('');
    try { localStorage.setItem('kds-resumo', aberto ? '1' : '0'); } catch { /* ignora */ }
  }
  // O gestor desligou a chave com a tela no mapa: volta aos pedidos (sem apagar a escolha —
  // se ligarem de novo, a tela volta sozinha ao mapa na próxima abertura).
  const mapaDesligado = useCallback(() => setMapaHabilitado(false), []);
  // O painel do Delivery mandou ESTE KDS mostrar o mapa (entrega 5, mig 338): vale sobre a escolha do aparelho, e o ⚙ diz
  // de onde veio. Tirado do KDS no painel, a tela volta aos pedidos (também se o aparelho tinha escolhido o mapa).
  const mapaDoPainel = !!kdsSel && kdsList.some((k) => k.id === kdsSel && k.mapa === true);
  const mostrarMapa = (tela === 'mapa' || mapaDoPainel) && mapaHabilitado === true;
  const mapaDoPainelAntes = useRef(false);
  useEffect(() => {
    if (mapaDoPainelAntes.current && !mapaDoPainel) {
      setTela('pedidos');
      try { localStorage.setItem('kds-tela', 'pedidos'); } catch { /* ignora */ }
    }
    mapaDoPainelAntes.current = mapaDoPainel;
  }, [mapaDoPainel]);
  // Marcado pelo painel com a chave da loja desligada: confere a chave de novo a cada 30 s — ligada, a tela troca sozinha.
  useEffect(() => {
    if (!mapaDoPainel || mapaHabilitado === true) return;
    const conferir = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      api.entregadoresAoVivoKds()
        .then((r: any) => setMapaHabilitado(r?.habilitado === true))
        .catch(() => { /* mantém */ });
    };
    conferir();
    const t = setInterval(conferir, 30000);
    return () => clearInterval(t);
  }, [mapaDoPainel, mapaHabilitado]);
  function setViewCfg(patch: Partial<ViewCfg>) {
    setView((v) => {
      const novo = { ...v, ...patch };
      try { localStorage.setItem('kds-view', JSON.stringify(novo)); } catch { /* ignora */ }
      return novo;
    });
  }
  const esc = view.escala; // tamanho da letra
  // Forma de uso: TECLADO (o campo da senha é o dono do foco) ou TOQUE (nada depende do foco).
  const uso = formaDeUso(view.uso, telaDeToque);
  const [pedirTelaCheia, setPedirTelaCheia] = useState(false);
  // Tema do KDS (preferência do aparelho — UI, não dado de negócio). CLARO por padrão.
  const [claro, setClaro] = useState(true);
  // Armazenamento bloqueado (janela privada, dados limpos) não quebra a tela (auditoria do KDS, 11/11/2026): fica no claro.
  useEffect(() => {
    try {
      setClaro(localStorage.getItem('kds-tema') !== 'escuro');
    } catch {
      /* sem armazenamento: o padrão (claro) */
    }
  }, []);
  const T = claro ? TEMAS.claro : TEMAS.escuro;
  function escolherTema(novoClaro: boolean) {
    setClaro(novoClaro);
    try {
      localStorage.setItem('kds-tema', novoClaro ? 'claro' : 'escuro');
    } catch {
      /* sem armazenamento: vale só nesta sessão */
    }
  }
  // null no SSR/1ª render → evita hydration mismatch do relógio (server ≠ client).
  const [now, setNow] = useState<Date | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const mudoRef = useRef(mudo);
  mudoRef.current = mudo;
  const pedidosRef = useRef<any[]>([]); // a lista desta tela (cartões ou, no despacho, pedidos) — atribuída abaixo
  const filaSeq = useRef(0); // número da leitura mais nova da fila: resposta de leitura velha que chega depois não vale
  const setorRef = useRef(setorSel);
  setorRef.current = setorSel;
  const canalRef = useRef(canal);
  canalRef.current = canal;
  // Sub-filtro de origem em uso (o mesmo que filtra a tela, mais abaixo): o som e o alerta só valem para o que se vê.
  const subAtivoRef = useRef('todos');
  subAtivoRef.current = canal === 'delivery' ? subDelivery : canal === 'balcao' ? subBalcao : 'todos';
  const kdsRef = useRef(kdsSel);
  kdsRef.current = kdsSel;
  const despachoRef = useRef(false); // este aparelho é o KDS de despacho (Cozinha em estações, entrega 2)
  // Os avisos que esta tela recebe (mig 408) — os ouvintes do tempo real leem pela ref (atribuída abaixo, com o KDS).
  const avisosRef = useRef<AvisosDoKds>(avisosPadrao(null));
  const usoRef = useRef(uso);
  usoRef.current = uso;
  const senhaRef = useRef<HTMLInputElement | null>(null); // Fase F — campo de senha (foco)
  const senhaDigitadaRef = useRef('');
  senhaDigitadaRef.current = senhaDigitada;
  const senhaMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // O aviso curto depois de cada toque: some sozinho; o de erro fica um pouco mais.
  const mostrarToque = useCallback((texto: string, erro = false) => {
    if (toqueTimer.current) clearTimeout(toqueTimer.current);
    setToque((t) => ({ texto, erro, n: (t?.n ?? 0) + 1 }));
    toqueTimer.current = setTimeout(() => setToque(null), erro ? 6000 : 3200);
  }, []);
  useEffect(() => () => { if (toqueTimer.current) clearTimeout(toqueTimer.current); }, []);

  // UM contexto de áudio para a tela inteira (auditoria do KDS, 11/11/2026): antes cada bipe criava um e nunca fechava —
  // num turno de 8 h eram centenas abertos (o navegador limita e o som parava). Se o navegador o suspendeu (aba em
  // segundo plano, economia de energia, ou a página abriu sem nenhum toque), retoma antes de tocar; sem conseguir, a
  // faixa "Som pausado pelo navegador" pede um toque.
  const audioRef = useRef<AudioContext | null>(null);
  const contextoDeAudio = useCallback((): AudioContext | null => {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      if (!audioRef.current || audioRef.current.state === 'closed') audioRef.current = new AC();
      return audioRef.current;
    } catch {
      return null;
    }
  }, []);
  const liberarSom = useCallback(() => {
    const ctx = contextoDeAudio();
    if (!ctx) return;
    void ctx
      .resume()
      .then(() => setSomBloqueado(ctx.state !== 'running'))
      .catch(() => undefined);
  }, [contextoDeAudio]);
  useEffect(() => {
    const ctx = contextoDeAudio();
    if (ctx?.state === 'suspended') setSomBloqueado(true);
    // O primeiro toque (ou tecla) em qualquer lugar libera o som.
    const primeiro = () => liberarSom();
    window.addEventListener('pointerdown', primeiro, { once: true });
    window.addEventListener('keydown', primeiro, { once: true });
    return () => {
      window.removeEventListener('pointerdown', primeiro);
      window.removeEventListener('keydown', primeiro);
      void audioRef.current?.close().catch(() => undefined);
      audioRef.current = null;
    };
  }, [contextoDeAudio, liberarSom]);
  const bip = useCallback(
    (som: Som = 'novo') => {
      if (mudoRef.current) return;
      try {
        const ctx = contextoDeAudio();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
          // A retomada é assíncrona: se em pouco tempo o som não voltou, o navegador está esperando um toque.
          void ctx.resume().then(() => setSomBloqueado(ctx.state !== 'running')).catch(() => undefined);
          setTimeout(() => {
            if (ctx.state === 'suspended') setSomBloqueado(true);
          }, 400);
        }
        const forte = som === 'urgente' ? 0.32 : 0.26;
        for (const t of TONS[som]) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = som === 'urgente' ? 'square' : 'sine';
          osc.frequency.value = t.f;
          const ini = ctx.currentTime + t.ini;
          gain.gain.setValueAtTime(0.0001, ini);
          gain.gain.exponentialRampToValueAtTime(som === 'urgente' ? forte / 2 : forte, ini + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, ini + t.dur);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ini);
          osc.stop(ini + t.dur + 0.02);
        }
      } catch {
        /* áudio indisponível — ignora */
      }
    },
    [contextoDeAudio],
  );

  // "Cheguei" na retirada (mig 354): o cartão desta tela ganhou a chegada do cliente (ou ele avisou de novo) entre uma
  // leitura e outra → aviso no rodapé + som. Montado aqui, na tela (como o do cancelamento): vale na nuvem e no servidor
  // da loja, onde a chegada desce pelo sync sem evento. A primeira leitura é a base (não avisa o que já estava lá).
  const chegadasVistas = useRef<Map<string, string> | null>(null);
  const avisarChegadas = useCallback(
    (lista: any[]) => {
      const base = chegadasVistas.current === null;
      const mapa = chegadasVistas.current ?? new Map<string, string>();
      const novos: any[] = [];
      for (const p of lista) {
        const c = p?.chegada;
        if (!c || !p.comandaId || p.situacao === 'cancelado' || p.status === 'cancelado') continue;
        const aviso = String(c.deNovoEm ?? c.chegouEm);
        if (mapa.get(p.comandaId) !== aviso) {
          if (!base) novos.push(p);
          mapa.set(p.comandaId, aviso);
        }
      }
      chegadasVistas.current = mapa;
      // A tela que não recebe "Cliente chegou" (a de preparo, por padrão — mig 408) só anota que viu: a etiqueta segue no
      // cartão, sem aviso nem som.
      if (!novos.length || !recebeAviso(avisosRef.current, 'chegou')) return;
      const ondeTxt = (c: any) =>
        c?.onde === 'balcao' ? `No balcão${c.obs ? ` · ${c.obs}` : ''}` : c?.onde === 'porta' ? `Na porta${c.obs ? `: ${c.obs}` : ''}` : c?.obs ?? 'Para retirar';
      const em = new Date().toISOString();
      setAlertas((prev) => [
        ...novos.map((p) => ({
          id: `cheg-${p.comandaId}`,
          titulo: `🙋 Cliente chegou — ${identPedido(p)}`,
          detalhe: ondeTxt(p.chegada),
          prioridade: 'alta' as const,
          em,
          restanteSeg: 30,
          origem: 'Cliente chegou (retirada)',
        })),
        ...prev.filter((x) => !novos.some((p) => x.id === `cheg-${p.comandaId}`)),
      ]);
      bip('aviso');
    },
    [bip],
  );

  // PEDIDO ALTERADO (mig 362): o cartão desta tela ganhou uma alteração que a cozinha ainda não viu → aviso no rodapé e
  // som. Pela leitura da fila (como o "Cheguei"): vale na nuvem e no servidor da loja, onde a mudança desce pelo sync. A
  // primeira leitura é a base — o som que repete até o "Visto" cobre o que já estava lá. Fica no rodapé até o "Visto".
  const alteracoesVistas = useRef<Map<string, string> | null>(null);
  const avisarAlteracoes = useCallback(
    (lista: any[]) => {
      const base = alteracoesVistas.current === null;
      const mapa = alteracoesVistas.current ?? new Map<string, string>();
      const novos: any[] = [];
      for (const p of lista) {
        if (!p?.alteracaoNaoVista || p.status === 'cancelado' || !p.alteradoEm) continue;
        if (!cartaoNaTela(lista, p.id, canalRef.current, subAtivoRef.current)) continue;
        const em = String(p.alteradoEm);
        if (mapa.get(p.id) !== em) {
          if (!base) novos.push(p);
          mapa.set(p.id, em);
        }
      }
      alteracoesVistas.current = mapa;
      if (!novos.length) return;
      const em = new Date().toISOString();
      setAlertas((prev) => [
        ...novos.map((p) => ({
          id: `alt-${p.id}`,
          titulo: `! Pedido alterado — ${identPedido(p)}`,
          detalhe: textoDaAlteracao(p),
          prioridade: 'danger' as const,
          em,
          restanteSeg: 60,
          fica: true,
          origem: 'Pedido alterado',
          cartaoId: p.id,
        })),
        ...prev.filter((x) => !novos.some((p) => x.id === `alt-${p.id}`)),
      ]);
      bip('urgente');
    },
    [bip],
  );

  // Devolve a fila nova (ou null se falhou) — o som de pedido novo confere se o cartão entrou NESTA tela.
  // O urgente que ainda espera o "Ciente" (mig 412): a tela recarregada, ou que ficou sem conexão, recupera do servidor —
  // antes ele se perdia. Só os tipos que esta tela recebe e os que são para este KDS; o que já está no rodapé não repete.
  // Rota ausente (servidor da loja antes do `.zip`) ou sem login de pessoa: segue só com o que chega ao vivo.
  const recuperarPendentes = useCallback(async () => {
    if (!getToken()) return;
    try {
      const r: any = await api.kdsAvisosPendentes();
      const lista: any[] = Array.isArray(r) ? r : [];
      setAlertas((prev) => {
        const novos = lista
          .filter((a) => recebeAviso(avisosRef.current, a.tipo ?? 'loja') && alertaParaEstaTela(a, kdsRef.current))
          .filter((a) => !prev.some((x) => x.id === String(a.id)))
          .map(alertaDoServidor);
        return novos.length ? [...prev, ...novos] : prev;
      });
    } catch {
      /* segue com o ao vivo */
    }
  }, []);

  const carregarFila = useCallback(async (): Promise<any[] | null> => {
    if (!getToken()) return null; // fila durável requer operador logado (JWT)
    const seq = ++filaSeq.current;
    const despacho = despachoRef.current && !!kdsRef.current;
    try {
      // O despacho lê o pedido inteiro, com o andamento de cada estação; os outros KDS, os cartões deles.
      const r: any = despacho
        ? await api.kdsDespacho(kdsRef.current, canalRef.current)
        : await api.producaoFila(setorRef.current || undefined, undefined, canalRef.current, kdsRef.current || undefined);
      // Uma leitura mais nova já saiu (trocou o KDS, o canal ou chegou outro aviso): esta resposta atrasada não vale —
      // senão a fila de antes podia cobrir a de agora.
      if (seq !== filaSeq.current) return null;
      const lista = r.pedidos ?? [];
      if (despacho) setPedidosDespacho(lista);
      else setPedidos(lista);
      if (r.cores) setCores(r.cores);
      setNuvemComServidor(r?.nuvemComServidor === true);
      avisarChegadas(lista);
      if (!despacho) avisarAlteracoes(lista);
      setFalhaFila(null);
      setFilaLida(true);
      return lista;
    } catch (e: any) {
      // Mantém a fila atual, mas a cozinha FICA SABENDO que ela pode estar velha (erro, limite de chamadas, módulo
      // desligado, rede): antes a falha sumia e a tela vazia dizia "Nenhum pedido" com o "online" aceso (auditoria do
      // KDS, 11/11/2026; V37: a tela separa "vazio" de "não li"). A releitura de 30 s tenta de novo.
      if (seq === filaSeq.current) setFalhaFila({ em: new Date(), motivo: String(e?.message ?? '').slice(0, 120) });
      return null;
    }
  }, [avisarChegadas, avisarAlteracoes]);

  useEffect(() => {
    setNow(new Date()); // só no cliente
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // A FAIXA DA PAUSA (onda 2 da auditoria do KDS — "incluir o status das lojas de delivery pausadas nos alertas"): os
  // canais pausados agora na loja. Relida a cada 30 s, no aviso do servidor (`kds:pausa`) e quando o contador de um canal
  // chega ao fim. Só a resposta da leitura mais nova vale (V64); a falha mantém a faixa como estava (servidor antigo sem a
  // rota: a faixa só não aparece).
  const pausasSeq = useRef(0);
  const relerPausas = useCallback(() => {
    if (!getToken()) return;
    const seq = ++pausasSeq.current;
    api
      .kdsPausas()
      .then((r) => {
        if (seq !== pausasSeq.current) return;
        const novo = {
          canais: Array.isArray(r?.canais) ? r.canais : [],
          avisoMinutos: Number(r?.avisoMinutos) >= 0 ? Number(r.avisoMinutos) : 5,
        };
        setPausas((antes) => (JSON.stringify(antes) === JSON.stringify(novo) ? antes : novo));
      })
      .catch(() => {
        /* mantém a faixa */
      });
  }, []);
  const relerPausasRef = useRef(relerPausas);
  relerPausasRef.current = relerPausas;

  // Fase E — KDS da loja (p/ o seletor de cadeia). Pela lista das telas de KDS (quem tem o módulo vê): a de equipamentos
  // pede gerente, e o aparelho da cozinha ficava sem escolher qual KDS é. Relida a cada 30 s e no aviso do painel
  // (`kds:telas`): o mapa mandado pelo Delivery (entrega 5) chega sem recarregar — do painel na nuvem para o servidor da
  // loja, pelo sync. Só a resposta da leitura mais nova vale (V64); lista igual não troca o estado.
  const telasSeq = useRef(0);
  const relerTelas = useCallback(() => {
    if (!getToken()) return;
    const seq = ++telasSeq.current;
    api.kdsTelas()
      .then((telas: any) => {
        if (seq !== telasSeq.current) return;
        const nova = Array.isArray(telas) ? telas : [];
        setKdsList((antes) => (JSON.stringify(antes) === JSON.stringify(nova) ? antes : nova));
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      relerTelas();
      relerPausas();
    }, 30000);
    return () => clearInterval(t);
  }, [relerTelas, relerPausas]);

  useEffect(() => {
    if (getToken()) {
      api.setores().then(setSetores).catch(() => {});
      api.entregadoresAoVivoKds()
        .then((r: any) => setMapaHabilitado(r?.habilitado === true))
        .catch(() => setMapaHabilitado(false));
      relerTelas();
      relerPausas();
      // Restaura a última escolha de "Este KDS" e do canal.
      try {
        const s = localStorage.getItem('kds-equip');
        if (s) setKdsSel(s);
        const c = localStorage.getItem('kds-canal');
        if (c === 'balcao' || c === 'delivery' || c === 'todos') setCanal(c);
      } catch { /* ignora */ }
    }
  }, [relerTelas, relerPausas]);

  function escolherKds(id: string) {
    setKdsSel(id);
    try { localStorage.setItem('kds-equip', id); } catch { /* ignora */ }
  }
  function escolherCanal(c: 'balcao' | 'delivery' | 'todos') {
    setCanal(c);
    try { localStorage.setItem('kds-canal', c); } catch { /* ignora */ }
  }

  // Atalho: um .url que carrega o KDS já com a config atual + tela cheia. O usuário
  // salva na área de trabalho; ao abrir, o KDS lê `?cfg=` e aplica tudo.
  function criarAtalho() {
    const cfg = {
      view, tema: claro ? 'claro' : 'escuro', canal, setor: setorSel,
      kds: kdsSel, subDelivery, subBalcao, mudo, tela, ver,
    };
    const enc = btoa(encodeURIComponent(JSON.stringify(cfg)));
    const url = `${window.location.origin}/kds?cfg=${enc}&full=1`;
    const blob = new Blob([`[InternetShortcut]\r\nURL=${url}\r\n`], { type: 'application/x-mswinurl' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `KDS Regem${kdsAtual?.nome ? ' - ' + kdsAtual.nome : ''}.url`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Ao abrir por um atalho (?cfg=…), aplica a config; ?full=1 oferece tela cheia.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cfg = params.get('cfg');
    if (cfg) {
      try {
        const c = JSON.parse(decodeURIComponent(atob(cfg)));
        if (c.view) setView(normalizarView(c.view));
        if (c.tema) setClaro(c.tema !== 'escuro');
        if (c.canal) setCanal(c.canal);
        if (c.setor != null) setSetorSel(c.setor);
        if (c.kds != null) setKdsSel(c.kds);
        if (c.subDelivery) setSubDelivery(c.subDelivery);
        if (c.subBalcao) setSubBalcao(c.subBalcao);
        if (c.mudo != null) setMudo(!!c.mudo);
        if (c.tela === 'mapa' || c.tela === 'pedidos') setTela(c.tela);
        if (c.ver === 'item' || c.ver === 'pedido') setVer(c.ver);
      } catch { /* ignora cfg inválida */ }
    }
    if (params.get('full') === '1') setPedirTelaCheia(true);
  }, []);
  const kdsAtual = kdsList.find((k) => k.id === kdsSel) || null;
  // Os avisos que esta tela recebe: os do KDS escolhido (o salvo por cima do padrão do tipo dele), ou o padrão da loja de
  // um KDS só (sem os de gestão). Servidor da loja ainda sem a mig 408: o padrão do tipo.
  const avisosDaTela = avisosDoKds(kdsAtual?.escopo ?? null, kdsAtual?.avisos);
  avisosRef.current = avisosDaTela;
  const modoEntrega = kdsAtual?.escopo === 'entrega'; // Fase E3 — board só-senha
  const modoDespacho = kdsAtual?.escopo === 'despacho'; // o pedido inteiro, com o andamento das estações
  despachoRef.current = modoDespacho;
  // A lista desta tela: no despacho, os pedidos inteiros; nos outros KDS, os cartões.
  const lista = modoDespacho ? pedidosDespacho : pedidos;
  pedidosRef.current = lista;
  // No fluxo entre KDS: o botão diz para onde o cartão vai ("Pronto → Montagem") e o cartão, de onde veio.
  const nomeKds = (id?: string | null) => (id ? kdsList.find((k) => k.id === id)?.nome ?? null : null);
  const proximoDoCartao = (p: any) => nomeKds(kdsList.find((k) => k.id === (p.destinoEquipamentoId ?? kdsSel))?.proximoKdsId);
  const veioDoCartao = (p: any) => {
    const passagens = Array.isArray(p.estacoes) ? p.estacoes : [];
    return passagens.length ? nomeKds(passagens[passagens.length - 1]?.kds) : null;
  };

  // Recarrega quando muda o setor, o canal ou o KDS operado (e quando o aparelho vira, ou deixa de ser, despacho). Trocou
  // de KDS: os pedidos do despacho anterior saem da tela antes da leitura nova.
  useEffect(() => {
    setPedidosDespacho([]);
  }, [kdsSel]);
  useEffect(() => {
    carregarFila();
  }, [setorSel, canal, kdsSel, modoDespacho, carregarFila]);

  // A situação do entregador da 99 (mig 294) chega ao servidor da loja pelo sync, sem evento de
  // tela: uma recarga leve a cada 30 s mantém o "chegou na loja" em dia.
  useEffect(() => {
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void carregarFila();
    }, 30000);
    return () => clearInterval(t);
  }, [carregarFila]);

  useEffect(() => {
    // Device real: ?token=… (um KDS físico abre app.dmsregem.com/kds?token=…).
    // Sem token, cai para sessão de gestor (JWT) — modo de teste/monitoramento.
    const deviceToken = new URLSearchParams(window.location.search).get('token');
    if (!deviceToken && !getToken()) {
      setTemSessao(false);
      return;
    }
    setTemSessao(true);
    void carregarFila();
    void recuperarPendentes();
    const socket = deviceToken
      ? connectAsDevice(deviceToken)
      : connectAsGestor();
    socketRef.current = socket;

    socket.on('connect', () => setConectado(true));
    socket.on('disconnect', () => setConectado(false));

    // A tela que conecta (ou reconecta depois de uma queda) recupera o urgente que ainda espera o "Ciente" (mig 412).
    socket.on('connect', () => void recuperarPendentes());

    // Aviso para o rodapé (alertas cadastrados, estoque, gestão, Farol), já guardado no servidor (mig 412).
    socket.on('kds:alerta', (a: any) => {
      // Cada tela escolhe os tipos que recebe (aba "Avisos" do ⚙, mig 408): o de gestão não toca na tela de preparo.
      if (!recebeAviso(avisosRef.current, a.tipo ?? 'loja')) return;
      // O alerta cadastrado para outros KDS (a troca do óleo só na Fritadeira — mig 409) não toca aqui.
      if (!alertaParaEstaTela(a, kdsRef.current)) return;
      const novo = alertaDoServidor(a);
      setAlertas((prev) => [novo, ...prev.filter((x) => x.id !== novo.id)]);
      if (a.som !== false) bip(novo.prioridade === 'danger' ? 'urgente' : 'aviso');
    });

    // "Ciente" dado noutra tela (mig 412): o aviso sai daqui também.
    socket.on('kds:aviso-ciente', (p: any) => {
      if (p?.id) setAlertas((prev) => prev.filter((x) => x.id !== String(p.id)));
    });

    // Nudge de produção → refaz o GET (fonte da verdade). Novo pedido = som. O evento vem para a empresa inteira: só
    // apita e alerta o que é DESTA tela (cartaoNaTela — fila deste KDS + sub-filtro escolhido aqui).
    // O evento vem por CARTÃO; no despacho a tela mostra o pedido inteiro (o cartão é um dos dele).
    const naTela = (lista: any[], cartaoId: string) =>
      despachoRef.current
        ? pedidoDoDespachoNaTela(lista, cartaoId, canalRef.current, subAtivoRef.current)
        : cartaoNaTela(lista, cartaoId, canalRef.current, subAtivoRef.current);
    socket.on('producao:atualizado', (p: any) => {
      // Cancelamento: avisa a cozinha ANTES de sumir da fila (som + aviso) — se o cartão estava nesta tela. Fica no rodapé
      // até alguém tocar em "Ciente": a cozinha precisa saber para não fazer.
      const alvo = p?.tipo === 'cancelado' ? naTela(pedidosRef.current, p.pedidoId) : undefined;
      if (alvo) {
        const ref = alvo?.senha
          ? `Senha ${rotuloSenha(alvo.senha, alvo.senhaPrefixo)}`
          : alvo?.mesa
            ? `Mesa ${alvo.mesa}`
            : alvo?.plataforma
              ? `${alvo.plataforma}${alvo.senhaPlataforma ? ` #${alvo.senhaPlataforma}` : ''}`
              : 'Pedido';
        setAlertas((prev) => [
          {
            id: `canc-${p.pedidoId}`,
            titulo: `❌ Cancelado — ${ref}`,
            detalhe: 'Não preparar. Descartar o que já saiu.',
            prioridade: 'danger',
            em: p.em ?? new Date().toISOString(),
            restanteSeg: 0,
            fica: true,
            ciente: true,
            origem: 'Pedido cancelado',
          },
          ...prev.filter((x) => x.id !== `canc-${p.pedidoId}`),
        ]);
        bip('urgente');
      }
      void carregarFila().then((lista) => {
        if (p?.tipo === 'novo' && lista && naTela(lista, p.pedidoId)) bip('novo');
      });
    });

    // O painel do Delivery mandou o mapa para KDS (ou tirou), ou mudaram os avisos de uma tela: relê a lista das telas — a
    // deste aparelho diz o que mostrar e o que recebe.
    socket.on('kds:telas', () => relerTelas());
    // Pausaram, reabriram ou estenderam um canal: a faixa relê na hora.
    socket.on('kds:pausa', () => relerPausasRef.current());

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [bip, carregarFila, relerTelas, recuperarPendentes]);

  // Sem conexão: avisa em faixa (a fila na tela pode estar velha). Espera 4 s para não piscar na abertura nem numa queda
  // momentânea.
  const [semConexao, setSemConexao] = useState(false);
  const [semConexaoDesde, setSemConexaoDesde] = useState<Date | null>(null);
  useEffect(() => {
    if (temSessao !== true || conectado) {
      setSemConexao(false);
      setSemConexaoDesde(null);
      return;
    }
    const desde = new Date();
    const t = setTimeout(() => {
      setSemConexao(true);
      setSemConexaoDesde(desde);
    }, 4000);
    return () => clearTimeout(t);
  }, [conectado, temSessao]);

  // "Visto" no cartão alterado (mig 362): o aviso grande, o som e o rodapé param; o item tirado sai do cartão.
  async function visto(id: string) {
    try {
      await api.producaoVisto(id);
    } catch {
      /* outra tela já marcou (ou o cartão saiu): a releitura corrige */
    }
    setAlertas((prev) => prev.filter((a) => a.id !== `alt-${id}`));
    await carregarFila();
  }

  // "Ciente" no rodapé ou na lista: o aviso sai. O do pedido alterado é o mesmo "Visto" do cartão.
  function ciente(a: Alerta) {
    if (a.cartaoId) {
      void visto(a.cartaoId);
    } else {
      setAlertas((prev) => prev.filter((x) => x.id !== a.id));
      // O aviso guardado (mig 412): o "Ciente" fica registrado (quem e quando) e sai das outras telas. Sem login de pessoa
      // (aparelho só com o token) ou sem rede, vale só nesta tela, como antes.
      if (a.servidor && getToken()) void api.kdsAvisoCiente(a.id, kdsRef.current || null).catch(() => undefined);
    }
    mostrarToque(`Ciente: ${a.titulo.replace(/^[^\p{L}\p{N}]+/u, '')}`);
  }

  // Avança UM toque. Manda a etapa que esta tela viu (`de`): o servidor só avança se o cartão ainda está nela — o toque
  // duplo e a tela velha de outro aparelho não pulam etapa. Enquanto a resposta não volta, o segundo toque no mesmo
  // cartão é ignorado e o botão diz "Aguarde…". Depois, o aviso curto diz o que o SERVIDOR fez ("Senha B-12 → Em
  // preparo") — e a recusa aparece (antes era calada: R15). Quem diz se esta tela conclui o pedido (KDS de entrega) é o
  // cadastro do KDS escolhido, no servidor.
  async function avancar(p: any, de?: string) {
    const id = p.id;
    if (avancandoRef.current.has(id)) return;
    avancandoRef.current.add(id);
    setAvancando(new Set(avancandoRef.current));
    try {
      const r: any = await api.producaoAvancar(id, kdsSel || undefined, de, modoEntrega ? 'entrega' : undefined);
      mostrarToque(textoDoToque(identPedido(p), r, nomeKds));
      await carregarFila();
    } catch (e: any) {
      // Outra tela já avançou (409), o pedido foi cancelado, a etapa é de outro KDS: a tela diz por quê e relê.
      mostrarToque(`${identPedido(p)}: ${e?.message || 'não avançou. Tente de novo.'}`, true);
      void carregarFila();
    } finally {
      avancandoRef.current.delete(id);
      setAvancando(new Set(avancandoRef.current));
    }
  }

  // Despacho: a ação vale para o PEDIDO inteiro (todos os cartões, numa requisição). Devolve o motivo da recusa (ex.:
  // "Falta: Montagem.", "Senha de gestor inválida.") para a tela mostrar, ou null.
  async function acaoDespacho(p: any, acao: 'pronto' | 'entregue', senha?: string): Promise<string | null> {
    if (!kdsSel) return 'Escolha qual KDS é este aparelho no ⚙.';
    try {
      await api.kdsDespachoAcao(kdsSel, { comandaId: p.comandaId, acao, ...(senha ? { forcar: true, senha } : {}) });
      await carregarFila();
      return null;
    } catch (e: any) {
      void carregarFila();
      return e?.message || 'Não consegui agora. Tente de novo.';
    }
  }

  // Um segundo do rodapé: só o aviso mostrado conta; o que fica até o "Ciente" não conta (regra em `passarUmSegundo`).
  useEffect(() => {
    const t = setInterval(() => setAlertas((prev) => passarUmSegundo(prev)), 1000);
    return () => clearInterval(t);
  }, []);

  const mostrado = escolherAlertaDoRodape(alertas);
  const nowMs = now ? now.getTime() : Date.now();

  // A faixa da pausa: só os canais ainda dentro da hora; nos minutos do aviso da loja antes de reabrir, o contador fica em
  // âmbar (com um bipe). O canal que sai da faixa (reabriram antes, ou a hora chegou) vira o aviso positivo "reabriu".
  const recebePausa = recebeAviso(avisosDaTela, 'pausa');
  const faixasDaPausa = pausas.canais
    .map((c) => ({ c, f: faixaDaPausa(c, nowMs, pausas.avisoMinutos) }))
    .filter((x): x is { c: CanalPausadoNoKds; f: NonNullable<ReturnType<typeof faixaDaPausa>> } => !!x.f);
  const chaveDasPausas = faixasDaPausa.map((x) => `${x.c.canal}@${x.c.ate}`).join('|');
  const logoDasPausas = faixasDaPausa.filter((x) => x.f.logo).map((x) => `${x.c.canal}@${x.c.ate}`).join('|');
  const pausasAntes = useRef<Map<string, CanalPausadoNoKds> | null>(null);
  useEffect(() => {
    const atuais = new Map(faixasDaPausa.map((x) => [x.c.canal, x.c]));
    const antes = pausasAntes.current;
    pausasAntes.current = atuais;
    if (!antes) return; // a primeira leitura é a base
    const reabertos = [...antes.values()].filter((c) => !atuais.has(c.canal));
    if (!reabertos.length) return;
    relerPausasRef.current(); // a hora chegou nesta tela: confere com o servidor (estenderam noutra?)
    if (!recebeAviso(avisosRef.current, 'pausa')) return;
    const em = new Date().toISOString();
    setAlertas((prev) => [
      ...reabertos.map((c) => ({
        id: `reab-${c.canal}-${c.ate}`,
        titulo: `✓ ${c.nome} reabriu`,
        detalhe: 'Os pedidos voltaram a entrar.',
        prioridade: 'ok' as const,
        em,
        restanteSeg: 30,
        origem: 'Pausa dos canais',
      })),
      ...prev.filter((x) => !reabertos.some((c) => x.id === `reab-${c.canal}-${c.ate}`)),
    ]);
    bip('aviso');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDasPausas]);
  const avisadosLogo = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const k of logoDasPausas.split('|').filter(Boolean)) {
      if (avisadosLogo.current.has(k)) continue;
      avisadosLogo.current.add(k);
      if (recebeAviso(avisosRef.current, 'pausa')) bip('aviso');
    }
  }, [logoDasPausas, bip]);

  // Fase C — pedidos filtrados pela sub-origem do canal ativo (client-side).
  // canal 'todos' (KDS único) não aplica sub-filtro.
  const subAtivo = canal === 'delivery' ? subDelivery : canal === 'balcao' ? subBalcao : 'todos';
  const pedidosOrigem =
    canal === 'todos' || subAtivo === 'todos'
      ? lista
      : lista.filter((p) => grupoPedido(p, canal as 'delivery' | 'balcao') === subAtivo);
  // Etapas: os contadores valem para a fila inteira; o filtro escolhe o que aparece.
  const contagem = contarEtapas(pedidosOrigem, nowMs, cores);
  const pedidosVisiveis = filtrarEtapa(pedidosOrigem, etapaSel, nowMs, cores);
  const grupos = ver === 'item' ? agruparPorItem(pedidosVisiveis, nowMs) : [];
  // O resumo ao lado só existe na visão por pedido (na visão por item seria a mesma soma duas vezes).
  const resumoVisivel = resumoAberto && ver === 'pedido' && !modoEntrega && !modoDespacho && !mostrarMapa;
  const itensResumo = resumoVisivel ? somarItens(pedidosOrigem, nowMs) : [];
  const itemAtivo = resumoVisivel && itensResumo.some((i) => i.descricao === itemSel) ? itemSel : '';
  // "Finalizar todos" leva só o que a tela MOSTRA; o diálogo diz quantos o filtro esconde.
  const finalizaveis = pedidosVisiveis.filter((p) => p.status !== 'cancelado' && p.status !== 'entregue');
  const escondidos = pedidosRef.current.filter((p) => p.status !== 'cancelado' && p.status !== 'entregue').length - finalizaveis.length;

  // PEDIDO ALTERADO (mig 362, decisão 6A): enquanto um cartão desta tela tiver alteração sem "Visto", o som repete — a cada
  // 1 ou 2 minutos (Delivery › Configurações › Operação › Atendimento › "Pedido alterado"); "uma vez" não repete.
  const somDoAlterado = String((cores as any).alteradoSom ?? '1min');
  const temAlteracaoNaoVista = !modoDespacho && pedidosOrigem.some((p: any) => p.alteracaoNaoVista && p.status !== 'cancelado');
  useEffect(() => {
    if (!temAlteracaoNaoVista || somDoAlterado === 'uma') return;
    const t = setInterval(() => bip('urgente'), somDoAlterado === '2min' ? 120_000 : 60_000);
    return () => clearInterval(t);
  }, [temAlteracaoNaoVista, somDoAlterado, bip]);

  function avisarSenha(texto: string, erro: boolean) {
    if (senhaMsgTimer.current) clearTimeout(senhaMsgTimer.current);
    setSenhaMsg({ texto, erro });
    // O erro fica até a próxima tecla; a confirmação some sozinha.
    if (!erro) senhaMsgTimer.current = setTimeout(() => setSenhaMsg(null), 3500);
  }
  function limparErroSenha() {
    setSenhaErro(false);
    setSenhaMsg((m) => (m?.erro ? null : m));
  }

  // Fase F — teclado numérico FÍSICO do equipamento: Enter avança o card daquela senha.
  // Vale para a fila INTEIRA do aparelho, não só para o que os filtros da tela mostram.
  function avancarPorSenha() {
    const s = senhaDigitadaRef.current.trim();
    if (!s) return;
    // Digitar só o número encontra as duas origens; digitar D12 ou D-12 separa o delivery
    // do balcão (mig 275 — cada origem tem a própria sequência).
    const alvo = pedidosRef.current.find((p) => senhaCasa(s, p.senha, p.senhaPrefixo) && p.status !== 'cancelado');
    if (!alvo) {
      setSenhaErro(true);
      avisarSenha(`Senha ${s} não está na fila`, true);
      return;
    }
    // No despacho, o Enter faz a ação do PEDIDO (despachar, chamar a senha ou entregar) — e só quando está liberada.
    if (despachoRef.current) {
      const { principal } = acoesDoDespacho(alvo);
      if (!principal?.liberada) {
        setSenhaErro(true);
        avisarSenha(`${identPedido(alvo)}: falta ${(alvo.falta ?? []).join(', ') || 'estação'}`, true);
        return;
      }
      setSenhaDigitada('');
      void acaoDespacho(alvo, principal.acao).then((erro) =>
        erro ? avisarSenha(`${identPedido(alvo)}: ${erro}`, true) : avisarSenha(`${identPedido(alvo)}: ${principal.rotulo.toLowerCase()}`, false),
      );
      if (usoRef.current === 'teclado') senhaRef.current?.focus({ preventScroll: true });
      return;
    }
    setSenhaDigitada('');
    // O aviso curto do toque (com a resposta do servidor) diz o que aconteceu.
    void avancar(alvo, alvo.status);
    if (usoRef.current === 'teclado') senhaRef.current?.focus({ preventScroll: true });
  }

  function abrirGaveta(aba: 'tela' | 'historico') {
    setListaAberta(false);
    setGaveta((g) => (g === aba ? null : aba));
  }
  const fecharGaveta = useCallback(() => {
    setGaveta((g) => {
      const voltar = g === 'historico' ? histBtRef.current : cfgBtRef.current;
      setTimeout(() => voltar?.focus({ preventScroll: true }), 0);
      return null;
    });
  }, []);
  // A aba "Avisos": o rascunho nasce do que a tela recebe agora; fechar a gaveta descarta o que não foi salvo.
  const podeMudarAvisos = podePerm('producao_kds');
  const chaveDosAvisos = JSON.stringify(avisosDaTela);
  useEffect(() => {
    if (gaveta !== 'avisos') {
      setRascunhoAvisos(null);
      setErroAvisos('');
    }
  }, [gaveta]);
  useEffect(() => {
    // O que está salvo mudou (outra tela, o sync): o rascunho recomeça dele se ninguém mexeu.
    setRascunhoAvisos((r) => (r && JSON.stringify(r) !== chaveDosAvisos ? r : null));
  }, [chaveDosAvisos]);
  const avisosMudados = rascunhoAvisos ? TIPOS_DE_AVISO.filter((t) => rascunhoAvisos[t] !== avisosDaTela[t]) : [];
  async function salvarAvisos() {
    if (!kdsAtual || !rascunhoAvisos || !avisosMudados.length) return;
    setSalvandoAvisos(true);
    setErroAvisos('');
    try {
      await api.salvarKdsAvisos(kdsAtual.id, Object.fromEntries(avisosMudados.map((t) => [t, rascunhoAvisos[t]])));
      relerTelas();
      mostrarToque('Avisos desta tela salvos');
      fecharGaveta();
    } catch (e: any) {
      setErroAvisos(e?.message || 'Não salvei os avisos. Tente de novo.');
    } finally {
      setSalvandoAvisos(false);
    }
  }
  const fecharDialogo = useCallback(() => {
    setDialogoFinalizar(false);
    setTimeout(() => fimBtRef.current?.focus({ preventScroll: true }), 0);
  }, []);
  // Gaveta e diálogo abertos: o foco entra neles (o fechar da gaveta; o "Cancelar" do diálogo, o lado seguro).
  useEffect(() => {
    if (gaveta) setTimeout(() => gavetaFecharRef.current?.focus({ preventScroll: true }), 0);
  }, [gaveta]);
  useEffect(() => {
    if (dialogoFinalizar) setTimeout(() => dialogoNaoRef.current?.focus({ preventScroll: true }), 0);
  }, [dialogoFinalizar]);

  // TECLADO do equipamento, mesmo com o foco fora do campo. A decisão é de `decidirTecla`:
  //  · forma de uso TECLADO — número, Enter e Backspace são SEMPRE da senha; a tecla é tomada
  //    antes de chegar ao botão em foco (fase de captura) e o foco vai para o campo. Enter sem
  //    número só leva o foco para o campo.
  //  · forma de uso TOQUE — como sempre foi: número solto cai na senha; Enter num botão é do botão.
  // Esc fecha só o que está por cima: o diálogo, depois a lista de avisos, depois a gaveta.
  const painelAberto = !!gaveta || dialogoFinalizar || produtosAberto || dialogoDespacho;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (dialogoFinalizar) return fecharDialogo();
        if (listaAberta) {
          setListaAberta(false);
          setTimeout(() => maisBtRef.current?.focus({ preventScroll: true }), 0);
          return;
        }
        if (gaveta) return fecharGaveta();
        return;
      }
      // Com painel aberto o teclado é do painel; no mapa não há card a avançar.
      if (painelAberto || pedirTelaCheia || mostrarMapa || temSessao !== true) return;
      const t = e.target as HTMLElement | null;
      const d = decidirTecla(uso, e.key, { tag: t?.tagName ?? '', ehCampoSenha: t === senhaRef.current });
      if (d.acao === 'ignorar') return;
      if (d.tomar) e.preventDefault();
      if (d.acao === 'digito') {
        limparErroSenha();
        setSenhaDigitada((v) => (v.length < 6 ? v + e.key : v));
      } else if (d.acao === 'enter') avancarPorSenha();
      else setSenhaDigitada((v) => v.slice(0, -1));
      if (d.tomar) senhaRef.current?.focus({ preventScroll: true });
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uso, painelAberto, pedirTelaCheia, mostrarMapa, temSessao, dialogoFinalizar, listaAberta, gaveta, fecharDialogo, fecharGaveta]);

  // Forma de uso TECLADO: o campo da senha é o dono do foco — ao abrir a tela, ao fechar um
  // painel, ao voltar para a janela e depois de QUALQUER clique (botão, filtro, cartão, fundo).
  // Assim não há como digitar um número com o foco em outro lugar. No TOQUE nada puxa o foco.
  const focoNaSenha = uso === 'teclado' && temSessao === true && !painelAberto && !pedirTelaCheia && !mostrarMapa;
  const focoNaSenhaRef = useRef(focoNaSenha);
  focoNaSenhaRef.current = focoNaSenha;
  useEffect(() => {
    if (!focoNaSenha) return;
    const focar = () => {
      if (focoNaSenhaRef.current) senhaRef.current?.focus({ preventScroll: true });
    };
    focar();
    const onClick = (e: MouseEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'SELECT' || tag === 'OPTION' || tag === 'INPUT' || tag === 'TEXTAREA') return; // o seletor precisa abrir
      setTimeout(focar, 0);
    };
    const onChange = (e: Event) => {
      if ((e.target as HTMLElement | null)?.tagName === 'SELECT') focar();
    };
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    window.addEventListener('focus', focar);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('change', onChange);
      window.removeEventListener('focus', focar);
    };
  }, [focoNaSenha]);
  // Passou para TOQUE: solta o campo (num tablet, o foco manteria o teclado da tela aberto).
  useEffect(() => {
    if (uso === 'toque' && document.activeElement === senhaRef.current) senhaRef.current?.blur();
  }, [uso]);

  // "Finalizar todos": o SERVIDOR avança todos os cartões num único request (vão para o próximo KDS ou concluem) — um
  // POST por cartão estourava o 429. Só os que a tela MOSTRA (sub-filtro e etapa): com "Totens" escolhido, antes finalizava
  // também o PDV e as mesas escondidos (auditoria do KDS, 11/11/2026). O servidor recebe os ids e confere que são da fila
  // deste KDS. A pergunta é um diálogo da própria tela (o `confirm` do navegador não seguia o tema nem a letra).
  async function finalizarTela() {
    const ativos = finalizaveis;
    setDialogoFinalizar(false);
    setTimeout(() => fimBtRef.current?.focus({ preventScroll: true }), 0);
    if (!ativos.length) return;
    try {
      const r: any = await api.producaoLimparFila({
        canal,
        setorId: setorSel || undefined,
        equipamentoId: kdsSel || undefined,
        ids: ativos.map((p) => p.id),
      });
      const n = Number(r?.avancados ?? ativos.length);
      mostrarToque(`${n} pedido${n === 1 ? '' : 's'} finalizado${n === 1 ? '' : 's'}`);
    } catch (e: any) {
      mostrarToque(`Não finalizei os pedidos: ${e?.message || 'tente de novo.'}`, true);
    }
    await carregarFila();
  }

  // O rodapé: o aviso que passa de 2 linhas ganha o "Ver tudo"; com vários, "N avisos" abre a lista.
  const letreiroRef = useRef<HTMLSpanElement | null>(null);
  const [cortado, setCortado] = useState(false);
  const [larguraTick, setLarguraTick] = useState(0);
  useEffect(() => {
    const r = () => setLarguraTick((n) => n + 1);
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);
  useEffect(() => {
    const el = letreiroRef.current;
    setCortado(!!el && el.scrollHeight > el.clientHeight + 1);
  }, [mostrado?.id, mostrado?.titulo, mostrado?.detalhe, larguraTick, esc]);
  const ordenados = ordenarAlertas(alertas);
  useEffect(() => {
    if (!alertas.length) setListaAberta(false);
  }, [alertas.length]);

  const nomeDaTela = kdsAtual?.nome ?? 'KDS da loja';
  const tipoDaTela = kdsAtual ? (modoDespacho ? 'Despacho' : modoEntrega ? 'Entrega' : 'KDS') : 'todos';
  const subtituloGaveta = kdsAtual
    ? `${tipoDaTela} · ${mostrarMapa ? 'mapa dos entregadores' : 'pedidos'}`
    : 'Este aparelho ainda não escolheu qual KDS é';

  return (
    <div
      className="kds-app"
      data-tema={claro ? 'claro' : 'escuro'}
      style={{ ...(variaveisDoKds(T, COR_STATUS) as React.CSSProperties), ['--esc' as any]: String(esc) }}
    >
      {/* Cabeçalho compacto: duas linhas de 48 px no tablet, uma só a partir de 1720 px. "Este KDS", setor, por pedido/item,
          tema e tamanho da letra ficam no ⚙ (são do aparelho); o nome do KDS no canto abre o ⚙. Relógio sem segundos. */}
      <header className="k-top">
        <span className="k-logo" aria-hidden="true">
          R
        </span>
        <button type="button" className="k-nome" onClick={() => abrirGaveta('tela')} aria-label={`Este KDS: ${nomeDaTela}. Abrir a configuração`}>
          {nomeDaTela} <small>{tipoDaTela}</small>
        </button>
        {!mostrarMapa && (
          <div className="k-seg" role="group" aria-label="Canal">
            {([
              ['balcao', 'Balcão / Salão'],
              ['delivery', 'Delivery'],
              ['todos', 'Tudo'],
            ] as const).map(([c, rotulo]) => (
              <button key={c} type="button" aria-pressed={canal === c} onClick={() => escolherCanal(c)}>
                {rotulo}
              </button>
            ))}
          </div>
        )}
        <span className="k-esp k-esp1" />
        {!mostrarMapa && (
          /* Senha (Fase F): a caixa só recebe o número (teclado físico ou captura global). Enter avança o card daquela
             senha. No modo TECLADO ela é o dono do foco. */
          <div className="k-senha" data-uso={uso}>
            <label htmlFor="kds-senha">Senha</label>
            <input
              id="kds-senha"
              ref={senhaRef}
              inputMode="numeric"
              autoComplete="off"
              value={senhaDigitada}
              onChange={(e) => { limparErroSenha(); setSenhaDigitada(e.target.value.replace(/\D/g, '').slice(0, 6)); }}
              onKeyDown={(e) => { if (e.key === 'Enter') avancarPorSenha(); }}
              onFocus={() => setSenhaFocada(true)}
              onBlur={() => setSenhaFocada(false)}
              placeholder="—"
              aria-label="Senha do pedido (Enter avança)"
              aria-describedby="kds-senha-msg"
              aria-invalid={senhaErro || undefined}
            />
            <span id="kds-senha-msg" role="status" aria-live="polite" className={senhaMsg ? 'k-senha-msg' : 'k-sr'} data-erro={senhaMsg?.erro ? 'true' : undefined}>
              {senhaMsg?.texto ?? ''}
            </span>
            {/* Modo teclado com o foco fora do campo (janela em segundo plano): diz como voltar. */}
            {now && uso === 'teclado' && !senhaFocada && !senhaMsg && !painelAberto && (
              <span className="k-senha-dica" aria-hidden="true">
                Enter para digitar a senha
              </span>
            )}
          </div>
        )}
        <span className={`k-conn${semConexao ? ' off' : ''}`}>
          <i aria-hidden="true" />
          <span>{conectado ? 'online' : 'offline'}</span>
        </span>
        <span className="k-hora" aria-label="Hora">
          {now ? hm(now) : '--:--'}
        </span>
        <span className="k-quebra" aria-hidden="true" />
        {!mostrarMapa && !modoEntrega && !modoDespacho && (
          <>
            <select className="k-etapa-sel" aria-label="Filtrar por etapa" value={etapaSel} onChange={(e) => setEtapaSel(e.target.value as FiltroEtapa)}>
              {FILTROS_ETAPA.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label} ({contagem[f.key]})
                </option>
              ))}
            </select>
            {/* Quebra a linha no estreito (nada de rolagem para o lado — V45). "Atrasados": só o número em vermelho. */}
            <div className="k-etapas" role="group" aria-label="Filtrar por etapa">
              {FILTROS_ETAPA.map((f) => {
                const n = contagem[f.key];
                return (
                  <button
                    key={f.key}
                    type="button"
                    className={`k-etapa${f.key === 'atrasados' && n > 0 ? ' atraso' : ''}`}
                    aria-pressed={etapaSel === f.key}
                    onClick={() => setEtapaSel(f.key)}
                  >
                    {f.label} <b>{n}</b>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <span className="k-esp k-esp2" />
        <div className="k-util">
          {!mostrarMapa && !modoEntrega && !modoDespacho && ver === 'pedido' && (
            <button
              type="button"
              className="k-ib"
              onClick={() => abrirResumo(!resumoAberto)}
              aria-pressed={resumoAberto}
              aria-expanded={resumoAberto}
              aria-controls="kds-resumo"
              title="Resumo de itens: a soma do que falta produzir"
            >
              📋<span className="rot">Resumo</span>
              <span className="k-sr">Resumo de itens</span>
            </button>
          )}
          {/* No despacho não há "finalizar todos": cada pedido sai só com as estações prontas (ou com o gestor). */}
          {!mostrarMapa && !modoDespacho && (
            <button
              ref={fimBtRef}
              type="button"
              className="k-ib"
              aria-haspopup="dialog"
              onClick={() => setDialogoFinalizar(true)}
              disabled={!finalizaveis.length}
              title="Finalizar os pedidos que aparecem na tela"
            >
              🧹<span className="rot">Finalizar todos</span>
              <span className="k-sr">Finalizar os pedidos da tela</span>
            </button>
          )}
          <button
            type="button"
            className="k-ib"
            onClick={() => setMudo((m) => !m)}
            aria-pressed={mudo}
            aria-label={mudo ? 'Som dos avisos: desligado' : 'Som dos avisos: ligado'}
            title={mudo ? 'Som desligado' : 'Som ligado'}
          >
            {mudo ? '🔇' : '🔊'}
          </button>
          <button
            ref={histBtRef}
            type="button"
            className="k-ib"
            onClick={() => abrirGaveta('historico')}
            aria-expanded={gaveta === 'historico'}
            aria-controls="kds-gaveta"
            aria-label="Histórico: os avisos desta tela e quem finalizou, cancelou ou mudou a configuração"
            title="Histórico"
          >
            🕘
          </button>
          <button
            ref={cfgBtRef}
            type="button"
            className="k-ib"
            onClick={() => abrirGaveta('tela')}
            aria-expanded={gaveta === 'tela'}
            aria-controls="kds-gaveta"
            aria-label="Configurar este KDS"
            title="Configurar este KDS"
          >
            ⚙️
          </button>
        </div>
      </header>

      {/* Faixas CLARAS: só a palavra da gravidade leva cor. */}
      <div className="k-faixas">
        {semConexao && (
          <div className="k-faixa" role="alert">
            <span className="k-ic" aria-hidden="true">
              ⚠
            </span>
            <span>
              <b className="k-vermelho">Sem conexão</b> com o servidor{semConexaoDesde ? ` desde ${hm(semConexaoDesde)}` : ''}. A fila pode
              estar desatualizada — reconectando…
            </span>
          </div>
        )}
        {!semConexao && falhaFila && (
          <div className="k-faixa" role="alert">
            <span className="k-ic" aria-hidden="true">
              ⚠
            </span>
            <span>
              <b>Não consegui ler a fila às {hm(falhaFila.em)}.</b> Tentando de novo… Os pedidos abaixo podem estar desatualizados.
              {falhaFila.motivo ? ` (${falhaFila.motivo})` : ''}
            </span>
            <button
              type="button"
              className="k-fbt"
              onClick={() => void carregarFila().then((l) => l && mostrarToque(`Fila lida às ${hm(new Date())}`))}
            >
              Tentar agora
            </button>
          </div>
        )}
        {somBloqueado && !mudo && (
          <button type="button" className="k-faixa" onClick={liberarSom}>
            <span className="k-ic" aria-hidden="true">
              🔇
            </span>
            <span>
              <b>Som pausado pelo navegador</b> — toque aqui para ligar o som dos pedidos e avisos
            </span>
          </button>
        )}
        {nuvemComServidor && (
          <div className="k-faixa" role="status">
            <span className="k-ic" aria-hidden="true">
              🌐
            </span>
            <span>
              <b>Este KDS está aberto pela internet</b>, mas a loja tem o servidor ligado. Abra o KDS pelo atalho “Regem neste PC”, da
              área de trabalho, para a via de cada etapa sair na impressora da loja.
            </span>
          </div>
        )}
        {/* A pausa dos canais: clara, com o contador em negrito — em âmbar nos minutos finais. A faixa não é pintada. */}
        {recebePausa && faixasDaPausa.length > 0 && (
          <div className="k-pausas" role="status" aria-label="Canais pausados">
            {faixasDaPausa.map(({ c, f }) => (
              <div key={c.canal} className={`k-pausa${f.logo ? ' logo' : ''}`} data-kds-pausa={c.canal}>
                <span className="q">
                  <span aria-hidden="true">⏸</span> {f.texto}
                  {f.detalhe ? <small>{f.detalhe}</small> : null}
                </span>
                {f.contador && (
                  <span className="t">
                    <small>faltam</small>
                    {f.contador}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {mostrarMapa && mapaDoPainel && (
          <div className="k-faixa" role="status">
            <span className="k-ic" aria-hidden="true">
              🗺
            </span>
            <span>
              <b>Mapa enviado pelo painel.</b> Os pedidos voltam quando tirarem este KDS de lá.
            </span>
          </div>
        )}
      </div>

      <div className={`k-meio${resumoVisivel ? ' com-resumo' : ''}`}>
        <main className="k-fila" aria-label={mostrarMapa ? 'Mapa dos entregadores' : ver === 'item' ? 'Itens a produzir' : 'Pedidos em produção'}>
          {mostrarMapa ? (
            <KdsMapaEntregadores T={T} escuro={!claro} esc={esc} onDesligado={mapaDesligado} />
          ) : modoDespacho ? (
            <KdsDespacho
              pedidos={pedidosOrigem}
              limites={cores}
              agoraMs={nowMs}
              T={T}
              esc={esc}
              carregando={temSessao === null}
              onAcao={acaoDespacho}
              onDialogo={setDialogoDespacho}
            />
          ) : modoEntrega ? (
            <EntregaBoard pedidos={pedidosOrigem} onEntregar={avancar} T={T} esc={esc} />
          ) : temSessao === null ? (
            <div className="k-grade">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="k-esq" aria-hidden="true">
                  <i style={{ width: '55%' }} />
                  <i style={{ width: '80%' }} />
                  <i style={{ width: '40%' }} />
                </div>
              ))}
              <span className="k-sr" role="status">
                Carregando os pedidos…
              </span>
            </div>
          ) : (ver === 'item' ? grupos.length === 0 : pedidosVisiveis.length === 0) ? (
            /* "Nenhum pedido" só depois de uma leitura que deu certo: a que falhou não é fila vazia (V37). */
            !filaLida && falhaFila ? (
              <div className="k-vazio erro">
                <b>Não consegui ler a fila às {hm(falhaFila.em)}</b>
                Tentando de novo. Não é fila vazia: confira a internet ou o servidor da loja se demorar.
              </div>
            ) : pedidosOrigem.length > 0 && etapaSel !== 'todos' ? (
              <div className="k-vazio">
                <b>Nenhum pedido nesta etapa</b>
                Escolha “Todos” para ver a fila inteira.
              </div>
            ) : ver === 'item' && pedidosVisiveis.length > 0 ? (
              <div className="k-vazio">
                <b>Nada a produzir agora</b>
                Os pedidos da tela já estão prontos ou são encomendas para mais tarde.
              </div>
            ) : (
              <div className="k-vazio">
                <b>Nenhum pedido em produção</b>
                Os pedidos novos aparecem aqui na hora, com som.
              </div>
            )
          ) : (
            <div className="k-grade">
              {ver === 'item'
                ? grupos.map((g) => <KdsCartaoItem key={g.descricao} g={g} limites={cores} />)
                : pedidosVisiveis.map((p) => (
                    <KdsCartaoPedido
                      key={p.id}
                      p={p}
                      agoraMs={nowMs}
                      limites={cores}
                      agregar={view.agregar}
                      realce={!itemAtivo ? 'nenhum' : pedidoTemItem(p, itemAtivo) ? 'destaque' : 'apagado'}
                      itemEmDestaque={itemAtivo}
                      onAvancar={avancar}
                      etapas={cores}
                      ocupado={avancando.has(p.id)}
                      proximoNome={proximoDoCartao(p)}
                      veioDe={veioDoCartao(p)}
                      onVisto={visto}
                    />
                  ))}
            </div>
          )}
        </main>
        {resumoVisivel && <KdsResumoItens itens={itensResumo} escolhido={itemAtivo} onEscolher={setItemSel} onFechar={() => abrirResumo(false)} />}
      </div>

      {/* RODAPÉ de avisos (versão 2): PARADO, numa faixa clara. O mais urgente aparece; o urgente que fica (cancelado,
          alterado) espera o "Ciente" / "Visto"; os outros saem sozinhos no tempo deles. Vários: "N avisos" abre a lista. */}
      <div className="k-pe">
        {mostrado && (
          <footer className={`k-rodape ${mostrado.prioridade}`}>
            <span className="k-lado">{rotuloDaPrioridade(mostrado.prioridade)}</span>
            <div className="k-txt" role="status" aria-live={mostrado.prioridade === 'danger' ? 'assertive' : 'polite'}>
              <span className="k-letreiro" ref={letreiroRef}>
                {mostrado.titulo}
                {mostrado.detalhe ? <small> {mostrado.detalhe}</small> : null}
              </span>
            </div>
            {(mostrado.ciente || mostrado.cartaoId) && (
              <button type="button" className="k-ciente" onClick={() => ciente(mostrado)}>
                {mostrado.cartaoId ? 'Visto' : 'Ciente'}
              </button>
            )}
            {(alertas.length > 1 || cortado) && (
              <button
                ref={maisBtRef}
                type="button"
                className="k-mais"
                aria-expanded={listaAberta}
                aria-controls="kds-avisos"
                aria-label={alertas.length > 1 ? `${alertas.length} avisos na tela: abrir a lista` : 'Ver o aviso inteiro'}
                onClick={() => setListaAberta((v) => !v)}
              >
                {alertas.length > 1 ? `${alertas.length} avisos` : 'Ver tudo'}
              </button>
            )}
          </footer>
        )}
        {listaAberta && alertas.length > 0 && (
          <div className="k-lista" id="kds-avisos" role="dialog" aria-label="Avisos na tela">
            <header>
              <span>Avisos na tela ({alertas.length})</span>
              <button
                type="button"
                className="k-x"
                aria-label="Fechar a lista de avisos"
                onClick={() => {
                  setListaAberta(false);
                  setTimeout(() => maisBtRef.current?.focus({ preventScroll: true }), 0);
                }}
              >
                ✕
              </button>
            </header>
            <ol>
              {ordenados.map((a) => (
                <li key={a.id} className={`k-av ${a.prioridade}`}>
                  <span className="barra" aria-hidden="true" />
                  <b>{a.titulo}</b>
                  <p>{a.detalhe}</p>
                  <div className="meta">
                    <span>
                      <span className="pri">{rotuloDaPrioridade(a.prioridade)}</span> · {a.origem} · {hm(new Date(a.em))}
                    </span>
                    {a.ciente || a.cartaoId ? (
                      <button type="button" onClick={() => ciente(a)}>
                        {a.cartaoId ? 'Visto' : 'Ciente'}
                      </button>
                    ) : (
                      <span>sai sozinho em {a.restanteSeg} s</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className={`k-toast${toque ? ' on' : ''}`} role="status" aria-live="polite" data-erro={toque?.erro ? 'true' : undefined}>
          {toque?.texto ?? ''}
        </div>
      </div>

      {produtosAberto && kdsAtual && (
        <KdsProdutosGaveta
          kds={{ id: kdsAtual.id, nome: kdsAtual.nome, escopo: kdsAtual.escopo, proximoKdsId: kdsAtual.proximoKdsId ?? null }}
          telas={kdsList}
          T={T}
          onFechar={() => setProdutosAberto(false)}
          // O lugar no fluxo mudou: relê as telas (o "Pronto → …" dos cartões e o modo despacho vêm delas).
          onFluxoSalvo={() => {
            api.kdsTelas()
              .then((telas: any) => setKdsList(Array.isArray(telas) ? telas : []))
              .catch(() => {});
          }}
        />
      )}

      {/* Gaveta ⚙: "Esta tela" (o que é deste aparelho) e "Histórico". */}
      {gaveta && (
        <>
          <button type="button" className="k-fundo" aria-label="Fechar a configuração" tabIndex={-1} onClick={fecharGaveta} />
          <aside id="kds-gaveta" className="k-gaveta" role="dialog" aria-modal="true" aria-labelledby="kds-gaveta-titulo">
            <div className="k-gcab">
              <div>
                <h2 id="kds-gaveta-titulo">Configurar este KDS · {nomeDaTela}</h2>
                <p>{subtituloGaveta}</p>
              </div>
              <button ref={gavetaFecharRef} type="button" className="k-x" aria-label="Fechar" onClick={fecharGaveta}>
                ✕
              </button>
            </div>
            <div className="k-gtabs" role="tablist" aria-label="Partes da configuração">
              {([
                ['tela', 'Esta tela'],
                ['avisos', 'Avisos'],
                ['historico', 'Histórico'],
              ] as const).map(([aba, rotulo]) => (
                <button key={aba} type="button" role="tab" className="k-gtab" aria-selected={gaveta === aba} onClick={() => setGaveta(aba)}>
                  {rotulo}
                </button>
              ))}
            </div>
            <div className="k-gcorpo" role="tabpanel">
              {gaveta === 'historico' ? (
                <>
                  {/* Os avisos que foram ao rodapé (mig 412) e as ações de quem mexeu na tela (a auditoria). */}
                  <div className="k-seg2" role="group" aria-label="O que ver no histórico">
                    <button type="button" aria-pressed={histVer === 'avisos'} onClick={() => setHistVer('avisos')}>
                      Avisos
                    </button>
                    <button type="button" aria-pressed={histVer === 'acoes'} onClick={() => setHistVer('acoes')}>
                      Ações
                    </button>
                  </div>
                  {histVer === 'avisos' ? <HistoricoAvisosKds avisos={avisosDaTela} kdsId={kdsSel || null} /> : <HistoricoKds />}
                </>
              ) : gaveta === 'avisos' ? (
                !kdsAtual ? (
                  <p className="k-nota">
                    Escolha qual KDS é este aparelho (aba <b>Esta tela</b>) para escolher os avisos dele. Sem escolher, a tela
                    recebe tudo, menos os avisos de gestão.
                  </p>
                ) : (
                  <>
                    <p className="k-nota">
                      O que aparece no rodapé <b>desta tela</b> ({kdsAtual.nome}). Fica guardado no servidor e vale para qualquer
                      aparelho que opere este KDS. Quem mudar fica no histórico.
                    </p>
                    <ul className="k-tipos">
                      {AVISOS_DA_TELA.map((t) => {
                        const ligado = t.trava ? true : (rascunhoAvisos ?? avisosDaTela)[t.k as TipoDeAviso];
                        return (
                          <li key={t.k} className="k-tipo">
                            <div>
                              <b>
                                {t.ic} {t.nome}
                              </b>
                              <p>{t.det}</p>
                              <span className="pri">{t.pri}</span>
                            </div>
                            <button
                              type="button"
                              className="k-liga"
                              aria-pressed={ligado}
                              aria-label={`${t.nome}: ${t.trava ? 'sempre recebe' : ligado ? 'recebe' : 'não recebe'}`}
                              disabled={t.trava || !podeMudarAvisos || salvandoAvisos}
                              onClick={() =>
                                setRascunhoAvisos((r) => {
                                  const base = r ?? avisosDaTela;
                                  return { ...base, [t.k]: !base[t.k as TipoDeAviso] };
                                })
                              }
                            >
                              {t.trava ? 'Sempre recebe' : ligado ? 'Recebe' : 'Não recebe'}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="k-nota">Cancelado e alterado não desligam: a cozinha precisa saber para não fazer.</p>
                    {!podeMudarAvisos && <p className="k-nota">Só quem configura a produção (a gerência) muda os avisos desta tela.</p>}
                  </>
                )
              ) : (
                <>
                  {kdsList.length > 0 && (
                    <div className="k-grupo">
                      <b>Este aparelho opera</b>
                      <select className="k-sel" aria-label="Qual KDS este aparelho opera" value={kdsSel} onChange={(e) => escolherKds(e.target.value)}>
                        <option value="">Todos os KDS da loja (por setor)</option>
                        {kdsList.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.nome}
                            {k.escopo === 'entrega' ? ' (entrega)' : k.escopo === 'despacho' ? ' (despacho)' : ''}
                          </option>
                        ))}
                      </select>
                      {/* Cozinha em estações: os produtos que este KDS mostra e o lugar dele no fluxo — de quem configura a
                          produção. */}
                      {podePerm('producao_kds') && kdsAtual && (
                        <button
                          type="button"
                          className="k-bt"
                          onClick={() => {
                            setGaveta(null);
                            setProdutosAberto(true);
                          }}
                        >
                          Produtos e lugar no fluxo ({kdsAtual.nome})
                        </button>
                      )}
                    </div>
                  )}
                  {setores.length > 0 && (
                    <div className="k-grupo">
                      <b>Setor</b>
                      <select className="k-sel" aria-label="Filtrar por setor" value={setorSel} onChange={(e) => setSetorSel(e.target.value)}>
                        <option value="">Todos os setores</option>
                        {setores.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nome}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {!modoEntrega && !modoDespacho && (
                    <div className="k-grupo">
                      <b>Como mostra</b>
                      <div className="k-seg2" role="group" aria-label="Como mostra">
                        {([
                          ['pedido', 'Por pedido'],
                          ['item', 'Por item'],
                        ] as const).map(([v, rotulo]) => (
                          <button key={v} type="button" aria-pressed={ver === v} onClick={() => escolherVer(v)}>
                            {rotulo}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="k-grupo">
                    <b>Tamanho da letra</b>
                    <div className="k-seg2" role="group" aria-label="Tamanho da letra">
                      {TAMANHOS.map((t) => (
                        <button key={t} type="button" aria-pressed={Math.abs(esc - t) < 0.001} onClick={() => setViewCfg({ escala: t })}>
                          {Math.round(t * 100)}%
                        </button>
                      ))}
                    </div>
                    <p className="k-nota">O botão de avançar fica com 48 px no mínimo em qualquer tamanho.</p>
                  </div>
                  <div className="k-grupo">
                    <b>Tema</b>
                    <div className="k-seg2" role="group" aria-label="Tema">
                      <button type="button" aria-pressed={claro} onClick={() => escolherTema(true)}>
                        Claro
                      </button>
                      <button type="button" aria-pressed={!claro} onClick={() => escolherTema(false)}>
                        Escuro
                      </button>
                    </div>
                  </div>
                  <div className="k-grupo">
                    <b>Forma de uso</b>
                    <div className="k-seg2" role="group" aria-label="Forma de uso">
                      {([
                        ['toque', 'Toque'],
                        ['teclado', 'Teclado'],
                      ] as const).map(([v, rotulo]) => (
                        <button key={v} type="button" aria-pressed={uso === v} onClick={() => setViewCfg({ uso: v })}>
                          {rotulo}
                        </button>
                      ))}
                    </div>
                    <p className="k-nota">
                      {uso === 'teclado'
                        ? 'Teclado: o campo da senha fica sempre pronto; Enter com o número avança o pedido.'
                        : 'Toque: os pedidos avançam pelo botão do cartão. Nada puxa o cursor para o campo da senha.'}
                    </p>
                  </div>
                  <div className="k-grupo">
                    <b>Itens iguais</b>
                    <div className="k-seg2" role="group" aria-label="Itens iguais">
                      <button type="button" aria-pressed={!view.agregar} onClick={() => setViewCfg({ agregar: false })}>
                        Separados
                      </button>
                      <button type="button" aria-pressed={view.agregar} onClick={() => setViewCfg({ agregar: true })}>
                        Somados
                      </button>
                    </div>
                  </div>
                  {/* O que esta tela mostra (mig 293). Mandado pelo painel do Delivery (entrega 5): o painel decide. */}
                  <div className="k-grupo">
                    <b>Esta tela mostra</b>
                    {mapaDoPainel ? (
                      <p className="k-nota">
                        {mapaHabilitado
                          ? 'O mapa dos entregadores, mandado pelo painel em Delivery › Mapa ao vivo. Os pedidos voltam quando tirarem este KDS de lá.'
                          : 'Pedidos. O painel mandou o mapa dos entregadores para este KDS; ele aparece quando o gestor ligar o mapa no KDS em Delivery › Configurações.'}
                      </p>
                    ) : mapaHabilitado ? (
                      <div className="k-seg2" role="group" aria-label="Esta tela mostra">
                        {([
                          ['pedidos', 'Pedidos'],
                          ['mapa', 'Mapa dos entregadores'],
                        ] as const).map(([v, rotulo]) => (
                          <button key={v} type="button" aria-pressed={tela === v} onClick={() => escolherTela(v)}>
                            {rotulo}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="k-nota">Pedidos. O mapa dos entregadores fica disponível quando o gestor liga em Delivery › Configurações.</p>
                    )}
                  </div>
                  {/* Filtros (Fase C) — um conjunto para delivery, outro para o balcão. */}
                  {([
                    ['Filtrar delivery', 'delivery', subDelivery, setSubDelivery],
                    ['Filtrar balcão / salão', 'balcao', subBalcao, setSubBalcao],
                  ] as const).map(([rotulo, cnl, valor, setar]) => (
                    <div key={cnl} className="k-grupo">
                      <b>{rotulo}</b>
                      <div className="k-seg2" role="group" aria-label={rotulo}>
                        {SUBFILTROS[cnl].map((s) => (
                          <button key={s.key} type="button" aria-pressed={valor === s.key} onClick={() => setar(s.key)}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="k-grupo">
                    <b>Atalho</b>
                    <button type="button" className="k-bt" onClick={criarAtalho}>
                      🔗 Criar atalho na área de trabalho
                    </button>
                    <p className="k-nota">Baixa um atalho que abre este KDS já com estas configurações, em tela cheia.</p>
                  </div>
                  <div className="k-grupo">
                    <button type="button" className="k-bt" onClick={() => setViewCfg(VIEW_PADRAO)}>
                      Restaurar o padrão desta tela
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="k-gpe">
              {gaveta === 'tela' && <span className="k-nota">Guardado neste aparelho.</span>}
              {gaveta === 'avisos' && kdsAtual ? (
                <>
                  <span className="k-nota" role="status" style={erroAvisos ? { color: 'var(--k-erro)' } : undefined}>
                    {erroAvisos || (avisosMudados.length ? 'Alterações ainda não salvas' : '')}
                  </span>
                  <button type="button" className="k-bt" onClick={fecharGaveta} disabled={salvandoAvisos}>
                    {avisosMudados.length ? 'Cancelar' : 'Fechar'}
                  </button>
                  {podeMudarAvisos && (
                    <button type="button" className="k-bt pri" onClick={() => void salvarAvisos()} disabled={!avisosMudados.length || salvandoAvisos}>
                      {salvandoAvisos ? 'Salvando…' : 'Salvar avisos desta tela'}
                    </button>
                  )}
                </>
              ) : (
                <button type="button" className={gaveta === 'tela' ? 'k-bt pri' : 'k-bt'} onClick={fecharGaveta}>
                  {gaveta === 'tela' ? 'Pronto' : 'Fechar'}
                </button>
              )}
            </div>
          </aside>
        </>
      )}

      {/* "Finalizar todos": a pergunta num diálogo da própria tela, com o número do que vai e do que o filtro esconde. */}
      {dialogoFinalizar && (
        <>
          <button type="button" className="k-fundo" aria-label="Cancelar" tabIndex={-1} onClick={fecharDialogo} />
          <div className="k-dialogo" role="alertdialog" aria-modal="true" aria-labelledby="kds-finalizar-titulo">
            <h2 id="kds-finalizar-titulo">
              Finalizar {finalizaveis.length === 1 ? 'o pedido' : `os ${finalizaveis.length} pedidos`} da tela?
            </h2>
            <div className="k-dcorpo">
              <p>Eles avançam para a próxima etapa (ou concluem). Fica no histórico, com o seu nome.</p>
              {escondidos > 0 && (
                <p>
                  <b>
                    {escondidos} pedido{escondidos === 1 ? '' : 's'} escondido{escondidos === 1 ? '' : 's'} pelo filtro não entra
                    {escondidos === 1 ? '' : 'm'}.
                  </b>
                </p>
              )}
            </div>
            <div className="k-gpe">
              <button ref={dialogoNaoRef} type="button" className="k-bt" onClick={fecharDialogo}>
                Cancelar
              </button>
              <button type="button" className="k-bt pri" onClick={() => void finalizarTela()} disabled={!finalizaveis.length}>
                Finalizar {finalizaveis.length} pedido{finalizaveis.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Atalho abriu com ?full=1 → oferece tela cheia (o navegador exige um clique). */}
      {pedirTelaCheia && (
        <button
          type="button"
          onClick={() => {
            document.documentElement.requestFullscreen?.().catch(() => {});
            setPedirTelaCheia(false);
            liberarSom();
            if (uso === 'teclado') senhaRef.current?.focus();
          }}
          className="fixed inset-0 z-[60] grid place-items-center"
          style={{ background: 'rgba(11,17,23,.92)', color: '#fff' }}
        >
          <span className="px-8 py-4 text-lg font-bold" style={{ background: ACAO.fundo, color: ACAO.texto }}>
            Toque para entrar em tela cheia
          </span>
        </button>
      )}

      {temSessao === false && (
        <div className="fixed inset-0 z-[60] grid place-items-center px-4" style={{ background: 'rgba(11,17,23,.94)', color: '#fff' }}>
          <div className="text-center">
            <p className="mb-4 text-lg">Entre para operar o KDS.</p>
            <Link href="/entrar" className="inline-block px-6 py-3 text-sm font-bold" style={{ background: ACAO.fundo, color: ACAO.texto }}>
              Ir para o login
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// Fase E3 — KDS de ENTREGA (só senha): duas colunas Preparando / Pronto. O pedido
// entra em "Preparando" (recebido/preparo) e chega em "Pronto"; tocar numa senha
// pronta conclui (entrega). Tela limpa, senhas gigantes p/ o balcão de retirada.
function EntregaBoard({
  pedidos,
  onEntregar,
  T,
  esc,
}: {
  pedidos: any[];
  onEntregar: (p: any, de?: string) => void;
  T: { panel: string; panel2: string; border: string; text: string; muted: string };
  esc: number;
}) {
  const preparando = pedidos.filter((p) => p.status === 'recebido' || p.status === 'preparo');
  const pronto = pedidos.filter((p) => p.status === 'pronto');
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <ColunaDeSenhas titulo="Preparando" itens={preparando} cor={COR_STATUS.atencao} onEntregar={onEntregar} T={T} esc={esc} />
      <ColunaDeSenhas titulo="Pronto — chamar / entregar" itens={pronto} cor={COR_STATUS.ok} tocavel onEntregar={onEntregar} T={T} esc={esc} />
    </div>
  );
}

const rotuloDaSenhaNoPainel = (p: any) =>
  p.senha ? rotuloSenha(p.senha, p.senhaPrefixo) : p.mesa ? p.mesa : p.numero ? `#${p.numero}` : '—';

// Uma coluna do painel de entrega. Fica FORA do EntregaBoard (auditoria do KDS, 11/11/2026): declarada dentro dele, era
// um componente novo a cada segundo (o relógio da tela redesenha a página) — o React desmontava as casas e o toque que
// cruzava esse instante se perdia. As casas se medem pelo espaço (a senha "D-123" a 48 px pede ~190 px): com 2/3/4
// colunas fixas a senha passava por cima da vizinha em 1024–1440 px, e a barra escondida não denunciava.
function ColunaDeSenhas({
  titulo,
  itens,
  cor,
  tocavel,
  onEntregar,
  T,
  esc,
}: {
  titulo: string;
  itens: any[];
  cor: CorStatus;
  tocavel?: boolean;
  onEntregar: (p: any, de?: string) => void;
  T: { panel: string; panel2: string; border: string; text: string; muted: string };
  esc: number;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: cor.fundo }} />
        <span className="text-[15px] font-bold uppercase tracking-wider" style={{ color: T.muted, fontFamily: TITULO }}>
          {titulo}
        </span>
        <span className="text-[15px] font-bold" style={{ color: T.muted, fontFamily: MONO }}>{itens.length}</span>
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${Math.round(190 * esc)}px), 1fr))` }}>
        {itens.length === 0 && (
          <div className="col-span-full border border-dashed px-6 py-10 text-center text-sm" style={{ borderColor: T.border, color: T.muted }}>
            Vazio
          </div>
        )}
        {itens.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={!tocavel}
            onClick={() => tocavel && onEntregar(p, p.status)}
            className="grid min-w-0 place-items-center border font-extrabold tabular-nums [overflow-wrap:anywhere] disabled:cursor-default"
            style={{
              background: tocavel ? cor.fundo : T.panel,
              color: tocavel ? cor.texto : T.text,
              borderColor: tocavel ? cor.fundo : T.border,
              fontFamily: MONO,
              fontSize: Math.round(48 * esc),
              padding: Math.round(22 * esc),
              minHeight: Math.round(96 * esc),
            }}
            title={tocavel ? 'Entregar (concluir)' : undefined}
          >
            {rotuloDaSenhaNoPainel(p)}
            {p.logistica?.status === 130 && (
              <span className="block text-center" style={{ fontSize: Math.round(13 * esc), fontFamily: 'Figtree, sans-serif' }}>
                🛵 entregador da 99 chegou
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
