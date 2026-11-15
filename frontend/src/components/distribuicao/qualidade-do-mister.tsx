'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { distApi } from '@/lib/api';
import { AvaliacaoDoMister } from './avaliacao-do-mister';
import { OQueMelhorar } from './o-que-melhorar';

// A QUALIDADE DO MISTER no console da distribuição (F5; protótipo mockups/regem-dependencias-e-qualidade.html, vista
// "Console › Mister › Qualidade"). Só números das perguntas de todas as empresas: respondidas, "não tenho acesso", tempo,
// custo, as consultas mais usadas, por que não respondeu, o que pediram e o Mister não tem (por tema, F5.2) e por
// empresa. O texto das perguntas e das respostas é da loja e não vem para cá.

type Qualidade = {
  dias: 7 | 30;
  perguntas: number;
  respondidas: number;
  pctRespondidas: number;
  falhas: number;
  semConsulta: number;
  /** F5.2 — opcionais: a API de antes do deploy não os traz. */
  naoTem?: { quantas: number; pct: number };
  temas?: { tema: string; quantas: number }[];
  /** O Mentor, parte 1 — opcional pelo mesmo motivo. */
  melhorar?: { causa: 'falta_consulta' | 'erro_na_consulta' | 'instrucao' | 'da_empresa'; observacao: string; porque: string; proposta: string }[];
  empresas: number;
  pessoas: number;
  tempo: { medianaS: number | null; p90S: number | null } | null;
  custo: { totalUsd: number; porPerguntaUsd: number | null; precosLidosEm: string };
  motivos: { motivo: string; quantas: number }[];
  consultas: { nome: string; vezes: number; pct: number; falhas: number }[];
  porEmpresa: { empresa: string; perguntas: number; semResposta: number; custoUsd: number; chave: string | null }[];
};

const CARTAO = 'rounded-xl border border-slate-800 bg-slate-900/40 p-4';
const SITUACAO_DA_CHAVE: Record<string, { rotulo: string; cor: string }> = {
  ok: { rotulo: 'da empresa · ok', cor: 'bg-emerald-500/15 text-emerald-300' },
  chave_recusada: { rotulo: 'recusada', cor: 'bg-red-500/15 text-red-300' },
  sem_credito: { rotulo: 'sem crédito', cor: 'bg-amber-500/15 text-amber-200' },
  teto_atingido: { rotulo: 'no teto de gasto', cor: 'bg-amber-500/15 text-amber-200' },
};

const usd = (v: number | null | undefined, casas = 4) =>
  v === null || v === undefined ? '—' : `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: casas > 2 && v < 0.01 ? casas : 2, maximumFractionDigits: casas })}`;
