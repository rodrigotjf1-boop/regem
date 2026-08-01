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
  const [canal, setCanal] = useState<'balcao' | 'delivery'>('balcao');
  const [mudo, setMudo] = useState(false);
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
    }
  }, []);

  // Recarrega quando muda o setor ou o canal (balcão/delivery).
  useEffect(() => {
    carregarFila();
  }, [setorSel, canal, carregarFila]);

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
      await api.producaoAvancar(id, 'entrega');
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
              onClick={() => setCanal(c)}
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
          onClick={alternarTema}
          aria-pressed={claro}
          className="grid h-[42px] w-[42px] place-items-center rounded-[10px] border text-[17px]"
          style={{ background: T.panel2, borderColor: T.border }}
          title={claro ? 'Modo claro' : 'Modo escuro'}
        >
          {claro ? '☀️' : '🌙'}
        </button>
      </header>

      {/* Corpo full-width — os alertas foram para o RODAPÉ fixo (abaixo). */}
      <div className="mx-auto max-w-[1600px] px-6 py-6" style={{ paddingBottom: mostrado ? 96 : 24 }}>
        {/* Pedidos de produção — cards coloridos por tempo */}
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
              {pedidos.length} na fila
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

          {temSessao !== null && pedidos.length === 0 && (
            <div
              className="rounded-2xl border border-dashed px-6 py-14 text-center text-sm"
              style={{ borderColor: T.border, color: T.muted }}
            >
              Nenhum pedido em produção. Novos pedidos aparecem aqui em tempo real.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {pedidos.map((p) => {
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
                  className="flex flex-col rounded-[14px] border p-4"
                  style={{
                    background: cancelado ? '#2A1416' : T.panel,
                    borderColor: cancelado ? '#8A2B2B' : T.border,
                    borderTop: `6px solid ${cancelado ? '#E05252' : cor}`,
                  }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className="text-[16px] font-bold"
                      style={{ fontFamily: 'Archivo, sans-serif', textDecoration: cancelado ? 'line-through' : 'none', opacity: cancelado ? 0.7 : 1 }}
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
                    {(p.itens ?? []).map((it: any) => (
                      <div key={it.id} className="text-[14px]" style={{ textDecoration: cancelado ? 'line-through' : 'none', opacity: cancelado ? 0.65 : 1 }}>
                        <span className="font-semibold">
                          {Number(it.quantidade)}× {it.descricao}
                        </span>
                        {it.complementosTexto && (
                          <div
                            className="mt-0.5 rounded px-1.5 py-0.5 text-[12px] font-semibold"
                            style={{ background: 'rgba(226,163,64,.18)', color: '#F4C578' }}
                          >
                            {it.complementosTexto}
                          </div>
                        )}
                        {it.observacao && (
                          <div
                            className="mt-0.5 rounded px-1.5 py-0.5 text-[12px] font-bold"
                            style={{ background: 'rgba(255,90,78,.18)', color: '#FF8A80' }}
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
