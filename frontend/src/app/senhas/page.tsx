'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { connectAsTela, type Socket } from '@/lib/rt';
import {
  TEMA_TV,
  aindaNaTela,
  desvioDoRelogio,
  esquecerCredencial,
  guardarCredencial,
  lerCredencial,
  novasProntas,
  tamanhosValidos,
  type CredencialTv,
  type QuadroTv,
  type SenhaProntaTv,
} from '@/lib/tela-senhas';
import { QuadroSenhas } from '@/components/senhas/quadro-senhas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TELA DE SENHAS — a TV do balcão (Cozinha em estações, entrega 4; mockups/regem-kds-estacoes.html, aba "Tela de
// senhas"). Sem login: pareada por código, como os outros equipamentos (Configurações › Equipamentos › Tela de senhas).
// Mostra só números (LGPD). Lê o quadro quando o servidor avisa ("senhas:mudou", sala só dela) e a cada 30 s; a senha
// sai de Pronto na hora que o servidor mandou (relógio acertado pelo dele). Senha nova em Pronto: destaque e um aviso
// curto, se a loja ligou o aviso — o navegador pode pausar o som até alguém tocar na tela; a TV diz isso no pé.

const LEITURA_DE_SEGURANCA_MS = 30_000;
const DESTAQUE_MS = 10_000;

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'parear'; motivo?: string }
  | { tipo: 'quadro' }
  | { tipo: 'desligado'; motivo: string };

