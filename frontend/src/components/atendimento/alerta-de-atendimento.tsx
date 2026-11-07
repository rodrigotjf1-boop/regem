'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from '@/lib/toast';
import { connectAsGestor } from '@/lib/rt';
import { getCategoria } from '@/lib/api';
import {
  ROTULO_DO_TIPO,
  escaladoDe,
  recadoDe,
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
// virou URGENTE (cliente irritado): aviso vermelho e três bipes; caso que NINGUÉM PEGOU no tempo do ajuste "Fila e
// avisos" (mig 353): para gerente e presidente, aviso e dois bipes. O som é desta tela (preferência do aparelho) e só
// toca depois do primeiro clique na página — regra dos navegadores.

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
/** A campainha ("ding-dong"): duas notas, a segunda mais grave, com o som caindo devagar. */
function campainha(vezes: number) {
  const ctx = garantirAudio();
  if (!ctx || ctx.state !== 'running') return;
  for (let i = 0; i < vezes; i++) {
    [988, 784].forEach((freq, n) => {
      const t0 = ctx.currentTime + i * 0.9 + n * 0.32;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.62);
    });
  }
}

// O SOM DO AVISO é de cada computador (como o som do pedido novo e o do KDS): o ajuste "Som do aviso no computador" do
// protótipo fica no sino do topo — vale também nos computadores que usam o servidor da loja. Guardado neste navegador.
export type SomDoAviso = 'bipe' | 'campainha' | 'sem';
export const OPCOES_DE_SOM: Array<[SomDoAviso, string]> = [
  ['bipe', 'Bipe curto'],
  ['campainha', 'Campainha'],
  ['sem', 'Sem som'],
];
export function somDoAviso(): SomDoAviso {
  try {
    const v = localStorage.getItem(CHAVE_SOM);
    return v === '0' ? 'sem' : v === 'campainha' ? 'campainha' : 'bipe'; // '1' (versão anterior) = bipe
  } catch {
    return 'bipe';
  }
}
export function escolherSom(s: SomDoAviso) {
  try {
    localStorage.setItem(CHAVE_SOM, s === 'sem' ? '0' : s);
  } catch {
    /* modo privado: vale só nesta visita */
  }
  tocar('novo'); // uma amostra do som escolhido
}
/** Toca o aviso no som escolhido: caso novo (1 vez), "ninguém pegou" e "faltam N min" (2), urgente e disputa (3). */
export function tocar(nivel: 'novo' | 'escalado' | 'urgente') {
  const s = somDoAviso();
  if (s === 'sem') return;
  const vezes = nivel === 'novo' ? 1 : nivel === 'escalado' ? 2 : 3;
  if (s === 'campainha') campainha(vezes);
  else if (nivel === 'urgente') bipe(3, 1320, 'square');
  else if (nivel === 'escalado') bipe(2, 1100, 'triangle');
  else bipe(1, 880, 'sine');
}

const resumo = (c: CasoDaFila) => {
  const m = String(c.mensagem ?? '').replace(/\s+/g, ' ').trim();
  return m ? ` — "${m.length > 90 ? `${m.slice(0, 89).trimEnd()}…` : m}"` : '';
};

