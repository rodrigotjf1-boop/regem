'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { distApi } from '@/lib/api';
import { Gaveta } from '@/components/ui/sobreposto';

// A AVALIAÇÃO DE REGRESSÃO DO MISTER no console (F5.3; mig 424; protótipo mockups/regem-dependencias-e-qualidade.html,
// cartão "Avaliação de regressão"). As perguntas fixas numa loja de teste com dados inventados, com a chave da DMS, cada
// uma conferida por regra (a consulta, os números, nada inventado, nada fora do que a pessoa pode ver). Rodar gasta a
// chave da DMS: só pelo botão. Enquanto uma rodada anda, o cartão relê o andamento a cada 4 s (a ação que a pessoa
// começou); parada, não relê.

type Rodada = {
  id: string;
  situacao: 'rodando' | 'terminou' | 'falhou' | 'interrompida';
  iniciadaEm: string;
  terminadaEm: string | null;
  pedidaPor: string | null;
  versao: string;
  consultas: number;
  modelo: string;
  total: number;
  feitas: number;
  acertos: number;
  motivo: string | null;
  custoUsd: number | null;
  oQueFalhou?: { pergunta: string; falha: string | null }[];
  falhas?: number;
};
type Lista = {
  disponivel: boolean;
  versaoAtual: { versao: string; consultas: number };
  total: number;
  chaveDaDistribuicao: boolean;
  modelo: string;
  rodadas: Rodada[];
};
type Caso = { id: string; pergunta: string; ok: boolean; falhas: string[]; consultas: string[]; ms: number };

const CARTAO = 'rounded-xl border border-slate-800 bg-slate-900/40 p-4';
const BOTAO = 'min-h-10 rounded-md border border-slate-600 px-3 text-sm font-semibold text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50';
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const usd = (v: number) => `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: v < 0.1 ? 4 : 2 })}`;
const ESTIMATIVA_USD = 0.05;

