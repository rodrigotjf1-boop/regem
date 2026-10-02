'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';
import { rotuloSenha, senhaCasa } from '@/lib/senha';
import { connectAsGestor, connectAsDevice, type Socket } from '@/lib/rt';
import { KdsMapaEntregadores } from '@/components/kds/kds-mapa-entregadores';
import { HistoricoKds } from '@/components/kds/historico-kds';
import { KdsCartaoPedido, type CorDoCartao, type TemaKds } from '@/components/kds/kds-cartao-pedido';
import { KdsCartaoItem } from '@/components/kds/kds-cartao-item';
import { KdsResumoItens } from '@/components/kds/kds-resumo-itens';
import {
  COR_STATUS,
  FILTROS_ETAPA,
  agruparPorItem,
  contarEtapas,
  decidirTecla,
  filtrarEtapa,
  formaDeUso,
  identPedido,
  minutosDesde,
  pedidoTemItem,
  somarItens,
  type CorStatus,
  type FiltroEtapa,
  type FormaUso,
} from '@/lib/kds-fila';

/* eslint-disable @typescript-eslint/no-explicit-any */

// KDS web (superfície de teste do tempo real). Base do futuro app nativo empacotado.
// KDS = informativo + avanço de produção. Consultar/alterar/cancelar é no PDV.
//
// Desenho (02/10/2026, mockup `mockups/regem-kds-producao.html`): tela NEUTRA — a única cor é a
// do status do tempo (verde, amarelo, vermelho), no cabeçalho do cartão e no botão de avanço;
// cantos retos; cartões colados. As regras puras da fila ficam em `lib/kds-fila.ts`.

type Alerta = {
  id: string;
  titulo: string;
  detalhe: string;
  prioridade: 'danger' | 'alta' | 'info' | 'ok';
  em: string;
  restanteSeg: number; // tempo que ainda deve ficar no rodapé
};

// Prioridade → rank (o rodapé mostra o de maior rank; empate = mais recente). Só o
// alerta EXIBIDO conta o tempo → um urgente curto sobrepõe o longo, que "congela" e
// volta a contar quando o urgente sai (override + retomada do ciclo).
const RANK: Record<Alerta['prioridade'], number> = { danger: 3, alta: 2, info: 1, ok: 0 };
function escolherAlerta(as: Alerta[]): Alerta | null {
  if (!as.length) return null;
  return [...as].sort(
    (a, b) => RANK[b.prioridade] - RANK[a.prioridade] || new Date(b.em).getTime() - new Date(a.em).getTime(),
  )[0];
}
function bgAlerta(p: Alerta['prioridade']) {
  if (p === 'danger') return '#B4231C';
  if (p === 'info') return '#1E6FA8';
  if (p === 'ok') return '#0E7C66';
  return '#B7791F';
}

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
function grupoPedido(p: any, canal: 'delivery' | 'balcao'): string {
  const plat = String(p.plataforma ?? '').toLowerCase();
  if (canal === 'delivery') {
    if (/ifood|99\s*food|keeta|rappi|uber/.test(plat)) return 'marketplace';
    return 'digital'; // anota aí, cardápio web, cardápio (regem), outros
  }
  if (/totem|kiosk|quiosque/.test(plat)) return 'totem';
  const o = String(p.origem ?? 'balcao');
  if (o === 'mesa' || o === 'comanda') return 'mesa';
  if (o === 'garcom') return 'garcom';
  return 'pdv';
}

// ── Preferências da tela (por aparelho, no localStorage — UI, não dado de negócio) ──────────
type ViewCfg = {
  escala: number; // multiplicador de fonte/espaçamento (0.85 .. 1.5)
  agregar: boolean; // agregar itens iguais (soma quantidade) vs. mostrar separados
  cor: CorDoCartao; // onde a cor do tempo entra: só no cabeçalho ou no cartão inteiro
  uso: '' | FormaUso; // forma de uso; '' = adivinha pelo aparelho (tela de toque → toque)
};
const VIEW_PADRAO: ViewCfg = { escala: 1, agregar: false, cor: 'cabecalho', uso: '' };
// Lê o que estava guardado (ou veio num atalho) e descarta o que não existe mais — as três
// cores escolhidas à mão (senha, produto, observação) saíram com a tela neutra.
function normalizarView(v: any): ViewCfg {
  const esc = Number(v?.escala);
  return {
    escala: esc >= 0.85 && esc <= 1.5 ? esc : 1,
    agregar: v?.agregar === true,
    cor: v?.cor === 'inteiro' ? 'inteiro' : 'cabecalho',
    uso: v?.uso === 'toque' || v?.uso === 'teclado' ? v.uso : '',
  };
}

// Temas do KDS: só tinta e cinza (a cor fica para o status do tempo).
const TEMAS: Record<'escuro' | 'claro', TemaKds> = {
  escuro: { bg: '#0B1117', panel: '#151E27', panel2: '#1D2833', border: '#2C3A47', text: '#F1F5F8', muted: '#A3B1BD' },
  claro: { bg: '#E9EDF1', panel: '#FFFFFF', panel2: '#F2F4F7', border: '#CBD3DC', text: '#0F1B24', muted: '#55636F' },
};
const FOCO = '#2F7FD8'; // anel de foco (teclado)
const MONO = 'JetBrains Mono, monospace';
const TITULO = 'Archivo, sans-serif';

