'use client';

import { useEffect, useState } from 'react';
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
  // Múltiplos fornecedores (N:N). Prefere a lista; cai no legado quando só há 1.
  const [fornecedorIds, setFornecedorIds] = useState<string[]>(
    Array.isArray(item?.fornecedorIds) && item.fornecedorIds.length
      ? item.fornecedorIds
      : item?.fornecedorId
        ? [item.fornecedorId]
        : [],
  );
  // Setor de estoque onde o insumo fica guardado (setores já cadastrados).
  const [setorId, setSetorId] = useState(item?.setorId ?? '');
  const [setores, setSetores] = useState<Opt[]>([]);
  const [unidade, setUnidade] = useState<string>(item?.unidadeMedida ?? 'unidade');
  const [estoqueMinimo, setEstoqueMinimo] = useState(
    item?.estoqueMinimo != null ? String(item.estoqueMinimo) : '',
  );
  // Validade opcional (seletor nativo). A data vem como yyyy-mm-dd do backend.
  const [validade, setValidade] = useState(item?.validade ? String(item.validade).slice(0, 10) : '');
  // Imprimir etiquetas de validade ao salvar (RDC 216). Só faz sentido com validade.
  const [imprimirEtiq, setImprimirEtiq] = useState(false);
  const [qtdEtiq, setQtdEtiq] = useState('1');
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

  // Setores já cadastrados (para escolher o setor de estoque do insumo).
  useEffect(() => {
    api.setores().then((s: any) => setSetores(Array.isArray(s) ? s : [])).catch(() => {});
  }, []);

  const toggleFornecedor = (id: string) =>
    setFornecedorIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

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
      setFornecedorIds((l) => [...l, f.id]);
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
      setorId: setorId || undefined,
      fornecedorIds, // lista N:N (o backend deriva o principal do 1º)
      conversoes: conversoes
        .filter((c) => c.unidadeDe && c.unidadePara && Number(c.fator) > 0)
        .map((c) => ({
          unidadeDe: c.unidadeDe,
          fator: Number(c.fator),
          unidadePara: c.unidadePara,
        })),
    };
    try {
      const salvo: any = item?.id
        ? await api.atualizarItem(item.id, body)
        : await api.post('/estoque/itens', body);
      toast.success(item?.id ? 'Insumo atualizado.' : 'Insumo cadastrado.');
      // Imprime as etiquetas de validade do insumo, se pedido (best-effort).
      const insumoId = salvo?.id ?? item?.id;
      if (imprimirEtiq && validade && insumoId) {
        try {
          const r: any = await api.criarEtiqueta({
            itemId: insumoId,
            quantidade: Number(qtdEtiq) || 1,
            fabricacao: new Date().toISOString().slice(0, 10),
          });
          toast.success(`${r?.criadas ?? 1} etiqueta(s) enviada(s) à impressão.`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Insumo salvo, mas falhou ao imprimir etiquetas.');
        }
      }
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

          <div className="space-y-1.5 sm:col-span-2">
            <Label>Fornecedores</Label>
            <p className="text-[11px] text-muted-foreground">Marque um ou mais. O 1º selecionado vira o fornecedor principal.</p>
            {forns.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum fornecedor cadastrado ainda — crie abaixo.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {forns.map((f) => {
                  const on = fornecedorIds.includes(f.id);
                  const principal = on && fornecedorIds[0] === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleFornecedor(f.id)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
                    >
                      {on ? '✓ ' : ''}{f.nome}{principal ? ' · principal' : ''}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-1.5">
              <Input value={novoForn} onChange={(e) => setNovoForn(e.target.value)} placeholder="＋ novo fornecedor" className="h-9 text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); criarFornecedor(); } }} />
              <Button type="button" variant="outline" size="sm" onClick={criarFornecedor}>Criar</Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="setor">Setor de estoque</Label>
            <Select id="setor" value={setorId} onChange={(e) => setSetorId(e.target.value)}>
              <option value="">— sem setor —</option>
              {setores.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </Select>
            <p className="text-[11px] text-muted-foreground">Onde o insumo fica guardado. Use os setores já cadastrados.</p>
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

          {/* Impressão de etiquetas de validade (RDC 216) — só com validade cadastrada. */}
          {validade && (
            <div className="space-y-1.5 rounded-lg border border-border bg-secondary/30 p-3 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={imprimirEtiq}
                  onChange={(e) => setImprimirEtiq(e.target.checked)}
                />
                Imprimir etiquetas de validade ao salvar
              </label>
              {imprimirEtiq && (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="qtdEtiq" className="text-xs">Quantidade de etiquetas</Label>
                    <Input
                      id="qtdEtiq"
                      type="number"
                      min={1}
                      max={50}
                      value={qtdEtiq}
                      onChange={(e) => setQtdEtiq(e.target.value)}
                      className="h-9 w-28"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Saem na impressora de etiquetas com a data de validade cadastrada.
                  </p>
                </div>
              )}
            </div>
          )}
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