function hhmm(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function SenhasPage() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });
  const [quadro, setQuadro] = useState<QuadroTv | null>(null);
  const [novas, setNovas] = useState<Set<string>>(new Set());
  const [semConexao, setSemConexao] = useState(false);
  const [somPausado, setSomPausado] = useState(false);
  const [agora, setAgora] = useState<number | null>(null); // só depois de montar (V35: nada de hora no 1º render)
  const cred = useRef<CredencialTv | null>(null);
  const desvio = useRef(0);
  const prontoAntes = useRef<SenhaProntaTv[] | null>(null);
  const seq = useRef(0);
  const audio = useRef<AudioContext | null>(null);
  const somLigado = useRef(true);

  // O áudio nasce no primeiro toque (o navegador só deixa tocar depois de um gesto) e fica pronto para os avisos.
  const liberarSom = useCallback(() => {
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      audio.current ??= new AC();
      void audio.current?.resume().then(() => setSomPausado(audio.current?.state !== 'running')).catch(() => {});
    } catch {
      /* sem áudio */
    }
  }, []);

  const tocar = useCallback(() => {
    if (!somLigado.current) return;
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      audio.current ??= new AC();
      const ctx = audio.current!;
      // Duas notas curtas ("plim-plom"), baixas o bastante para um balcão.
      const notas = () => {
        [880, 660].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const t0 = ctx.currentTime + i * 0.28;
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, t0);
          gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.26);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + 0.28);
        });
        setSomPausado(false);
      };
      if (ctx.state === 'running') return notas();
      // Pausado pelo navegador (ninguém tocou na tela ainda): tenta retomar; sem gesto, ele recusa e a TV avisa no pé.
      void ctx
        .resume()
        .then(() => (ctx.state === 'running' ? notas() : setSomPausado(true)))
        .catch(() => setSomPausado(true));
    } catch {
      /* sem áudio */
    }
  }, []);

  const ler = useCallback(async () => {
    const c = cred.current;
    if (!c) return;
    const minha = ++seq.current;
    try {
      const recebido = Date.now();
      const r = (await api.quadroDaTelaSenhas(c.id, c.segredo)) as QuadroTv;
      if (minha !== seq.current) return; // uma leitura mais nova já saiu (V64)
      desvio.current = desvioDoRelogio(r.agora, recebido);
      const q: QuadroTv = { ...r, ajustes: { ...r.ajustes, tamanhos: tamanhosValidos(r.ajustes?.tamanhos) } };
      somLigado.current = q.ajustes.som !== false;
      const chamam = novasProntas(prontoAntes.current, q.pronto);
      prontoAntes.current = q.pronto;
      if (chamam.length) {
        setNovas((antes) => new Set([...antes, ...chamam]));
        setTimeout(() => setNovas((antes) => new Set([...antes].filter((id) => !chamam.includes(id)))), DESTAQUE_MS);
        tocar();
      }
      setQuadro(q);
      setSemConexao(false);
      setEstado({ tipo: 'quadro' });
    } catch (e) {
      if (minha !== seq.current) return;
      const status = e instanceof ApiError ? e.status : 0;
      if (status === 401) {
        esquecerCredencial();
        cred.current = null;
        prontoAntes.current = null;
        setQuadro(null);
        setEstado({ tipo: 'parear', motivo: 'Esta TV foi desconectada no Regem. Gere um código novo em Configurações › Equipamentos.' });
      } else if (status === 403) {
        setEstado({ tipo: 'desligado', motivo: e instanceof Error ? e.message : 'A tela de senhas está desligada nesta loja.' });
      } else {
        // Sem conexão (ou o servidor fora): fica a última lista, com o aviso no pé; a próxima leitura tenta de novo.
        setSemConexao(true);
        setEstado((atual) => (atual.tipo === 'carregando' ? { tipo: 'parear', motivo: 'Não consegui falar com o Regem. Confira a rede e tente de novo.' } : atual));
      }
    }
  }, [tocar]);

  // Liga: credencial guardada → lê; sem ela → pede o código.
  useEffect(() => {
    setAgora(Date.now());
    cred.current = lerCredencial();
    if (cred.current) void ler();
    else setEstado({ tipo: 'parear' });
  }, [ler]);

  // Tempo real (sala só da TV) + leitura de segurança; avisos em sequência viram uma leitura só.
  const pareada = estado.tipo === 'quadro' || estado.tipo === 'desligado';
  useEffect(() => {
    const c = cred.current;
    if (!pareada || !c) return;
    let sock: Socket | null = null;
    let espera: ReturnType<typeof setTimeout> | null = null;
    const pedir = () => {
      if (espera) return;
      espera = setTimeout(() => {
        espera = null;
        void ler();
      }, 800);
    };
    try {
      sock = connectAsTela(c.id, c.segredo);
      sock.on('senhas:mudou', pedir);
      sock.on('connect', pedir);
    } catch {
      /* sem tempo real: a leitura de segurança segue */
    }
    const t = setInterval(() => void ler(), LEITURA_DE_SEGURANCA_MS);
    const aoVoltar = () => document.visibilityState === 'visible' && pedir();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      clearInterval(t);
      if (espera) clearTimeout(espera);
      document.removeEventListener('visibilitychange', aoVoltar);
      sock?.disconnect();
    };
  }, [pareada, ler]);

  // O relógio e a saída das senhas de Pronto (pela hora do servidor), a cada segundo.
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Tela sempre acesa (TV/tablet): pede ao navegador; se ele não deixar, segue.
  useEffect(() => {
    let trava: any = null;
    const pedir = async () => {
      try {
        trava = await (navigator as any).wakeLock?.request('screen');
      } catch {
        /* sem trava de tela */
      }
    };
    void pedir();
    const aoVoltar = () => document.visibilityState === 'visible' && void pedir();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar);
      void trava?.release?.().catch(() => {});
    };
  }, []);

  // Qualquer toque ou tecla (o OK do controle) libera o som.
  useEffect(() => {
    const liberar = () => liberarSom();
    window.addEventListener('pointerdown', liberar);
    window.addEventListener('keydown', liberar);
    return () => {
      window.removeEventListener('pointerdown', liberar);
      window.removeEventListener('keydown', liberar);
    };
  }, [liberarSom]);

  async function parear(codigo: string): Promise<string | null> {
    liberarSom();
    try {
      const r: any = await api.parearTelaSenhas(codigo);
      const c = { id: String(r.terminalId), segredo: String(r.segredo), nome: r.nome ? String(r.nome) : undefined };
      guardarCredencial(c);
      cred.current = c;
      prontoAntes.current = null;
      setEstado({ tipo: 'carregando' });
      await ler();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Não consegui parear. Tente de novo.';
    }
  }

  const base = { minHeight: '100dvh', background: TEMA_TV.fundo, color: TEMA_TV.tinta } as const;

  if (estado.tipo === 'carregando')
    return (
      <main style={base} className="grid place-items-center p-6">
        <p role="status" style={{ color: TEMA_TV.fraco }}>Abrindo a tela de senhas…</p>
      </main>
    );

  if (estado.tipo === 'parear') return <Pareamento base={base} motivo={estado.motivo} aoParear={parear} />;

  if (estado.tipo === 'desligado' || !quadro)
    return (
      <main style={base} className="grid place-items-center p-6 text-center">
        <div className="max-w-xl space-y-3">
          <h1 className="font-display text-2xl font-bold">Tela de senhas</h1>
          <p role="status" style={{ color: TEMA_TV.fraco }}>
            {estado.tipo === 'desligado' ? estado.motivo : 'Carregando as senhas…'}
          </p>
        </div>
      </main>
    );

  const agoraLocal = agora ?? Date.now();
  const pronto = quadro.pronto.filter((s) => aindaNaTela(s, agoraLocal, desvio.current));
  const aviso = semConexao
    ? 'Sem conexão com o Regem — tentando de novo'
    : somPausado && quadro.ajustes.som
      ? 'Som pausado pelo navegador: toque na tela ou aperte OK no controle'
      : undefined;
  return (
    <main style={{ ...base, height: '100dvh' }} className="flex">
      <QuadroSenhas
        loja={quadro.loja}
        tamanhos={quadro.ajustes.tamanhos}
        preparando={quadro.preparando}
        pronto={pronto}
        novas={novas}
        hora={agora == null ? '' : hhmm(agoraLocal + desvio.current)}
        aviso={aviso}
      />
    </main>
  );
}

