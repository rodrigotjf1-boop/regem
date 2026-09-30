'use client';

import { useCallback, useEffect, useState } from 'react';
import { distApi } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Console da distribuição → aba Integrações → "Tokens de integração" (trilha C, só Diretoria).
// Tela INTERNA da distribuição (sem mockup, decisão do dono): emite o token POR LOJA com a
// autorização do presidente da empresa e revoga. O token em claro aparece UMA vez, aqui, e vai
// direto para o cofre do Liame — nunca por e-mail, chat ou print. O banco guarda só o hash.

type Empresa = { id: string; nome: string; cnpj?: string | null };
type Painel = {
  empresa: { id: string; nome: string };
  lojas: { id: string; nome: string; tipo?: string }[];
  presidentes: { id: string; nome: string; presidente: boolean; verFinanceiro: boolean }[];
  tokens: any[];
  escopos: { chave: string; rotulo: string }[];
};

const quando = (ts?: string | null) => (ts ? new Date(ts).toLocaleString('pt-BR') : '—');
const FORM_VAZIO = { unidadeId: '', autorizadoPor: '', escopos: [] as string[], evidencia: '' };

export function TokensIntegracao({ empresas }: { empresas: Empresa[] }) {
  const [tenantId, setTenantId] = useState('');
  const [painel, setPainel] = useState<Painel | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [form, setForm] = useState(FORM_VAZIO);
  const [emitindo, setEmitindo] = useState(false);
  const [emitido, setEmitido] = useState<{ token: string; prefixo: string; loja: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(async (id: string) => {
    setCarregando(true);
    setErro('');
    try {
      setPainel(await distApi.tokensIntegracao(id));
    } catch (e) {
      setPainel(null);
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os tokens.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    setForm(FORM_VAZIO);
    setEmitido(null);
    if (tenantId) carregar(tenantId);
    else setPainel(null);
  }, [tenantId, carregar]);

  const presidente = painel?.presidentes.find((p) => p.id === form.autorizadoPor);
  // `custos.ler` só com "Ver valores em R$" no perfil de quem autoriza (o servidor confere de novo).
  const escopoBloqueado = (chave: string) => chave === 'custos.ler' && !!presidente && !presidente.verFinanceiro;

  function alternarEscopo(chave: string) {
    setForm((f) => ({
      ...f,
      escopos: f.escopos.includes(chave) ? f.escopos.filter((e) => e !== chave) : [...f.escopos, chave],
    }));
  }

  function escolherPresidente(id: string) {
    const p = painel?.presidentes.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      autorizadoPor: id,
      escopos: p && !p.verFinanceiro ? f.escopos.filter((e) => e !== 'custos.ler') : f.escopos,
    }));
  }

  const podeEmitir =
    !!tenantId && !!form.unidadeId && !!form.autorizadoPor && form.escopos.length > 0 && form.evidencia.trim().length >= 5;

  async function emitir(e: React.FormEvent) {
    e.preventDefault();
    if (!podeEmitir) return;
    setEmitindo(true);
    setErro('');
    setCopiado(false);
    try {
      const r: any = await distApi.emitirTokenIntegracao({
        tenantId,
        unidadeId: form.unidadeId,
        autorizadoPor: form.autorizadoPor,
        escopos: form.escopos,
        evidencia: form.evidencia.trim(),
      });
      setEmitido({ token: r.token, prefixo: r.prefixo, loja: r.loja?.nome ?? '' });
      setForm(FORM_VAZIO);
      await carregar(tenantId);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível emitir o token.');
    } finally {
      setEmitindo(false);
    }
  }

  async function revogar(t: any) {
    const motivo = window.prompt(`Motivo da revogação do token ${t.prefixo}… (${t.lojaNome ?? 'loja'}):`);
    if (!motivo || !motivo.trim()) return;
    if (!window.confirm(`Revogar ${t.prefixo}…? A integração para na próxima chamada.`)) return;
    setErro('');
    try {
      await distApi.revogarTokenIntegracao(t.id, motivo.trim());
      await carregar(tenantId);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível revogar o token.');
    }
  }

  async function copiar() {
    if (!emitido) return;
    try {
      await navigator.clipboard.writeText(emitido.token);
      setCopiado(true);
    } catch {
      setErro('Não consegui copiar — selecione o token e copie à mão.');
    }
  }

  return (
    <section className="space-y-3 border-t border-slate-800 pt-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">Tokens de integração</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-400">
          Token por loja para o Liame ler as vendas. Emita só com a autorização do presidente da empresa e
          grave o token direto no cofre do Liame — ele aparece uma vez só.
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

      {erro && <p className="text-sm text-red-400">{erro}</p>}

      {emitido && (
        <div className="max-w-3xl rounded-xl border border-amber-600/60 bg-amber-500/10 p-4" role="status">
          <p className="text-sm font-semibold text-amber-300">Token emitido para {emitido.loja}</p>
          <p className="mt-1 text-xs text-amber-100/80">
            Ele aparece só agora. Grave direto no cofre do Liame; não mande por e-mail, chat ou print.
          </p>
          <code className="mt-3 block break-all rounded-lg bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100">
            {emitido.token}
          </code>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copiar}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
            >
              {copiado ? 'Copiado' : 'Copiar token'}
            </button>
            <button
              type="button"
              onClick={() => setEmitido(null)}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
            >
              Já guardei — esconder
            </button>
          </div>
        </div>
      )}

      {tenantId && carregando && !painel && <p className="text-sm text-slate-500">Carregando…</p>}

      {painel && (
        <>
          <form onSubmit={emitir} className="max-w-3xl space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Emitir token</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-400">
                Loja
                <select
                  value={form.unidadeId}
                  onChange={(e) => setForm((f) => ({ ...f, unidadeId: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
                >
                  <option value="">{painel.lojas.length ? 'Escolha a loja' : 'Empresa sem loja ativa'}</option>
                  {painel.lojas.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-400">
                Presidente que autorizou
                <select
                  value={form.autorizadoPor}
                  onChange={(e) => escolherPresidente(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
                >
                  <option value="">{painel.presidentes.length ? 'Escolha quem autorizou' : 'Empresa sem presidente ativo'}</option>
                  {painel.presidentes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                      {p.verFinanceiro ? '' : ' (sem "ver valores em R$")'}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset>
              <legend className="text-xs text-slate-400">Escopos</legend>
              <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {painel.escopos.map((e) => {
                  const bloqueado = escopoBloqueado(e.chave);
                  return (
                    <label
                      key={e.chave}
                      className={`flex items-start gap-2 rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs ${bloqueado ? 'opacity-50' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={form.escopos.includes(e.chave)}
                        disabled={bloqueado}
                        onChange={() => alternarEscopo(e.chave)}
                        className="mt-0.5 h-4 w-4 accent-amber-500"
                      />
                      <span>
                        <span className="font-mono text-slate-200">{e.chave}</span>
                        <span className="block text-[11px] text-slate-500">{e.rotulo}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <label className="block text-xs text-slate-400">
              Evidência da autorização
              <input
                value={form.evidencia}
                onChange={(e) => setForm((f) => ({ ...f, evidencia: e.target.value }))}
                maxLength={500}
                placeholder='ex.: "autorização por escrito em 29/09/2026"'
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
              />
            </label>

            <button
              type="submit"
              disabled={!podeEmitir || emitindo}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
            >
              {emitindo ? 'Emitindo…' : 'Emitir token'}
            </button>
          </form>

          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <caption className="sr-only">Tokens de integração de {painel.empresa.nome}</caption>
              <thead className="bg-slate-900/60 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="p-3">Token</th>
                  <th className="p-3">Loja</th>
                  <th className="p-3">Escopos</th>
                  <th className="p-3">Autorizado por</th>
                  <th className="p-3">Último uso</th>
                  <th className="p-3">Situação</th>
                </tr>
              </thead>
              <tbody>
                {painel.tokens.map((t) => (
                  <tr key={t.id} className="border-t border-slate-800/70 align-top">
                    <td className="p-3">
                      <span className="font-mono text-xs text-slate-200">{t.prefixo}…</span>
                      <div className="text-[11px] text-slate-500">
                        {t.cliente} · {quando(t.criadoEm)}
                      </div>
                    </td>
                    <td className="p-3 text-slate-300">{t.lojaNome ?? '—'}</td>
                    <td className="p-3">
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {(t.escopos ?? []).map((e: string) => (
                          <span key={e} className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                            {e}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-xs text-slate-300">
                      {t.autorizadoPor}
                      {t.evidencia && <div className="text-[11px] text-slate-500">{t.evidencia}</div>}
                    </td>
                    <td className="p-3 text-xs text-slate-500">
                      {quando(t.ultimoUsoEm)}
                      {t.ultimoIp && <div className="font-mono text-[10px]">{t.ultimoIp}</div>}
                    </td>
                    <td className="p-3">
                      {t.revogadoEm ? (
                        <div className="text-xs text-slate-400">
                          <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[11px]">revogado</span>
                          <div className="mt-1 text-[11px] text-slate-500">
                            {quando(t.revogadoEm)}
                            {t.motivoRevogacao ? ` · ${t.motivoRevogacao}` : ''}
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-400">ativo</span>
                          <button
                            type="button"
                            onClick={() => revogar(t)}
                            className="rounded-lg border border-red-500/60 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/10"
                          >
                            Revogar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {painel.tokens.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-500">
                      Nenhum token emitido para esta empresa.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