export default function KdsPage() {
  const [conectado, setConectado] = useState(false);
  const [temSessao, setTemSessao] = useState<boolean | null>(null);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [cores, setCores] = useState({ verdeAteMin: 5, amareloAteMin: 10 });
  const [setores, setSetores] = useState<any[]>([]);
  const [setorSel, setSetorSel] = useState('');
  const [kdsList, setKdsList] = useState<any[]>([]); // Fase E — KDS da loja p/ o seletor
  const [kdsSel, setKdsSel] = useState(''); // qual KDS este aparelho opera (cadeia)
  const [canal, setCanal] = useState<'balcao' | 'delivery' | 'todos'>('balcao');
  // Fase C — filtros de sub-origem, um por canal (no modal de config).
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
  // Fase D — config de exibição do card (por aparelho; guardada no localStorage).
  const [view, setView] = useState<ViewCfg>(VIEW_PADRAO);
  const [telaDeToque, setTelaDeToque] = useState(false); // só para adivinhar a forma de uso
  const [cfgAberta, setCfgAberta] = useState(false);
  // Histórico (auditoria): quem finalizou a tela, cancelou pedido ou mudou a configuração.
  const [histAberto, setHistAberto] = useState(false);
  // O que ESTA tela mostra (por aparelho): os pedidos (padrão) ou o mapa dos entregadores —
  // o mapa só se o gestor ligou a chave da loja (mig 293, Delivery → Configurações).
  const [tela, setTela] = useState<'pedidos' | 'mapa'>('pedidos');
  const [mapaHabilitado, setMapaHabilitado] = useState<boolean | null>(null);
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
  const mostrarMapa = tela === 'mapa' && mapaHabilitado === true;
  function setViewCfg(patch: Partial<ViewCfg>) {
    setView((v) => {
      const novo = { ...v, ...patch };
      try { localStorage.setItem('kds-view', JSON.stringify(novo)); } catch { /* ignora */ }
      return novo;
    });
  }
  const esc = view.escala; // multiplicador de fonte/espaço
  // Forma de uso: TECLADO (o campo da senha é o dono do foco) ou TOQUE (nada depende do foco).
  const uso = formaDeUso(view.uso, telaDeToque);
  const [pedirTelaCheia, setPedirTelaCheia] = useState(false);
  // Tema do KDS (preferência do aparelho — UI, não dado de negócio). CLARO por padrão.
  const [claro, setClaro] = useState(true);
  useEffect(() => {
    setClaro(localStorage.getItem('kds-tema') !== 'escuro');
  }, []);
  const T = claro ? TEMAS.claro : TEMAS.escuro;
  function alternarTema() {
    setClaro((v) => {
      const novo = !v;
      localStorage.setItem('kds-tema', novo ? 'claro' : 'escuro');
      return novo;
    });
  }
  // null no SSR/1ª render → evita hydration mismatch do relógio (server ≠ client).
  const [now, setNow] = useState<Date | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const mudoRef = useRef(mudo);
  mudoRef.current = mudo;
  const pedidosRef = useRef<any[]>([]);
  pedidosRef.current = pedidos;
  const setorRef = useRef(setorSel);
  setorRef.current = setorSel;
  const canalRef = useRef(canal);
  canalRef.current = canal;
  const kdsRef = useRef(kdsSel);
  kdsRef.current = kdsSel;
  const usoRef = useRef(uso);
  usoRef.current = uso;
  const senhaRef = useRef<HTMLInputElement | null>(null); // Fase F — campo de senha (foco)
  const senhaDigitadaRef = useRef('');
  senhaDigitadaRef.current = senhaDigitada;
  const senhaMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bip = useCallback(() => {
    if (mudoRef.current) return;
    try {
      const AC =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.42);
    } catch {
      /* áudio indisponível — ignora */
    }
  }, []);

  const carregarFila = useCallback(async () => {
    if (!getToken()) return; // fila durável requer operador logado (JWT)
    try {
      const r: any = await api.producaoFila(
        setorRef.current || undefined,
        undefined,
        canalRef.current,
        kdsRef.current || undefined,
      );
      setPedidos(r.pedidos ?? []);
      if (r.cores) setCores(r.cores);
    } catch {
      /* mantém a fila atual em caso de falha momentânea */
    }
  }, []);

  useEffect(() => {
    setNow(new Date()); // só no cliente
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (getToken()) {
      api.setores().then(setSetores).catch(() => {});
      api.entregadoresAoVivoKds()
        .then((r: any) => setMapaHabilitado(r?.habilitado === true))
        .catch(() => setMapaHabilitado(false));
      // Fase E — KDS da loja (p/ o seletor de cadeia). Restaura a última escolha.
      api.equipamentos()
        .then((eqs: any) => setKdsList((eqs as any[]).filter((e) => e.tipo === 'kds' && e.ativo)))
        .catch(() => {});
      try {
        const s = localStorage.getItem('kds-equip');
        if (s) setKdsSel(s);
        const c = localStorage.getItem('kds-canal');
        if (c === 'balcao' || c === 'delivery' || c === 'todos') setCanal(c);
      } catch { /* ignora */ }
    }
  }, []);

  function escolherKds(id: string) {
    setKdsSel(id);
    try { localStorage.setItem('kds-equip', id); } catch { /* ignora */ }
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
  const modoEntrega = kdsAtual?.escopo === 'entrega'; // Fase E3 — board só-senha

  // Recarrega quando muda o setor, o canal ou o KDS operado.
  useEffect(() => {
    carregarFila();
  }, [setorSel, canal, kdsSel, carregarFila]);

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
    const socket = deviceToken
      ? connectAsDevice(deviceToken)
      : connectAsGestor();
    socketRef.current = socket;

    socket.on('connect', () => setConectado(true));
    socket.on('disconnect', () => setConectado(false));

    socket.on('kds:alerta', (a: any) => {
      setAlertas((prev) => [
        {
          id: a.id,
          titulo: a.titulo,
          detalhe: a.detalhe,
          prioridade: a.prioridade ?? 'alta',
          em: a.em,
          restanteSeg: Number(a.duracaoSeg) > 0 ? Number(a.duracaoSeg) : 60,
        },
        ...prev.filter((x) => x.id !== a.id),
      ]);
      if (a.som !== false) bip();
    });

    // Nudge de produção → refaz o GET (fonte da verdade). Novo pedido = som.
    socket.on('producao:atualizado', (p: any) => {
      // Cancelamento: avisa a cozinha ANTES de sumir da fila (som + alerta).
      if (p?.tipo === 'cancelado') {
        const alvo = pedidosRef.current.find((x) => x.id === p.pedidoId);
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
            titulo: `❌ CANCELADO — ${ref}`,
            detalhe: 'Não preparar / descartar o que já saiu.',
            prioridade: 'danger',
            em: p.em,
            restanteSeg: 25,
          },
          ...prev.filter((x) => x.id !== `canc-${p.pedidoId}`),
        ]);
        bip();
      }
      void carregarFila();
      if (p?.tipo === 'novo') bip();
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [bip, carregarFila]);

  // Sem conexão: avisa em faixa larga (a fila na tela pode estar velha). Espera 4 s para não
  // piscar na abertura nem numa queda momentânea.
  const [semConexao, setSemConexao] = useState(false);
  useEffect(() => {
    if (temSessao !== true || conectado) {
      setSemConexao(false);
      return;
    }
    const t = setTimeout(() => setSemConexao(true), 4000);
    return () => clearTimeout(t);
  }, [conectado, temSessao]);

  async function avancar(id: string) {
    try {
      // Board único por canal → permite concluir (entregue) no próprio KDS.
      // Passa o KDS operado p/ o roteamento entre KDS (Fase E).
      await api.producaoAvancar(id, 'entrega', kdsSel || undefined);
      await carregarFila();
    } catch {
      /* concorrência: outra tela avançou — o refetch corrige */
      void carregarFila();
    }
  }

  // Ticker do rodapé: só o alerta EXIBIDO conta o tempo; ao zerar, sai e o próximo
  // (por prioridade/recência) assume — se um urgente entrou, o longo "congelou" e
  // volta a contar de onde parou.
  useEffect(() => {
    const t = setInterval(() => {
      setAlertas((prev) => {
        const exibido = escolherAlerta(prev);
        if (!exibido) return prev;
        return prev
          .map((a) => (a.id === exibido.id ? { ...a, restanteSeg: a.restanteSeg - 1 } : a))
          .filter((a) => a.restanteSeg > 0);
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const mostrado = escolherAlerta(alertas);
  const nowMs = now ? now.getTime() : Date.now();

  // Fase C — pedidos filtrados pela sub-origem do canal ativo (client-side).
  // canal 'todos' (KDS único) não aplica sub-filtro.
  const subAtivo = canal === 'delivery' ? subDelivery : canal === 'balcao' ? subBalcao : 'todos';
  const pedidosOrigem =
    canal === 'todos' || subAtivo === 'todos'
      ? pedidos
      : pedidos.filter((p) => grupoPedido(p, canal as 'delivery' | 'balcao') === subAtivo);
  // Etapas: os contadores valem para a fila inteira; o filtro escolhe o que aparece.
  const contagem = contarEtapas(pedidosOrigem, nowMs, cores);
  const pedidosVisiveis = filtrarEtapa(pedidosOrigem, etapaSel, nowMs, cores);
  const grupos = ver === 'item' ? agruparPorItem(pedidosVisiveis, nowMs) : [];
  // O resumo ao lado só existe na visão por pedido (na visão por item seria a mesma soma duas vezes).
  const resumoVisivel = resumoAberto && ver === 'pedido' && !modoEntrega && !mostrarMapa;
  const itensResumo = resumoVisivel ? somarItens(pedidosOrigem) : [];
  const itemAtivo = resumoVisivel && itensResumo.some((i) => i.descricao === itemSel) ? itemSel : '';

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
    setSenhaDigitada('');
    avisarSenha(`${identPedido(alvo)} avançou`, false);
    void avancar(alvo.id);
    if (usoRef.current === 'teclado') senhaRef.current?.focus({ preventScroll: true });
  }

  // TECLADO do equipamento, mesmo com o foco fora do campo. A decisão é de `decidirTecla`:
  //  · forma de uso TECLADO — número, Enter e Backspace são SEMPRE da senha; a tecla é tomada
  //    antes de chegar ao botão em foco (fase de captura) e o foco vai para o campo. Enter sem
  //    número só leva o foco para o campo.
  //  · forma de uso TOQUE — como sempre foi: número solto cai na senha; Enter num botão é do botão.
  const painelAberto = cfgAberta || histAberto;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && painelAberto) {
        setCfgAberta(false);
        setHistAberto(false);
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
  }, [uso, painelAberto, pedirTelaCheia, mostrarMapa, temSessao]);

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

  // Limpa a tela: o SERVIDOR avança todos os cards num único request (vão para o próximo
  // KDS ou concluem). Assim não dispara um POST por card (o que estourava o 429).
  async function limparCards() {
    const ativos = pedidos.filter((p) => p.status !== 'cancelado' && p.status !== 'entregue');
    if (!ativos.length) return;
    if (!confirm(`Finalizar todos os ${ativos.length} pedido(s) da tela? Eles vão avançar (próximo KDS ou concluir). Fica registrado no histórico, com o seu nome.`)) return;
    try {
      await api.producaoLimparFila({
        canal,
        setorId: setorSel || undefined,
        equipamentoId: kdsSel || undefined,
      });
    } catch { /* ignora — o refetch abaixo mostra o que sobrou */ }
    await carregarFila();
  }

  // Estilos que se repetem: botão/segmento ligado = tinta invertida (sem cor); desligado = cinza.
  const ligado = (on: boolean) =>
    on ? { background: T.text, color: T.panel, borderColor: T.text } : { background: T.panel2, color: T.muted, borderColor: T.border };
  const neutro = { background: T.panel2, borderColor: T.border, color: T.text };
  const botaoIcone = 'grid h-11 w-11 flex-none place-items-center border text-[17px]';
  const seletor = 'min-h-[44px] max-w-full border px-3 text-[13px] font-semibold';

  return (
    <main className="kds-tela min-h-dvh overflow-x-hidden" style={{ background: T.bg, color: T.text }}>
      {/* Cabeçalho: linha do APARELHO (canal, senha, conexão, hora, utilidades) e linha da FILA. */}
      <header className="z-10 border-b md:sticky md:top-0" style={{ background: T.panel, borderColor: T.border }}>
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:gap-3 sm:px-5">
          <div
            aria-hidden="true"
            className="grid h-10 w-10 flex-none place-items-center text-[18px] font-extrabold"
            style={{ background: '#0F2230', color: '#E2A340', fontFamily: TITULO }}
          >
            R
          </div>
          <div className="hidden xl:block">
            <div className="text-[17px] font-extrabold tracking-wide" style={{ fontFamily: TITULO }}>
              Regem KDS
            </div>
            <div className="text-[11px] uppercase tracking-[0.12em]" style={{ color: T.muted }}>
              {mostrarMapa ? 'Entregadores ao vivo' : 'Produção & alertas'}
            </div>
          </div>

          {!mostrarMapa && (<>
          {/* Canal: balcão/salão (local + retirada) x delivery (courier) */}
          <div role="group" aria-label="Canal" className="flex max-w-full flex-none overflow-x-auto border" style={{ borderColor: T.border }}>
            {([
              ['balcao', 'Balcão / Salão'],
              ['delivery', 'Delivery'],
              ['todos', 'Tudo'],
            ] as const).map(([c, rotulo]) => (
              <button
                key={c}
                type="button"
                aria-pressed={canal === c}
                onClick={() => { setCanal(c); try { localStorage.setItem('kds-canal', c); } catch { /* */ } }}
                className="min-h-[44px] whitespace-nowrap px-3.5 text-[13.5px] font-bold"
                style={{ background: canal === c ? T.text : T.panel2, color: canal === c ? T.panel : T.muted }}
              >
                {rotulo}
              </button>
            ))}
          </div>

          {/* Senha (Fase F): a caixa só recebe o número (teclado físico ou captura global).
              Enter avança o card daquela senha. No modo TECLADO ela é o dono do foco. */}
          <div className="relative flex items-center gap-2">
            <label htmlFor="kds-senha" className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: T.muted }}>
              Senha
            </label>
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
              className="min-h-[44px] border-2 text-center text-[24px] font-bold tabular-nums"
              style={{
                width: uso === 'teclado' ? 124 : 92,
                background: T.panel2,
                borderColor: senhaErro ? COR_STATUS.atrasado.fundo : uso === 'teclado' ? T.text : T.border,
                borderStyle: uso === 'teclado' && !senhaFocada ? 'dashed' : 'solid',
                color: T.text,
                fontFamily: MONO,
                outline: senhaFocada ? `3px solid ${FOCO}` : 'none',
                outlineOffset: 2,
              }}
            />
            <span
              id="kds-senha-msg"
              role="status"
              aria-live="polite"
              className={senhaMsg ? 'absolute left-0 top-[calc(100%+4px)] z-[12] whitespace-nowrap px-2.5 py-1 text-[13px] font-bold shadow-lg' : 'sr-only'}
              style={
                senhaMsg
                  ? senhaMsg.erro
                    ? { background: COR_STATUS.atrasado.fundo, color: COR_STATUS.atrasado.texto }
                    : { background: T.text, color: T.panel }
                  : undefined
              }
            >
              {senhaMsg?.texto ?? ''}
            </span>
            {/* Modo teclado com o foco fora do campo (janela em segundo plano): diz como voltar. */}
            {now && uso === 'teclado' && !senhaFocada && !senhaMsg && !painelAberto && (
              <span
                aria-hidden="true"
                className="absolute left-0 top-[calc(100%+4px)] z-[11] whitespace-nowrap border-[1.5px] border-dashed px-2 py-1 text-[12.5px] font-bold"
                style={{ background: T.panel, color: T.text, borderColor: T.text }}
              >
                Enter para digitar a senha
              </span>
            )}
          </div>
          </>)}

          <div className="hidden min-w-0 flex-1 md:block" />

          <div
            className="flex min-h-[44px] items-center gap-2 border px-3 text-[12.5px] font-bold"
            style={
              semConexao
                ? { background: COR_STATUS.atrasado.fundo, borderColor: COR_STATUS.atrasado.fundo, color: COR_STATUS.atrasado.texto }
                : { background: T.panel2, borderColor: T.border, color: T.muted }
            }
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: semConexao ? COR_STATUS.atrasado.texto : conectado ? COR_STATUS.ok.fundo : T.muted }}
            />
            {conectado ? 'online' : 'offline'}
          </div>

          <div className="text-[20px] font-bold tabular-nums md:text-[26px]" style={{ fontFamily: MONO }} aria-label="Hora">
            {now
              ? now.toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : '--:--:--'}
          </div>

          <div className="flex flex-none gap-2">
            <button
              type="button"
              onClick={() => setMudo((m) => !m)}
              aria-pressed={mudo}
              aria-label={mudo ? 'Som dos avisos: desligado' : 'Som dos avisos: ligado'}
              className={botaoIcone}
              style={neutro}
              title={mudo ? 'Som desligado' : 'Som ligado'}
            >
              {mudo ? '🔇' : '🔊'}
            </button>

            <button
              type="button"
              onClick={() => { setCfgAberta(false); setHistAberto((v) => !v); }}
              aria-expanded={histAberto}
              aria-label="Histórico: quem finalizou, cancelou ou mudou a configuração"
              className={botaoIcone}
              style={histAberto ? { ...neutro, borderColor: T.text, boxShadow: `inset 0 0 0 1px ${T.text}` } : neutro}
              title="Histórico: quem finalizou, cancelou ou mudou a configuração"
            >
              🕘
            </button>

            <button
              type="button"
              onClick={() => { setHistAberto(false); setCfgAberta((v) => !v); }}
              aria-expanded={cfgAberta}
              aria-label="Configuração da tela"
              className={botaoIcone}
              style={cfgAberta ? { ...neutro, borderColor: T.text, boxShadow: `inset 0 0 0 1px ${T.text}` } : neutro}
              title="Configuração da tela"
            >
              ⚙️
            </button>

            <button
              type="button"
              onClick={alternarTema}
              aria-label={claro ? 'Tema claro ligado' : 'Tema escuro ligado'}
              className={botaoIcone}
              style={neutro}
              title={claro ? 'Modo claro' : 'Modo escuro'}
            >
              {claro ? '☀️' : '🌙'}
            </button>
          </div>
        </div>

        {!mostrarMapa && (
          <div className="flex flex-wrap items-center gap-2 border-t px-4 pb-2.5 pt-2 sm:px-5" style={{ borderColor: T.border }}>
            {!modoEntrega && (<>
              {/* A fila por pedido (um cartão por pedido) ou por item (um cartão por item, somado). */}
              <div role="group" aria-label="Ver a fila" className="flex flex-none border" style={{ borderColor: T.border }}>
                {([
                  ['pedido', 'Por pedido'],
                  ['item', 'Por item'],
                ] as const).map(([v, rotulo]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={ver === v}
                    onClick={() => escolherVer(v)}
                    className="min-h-[44px] whitespace-nowrap px-3.5 text-[13.5px] font-bold"
                    style={{ background: ver === v ? T.text : T.panel2, color: ver === v ? T.panel : T.muted }}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>

              <div role="group" aria-label="Filtrar por etapa" className="flex max-w-full gap-2 overflow-x-auto">
                {FILTROS_ETAPA.map((f) => {
                  const n = contagem[f.key];
                  const sel = etapaSel === f.key;
                  const alerta = f.key === 'atrasados' && n > 0; // há atraso: o contador fica vermelho
                  return (
                    <button
                      key={f.key}
                      type="button"
                      aria-pressed={sel}
                      onClick={() => setEtapaSel(f.key)}
                      className="flex min-h-[44px] flex-none items-center gap-2 border px-3.5 text-[13.5px] font-bold"
                      style={
                        alerta
                          ? {
                              background: COR_STATUS.atrasado.fundo,
                              borderColor: COR_STATUS.atrasado.fundo,
                              color: COR_STATUS.atrasado.texto,
                              boxShadow: sel ? `inset 0 0 0 3px ${T.text}` : undefined,
                            }
                          : ligado(sel)
                      }
                    >
                      {f.label}
                      <b className="text-[15px] tabular-nums" style={{ fontFamily: MONO, color: alerta ? COR_STATUS.atrasado.texto : sel ? T.panel : T.text }}>
                        {n}
                      </b>
                    </button>
                  );
                })}
              </div>
            </>)}

            {setores.length > 0 && (
              <select
                aria-label="Filtrar por setor"
                value={setorSel}
                onChange={(e) => setSetorSel(e.target.value)}
                className={seletor}
                style={neutro}
              >
                <option value="">Todos os setores</option>
                {setores.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            )}

            {kdsList.length > 0 && (
              <select
                aria-label="Este KDS"
                value={kdsSel}
                onChange={(e) => escolherKds(e.target.value)}
                className={seletor}
                style={neutro}
                title="Qual KDS este aparelho opera (para a cadeia de produção)"
              >
                <option value="">KDS: todos (por setor)</option>
                {kdsList.map((k) => (
                  <option key={k.id} value={k.id}>KDS: {k.nome}{k.escopo === 'entrega' ? ' (entrega)' : ''}</option>
                ))}
              </select>
            )}

            <div className="hidden min-w-0 flex-1 md:block" />

            {!modoEntrega && ver === 'pedido' && (
              <button
                type="button"
                onClick={() => abrirResumo(!resumoAberto)}
                aria-pressed={resumoAberto}
                aria-expanded={resumoAberto}
                aria-controls="kds-resumo"
                aria-label="Resumo de itens"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 border px-3.5 text-[13px] font-bold"
                style={resumoAberto ? { ...neutro, borderColor: T.text, boxShadow: `inset 0 0 0 1px ${T.text}` } : neutro}
                title="Resumo de itens: a soma do que falta produzir"
              >
                📋 <span className="hidden sm:inline">Resumo de itens</span>
              </button>
            )}

            <button
              type="button"
              onClick={limparCards}
              aria-label="Finalizar todos os pedidos da tela"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 border px-3.5 text-[13px] font-bold"
              style={{ ...neutro, color: T.muted }}
              title="Finalizar/avançar todos os cards da tela"
            >
              🧹 <span className="hidden min-[1560px]:inline">Finalizar todos</span>
            </button>
          </div>
        )}

        {semConexao && (
          <div
            role="alert"
            className="px-4 py-2.5 text-[14px] font-bold sm:px-5"
            style={{ background: COR_STATUS.atrasado.fundo, color: COR_STATUS.atrasado.texto }}
          >
            ⚠ Sem conexão com o servidor. A fila pode estar desatualizada — reconectando…
          </div>
        )}
      </header>

      {histAberto && <HistoricoKds T={T} onFechar={() => setHistAberto(false)} />}

      {/* Painel de configuração (forma de uso + exibição + filtros + atalho). */}
      {cfgAberta && (
        <div
          role="dialog"
          aria-label="Configuração da tela"
          className="fixed right-4 top-[124px] z-30 max-h-[calc(100dvh-140px)] w-[340px] max-w-[calc(100vw-2rem)] overflow-y-auto border p-4 shadow-2xl"
          style={{ background: T.panel, borderColor: T.border, color: T.text }}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-bold uppercase tracking-wider" style={{ color: T.muted }}>Configuração</span>
            <button type="button" onClick={() => setCfgAberta(false)} aria-label="Fechar a configuração" className="grid h-11 w-11 place-items-center" style={{ color: T.muted }}>✕</button>
          </div>

          {/* Forma de uso deste aparelho: toque ou teclado. */}
          <div className="mb-3">
            <span className="mb-1 block text-[12px] font-semibold" style={{ color: T.muted }}>Forma de uso</span>
            <div role="group" aria-label="Forma de uso" className="flex border" style={{ borderColor: T.border }}>
              {([
                ['toque', 'Toque'],
                ['teclado', 'Teclado'],
              ] as const).map(([v, rotulo]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={uso === v}
                  onClick={() => setViewCfg({ uso: v })}
                  className="min-h-[44px] flex-1 px-2.5 text-[12.5px] font-bold"
                  style={{ background: uso === v ? T.text : T.panel2, color: uso === v ? T.panel : T.muted }}
                >
                  {rotulo}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed" style={{ color: T.muted }}>
              {uso === 'teclado'
                ? 'Teclado: o campo da senha fica sempre pronto para digitar. Enter com número avança o pedido; Enter sem número leva o cursor para o campo.'
                : 'Toque: os pedidos avançam pelo botão do cartão. Nada puxa o cursor para o campo da senha.'}
            </p>
          </div>
          <div className="my-3 border-t" style={{ borderColor: T.border }} />

          {/* O que esta tela mostra (mig 293). */}
          <div className="mb-3">
            <span className="mb-1 block text-[12px] font-semibold" style={{ color: T.muted }}>Esta tela mostra</span>
            {mapaHabilitado ? (
              <div className="flex border" style={{ borderColor: T.border }}>
                {([
                  ['pedidos', 'Pedidos'],
                  ['mapa', 'Mapa dos entregadores'],
                ] as const).map(([v, rotulo]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={tela === v}
                    onClick={() => escolherTela(v)}
                    className="min-h-[44px] flex-1 px-2.5 text-[12.5px] font-bold"
                    style={{ background: tela === v ? T.text : T.panel2, color: tela === v ? T.panel : T.muted }}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11.5px]" style={{ color: T.muted }}>
                Pedidos. O mapa dos entregadores fica disponível quando o gestor liga em Delivery → Configurações.
              </p>
            )}
          </div>
          <div className="my-3 border-t" style={{ borderColor: T.border }} />

          {/* Filtros (Fase C) — um conjunto para delivery, outro para o balcão. */}
          {([
            ['Filtrar delivery', 'delivery', subDelivery, setSubDelivery],
            ['Filtrar balcão / salão', 'balcao', subBalcao, setSubBalcao],
          ] as const).map(([rotulo, cnl, valor, setar]) => (
            <div key={cnl} className="mb-3">
              <span className="mb-1 block text-[12px] font-semibold" style={{ color: T.muted }}>{rotulo}</span>
              <div className="flex flex-wrap gap-1.5">
                {SUBFILTROS[cnl].map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={valor === s.key}
                    onClick={() => setar(s.key)}
                    className="min-h-[44px] border px-2.5 text-[12px] font-bold"
                    style={ligado(valor === s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="my-3 border-t" style={{ borderColor: T.border }} />
          <span className="mb-2 block text-[12px] font-semibold" style={{ color: T.muted }}>Exibição dos cards</span>

          <label htmlFor="kds-tamanho" className="mb-1 block text-[12px] font-semibold" style={{ color: T.muted }}>
            Tamanho ({Math.round(esc * 100)}%)
          </label>
          <input
            id="kds-tamanho"
            type="range" min={0.85} max={1.5} step={0.05} value={esc}
            onChange={(e) => setViewCfg({ escala: Number(e.target.value) })}
            className="mb-3 w-full"
          />

          {/* Onde a cor do tempo entra. */}
          <span className="mb-1 block text-[12px] font-semibold" style={{ color: T.muted }}>Cor do status</span>
          <div role="group" aria-label="Cor do status" className="mb-3 flex border" style={{ borderColor: T.border }}>
            {([
              ['cabecalho', 'Cabeçalho'],
              ['inteiro', 'Cartão inteiro'],
            ] as const).map(([v, rotulo]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view.cor === v}
                onClick={() => setViewCfg({ cor: v })}
                className="min-h-[44px] flex-1 px-2.5 text-[12.5px] font-bold"
                style={{ background: view.cor === v ? T.text : T.panel2, color: view.cor === v ? T.panel : T.muted }}
              >
                {rotulo}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={view.agregar} onChange={(e) => setViewCfg({ agregar: e.target.checked })} />
            Agregar itens iguais (somar quantidade)
          </label>

          <button
            type="button"
            onClick={() => setViewCfg(VIEW_PADRAO)}
            className="mt-3 min-h-[44px] w-full border text-[12px] font-bold"
            style={{ ...neutro, color: T.muted }}
          >
            Restaurar padrão
          </button>

          <div className="my-3 border-t" style={{ borderColor: T.border }} />
          <button
            type="button"
            onClick={criarAtalho}
            className="min-h-[44px] w-full text-[13px] font-bold"
            style={{ background: T.text, color: T.panel }}
          >
            🔗 Criar atalho na área de trabalho
          </button>
          <p className="mt-1.5 text-[11px]" style={{ color: T.muted }}>
            Baixa um atalho que abre este KDS já com estas configurações, em tela cheia.
            Arraste o arquivo para a área de trabalho.
          </p>
        </div>
      )}

      {/* Corpo — os alertas ficam no RODAPÉ fixo (abaixo); o resumo de itens, ao lado em tela larga. */}
      <div
        className={`mx-auto grid max-w-[1800px] grid-cols-1 gap-4 px-4 py-4 sm:px-5 ${resumoVisivel ? 'xl:grid-cols-[minmax(0,1fr)_300px]' : ''}`}
        style={{ paddingBottom: mostrado ? 96 : 24 }}
      >
        <div className="min-w-0">
        {mostrarMapa ? (
          <KdsMapaEntregadores T={T} escuro={!claro} esc={esc} onDesligado={mapaDesligado} />
        ) : modoEntrega ? (
          <EntregaBoard pedidos={pedidosOrigem} onEntregar={avancar} T={T} esc={esc} />
        ) : (
        /* Fila de produção — cartões colados, cor só no status do tempo. */
        <section aria-label={ver === 'item' ? 'Itens a produzir' : 'Pedidos em produção'}>
          {temSessao === null && (
            <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="animate-pulse border p-4" style={{ borderColor: T.border, background: T.panel }}>
                  <div className="h-4 w-1/2" style={{ background: T.border }} />
                  <div className="mt-3 h-3 w-2/3" style={{ background: T.panel2 }} />
                  <div className="mt-2 h-3 w-1/3" style={{ background: T.panel2 }} />
                </div>
              ))}
            </div>
          )}

          {temSessao !== null && (ver === 'item' ? grupos.length === 0 : pedidosVisiveis.length === 0) && (
            <div className="border border-dashed px-6 py-14 text-center text-sm" style={{ borderColor: T.border, color: T.muted }}>
              {pedidosOrigem.length > 0 && etapaSel !== 'todos'
                ? 'Nenhum pedido nesta etapa. Escolha “Todos” para ver a fila inteira.'
                : ver === 'item' && pedidosVisiveis.length > 0
                  ? 'Nada a produzir agora: os pedidos da tela já estão prontos.'
                  : 'Nenhum pedido em produção. Novos pedidos aparecem aqui em tempo real.'}
            </div>
          )}

          <div
            className="grid"
            style={{ gap: 4, gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${Math.round(260 * esc)}px), 1fr))` }}
          >
            {ver === 'item'
              ? grupos.map((g) => <KdsCartaoItem key={g.descricao} g={g} limites={cores} T={T} esc={esc} cor={view.cor} />)
              : pedidosVisiveis.map((p) => (
                  <KdsCartaoPedido
                    key={p.id}
                    p={p}
                    min={minutosDesde(p.criadoEm, nowMs)}
                    limites={cores}
                    T={T}
                    esc={esc}
                    cor={view.cor}
                    agregar={view.agregar}
                    realce={!itemAtivo ? 'nenhum' : pedidoTemItem(p, itemAtivo) ? 'destaque' : 'apagado'}
                    itemEmDestaque={itemAtivo}
                    onAvancar={avancar}
                  />
                ))}
          </div>
        </section>
        )}
        </div>

        {resumoVisivel && (
          <KdsResumoItens itens={itensResumo} escolhido={itemAtivo} onEscolher={setItemSel} onFechar={() => abrirResumo(false)} T={T} />
        )}
      </div>

      {/* RODAPÉ de alertas — barra full-width, texto rolando da direita p/ esquerda,
          cor vibrante por prioridade. Mostra o alerta de maior prioridade/recência;
          o urgente sobrepõe o longo e o ciclo do longo retoma quando o urgente sai. */}
      {mostrado && (
        <footer
          className="fixed inset-x-0 bottom-0 z-20 flex items-center overflow-hidden border-t"
          style={{ background: bgAlerta(mostrado.prioridade), borderColor: 'rgba(0,0,0,.25)', height: 64 }}
        >
          <div
            className="grid h-full place-items-center whitespace-nowrap px-4 text-[13px] font-extrabold uppercase tracking-wider"
            style={{ background: 'rgba(0,0,0,.22)', color: '#fff' }}
          >
            {mostrado.prioridade === 'danger' ? '⚠ Urgente' : mostrado.prioridade === 'ok' ? '✓ Aviso' : '● Aviso'}
          </div>
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <div
              key={mostrado.id}
              className="kds-marquee whitespace-nowrap py-3 text-[26px] font-extrabold text-white"
              style={{ fontFamily: TITULO, animation: 'kdsMarquee 16s linear infinite' }}
            >
              {mostrado.titulo}
              {mostrado.detalhe ? ` — ${mostrado.detalhe}` : ''}
              <span className="kds-marquee-eco">
                <span className="mx-16 opacity-70">•</span>
                {mostrado.titulo}
                {mostrado.detalhe ? ` — ${mostrado.detalhe}` : ''}
              </span>
            </div>
          </div>
          <div
            className="grid h-full place-items-center whitespace-nowrap px-4 text-[13px] font-bold uppercase tabular-nums tracking-wider text-white"
            style={{ background: 'rgba(0,0,0,.22)', fontFamily: MONO }}
          >
            {alertas.length > 1 ? `+${alertas.length - 1} na fila · ` : ''}
            {mostrado.restanteSeg}s
          </div>
        </footer>
      )}
      <style jsx global>{`
        @keyframes kdsMarquee {
          0% { transform: translateX(60%); }
          100% { transform: translateX(-100%); }
        }
        .kds-tela :focus-visible {
          outline: 3px solid ${FOCO};
          outline-offset: 2px;
        }
        /* Quem pede menos movimento lê o alerta parado, sem a rolagem. */
        @media (prefers-reduced-motion: reduce) {
          .kds-marquee {
            animation: none !important;
            white-space: normal !important;
            font-size: 18px !important;
            line-height: 1.15;
            padding: 0 14px !important;
          }
          .kds-marquee-eco {
            display: none;
          }
        }
      `}</style>

      {/* Atalho abriu com ?full=1 → oferece tela cheia (o navegador exige um clique). */}
      {pedirTelaCheia && (
        <button
          type="button"
          onClick={() => {
            document.documentElement.requestFullscreen?.().catch(() => {});
            setPedirTelaCheia(false);
            if (uso === 'teclado') senhaRef.current?.focus();
          }}
          className="fixed inset-0 z-40 grid place-items-center"
          style={{ background: 'rgba(11,17,23,.92)', color: '#fff' }}
        >
          <span className="px-8 py-4 text-lg font-bold" style={{ background: '#FFFFFF', color: '#0F1B24' }}>
            Toque para entrar em tela cheia
          </span>
        </button>
      )}

      {temSessao === false && (
        <div
          className="fixed inset-0 z-20 grid place-items-center px-4"
          style={{ background: 'rgba(11,17,23,.94)', color: '#fff' }}
        >
          <div className="text-center">
            <p className="mb-4 text-lg">Entre para operar o KDS.</p>
            <Link
              href="/entrar"
              className="inline-block px-6 py-3 text-sm font-bold"
              style={{ background: '#FFFFFF', color: '#0F1B24' }}
            >
              Ir para o login
            </Link>
          </div>
        </div>
      )}
    </main>
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
  onEntregar: (id: string) => void;
  T: { panel: string; panel2: string; border: string; text: string; muted: string };
  esc: number;
}) {
  const rotulo = (p: any) =>
    p.senha ? rotuloSenha(p.senha, p.senhaPrefixo) : p.mesa ? p.mesa : p.numero ? `#${p.numero}` : '—';
  const preparando = pedidos.filter((p) => p.status === 'recebido' || p.status === 'preparo');
  const pronto = pedidos.filter((p) => p.status === 'pronto');
  const Coluna = ({ titulo, itens, cor, tocavel }: { titulo: string; itens: any[]; cor: CorStatus; tocavel?: boolean }) => (
    <section className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: cor.fundo }} />
        <span className="text-[15px] font-bold uppercase tracking-wider" style={{ color: T.muted, fontFamily: TITULO }}>
          {titulo}
        </span>
        <span className="text-[15px] font-bold" style={{ color: T.muted, fontFamily: MONO }}>{itens.length}</span>
      </div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
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
            onClick={() => tocavel && onEntregar(p.id)}
            className="grid place-items-center border font-extrabold tabular-nums disabled:cursor-default"
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
            {rotulo(p)}
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
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Coluna titulo="Preparando" itens={preparando} cor={COR_STATUS.atencao} />
      <Coluna titulo="Pronto — chamar / entregar" itens={pronto} cor={COR_STATUS.ok} tocavel />
    </div>
  );
}