const segundos = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`);

export function QualidadeDoMister() {
  const [dias, setDias] = useState<7 | 30>(7);
  const [dados, setDados] = useState<Qualidade | null>(null);
  const [erro, setErro] = useState('');
  const leitura = useRef(0);

  const carregar = useCallback(async (d: 7 | 30) => {
    const vez = ++leitura.current;
    setErro('');
    try {
      const r = (await distApi.misterQualidade(d)) as Qualidade;
      if (vez === leitura.current) setDados(r);
    } catch (e) {
      if (vez === leitura.current) setErro(e instanceof Error ? e.message : 'Não consegui carregar os números do Mister.');
    }
  }, []);

  useEffect(() => {
    void carregar(dias);
  }, [carregar, dias]);

  const doPeriodo = dados && dados.dias === dias ? dados : null;
  return (
    <section className="space-y-3 border-t border-slate-800 pt-6" aria-labelledby="mister-qualidade">
      <div>
        <h2 id="mister-qualidade" className="text-sm font-semibold text-slate-100">
          Qualidade
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-300">
          Como o Mister está respondendo, em todas as empresas. Só os números de cada pergunta: se respondeu, o tempo, o custo, as consultas usadas e o motivo de não responder. O texto das perguntas e das respostas é da loja e não vem para cá.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
        {([7, 30] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={dias === d}
            onClick={() => setDias(d)}
            className={`min-h-10 rounded-full border px-3 text-sm font-semibold ${dias === d ? 'border-amber-500 bg-amber-500 text-slate-950' : 'border-slate-600 text-slate-300 hover:bg-slate-800'}`}
          >
            {d} dias
          </button>
        ))}
      </div>
      {erro && (
        <div className={`${CARTAO} flex flex-wrap items-center gap-3 text-sm text-red-300`} role="alert">
          <span className="min-w-0 flex-1">{erro}</span>
          <button type="button" className="min-h-10 rounded-md border border-slate-600 px-3 font-semibold text-slate-100 hover:bg-slate-800" onClick={() => void carregar(dias)}>
            Tentar de novo
          </button>
        </div>
      )}
      {!doPeriodo && !erro && <p className="text-sm text-slate-400">Carregando…</p>}
      {doPeriodo && doPeriodo.perguntas === 0 && <p className={`${CARTAO} text-center text-sm text-slate-400`}>Nenhuma pergunta ao Mister neste período.</p>}
      {doPeriodo && doPeriodo.perguntas > 0 && (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Numero rotulo="Perguntas" valor={doPeriodo.perguntas.toLocaleString('pt-BR')} nota={`${doPeriodo.empresas} ${doPeriodo.empresas === 1 ? 'empresa' : 'empresas'} · ${doPeriodo.pessoas} ${doPeriodo.pessoas === 1 ? 'pessoa' : 'pessoas'}`} />
            <Numero
              rotulo="Respondidas"
              valor={`${doPeriodo.pctRespondidas}%`}
              nota={`${doPeriodo.respondidas} de ${doPeriodo.perguntas} · ${doPeriodo.semConsulta} sem consultar dado`}
            />
            <Numero
              rotulo={'"Não tenho acesso"'}
              valor={(doPeriodo.naoTem?.quantas ?? 0).toLocaleString('pt-BR')}
              nota={`${doPeriodo.naoTem?.pct ?? 0}% das perguntas · o dado não está em nenhuma consulta`}
            />
            <Numero rotulo="Tempo até responder" valor={segundos(doPeriodo.tempo?.medianaS)} nota={doPeriodo.tempo ? `metade em até ${segundos(doPeriodo.tempo.medianaS)} · 90% em até ${segundos(doPeriodo.tempo.p90S)}` : 'sem resposta no período'} />
            <Numero rotulo="Custo por pergunta" valor={usd(doPeriodo.custo.porPerguntaUsd)} nota={`total ${usd(doPeriodo.custo.totalUsd, 2)} · pago pela chave de cada empresa`} />
          </dl>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className={CARTAO}>
              <h3 className="mb-2 text-sm font-semibold text-slate-100">Consultas mais usadas</h3>
              {doPeriodo.consultas.length ? (
                <Barras itens={doPeriodo.consultas.map((c) => ({ nome: c.falhas ? `${c.nome} · ${c.falhas} sem ler` : c.nome, valor: c.vezes, texto: `${c.pct}%` }))} />
              ) : (
                <p className="text-sm text-slate-400">Nenhuma consulta usada neste período.</p>
              )}
            </div>
            <div className={CARTAO}>
              <h3 className="mb-2 text-sm font-semibold text-slate-100">
                Por que não respondeu · <span className="font-mono">{doPeriodo.falhas}</span>
              </h3>
              {doPeriodo.motivos.length ? (
                <Barras itens={doPeriodo.motivos.map((m) => ({ nome: m.motivo, valor: m.quantas, texto: String(m.quantas) }))} />
              ) : (
                <p className="text-sm text-slate-400">Respondeu todas neste período.</p>
              )}
            </div>
            <div className={CARTAO}>
              <h3 className="mb-1 text-sm font-semibold text-slate-100">
                O que pediram e o Mister não tem · <span className="font-mono">{doPeriodo.naoTem?.quantas ?? 0}</span>
              </h3>
              <p className="mb-2 text-xs text-slate-400">O tema que o Mister anota antes de dizer que ainda não tem acesso. Só o tema, de uma lista fechada: nunca as palavras da pessoa.</p>
              {doPeriodo.temas?.length ? (
                <Barras itens={doPeriodo.temas.map((m) => ({ nome: m.tema, valor: m.quantas, texto: String(m.quantas) }))} />
              ) : (
                <p className="text-sm text-slate-400">Nada faltou neste período.</p>
              )}
            </div>
          </div>
          <div className={CARTAO}>
            <h3 className="mb-2 text-sm font-semibold text-slate-100">Por empresa</h3>
            <ul className="divide-y divide-slate-800">
              {doPeriodo.porEmpresa.map((e) => {
                const chave = e.chave ? SITUACAO_DA_CHAVE[e.chave] ?? { rotulo: e.chave, cor: 'bg-slate-500/15 text-slate-300' } : null;
                return (
                  <li key={e.empresa} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                    <span className="min-w-0 flex-[1_1_220px] break-words text-slate-100">{e.empresa}</span>
                    <span className="text-slate-300">
                      <span className="font-mono">{e.perguntas}</span> perguntas
                    </span>
                    <span className="text-slate-300">
                      <span className="font-mono">{e.semResposta}</span> sem resposta
                    </span>
                    <span className="font-mono text-slate-300">{usd(e.custoUsd, 2)}</span>
                    <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${chave ? chave.cor : 'bg-slate-500/15 text-slate-300'}`}>{chave ? chave.rotulo : 'sem chave própria'}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="text-xs text-slate-400">O custo é estimado pela tabela de preços lida em {doPeriodo.custo.precosLidosEm.split('-').reverse().join('/')}, a mesma da tela "IA e uso" de cada empresa.</p>
          <OQueMelhorar padroes={doPeriodo.melhorar ?? []} dias={doPeriodo.dias} />
        </>
      )}
      {/* A avaliação de regressão (F5.3) não depende do período nem das perguntas das lojas: aparece sempre, com o
          carregar e o erro dela. */}
      <AvaliacaoDoMister />
    </section>
  );
}

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: string; nota: string }) {
  return (
    <div className={`${CARTAO} min-w-0`}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{rotulo}</dt>
      <dd className="mt-0.5 font-mono text-2xl font-bold text-slate-100">{valor}</dd>
      <dd className="text-xs text-slate-400">{nota}</dd>
    </div>
  );
}

function Barras({ itens }: { itens: { nome: string; valor: number; texto: string }[] }) {
  const maior = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <ul className="space-y-2">
      {itens.map((i) => (
        <li key={i.nome} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
          <span className="min-w-0 break-words text-slate-200">{i.nome}</span>
          <span className="font-mono text-slate-400">{i.texto}</span>
          <span className="col-span-2 h-2 overflow-hidden rounded bg-slate-800" aria-hidden="true">
            <span className="block h-full bg-amber-500" style={{ width: `${Math.round((i.valor / maior) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
