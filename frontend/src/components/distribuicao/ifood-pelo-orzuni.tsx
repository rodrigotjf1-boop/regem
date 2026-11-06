'use client';

import { useCallback, useEffect, useState } from 'react';
import { distApi } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Console da distribuição → aba Integrações → "iFood pelo Orzuni" (R2a; mig 370; só Diretoria). Tela INTERNA da
// distribuição (sem mockup, como os tokens de integração): registra a ligação de cada loja com o Orzuni (a chave
// `orz_live_` da conta da loja entra aqui UMA vez e é trocada pelo segredo da ligação, guardado cifrado na nuvem), liga
// a liberação da empresa (só com todos os servidores de loja na versão certa) e mostra os últimos envios ao iFood.

type Empresa = { id: string; nome: string; cnpj?: string | null };
type Ligacao = { id: string; prefixo: string; lojaIfood: string | null; criadaEm: string; criadaPor: string | null; ultimoUsoEm: string | null };
type Painel = {
  empresa: { id: string; nome: string };
  config: { envioLigado: boolean; credencialOk: boolean; motivo: string | null; segredosChave: boolean; endereco: string };
  liberado: boolean;
  versaoMinima: string;
  servidores: { id: string; nome: string; versao: string | null; pronto: boolean }[];
  lojas: { id: string; nome: string; ligacao: Ligacao | null }[];
  envios: {
    id: string;
    tipo: string;
    situacao: string;
    resultado: string | null;
    resposta: any;
    erro: string | null;
    tentativas: number;
    loja: string | null;
    alvo: string | null;
    codigo: string | null;
    marcadoEm: string;
    enviadoEm: string | null;
  }[];
};

const quando = (ts?: string | null) => (ts ? new Date(ts).toLocaleString('pt-BR') : '—');
const TIPO: Record<string, string> = {
  preco_item: 'Preço do item',
  status_item: 'Pausa do item',
  preco_opcao: 'Preço do complemento',
  status_opcao: 'Pausa do complemento',
};
const RESULTADO: Record<string, { rotulo: string; cor: string }> = {
  aplicado: { rotulo: 'aplicado', cor: 'bg-emerald-500/15 text-emerald-300' },
  sem_mudanca: { rotulo: 'já estava assim', cor: 'bg-slate-700/60 text-slate-200' },
  nao_encontrado: { rotulo: 'não existe no iFood', cor: 'bg-amber-500/15 text-amber-300' },
  parcial: { rotulo: 'parcial', cor: 'bg-amber-500/15 text-amber-300' },
  recusado: { rotulo: 'recusado', cor: 'bg-red-500/15 text-red-300' },
  dispensado: { rotulo: 'não enviado', cor: 'bg-slate-700/60 text-slate-300' },
  erro: { rotulo: 'desistiu', cor: 'bg-red-500/15 text-red-300' },
};

