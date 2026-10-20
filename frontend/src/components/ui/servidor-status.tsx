'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { getCategoria } from '@/lib/api';
import { testarServidorAgora, useConexaoServidor, type ConexaoServidor } from '@/lib/conexao-servidor';

// Indicador do servidor. No MODO LOCAL é o "● Servidor da loja" do protótipo aprovado em 20/10/2026
// (mockups/regem-conexao-servidor.html peça 2): diz se este PC está falando com o servidor da loja e, ao
// clicar, mostra a última resposta, o endereço, o terminal deste PC e um "Testar agora". Fica no topo de
// toda tela (Shell), no Balcão, no Delivery e no Garçom. Na NUVEM continua o ponto simples de online/offline.
// A medição é UMA para a tela inteira (`lib/conexao-servidor`): o aviso de queda lê a mesma.

const EDGE = process.env.NEXT_PUBLIC_EDGE === '1';

const ROTULO: Record<ConexaoServidor['fase'], { cor: string; curto: string; longo: string; pill: string; tom: string }> = {
  verificando: { cor: 'bg-neutral-400', curto: 'Servidor…', longo: 'Conferindo o servidor…', pill: 'conferindo', tom: 'bg-secondary text-secondary-foreground' },
  ok: { cor: 'bg-ok', curto: 'Servidor', longo: 'Servidor da loja', pill: 'conectado', tom: 'bg-ok/15 text-ok' },
  lento: { cor: 'bg-warn', curto: 'Lento', longo: 'Servidor lento', pill: 'lento', tom: 'bg-warn/15 text-warn' },
  caiu: { cor: 'bg-destructive', curto: 'Sem servidor', longo: 'Sem servidor', pill: 'sem resposta', tom: 'bg-destructive/15 text-destructive' },
};

const segundos = (de: number | null, agora: number) => (de && agora ? Math.max(0, Math.round((agora - de) / 1000)) : null);
const ha = (s: number | null) => (s == null ? '—' : s < 2 ? 'agora' : s < 60 ? `há ${s} s` : `há ${Math.floor(s / 60)} min`);
const ms = (v: number | null) => (v == null ? '' : v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : `${v} ms`);

