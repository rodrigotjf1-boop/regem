'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, getToken } from '@/lib/api';
import { connectAsGestor, connectAsDevice, type Socket } from '@/lib/rt';

/* eslint-disable @typescript-eslint/no-explicit-any */

// KDS web (superfície de teste do tempo real). Base do futuro app nativo empacotado.
// KDS = informativo + avanço de produção. Consultar/alterar/cancelar é no PDV.

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

// Cor pelo tempo decorrido vs. limiares configurados pelo gerente.
function corTempo(min: number, cores: { verdeAteMin: number; amareloAteMin: number }) {
  if (min <= cores.verdeAteMin) return '#19C08F';
  if (min <= cores.amareloAteMin) return '#FFB13D';
  return '#FF5A4E';
}
const proximaLabel = (status: string) =>
  status === 'recebido' ? 'Iniciar' : status === 'preparo' ? 'Pronto' : 'Entregar';

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

// ── Fase D: config de exibição do card (por aparelho, no localStorage) ────────
type ViewCfg = {
  escala: number; // multiplicador de fonte/espaçamento (0.85 .. 1.5)
  corSenha: string; // cor da fonte da senha ('' = tema)
  corProduto: string; // cor da fonte do produto ('' = tema)
  corObs: string; // cor da fonte das observações
  agregar: boolean; // agregar itens iguais (soma quantidade) vs. mostrar separados
};
const VIEW_PADRAO: ViewCfg = {
  escala: 1,
  corSenha: '#E2A340',
  corProduto: '',
  corObs: '#FF3B30',
  agregar: false,
};
// Agrega itens iguais (mesma descrição + complementos + obs) somando a quantidade.
function agregarItens(itens: any[]): any[] {
  const mapa = new Map<string, any>();
  for (const it of itens ?? []) {
    const chave = `${it.descricao}|${it.complementosTexto ?? ''}|${it.observacao ?? ''}`;
    const ex = mapa.get(chave);
    if (ex) ex.quantidade = Number(ex.quantidade) + Number(it.quantidade);
    else mapa.set(chave, { ...it, quantidade: Number(it.quantidade) });
  }
  return [...mapa.values()];
}

