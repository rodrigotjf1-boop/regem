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

export function ProdutoForm({
  f,
  set,
  editId,
  salvando,
  categorias,
  fichas,
  setores,
  produtos,
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
  setores: any[];
  produtos: any[] | null;
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
            <Label className="text-xs">Categoria</Label>
            <select className={selectCls} value={f.categoriaId} onChange={(e) => set({ categoriaId: e.target.value })}>
              <option value="">— sem categoria —</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{catLabel(c)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Ficha técnica (baixa de estoque)</Label>
            <select className={selectCls} value={f.fichaId} onChange={(e) => set({ fichaId: e.target.value })}>
              <option value="">— sem ficha —</option>
              {fichas.map((fi) => (
                <option key={fi.id} value={fi.id}>{fi.nome}</option>
              ))}
            </select>
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
          <div className="space-y-1">
            <Label className="text-xs">Preço de custo (opcional)</Label>
            <Input type="number" value={f.precoCusto} onChange={(e) => set({ precoCusto: e.target.value })} placeholder="herda da ficha" />
          </div>
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

        <LojaFields f={f} set={set} />

        <VariacoesEditor f={f} set={set} />

        {f.tipo === 'combo' && (
          <ComboEditor f={f} set={set} produtos={produtos} editId={editId} />
        )}

        <FiscalFields f={f} set={set} />

        <Button type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : editId ? 'Salvar alterações' : 'Cadastrar produto'}
        </Button>
      </form>
    </Card>
  );
}