export function IfoodPeloOrzuni({ empresas }: { empresas: Empresa[] }) {
  const [tenantId, setTenantId] = useState('');
  const [painel, setPainel] = useState<Painel | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [chaveDe, setChaveDe] = useState<string | null>(null); // loja com o campo da chave aberto
  const [chave, setChave] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async (id: string) => {
    setCarregando(true);
    setErro('');
    try {
      setPainel((await distApi.orzuniPainel(id)) as Painel);
    } catch (e) {
      setPainel(null);
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o painel do Orzuni.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    setChaveDe(null);
    setChave('');
    setAviso('');
    if (tenantId) carregar(tenantId);
    else setPainel(null);
  }, [tenantId, carregar]);

  async function registrar(unidadeId: string) {
    if (!chave.trim()) return;
    setOcupado(true);
    setErro('');
    setAviso('');
    try {
      const r: any = await distApi.orzuniRegistrar({ tenantId, unidadeId, chave: chave.trim() });
      setAviso(`Loja "${r.loja}" ligada ao Orzuni (${r.prefixo}…)${r.trocouAnterior ? ' — a ligação anterior foi revogada' : ''}.`);
      setChave('');
      setChaveDe(null);
      await carregar(tenantId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'O Orzuni não aceitou a chave.');
    } finally {
      setOcupado(false);
    }
  }

  async function revogar(l: { nome: string; ligacao: Ligacao | null }) {
    if (!l.ligacao) return;
    if (!window.confirm(`Revogar a ligação da loja "${l.nome}" com o Orzuni? O envio ao iFood dela para na hora.`)) return;
    setOcupado(true);
    setErro('');
    try {
      await distApi.orzuniRevogar(l.ligacao.id, 'revogada no console');
      setAviso(`Ligação da loja "${l.nome}" revogada.`);
      await carregar(tenantId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível revogar.');
    } finally {
      setOcupado(false);
    }
  }

  async function liberar(ligar: boolean) {
    setOcupado(true);
    setErro('');
    setAviso('');
    try {
      await distApi.orzuniLiberacao(tenantId, ligar);
      setAviso(ligar ? 'iFood pelo Orzuni LIGADO nesta empresa.' : 'iFood pelo Orzuni desligado nesta empresa.');
      await carregar(tenantId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível mudar a liberação.');
    } finally {
      setOcupado(false);
    }
  }

  const cfg = painel?.config;
  return (
    <section className="space-y-3 border-t border-slate-800 pt-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">iFood pelo Orzuni</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-400">
          O Regem manda ao iFood, pelo Orzuni, o preço no iFood dos produtos e complementos e as pausas, na hora em que mudam.
          Cada loja precisa da ligação: cole a chave orz_live_ da conta da loja no Orzuni (ela não fica guardada; o Regem
          guarda só o segredo da ligação, cifrado). A empresa só pode ser ligada com todos os servidores de loja na versão
          que tem os campos do iFood.
        </p>
      </div>

      <label className="block max-w-md text-xs text-slate-400">
        Empresa
        <select
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
        >
          <option value="">{empresas.length ? 'Escolha a empresa' : 'Carregando empresas…'}</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
              {e.cnpj ? ` · ${e.cnpj}` : ''}
            </option>
          ))}
        </select>
      </label>

      {erro && <p className="max-w-3xl text-sm text-red-400" role="alert">{erro}</p>}
      {aviso && <p className="max-w-3xl text-sm text-emerald-300" role="status">{aviso}</p>}
      {tenantId && carregando && !painel && <p className="text-sm text-slate-500">Carregando…</p>}

      {painel && cfg && (
        <div className="max-w-3xl space-y-3">
          {(!cfg.credencialOk || !cfg.segredosChave || !cfg.envioLigado) && (
            <div className="space-y-1 rounded-xl border border-amber-600/50 bg-amber-500/10 p-3 text-xs text-amber-100">
              {!cfg.credencialOk && <p>Credencial do Regem no DMS ID incompleta: {cfg.motivo}. Sem ela não há troca de chave nem envio.</p>}
              {!cfg.segredosChave && <p>Falta a SEGREDOS_CHAVE nesta nuvem: o segredo da ligação não pode ser guardado.</p>}
              {cfg.credencialOk && !cfg.envioLigado && (
                <p>O envio está desligado nesta nuvem (ORZUNI_LIGADO). Dá para preparar as ligações e a liberação; nada sai até ligar.</p>
              )}
            </div>
          )}

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-slate-200">
                Liberação na empresa:{' '}
                <strong className={painel.liberado ? 'text-emerald-300' : 'text-slate-300'}>{painel.liberado ? 'ligada' : 'desligada'}</strong>
              </p>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => liberar(!painel.liberado)}
                className={`ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
                  painel.liberado ? 'border border-slate-600 text-slate-200 hover:bg-slate-800' : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                }`}
              >
                {painel.liberado ? 'Desligar' : 'Ligar na empresa'}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Servidores de loja (precisam da {painel.versaoMinima} ou mais nova):{' '}
              {painel.servidores.length === 0
                ? 'nenhum — a empresa usa só a nuvem.'
                : painel.servidores.map((s) => `${s.nome} ${s.versao ?? 'sem versão'} ${s.pronto ? '✓' : '✗'}`).join(' · ')}
            </p>
          </div>

          <ul className="space-y-2">
            {painel.lojas.length === 0 && <li className="text-sm text-slate-500">Empresa sem loja ativa.</li>}
            {painel.lojas.map((l) => (
              <li key={l.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 break-words text-sm font-semibold text-slate-100">{l.nome}</p>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${l.ligacao ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700/60 text-slate-300'}`}>
                    {l.ligacao ? 'ligada' : 'sem ligação'}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => {
                        setChaveDe(chaveDe === l.id ? null : l.id);
                        setChave('');
                      }}
                      aria-expanded={chaveDe === l.id}
                      className="rounded-lg border border-slate-600 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
                    >
                      {l.ligacao ? 'Trocar a chave' : 'Ligar com a chave'}
                    </button>
                    {l.ligacao && (
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => revogar(l)}
                        className="rounded-lg border border-red-700/70 px-2.5 py-1 text-xs text-red-300 hover:bg-red-900/30 disabled:opacity-40"
                      >
                        Revogar
                      </button>
                    )}
                  </div>
                </div>
                {l.ligacao && (
                  <p className="mt-1 break-words text-[11px] text-slate-400">
                    {l.ligacao.prefixo}… · desde {quando(l.ligacao.criadaEm)}
                    {l.ligacao.criadaPor ? ` por ${l.ligacao.criadaPor}` : ''} · último envio {quando(l.ligacao.ultimoUsoEm)}
                  </p>
                )}
                {chaveDe === l.id && (
                  <form
                    className="mt-2 flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void registrar(l.id);
                    }}
                  >
                    <label className="min-w-0 flex-1 text-[11px] text-slate-400">
                      Chave orz_live_ da conta desta loja no Orzuni
                      <input
                        type="password"
                        autoComplete="new-password"
                        spellCheck={false}
                        value={chave}
                        onChange={(e) => setChave(e.target.value)}
                        placeholder="orz_live_…"
                        className="mt-1 h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-sm text-slate-100 outline-none focus:border-amber-500"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={ocupado || !chave.trim()}
                      className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
                    >
                      {ocupado ? 'Trocando…' : 'Ligar a loja'}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Últimos envios ao iFood</p>
            {painel.envios.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">Nenhum envio ainda.</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {painel.envios.map((e) => {
                  const r = e.situacao === 'pendente' || e.situacao === 'enviando' ? null : RESULTADO[e.resultado ?? ''];
                  const motivo = e.resposta?.motivo ?? e.resposta?.codigo ?? e.erro ?? null;
                  return (
                    <li key={e.id} className="rounded-lg border border-slate-800 px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-300">{TIPO[e.tipo] ?? e.tipo}</span>
                        <span className="min-w-0 break-words text-slate-100">
                          {e.alvo ?? '—'}
                          {e.codigo ? ` (PDV ${e.codigo})` : ''}
                        </span>
                        <span className="text-slate-500">{e.loja ?? ''}</span>
                        <span className={`ml-auto rounded px-1.5 py-0.5 text-[11px] ${r ? r.cor : 'bg-sky-500/15 text-sky-300'}`}>
                          {r ? r.rotulo : e.situacao === 'enviando' ? 'enviando' : `na fila${e.tentativas ? ` (${e.tentativas}ª tentativa)` : ''}`}
                        </span>
                      </div>
                      <p className="mt-0.5 break-words text-[11px] text-slate-500">
                        {quando(e.enviadoEm ?? e.marcadoEm)}
                        {e.resposta?.antes !== undefined && e.resposta?.depois !== undefined ? ` · ${e.resposta.antes} → ${e.resposta.depois}` : ''}
                        {motivo ? ` · ${motivo}` : ''}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
