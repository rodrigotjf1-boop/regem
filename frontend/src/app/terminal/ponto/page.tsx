'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  clearToken,
  setToken,
} from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */
const CFG_KEY = 'regen_terminal';

const PUNCH = [
  { tipo: 'entrada', label: 'ENTRADA', sub: 'Início da jornada', primary: true },
  { tipo: 'intervalo_inicio', label: 'INTERVALO', sub: 'Pausa para refeição' },
  { tipo: 'intervalo_fim', label: 'RETORNO', sub: 'Fim do intervalo' },
  { tipo: 'saida', label: 'SAÍDA', sub: 'Fim da jornada' },
];
const TIPO_NOME: Record<string, string> = {
  entrada: 'ENTRADA',
  saida: 'SAÍDA',
  intervalo_inicio: 'INÍCIO DE INTERVALO',
  intervalo_fim: 'FIM DE INTERVALO',
};
const TIPO_CURTO: Record<string, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  intervalo_inicio: 'Intervalo',
  intervalo_fim: 'Retorno',
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function iniciais(nome: string) {
  return nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
}

export default function TerminalPontoPage() {
  const [cfg, setCfg] = useState<{ unidadeId: string; unidadeNome: string } | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(new Date());
  const [online, setOnline] = useState(true);

  const [step, setStep] = useState<'pin' | 'emp' | 'receipt'>('pin');
  const [pin, setPin] = useState('');
  const [colab, setColab] = useState<any>(null);
  const [comp, setComp] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [recentes, setRecentes] = useState<any[]>([]);
  const [countdown, setCountdown] = useState(6);
  const cdRef = useRef<any>(null);

  // pareamento
  const [pEmail, setPEmail] = useState('');
  const [pSenha, setPSenha] = useState('');
  const [pUnidades, setPUnidades] = useState<any[] | null>(null);
  const [pErro, setPErro] = useState('');
  const [pBusy, setPBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) setCfg(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    setReady(true);
    clearToken(); // terminal não mantém sessão de usuário
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    upd();
    window.addEventListener('online', upd);
    window.addEventListener('offline', upd);
    return () => {
      window.removeEventListener('online', upd);
      window.removeEventListener('offline', upd);
    };
  }, []);

  const voltarPin = useCallback(() => {
    if (cdRef.current) clearInterval(cdRef.current);
    clearToken();
    setStep('pin');
    setPin('');
    setColab(null);
    setComp(null);
    setErro('');
  }, []);

  // ---- pareamento ----
  async function parearLogin(e: React.FormEvent) {
    e.preventDefault();
    setPErro('');
    setPBusy(true);
    try {
      const res: any = await api.login(pEmail, pSenha);
      setToken(res.access_token);
      const cat = res.user?.categoria;
      if (cat !== 'presidente' && cat !== 'gerente') {
        clearToken();
        throw new Error('Apenas presidente/gerente pode parear o terminal.');
      }
      setPUnidades(await api.unidades());
    } catch (err) {
      setPErro(err instanceof Error ? err.message : 'Falha no login');
    } finally {
      setPBusy(false);
    }
  }
  function escolherUnidade(u: any) {
    const c = { unidadeId: u.id, unidadeNome: u.nome };
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
    clearToken();
    setCfg(c);
    setPUnidades(null);
    setPEmail('');
    setPSenha('');
  }
  function desparear() {
    localStorage.removeItem(CFG_KEY);
    clearToken();
    setCfg(null);
  }

  // ---- PIN → identificação ----
  function key(d: string) {
    setErro('');
    setPin((p) => (p.length >= 6 ? p : p + d));
  }
  async function confirmarPin() {
    if (pin.length < 4) {
      setErro('PIN de 4 a 6 dígitos.');
      return;
    }
    try {
      const res: any = await api.pinLogin(cfg!.unidadeId, pin);
      setToken(res.access_token);
      setColab({
        nome: res.nome ?? 'Colaborador',
        matricula: res.matricula,
        colaboradorId: res.user?.colaboradorId,
      });
      setStep('emp');
      setPin('');
    } catch {
      setErro('PIN inválido.');
      setPin('');
    }
  }

  // ---- marcação ----
  async function marcar(tipo: string) {
    setErro('');
    try {
      const c: any = await api.marcarPonto({ tipo, origem: 'terminal' });
      setComp(c);
      setRecentes((r) =>
        [
          { nome: c.colaboradorNome, tipo, marcadoEm: c.marcadoEm },
          ...r,
        ].slice(0, 8),
      );
      clearToken();
      setStep('receipt');
      setCountdown(6);
      cdRef.current = setInterval(() => {
        setCountdown((s) => {
          if (s <= 1) {
            voltarPin();
            return 6;
          }
          return s - 1;
        });
      }, 1000);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao marcar');
    }
  }

  const bg = '#0F2230';
  if (!ready)
    return <div style={{ background: bg }} className="min-h-dvh" />;

  // ===== PAREAMENTO =====
  if (!cfg) {
    return (
      <div
        style={{ background: bg }}
        className="grid min-h-dvh place-items-center p-6 text-[#EAF2F7]"
      >
        <div className="w-full max-w-sm rounded-2xl border border-[#2A495C] bg-[#16303F] p-6">
          <div className="mb-4 flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-[#E2A340] font-extrabold text-[#E2A340]">
              R
            </div>
            <div>
              <p className="font-bold">
                REGEM <span className="text-[#E2A340]">PONTO</span>
              </p>
              <p className="text-[10px] uppercase tracking-[.14em] text-[#8FAABB]">
                Parear terminal
              </p>
            </div>
          </div>

          {!pUnidades ? (
            <form onSubmit={parearLogin} className="space-y-3">
              <p className="text-sm text-[#8FAABB]">
                Um gestor faz login uma vez para vincular este dispositivo a uma
                unidade.
              </p>
              <input
                type="email"
                placeholder="E-mail do gestor"
                value={pEmail}
                onChange={(e) => setPEmail(e.target.value)}
                required
                className="w-full rounded-lg border border-[#2A495C] bg-[#1D3B4D] px-3 py-2.5 text-sm outline-none focus:border-[#4AA8E0]"
              />
              <input
                type="password"
                placeholder="Senha"
                value={pSenha}
                onChange={(e) => setPSenha(e.target.value)}
                required
                className="w-full rounded-lg border border-[#2A495C] bg-[#1D3B4D] px-3 py-2.5 text-sm outline-none focus:border-[#4AA8E0]"
              />
              {pErro && <p className="text-sm text-[#FF5A4E]">{pErro}</p>}
              <button
                type="submit"
                disabled={pBusy}
                className="w-full rounded-lg bg-[#E2A340] py-2.5 font-bold text-[#0F2230] disabled:opacity-60"
              >
                {pBusy ? 'Entrando…' : 'Continuar'}
              </button>
            </form>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-[#8FAABB]">Escolha a unidade deste terminal:</p>
              {pUnidades.length === 0 && (
                <p className="text-sm text-[#FFB13D]">
                  Nenhuma unidade cadastrada.
                </p>
              )}
              {pUnidades.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => escolherUnidade(u)}
                  className="w-full rounded-lg border border-[#2A495C] bg-[#1D3B4D] px-3 py-2.5 text-left text-sm hover:border-[#4AA8E0]"
                >
                  {u.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== TERMINAL =====
  return (
    <div
      style={{ background: bg }}
      className="flex min-h-dvh flex-col text-[#EAF2F7]"
    >
      <header className="flex items-center gap-3 border-b border-[#2A495C] px-6 py-3.5">
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-[#E2A340] font-extrabold text-[#E2A340]">
          R
        </div>
        <div>
          <p className="font-bold leading-tight">
            REGEM <span className="text-[#E2A340]">PONTO</span>
          </p>
          <p className="text-[10px] uppercase tracking-[.12em] text-[#8FAABB]">
            {cfg.unidadeNome}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span
            className="flex items-center gap-2 rounded-lg border border-[#2A495C] bg-[#16303F] px-3 py-1.5 text-xs font-semibold"
            style={{ color: online ? '#19C08F' : '#FFB13D' }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: online ? '#19C08F' : '#FFB13D' }}
            />
            {online ? 'Online' : 'Offline'}
          </span>
          <button
            type="button"
            onClick={desparear}
            className="rounded-lg border border-[#2A495C] px-2.5 py-1.5 text-xs text-[#8FAABB] hover:text-[#EAF2F7]"
          >
            Desparear
          </button>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1100px] flex-1 grid-cols-1 md:grid-cols-[1fr_360px]">
        <main className="flex flex-col items-center justify-center px-6 py-8 text-center">
          <div className="font-mono text-6xl font-bold leading-none sm:text-7xl">
            {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}
          </div>
          <p className="mb-6 mt-2 capitalize text-[#8FAABB]">
            {now.toLocaleDateString('pt-BR', {
              weekday: 'long',
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
          </p>

          {step === 'pin' && (
            <div>
              <div className="mb-5 flex justify-center gap-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span
                    key={i}
                    className="h-3.5 w-3.5 rounded-full border-2"
                    style={{
                      borderColor: i < pin.length ? '#19C08F' : '#8FAABB',
                      background: i < pin.length ? '#19C08F' : 'transparent',
                    }}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => key(n)}
                    className="h-16 w-20 rounded-2xl border border-[#2A495C] bg-[#16303F] font-mono text-2xl font-bold hover:bg-[#1D3B4D] active:scale-95"
                  >
                    {n}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setPin((p) => p.slice(0, -1))}
                  className="h-16 w-20 rounded-2xl border border-[#2A495C] bg-[#16303F] text-xl hover:bg-[#1D3B4D]"
                >
                  ⌫
                </button>
                <button
                  type="button"
                  onClick={() => key('0')}
                  className="h-16 w-20 rounded-2xl border border-[#2A495C] bg-[#16303F] font-mono text-2xl font-bold hover:bg-[#1D3B4D] active:scale-95"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={confirmarPin}
                  className="h-16 w-20 rounded-2xl bg-[#19C08F] font-display font-bold text-[#04241A] active:scale-95"
                >
                  OK
                </button>
              </div>
              {erro && <p className="mt-4 text-sm text-[#FF5A4E]">{erro}</p>}
              <p className="mt-4 text-xs text-[#8FAABB]">
                Digite seu PIN (4 a 6 dígitos)
              </p>
            </div>
          )}

          {step === 'emp' && colab && (
            <div className="flex flex-col items-center gap-2">
              <div className="grid h-24 w-24 place-items-center rounded-full border-4 border-[#19C08F] bg-gradient-to-br from-[#2C6E9B] to-[#4AA8E0] font-display text-3xl font-extrabold">
                {iniciais(colab.nome)}
              </div>
              <p className="font-display text-2xl font-extrabold">{colab.nome}</p>
              {colab.matricula && (
                <p className="text-sm text-[#8FAABB]">
                  Matrícula {colab.matricula}
                </p>
              )}
              <div className="mt-4 grid w-full max-w-md grid-cols-2 gap-3">
                {PUNCH.map((b) => (
                  <button
                    key={b.tipo}
                    type="button"
                    onClick={() => marcar(b.tipo)}
                    className="rounded-2xl border border-[#2A495C] px-3 py-5 font-display font-extrabold tracking-wide active:scale-95"
                    style={
                      b.primary
                        ? { background: '#19C08F', color: '#04241A' }
                        : { background: '#16303F' }
                    }
                  >
                    {b.label}
                    <span
                      className="mt-1 block text-[11px] font-medium"
                      style={{ color: b.primary ? '#04553D' : '#8FAABB' }}
                    >
                      {b.sub}
                    </span>
                  </button>
                ))}
              </div>
              {erro && <p className="mt-3 text-sm text-[#FF5A4E]">{erro}</p>}
              <button
                type="button"
                onClick={voltarPin}
                className="mt-4 text-sm text-[#8FAABB] underline"
              >
                Não sou eu · voltar
              </button>
            </div>
          )}

          {step === 'receipt' && comp && (
            <div className="flex flex-col items-center">
              <div className="mb-4 grid h-20 w-20 place-items-center rounded-full bg-[#19C08F] text-4xl text-[#04241A]">
                ✓
              </div>
              <div className="w-full max-w-sm rounded-2xl bg-[#F7F9FA] p-5 text-left text-[#0F2230] shadow-2xl">
                <p className="border-b border-dashed border-[#B9C6CE] pb-2 text-center font-display font-extrabold tracking-wide">
                  COMPROVANTE DE MARCAÇÃO
                </p>
                {[
                  ['Colaborador', comp.colaboradorNome],
                  ['Tipo', TIPO_NOME[comp.tipo] ?? comp.tipo],
                  [
                    'Data / Hora',
                    new Date(comp.marcadoEm).toLocaleString('pt-BR'),
                  ],
                  ['NSR', String(comp.nsr).padStart(9, '0')],
                  ['Terminal', cfg.unidadeNome],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1 text-sm">
                    <span className="text-[#5E7482]">{k}</span>
                    <span className="font-mono text-xs font-bold">{v}</span>
                  </div>
                ))}
                <p className="mt-2 truncate border-t border-dashed border-[#B9C6CE] pt-2 text-center font-mono text-[10px] text-[#5E7482]">
                  hash {comp.hash}
                </p>
              </div>
              <p className="mt-4 text-sm text-[#8FAABB]">
                Voltando ao início em {countdown}…
              </p>
            </div>
          )}
        </main>

        <aside className="border-t border-[#2A495C] p-6 md:border-l md:border-t-0">
          <p className="mb-3 font-display text-[11px] font-bold uppercase tracking-[.14em] text-[#8FAABB]">
            Últimas marcações neste terminal
          </p>
          {recentes.length === 0 ? (
            <p className="text-sm text-[#8FAABB]">Nenhuma ainda nesta sessão.</p>
          ) : (
            <div className="space-y-1">
              {recentes.map((m, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-[#2A495C] py-2 last:border-0"
                >
                  <div className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[#0E7C66] text-[11px] font-bold">
                    {iniciais(m.nome ?? '?')}
                  </div>
                  <p className="flex-1 truncate text-sm font-semibold">
                    {m.nome}
                  </p>
                  <div className="text-right">
                    <p className="font-mono text-sm font-bold">
                      {pad(new Date(m.marcadoEm).getHours())}:
                      {pad(new Date(m.marcadoEm).getMinutes())}
                    </p>
                    <p className="text-[10px] uppercase text-[#19C08F]">
                      {TIPO_CURTO[m.tipo] ?? m.tipo}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {!online && (
            <p className="mt-4 rounded-lg border border-[#FFB13D]/40 bg-[#FFB13D]/10 p-3 text-xs text-[#FFB13D]">
              ⚠️ Sem conexão — reconecte para registrar marcações.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