/** Primeira vez (ou TV desconectada): o código de 6 dígitos gerado em Configurações › Equipamentos. */
function Pareamento({ base, motivo, aoParear }: {
  base: Record<string, string>;
  motivo?: string;
  aoParear: (codigo: string) => Promise<string | null>;
}) {
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const limpo = codigo.replace(/\D/g, '').slice(0, 6);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (limpo.length !== 6 || enviando) return;
    setEnviando(true);
    setErro('');
    const falha = await aoParear(limpo);
    setEnviando(false);
    if (falha) setErro(falha);
  }
  return (
    <main style={base} className="grid place-items-center p-6">
      <form onSubmit={(e) => void enviar(e)} className="w-full max-w-md space-y-4 text-center">
        <h1 className="font-display text-3xl font-bold">Parear esta TV</h1>
        <p style={{ color: TEMA_TV.fraco }}>
          No Regem, em <strong style={{ color: TEMA_TV.tinta }}>Configurações › Equipamentos</strong>, cadastre uma{' '}
          <strong style={{ color: TEMA_TV.tinta }}>Tela de senhas (TV)</strong> e digite aqui o código de 6 dígitos que aparece.
        </p>
        {motivo && (
          <p role="status" className="rounded-md px-3 py-2 text-sm" style={{ background: TEMA_TV.chip }}>
            {motivo}
          </p>
        )}
        <label htmlFor="codigo-tv" className="sr-only">Código de pareamento</label>
        <input
          id="codigo-tv"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={7}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="000 000"
          className="w-full rounded-lg border-2 px-4 py-3 text-center font-mono text-4xl tracking-[0.3em] focus:outline-none focus-visible:ring-4"
          style={{ borderColor: TEMA_TV.linha, color: TEMA_TV.tinta, background: TEMA_TV.fundo }}
        />
        {erro && (
          <p role="alert" className="font-medium" style={{ color: TEMA_TV.erro }}>
            {erro}
          </p>
        )}
        <button
          type="submit"
          disabled={limpo.length !== 6 || enviando}
          className="w-full rounded-lg px-4 py-3 text-lg font-bold disabled:opacity-50"
          style={{ background: TEMA_TV.acao, color: TEMA_TV.sobreAcao }}
        >
          {enviando ? 'Pareando…' : 'Parear esta TV'}
        </button>
      </form>
    </main>
  );
}
