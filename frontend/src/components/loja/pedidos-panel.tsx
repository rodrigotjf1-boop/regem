'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { brl, getClienteToken } from './tipos';

/* eslint-disable @typescript-eslint/no-explicit-any */

const hhmm = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;

// Rótulo + "tom" por status. `wait`/`active` = pedido em andamento (destaque);
// `done` = finalizado (fundo neutro). "Aguardando aceite" vem do status `novo`
// (se o auto-aceite estivesse ligado, o pedido já teria saído de `novo`).
const STATUS: Record<string, { label: string; tone: 'wait' | 'active' | 'done' }> = {
  novo: { label: 'Aguardando aceite', tone: 'wait' },
  confirmado: { label: 'Em preparo', tone: 'active' },
  preparo: { label: 'Em preparo', tone: 'active' },
  pronto: { label: 'Pronto', tone: 'active' },
  despachado: { label: 'Em rota', tone: 'active' },
  concluido: { label: 'Concluído', tone: 'done' },
  cancelado: { label: 'Cancelado', tone: 'done' },
};
const info = (s: string) => STATUS[s] ?? { label: s, tone: 'active' as const };
const finalizado = (s: string) => s === 'concluido' || s === 'cancelado';
// Cancelável enquanto ainda não saiu para entrega (alinhado ao backend).
const cancelavel = (s: string) => !['despachado', 'concluido', 'cancelado'].includes(s);

