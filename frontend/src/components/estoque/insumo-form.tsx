'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card } from '@/components/ui/card';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Opt = { id: string; nome: string };
type Conversao = { unidadeDe: string; fator: string; unidadePara: string };

const UNIDADES = [
  'unidade',
  'caixa',
  'kg',
  'grama',
  'litro',
  'ml',
  'fardo',
  'fita',
  'pacote',
  'saco',
  'peça',
  'dúzia',
];

// Cadastro rico de insumo (item de estoque): categoria (cadastro), fornecedor,
// unidade tipada, estoque mínimo e conversões personalizadas. Serve p/ criar e editar.
export function InsumoForm({
  item,
  categorias,
  fornecedores,
  onSaved,
  onCancel,
  onReload,
}: {
  item?: any;
  categorias: Opt[];
  fornecedores: Opt[];
  onSaved: () => void;
  onCancel: () => void;
  onReload: () => void;
}) {
  const [nome, setNome] = useState(item?.nome ?? '');
  const [categoriaItemId, setCategoriaItemId] = useState(item?.categoriaItemId ?? '');
  const [fornecedorId, setFornecedorId] = useState(item?.fornecedorId ?? '');
  const [unidade, setUnidade] = useState<string>(item?.unidadeMedida ?? 'unidade');
  const [estoqueMinimo, setEstoqueMinimo] = useState(
    item?.estoqueMinimo != null ? String(item.estoqueMinimo) : '',
  );
  // Validade opcional (seletor nativo). A data vem como yyyy-mm-dd do backend.
  const [validade, setValidade] = useState(item?.validade ? String(item.validade).slice(0, 10) : '');
  const [conversoes, setConversoes] = useState<Conversao[]>(
    (item?.conversoes ?? []).map((c: any) => ({
      unidadeDe: c.unidadeDe,
      fator: String(c.fator),
      unidadePara: c.unidadePara,
    })),
  );
  const [cats, setCats] = useState<Opt[]>(categorias);
  const [forns, setForns] = useState<Opt[]>(fornecedores);
  const [novaCat, setNovaCat] = useState('');
  const [novoForn, setNovoForn] = useState('');
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);

  async function criarCategoria() {
    if (!novaCat.trim()) return;
    try {
      const c: any = await api.criarEstoqueCategoria({ nome: novaCat.trim() });
      setCats((l) => [...l, { id: c.id, nome: c.nome }]);
      setCategoriaItemId(c.id);
      setNovaCat('');
      onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar categoria');
    }
  }
  async function criarFornecedor() {
    if (!novoForn.trim()) return;
    try {
      const f: any = await api.post('/fornecedores', { nome: novoForn.trim() });
      setForns((l) => [...l, { id: f.id, nome: f.nome }]);
      setFornecedorId(f.id);
      setNovoForn('');
      onReload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar fornecedor');
    }
  }

  const setConv = (i: number, patch: Partial<Conversao>) =>
    setConversoes((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setSaving(true);
    const body = {
      nome: nome.trim(),
      unidadeMedida: unidade || undefined,
      estoqueMinimo: estoqueMinimo ? Number(estoqueMinimo) : undefined,
      validade: validade || undefined,
      categoriaItemId: categoriaItemId || undefined,
      fornecedorId: fornecedorId || undefined,
      conversoes: conversoes
        .filter((c) => c.unidadeDe && c.unidadePara && Number(c.fator) > 0)
        .map((c) => ({
          unidadeDe: c.unidadeDe,
          fator: Number(c.fator),
          unidadePara: c.unidadePara,
        })),
    };
    try {
      if (item?.id) await api.atualizarItem(item.id, body);
      else await api.post('/estoque/itens', body);
      toast.success(item?.id ? 'Insumo atualizado.' : 'Insumo cadastrado.');
      onSaved();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={salvar} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nome">Nome do insumo</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Ex.: Pão brioche" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat">Categoria</Label>
            <Select id="cat" value={categoriaItemId} onChange={(e) => setCategoriaItemId(e.target.value)}>
              <option value="">— sem categoria —</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </Select>
            <div className="flex gap-1.5">
              <Input value={novaCat} onChange={(e) => setNovaCat(e.target.value)} placeholder="＋ nova categoria" className="h-9 text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); criarCategoria(); } }} />
              <Button type="button" variant="outline" size="sm" onClick={criarCategoria}>Criar</Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="forn">Fornecedor</Label>
            <Select id="forn" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
              <option value="">— sem fornecedor —</option>
              {forns.map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </Select>
            <div className="flex gap-1.5">
              <Input value={novoForn} onChange={(e) => setNovoForn(e.target.value)} placeholder="＋ novo fornecedor" className="h-9 text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); criarFornecedor(); } }} />
              <Button type="button" variant="outline" size="sm" onClick={criarFornecedor}>Criar</Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="un">Unidade principal</Label>
            <Select id="un" value={UNIDADES.includes(unidade) ? unidade : '__outra__'}
              onChange={(e) => setUnidade(e.target.value === '__outra__' ? '' : e.target.value)}>
              {UNIDADES.map((u) => (<option key={u} value={u}>{u}</option>))}
              <option value="__outra__">outra…</option>
            </Select>
            {!UNIDADES.includes(unidade) && (
              <Input value={unidade} onChange={(e) => setUnidade(e.target.value)} placeholder="unidade personalizada" className="mt-1" />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="min">Estoque mínimo</Label>
            <Input id="min" type="number" inputMode="decimal" value={estoqueMinimo} onChange={(e) => setEstoqueMinimo(e.target.value)} placeholder="0" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="val">Data de validade (opcional)</Label>
            <Input id="val" type="date" value={validade} onChange={(e) => setValidade(e.target.value)} />
          </div>
        </div>

        {/* Conversões personalizadas */}
        <div className="space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between">
            <Label>Conversões personalizadas</Label>
            <Button type="button" size="sm" variant="outline"
              onClick={() => setConversoes((cs) => [...cs, { unidadeDe: unidade || 'fardo', fator: '', unidadePara: 'unidade' }])}>
              <Plus className="h-4 w-4" /> Conversão
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Ex.: 1 <b>fardo</b> = 400 <b>unidade</b> · 1 <b>kg</b> = 1 <b>peça</b>.</p>
          {conversoes.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5 text-sm">
              <span>1</span>
              <Input value={c.unidadeDe} onChange={(e) => setConv(i, { unidadeDe: e.target.value })} placeholder="fardo" className="h-9 w-24" />
              <span>=</span>
              <Input type="number" inputMode="decimal" value={c.fator} onChange={(e) => setConv(i, { fator: e.target.value })} placeholder="400" className="h-9 w-20" />
              <Input value={c.unidadePara} onChange={(e) => setConv(i, { unidadePara: e.target.value })} placeholder="unidade" className="h-9 w-24" />
              <Button type="button" variant="ghost" size="icon" aria-label="Remover conversão"
                onClick={() => setConversoes((cs) => cs.filter((_, idx) => idx !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}

        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={saving || !nome.trim()}>
            {saving ? 'Salvando…' : item?.id ? 'Salvar alterações' : 'Cadastrar insumo'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
        </div>
      </form>
    </Card>
  );
}