// Temas do KDS (só o "chrome" muda; verde/amarelo/vermelho/dourado são semânticos).
const TEMAS = {
  escuro: {
    bg: '#0B141B',
    panel: '#12202A',
    panel2: '#182B37',
    border: '#22333F',
    text: '#EAF1F5',
    muted: '#9FB3BF',
  },
  claro: {
    bg: '#EDF0F4',
    panel: '#FFFFFF',
    panel2: '#F1F4F8',
    border: '#D8DEE6',
    text: '#0F2230',
    muted: '#5B6B78',
  },
};

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
  const [canal, setCanal] = useState<'balcao' | 'delivery'>('balcao');
  const [subFiltro, setSubFiltro] = useState('todos'); // Fase C — sub-origem
  const [senhaDigitada, setSenhaDigitada] = useState(''); // Fase F — teclado de senha
  const [senhaErro, setSenhaErro] = useState(false);
  const [mudo, setMudo] = useState(false);
  // Fase D — config de exibição do card (por aparelho; guardada no localStorage).
  const [view, setView] = useState<ViewCfg>(VIEW_PADRAO);
  const [cfgAberta, setCfgAberta] = useState(false);
  useEffect(() => {
    try {
      const s = localStorage.getItem('kds-view');
      if (s) setView({ ...VIEW_PADRAO, ...JSON.parse(s) });
    } catch { /* ignora */ }
  }, []);
  function setViewCfg(patch: Partial<ViewCfg>) {
    setView((v) => {
      const novo = { ...v, ...patch };
      try { localStorage.setItem('kds-view', JSON.stringify(novo)); } catch { /* ignora */ }
      return novo;
    });
  }
  const esc = view.escala; // multiplicador de fonte/espaço
  // Tema do KDS (preferência do aparelho — UI, não dado de negócio).
  const [claro, setClaro] = useState(false);
  useEffect(() => {
    setClaro(localStorage.getItem('kds-tema') === 'claro');
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
      // Fase E — KDS da loja (p/ o seletor de cadeia). Restaura a última escolha.
      api.equipamentos()
        .then((eqs: any) => setKdsList((eqs as any[]).filter((e) => e.tipo === 'kds' && e.ativo)))
        .catch(() => {});
      try {
        const s = localStorage.getItem('kds-equip');
        if (s) setKdsSel(s);
      } catch { /* ignora */ }
    }
  }, []);

  function escolherKds(id: string) {
    setKdsSel(id);
    try { localStorage.setItem('kds-equip', id); } catch { /* ignora */ }
  }
  const kdsAtual = kdsList.find((k) => k.id === kdsSel) || null;
  const modoEntrega = kdsAtual?.escopo === 'entrega'; // Fase E3 — board só-senha

  // Recarrega quando muda o setor, o canal ou o KDS operado.
  useEffect(() => {
    carregarFila();
  }, [setorSel, canal, kdsSel, carregarFila]);

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
          ? `Senha ${alvo.senha}`
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

  // Fase C — cards filtrados pela sub-origem escolhida (client-side).
  const pedidosFiltrados =
    subFiltro === 'todos' ? pedidos : pedidos.filter((p) => grupoPedido(p, canal) === subFiltro);

  // Fase F — digita a senha no teclado e o card com essa senha avança uma etapa.
  function teclaSenha(t: string) {
    setSenhaErro(false);
    if (t === 'del') setSenhaDigitada((s) => s.slice(0, -1));
    else if (t === 'ok') avancarPorSenha();
    else setSenhaDigitada((s) => (s.length < 6 ? s + t : s));
  }
  function avancarPorSenha() {
    const s = senhaDigitada.trim();
    if (!s) return;
    const alvo = pedidos.find((p) => String(p.senha ?? '') === s && p.status !== 'cancelado');
    if (!alvo) {
      setSenhaErro(true);
      return;
    }
    setSenhaDigitada('');
    void avancar(alvo.id);
  }

  return (
    <main
      className="min-h-dvh"
      style={{ background: T.bg, color: T.text }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-10 flex items-center gap-4 border-b px-6 py-3"
        style={{ background: T.panel, borderColor: T.border }}
      >
        <div
          className="grid h-10 w-10 place-items-center rounded-[10px] font-bold"
          style={{
            background: 'linear-gradient(135deg,#0F2230,#1D3B4D)',
            color: '#E2A340',
            border: '1px solid #E2A340',
            fontFamily: 'Archivo, sans-serif',
          }}
        >
          R
        </div>
        <div>
          <div
            className="text-[17px] font-extrabold tracking-wide"
            style={{ fontFamily: 'Archivo, sans-serif' }}
          >
            Regem KDS
          </div>
          <div
            className="text-[11px] uppercase tracking-[0.12em]"
            style={{ color: T.muted }}
          >
            Produção & alertas
          </div>
        </div>

        {/* Canal: balcão/salão (local + retirada) x delivery (courier) */}
        <div className="ml-2 flex overflow-hidden rounded-lg border" style={{ borderColor: T.border }}>
          {([
            ['balcao', 'Balcão / Salão'],
            ['delivery', 'Delivery'],
          ] as const).map(([c, rotulo]) => (
            <button
              key={c}
              type="button"
              onClick={() => { setCanal(c); setSubFiltro('todos'); }}
              className="px-3 py-2 text-[13px] font-semibold"
              style={{
                background: canal === c ? '#E2A340' : T.panel2,
                color: canal === c ? '#0B141B' : T.muted,
              }}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {setores.length > 0 && (
          <select
            aria-label="Filtrar por setor"
            value={setorSel}
            onChange={(e) => setSetorSel(e.target.value)}
            className="ml-1 rounded-lg border px-3 py-2 text-[13px] font-semibold"
            style={{ background: T.panel2, borderColor: T.border, color: T.text }}
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
            className="rounded-lg border px-3 py-2 text-[13px] font-semibold"
            style={{ background: T.panel2, borderColor: T.border, color: T.text }}
            title="Qual KDS este aparelho opera (para a cadeia de produção)"
          >
            <option value="">KDS: todos (por setor)</option>
            {kdsList.map((k) => (
              <option key={k.id} value={k.id}>KDS: {k.nome}{k.escopo === 'entrega' ? ' (entrega)' : ''}</option>
            ))}
          </select>
        )}

        <div
          className="ml-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] font-semibold"
          style={{ background: T.panel2, borderColor: T.border, color: T.muted }}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: conectado ? '#19C08F' : '#FF5A4E' }}
          />
          {conectado ? 'Servidor online' : 'Servidor offline'}
        </div>

        <div
          className="ml-auto text-[26px] font-bold tabular-nums"
          style={{ fontFamily: 'JetBrains Mono, monospace' }}
        >
          {now
            ? now.toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })
            : '--:--:--'}
        </div>

        <button
          type="button"
          onClick={() => setMudo((m) => !m)}
          aria-pressed={mudo}
          className="grid h-[42px] w-[42px] place-items-center rounded-[10px] border text-[17px]"
          style={{ background: T.panel2, borderColor: T.border }}
          title={mudo ? 'Som desligado' : 'Som ligado'}
        >
          {mudo ? '🔇' : '🔊'}
        </button>

        <button
          type="button"
          onClick={() => setCfgAberta((v) => !v)}
          aria-pressed={cfgAberta}
          className="grid h-[42px] w-[42px] place-items-center rounded-[10px] border text-[17px]"
          style={{ background: T.panel2, borderColor: T.border }}
          title="Exibição dos cards"
        >
          ⚙️
        </button>

        <button
          type="button"
          onClick={alternarTema}
          aria-pressed={claro}
          className="grid h-[42px] w-[42px] place-items-center rounded-[10px] border text-[17px]"
          style={{ background: T.panel2, borderColor: T.border }}
          title={claro ? 'Modo claro' : 'Modo escuro'}
        >
          {claro ? '☀️' : '🌙'}
        </button>
      </header>

      {/* Fase D — painel de exibição dos cards (por aparelho). */}
      {cfgAberta && (
        <div
          className="fixed right-4 top-[74px] z-30 w-[300px] rounded-[14px] border p-4 shadow-2xl"
          style={{ background: T.panel, borderColor: T.border, color: T.text }}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-bold uppercase tracking-wider" style={{ color: T.muted }}>Exibição dos cards</span>
            <button type="button" onClick={() => setCfgAberta(false)} style={{ color: T.muted }}>✕</button>
          </div>

          <label className="mb-1 block text-[12px] font-semibold" style={{ color: T.muted }}>
            Tamanho ({Math.round(esc * 100)}%)
          </label>
          <input
            type="range" min={0.85} max={1.5} step={0.05} value={esc}
            onChange={(e) => setViewCfg({ escala: Number(e.target.value) })}
            className="mb-3 w-full"
          />

          {([
            ['corSenha', 'Cor da senha'],
            ['corProduto', 'Cor do produto'],
            ['corObs', 'Cor da observação'],
          ] as const).map(([k, rotulo]) => (
            <div key={k} className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[12.5px]">{rotulo}</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={(view[k] as string) || (k === 'corProduto' ? (claro ? '#0F2230' : '#EAF1F5') : '#E2A340')}
                  onChange={(e) => setViewCfg({ [k]: e.target.value } as any)}
                  className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                <button type="button" onClick={() => setViewCfg({ [k]: '' } as any)} className="text-[11px]" style={{ color: T.muted }} title="Usar a cor do tema">padrão</button>
              </div>
            </div>
          ))}

          <label className="mt-2 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={view.agregar} onChange={(e) => setViewCfg({ agregar: e.target.checked })} />
            Agregar itens iguais (somar quantidade)
          </label>

          <button
            type="button"
            onClick={() => setViewCfg(VIEW_PADRAO)}
            className="mt-3 w-full rounded-[10px] py-2 text-[12px] font-bold"
            style={{ background: T.panel2, color: T.muted }}
          >
            Restaurar padrão
          </button>
        </div>
      )}

      {/* Sub-barra: filtros por sub-origem (Fase C) + teclado de senha (Fase F) */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-2"
        style={{ background: T.panel2, borderColor: T.border }}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: T.muted }}>
            {canal === 'delivery' ? 'Delivery' : 'Balcão / Salão'}
          </span>
          {SUBFILTROS[canal].map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSubFiltro(s.key)}
              aria-pressed={subFiltro === s.key}
              className="rounded-md px-2.5 py-1.5 text-[12.5px] font-semibold"
              style={{
                background: subFiltro === s.key ? '#E2A340' : T.panel,
                color: subFiltro === s.key ? '#0B141B' : T.muted,
                border: `1px solid ${T.border}`,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Teclado de senha — digita o nº da senha e o card avança uma etapa */}
        <div className="ml-auto flex items-center gap-1.5">
          <div
            className="flex h-9 w-24 items-center justify-end rounded-md px-3 text-[18px] font-bold tabular-nums"
            style={{
              background: senhaErro ? 'rgba(255,90,78,.25)' : T.panel,
              border: `1px solid ${senhaErro ? '#FF5A4E' : T.border}`,
              color: T.text,
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {senhaDigitada || <span style={{ color: T.muted, fontSize: 12 }}>Senha</span>}
          </div>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => teclaSenha(d)}
              className="h-9 w-9 rounded-md text-[15px] font-bold"
              style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text }}
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => teclaSenha('del')}
            className="h-9 w-9 rounded-md text-[15px] font-bold"
            style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.muted }}
            title="Apagar"
          >
            ⌫
          </button>
          <button
            type="button"
            onClick={() => teclaSenha('ok')}
            disabled={!senhaDigitada}
            className="h-9 rounded-md px-4 text-[13px] font-extrabold uppercase disabled:opacity-40"
            style={{ background: '#19C08F', color: '#04241A' }}
            title="Avançar o pedido dessa senha"
          >
            OK
          </button>
        </div>
      </div>

      {/* Corpo full-width — os alertas foram para o RODAPÉ fixo (abaixo). */}
      <div className="mx-auto max-w-[1600px] px-6 py-6" style={{ paddingBottom: mostrado ? 96 : 24 }}>
        {modoEntrega ? (
          <EntregaBoard pedidos={pedidosFiltrados} onEntregar={avancar} T={T} esc={esc} />
        ) : (
        /* Pedidos de produção — cards coloridos por tempo */
        <section>
          <div className="mb-3 flex items-center justify-between">
            <span
              className="text-[13px] font-bold uppercase tracking-[0.16em]"
              style={{ color: T.muted, fontFamily: 'Archivo, sans-serif' }}
            >
              Pedidos em produção
            </span>
            <span
              className="text-[13px] font-bold"
              style={{ color: T.muted, fontFamily: 'JetBrains Mono, monospace' }}
            >
              {pedidosFiltrados.length}{subFiltro !== 'todos' ? ` de ${pedidos.length}` : ''} na fila
            </span>
          </div>

          {temSessao === null && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-2xl border p-4"
                  style={{ borderColor: T.border, background: T.panel }}
                >
                  <div className="h-4 w-1/2 rounded" style={{ background: T.border }} />
                  <div className="mt-3 h-3 w-2/3 rounded" style={{ background: T.panel2 }} />
                  <div className="mt-2 h-3 w-1/3 rounded" style={{ background: T.panel2 }} />
                </div>
              ))}
            </div>
          )}

          {temSessao !== null && pedidosFiltrados.length === 0 && (
            <div
              className="rounded-2xl border border-dashed px-6 py-14 text-center text-sm"
              style={{ borderColor: T.border, color: T.muted }}
            >
              Nenhum pedido em produção. Novos pedidos aparecem aqui em tempo real.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {pedidosFiltrados.map((p) => {
              const min = Math.max(
                0,
                Math.floor((nowMs - new Date(p.criadoEm).getTime()) / 60000),
              );
              const cor = corTempo(min, cores);
              const atrasado = p.tempoPreparoMin && min > p.tempoPreparoMin;
              const cancelado = p.status === 'cancelado';
              const alterado = p.obs === 'ALTERADO';
              return (
                <div
                  key={p.id}
                  className="flex flex-col rounded-[14px] border"
                  style={{
                    background: cancelado ? '#2A1416' : T.panel,
                    borderColor: cancelado ? '#8A2B2B' : T.border,
                    borderTop: `6px solid ${cancelado ? '#E05252' : cor}`,
                    padding: Math.round(16 * esc),
                  }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className="font-bold"
                      style={{ fontFamily: 'Archivo, sans-serif', fontSize: Math.round(17 * esc), color: view.corSenha || undefined, textDecoration: cancelado ? 'line-through' : 'none', opacity: cancelado ? 0.7 : 1 }}
                    >
                      {p.senha
                        ? `Senha ${p.senha}`
                        : p.mesa
                          ? `Mesa ${p.mesa}`
                          : p.numero
                            ? `#${p.numero}`
                            : 'Balcão'}
                    </span>
                    <span
                      className="rounded px-2 py-0.5 text-[12px] font-bold tabular-nums"
                      style={{ background: cor, color: '#04241A', fontFamily: 'JetBrains Mono, monospace' }}
                    >
                      {min} min
                    </span>
                  </div>
                  {p.plataforma && (
                    <div
                      className="mb-2 inline-flex w-max items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold"
                      style={{ background: 'rgba(226,163,64,.16)', color: '#E2A340' }}
                    >
                      🛵 {p.plataforma}{p.senhaPlataforma ? ` · #${p.senhaPlataforma}` : ''}
                    </div>
                  )}
                  {(cancelado || alterado) && (
                    <div
                      className="mb-2 inline-flex w-max items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-bold"
                      style={cancelado ? { background: 'rgba(224,82,82,.2)', color: '#FF8A80' } : { background: 'rgba(226,163,64,.18)', color: '#F4C578' }}
                    >
                      {cancelado ? '✕ CANCELADA' : '✏️ ALTERADO'}
                    </div>
                  )}
                  <div className="mb-3 flex-1 space-y-1">
                    {(view.agregar ? agregarItens(p.itens ?? []) : (p.itens ?? [])).map((it: any, ix: number) => (
                      <div key={it.id ?? ix} style={{ fontSize: Math.round(14 * esc), textDecoration: cancelado ? 'line-through' : 'none', opacity: cancelado ? 0.65 : 1 }}>
                        <span className="font-semibold" style={{ color: view.corProduto || undefined }}>
                          {Number(it.quantidade)}× {it.descricao}
                        </span>
                        {it.complementosTexto && (
                          <div
                            className="mt-0.5 rounded px-1.5 py-0.5 font-semibold"
                            style={{ background: 'rgba(226,163,64,.18)', color: '#F4C578', fontSize: Math.round(12 * esc) }}
                          >
                            {it.complementosTexto}
                          </div>
                        )}
                        {it.observacao && (
                          <div
                            className="mt-0.5 rounded px-1.5 py-0.5 font-bold"
                            style={{ background: 'rgba(255,59,48,.16)', color: view.corObs || '#FF3B30', fontSize: Math.round(12 * esc) }}
                          >
                            OBS: {it.observacao}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <span
                      className="text-[11px] uppercase tracking-wide"
                      style={{ color: cancelado ? '#FF8A80' : atrasado ? '#FF5A4E' : T.muted }}
                    >
                      {p.status}
                      {atrasado && !cancelado ? ' · atrasado' : ''}
                    </span>
                    {!cancelado && (
                      <button
                        type="button"
                        onClick={() => avancar(p.id)}
                        className="rounded-[10px] px-4 py-2 text-[13px] font-extrabold uppercase tracking-[0.08em]"
                        style={{ background: '#19C08F', color: '#04241A' }}
                      >
                        {proximaLabel(p.status)}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
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
            className="grid h-full place-items-center px-4 text-[13px] font-extrabold uppercase tracking-wider"
            style={{ background: 'rgba(0,0,0,.22)', color: '#fff', minWidth: 120 }}
          >
            {mostrado.prioridade === 'danger' ? '⚠ Urgente' : mostrado.prioridade === 'ok' ? '✓ Aviso' : '● Aviso'}
          </div>
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <div
              key={mostrado.id}
              className="whitespace-nowrap py-3 text-[26px] font-extrabold text-white"
              style={{ fontFamily: 'Archivo, sans-serif', animation: 'kdsMarquee 16s linear infinite' }}
            >
              {mostrado.titulo}
              {mostrado.detalhe ? ` — ${mostrado.detalhe}` : ''}
              <span className="mx-16 opacity-70">•</span>
              {mostrado.titulo}
              {mostrado.detalhe ? ` — ${mostrado.detalhe}` : ''}
            </div>
          </div>
          <div
            className="grid h-full place-items-center px-4 text-[15px] font-bold tabular-nums text-white"
            style={{ background: 'rgba(0,0,0,.22)', fontFamily: 'JetBrains Mono, monospace', minWidth: 64 }}
          >
            {mostrado.restanteSeg}s
          </div>
        </footer>
      )}
      <style jsx global>{`
        @keyframes kdsMarquee {
          0% { transform: translateX(60%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>

      {temSessao === false && (
        <div
          className="fixed inset-0 z-20 grid place-items-center px-4"
          style={{ background: 'rgba(11,20,27,.94)' }}
        >
          <div className="text-center">
            <p className="mb-4 text-lg">Entre para operar o KDS.</p>
            <Link
              href="/entrar"
              className="rounded-full px-6 py-3 text-sm font-bold"
              style={{ background: '#E2A340', color: '#0B141B' }}
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
  const rotulo = (p: any) => (p.senha ? p.senha : p.mesa ? p.mesa : p.numero ? `#${p.numero}` : '—');
  const preparando = pedidos.filter((p) => p.status === 'recebido' || p.status === 'preparo');
  const pronto = pedidos.filter((p) => p.status === 'pronto');
  const Coluna = ({ titulo, itens, cor, tocavel }: { titulo: string; itens: any[]; cor: string; tocavel?: boolean }) => (
    <section className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full" style={{ background: cor }} />
        <span className="text-[15px] font-bold uppercase tracking-wider" style={{ color: T.muted, fontFamily: 'Archivo, sans-serif' }}>
          {titulo}
        </span>
        <span className="text-[15px] font-bold" style={{ color: T.muted, fontFamily: 'JetBrains Mono, monospace' }}>{itens.length}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {itens.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed px-6 py-10 text-center text-sm" style={{ borderColor: T.border, color: T.muted }}>
            Vazio
          </div>
        )}
        {itens.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={!tocavel}
            onClick={() => tocavel && onEntregar(p.id)}
            className="grid place-items-center rounded-[16px] border font-extrabold tabular-nums disabled:cursor-default"
            style={{
              background: tocavel ? cor : T.panel,
              color: tocavel ? '#04241A' : T.text,
              borderColor: T.border,
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: Math.round(48 * esc),
              padding: Math.round(22 * esc),
              minHeight: Math.round(96 * esc),
            }}
            title={tocavel ? 'Entregar (concluir)' : undefined}
          >
            {rotulo(p)}
          </button>
        ))}
      </div>
    </section>
  );
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Coluna titulo="Preparando" itens={preparando} cor="#FFB13D" />
      <Coluna titulo="Pronto — chamar / entregar" itens={pronto} cor="#19C08F" tocavel />
    </div>
  );
}