// Aba "Pedidos" (menu inferior): lista os pedidos do cliente — o atual em
// destaque com o status, e os finalizados em tom neutro. Clicar abre o detalhe.
export function PedidosPanel({
  token,
  accent,
  onClose,
  onEntrar,
  onPedirDeNovo,
}: {
  token: string;
  accent: string;
  onClose: () => void;
  onEntrar: () => void;
  onPedirDeNovo: (itens: any[]) => void;
}) {
  const [historico, setHistorico] = useState<any[] | null>(null);
  const [recorrencias, setRecorrencias] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const clienteToken = getClienteToken(token);

  const carregar = useCallback(async () => {
    const ct = getClienteToken(token);
    if (!ct) { setHistorico([]); return; }
    try {
      const p: any = await api.clientePerfil(token, ct);
      setHistorico(p?.historico ?? []);
    } catch {
      setHistorico([]);
    }
    try {
      const r: any = await api.cardapioRecorrencias(token, ct);
      setRecorrencias(Array.isArray(r) ? r : []);
    } catch {
      setRecorrencias([]);
    }
  }, [token]);

  const DIAS_LBL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  async function alterarRecorrencia(id: string, acao: 'pausar' | 'retomar' | 'cancelar') {
    const ct = getClienteToken(token);
    if (!ct) return;
    try {
      await api.cardapioAlterarRecorrencia(token, id, acao, ct);
      await carregar();
    } catch { /* silencioso */ }
  }

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 text-[#1a1a1a] shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Meus pedidos</h2>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-black/40">×</button>
        </div>

        {/* Sem identificação → aviso "entre para ver" (não abre OTP automático). */}
        {!clienteToken ? (
          <div className="py-6 text-center">
            <p className="text-sm text-black/60">Entre para ver seus pedidos.</p>
            <button type="button" onClick={onEntrar} className="mt-3 rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: accent }}>
              Entrar
            </button>
          </div>
        ) : historico === null ? (
          <p className="py-6 text-center text-sm text-black/40">Carregando…</p>
        ) : historico.length === 0 ? (
          <p className="py-6 text-center text-sm text-black/40">Você ainda não fez pedidos por aqui.</p>
        ) : (
          <div className="space-y-1.5">
            {recorrencias.length > 0 && (
              <div className="mb-2 rounded-xl border border-black/10 bg-neutral-50 p-3">
                <p className="mb-1.5 text-sm font-bold">🔁 Encomendas recorrentes</p>
                <div className="space-y-1.5">
                  {recorrencias.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate">
                          {(r.dias ?? []).map((d: number) => DIAS_LBL[d]).join(', ') || '—'}
                          {r.hora ? ` · ${String(r.hora).slice(0, 5)}` : ''} · {r.itens} item(ns)
                          {r.status === 'pausada' ? ' · pausada' : ''}
                        </p>
                      </div>
                      <div className="flex flex-none gap-1">
                        {r.status === 'ativa' ? (
                          <button type="button" onClick={() => alterarRecorrencia(r.id, 'pausar')} className="rounded-md border border-black/15 px-2 py-1 text-xs">Pausar</button>
                        ) : (
                          <button type="button" onClick={() => alterarRecorrencia(r.id, 'retomar')} className="rounded-md border border-black/15 px-2 py-1 text-xs">Retomar</button>
                        )}
                        <button type="button" onClick={() => alterarRecorrencia(r.id, 'cancelar')} className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600">Cancelar</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {historico.map((p: any) => {
              const it = info(p.status);
              const fin = finalizado(p.status);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSel(p)}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm ${
                    fin ? 'border-black/5 bg-neutral-50 text-black/60' : 'bg-white'
                  }`}
                  style={fin ? undefined : { borderColor: accent, boxShadow: `0 0 0 1px ${accent}` }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-semibold">
                      {p.numero ? `#${p.numero}` : 'Pedido'} · {brl(Number(p.total))}
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={fin ? { background: '#eee', color: '#777' } : { background: accent, color: '#fff' }}
                      >
                        {it.label}
                      </span>
                    </p>
                    <p className="truncate text-xs text-black/45">{hhmm(p.criadoEm)} · {(p.itens ?? []).length} item(ns)</p>
                  </div>
                  <span className="text-black/30">›</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {sel && (
        <PedidoDetalhe
          token={token}
          accent={accent}
          pedido={sel}
          onClose={() => setSel(null)}
          onPedirDeNovo={(itens) => { onPedirDeNovo(itens); onClose(); }}
          onMudou={() => { setSel(null); carregar(); }}
        />
      )}
    </div>
  );
}

// Detalhe do pedido: dados + ações (cancelar/alterar para o atual; pedir de novo
// para o finalizado). As solicitações abrem um chamado no sino da equipe.
function PedidoDetalhe({
  token,
  accent,
  pedido,
  onClose,
  onPedirDeNovo,
  onMudou,
}: {
  token: string;
  accent: string;
  pedido: any;
  onClose: () => void;
  onPedirDeNovo: (itens: any[]) => void;
  onMudou: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [alterar, setAlterar] = useState(false);
  const [detalhe, setDetalhe] = useState('');
  const ct = getClienteToken(token) ?? '';
  const it = info(pedido.status);
  const fin = finalizado(pedido.status);
  const desconto = Number(pedido.desconto ?? 0);
  const taxa = Number(pedido.taxaEntrega ?? 0);
  // Busca o status completo (traz agendamento + sinal + prazo de cancelamento).
  const [full, setFull] = useState<any>(null);
  useEffect(() => {
    api.cardapioStatus(token, pedido.id).then((r: any) => setFull(r)).catch(() => {});
  }, [token, pedido.id]);
  const ehEncomenda = !!(full?.agendamento || pedido.agendamento);
  const sinal = full?.sinal;
  const prazoCancel = sinal?.cancelavelAte ? new Date(sinal.cancelavelAte) : null;
  const foraPrazo = !!(prazoCancel && Date.now() > prazoCancel.getTime());

  async function cancelarEncomendaDireto() {
    setBusy(true); setErro('');
    try {
      const r: any = await api.cardapioCancelarEncomenda(token, pedido.id, ct);
      const reemb =
        r?.reembolso === 'estornado'
          ? ' O sinal foi estornado.'
          : r?.reembolso === 'estorno_pendente'
            ? ' O estorno do sinal está sendo processado pela loja.'
            : '';
      setMsg('Encomenda cancelada.' + reemb);
      setConfirmCancel(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível cancelar a encomenda.');
    } finally {
      setBusy(false);
    }
  }

  async function pedirDeNovo() {
    setBusy(true); setErro('');
    try {
      const r: any = await api.clientePedirDeNovo(token, pedido.id, ct);
      onPedirDeNovo(r.itens ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível repetir o pedido.');
    } finally {
      setBusy(false);
    }
  }
  async function solicitarCancel() {
    setBusy(true); setErro('');
    try {
      const r: any = await api.clienteSolicitarCancelamento(token, pedido.id, ct);
      const av = Array.isArray(r?.avisos) && r.avisos.length ? ' ' + r.avisos.join(' ') : '';
      setMsg('Pedido de cancelamento enviado. A equipe vai avaliar e responder.' + av);
      setConfirmCancel(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível solicitar o cancelamento.');
    } finally {
      setBusy(false);
    }
  }
  async function solicitarAlteracao(alvo: string) {
    setBusy(true); setErro('');
    try {
      await api.clienteSolicitarAlteracao(token, pedido.id, ct, alvo, detalhe);
      setMsg('Solicitação enviada. A equipe vai verificar e falar com você.');
      setAlterar(false); setDetalhe('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar a solicitação.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-5 text-[#1a1a1a] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <p className="font-bold">Pedido {pedido.numero ? `#${pedido.numero}` : ''}</p>
          <button type="button" onClick={onClose} className="text-2xl leading-none text-black/40">×</button>
        </div>

        <span
          className="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold"
          style={fin ? { background: '#eee', color: '#777' } : { background: accent, color: '#fff' }}
        >
          {it.label}
        </span>

        {!fin && full?.codigoEntrega && (
          <div
            className="mt-3 rounded-xl border-2 p-3 text-center"
            style={{ borderColor: accent, background: `${accent}14` }}
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-black/55">Código de entrega</p>
            <p className="my-0.5 font-mono text-3xl font-extrabold tracking-[0.25em]" style={{ color: accent }}>
              {full.codigoEntrega}
            </p>
            <p className="text-[11px] text-black/55">Informe ao entregador para confirmar o recebimento.</p>
          </div>
        )}

        <div className="mt-2 space-y-0.5 text-xs text-black/60">
          {hhmm(pedido.criadoEm) && <p>🕐 Feito em: {hhmm(pedido.criadoEm)}</p>}
          {hhmm(pedido.despachadoEm) && <p>🛵 Saiu para entrega: {hhmm(pedido.despachadoEm)}</p>}
          {hhmm(pedido.concluidoEm) && <p>✅ Concluído: {hhmm(pedido.concluidoEm)}</p>}
          {hhmm(pedido.canceladoEm) && <p>✕ Cancelado: {hhmm(pedido.canceladoEm)}</p>}
          {(pedido.formaPagamento || pedido.bandeira) && <p>💳 Pagamento: {pedido.bandeira || pedido.formaPagamento}</p>}
        </div>

        <div className="mt-3 border-t border-black/10 pt-2">
          {(pedido.itens ?? []).map((i: any, k: number) => (
            <div key={k} className="flex justify-between text-sm">
              <span className="min-w-0 truncate">{i.quantidade}× {i.descricao ?? i.nome}</span>
              <span className="flex-none text-black/50">{brl(Number(i.precoUnitario ?? 0) * Number(i.quantidade ?? 1))}</span>
            </div>
          ))}
        </div>

        <div className="mt-2 space-y-0.5 border-t border-black/10 pt-2 text-sm">
          {taxa > 0 && <div className="flex justify-between text-black/60"><span>Taxa de entrega</span><span>{brl(taxa)}</span></div>}
          {desconto > 0 && <div className="flex justify-between text-emerald-600"><span>Desconto{pedido.cupom ? ` (${pedido.cupom})` : ''}</span><span>− {brl(desconto)}</span></div>}
          <div className="flex justify-between font-bold"><span>Total</span><span>{brl(Number(pedido.total))}</span></div>
        </div>

        {msg && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
        {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}

        {/* Ações */}
        {!msg && (
          <div className="mt-4 space-y-2">
            {fin ? (
              <button type="button" onClick={pedirDeNovo} disabled={busy} className="w-full rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{ background: accent }}>
                {busy ? '…' : 'Pedir de novo'}
              </button>
            ) : (
              <>
                {/* Solicitar alteração */}
                {alterar ? (
                  <div className="rounded-lg border border-black/10 p-3">
                    <p className="mb-2 text-sm font-semibold">O que você quer alterar?</p>
                    <textarea
                      value={detalhe}
                      onChange={(e) => setDetalhe(e.target.value)}
                      placeholder="Detalhe (opcional): ex. trocar troco, mudar rua…"
                      className="mb-2 min-h-[52px] w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                    />
                    <div className="grid grid-cols-1 gap-1.5">
                      <button type="button" disabled={busy} onClick={() => solicitarAlteracao('endereco')} className="rounded-lg border border-black/15 py-2 text-sm font-semibold disabled:opacity-60">📍 Endereço de entrega</button>
                      <button type="button" disabled={busy} onClick={() => solicitarAlteracao('pedido')} className="rounded-lg border border-black/15 py-2 text-sm font-semibold disabled:opacity-60">🍔 Itens do pedido</button>
                      <button type="button" disabled={busy} onClick={() => solicitarAlteracao('pagamento')} className="rounded-lg border border-black/15 py-2 text-sm font-semibold disabled:opacity-60">💳 Forma de pagamento</button>
                    </div>
                    <button type="button" onClick={() => setAlterar(false)} className="mt-2 w-full text-xs text-black/50 underline">cancelar</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => { setAlterar(true); setErro(''); }} className="w-full rounded-lg border border-black/15 py-2.5 text-sm font-semibold">
                    Solicitar alteração
                  </button>
                )}

                {/* Encomenda: cancelamento DIRETO com estorno do sinal dentro do prazo. */}
                {ehEncomenda ? (
                  foraPrazo ? (
                    <p className="rounded-lg border border-black/10 bg-neutral-50 px-3 py-2 text-xs text-black/50">
                      O prazo para cancelar com reembolso já passou. Fale com a loja se precisar.
                    </p>
                  ) : (
                    confirmCancel ? (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                        <p className="text-sm text-red-700">
                          Cancelar esta encomenda?
                          {sinal?.status === 'pago' && sinal?.valor != null && (
                            <> O sinal de <b>{brl(Number(sinal.valor))}</b> será estornado.</>
                          )}
                          {prazoCancel && (
                            <> Prazo até {prazoCancel.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.</>
                          )}
                        </p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => setConfirmCancel(false)} className="rounded-lg border border-black/15 py-2 text-sm font-semibold">Voltar</button>
                          <button type="button" disabled={busy} onClick={cancelarEncomendaDireto} className="rounded-lg bg-red-600 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? '…' : 'Cancelar encomenda'}</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => { setConfirmCancel(true); setErro(''); }} className="w-full rounded-lg border border-red-200 py-2.5 text-sm font-semibold text-red-600">
                        Cancelar encomenda
                      </button>
                    )
                  )
                ) : (
                  /* Pedido normal: solicita cancelamento à equipe (chamado no sino). */
                  cancelavel(pedido.status) && (
                    confirmCancel ? (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                        <p className="text-sm text-red-700">Enviar pedido de cancelamento à equipe? Eles vão avaliar e responder.</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => setConfirmCancel(false)} className="rounded-lg border border-black/15 py-2 text-sm font-semibold">Voltar</button>
                          <button type="button" disabled={busy} onClick={solicitarCancel} className="rounded-lg bg-red-600 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? '…' : 'Confirmar'}</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => { setConfirmCancel(true); setErro(''); }} className="w-full rounded-lg border border-red-200 py-2.5 text-sm font-semibold text-red-600">
                        Solicitar cancelamento
                      </button>
                    )
                  )
                )}
              </>
            )}
          </div>
        )}

        {msg && (
          <button type="button" onClick={onMudou} className="mt-4 w-full rounded-lg py-2.5 text-sm font-semibold text-white" style={{ background: accent }}>
            Fechar
          </button>
        )}
      </div>
    </div>
  );
}
