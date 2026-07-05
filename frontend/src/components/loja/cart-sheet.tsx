'use client';

import { brl, type CartItem } from '@/components/loja/tipos';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PG_LBL: Record<string, string> = {
  pix: '⚡ Pix online',
  cartao: '💳 Cartão online',
  entrega: '💵 Na entrega',
  vr: '🍽 Vale-refeição',
};

export function CartSheet({
  accent,
  loja,
  bairros,
  cart,
  upsell,
  isServico,
  isIndustria,
  total,
  taxa,
  desc,
  totalFinal,
  chk,
  setChk,
  cupomOk,
  onAplicarCupom,
  onQtd,
  onRemove,
  onAddUpsell,
  onClose,
  onSubmit,
  enviando,
}: {
  accent: string;
  loja: any;
  bairros: any[];
  cart: CartItem[];
  upsell: any[];
  isServico: boolean;
  isIndustria: boolean;
  total: number;
  taxa: number;
  desc: number;
  totalFinal: number;
  chk: any;
  setChk: (fn: (s: any) => any) => void;
  cupomOk: any;
  onAplicarCupom: () => void;
  onQtd: (key: string, d: number) => void;
  onRemove: (key: string) => void;
  onAddUpsell: (p: any) => void;
  onClose: () => void;
  onSubmit: () => void;
  enviando: boolean;
}) {
  const set = (patch: any) => setChk((s: any) => ({ ...s, ...patch }));
  const freteGratis = loja.freteGratisAcima != null;
  const falta = freteGratis ? Math.max(0, loja.freteGratisAcima - total) : 0;
  const pct = freteGratis ? Math.min(100, (total / loja.freteGratisAcima) * 100) : 0;
  const bairroSel = bairros.find((b) => b.id === chk.bairroId);
  const agendar = isServico || chk.quando === 'agendar';

  const cta = isIndustria ? 'Solicitar orçamento' : isServico ? 'Confirmar agendamento' : chk.tipo === 'entrega' ? 'Fazer pedido' : 'Confirmar pedido';
  const submitDesabilitado =
    enviando ||
    cart.length === 0 ||
    (!isIndustria && (loja.pagamentos ?? []).length > 0 && !chk.forma) ||
    (agendar && !chk.agendamento) ||
    (chk.tipo === 'entrega' && (!chk.rua || !chk.bairroId)) ||
    !((chk.nome ?? '').trim()) ||
    !((chk.telefone ?? '').trim());

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white text-neutral-900" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-neutral-100 bg-white px-4 py-3">
          <h2 className="text-lg font-bold">Seu pedido</h2>
          <button type="button" onClick={onClose} className="text-neutral-400">✕</button>
        </div>

        <div className="p-4">
          {/* linhas do carrinho */}
          {cart.map((i) => (
            <div key={i.key} className="flex items-start gap-3 border-b border-neutral-100 py-3">
              <div className="flex items-center overflow-hidden rounded-lg border border-neutral-200">
                <button type="button" onClick={() => onQtd(i.key, -1)} className="grid h-8 w-8 place-items-center text-lg font-bold" style={{ color: accent }}>−</button>
                <span className="w-7 text-center font-mono text-sm font-bold">{i.qtd}</span>
                <button type="button" onClick={() => onQtd(i.key, 1)} className="grid h-8 w-8 place-items-center text-lg font-bold" style={{ color: accent }}>+</button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{i.nome}</p>
                {(i.sub || i.obs) && (
                  <p className="text-xs text-neutral-500">{[i.sub, i.obs && `Obs: ${i.obs}`].filter(Boolean).join(' · ')}</p>
                )}
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-bold">{brl(i.preco * i.qtd)}</p>
                <button type="button" onClick={() => onRemove(i.key)} className="text-xs text-red-500">remover</button>
              </div>
            </div>
          ))}

          {/* barra de frete grátis */}
          {freteGratis && chk.tipo === 'entrega' && (
            <div className="mt-4 rounded-xl border border-neutral-200 p-3">
              <p className="text-xs font-semibold">
                {falta > 0 ? <>Faltam <b className="font-mono" style={{ color: accent }}>{brl(falta)}</b> para o frete grátis 🛵</> : '🎉 Você ganhou frete grátis!'}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--ok, #1FA875)' }} />
              </div>
            </div>
          )}

          {/* upsell "peça também" */}
          {upsell.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-sm font-bold">Peça também 👇</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {upsell.map((u) => (
                  <div key={u.id} className="w-28 flex-none rounded-xl border border-neutral-200 p-2 text-center">
                    <div className="grid h-14 place-items-center text-2xl">{u.imagemRef ? '🛒' : '🍽'}</div>
                    <p className="line-clamp-2 text-[11px] font-semibold leading-tight">{u.nome}</p>
                    <p className="font-mono text-[11px] text-neutral-500">{brl(u.precoVenda)}</p>
                    <button type="button" onClick={() => onAddUpsell(u)} className="mt-1.5 w-full rounded-lg py-1 text-[11px] font-bold text-white" style={{ background: accent }}>+ Adicionar</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* cupom */}
          <div className="mt-4 flex gap-2">
            <input value={chk.cupom} onChange={(e) => set({ cupom: e.target.value.toUpperCase() })} placeholder="CUPOM" className="flex-1 rounded-xl border border-neutral-200 px-3 py-2 font-mono text-sm uppercase tracking-wider" disabled={cupomOk?.valido} />
            <button type="button" onClick={onAplicarCupom} className="rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white">{cupomOk?.valido ? '✓ Aplicado' : 'Aplicar'}</button>
          </div>
          {cupomOk && <p className={`mt-1 text-xs ${cupomOk.valido ? 'text-emerald-600' : 'text-red-600'}`}>{cupomOk.valido ? `Cupom aplicado: −${brl(cupomOk.desconto)}` : cupomOk.motivo ?? 'Cupom inválido'}</p>}

          {/* entrega / retirada */}
          {!isServico && (
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-neutral-200 p-1">
              {[['entrega', '🛵 Entrega'], ['retirada', '🏃 Retirada']].map(([t, l]) => (
                <button key={t} type="button" onClick={() => set({ tipo: t })} className="rounded-lg py-2 text-sm font-bold" style={chk.tipo === t ? { background: accent, color: '#fff' } : { color: '#666' }}>{l}</button>
              ))}
            </div>
          )}

          {/* endereço estruturado (entrega) */}
          {!isServico && chk.tipo === 'entrega' && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2">
                <input value={chk.rua} onChange={(e) => set({ rua: e.target.value })} placeholder="Rua / Avenida" className="flex-[2] rounded-xl border border-neutral-200 px-3 py-2.5 text-base" />
                <input value={chk.numero} onChange={(e) => set({ numero: e.target.value })} placeholder="Nº" className="flex-1 rounded-xl border border-neutral-200 px-3 py-2.5 text-base" />
              </div>
              <input value={chk.referencia} onChange={(e) => set({ referencia: e.target.value })} placeholder="Ponto de referência (opcional)" className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-base" />
              <select aria-label="Bairro" value={chk.bairroId} onChange={(e) => set({ bairroId: e.target.value })} className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-base">
                <option value="">Selecione o bairro (área de entrega)</option>
                {bairros.map((b) => <option key={b.id} value={b.id}>{b.nome} — {brl(b.taxa)}</option>)}
              </select>
              {bairros.length === 0 && <p className="text-xs text-amber-600">Nenhuma área de entrega cadastrada nas configurações do cardápio.</p>}
            </div>
          )}

          {/* nome + telefones (nome pré-preenchido pelo aparelho/fidelidade) */}
          <div className="mt-3 space-y-2">
            <input value={chk.nome ?? ''} onChange={(e) => set({ nome: e.target.value })} placeholder="Seu nome" className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-base" />
            <div className="flex gap-2">
              <input value={chk.telefone ?? ''} onChange={(e) => set({ telefone: e.target.value })} inputMode="tel" placeholder="WhatsApp (principal)" className="flex-1 rounded-xl border border-neutral-200 px-3 py-2.5 text-base" />
              <input value={chk.telefone2 ?? ''} onChange={(e) => set({ telefone2: e.target.value })} inputMode="tel" placeholder="Telefone 2 (opcional)" className="flex-1 rounded-xl border border-neutral-200 px-3 py-2.5 text-base" />
            </div>
          </div>

          {/* quando / agendamento */}
          {!isIndustria && (
            <div className="mt-3">
              {!isServico && (
                <select aria-label="Quando" value={chk.quando} onChange={(e) => set({ quando: e.target.value, agendamento: e.target.value === 'agora' ? '' : chk.agendamento })} className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-base">
                  <option value="agora">O quanto antes {loja.tempoEntregaMin ? `(~${loja.tempoEntregaMin} min)` : ''}</option>
                  <option value="agendar">Agendar dia e hora</option>
                </select>
              )}
              {agendar && (
                <input type="datetime-local" aria-label="Data e hora do agendamento" value={chk.agendamento} onChange={(e) => set({ agendamento: e.target.value })} className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-base" />
              )}
              {isServico && (
                <input value={chk.profissional} onChange={(e) => set({ profissional: e.target.value })} placeholder="Profissional (opcional)" className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-base" />
              )}
            </div>
          )}

          {/* indústria: CNPJ */}
          {isIndustria && (
            <input value={chk.cnpj} onChange={(e) => set({ cnpj: e.target.value })} placeholder="CNPJ para faturamento" className="mt-3 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-base" />
          )}

          {/* pagamento */}
          {!isIndustria && (loja.pagamentos ?? []).length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-sm font-semibold">Pagamento</p>
              <div className="grid grid-cols-2 gap-2">
                {(loja.pagamentos ?? []).map((pg: string) => (
                  <button key={pg} type="button" onClick={() => set({ forma: pg })} className="rounded-xl border py-2.5 text-xs font-semibold" style={chk.forma === pg ? { borderColor: accent, color: accent } : { borderColor: '#e5e5e5', color: '#666' }}>{PG_LBL[pg] ?? pg}</button>
                ))}
              </div>
              {chk.forma === 'cartao' && loja.parcelasMax > 1 && <p className="mt-1 text-xs text-neutral-500">Em até {loja.parcelasMax}x no cartão.</p>}
              {chk.forma === 'entrega' && (
                <input value={chk.troco} onChange={(e) => set({ troco: e.target.value })} inputMode="decimal" placeholder="Troco para quanto?" className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-base" />
              )}
            </div>
          )}

          {/* totais */}
          <div className="mt-4 space-y-1 border-t border-neutral-200 pt-3 text-sm">
            <div className="flex justify-between text-neutral-500"><span>Subtotal</span><span className="font-mono">{brl(total)}</span></div>
            {desc > 0 && <div className="flex justify-between text-emerald-600"><span>Cupom</span><span className="font-mono">− {brl(desc)}</span></div>}
            {!isServico && chk.tipo === 'entrega' && <div className="flex justify-between text-neutral-500"><span>Frete {bairroSel ? `· ${bairroSel.nome}` : ''}</span><span className="font-mono">{taxa === 0 ? 'Grátis' : brl(taxa)}</span></div>}
            {loja.fidelidadeAtiva && !isIndustria && <div className="flex justify-between text-emerald-600"><span>Fidelidade</span><span className="font-mono">+ {Math.round(totalFinal)} pts</span></div>}
            <div className="flex justify-between text-base font-bold"><span>{isIndustria ? 'Estimativa' : 'Total'}</span><span className="font-mono">{brl(totalFinal)}</span></div>
          </div>

          <button type="button" onClick={onSubmit} disabled={submitDesabilitado} className="mt-4 flex w-full items-center justify-between rounded-xl px-5 py-3.5 font-bold text-white disabled:opacity-50" style={{ background: accent }}>
            <span>{enviando ? 'Enviando…' : cta}</span>
            <span className="font-mono">{brl(totalFinal)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
