'use client';

import { useCallback, useEffect, useState } from 'react';
import { distApi } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Console da distribuição → aba Integrações → "Conferir com os apps" (R3 F4a; mig 405; só Diretoria). Tela INTERNA da
// distribuição (sem mockup, como o "Preço e pausa na 99" ao lado): liga o direito da empresa (decisão 5 do protótipo: a
// conferência nasce desligada) e mostra o que cada app tem ligado e a última leitura de cada loja. A ligação de cada app
// é a de sempre: o iFood pelo Orzuni (ao lado) e a 99 pela conexão da loja com o "Preço e pausa na 99" ligado.

type Empresa = { id: string; nome: string; cnpj?: string | null };
type Painel = {
  empresa: { id: string; nome: string };
  liberado: boolean;
  ifood: { liberado: boolean; lojasLigadas: number };
  n99: { liberado: boolean; conectada: boolean };
  leituras: { loja: string; canal: string; lidoEm: string | null; erro: string | null; erroEm: string | null; itens: number; opcoes: number }[];
};

const quando = (ts?: string | null) => (ts ? new Date(ts).toLocaleString('pt-BR') : '—');
const APP: Record<string, string> = { ifood: 'iFood', '99food': '99' };

export function ConferirComOsApps({ empresas }: { empresas: Empresa[] }) {
  const [tenantId, setTenantId] = useState('');
  const [painel, setPainel] = useState<Painel | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async (id: string) => {
    setCarregando(true);
    setErro('');
    try {
      setPainel((await distApi.conferirAppsPainel(id)) as Painel);
    } catch (e) {
      setPainel(null);
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o painel da conferência.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    setAviso('');
    if (tenantId) carregar(tenantId);
    else setPainel(null);
  }, [tenantId, carregar]);

  async function liberar(ligar: boolean) {
    setOcupado(true);
    setErro('');
    setAviso('');
    try {
      await distApi.conferirAppsLiberacao(tenantId, ligar);
      setAviso(ligar ? '"Conferir com os apps" LIGADA nesta empresa.' : '"Conferir com os apps" desligada nesta empresa.');
      await carregar(tenantId);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível mudar a liberação.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="space-y-3 border-t border-slate-800 pt-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">Conferir com os apps</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-400">
          A aba &quot;Conferir com os apps&quot; da Gestão do catálogo: lê o cardápio do iFood (pelo Orzuni) e da 99 de cada loja,
          ao abrir (no máximo uma vez por dia) e pelo &quot;Ler agora&quot;, e compara com o Regem pelo código PDV. Nasce
          desligada; cada app só aparece com a ligação dele.
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

      {painel && (
        <div className="max-w-3xl space-y-3">
          {!painel.ifood.lojasLigadas && !(painel.n99.liberado && painel.n99.conectada) && (
            <p className="rounded-xl border border-amber-600/50 bg-amber-500/10 p-3 text-xs text-amber-100">
              Esta empresa ainda não tem app para conferir: nenhuma loja ligada ao Orzuni e a 99 sem o &quot;Preço e pausa na
              99&quot; ou sem conexão. Dá para ligar antes; a aba mostra o porquê.
            </p>
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
              iFood pelo Orzuni: {painel.ifood.liberado ? `ligado · ${painel.ifood.lojasLigadas} loja(s) com a ligação` : 'desligado'} · 99:{' '}
              {!painel.n99.liberado ? '"Preço e pausa na 99" desligado' : painel.n99.conectada ? 'conectada' : 'sem conexão'}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Última leitura de cada loja</p>
            {painel.leituras.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">Nenhuma leitura ainda.</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {painel.leituras.map((l) => {
                  const falhou = l.erro && (!l.lidoEm || (l.erroEm && l.erroEm > l.lidoEm));
                  return (
                    <li key={`${l.loja}|${l.canal}`} className="rounded-lg border border-slate-800 px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-slate-100">{l.loja}</span>
                        <span className="text-slate-400">{APP[l.canal] ?? l.canal}</span>
                        <span className={`ml-auto rounded px-1.5 py-0.5 text-[11px] ${falhou ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                          {falhou ? 'a última falhou' : 'lida'}
                        </span>
                      </div>
                      <p className="mt-0.5 break-words text-[11px] text-slate-500">
                        {l.lidoEm ? `${quando(l.lidoEm)} · ${l.itens} itens e ${l.opcoes} opções` : 'nunca lida'}
                        {falhou ? ` · ${quando(l.erroEm)}: ${l.erro}` : ''}
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