function Selo({ r }: { r: Rodada }) {
  const [texto, cor] =
    r.situacao === 'rodando'
      ? [`rodando · ${r.feitas} de ${r.total}`, 'bg-amber-500/15 text-amber-200']
      : r.situacao === 'terminou'
        ? [`${r.acertos} de ${r.total}`, r.acertos === r.total ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-200']
        : r.situacao === 'falhou'
          ? ['não terminou', 'bg-red-500/15 text-red-300']
          : ['interrompida', 'bg-slate-500/15 text-slate-300'];
  return <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${cor}`}>{texto}</span>;
}

export function AvaliacaoDoMister() {
  const [lista, setLista] = useState<Lista | null>(null);
  const [erro, setErro] = useState('');
  const [pedindo, setPedindo] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [aberta, setAberta] = useState<Rodada | null>(null);
  const leitura = useRef(0);

  const carregar = useCallback(async () => {
    const vez = ++leitura.current;
    try {
      const r = (await distApi.misterAvaliacoes()) as Lista;
      if (vez === leitura.current) {
        setLista(r);
        setErro('');
      }
    } catch (e) {
      if (vez === leitura.current) setErro(e instanceof Error ? e.message : 'Não consegui carregar as avaliações.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const emCurso = lista?.rodadas.find((r) => r.situacao === 'rodando') ?? null;
  useEffect(() => {
    if (!emCurso) return;
    const t = setTimeout(() => void carregar(), 4000);
    return () => clearTimeout(t);
  }, [emCurso, lista, carregar]);

  async function rodar() {
    setPedindo(true);
    setAviso(null);
    try {
      const r = (await distApi.rodarAvaliacaoDoMister()) as { total: number };
      setAviso({ ok: true, texto: `A avaliação começou: ${r.total} perguntas. O andamento aparece aqui.` });
      await carregar();
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : 'Não consegui começar a avaliação.' });
    } finally {
      setPedindo(false);
    }
  }

  const ultimaTerminada = lista?.rodadas.find((r) => r.situacao === 'terminou') ?? null;
  const mudou = !!(lista && ultimaTerminada && ultimaTerminada.versao !== lista.versaoAtual.versao);
  const custo = ultimaTerminada?.custoUsd ?? ESTIMATIVA_USD;

  return (
    <section className={`${CARTAO} space-y-3`} aria-labelledby="mister-avaliacao">
      <div>
        <h3 id="mister-avaliacao" className="text-sm font-semibold text-slate-100">
          Avaliação de regressão
        </h3>
        <p className="mt-1 max-w-3xl text-xs text-slate-300">
          {lista?.total ?? 40} perguntas fixas, numa loja de teste com dados inventados, com a chave da DMS. Cada uma é conferida por regra: a consulta escolhida, os números, nada inventado e nada fora do que a pessoa pode ver. Rode antes de
          publicar mudança nas instruções ou nas consultas.
        </p>
      </div>
      {erro && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-red-300" role="alert">
          <span className="min-w-0 flex-1">{erro}</span>
          <button type="button" className={BOTAO} onClick={() => void carregar()}>
            Tentar de novo
          </button>
        </div>
      )}
      {!lista && !erro && <p className="text-sm text-slate-400">Carregando…</p>}
      {lista && !lista.disponivel && <p className="text-sm text-slate-400">A avaliação ainda não está disponível neste servidor.</p>}
      {lista && lista.disponivel && (
        <>
          <p className="text-xs text-slate-400">
            Versão das instruções agora: <span className="font-mono text-slate-200">{lista.versaoAtual.versao}</span> · {lista.versaoAtual.consultas} consultas · modelo <span className="font-mono">{lista.modelo}</span>
          </p>
          {mudou && (
            <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-200" role="note">
              As instruções ou as consultas mudaram desde a última avaliação (versão <span className="font-mono">{ultimaTerminada!.versao}</span>). Rode de novo para conferir.
            </p>
          )}
          {lista.rodadas.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma avaliação ainda. Rode a primeira para ter a linha de base.</p>
          ) : (
            <ul className="divide-y divide-slate-800" aria-label="As últimas avaliações">
              {lista.rodadas.map((r) => {
                const oQue =
                  r.situacao === 'falhou' || r.situacao === 'interrompida'
                    ? r.motivo ?? '—'
                    : (r.oQueFalhou ?? []).length
                      ? (r.oQueFalhou ?? []).map((f) => `"${f.pergunta}" ${f.falha ?? ''}`.trim()).join(' · ') + ((r.falhas ?? 0) > (r.oQueFalhou ?? []).length ? ` · e mais ${(r.falhas ?? 0) - (r.oQueFalhou ?? []).length}` : '')
                      : '—';
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                    <span className="font-mono text-slate-300">{quando(r.iniciadaEm)}</span>
                    <span className="font-mono text-xs text-slate-400">
                      {r.versao} · {r.consultas} consultas
                    </span>
                    <Selo r={r} />
                    <span className="min-w-0 flex-[1_1_240px] break-words text-slate-300">{oQue}</span>
                    {r.custoUsd !== null && <span className="font-mono text-xs text-slate-400">{usd(r.custoUsd)}</span>}
                    <button type="button" className={BOTAO} disabled={r.feitas === 0} onClick={() => setAberta(r)}>
                      Ver as {r.feitas}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!lista.chaveDaDistribuicao || !!emCurso || pedindo}
              onClick={() => void rodar()}
              className="min-h-10 rounded-md border border-amber-500 bg-amber-500 px-3 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pedindo ? 'Começando…' : emCurso ? 'Rodando…' : 'Rodar a avaliação'}
            </button>
            <span className="text-xs text-slate-400">
              {lista.chaveDaDistribuicao ? `cerca de ${usd(custo)} na chave da DMS · ${lista.total} perguntas` : 'A chave de IA da distribuição não está configurada neste servidor.'}
            </span>
          </div>
          {aviso && (
            <p className={`text-sm ${aviso.ok ? 'text-emerald-300' : 'text-red-300'}`} role={aviso.ok ? 'status' : 'alert'}>
              {aviso.texto}
            </p>
          )}
        </>
      )}
      {aberta && <GavetaDaAvaliacao rodada={aberta} aoFechar={() => setAberta(null)} />}
    </section>
  );
}

function GavetaDaAvaliacao({ rodada, aoFechar }: { rodada: Rodada; aoFechar: () => void }) {
  const [casos, setCasos] = useState<Caso[] | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const r = (await distApi.misterAvaliacao(rodada.id)) as { casos: Caso[] };
      setCasos(r.casos ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui carregar as perguntas.');
    }
  }, [rodada.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <Gaveta titulo={`Avaliação de ${quando(rodada.iniciadaEm)}`} aoFechar={aoFechar} media>
      <div className="space-y-3 p-4">
        <p className="text-sm text-muted-foreground">
          Versão <span className="font-mono">{rodada.versao}</span> · {rodada.consultas} consultas · <span className="font-mono">{rodada.modelo}</span>
          {rodada.situacao === 'terminou' ? ` · ${rodada.acertos} de ${rodada.total} certas` : ''}
        </p>
        {erro && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-red-300" role="alert">
            <span className="min-w-0 flex-1">{erro}</span>
            <button type="button" className={BOTAO} onClick={() => void carregar()}>
              Tentar de novo
            </button>
          </div>
        )}
        {!casos && !erro && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {casos && casos.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma pergunta feita nesta rodada.</p>}
        {casos && casos.length > 0 && (
          <ul className="space-y-2" aria-label="As perguntas da avaliação">
            {casos.map((c) => (
              <li key={c.id} className="rounded-lg border border-slate-800 p-3 text-sm">
                <div className="flex flex-wrap items-start gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${c.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>{c.ok ? 'certa' : 'errada'}</span>
                  <span className="min-w-0 flex-1 break-words font-medium">{c.pergunta}</span>
                </div>
                {!c.ok && (
                  <ul className="mt-1 list-disc pl-5 text-red-300">
                    {c.falhas.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {c.consultas.length ? `consultou: ${c.consultas.map((n) => n.replace(/_/g, ' ')).join(', ')}` : 'sem consulta'} · {(c.ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Gaveta>
  );
}
