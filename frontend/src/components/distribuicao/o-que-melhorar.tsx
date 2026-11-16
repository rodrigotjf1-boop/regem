'use client';

import { useState } from 'react';
import { Gaveta } from '@/components/ui/sobreposto';
import { distApi } from '@/lib/api';
import { toast } from '@/lib/toast';

// O QUE MELHORAR no fim da Qualidade do Mister (o Mentor do prompt do dono). Parte 1 (protótipo
// mockups/regem-mister-sentinela-mentor.html): os números da própria Qualidade, juntos em padrões — a observação, a causa
// provável e a proposta, por regras fixas do servidor. M2a (mig 432; protótipo mockups/regem-mister-mentor-parte2.html,
// aprovado em 16/11/2026): a decisão da Diretoria em cada padrão — "Virou tarefa" (link ou código opcional) e "Não se
// aplica" (motivo obrigatório, some por 30 dias), as situações que filtram e "Desfazer a decisão". Nada muda no Mister.

type Causa = 'falta_consulta' | 'erro_na_consulta' | 'instrucao' | 'da_empresa';
type Situacao = 'aberto' | 'tarefa' | 'nao_se_aplica';
type Decisao = { chave: string; decisao: 'tarefa' | 'nao_se_aplica'; motivo: string | null; tarefa: string | null; quem: string | null; decididaEm: string; valeAte: string | null };
export type PadraoDoMister = { chave?: string; causa: Causa; observacao: string; porque: string; proposta: string; situacao?: Situacao; decisao?: Decisao | null };

const CAUSA: Record<Causa, { rotulo: string; cor: string }> = {
  falta_consulta: { rotulo: 'falta consulta', cor: 'bg-amber-500/15 text-amber-200' },
  erro_na_consulta: { rotulo: 'erro na consulta', cor: 'bg-red-500/15 text-red-300' },
  instrucao: { rotulo: 'instrução', cor: 'bg-amber-500/15 text-amber-200' },
  da_empresa: { rotulo: 'da empresa', cor: 'bg-slate-500/15 text-slate-300' },
};
const SITUACOES: [Situacao | 'todos', string][] = [
  ['aberto', 'Abertos'],
  ['tarefa', 'Virou tarefa'],
  ['nao_se_aplica', 'Não se aplica'],
  ['todos', 'Todos'],
];
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : '');

function marcaDaDecisao(d: Decisao): string {
  if (d.decisao === 'tarefa') return `Em tarefa desde ${dia(d.decididaEm)}${d.quem ? ` · ${d.quem}` : ''}${d.tarefa ? ` · ${d.tarefa}` : ''}`;
  return `Não se aplica até ${dia(d.valeAte)}${d.quem ? ` · ${d.quem}` : ''}${d.motivo ? ` · "${d.motivo}"` : ''}`;
}

const BOTAO = 'min-h-10 rounded-lg border border-slate-700 px-3 text-sm font-semibold text-slate-100';

