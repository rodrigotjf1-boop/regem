'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UltimoEnvioIfood } from '@/components/produtos/ultimo-envio-ifood';

/* eslint-disable @typescript-eslint/no-explicit-any */

const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// iFood pelo Orzuni (mig 369) — só aparece com o direito `ifood_pelo_orzuni` ligado na empresa.
// O preço no iFood é guardado À PARTE do preço do Regem (preços diferentes por canal). A ligação com o
// item do iFood é pelo código PDV do produto. O envio (R2a, mig 370): a mudança entra na fila na mesma
// gravação e sai para o iFood das lojas ligadas ao Orzuni; o texto diz só o que o servidor faz (V39).
// R2b: com o produto já salvo (`produtoId`), mostra o "último envio ao iFood" por loja.
export function IfoodFields({ f, set, produtoId }: { f: any; set: (patch: any) => void; produtoId?: string | null }) {
  const codigo = String(f.codigo ?? '').trim();
  const precoRegem = Number(String(f.precoVenda ?? '').replace(',', '.'));
  return (
    <section aria-labelledby="secao-ifood" className="rounded-xl border border-border bg-card p-4">
      <h3 id="secao-ifood" className="mb-3 font-display text-sm font-bold">
        iFood
      </h3>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={f.noIfood === true}
          onChange={(e) => set({ noIfood: e.target.checked })}
          className="h-4 w-4 accent-primary"
        />
        Está no cardápio do iFood
      </label>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="preco-ifood" className="text-xs">
            Preço no iFood (R$)
          </Label>
          <Input
            id="preco-ifood"
            inputMode="decimal"
            value={f.precoIfood ?? ''}
            onChange={(e) => set({ precoIfood: e.target.value })}
            placeholder="em branco = sem preço próprio"
            aria-describedby="preco-ifood-ajuda"
          />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium">No Regem</p>
          <p className="flex h-11 items-center rounded-md border border-dashed border-border px-3 font-mono text-sm">
            {Number.isFinite(precoRegem) && String(f.precoVenda ?? '') !== '' ? brl(precoRegem) : '—'}
          </p>
        </div>
      </div>
      <p id="preco-ifood-ajuda" className="mt-2 text-[11px] text-muted-foreground">
        Guardado à parte do preço do Regem. Ao salvar, o Regem manda este preço ao iFood das lojas ligadas ao Orzuni; em
        branco, não mexe no preço de lá. Pausar o produto (&quot;Ativo no iFood&quot; ou esgotado) também pausa no iFood.
      </p>
      {codigo ? (
        <p className="mt-2 break-all text-[11px] text-muted-foreground">
          Ligação com o iFood pelo código PDV <strong className="font-mono text-foreground">{codigo}</strong>.
        </p>
      ) : (
        <p className="mt-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5 text-xs text-foreground">
          Sem código PDV, o Regem não acha este produto no iFood. Preencha o &quot;Código / SKU (PDV)&quot; em
          Identificação.
        </p>
      )}
      {produtoId && <UltimoEnvioIfood alvo="produto" id={produtoId} />}
    </section>
  );
}