export function ServidorStatus({ className = '' }: { className?: string }) {
  const c = useConexaoServidor();
  const [aberto, setAberto] = useState(false);
  const [agora, setAgora] = useState(0); // relógio só com o painel aberto (nada de hora no 1º render — V35)
  const [teste, setTeste] = useState('');
  const [gestor, setGestor] = useState(false);
  // No celular o painel fica preso à tela (fixed), logo ABAIXO do chip — senão cobria o próprio botão.
  const [topo, setTopo] = useState(64);
  const caixa = useRef<HTMLSpanElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    const cat = getCategoria();
    setGestor(cat === 'presidente' || cat === 'gerente');
  }, []);

  useEffect(() => {
    if (!aberto) return;
    setAgora(Date.now());
    const t = setInterval(() => setAgora(Date.now()), 1000);
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false);
        botao.current?.focus();
      }
    };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => {
      clearInterval(t);
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
    };
  }, [aberto]);

  const r = ROTULO[c.fase];

  // Nuvem: o ponto simples de sempre (lá não há "servidor da loja" para conferir).
  if (!EDGE) {
    const txt = c.fase === 'verificando' ? 'Verificando…' : c.fase === 'caiu' ? 'Servidor offline' : 'Servidor online';
    return (
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold ${className}`} title={txt}>
        <span className={`h-2 w-2 flex-none rounded-full ${r.cor} ${c.fase === 'caiu' ? 'animate-pulse' : ''}`} />
        {txt}
      </span>
    );
  }

  const endereco = typeof window !== 'undefined' ? window.location.hostname : '';
  const ip = c.servidor?.ip && c.servidor.ip !== endereco ? c.servidor.ip : null;
  const versao = c.servidor?.versao ?? c.versao;

  async function testar() {
    setTeste('Testando…');
    const t = await testarServidorAgora();
    setTeste(t.ok ? `Respondeu em ${ms(t.ms)}.` : 'Não respondeu.');
  }
  const corTeste = teste === 'Não respondeu.' ? 'text-destructive' : teste === 'Testando…' ? 'text-secondary-foreground' : 'text-ok';

  return (
    <span ref={caixa} className={`relative inline-flex ${className}`}>
      <button
        ref={botao}
        type="button"
        aria-expanded={aberto}
        aria-controls={id}
        onClick={() => {
          setTeste('');
          const r = botao.current?.getBoundingClientRect();
          if (r) setTopo(Math.round(r.bottom + 8));
          setAberto((v) => !v);
        }}
        title="Operando no servidor local da loja. Clique para ver a conexão."
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-bold ${
          c.fase === 'caiu' ? 'border-destructive text-destructive' : 'border-border bg-card text-foreground'
        }`}
      >
        <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${r.cor} ${c.fase === 'caiu' ? 'animate-pulse' : ''}`} />
        <span className="sm:hidden">{r.curto}</span>
        <span className="hidden sm:inline">{r.longo}</span>
      </button>

      {aberto && (
        <div
          id={id}
          role="dialog"
          aria-label="Conexão com o servidor da loja"
          style={{ ['--topo' as string]: `${topo}px` }}
          className="fixed inset-x-4 top-[var(--topo)] z-50 grid max-h-[calc(100dvh-var(--topo)-16px)] gap-3 overflow-y-auto rounded-xl border border-border bg-card p-4 text-sm text-foreground shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-[380px] sm:overflow-visible"
        >
          <p className="flex items-center gap-2 font-display text-base font-bold">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.tom}`}>{r.pill}</span> Servidor da loja
          </p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            {c.fase === 'caiu' ? (
              <>
                <dt className="text-secondary-foreground">Sem resposta</dt>
                <dd className="font-semibold">{ha(segundos(c.semRespostaDesde, agora))} · {c.falhasSeguidas} tentativas</dd>
              </>
            ) : (
              <>
                <dt className="text-secondary-foreground">Última resposta</dt>
                <dd className="font-semibold">
                  {ha(segundos(c.respondeuEm, agora))}
                  {c.latenciaMs != null && (c.fase === 'lento' ? ` · demorou ${ms(c.latenciaMs)}` : ` · ${ms(c.latenciaMs)}`)}
                </dd>
              </>
            )}
            <dt className="text-secondary-foreground">Endereço</dt>
            <dd className="break-words font-semibold">
              <span className="font-mono">{endereco}</span>
              {ip && (
                <>
                  {' → '}
                  <span className="font-mono">{ip}</span>
                </>
              )}
            </dd>
            <dt className="text-secondary-foreground">Este PC</dt>
            <dd className="font-semibold">
              {c.terminal ? `terminal ${c.terminal.nome}` : 'sem terminal pareado neste navegador'}
              {c.pc?.ip && <span className="font-mono font-normal text-secondary-foreground"> · {c.pc.ip}</span>}
            </dd>
            {versao && (
              <>
                <dt className="text-secondary-foreground">Servidor</dt>
                <dd className="font-semibold">versão {versao}</dd>
              </>
            )}
          </dl>

          {c.fase === 'lento' && (
            <p className="text-secondary-foreground">
              O app continua funcionando. Se ficar assim, confira o cabo ou o Wi-Fi deste PC e se o servidor está muito ocupado.
            </p>
          )}
          {c.fase === 'caiu' && (
            <div className="rounded-lg bg-destructive/10 p-3 text-destructive">
              <p className="font-semibold">O que fazer</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                <li>Confira se o PC servidor está ligado.</li>
                <li>Clique no ícone do Regem ao lado do relógio, neste PC: a janela diz se ele alcança o servidor.</li>
                <li>Para vender agora, abra o modo nuvem (no aviso amarelo, no topo).</li>
              </ol>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void testar()}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold hover:bg-secondary"
            >
              Testar agora
            </button>
            {gestor && (
              <Link href="/servidor" className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold hover:bg-secondary">
                Ver no Servidor local
              </Link>
            )}
            <span className={`text-xs font-bold ${corTeste}`} aria-live="polite">{teste}</span>
          </div>
        </div>
      )}
    </span>
  );
}
