'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/lib/api';
import { connectAsGestor, type Socket } from '@/lib/rt';

/* eslint-disable @typescript-eslint/no-explicit-any */

// KDS web (superfície de teste do tempo real). Base do futuro app nativo empacotado.
// Tema escuro de alto contraste — ref. mockups/regem-kds.html.

type Alerta = {
  id: string;
  titulo: string;
  detalhe: string;
  prioridade: 'danger' | 'alta' | 'info' | 'ok';
  em: string;
  ack?: boolean;
};
type Marcacao = {
  nsr: number;
  tipo: string;
  colaboradorNome: string | null;
  origem: string;
  em: string;
};

const TIPO_LABEL: Record<string, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  intervalo_inicio: 'Início de intervalo',
  intervalo_fim: 'Fim de intervalo',
};

function borderFor(p: Alerta['prioridade']) {
  if (p === 'danger') return '#FF5A4E';
  if (p === 'info') return '#3BA7E8';
  if (p === 'ok') return '#19C08F';
  return '#FFB13D';
}

export default function KdsPage() {
  const [conectado, setConectado] = useState(false);
  const [temSessao, setTemSessao] = useState<boolean | null>(null);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [marcacoes, setMarcacoes] = useState<Marcacao[]>([]);
  const [mudo, setMudo] = useState(false);
  const [now, setNow] = useState(new Date());
  const socketRef = useRef<Socket | null>(null);
  const mudoRef = useRef(mudo);
  mudoRef.current = mudo;

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

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setTemSessao(false);
      return;
    }
    setTemSessao(true);
    const socket = connectAsGestor();
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

    socket.on('ponto:marcado', (p: any) => {
      const c = p.comprovante ?? {};
      setMarcacoes((prev) =>
        [
          {
            nsr: c.nsr,
            tipo: c.tipo,
            colaboradorNome: c.colaboradorNome ?? null,
            origem: p.origem,
            em: c.marcadoEm ?? new Date().toISOString(),
          },
          ...prev,
        ].slice(0, 12),
      );
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [bip]);

  function dispararTeste() {
    socketRef.current?.emit('kds:alerta', {
      titulo: 'Pedido atrasado — Mesa 12',
      detalhe: 'Aguardando há mais de 15 min. Priorizar no preparo.',
      prioridade: 'danger',
      som: true,
    });
  }

  function ack(id: string) {
    setAlertas((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ack: true } : a)),
    );
  }

  const pendentes = alertas.filter((a) => !a.ack).length;

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
            Alertas operacionais
          </div>
        </div>

        <div
          className="ml-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] font-semibold"
          style={{ background: '#182B37', borderColor: '#22333F', color: '#9FB3BF' }}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              background: conectado ? '#19C08F' : '#FF5A4E',
              boxShadow: conectado ? '0 0 0 0 rgba(25,192,143,.6)' : 'none',
            }}
          />
          {conectado ? 'Conectado' : 'Offline'}
        </div>

        <div
          className="ml-auto text-[26px] font-bold tabular-nums"
          style={{ fontFamily: 'JetBrains Mono, monospace' }}
        >
          {now.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </div>

        <button
          onClick={() => setMudo((m) => !m)}
          aria-pressed={mudo}
          className="grid h-[42px] w-[42px] place-items-center rounded-[10px] border text-[17px]"
          style={{ background: '#182B37', borderColor: '#22333F' }}
          title={mudo ? 'Som desligado' : 'Som ligado'}
        >
          {mudo ? '🔇' : '🔊'}
        </button>
      </header>

      <div className="mx-auto grid max-w-6xl gap-5 px-6 py-6 lg:grid-cols-[1fr_320px]">
        {/* Fila de alertas */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <span
              className="text-[13px] font-bold uppercase tracking-[0.16em]"
              style={{ color: '#7C93A1', fontFamily: 'Archivo, sans-serif' }}
            >
              Fila de alertas
            </span>
            <span
              className="text-[13px] font-bold"
              style={{ color: '#FFB13D', fontFamily: 'JetBrains Mono, monospace' }}
            >
              {pendentes} pendente{pendentes === 1 ? '' : 's'}
            </span>
          </div>

          {alertas.length === 0 && (
            <div
              className="rounded-2xl border border-dashed px-6 py-14 text-center text-sm"
              style={{ borderColor: '#22333F', color: '#7C93A1' }}
            >
              Nenhum alerta. A fila aparece aqui em tempo real.
            </div>
          )}

          {alertas.map((a) => (
            <div
              key={a.id}
              className="mb-3.5 flex items-start gap-4 rounded-[14px] border p-5"
              style={{
                background: '#12202A',
                borderColor: '#22333F',
                borderLeft: `6px solid ${borderFor(a.prioridade)}`,
                opacity: a.ack ? 0.5 : 1,
              }}
            >
              <div className="min-w-0 flex-1">
                <div
                  className="text-[19px] font-bold leading-tight"
                  style={{ fontFamily: 'Archivo, sans-serif' }}
                >
                  {a.titulo}
                </div>
                {a.detalhe && (
                  <div className="mt-1.5 text-sm" style={{ color: '#9FB3BF' }}>
                    {a.detalhe}
                  </div>
                )}
                <div
                  className="mt-2 text-[12px]"
                  style={{ color: '#7C93A1', fontFamily: 'JetBrains Mono, monospace' }}
                >
                  {new Date(a.em).toLocaleTimeString('pt-BR')}
                </div>
              </div>
              <button
                onClick={() => ack(a.id)}
                disabled={a.ack}
                className="rounded-[11px] px-5 py-3.5 text-[14px] font-extrabold uppercase tracking-[0.1em]"
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
        </section>

        {/* Lateral: marcações ao vivo + teste */}
        <aside>
          <button
            onClick={dispararTeste}
            disabled={!conectado}
            className="mb-4 w-full rounded-[12px] px-4 py-3 text-sm font-bold disabled:opacity-40"
            style={{ background: '#E2A340', color: '#0B141B' }}
          >
            Disparar alerta de teste
          </button>

          <div
            className="rounded-[14px] border p-4"
            style={{ background: '#12202A', borderColor: '#22333F' }}
          >
            <div
              className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em]"
              style={{ color: '#7C93A1', fontFamily: 'Archivo, sans-serif' }}
            >
              Marcações de ponto ao vivo
            </div>
            {marcacoes.length === 0 && (
              <div className="py-6 text-center text-[13px]" style={{ color: '#7C93A1' }}>
                Aguardando marcações…
              </div>
            )}
            {marcacoes.map((m, i) => (
              <div
                key={`${m.nsr}-${i}`}
                className="flex items-center justify-between border-b py-2 last:border-0"
                style={{ borderColor: '#1B2A34' }}
              >
                <div>
                  <div className="text-[13.5px] font-semibold">
                    {m.colaboradorNome ?? '—'}
                  </div>
                  <div className="text-[11.5px]" style={{ color: '#7C93A1' }}>
                    {TIPO_LABEL[m.tipo] ?? m.tipo} · {m.origem}
                  </div>
                </div>
                <div
                  className="text-right text-[11px]"
                  style={{ color: '#9FB3BF', fontFamily: 'JetBrains Mono, monospace' }}
                >
                  <div>NSR {m.nsr}</div>
                  <div>{new Date(m.em).toLocaleTimeString('pt-BR')}</div>
                </div>
              </div>
            ))}
          </div>
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
