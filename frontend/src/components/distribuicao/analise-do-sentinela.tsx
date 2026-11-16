'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Gaveta } from '@/components/ui/sobreposto';
import { distApi } from '@/lib/api';
import { toast } from '@/lib/toast';

// A ANÁLISE COM IA DA SEGURANÇA (o Sentinela, parte 2; S2, mig 434; protótipo `mockups/regem-mister-mentor-parte2.html`,
// aprovado em 16/11/2026). Embaixo dos números da Segurança: a Diretoria pede uma rodada, a IA (chave da DMS) lê só os
// metadados e PROPÕE; cada proposta traz o que viu, a proposta, o impacto e como conferir, com "Virou tarefa" e
// "Descartar". Nada age sozinho.

type Nivel = 'critico' | 'atencao' | 'melhoria';
type Proposta = {
  id: string;
  nivel: Nivel;
  titulo: string;
  viu: string;
  proposta: string;
  impacto: string;
  situacao: 'aberta' | 'tarefa' | 'descartada';
  tarefa: string | null;
  decididaPor: string | null;
  decididaEm: string | null;
};
type Analise = {
  id: string;
  situacao: 'rodando' | 'terminou' | 'falhou' | 'interrompida';
  pedidaPor: string | null;
  dias: number;
  eventos: number;
  custoUsd: number | null;
  motivo: string | null;
  iniciadaEm: string;
  terminadaEm: string | null;
};
type Leitura = {
  chaveDaDistribuicao: boolean;
  dias: number;
  estimativaUsd: number | null;
  analise: Analise | null;
  propostas: Proposta[];
  indisponivel?: boolean;
};

