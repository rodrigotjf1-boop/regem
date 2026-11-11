'use client';

import { useCallback, useEffect, useState } from 'react';
import { distApi } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Console da distribuição → aba Integrações → "Preço e pausa na 99" (R3 F2; migs 401 e 402; só Diretoria). Tela INTERNA
// da distribuição (sem mockup, como o "iFood pelo Orzuni" ao lado): liga o direito da empresa (só com todos os servidores
// de loja na versão que tem os campos da 99) e mostra os últimos envios à 99. A conexão com a 99 é da própria loja
// (Delivery › Painel › ⚙️ › Integrações › 99Food); aqui só se diz se ela existe.

type Empresa = { id: string; nome: string; cnpj?: string | null };
type Painel = {
  empresa: { id: string; nome: string };
  liberado: boolean;
  versaoMinima: string;
  servidores: { id: string; nome: string; versao: string | null; pronto: boolean }[];
  com99: boolean;
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
  cadastro_item: 'Nome e descrição do item',
};
const RESULTADO: Record<string, { rotulo: string; cor: string }> = {
  aplicado: { rotulo: 'aplicado', cor: 'bg-emerald-500/15 text-emerald-300' },
  nao_encontrado: { rotulo: 'não existe na 99', cor: 'bg-amber-500/15 text-amber-300' },
  recusado: { rotulo: 'recusado', cor: 'bg-red-500/15 text-red-300' },
  dispensado: { rotulo: 'não enviado', cor: 'bg-slate-700/60 text-slate-300' },
  erro: { rotulo: 'desistiu', cor: 'bg-red-500/15 text-red-300' },
};

export function PrecosNa99({ empresas }: { empresas: Empresa[] }) {
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
      setPainel((await distApi.precosNa99Painel(id)) as Painel);
    } catch (e) {
      setPainel(null);
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o painel da 99.');
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
      await distApi.precosNa99Liberacao(tenantId, ligar);
      setAviso(ligar ? 'Preço e pausa na 99 LIGADOS nesta empresa.' : 'Preço e pausa na 99 desligados nesta empresa.');
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
        <h2 className="text-sm font-semibold text-slate-100">Preço e pausa na 99</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-400">
          O Regem manda à 99, item a item e na hora em que mudam, o preço na 99 dos produtos, as pausas, o nome e a
          descrição (pela conexão da própria loja com a 99). A empresa só pode ser ligada com todos os servidores de loja na
          versão que tem os campos da 99.
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
          {!painel.com99 && (
            <p className="rounded-xl border border-amber-600/50 bg-amber-500/10 p-3 text-xs text-amber-100">
              Esta empresa ainda não conectou a 99 (a loja conecta em Delivery › Painel › ⚙️ › Integrações › 99Food). Dá para
              ligar o direito antes; nada sai até a conexão existir.
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
              Servidores de loja (precisam da {painel.versaoMinima} ou mais nova):{' '}
              {painel.servidores.length === 0
                ? 'nenhum — a empresa usa só a nuvem.'
                : painel.servidores.map((s) => `${s.nome} ${s.versao ?? 'sem versão'} ${s.pronto ? '✓' : '✗'}`).join(' · ')}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Últimos envios à 99</p>
            {painel.envios.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">Nenhum envio ainda.</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {painel.envios.map((e) => {
                  const r = e.situacao === 'pendente' || e.situacao === 'enviando' ? null : RESULTADO[e.resultado ?? ''];
                  const motivo = e.resposta?.motivo ?? e.resposta?.mensagem ?? e.erro ?? null;
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
                        {e.resposta?.antes != null && e.resposta?.depois != null ? ` · ${e.resposta.antes} → ${e.resposta.depois}` : ''}
                        {e.resposta?.errno != null && e.resposta.errno !== 0 ? ` · errno ${e.resposta.errno}` : ''}
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
