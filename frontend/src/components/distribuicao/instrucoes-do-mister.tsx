'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { distApi } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Confirmar } from './confirmar-no-console';

// AS INSTRUÇÕES CANDIDATAS DO MISTER (M2b, o Mentor; mig 435; protótipo `mockups/regem-mister-mentor-parte2.html`,
// aprovado em 16/11/2026). A versão no ar (o texto do código com as trocas publicadas), a candidata — uma troca de linha
// que o Mentor propõe a partir das erradas da avaliação, ou a volta da última troca — com a avaliação de regressão e a
// comparação, e as trocas publicadas. "Publicar" só fica pronto com a avaliação sem errada nova (o servidor confere de novo).

type Rodada = { id: string; situacao: string; total: number; feitas: number; acertos: number; custoUsd: number | null; iniciadaEm: string } | null;
type Estado = {
  indisponivel?: boolean;
  chaveDaDistribuicao: boolean;
  noAr: { versao: string; desde?: string | null; por?: string | null; avaliacao?: Rodada; quebradas?: { id: string; sai: string }[] };
  erradasNoAr: { pergunta: string; falhas: string[] }[];
  candidata: {
    id: string;
    tipo: 'troca' | 'volta';
    sai: string;
    entra: string;
    porque: string | null;
    versao: string;
    criadaEm: string;
    criadaPor: string | null;
    avaliacao: Rodada;
    pode: boolean;
    motivo: string | null;
    novas: string[];
    melhoraram: string[];
  } | null;
  publicadas: { id: string; sai: string; entra: string; publicadaEm: string; publicadaPor: string | null; ultima: boolean }[];
};

