'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from '@/lib/toast';
import { connectAsGestor } from '@/lib/rt';
import {
  ROTULO_DO_TIPO,
  relerFila,
  tempoAte,
  tempoDesde,
  tituloDoCaso,
  useFilaDeAtendimento,
  type CasoDaFila,
} from '@/lib/atendimento';
import { ChipDoCanal } from './chip-do-canal';

// O ALERTA DA CENTRAL DE ATENDIMENTO, em TODAS as telas (protótipo aprovado em 02/11/2026; antes só no painel do
// Delivery). Montado pelo Shell para quem pode atender. Relê a fila a cada 15 s e na hora pelo tempo real (nuvem); no
// servidor da loja o caso chega pelo sincronismo e aparece na leitura seguinte. Caso NOVO: aviso e um bipe; caso que
// virou URGENTE (cliente irritado): aviso vermelho e três bipes. O som é desta tela (preferência do aparelho) e só toca
// depois do primeiro clique na página — regra dos navegadores.

const CHAVE_SOM = 'som_atendimento';
let audio: AudioContext | null = null;
function garantirAudio(): AudioContext | null {
  try {
    if (!audio) {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (AC) audio = new AC();
    }
    if (audio?.state === 'suspended') void audio.resume();
  } catch {
    /* sem som neste navegador */
  }
  return audio;
}
function bipe(vezes: number, freq: number, tipo: OscillatorType) {
  const ctx = garantirAudio();
  if (!ctx || ctx.state !== 'running') return;
  for (let i = 0; i < vezes; i++) {
    const t0 = ctx.currentTime + i * 0.28;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = tipo;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + 0.26);
  }
}
export function somLigado(): boolean {
  try {
    return localStorage.getItem(CHAVE_SOM) !== '0';
  } catch {
    return true;
  }
}
export function ligarSom(ligado: boolean) {
  try {
    localStorage.setItem(CHAVE_SOM, ligado ? '1' : '0');
  } catch {
    /* modo privado: vale só nesta visita */
  }
  if (ligado) bipe(1, 880, 'sine');
}

const resumo = (c: CasoDaFila) => {
  const m = String(c.mensagem ?? '').replace(/\s+/g, ' ').trim();
  return m ? ` — "${m.length > 90 ? `${m.slice(0, 89).trimEnd()}…` : m}"` : '';
};

export function AlertaDeAtendimento({ ativo }: { ativo: boolean }) {
  const { casos, lida } = useFilaDeAtendimento();
  const antes = useRef<{ ids: Set<string>; urgentes: Set<string> } | null>(null);

  // Leitura a cada 15 s + tempo real (caso novo, caso mudou).
  useEffect(() => {
    if (!ativo) return;
    void relerFila();
    const t = setInterval(() => void relerFila(), 15_000);
    let s: any = null;
    try {
      s = connectAsGestor();
      s.on('atendimento:novo', () => void relerFila());
      s.on('atendimento:mudou', () => void relerFila());
    } catch {
      /* sem tempo real: fica a leitura a cada 15 s */
    }
    // O navegador só deixa tocar depois de um gesto da pessoa: o primeiro clique libera o som.
    const liberar = () => garantirAudio();
    document.addEventListener('pointerdown', liberar, { once: true });
    return () => {
      clearInterval(t);
      document.removeEventListener('pointerdown', liberar);
      try {
        s?.disconnect();
      } catch {
        /* nada */
      }
    };
  }, [ativo]);

  // Caso novo ou que virou urgente desde a leitura anterior → aviso e som.
  useEffect(() => {
    if (!ativo || !lida) return;
    const ids = new Set(casos.map((c) => c.id));
    const urgentes = new Set(casos.filter((c) => c.prioridade === 'urgente').map((c) => c.id));
    const ant = antes.current;
    antes.current = { ids, urgentes };
    if (!ant) return; // primeira leitura: o que já estava aberto não é novidade
    const novosUrgentes = casos.filter((c) => urgentes.has(c.id) && !ant.urgentes.has(c.id));
    if (novosUrgentes.length) {
      const c = novosUrgentes[0];
      toast.error(
        `🚨 Atendimento URGENTE — cliente chateado: ${tituloDoCaso(c)}${resumo(c)}${novosUrgentes.length > 1 ? ` (+${novosUrgentes.length - 1})` : ''}`,
        15000,
      );
      if (somLigado()) bipe(3, 1320, 'square');
      return;
    }
    const novos = casos.filter((c) => !ant.ids.has(c.id));
    if (!novos.length) return;
    const c = novos[0];
    toast.info(
      `🔔 Atendimento: ${ROTULO_DO_TIPO[c.tipo] ?? 'Atendimento'} · ${tituloDoCaso(c)}${resumo(c)}${novos.length > 1 ? ` (+${novos.length - 1})` : ''}`,
      c.mensagem ? 10000 : 5000,
    );
    if (somLigado()) bipe(1, 880, 'sine');
  }, [casos, lida, ativo]);

  return null;
}

