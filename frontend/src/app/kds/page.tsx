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
  ack?: boolean;
};

function borderFor(p: Alerta['prioridade']) {
  if (p === 'danger') return '#FF5A4E';
  if (p === 'info') return '#3BA7E8';
  if (p === 'ok') return '#19C08F';
  return '#FFB13D';
}

// Cor pelo tempo decorrido vs. limiares configurados pelo gerente.
function corTempo(min: number, cores: { verdeAteMin: number; amareloAteMin: number }) {
  if (min <= cores.verdeAteMin) return '#19C08F';
  if (min <= cores.amareloAteMin) return '#FFB13D';
  return '#FF5A4E';
}
const proximaLabel = (status: string) =>
  status === 'recebido' ? 'Iniciar' : status === 'preparo' ? 'Pronto' : 'Entregar';

export default function KdsPage() {
  const [conectado, setConectado] = useState(false);
  const [temSessao, setTemSessao] = useState<boolean | null>(null);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [cores, setCores] = useState({ verdeAteMin: 5, amareloAteMin: 10 });
  const [setores, setSetores] = useState<any[]>([]);
  const [setorSel, setSetorSel] = useState('');
  const [mudo, setMudo] = useState(false);
  // null no SSR/1ª render → evita hydration mismatch do relógio (server ≠ client).
  const [now, setNow] = useState<Date | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const mudoRef = useRef(mudo);
  mudoRef.current = mudo;
  const setorRef = useRef(setorSel);
  setorRef.current = setorSel;

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
      const r: any = await api.producaoFila(setorRef.current || undefined);
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

  // Recarrega quando muda o setor selecionado.
  useEffect(() => {
    carregarFila();
  }, [setorSel, carregarFila]);

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
        },
        ...prev,
      ]);
      if (a.som !== false) bip();
    });

    // Nudge de produção → refaz o GET (fonte da verdade). Novo pedido = som.
    socket.on('producao:atualizado', (p: any) => {
      void carregarFila();
      if (p?.tipo === 'novo') bip();
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [bip, carregarFila]);

  function dispararTeste() {
    socketRef.current?.emit('kds:alerta', {
      titulo: 'Pedido atrasado — Mesa 12',
      detalhe: 'Aguardando há mais de 15 min. Priorizar no preparo.',
      prioridade: 'danger',
      som: true,
    });
  }

  async function avancar(id: string) {
    try {
      await api.producaoAvancar(id);
      await carregarFila();
    } catch {
      /* concorrência: outra tela avançou — o refetch corrige */
      void carregarFila();
    }
  }

  function ack(id: string) {
    setAlertas((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ack: true } : a)),
    );
  }

  const pendentes = alertas.filter((a) => !a.ack).length;
  const nowMs = now ? now.getTime() : Date.now();

  return (
    <main
      className="min-h-dvh"
      style={{ background: '#0B141B', color: '#EAF1F5' }}
    >
      {/* Header */}
      <header
        className="sticky top-0 z-10 flex items-center gap-4 border-b px-6 py-3"
        style={{ background: '#12202A', borderColor: '#22333F' }}
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
            style={{ color: '#7C93A1' }}
          >
            Produção & alertas
          </div>
        </div>

        {setores.length > 0 && (
          <select
            aria-label="Filtrar por setor"
            value={setorSel}
            onChange={(e) => setSetorSel(e.target.value)}
            className="ml-2 rounded-lg border px-3 py-2 text-[13px] font-semibold"
            style={{ background: '#182B37', borderColor: '#22333F', color: '#EAF1F5' }}
          >
            <option value="">Todos os setores</option>
            {setores.map((s) => (
              <option key={s.id} value={s.id}>{s.nome}</option>
            ))}
          </select>
        )}

        <div
          className="ml-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] font-semibold"
          style={{ background: '#182B37', borderColor: '#22333F', color: '#9FB3BF' }}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: conectado ? '#19C08F' : '#FF5A4E' }}
          />
          {conectado ? 'Conectado' : 'Offline'}
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
          style={{ background: '#182B37', borderColor: '#22333F' }}
          title={mudo ? 'Som desligado' : 'Som ligado'}
        >
          {mudo ? '🔇' : '🔊'}
        </button>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-6 py-6 lg:grid-cols-[1fr_320px]">
        {/* Pedidos de produção — cards coloridos por tempo */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <span
              className="text-[13px] font-bold uppercase tracking-[0.16em]"
              style={{ color: '#7C93A1', fontFamily: 'Archivo, sans-serif' }}
            >
              Pedidos em produção
            </span>
            <span
              className="text-[13px] font-bold"
              style={{ color: '#7C93A1', fontFamily: 'JetBrains Mono, monospace' }}
            >
              {pedidos.length} na fila
            </span>
          </div>

          {pedidos.length === 0 && (
            <div
              className="rounded-2xl border border-dashed px-6 py-14 text-center text-sm"
              style={{ borderColor: '#22333F', color: '#7C93A1' }}
            >
              Nenhum pedido em produção. Novos pedidos aparecem aqui em tempo real.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pedidos.map((p) => {
              const min = Math.max(
                0,
                Math.floor((nowMs - new Date(p.criadoEm).getTime()) / 60000),
              );
              const cor = corTempo(min, cores);
              const atrasado = p.tempoPreparoMin && min > p.tempoPreparoMin;
              return (
                <div
                  key={p.id}
                  className="flex flex-col rounded-[14px] border p-4"
                  style={{
                    background: '#12202A',
                    borderColor: '#22333F',
                    borderTop: `6px solid ${cor}`,
                  }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[16px] font-bold" style={{ fontFamily: 'Archivo, sans-serif' }}>
                      {p.numero ? `#${p.numero} · ` : ''}
                      {p.mesa ? `Mesa ${p.mesa}` : 'Balcão'}
                    </span>
                    <span
                      className="rounded px-2 py-0.5 text-[12px] font-bold tabular-nums"
                      style={{ background: cor, color: '#04241A', fontFamily: 'JetBrains Mono, monospace' }}
                    >
                      {min} min
                    </span>
                  </div>
                  <div className="mb-3 flex-1 space-y-1">
                    {(p.itens ?? []).map((it: any) => (
                      <div key={it.id} className="text-[14px]">
                        <span className="font-semibold">
                          {Number(it.quantidade)}× {it.descricao}
                        </span>
                        {it.complementosTexto && (
                          <div className="text-[12px]" style={{ color: '#9FB3BF' }}>
                            {it.complementosTexto}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <span
                      className="text-[11px] uppercase tracking-wide"
                      style={{ color: atrasado ? '#FF5A4E' : '#7C93A1' }}
                    >
                      {p.status}
                      {atrasado ? ' · atrasado' : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => avancar(p.id)}
                      className="rounded-[10px] px-4 py-2 text-[13px] font-extrabold uppercase tracking-[0.08em]"
                      style={{ background: '#19C08F', color: '#04241A' }}
                    >
                      {proximaLabel(p.status)}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Lateral: alertas + teste */}
        <aside>
          <button
            type="button"
            onClick={dispararTeste}
            disabled={!conectado}
            className="mb-4 w-full rounded-[12px] px-4 py-3 text-sm font-bold disabled:opacity-40"
            style={{ background: '#E2A340', color: '#0B141B' }}
          >
            Disparar alerta de teste
          </button>

          <div className="mb-3 flex items-center justify-between">
            <span
              className="text-[12px] font-bold uppercase tracking-[0.16em]"
              style={{ color: '#7C93A1', fontFamily: 'Archivo, sans-serif' }}
            >
              Alertas
            </span>
            <span className="text-[12px] font-bold" style={{ color: '#FFB13D' }}>
              {pendentes} pend.
            </span>
          </div>

          {alertas.length === 0 && (
            <div
              className="rounded-[14px] border border-dashed px-4 py-8 text-center text-[13px]"
              style={{ borderColor: '#22333F', color: '#7C93A1' }}
            >
              Tarefas, picos e avisos aparecem aqui.
            </div>
          )}

          {alertas.map((a) => (
            <div
              key={a.id}
              className="mb-3 flex items-start gap-3 rounded-[12px] border p-3.5"
              style={{
                background: '#12202A',
                borderColor: '#22333F',
                borderLeft: `6px solid ${borderFor(a.prioridade)}`,
                opacity: a.ack ? 0.5 : 1,
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold leading-tight" style={{ fontFamily: 'Archivo, sans-serif' }}>
                  {a.titulo}
                </div>
                {a.detalhe && (
                  <div className="mt-1 text-[12.5px]" style={{ color: '#9FB3BF' }}>
                    {a.detalhe}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => ack(a.id)}
                disabled={a.ack}
                className="rounded-[10px] px-3 py-2 text-[12px] font-extrabold uppercase"
                style={
                  a.ack
                    ? { background: '#182B37', color: '#7C93A1' }
                    : { background: '#19C08F', color: '#04241A' }
                }
              >
                {a.ack ? 'Feito' : 'OK'}
              </button>
            </div>
          ))}
        </aside>
      </div>

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