export function OQueMelhorar({ padroes, dias, aoMudar }: { padroes: PadraoDoMister[]; dias: number; aoMudar?: () => void }) {
  const [sit, setSit] = useState<Situacao | 'todos'>('aberto');
  const [decidindo, setDecidindo] = useState<{ p: PadraoDoMister; decisao: 'tarefa' | 'nao_se_aplica' } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [tarefa, setTarefa] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const situacaoDe = (p: PadraoDoMister): Situacao => p.situacao ?? 'aberto';
  // Sem a chave (a API antes da M2a), o cartão fica só de leitura, como na parte 1.
  const comDecisoes = padroes.some((p) => p.chave);
  const lista = comDecisoes ? padroes.filter((p) => sit === 'todos' || situacaoDe(p) === sit) : padroes;
  const conta = (s: Situacao | 'todos') => (s === 'todos' ? padroes.length : padroes.filter((p) => situacaoDe(p) === s).length);

  const abrir = (p: PadraoDoMister, decisao: 'tarefa' | 'nao_se_aplica') => {
    setMotivo('');
    setTarefa('');
    setDecidindo({ p, decisao });
  };
  const salvar = async () => {
    if (!decidindo?.p.chave) return;
    if (decidindo.decisao === 'nao_se_aplica' && !motivo.trim()) {
      toast.error('Escreva por que não se aplica.');
      return;
    }
    setOcupado(true);
    try {
      await distApi.decidirPadraoDoMister(decidindo.p.chave, decidindo.decisao, motivo.trim(), tarefa.trim());
      toast.success('Decisão salva (fica na auditoria do console).');
      setDecidindo(null);
      aoMudar?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para salvar a decisão.');
    } finally {
      setOcupado(false);
    }
  };
  const desfazer = async (p: PadraoDoMister) => {
    if (!p.chave) return;
    try {
      await distApi.desfazerDecisaoDoMister(p.chave);
      toast.success('Decisão desfeita (fica na auditoria do console).');
      aoMudar?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para desfazer.');
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4" aria-labelledby="mister-melhorar" data-o-que-melhorar>
      <h3 id="mister-melhorar" className="text-sm font-semibold text-slate-100">
        O que melhorar · <span className="font-mono">{padroes.length}</span> {padroes.length === 1 ? 'padrão' : 'padrões'} nos últimos {dias} dias
      </h3>
      <p className="mb-2 mt-1 text-xs text-slate-400">
        Cada padrão com a observação, a causa provável e a proposta. Nada muda sozinho: a proposta vira tarefa do time, e mudança nas instruções só sai com a
        avaliação de regressão passando.
      </p>
      {comDecisoes && padroes.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Situação dos padrões">
          {SITUACOES.map(([s, rotulo]) => (
            <button
              key={s}
              type="button"
              aria-pressed={sit === s}
              onClick={() => setSit(s)}
              className={`min-h-10 rounded-full border px-3 text-sm font-semibold ${sit === s ? 'border-amber-500 bg-amber-500 text-amber-950' : 'border-slate-700 text-slate-300'}`}
            >
              {rotulo} <span className="ml-1 font-mono">{conta(s)}</span>
            </button>
          ))}
        </div>
      )}
      {padroes.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum padrão a melhorar neste período.</p>
      ) : lista.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-700 p-4 text-center text-sm text-slate-400">Nenhum padrão nesta situação.</p>
      ) : (
        <ul className="space-y-2" aria-label="Os padrões a melhorar">
          {lista.map((p) => (
            <li key={p.chave ?? `${p.causa}-${p.observacao}`} className="rounded-lg border border-slate-800 p-3 text-sm" data-padrao>
              <p className="break-words font-semibold text-slate-100">{p.observacao}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-slate-300">
                <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${CAUSA[p.causa]?.cor ?? 'bg-slate-500/15 text-slate-300'}`}>{CAUSA[p.causa]?.rotulo ?? p.causa}</span>
                <span className="min-w-0 break-words">{p.porque}</span>
              </p>
              <p className="mt-1 break-words text-slate-200">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Proposta </span>
                {p.proposta}
              </p>
              {p.decisao && <p className="mt-1 break-words text-xs text-slate-400">{marcaDaDecisao(p.decisao)}</p>}
              {p.chave && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {situacaoDe(p) === 'aberto' ? (
                    <>
                      <button type="button" className={BOTAO} onClick={() => abrir(p, 'tarefa')}>
                        Virou tarefa
                      </button>
                      <button type="button" className={BOTAO} onClick={() => abrir(p, 'nao_se_aplica')}>
                        Não se aplica
                      </button>
                    </>
                  ) : (
                    <button type="button" className={BOTAO} onClick={() => void desfazer(p)}>
                      Desfazer a decisão
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {decidindo && (
        <Gaveta
          titulo={decidindo.decisao === 'tarefa' ? 'Virou tarefa' : 'Não se aplica'}
          aoFechar={() => setDecidindo(null)}
          rodape={
            <>
              <button type="button" className="min-h-10 rounded-lg border border-border px-4 font-semibold" onClick={() => setDecidindo(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="min-h-10 rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-60"
                disabled={ocupado || (decidindo.decisao === 'nao_se_aplica' && !motivo.trim())}
                onClick={() => void salvar()}
              >
                {ocupado ? 'Salvando…' : 'Salvar a decisão'}
              </button>
            </>
          }
        >
          <div className="space-y-3" data-gaveta-decisao>
            <p className="font-semibold">{decidindo.p.observacao}</p>
            {decidindo.decisao === 'tarefa' ? (
              <>
                <label className="block text-sm" htmlFor="decisao-tarefa">
                  Link ou código da tarefa (opcional)
                </label>
                <input
                  id="decisao-tarefa"
                  className="min-h-10 w-full rounded-md border border-input bg-background px-3"
                  value={tarefa}
                  onChange={(e) => setTarefa(e.target.value)}
                  maxLength={200}
                  placeholder="ex.: DMS-412"
                />
                <p className="text-sm text-muted-foreground">O padrão fica à vista com &quot;em tarefa desde&quot;; quando ele some sozinho, sai da lista.</p>
              </>
            ) : (
              <>
                <label className="block text-sm" htmlFor="decisao-motivo">
                  Por que não se aplica (obrigatório)
                </label>
                <textarea
                  id="decisao-motivo"
                  className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  maxLength={300}
                />
                <p className="text-sm text-muted-foreground">O padrão some por 30 dias; se voltar depois, aparece de novo.</p>
              </>
            )}
          </div>
        </Gaveta>
      )}
    </div>
  );
}
