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
  }, [token]);

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
      await api.clienteSolicitarCancelamento(token, pedido.id, ct);
      setMsg('Pedido de cancelamento enviado. A equipe vai avaliar e responder.');
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

                {/* Solicitar cancelamento (enquanto ainda dá) */}
                {cancelavel(pedido.status) && (
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
