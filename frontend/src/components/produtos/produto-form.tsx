'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { selectCls } from '@/components/produtos/types';
import { LojaFields } from '@/components/produtos/loja-fields';
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
  onSubmit,
  onCancel,
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
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">
          {editId ? 'Editar produto' : 'Novo produto'}
        </h2>
        {editId && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancelar edição
          </Button>
        )}
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Nome</Label>
            <Input value={f.nome} onChange={(e) => set({ nome: e.target.value })} required placeholder="Ex.: X-Burger" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Código / SKU</Label>
            <Input value={f.codigo} onChange={(e) => set({ codigo: e.target.value })} placeholder="p/ integrações" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">Descrição</Label>
            <Input value={f.descricao} onChange={(e) => set({ descricao: e.target.value })} />
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
              <p className="text-[11px] text-destructive">
                Obrigatória: organiza o produto no cardápio digital e no balcão/PDV.
              </p>
            )}
          </div>
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
            <Label className="text-xs">Preço de venda (R$)</Label>
            <Input type="number" value={f.precoVenda} onChange={(e) => set({ precoVenda: e.target.value })} placeholder="0,00" required />
          </div>
          {/* Custo derivado (read-only) — só p/ quem vê financeiro (o servidor
              nula o valor pros demais). A fonte segue a prioridade override→
              ficha→estoque. O override manual fica como opção avançada. */}
          {verFin && (
            <div className="space-y-1">
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
                <Input
                  type="number"
                  className="mt-1"
                  value={f.precoCusto}
                  onChange={(e) => set({ precoCusto: e.target.value })}
                  placeholder="vazio = usa o custo calculado"
                />
              </details>
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Validade (dias)</Label>
            <Input type="number" value={f.validadeDias} onChange={(e) => set({ validadeDias: e.target.value })} placeholder="opcional" />
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
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.controlaEstoque} onChange={(e) => set({ controlaEstoque: e.target.checked })} className="h-4 w-4 accent-primary" />
            Controla estoque
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.vaiParaProducao} onChange={(e) => set({ vaiParaProducao: e.target.checked })} className="h-4 w-4 accent-primary" />
            Vai para produção (KDS)
          </label>
        </div>

        {/* Controle de validade — fonte das etiquetas (RDC 216). */}
        <div className="rounded-lg border border-border p-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={!!f.controlaValidade}
              onChange={(e) => set({ controlaValidade: e.target.checked })}
              className="h-4 w-4 accent-primary"
            />
            Controla validade (gera etiqueta)
          </label>
          {f.controlaValidade && (
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Validade fechado (dias)</Label>
                <Input
                  type="number"
                  value={f.validadeFechadoDias ?? ''}
                  onChange={(e) => set({ validadeFechadoDias: e.target.value })}
                  placeholder="ex.: 90"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Validade após aberto (dias)</Label>
                <Input
                  type="number"
                  value={f.validadeAbertoDias ?? ''}
                  onChange={(e) => set({ validadeAbertoDias: e.target.value })}
                  placeholder="RDC 216: até 30"
                />
              </div>
            </div>
          )}
        </div>

        {/* Canais de venda: onde o produto aparece. */}
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-bold text-muted-foreground">
            Canais de venda
          </p>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.disponivelBalcao} onChange={(e) => set({ disponivelBalcao: e.target.checked })} className="h-4 w-4 accent-primary" />
              Vendas do balcão (PDV)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.disponivelCardapio} onChange={(e) => set({ disponivelCardapio: e.target.checked })} className="h-4 w-4 accent-primary" />
              Vendas cardápio digital
            </label>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Desmarque um canal para o produto não aparecer nele.
          </p>
        </div>

        <LojaFields f={f} set={set} />

        <VariacoesEditor f={f} set={set} />

        {f.tipo === 'combo' && (
          <ComboEditor f={f} set={set} produtos={produtos} editId={editId} />
        )}

        {/* Peça também: sugestões vinculadas (prioridade sobre o automático). */}
        <div className="space-y-1.5 rounded-lg border border-border p-3">
          <Label className="text-xs font-semibold">Peça também (sugestões no cardápio)</Label>
          <p className="text-[11px] text-muted-foreground">
            Produtos sugeridos quando este entra no carrinho. Vazio → o cardápio sugere os mais pedidos automaticamente.
          </p>
          {(f.sugestoes ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
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
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
          </select>
        </div>

        <FiscalFields f={f} set={set} />

        <Button type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : editId ? 'Salvar alterações' : 'Cadastrar produto'}
        </Button>
      </form>
    </Card>
  );
}
