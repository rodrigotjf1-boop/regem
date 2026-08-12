'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { selectCls, SELOS } from '@/components/produtos/types';
import { VariacoesEditor } from '@/components/produtos/variacoes-editor';
import { ComboEditor } from '@/components/produtos/combo-editor';
import { FiscalFields } from '@/components/produtos/fiscal-fields';

/* eslint-disable @typescript-eslint/no-explicit-any */

const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const FONTE_LABEL: Record<string, string> = {
  manual: 'override manual',
  ficha: 'da ficha técnica',
  estoque: 'custo médio do estoque',
};

// Seção com moldura + título (padrão do reprojeto do Cardápio).
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 font-display text-sm font-bold">{titulo}</h3>
      {children}
    </section>
  );
}

// Seção recolhível (fica fechada por padrão p/ não poluir).
function SecaoDobravel({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 font-display text-sm font-bold">
        <span className="text-muted-foreground transition-transform group-open:rotate-90">▸</span>
        {titulo}
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

export function ProdutoForm({
  f,
  set,
  editId,
  salvando,
  categorias,
  fichas,
  insumos,
  setores,
  produtos,
  verFin,
  catLabel,
  canaisAtivos = [],
  onSubmit,
}: {
  f: any;
  set: (patch: any) => void;
  editId: string | null;
  salvando: boolean;
  categorias: any[];
  fichas: any[];
  insumos: any[];
  setores: any[];
  produtos: any[] | null;
  verFin: boolean;
  catLabel: (c: any) => string;
  canaisAtivos?: { canal: string; label: string }[];
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  // "Ativo no <canal>" = o produto NÃO está na lista de canais pausados.
  const pausados: string[] = Array.isArray(f.canaisPausados) ? f.canaisPausados : [];
  const setCanal = (canal: string, ativo: boolean) => {
    const s = new Set(pausados);
    if (ativo) s.delete(canal);
    else s.add(canal);
    set({ canaisPausados: [...s] });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,240px)_1fr]">
        {/* ---------- Coluna esquerda: foto + status ---------- */}
        <div className="space-y-3">
          <div className="space-y-1.5 rounded-xl border border-border bg-card p-3">
            <Label className="text-xs text-muted-foreground">Foto do produto</Label>
            <ImageUpload value={f.imagemRef || undefined} onChange={(url) => set({ imagemRef: url })} alt={f.nome || 'produto'} />
            <p className="text-[11px] text-muted-foreground">Ideal <strong>quadrada 800×800</strong> (mín. 500×500). O cardápio recorta centralizado.</p>
          </div>

          <div className="rounded-xl border border-border bg-card p-3">
            <p className="mb-2 text-xs font-bold text-muted-foreground">Status</p>
            <label className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" checked={!!f.disponivelBalcao} onChange={(e) => set({ disponivelBalcao: e.target.checked })} className="h-4 w-4 accent-primary" />
              Ativo no balcão (PDV)
            </label>
            <label className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" checked={!!f.disponivelCardapio} onChange={(e) => set({ disponivelCardapio: e.target.checked })} className="h-4 w-4 accent-primary" />
              Ativo no cardápio digital
            </label>
            <label className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" checked={!!f.destaque} onChange={(e) => set({ destaque: e.target.checked })} className="h-4 w-4 accent-primary" />
              Destaque no cardápio
            </label>

            {/* Um toggle por integração de delivery ATIVA (ex.: "Ativo no iFood").
                Só aparece quando a integração está ligada em Delivery → Integrações. */}
            {canaisAtivos.length > 0 && (
              <div className="mt-2 border-t border-border pt-2">
                <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Canais de delivery</p>
                {canaisAtivos.map(({ canal, label }) => (
                  <label key={canal} className="flex items-center gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={!pausados.includes(canal)}
                      onChange={(e) => setCanal(canal, e.target.checked)}
                      className="h-4 w-4 accent-primary"
                    />
                    Ativo no {label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ---------- Coluna direita: campos agrupados ---------- */}
        <div className="min-w-0 space-y-4">
          <Secao titulo="Identificação">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Nome</Label>
                <Input value={f.nome} onChange={(e) => set({ nome: e.target.value })} required placeholder="Ex.: X-Burger" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Categoria *</Label>
                <select
                  className={selectCls}
                  required
                  aria-invalid={!f.categoriaId}
                  value={f.categoriaId}
                  onChange={(e) => set({ categoriaId: e.target.value })}
                >
                  <option value="">— selecione a categoria —</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>{catLabel(c)}</option>
                  ))}
                </select>
                {!f.categoriaId && (
                  <p className="text-[11px] text-destructive">Obrigatória: organiza o produto no cardápio e no PDV.</p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Código / SKU (PDV)</Label>
                <Input value={f.codigo} onChange={(e) => set({ codigo: e.target.value })} placeholder="p/ integrações" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Descrição</Label>
                <Input value={f.descricao} onChange={(e) => set({ descricao: e.target.value })} placeholder="Aparece no cardápio digital" />
              </div>
            </div>
          </Secao>

          <Secao titulo="Preço e custo">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Preço de venda (R$)</Label>
                <Input type="number" value={f.precoVenda} onChange={(e) => set({ precoVenda: e.target.value })} placeholder="0,00" required />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Preço promocional &quot;por&quot; (R$)</Label>
                <Input type="number" value={f.precoPromocional} onChange={(e) => set({ precoPromocional: e.target.value })} placeholder="opcional (menor que o de venda)" />
              </div>
              {/* Custo derivado (read-only) — só p/ quem vê financeiro (o servidor
                  nula o valor pros demais). Prioridade override→ficha→estoque. */}
              {verFin && (
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Custo (calculado)</Label>
                  {f.custoEfetivo != null ? (
                    <div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 text-sm">
                      <span className="font-mono font-semibold">{brl(Number(f.custoEfetivo))}</span>
                      <span className="ml-2 truncate text-xs text-muted-foreground">{FONTE_LABEL[f.custoFonte] ?? ''}</span>
                    </div>
                  ) : (
                    <div className="flex h-10 items-center rounded-md border border-dashed border-border px-3 text-xs text-muted-foreground">
                      {f.fichaId || f.itemId ? 'Calculado ao salvar' : 'Vincule uma ficha ou item de estoque'}
                    </div>
                  )}
                  <details>
                    <summary className="cursor-pointer text-[11px] text-muted-foreground">Override manual (avançado)</summary>
                    <Input type="number" className="mt-1" value={f.precoCusto} onChange={(e) => set({ precoCusto: e.target.value })} placeholder="vazio = usa o custo calculado" />
                  </details>
                </div>
              )}
            </div>
          </Secao>

          <Secao titulo="Origem do custo e produção">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Ficha técnica (preparado)</Label>
                <select className={selectCls} value={f.fichaId} onChange={(e) => set({ fichaId: e.target.value, itemId: e.target.value ? '' : f.itemId })}>
                  <option value="">— sem ficha —</option>
                  {fichas.map((fi) => (
                    <option key={fi.id} value={fi.id}>{fi.nome}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Item de estoque (revenda)</Label>
                <select className={selectCls} value={f.itemId || ''} onChange={(e) => set({ itemId: e.target.value, fichaId: e.target.value ? '' : f.fichaId })}>
                  <option value="">— não é revenda —</option>
                  {insumos.map((it) => (
                    <option key={it.id} value={it.id}>{it.nome}</option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">Industrializado (ex.: lata): custo e baixa vêm do estoque.</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo</Label>
                <select className={selectCls} value={f.tipo} onChange={(e) => set({ tipo: e.target.value })}>
                  <option value="simples">Simples</option>
                  <option value="variavel">Variável (tamanhos)</option>
                  <option value="combo">Combo</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unidade</Label>
                <Input value={f.unidadeMedida} onChange={(e) => set({ unidadeMedida: e.target.value })} placeholder="un" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Setor de produção (KDS)</Label>
                <select aria-label="Setor de produção" className={selectCls} value={f.setorProducaoId} onChange={(e) => set({ setorProducaoId: e.target.value })}>
                  <option value="">— nenhum —</option>
                  {setores.map((s) => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tempo de preparo (min)</Label>
                <Input type="number" value={f.tempoPreparoMin} onChange={(e) => set({ tempoPreparoMin: e.target.value })} placeholder="p/ cores do KDS" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Validade (dias)</Label>
                <Input type="number" value={f.validadeDias} onChange={(e) => set({ validadeDias: e.target.value })} placeholder="opcional" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.controlaEstoque} onChange={(e) => set({ controlaEstoque: e.target.checked })} className="h-4 w-4 accent-primary" />
                Controla estoque
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.vaiParaProducao} onChange={(e) => set({ vaiParaProducao: e.target.checked })} className="h-4 w-4 accent-primary" />
                Vai para produção (KDS)
              </label>
            </div>
          </Secao>

          <VariacoesEditor f={f} set={set} />

          {f.tipo === 'combo' && (
            <ComboEditor f={f} set={set} produtos={produtos} editId={editId} />
          )}

          <SecaoDobravel titulo="Cardápio digital (selos e opções)">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Duração (min) — serviços</Label>
                <Input type="number" value={f.duracaoMin} onChange={(e) => set({ duracaoMin: e.target.value })} placeholder="—" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Vende em múltiplos de (B2B)</Label>
                <Input type="number" value={f.vendaMultiplo} onChange={(e) => set({ vendaMultiplo: e.target.value })} placeholder="1" />
              </div>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.atacadoAtivo} onChange={(e) => set({ atacadoAtivo: e.target.checked })} className="h-4 w-4 accent-primary" />
              Ativar preço de atacado (desconto por volume)
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Com o atacado ligado, as faixas de desconto por quantidade (definidas ao editar o produto) valem no PDV e no cardápio.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SELOS.map((s) => {
                const on = f.selos.includes(s.v);
                return (
                  <button
                    key={s.v}
                    type="button"
                    onClick={() => set({ selos: on ? f.selos.filter((x: string) => x !== s.v) : [...f.selos, s.v] })}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    {s.l}
                  </button>
                );
              })}
            </div>
          </SecaoDobravel>

          {/* Peça também: sugestões vinculadas (prioridade sobre o automático). */}
          <SecaoDobravel titulo="Peça também (sugestões no cardápio)">
            <p className="mb-2 text-[11px] text-muted-foreground">
              Produtos sugeridos quando este entra no carrinho. Vazio → o cardápio sugere os mais pedidos automaticamente.
            </p>
            {(f.sugestoes ?? []).length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {(f.sugestoes ?? []).map((id: string) => {
                  const p = (produtos ?? []).find((x: any) => x.id === id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      {p?.nome ?? 'Produto'}
                      <button
                        type="button"
                        aria-label="Remover sugestão"
                        onClick={() => set({ sugestoes: (f.sugestoes ?? []).filter((s: string) => s !== id) })}
                        className="text-primary/70 hover:text-primary"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <select
              className={selectCls}
              aria-label="Adicionar produto sugerido"
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (id && !(f.sugestoes ?? []).includes(id)) set({ sugestoes: [...(f.sugestoes ?? []), id] });
              }}
            >
              <option value="">＋ Adicionar sugestão…</option>
              {(produtos ?? [])
                .filter((p: any) => p.id !== editId && !(f.sugestoes ?? []).includes(p.id))
                .map((p: any) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
            </select>
          </SecaoDobravel>

          <SecaoDobravel titulo="Fiscal (NCM, CFOP, PIS/COFINS…)">
            <FiscalFields f={f} set={set} />
          </SecaoDobravel>

          <div className="flex justify-end">
            <Button type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : editId ? 'Salvar alterações' : 'Cadastrar produto'}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