export function AlertaDeAtendimento({ ativo }: { ativo: boolean }) {
  const { casos, lida, avisos } = useFilaDeAtendimento();
  const antes = useRef<{ ids: Set<string>; urgentes: Set<string>; escalados: Set<string> } | null>(null);
  // A disputa que já teve o "faltam N min" (um por caso).
  const deNovo = useRef<Set<string>>(new Set());
  // O aviso "ninguém pegou" (mig 353) é para quem é gerente ou presidente. A categoria só existe no navegador (V35).
  const [gestor, setGestor] = useState(false);
  useEffect(() => setGestor(['presidente', 'gerente'].includes(getCategoria() ?? '')), []);

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
    const escalados = new Set(casos.filter((c) => escaladoDe(c)).map((c) => c.id));
    const ant = antes.current;
    antes.current = { ids, urgentes, escalados };
    if (!ant) return; // primeira leitura: o que já estava aberto não é novidade
    const novosUrgentes = casos.filter((c) => urgentes.has(c.id) && !ant.urgentes.has(c.id));
    if (novosUrgentes.length) {
      const c = novosUrgentes[0];
      toast.error(
        `🚨 Atendimento URGENTE — cliente chateado: ${tituloDoCaso(c)}${resumo(c)}${novosUrgentes.length > 1 ? ` (+${novosUrgentes.length - 1})` : ''}`,
        15000,
      );
      tocar('urgente');
      return;
    }
    // A DISPUTA DO iFOOD (ajuste "Avisar o gerente quando chega uma disputa"): para gerente e presidente — só eles
    // respondem —, na hora em que chega e de novo quando faltarem N minutos, se ninguém respondeu.
    const agora = Date.now();
    if (gestor && avisos.disputa.avisar) {
      const novaDisputa = casos.find((c) => c.tipo === 'disputa' && !ant.ids.has(c.id));
      if (novaDisputa) {
        toast.error(
          `🔔 Disputa do iFood — só gerente e presidente respondem: ${tituloDoCaso(novaDisputa)}${novaDisputa.prazoEm ? ` · vence em ${tempoAte(novaDisputa.prazoEm, agora)}` : ''}`,
          15000,
        );
        tocar('urgente');
        return;
      }
      const limite = avisos.disputa.deNovoMin * 60_000;
      const quaseVencendo = casos.find((c) => {
        if (c.tipo !== 'disputa' || c.situacao === 'resolvido' || c.detalhe?.resposta || !c.prazoEm || deNovo.current.has(c.id)) return false;
        const falta = new Date(c.prazoEm).getTime() - agora;
        return falta > 0 && falta <= limite;
      });
      if (quaseVencendo) {
        deNovo.current.add(quaseVencendo.id);
        toast.error(`⏰ Disputa sem resposta — vence em ${tempoAte(quaseVencendo.prazoEm, agora)}: ${tituloDoCaso(quaseVencendo)}`, 15000);
        tocar('escalado');
        return;
      }
    }
    // Ninguém pegou no tempo do ajuste "Fila e avisos" (mig 353): o aviso sobe para o gerente — aqui e no app.
    const novosEscalados = gestor ? casos.filter((c) => escalados.has(c.id) && !ant.escalados.has(c.id)) : [];
    if (novosEscalados.length) {
      const c = novosEscalados[0];
      const min = escaladoDe(c)?.minutos;
      toast.error(
        `⏰ Ninguém pegou${min ? ` em ${min} min` : ''}: ${tituloDoCaso(c)}${resumo(c)}${novosEscalados.length > 1 ? ` (+${novosEscalados.length - 1})` : ''}`,
        15000,
      );
      tocar('escalado');
      return;
    }
    const novos = casos.filter((c) => !ant.ids.has(c.id));
    if (!novos.length) return;
    // Os recados da noite (mig 379) entram juntos quando a equipe começa: um aviso só, com a contagem, e um toque.
    if (novos.every((c) => recadoDe(c))) {
      toast.info(`🌙 ${novos.length === 1 ? '1 recado da noite entrou' : `${novos.length} recados da noite entraram`} na fila.`, 10000);
      tocar('novo');
      return;
    }
    const c = novos[0];
    toast.info(
      `🔔 Atendimento: ${ROTULO_DO_TIPO[c.tipo] ?? 'Atendimento'} · ${tituloDoCaso(c)}${resumo(c)}${novos.length > 1 ? ` (+${novos.length - 1})` : ''}`,
      c.mensagem ? 10000 : 5000,
    );
    tocar('novo');
  }, [casos, lida, ativo, gestor, avisos]);

  return null;
}

/** O sino do topo: quantos casos abertos e, ao abrir, os três primeiros da fila. */
export function SinoDoAtendimento() {
  const { casos, contagens, erro } = useFilaDeAtendimento();
  const [aberto, setAberto] = useState(false);
  const [som, setSom] = useState<SomDoAviso>('bipe');
  const [agora, setAgora] = useState<number | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => setSom(somDoAviso()), []);
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
          {/* O som do aviso é DESTE computador ("Som do aviso no computador", protótipo da central). */}
          <div className="mt-3" role="group" aria-labelledby="sino-som-titulo">
            <p id="sino-som-titulo" className="mb-1.5 text-xs font-semibold text-secondary-foreground">
              Som do aviso neste computador
            </p>
            <div className="flex flex-wrap gap-1.5">
              {OPCOES_DE_SOM.map(([v, rotulo]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={som === v}
                  onClick={() => {
                    setSom(v);
                    escolherSom(v);
                  }}
                  className={`min-h-9 rounded-full border px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    som === v ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card hover:bg-secondary'
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
