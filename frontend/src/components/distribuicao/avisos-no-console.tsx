'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { distApi } from '@/lib/api';

// Console da distribuição → aba "Avisos" (F1.4 parte B, protótipo `mockups/regem-avisos-na-tela.html` aprovado em
// 14/11/2026; Diretoria e Técnico). Os avisos com o destino "Suporte da DMS" de todas as empresas: o servidor da loja
// sem sinal com pedido esperando e os problemas técnicos (serviço parado, disco cheio, cópia de segurança atrasada). Só a
// empresa, a loja e o aviso — o servidor nem manda cliente, conversa, valor ou telefone.

type Aviso = { id: string; empresa: string; loja: string | null; aviso: string; situacao: 'aberto' | 'resolvido'; escalado: boolean; abertoEm: string; resolvidoEm: string | null };
type Lista = { contagens: { abertos: number; resolvidos: number }; limite: number; avisos: Aviso[] };
type Situacao = 'abertos' | 'resolvidos';

const BOTAO = 'inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-lg px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40';
const NEUTRO = `${BOTAO} border border-slate-600 text-slate-100 hover:bg-slate-800`;
const CARTAO = 'rounded-xl border border-slate-800 bg-slate-900/40 p-4';

/** "há 4 min", "há 2 h 16 min", "há 30 h". */
function ha(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h >= 24 ? `há ${h} h` : `há ${h} h ${String(min % 60).padStart(2, '0')} min`;
}
const hora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function Selo({ tom, children }: { tom: 'crit' | 'warn' | 'ok'; children: React.ReactNode }) {
  const cor = tom === 'crit' ? 'border-red-500/50 bg-red-500/10 text-red-200' : tom === 'warn' ? 'border-amber-500/50 bg-amber-500/10 text-amber-100' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cor}`}>{children}</span>;
}

export function AvisosNoConsole() {
  const idBusca = useId();
  const [situacao, setSituacao] = useState<Situacao>('abertos');
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<Lista | null>(null);
  const [erro, setErro] = useState('');
  // Só a resposta da leitura mais nova vale (a busca e as situações disparam várias).
  const leitura = useRef(0);

  const carregar = useCallback(async (s: Situacao, termo: string) => {
    const vez = ++leitura.current;
    setErro('');
    try {
      const l = (await distApi.misterAvisos(s, termo)) as Lista;
      if (vez === leitura.current) setLista(l);
    } catch (e) {
      if (vez === leitura.current) setErro(e instanceof Error ? e.message : 'Não consegui carregar os avisos.');
    }
  }, []);

  // A busca vai ao servidor um instante depois de parar de digitar; a situação, na hora.
  useEffect(() => {
    const t = setTimeout(() => void carregar(situacao, busca.trim()), busca ? 350 : 0);
    return () => clearTimeout(t);
  }, [situacao, busca, carregar]);

  return (
    <section className="space-y-3" aria-labelledby="avisos-suporte">
      <div>
        <h2 id="avisos-suporte" className="text-sm font-semibold text-slate-100">
          Avisos para o suporte
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-300">
          Os avisos com o destino &quot;Suporte da DMS&quot;, de todas as empresas: o servidor da loja sem sinal com pedido esperando e os problemas técnicos (serviço parado, disco cheio, cópia de segurança atrasada). Mostra a empresa, a loja e o aviso — nada de cliente, conversa ou valor.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Situação">
        {(
          [
            ['abertos', 'Abertos', lista?.contagens.abertos],
            ['resolvidos', 'Resolvidos nas últimas 24 h', lista?.contagens.resolvidos],
          ] as const
        ).map(([valor, rotulo, n]) => (
          <button
            key={valor}
            type="button"
            aria-pressed={situacao === valor}
            onClick={() => setSituacao(valor)}
            className={`min-h-10 rounded-full border px-3 text-sm font-semibold ${situacao === valor ? 'border-amber-500 bg-amber-500 text-slate-950' : 'border-slate-600 text-slate-300 hover:bg-slate-800'}`}
          >
            {rotulo}
            {typeof n === 'number' && <span className="ml-1.5 font-mono">{n}</span>}
          </button>
        ))}
      </div>
      <div>
        <label htmlFor={idBusca} className="sr-only">
          Buscar empresa
        </label>
        <input
          id={idBusca}
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar empresa"
          className="min-h-10 w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100 placeholder:text-slate-500"
        />
      </div>
      {erro && (
        <div className={CARTAO} role="alert">
          <p className="text-sm text-red-300">{erro}</p>
          <button type="button" className={`${NEUTRO} mt-3`} onClick={() => void carregar(situacao, busca.trim())}>
            Tentar de novo
          </button>
        </div>
      )}
      {!erro && !lista && <p className="text-sm text-slate-400">Carregando…</p>}
      {!erro && lista && lista.avisos.length === 0 && (
        <p className={`${CARTAO} text-center text-sm text-slate-300`}>
          {busca.trim() ? 'Nenhuma empresa com esse nome.' : situacao === 'abertos' ? '✅ Nenhum aviso aberto para o suporte agora.' : 'Nenhum aviso resolvido nas últimas 24 horas.'}
        </p>
      )}
      {!erro && lista && lista.avisos.length > 0 && (
        <>
          {/* Largo: tabela. Estreito: um cartão por aviso — nada rola para o lado (V45). */}
          <table className="hidden w-full text-left text-sm lg:table">
            <caption className="sr-only">Avisos para o suporte, por empresa e loja</caption>
            <thead className="text-xs text-slate-400">
              <tr className="border-b border-slate-800">
                <th className="py-2 pr-3 font-medium">Empresa</th>
                <th className="px-3 py-2 font-medium">Loja</th>
                <th className="px-3 py-2 font-medium">Aviso</th>
                <th className="px-3 py-2 font-medium">Abriu</th>
                <th className="py-2 pl-3 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.avisos.map((a) => (
                <tr key={a.id} className="border-b border-slate-800/70 align-top">
                  <td className="break-words py-2.5 pr-3 font-semibold text-slate-100">{a.empresa}</td>
                  <td className="px-3 py-2.5 text-slate-200">{a.loja ?? '—'}</td>
                  <td className="break-words px-3 py-2.5 text-slate-100">{a.aviso}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-slate-200">{hora(a.abertoEm)}</td>
                  <td className="py-2.5 pl-3">
                    <SituacaoDoAviso a={a} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="space-y-2 lg:hidden">
            {lista.avisos.map((a) => (
              <li key={a.id} className={`${CARTAO} space-y-1.5`}>
                <p className="break-words text-sm font-semibold text-slate-100">{a.empresa}</p>
                <p className="text-xs text-slate-400">{a.loja ?? 'sem loja'}</p>
                <p className="break-words text-sm text-slate-100">{a.aviso}</p>
                <p className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  <span className="font-mono">{hora(a.abertoEm)}</span>
                  <SituacaoDoAviso a={a} />
                </p>
              </li>
            ))}
          </ul>
          {(situacao === 'abertos' ? lista.contagens.abertos : lista.contagens.resolvidos) > lista.avisos.length && (
            <p className="text-xs text-slate-300" role="status">
              Mostrando {lista.avisos.length} avisos. Use a busca para achar os outros.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function SituacaoDoAviso({ a }: { a: Aviso }) {
  if (a.situacao === 'resolvido') return <Selo tom="ok">resolvido{a.resolvidoEm ? ` às ${new Date(a.resolvidoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</Selo>;
  return <Selo tom={a.escalado ? 'warn' : 'crit'}>aberto {ha(a.abertoEm)}{a.escalado ? ' · escalou' : ''}</Selo>;
}
