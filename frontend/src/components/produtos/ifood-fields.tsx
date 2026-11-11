'use client';

import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UltimoEnvioIfood } from '@/components/produtos/ultimo-envio-ifood';
import { linkDaGestao } from '@/lib/cadastro-onde-vende';

/* eslint-disable @typescript-eslint/no-explicit-any */

const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// iFood pelo Orzuni (mig 369) — só aparece com o direito `ifood_pelo_orzuni` ligado na empresa.
// O preço no iFood é guardado À PARTE do preço do Regem (preços diferentes por canal). A ligação com o
// item do iFood é pelo código PDV do produto. O envio (R2a, mig 370): a mudança entra na fila na mesma
// gravação e sai para o iFood das lojas ligadas ao Orzuni; o texto diz só o que o servidor faz (V39).
// R2b: com o produto já salvo (`produtoId`), mostra o "último envio ao iFood" por loja.
// "Pausado no iFood" (mig 371) = o canal 'ifood' em `canais_pausados`: pausa SÓ no iFood (desde a mig 399, tirar do
// balcão e do cardápio digital não mexe no iFood).
// R3 F7: ao CRIAR, o "Está no iFood" fica no "Onde vende" do formulário (aqui só o preço); ao EDITAR, o preço do iFood
// muda só em Delivery › Gestão do catálogo — aqui ele aparece para ler, com o atalho.
export function IfoodFields({ f, set, produtoId }: { f: any; set: (patch: any) => void; produtoId?: string | null }) {
  const editando = !!produtoId;
  const codigo = String(f.codigo ?? '').trim();
  const precoRegem = Number(String(f.precoVenda ?? '').replace(',', '.'));
  const precoIfood = Number(String(f.precoIfood ?? '').replace(',', '.'));
  const pausados: string[] = Array.isArray(f.canaisPausados) ? f.canaisPausados : [];
  const pausadoNoIfood = pausados.includes('ifood');
  const setPausado = (pausar: boolean) =>
    set({ canaisPausados: pausar ? [...pausados.filter((c) => c !== 'ifood'), 'ifood'] : pausados.filter((c) => c !== 'ifood') });
  const valorFixo = (texto: string) => (
    <p className="flex h-11 items-center rounded-md border border-dashed border-border px-3 font-mono text-sm">{texto}</p>
  );
  return (
    <section aria-labelledby="secao-ifood" className="rounded-xl border border-border bg-card p-4">
      <h3 id="secao-ifood" className="mb-3 font-display text-sm font-bold">
        iFood
      </h3>
      {editando && (
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f.noIfood === true}
              onChange={(e) => set({ noIfood: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            Está no cardápio do iFood
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pausadoNoIfood}
              onChange={(e) => setPausado(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Pausado no iFood
          </label>
        </div>
      )}
      <div className={`${editando ? 'mt-3 ' : ''}grid grid-cols-1 gap-3 sm:grid-cols-2`}>
        <div className="min-w-0 space-y-1">
          {editando ? (
            <>
              <p className="text-xs font-medium">Preço no iFood</p>
              {valorFixo(String(f.precoIfood ?? '').trim() !== '' && Number.isFinite(precoIfood) ? brl(precoIfood) : 'sem preço próprio')}
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium">No Regem</p>
          {valorFixo(Number.isFinite(precoRegem) && String(f.precoVenda ?? '') !== '' ? brl(precoRegem) : '—')}
        </div>
      </div>
      {editando ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          O preço no iFood muda em{' '}
          <Link href={linkDaGestao(f.nome)} className="font-semibold text-foreground underline underline-offset-2">
            Delivery › Gestão do catálogo
          </Link>
          , que manda ao iFood das lojas ligadas ao Orzuni. &quot;Pausado no iFood&quot; pausa só lá; esgotar o estoque também
          pausa no iFood. Tirar o produto do balcão e do cardápio digital não mexe no iFood.
        </p>
      ) : (
        <p id="preco-ifood-ajuda" className="mt-2 text-[11px] text-muted-foreground">
          Guardado à parte do preço do Regem. Ao criar, o Regem manda este preço ao iFood das lojas ligadas ao Orzuni (com o
          iFood marcado em &quot;Onde vende&quot; e o código PDV); em branco, não mexe no preço de lá. Depois de criado, o preço muda em Delivery ›
          Gestão do catálogo.
        </p>
      )}
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
