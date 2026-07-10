'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { brl } from './tipos';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Aba Promos: cupons vigentes, fidelidade (progresso + resgate) e ofertas.
export function PromosPanel({
  token,
  produtosPromo,
  accent,
  telefone,
}: {
  token: string;
  produtosPromo: any[];
  accent: string;
  telefone?: string;
}) {
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [cashback, setCashback] = useState<any>(null);

  useEffect(() => {
    api.cardapioPromos(token).then(setData).catch(() => setData({ cupons: [], fidelidadeAtiva: false }));
  }, [token]);

  const carregarStatus = useCallback(() => {
    const tel = (telefone ?? '').replace(/\D/g, '');
    if (tel.length < 10) {
      setStatus(null);
      setCashback(null);
      return;
    }
    api.cardapioPontos(token, tel).then(setStatus).catch(() => setStatus(null));
    api.cardapioCashback(token, tel).then(setCashback).catch(() => setCashback(null));
  }, [token, telefone]);
  useEffect(() => {
    carregarStatus();
  }, [carregarStatus]);

  async function resgatarProduto(produtoId: string) {
    const tel = (telefone ?? '').replace(/\D/g, '');
    try {
      await api.cardapioCashbackResgatar(token, tel, produtoId);
      alert('Produto resgatado! O desconto entra automaticamente no seu próximo pedido.');
      carregarStatus();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Não foi possível resgatar.');
    }
  }
  const cbPontosProdutos = (cashback?.planos ?? [])
    .filter((p: any) => p.tipo === 'pontos')
    .flatMap((p: any) => p.produtos ?? []);
  const temCashback = cashback && ((cashback.valor ?? 0) > 0 || (cashback.pontos ?? 0) > 0 || cbPontosProdutos.length > 0);

  async function resgatar(id: string) {
    const tel = (telefone ?? '').replace(/\D/g, '');
    try {
      await api.cardapioFidelidadeResgatar(token, id, tel);
      alert('Prêmio resgatado! O desconto entra automaticamente no seu próximo pedido.');
      carregarStatus();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Não foi possível resgatar.');
    }
  }

  const cupomLabel = (c: any) =>
    c.tipo === 'fretegratis' ? 'Frete grátis' : c.tipo === 'percentual' ? `${c.valor}% OFF` : `${brl(c.valor)} OFF`;

  const nada =
    data && !data.fidelidadeAtiva && (data.cupons?.length ?? 0) === 0 && produtosPromo.length === 0 && !temCashback;
  const disponiveis = (status?.resgates ?? []).filter((r: any) => r.status === 'disponivel');
  const naCarteira = (status?.resgates ?? []).filter((r: any) => r.status === 'resgatado');

  return (
    <div className="space-y-5 px-4 py-4">
      <h2 className="text-lg font-bold">Promoções</h2>

      {/* Cashback */}
      {temCashback && (
        <div className="space-y-3">
          <div className="rounded-2xl bg-emerald-600 p-4 text-white">
            <p className="text-sm font-bold">💰 Cashback</p>
            <div className="mt-1 flex flex-wrap gap-x-4 text-xs opacity-95">
              {(cashback.valor ?? 0) > 0 && <span>Saldo <b>{brl(Number(cashback.valor))}</b> — abate automático no próximo pedido</span>}
              {(cashback.pontos ?? 0) > 0 && <span>Você tem <b>{cashback.pontos}</b> pontos</span>}
            </div>
          </div>

          {cbPontosProdutos.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold">Troque seus pontos</p>
              <div className="space-y-2">
                {cbPontosProdutos.map((pr: any) => {
                  const podeResgatar = (cashback.pontos ?? 0) >= pr.pontos;
                  return (
                    <div key={pr.produtoId} className="flex items-center gap-3 rounded-xl border border-black/10 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{pr.nome}</p>
                        <p className="text-xs text-black/50">{pr.pontos} pontos · vale {brl(Number(pr.precoVenda))}</p>
                      </div>
                      <button
                        type="button"
                        disabled={!podeResgatar}
                        onClick={() => resgatarProduto(pr.produtoId)}
                        className="flex-none rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                        style={{ background: accent }}
                      >
                        {podeResgatar ? 'Resgatar' : 'Faltam pontos'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {data?.fidelidadeAtiva && (
        <div className="space-y-3">
          <div className="rounded-2xl p-4 text-white" style={{ background: accent }}>
            <p className="text-sm font-bold">⭐ Programa de fidelidade</p>
            <p className="mt-0.5 text-xs opacity-90">
              {status?.ativo ? 'Acompanhe seus pontos e resgate seus prêmios.' : 'Confirme seu telefone (Meus dados) para acumular pontos.'}
            </p>
          </div>

          {/* Prêmios disponíveis para resgate */}
          {disponiveis.length > 0 && (
            <div className="space-y-2">
              {disponiveis.map((r: any) => (
                <div key={r.id} className="flex items-center gap-3 rounded-xl border-2 border-dashed p-3" style={{ borderColor: accent }}>
                  <span className="text-2xl">🎁</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{r.plano}</p>
                    <p className="text-xs text-black/60">
                      {r.recompensa}
                      {r.prazoEm ? ` · resgate até ${new Date(r.prazoEm).toLocaleDateString('pt-BR')}` : ''}
                    </p>
                  </div>
                  <button type="button" onClick={() => resgatar(r.id)} className="flex-none rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ background: accent }}>
                    Resgatar
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Prêmios resgatados aguardando uso (aplicam no próximo pedido) */}
          {naCarteira.length > 0 && (
            <div className="space-y-1.5">
              {naCarteira.map((r: any) => (
                <div key={r.id} className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  <span>✅</span>
                  <span className="min-w-0 flex-1"><b>{r.plano}</b> · {r.recompensa} — aplica no seu próximo pedido</span>
                </div>
              ))}
            </div>
          )}

          {/* Progresso dos planos */}
          {(status?.planos ?? []).map((p: any) => (
            <div key={p.id} className="rounded-xl border border-black/10 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{p.nome}</span>
                <span className="font-mono text-xs text-black/60">{p.pontos}/{p.pontosMeta} pts</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (p.pontos / p.pontosMeta) * 100)}%`, background: accent }} />
              </div>
              <p className="mt-1 text-[11px] text-black/50">Prêmio: {p.recompensa}</p>
            </div>
          ))}
        </div>
      )}

      {(data?.cupons?.length ?? 0) > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Cupons</p>
          <div className="space-y-2">
            {data.cupons.map((c: any) => (
              <div key={c.codigo} className="flex items-center gap-3 rounded-xl border border-dashed border-black/20 px-3.5 py-2.5">
                <span className="text-xl">🎟️</span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold" style={{ color: accent }}>{c.codigo}</p>
                  <p className="text-xs text-black/50">
                    {cupomLabel(c)}
                    {c.minimo ? ` · mín. ${brl(c.minimo)}` : ''}
                    {c.validade ? ` · até ${new Date(c.validade).toLocaleDateString('pt-BR')}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(c.codigo)}
                  className="flex-none rounded-lg border border-black/15 px-2.5 py-1 text-xs font-semibold"
                >
                  copiar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {produtosPromo.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Ofertas do dia</p>
          <div className="space-y-2">
            {produtosPromo.map((p: any) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-black/10 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.nome}</p>
                  <p className="text-xs">
                    <span className="font-bold" style={{ color: accent }}>{brl(p.precoVenda)}</span>{' '}
                    <span className="text-black/40 line-through">{brl(p.precoDe)}</span>
                  </p>
                </div>
                <span className="flex-none rounded-lg px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: accent }}>
                  -{Math.round((1 - p.precoVenda / p.precoDe) * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {nada && <p className="text-sm text-black/50">Nenhuma promoção ativa no momento.</p>}
    </div>
  );
}
