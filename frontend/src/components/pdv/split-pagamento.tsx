'use client';

import { Input } from '@/components/ui/input';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export type LinhaPagto = { forma: string; valor: string };

// UI de pagamento com opção de DIVIDIR em mais de uma forma. Controlada pelo pai
// (forma única + toggle dividir + linhas). Reaproveitável em retirada/encomenda/delivery.
export function SplitPagamento({
  opcoes, total, formaUnica, onFormaUnica, dividir, onDividir, pagamentos, onPagamentos,
}: {
  opcoes: string[];
  total: number;
  formaUnica: string;
  onFormaUnica: (f: string) => void;
  dividir: boolean;
  onDividir: (v: boolean) => void;
  pagamentos: LinhaPagto[];
  onPagamentos: (p: LinhaPagto[]) => void;
}) {
  const somaCent = pagamentos.reduce((s, p) => s + Math.round((Number(String(p.valor).replace(',', '.')) || 0) * 100), 0);
  const restanteCent = Math.round(total * 100) - somaCent;
  const setLinha = (i: number, patch: Partial<LinhaPagto>) => onPagamentos(pagamentos.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const addLinha = () => onPagamentos([...pagamentos, { forma: opcoes[0], valor: restanteCent > 0 ? (restanteCent / 100).toFixed(2) : '' }]);
  const delLinha = (i: number) => onPagamentos(pagamentos.filter((_, j) => j !== i));
  return (
    <div className="mt-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={dividir} onChange={(e) => onDividir(e.target.checked)} />
        Dividir pagamento (mais de uma forma)
      </label>
      {!dividir ? (
        <>
          <label className="mt-2 block text-sm font-medium">Forma de pagamento</label>
          <select className="mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm" value={formaUnica} onChange={(e) => onFormaUnica(e.target.value)}>
            {opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </>
      ) : (
        <div className="mt-2 space-y-2">
          {pagamentos.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <select className="flex-1 rounded-lg border border-border bg-background p-2 text-sm" value={p.forma} onChange={(e) => setLinha(i, { forma: e.target.value })}>
                {opcoes.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <Input className="w-28 text-right" inputMode="decimal" placeholder="0,00" value={p.valor} onChange={(e) => setLinha(i, { valor: e.target.value })} aria-label="Valor da forma" />
              {pagamentos.length > 1 && <button type="button" onClick={() => delLinha(i)} className="px-1 text-destructive" aria-label="Remover forma">×</button>}
            </div>
          ))}
          <div className="flex items-center justify-between text-xs">
            <button type="button" onClick={addLinha} className="font-semibold text-primary">＋ adicionar forma</button>
            <span className={restanteCent === 0 ? 'text-ok' : 'text-warn'}>
              {restanteCent === 0 ? 'fecha o total ✓' : `${restanteCent > 0 ? 'falta' : 'excede'} ${brl(Math.abs(restanteCent) / 100)}`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Monta o array de pagamentos p/ enviar à API (undefined quando forma única).
export function montarPagamentos(dividir: boolean, pagamentos: LinhaPagto[]) {
  if (!dividir) return undefined;
  return pagamentos
    .map((p) => ({ forma: p.forma, valor: Number(String(p.valor).replace(',', '.')) || 0 }))
    .filter((p) => p.forma && p.valor > 0);
}