const CARTAO = 'rounded-xl border border-slate-800 bg-slate-900/40 p-4';
const BOTAO = 'min-h-10 rounded-lg border border-slate-600 px-3 text-sm font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-60';
const NIVEL: Record<Nivel, { rotulo: string; cor: string }> = {
  critico: { rotulo: 'crítico', cor: 'bg-red-500/15 text-red-300' },
  atencao: { rotulo: 'atenção', cor: 'bg-amber-500/15 text-amber-200' },
  melhoria: { rotulo: 'melhoria', cor: 'bg-sky-500/15 text-sky-200' },
};
const usd = (v: number | null) => (v === null || v === undefined ? '—' : `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às') : '';
const comMaiuscula = (t: string | null) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
const mensagemDe = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);

export function AnaliseDoSentinela() {
  const [d, setD] = useState<Leitura | null>(null);
  const [erro, setErro] = useState('');
  const [pedindo, setPedindo] = useState(false);
  const [tarefaDe, setTarefaDe] = useState<Proposta | null>(null);
  const [tarefa, setTarefa] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const vez = useRef(0);

  // Só a resposta da leitura mais nova vale (V64): o acompanhamento e o toque podem se cruzar.
  const carregar = useCallback(async () => {
    const n = ++vez.current;
    try {
      const r = (await distApi.misterAnalise()) as Leitura;
      if (n === vez.current) {
        setD(r);
        setErro('');
      }
    } catch (e) {
      if (n === vez.current) setErro(mensagemDe(e, 'Não consegui carregar a análise com IA.'));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const rodando = d?.analise?.situacao === 'rodando';
  // Enquanto a rodada está de pé, a tela acompanha a cada 3 s (só com ela aberta).
  useEffect(() => {
    if (!rodando) return;
    const t = setInterval(() => void carregar(), 3_000);
    return () => clearInterval(t);
  }, [rodando, carregar]);

  const analisar = async () => {
    setPedindo(true);
    try {
      await distApi.rodarAnaliseDoMister();
      toast.success('Análise pedida: leva alguns segundos.');
      await carregar();
    } catch (e) {
      toast.error(mensagemDe(e, 'Não consegui pedir a análise.'));
    } finally {
      setPedindo(false);
    }
  };

  const decidir = async (p: Proposta, decisao: 'tarefa' | 'descartada', comTarefa = '') => {
    setOcupado(true);
    try {
      await distApi.decidirPropostaDoSentinela(p.id, decisao, comTarefa.trim());
      toast.success(decisao === 'tarefa' ? 'Marcada como tarefa (fica na auditoria do console).' : 'Proposta descartada (fica na auditoria do console).');
      setTarefaDe(null);
      await carregar();
    } catch (e) {
      toast.error(mensagemDe(e, 'Não consegui salvar a decisão.'));
    } finally {
      setOcupado(false);
    }
  };

  const a = d?.analise ?? null;
  const naoSaiu = a && (a.situacao === 'falhou' || a.situacao === 'interrompida');

  return (
    <div className={CARTAO} aria-labelledby="sentinela-analise" data-analise-do-sentinela>
      <h3 id="sentinela-analise" className="text-sm font-semibold text-slate-100">
        Análise com IA
      </h3>
      <p className="mt-1 max-w-3xl text-xs text-slate-300">
        A IA lê só os metadados dos últimos {d?.dias ?? 7} dias (desfechos, notas do filtro, motivos, contagens por empresa e o final do telefone) — nunca o texto das
        lojas — e só PROPÕE: uma pessoa da Diretoria decide. Ela nunca revoga chave, bloqueia pessoa nem para integração sozinha.
      </p>

      {erro && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-red-300" role="alert">
          <span className="min-w-0 flex-1">{erro}</span>
          <button type="button" className={BOTAO} onClick={() => void carregar()}>
            Tentar de novo
          </button>
        </div>
      )}
      {!d && !erro && <p className="mt-3 text-sm text-slate-400">Carregando…</p>}

      {d && (
        <>
          <p className="mt-3 text-sm text-slate-200">
            Usa a chave da DMS (não a da empresa). Custo estimado: <span className="font-mono">{usd(d.estimativaUsd)}</span> por análise.
            {a ? ` A última foi em ${quando(a.iniciadaEm)}.` : ' Nenhuma análise ainda.'}
          </p>
          {!d.chaveDaDistribuicao && <p className="mt-1 text-sm text-amber-200">A chave de IA da distribuição não está configurada neste servidor.</p>}
          {d.indisponivel && <p className="mt-1 text-sm text-amber-200">A análise ainda não está disponível neste servidor.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="min-h-10 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-slate-950 disabled:opacity-60"
              disabled={!d.chaveDaDistribuicao || !!d.indisponivel || rodando || pedindo}
              onClick={() => void analisar()}
            >
              {rodando || pedindo ? 'Analisando…' : `Analisar os últimos ${d.dias} dias`}
            </button>
            {rodando && (
              <span className="text-sm text-slate-300" role="status">
                Lendo os eventos e pedindo à IA… a tela atualiza sozinha.
              </span>
            )}
          </div>

          {a && a.situacao === 'terminou' && (
            <>
              <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-800 p-3">
                  <dt className="text-xs text-slate-400">Eventos lidos</dt>
                  <dd className="font-mono text-xl text-slate-100">{a.eventos.toLocaleString('pt-BR')}</dd>
                  <dd className="text-xs text-slate-400">{a.dias} dias · só metadados</dd>
                </div>
                <div className="rounded-lg border border-slate-800 p-3">
                  <dt className="text-xs text-slate-400">Propostas</dt>
                  <dd className="font-mono text-xl text-slate-100">{d.propostas.length}</dd>
                  <dd className="text-xs text-slate-400">nenhuma age sozinha</dd>
                </div>
                <div className="rounded-lg border border-slate-800 p-3">
                  <dt className="text-xs text-slate-400">Custo</dt>
                  <dd className="font-mono text-xl text-slate-100">{usd(a.custoUsd)}</dd>
                  <dd className="text-xs text-slate-400">chave da DMS</dd>
                </div>
              </dl>
              {d.propostas.length === 0 ? (
                <p className="mt-3 rounded-lg border border-dashed border-slate-700 p-4 text-center text-sm text-slate-400">A análise não achou nada que pedisse ação neste período.</p>
              ) : (
                <ul className="mt-3 space-y-2" aria-label="As propostas da análise">
                  {d.propostas.map((p) => (
                    <li key={p.id} className="rounded-lg border border-slate-800 p-3 text-sm" data-proposta-sentinela>
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 break-words font-semibold text-slate-100">{p.titulo}</span>
                        <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${NIVEL[p.nivel]?.cor ?? NIVEL.atencao.cor}`}>{NIVEL[p.nivel]?.rotulo ?? p.nivel}</span>
                      </p>
                      <dl className="mt-2 grid gap-2">
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">O que viu</dt>
                          <dd className="break-words text-slate-200">{p.viu}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Proposta</dt>
                          <dd className="break-words text-slate-200">{p.proposta}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Impacto e como conferir</dt>
                          <dd className="break-words text-slate-200">{p.impacto}</dd>
                        </div>
                      </dl>
                      {p.situacao === 'aberta' ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={BOTAO}
                            disabled={ocupado}
                            onClick={() => {
                              setTarefa('');
                              setTarefaDe(p);
                            }}
                          >
                            Virou tarefa
                          </button>
                          <button type="button" className={BOTAO} disabled={ocupado} onClick={() => void decidir(p, 'descartada')}>
                            Descartar
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 break-words text-xs text-slate-400">
                          {p.situacao === 'tarefa' ? `Virou tarefa${p.tarefa ? ` · ${p.tarefa}` : ''}` : 'Descartada'}
                          {p.decididaPor ? ` · ${p.decididaPor}` : ''}
                          {p.decididaEm ? ` · ${quando(p.decididaEm)}` : ''}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {naoSaiu && (
            <div className="mt-3 rounded-lg border border-red-500/40 p-3 text-sm" role="alert">
              <p className="font-semibold text-red-300">A análise não saiu</p>
              <p className="mt-1 break-words text-slate-200">{comMaiuscula(a!.motivo)}. Os números da Segurança acima seguem valendo.</p>
              <button type="button" className={`${BOTAO} mt-2`} disabled={!d.chaveDaDistribuicao || pedindo} onClick={() => void analisar()}>
                Tentar de novo
              </button>
            </div>
          )}
        </>
      )}

      {tarefaDe && (
        <Gaveta
          titulo="Virou tarefa"
          aoFechar={() => setTarefaDe(null)}
          rodape={
            <>
              <button type="button" className="min-h-10 rounded-lg border border-border px-4 font-semibold" onClick={() => setTarefaDe(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="min-h-10 rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-60"
                disabled={ocupado}
                onClick={() => void decidir(tarefaDe, 'tarefa', tarefa)}
              >
                {ocupado ? 'Salvando…' : 'Salvar a decisão'}
              </button>
            </>
          }
        >
          <div className="space-y-3" data-gaveta-sentinela>
            <p className="font-semibold">{tarefaDe.titulo}</p>
            <label className="block text-sm" htmlFor="sentinela-tarefa">
              Link ou código da tarefa (opcional)
            </label>
            <input
              id="sentinela-tarefa"
              className="min-h-10 w-full rounded-md border border-input bg-background px-3"
              value={tarefa}
              onChange={(e) => setTarefa(e.target.value)}
              maxLength={200}
              placeholder="ex.: DMS-412"
            />
          </div>
        </Gaveta>
      )}
    </div>
  );
}