/** O sino do topo: quantos casos abertos e, ao abrir, os três primeiros da fila. */
export function SinoDoAtendimento() {
  const { casos, contagens, erro } = useFilaDeAtendimento();
  const [aberto, setAberto] = useState(false);
  const [som, setSom] = useState(true);
  const [agora, setAgora] = useState<number | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => setSom(somLigado()), []);
  useEffect(() => {
    if (!aberto) return;
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), 1000);
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      clearInterval(t);
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);
  const total = contagens?.abertos ?? casos.length;
  const urgentes = casos.filter((c) => c.prioridade === 'urgente').length;
  const primeiros = casos.slice(0, 3);
  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls="sino-do-atendimento"
        aria-label={`Atendimento: ${total} ${total === 1 ? 'caso aberto' : 'casos abertos'}${urgentes ? `, ${urgentes} urgente${urgentes > 1 ? 's' : ''}` : ''}`}
        onClick={() => setAberto((v) => !v)}
        className={`relative grid h-9 w-9 place-items-center rounded-md border text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          urgentes ? 'border-destructive bg-destructive text-white motion-safe:animate-pulse' : 'border-border bg-card hover:border-secondary-foreground'
        }`}
      >
        <span aria-hidden="true">{urgentes ? '🚨' : '🔔'}</span>
        {total > 0 && (
          <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 font-mono text-[11px] font-bold text-white">
            {total}
          </span>
        )}
      </button>
      {aberto && (
        <div
          id="sino-do-atendimento"
          role="dialog"
          aria-label="Atendimento: o que pede você agora"
          className="absolute right-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-2rem))] rounded-xl border border-border bg-card p-3 text-foreground shadow-2xl"
        >
          <p className="mb-2 font-display text-sm font-bold">Atendimento · o que pede você agora</p>
          {erro && <p className="mb-2 text-xs text-destructive">Não consegui ler a fila agora. Tento de novo em instantes.</p>}
          {!primeiros.length && !erro && <p className="py-3 text-center text-sm text-secondary-foreground">Ninguém esperando. 🎉</p>}
          <div className="space-y-1.5">
            {primeiros.map((c) => (
              <Link
                key={c.id}
                href={`/atendimento?caso=${c.id}`}
                onClick={() => setAberto(false)}
                className="flex items-start gap-2 rounded-lg border border-border p-2 text-sm hover:border-secondary-foreground"
              >
                <ChipDoCanal canal={c.canal} />
                <span className="min-w-0">
                  <b className="block break-words">{tituloDoCaso(c)}</b>
                  <span className="text-xs text-secondary-foreground">
                    {c.prazoEm
                      ? `vence em ${agora ? tempoAte(c.prazoEm, agora) : '…'}`
                      : `${c.prioridade === 'urgente' ? 'urgente · ' : ''}esperando há ${agora ? tempoDesde(c.criadoEm, agora) : '…'}`}
                  </span>
                </span>
              </Link>
            ))}
          </div>
          <Link
            href="/atendimento"
            onClick={() => setAberto(false)}
            className="mt-2 flex min-h-10 items-center justify-center rounded-md bg-primary px-3 text-sm font-bold text-primary-foreground"
          >
            Abrir o Atendimento
          </Link>
          <button
            type="button"
            aria-pressed={som}
            onClick={() => {
              const v = !som;
              setSom(v);
              ligarSom(v);
            }}
            className="mt-2 w-full rounded-md px-2 py-1.5 text-left text-xs text-secondary-foreground hover:bg-secondary"
          >
            {som ? '🔊 Som do aviso ligado neste computador (toque para desligar)' : '🔇 Som do aviso desligado neste computador (toque para ligar)'}
          </button>
        </div>
      )}
    </div>
  );
}