const CARTAO = 'rounded-xl border border-slate-800 bg-slate-900/40 p-4';
const BOTAO = 'inline-flex min-h-10 items-center justify-center rounded-lg px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40';
const PRIMARIO = `${BOTAO} bg-amber-500 text-slate-950 hover:bg-amber-400`;
const NEUTRO = `${BOTAO} border border-slate-600 text-slate-100 hover:bg-slate-800`;
const quando = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às') : '';
const usd = (v: number | null | undefined) => (v === null || v === undefined ? null : `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const mensagemDe = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function InstrucoesDoMister() {
  const [d, setD] = useState<Estado | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const vez = useRef(0);

  // Só a resposta da leitura mais nova vale (V64).
  const carregar = useCallback(async () => {
    const n = ++vez.current;
    try {
      const r = (await distApi.misterInstrucoes()) as Estado;
      if (n === vez.current) {
        setD(r);
        setErro('');
      }
    } catch (e) {
      if (n === vez.current) setErro(mensagemDe(e, 'Não consegui carregar as instruções do Mister.'));
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const rodando = d?.candidata?.avaliacao?.situacao === 'rodando';
  // A avaliação da candidata roda em segundo plano: a seção acompanha a cada 3 s só enquanto ela roda.
  useEffect(() => {
    if (!rodando) return;
    const t = setInterval(() => void carregar(), 3_000);
    return () => clearInterval(t);
  }, [rodando, carregar]);

  const agir = async (qual: string, fazer: () => Promise<unknown>, feito: string) => {
    setOcupado(qual);
    try {
      await fazer();
      toast.success(feito);
      setConfirmar(false);
      await carregar();
    } catch (e) {
      toast.error(mensagemDe(e, 'Não deu certo.'));
    } finally {
      setOcupado(null);
    }
  };

  const c = d?.candidata ?? null;
  const base = d?.noAr.avaliacao ?? null;
  const av = c?.avaliacao ?? null;

  return (
    <section className="space-y-3 border-t border-slate-800 pt-6" aria-labelledby="mister-instrucoes" data-instrucoes-do-mister>
      <div>
        <h2 id="mister-instrucoes" className="text-sm font-semibold text-slate-100">
          Instruções
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-300">
          O Mentor propõe uma versão nova das instruções — a troca de uma linha — a partir das perguntas que a avaliação de regressão errou. Ela só se publica depois de
          rodar a avaliação (as 40 perguntas, a empresa de teste, a chave da DMS) sem nenhuma errada nova. A troca anterior fica guardada e volta pelo mesmo caminho.
        </p>
      </div>

      {erro && (
        <div className={`${CARTAO} flex flex-wrap items-center gap-3 text-sm text-red-300`} role="alert">
          <span className="min-w-0 flex-1">{erro}</span>
          <button type="button" className={NEUTRO} onClick={() => void carregar()}>
            Tentar de novo
          </button>
        </div>
      )}
      {!d && !erro && <p className="text-sm text-slate-400">Carregando…</p>}
      {d?.indisponivel && <p className={`${CARTAO} text-sm text-amber-200`}>As instruções candidatas ainda não estão disponíveis neste servidor.</p>}

      {d && !d.indisponivel && (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className={CARTAO}>
              <dt className="text-xs text-slate-400">No ar</dt>
              <dd className="font-mono text-xl text-slate-100">{d.noAr.versao}</dd>
              <dd className="mt-1 break-words text-xs text-slate-400">
                {d.noAr.desde ? `desde ${quando(d.noAr.desde)}${d.noAr.por ? ` · por ${d.noAr.por}` : ''}` : 'o texto do código'}
                {base ? ` · ${base.acertos}/${base.total}` : ' · sem avaliação inteira ainda'}
              </dd>
            </div>
            <div className={CARTAO}>
              <dt className="text-xs text-slate-400">Candidata</dt>
              <dd className="font-mono text-xl text-slate-100">{c ? c.versao : '—'}</dd>
              <dd className="mt-1 break-words text-xs text-slate-400">
                {c ? `de ${quando(c.criadaEm)} · ${c.tipo === 'volta' ? 'a volta da última troca' : 'proposta pelo Mentor'}` : 'nenhuma agora'}
              </dd>
            </div>
          </dl>

          {!!d.noAr.quebradas?.length && (
            <div className={`${CARTAO} border-l-4 border-l-amber-500 text-sm`} role="note">
              <p className="font-semibold text-amber-200">
                {plural(d.noAr.quebradas.length, 'troca publicada não se aplica mais', 'trocas publicadas não se aplicam mais')}: a linha que ela trocava mudou no código.
              </p>
              <p className="mt-1 text-slate-300">O texto no ar segue sem ela. Peça uma candidata nova, se ainda precisar.</p>
            </div>
          )}

          {!c && (
            <div className={CARTAO} data-sem-candidata>
              {d.erradasNoAr.length > 0 ? (
                <>
                  <p className="text-sm text-slate-200">
                    A avaliação da versão no ar errou {d.erradasNoAr.length}: {d.erradasNoAr.slice(0, 2).map((e) => `"${e.pergunta}"`).join(', ')}
                    {d.erradasNoAr.length > 2 ? '…' : '.'}
                  </p>
                  <button
                    type="button"
                    className={`${PRIMARIO} mt-3`}
                    disabled={!d.chaveDaDistribuicao || !!ocupado}
                    onClick={() => void agir('pedir', () => distApi.pedirCandidataAoMentor(), 'O Mentor propôs uma candidata. Rode a avaliação com ela.')}
                  >
                    {ocupado === 'pedir' ? 'O Mentor está escrevendo…' : 'Pedir uma candidata ao Mentor'}
                  </button>
                  {!d.chaveDaDistribuicao && <p className="mt-2 text-sm text-amber-200">A chave de IA da distribuição não está configurada neste servidor.</p>}
                </>
              ) : base ? (
                <p className="text-sm text-slate-300">A avaliação da versão no ar não errou nada: não há o que corrigir.</p>
              ) : (
                <p className="text-sm text-slate-300">A versão no ar ainda não tem uma avaliação inteira. Rode a avaliação de regressão (em Qualidade, acima) antes de pedir uma candidata.</p>
              )}
            </div>
          )}

          {c && (
            <div className={CARTAO} data-candidata>
              <h3 className="text-sm font-semibold text-slate-100">{c.tipo === 'volta' ? 'A volta: tira a última troca publicada' : 'O que muda na candidata'}</h3>
              <dl className="mt-2 grid gap-2 text-sm">
                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                  <dt className="text-xs font-semibold text-red-300">Sai</dt>
                  <dd className="mt-1 break-words text-slate-200">{c.sai}</dd>
                </div>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <dt className="text-xs font-semibold text-emerald-300">Entra</dt>
                  <dd className="mt-1 break-words text-slate-200">{c.entra}</dd>
                </div>
              </dl>
              {c.porque && <p className="mt-2 break-words text-xs text-slate-400">Por quê: {c.porque}</p>}

              <h3 className="mt-4 text-sm font-semibold text-slate-100">Avaliação de regressão</h3>
              {!av && (
                <p className="mt-1 text-sm text-slate-300">
                  Ainda não rodou para a candidata.{usd(base?.custoUsd) ? ` Custo: cerca de ${usd(base?.custoUsd)} (chave da DMS).` : ' Ela gasta a chave da DMS.'}
                </p>
              )}
              {av?.situacao === 'rodando' && (
                <p className="mt-1 text-sm text-slate-300" role="status">
                  Rodando com a candidata · {av.feitas} de {av.total}… a seção atualiza sozinha.
                </p>
              )}
              {av && av.situacao !== 'rodando' && (
                <div className="mt-1 text-sm" data-comparacao>
                  <p className={c.pode ? 'font-semibold text-emerald-300' : 'font-semibold text-amber-200'}>
                    Avaliação: {av.acertos}/{av.total}
                    {c.pode ? ' · nenhuma errada nova' : c.novas.length ? ` · ${plural(c.novas.length, 'errada nova', 'erradas novas')}` : ''}
                  </p>
                  {c.melhoraram.length > 0 && (
                    <p className="mt-1 break-words text-slate-300">Passou a acertar: {c.melhoraram.map((p) => `"${p}"`).join(', ')}.</p>
                  )}
                  {c.novas.length > 0 && <p className="mt-1 break-words text-slate-300">Passou a errar: {c.novas.map((p) => `"${p}"`).join(', ')}.</p>}
                  {c.motivo && <p className="mt-1 break-words text-slate-400">{c.motivo}</p>}
                  <p className="mt-1 text-xs text-slate-400">
                    {quando(av.iniciadaEm)}
                    {usd(av.custoUsd) ? ` · ${usd(av.custoUsd)}` : ''}
                  </p>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {(!av || av.situacao !== 'terminou' || !c.pode) && (
                  <button
                    type="button"
                    className={av ? NEUTRO : PRIMARIO}
                    disabled={rodando || !d.chaveDaDistribuicao || !!ocupado}
                    onClick={() => void agir('avaliar', () => distApi.avaliarCandidataDoMister(), 'A avaliação com a candidata começou.')}
                  >
                    {rodando ? 'Avaliando…' : av ? 'Rodar a avaliação de novo' : 'Rodar a avaliação'}
                  </button>
                )}
                <button type="button" className={PRIMARIO} disabled={!c.pode || rodando || !!ocupado} onClick={() => setConfirmar(true)}>
                  Publicar a candidata
                </button>
                <button
                  type="button"
                  className={NEUTRO}
                  disabled={rodando || !!ocupado}
                  onClick={() => void agir('descartar', () => distApi.descartarCandidataDoMister(), 'Candidata descartada (fica na auditoria do console).')}
                >
                  Descartar a candidata
                </button>
              </div>
            </div>
          )}

          <div className={CARTAO} data-versoes>
            <h3 className="text-sm font-semibold text-slate-100">Trocas publicadas</h3>
            {d.publicadas.length === 0 ? (
              <p className="mt-1 text-sm text-slate-400">Nenhuma: no ar está o texto do código.</p>
            ) : (
              <ul className="mt-2 space-y-2" aria-label="As trocas publicadas, da mais nova para a mais antiga">
                {[...d.publicadas].reverse().map((t) => (
                  <li key={t.id} className="rounded-lg border border-slate-800 p-3 text-sm" data-troca-publicada>
                    <p className="text-xs text-slate-400">
                      {quando(t.publicadaEm)}
                      {t.publicadaPor ? ` · por ${t.publicadaPor}` : ''}
                      {t.ultima ? ' · a última' : ''}
                    </p>
                    <p className="mt-1 break-words text-slate-300">
                      <span className="font-semibold text-red-300">Saiu:</span> {t.sai}
                    </p>
                    <p className="mt-1 break-words text-slate-200">
                      <span className="font-semibold text-emerald-300">Entrou:</span> {t.entra}
                    </p>
                    {t.ultima && (
                      <button
                        type="button"
                        className={`${NEUTRO} mt-2`}
                        disabled={!!c || !!ocupado}
                        onClick={() => void agir('volta', () => distApi.pedirVoltaDasInstrucoes(), 'A volta virou candidata. Rode a avaliação com ela.')}
                      >
                        Voltar sem esta troca
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {confirmar && c && (
        <Confirmar
          titulo="Publicar a candidata"
          texto="O Mister passa a responder com ela em todas as empresas (as perguntas, os relatórios e a avaliação). A troca anterior fica guardada e volta pelo mesmo caminho."
          acao="Publicar"
          ocupado={ocupado === 'publicar'}
          onConfirmar={() => void agir('publicar', () => distApi.publicarCandidataDoMister(), 'Publicada: o Mister já responde com a versão nova.')}
          onFechar={() => setConfirmar(false)}
        />
      )}
    </section>
  );
}
