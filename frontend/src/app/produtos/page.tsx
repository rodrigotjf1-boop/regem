'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const selectCls =
  'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

type Variacao = { nome: string; codigo: string; precoVenda: string; fatorFicha: string };
type Combo = { componenteProdutoId: string; quantidade: string };

const vazio = () => ({
  codigo: '',
  nome: '',
  descricao: '',
  categoriaId: '',
  fichaId: '',
  tipo: 'simples',
  unidadeMedida: 'un',
  precoVenda: '',
  precoCusto: '',
  controlaEstoque: true,
  validadeDias: '',
  vaiParaProducao: true,
  setorProducaoId: '',
  tempoPreparoMin: '',
  imagemRef: '',
  precoPromocional: '',
  disponivelCardapio: true,
  selos: [] as string[],
  duracaoMin: '',
  vendaMultiplo: '',
  ncm: '',
  cfop: '',
  origem: '0',
  csosn: '102',
  cstIcms: '',
  gtin: '',
  cstPis: '',
  aliqPis: '',
  cstCofins: '',
  aliqCofins: '',
  variacoes: [] as Variacao[],
  combo: [] as Combo[],
});

const SELOS = [
  { v: 'mais_pedido', l: '🔥 Mais pedido' },
  { v: 'novo', l: '✨ Novo' },
  { v: 'veg', l: '🌱 Veg' },
  { v: 'sem_gluten', l: '🌾 S/ glúten' },
  { v: 'sem_lactose', l: '🥛 S/ lactose' },
  { v: 'picante', l: '🌶️ Picante' },
];

export default function ProdutosPage() {
  const router = useRouter();
  const [produtos, setProdutos] = useState<any[] | null>(null);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [fichas, setFichas] = useState<any[]>([]);
  const [setores, setSetores] = useState<any[]>([]);
  const [erro, setErro] = useState('');

  const [f, setF] = useState<any>(vazio());
  const [editId, setEditId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // categoria rápida
  const [catNome, setCatNome] = useState('');
  const [catParent, setCatParent] = useState('');

  // complementos (opcionais/adicionais) — só ao editar um produto salvo
  const [comps, setComps] = useState<any[]>([]);
  const [fichaIngs, setFichaIngs] = useState<any[]>([]);
  const [insumos, setInsumos] = useState<any[]>([]);
  const [novoGrupo, setNovoGrupo] = useState({ nome: '', tipo: 'remover' });

  // destinos de produção (KDS/impressora) — só ao editar
  const [equipamentos, setEquipamentos] = useState<any[]>([]);
  const [destinosSel, setDestinosSel] = useState<string[]>([]);
  const [salvandoDest, setSalvandoDest] = useState(false);
  const [faixas, setFaixas] = useState<{ qtdMin: string; preco: string }[]>([]);

  const reload = useCallback(async () => {
    setErro('');
    try {
      const [ps, cs, fs, ss, eq] = await Promise.all([
        api.produtos(),
        api.produtoCategorias(),
        api.fichasLista(),
        api.setores(),
        api.equipamentos().catch(() => []),
      ]);
      setProdutos(ps);
      setCategorias(cs);
      setFichas(fs);
      setSetores(ss);
      setEquipamentos(
        (eq as any[]).filter((e) => e.tipo === 'kds' || e.tipo === 'impressora'),
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  const set = (patch: any) => setF((s: any) => ({ ...s, ...patch }));
  const catLabel = (c: any) => {
    if (!c.parentId) return c.nome;
    const pai = categorias.find((x) => x.id === c.parentId);
    return `${pai?.nome ?? '—'} › ${c.nome}`;
  };

  function novo() {
    setEditId(null);
    setF(vazio());
    setComps([]);
    setFichaIngs([]);
    setDestinosSel([]);
    setFaixas([]);
  }

  function toggleDestino(id: string) {
    setDestinosSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function salvarDestinos() {
    if (!editId) return;
    setSalvandoDest(true);
    try {
      await api.setDestinosProduto(editId, destinosSel);
      toast.success('Destinos de produção salvos.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar destinos');
    } finally {
      setSalvandoDest(false);
    }
  }

  async function salvarFaixas() {
    if (!editId) return;
    try {
      await api.setProdutoFaixas(
        editId,
        faixas
          .filter((f) => f.qtdMin !== '')
          .map((f) => ({ qtdMin: Number(f.qtdMin), preco: Number(String(f.preco).replace(',', '.')) || 0 })),
      );
      toast.success('Faixas de preço salvas.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar faixas');
    }
  }

  async function carregarComplementos(produtoId: string, fichaId?: string) {
    try {
      const [cs, its, dest, fx] = await Promise.all([
        api.produtoComplementos(produtoId),
        api.estoqueItens().catch(() => []),
        api.destinosProduto(produtoId).catch(() => []),
        api.produtoFaixas(produtoId).catch(() => []),
      ]);
      setComps(cs as any[]);
      setInsumos(its as any[]);
      setDestinosSel((dest as any[]).map((d) => d.equipamentoId));
      setFaixas((fx as any[]).map((f) => ({ qtdMin: String(f.qtdMin), preco: String(f.preco) })));
      if (fichaId) {
        const fi: any = await api.ficha(fichaId).catch(() => null);
        setFichaIngs(fi?.ingredientes ?? []);
      } else {
        setFichaIngs([]);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar opcionais');
    }
  }

  async function editar(id: string) {
    try {
      const p: any = await api.produto(id);
      setEditId(id);
      await carregarComplementos(id, p.fichaId || undefined);
      setF({
        codigo: p.codigo ?? '',
        nome: p.nome ?? '',
        descricao: p.descricao ?? '',
        categoriaId: p.categoriaId ?? '',
        fichaId: p.fichaId ?? '',
        tipo: p.tipo ?? 'simples',
        unidadeMedida: p.unidadeMedida ?? 'un',
        precoVenda: p.precoVenda ?? '',
        precoCusto: p.precoCusto ?? '',
        controlaEstoque: p.controlaEstoque ?? true,
        validadeDias: p.validadeDias ?? '',
        vaiParaProducao: p.vaiParaProducao ?? true,
        setorProducaoId: p.setorProducaoId ?? '',
        tempoPreparoMin: p.tempoPreparoMin ?? '',
        imagemRef: p.imagemRef ?? '',
        precoPromocional: p.precoPromocional ?? '',
        disponivelCardapio: p.disponivelCardapio ?? true,
        selos: p.selos ?? [],
        duracaoMin: p.duracaoMin ?? '',
        vendaMultiplo: p.vendaMultiplo ?? '',
        ncm: p.ncm ?? '',
        cfop: p.cfop ?? '',
        origem: p.origem ?? '0',
        csosn: p.csosn ?? '102',
        cstIcms: p.cstIcms ?? '',
        gtin: p.gtin ?? '',
        cstPis: p.cstPis ?? '',
        aliqPis: p.aliqPis ?? '',
        cstCofins: p.cstCofins ?? '',
        aliqCofins: p.aliqCofins ?? '',
        variacoes: (p.variacoes ?? []).map((v: any) => ({
          nome: v.nome,
          codigo: v.codigo ?? '',
          precoVenda: v.precoVenda,
          fatorFicha: v.fatorFicha ?? '1',
        })),
        combo: (p.combo ?? []).map((c: any) => ({
          componenteProdutoId: c.componenteProdutoId,
          quantidade: c.quantidade ?? '1',
        })),
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao abrir');
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      const body: any = {
        codigo: f.codigo || undefined,
        nome: f.nome,
        descricao: f.descricao || undefined,
        categoriaId: f.categoriaId || undefined,
        fichaId: f.fichaId || undefined,
        tipo: f.tipo,
        unidadeMedida: f.unidadeMedida || 'un',
        precoVenda: Number(String(f.precoVenda).replace(',', '.')) || 0,
        precoCusto:
          f.precoCusto !== '' ? Number(String(f.precoCusto).replace(',', '.')) : undefined,
        controlaEstoque: f.controlaEstoque,
        validadeDias: f.validadeDias !== '' ? Number(f.validadeDias) : undefined,
        vaiParaProducao: f.vaiParaProducao,
        setorProducaoId: f.setorProducaoId || undefined,
        tempoPreparoMin: f.tempoPreparoMin !== '' ? Number(f.tempoPreparoMin) : undefined,
        imagemRef: f.imagemRef || undefined,
        precoPromocional: f.precoPromocional !== '' ? Number(String(f.precoPromocional).replace(',', '.')) : undefined,
        disponivelCardapio: f.disponivelCardapio,
        selos: f.selos,
        duracaoMin: f.duracaoMin !== '' ? Number(f.duracaoMin) : undefined,
        vendaMultiplo: f.vendaMultiplo !== '' ? Number(f.vendaMultiplo) : undefined,
        ncm: f.ncm || undefined,
        cfop: f.cfop || undefined,
        origem: f.origem || undefined,
        csosn: f.csosn || undefined,
        cstIcms: f.cstIcms || undefined,
        gtin: f.gtin || undefined,
        cstPis: f.cstPis || undefined,
        aliqPis: f.aliqPis !== '' ? Number(String(f.aliqPis).replace(',', '.')) : undefined,
        cstCofins: f.cstCofins || undefined,
        aliqCofins: f.aliqCofins !== '' ? Number(String(f.aliqCofins).replace(',', '.')) : undefined,
        variacoes: f.variacoes.map((v: Variacao) => ({
          nome: v.nome,
          codigo: v.codigo || undefined,
          precoVenda: Number(String(v.precoVenda).replace(',', '.')) || 0,
          fatorFicha: Number(String(v.fatorFicha).replace(',', '.')) || 1,
        })),
        combo:
          f.tipo === 'combo'
            ? f.combo
                .filter((c: Combo) => c.componenteProdutoId)
                .map((c: Combo) => ({
                  componenteProdutoId: c.componenteProdutoId,
                  quantidade: Number(String(c.quantidade).replace(',', '.')) || 1,
                }))
            : [],
      };
      if (editId) await api.atualizarProduto(editId, body);
      else await api.criarProduto(body);
      novo();
      await reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  async function remover(id: string, nome: string) {
    if (!confirm(`Remover "${nome}"?`)) return;
    try {
      await api.removerProduto(id);
      if (editId === id) novo();
      await reload();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao remover');
    }
  }

  async function addCategoria() {
    if (!catNome.trim()) return;
    try {
      await api.criarCategoriaProduto({
        nome: catNome.trim(),
        parentId: catParent || undefined,
      });
      setCatNome('');
      setCatParent('');
      await reload();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao criar categoria');
    }
  }

  async function addGrupo() {
    if (!editId || !novoGrupo.nome.trim()) return;
    try {
      await api.criarGrupoComplemento(editId, {
        nome: novoGrupo.nome.trim(),
        tipo: novoGrupo.tipo,
      });
      setNovoGrupo({ nome: '', tipo: novoGrupo.tipo });
      await carregarComplementos(editId, f.fichaId || undefined);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao criar grupo');
    }
  }

  async function addOpcao(grupo: any, dados: any) {
    try {
      await api.criarOpcaoComplemento(grupo.id, dados);
      await carregarComplementos(editId!, f.fichaId || undefined);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao criar opção');
    }
  }

  async function delGrupo(id: string) {
    try {
      await api.removerGrupoComplemento(id);
      await carregarComplementos(editId!, f.fichaId || undefined);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao remover grupo');
    }
  }

  async function delOpcao(id: string) {
    try {
      await api.removerOpcaoComplemento(id);
      await carregarComplementos(editId!, f.fichaId || undefined);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao remover opção');
    }
  }

  return (
    <Shell eyebrow="Gestão · catálogo" title="Produtos">
      <div className="max-w-3xl space-y-5">
        {erro && <p className="text-destructive">{erro}</p>}

        {/* Categorias */}
        <Card className="p-4">
          <h2 className="mb-2 font-display text-sm font-bold">Categorias</h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Nova categoria / subcategoria</Label>
              <Input value={catNome} onChange={(e) => setCatNome(e.target.value)} placeholder="Ex.: Bebidas" />
            </div>
            <select className={`${selectCls} w-40`} value={catParent} onChange={(e) => setCatParent(e.target.value)}>
              <option value="">— categoria raiz —</option>
              {categorias.filter((c) => !c.parentId).map((c) => (
                <option key={c.id} value={c.id}>sub de {c.nome}</option>
              ))}
            </select>
            <Button type="button" onClick={addCategoria}>Adicionar</Button>
          </div>
          {categorias.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {categorias.map((c) => (
                <span key={c.id} className="rounded bg-secondary px-2 py-1 text-xs text-secondary-foreground">
                  {catLabel(c)}
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* Form de produto */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">
              {editId ? 'Editar produto' : 'Novo produto'}
            </h2>
            {editId && (
              <Button type="button" variant="ghost" size="sm" onClick={novo}>
                Cancelar edição
              </Button>
            )}
          </div>
          <form onSubmit={salvar} className="space-y-4">
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

            {/* Loja / cardápio */}
            <div className="rounded-lg border border-border p-3">
              <Label className="text-xs">Loja / cardápio digital</Label>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1 sm:col-span-3">
                  <Label className="text-xs text-muted-foreground">Foto do produto</Label>
                  <ImageUpload value={f.imagemRef || undefined} onChange={(url) => set({ imagemRef: url })} alt={f.nome || 'produto'} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Preço promocional (de/por)</Label>
                  <Input type="number" value={f.precoPromocional} onChange={(e) => set({ precoPromocional: e.target.value })} placeholder="opcional" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Duração (min) — serviços</Label>
                  <Input type="number" value={f.duracaoMin} onChange={(e) => set({ duracaoMin: e.target.value })} placeholder="—" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vende em múltiplos de (B2B)</Label>
                  <Input type="number" value={f.vendaMultiplo} onChange={(e) => set({ vendaMultiplo: e.target.value })} placeholder="1" />
                </div>
              </div>
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
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.disponivelCardapio} onChange={(e) => set({ disponivelCardapio: e.target.checked })} className="h-4 w-4 accent-primary" />
                Disponível no cardápio (desmarque para bloquear a venda online)
              </label>
            </div>

            {/* Variações */}
            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-xs">Variações (tamanho/unidade)</Label>
                <Button type="button" variant="ghost" size="sm" onClick={() => set({ variacoes: [...f.variacoes, { nome: '', codigo: '', precoVenda: '', fatorFicha: '1' }] })}>
                  ＋ variação
                </Button>
              </div>
              {f.variacoes.length === 0 && <p className="text-xs text-muted-foreground">Ex.: 300ml, 500ml — cada uma com preço e SKU.</p>}
              {f.variacoes.map((v: Variacao, i: number) => (
                <div key={i} className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <Input placeholder="Nome" value={v.nome} onChange={(e) => { const a = [...f.variacoes]; a[i] = { ...v, nome: e.target.value }; set({ variacoes: a }); }} />
                  <Input placeholder="SKU" value={v.codigo} onChange={(e) => { const a = [...f.variacoes]; a[i] = { ...v, codigo: e.target.value }; set({ variacoes: a }); }} />
                  <Input type="number" placeholder="Preço" value={v.precoVenda} onChange={(e) => { const a = [...f.variacoes]; a[i] = { ...v, precoVenda: e.target.value }; set({ variacoes: a }); }} />
                  <Input type="number" placeholder="Fator ficha" value={v.fatorFicha} onChange={(e) => { const a = [...f.variacoes]; a[i] = { ...v, fatorFicha: e.target.value }; set({ variacoes: a }); }} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => set({ variacoes: f.variacoes.filter((_: any, x: number) => x !== i) })}>remover</Button>
                </div>
              ))}
            </div>

            {/* Combo */}
            {f.tipo === 'combo' && (
              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Label className="text-xs">Componentes do combo</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => set({ combo: [...f.combo, { componenteProdutoId: '', quantidade: '1' }] })}>
                    ＋ item
                  </Button>
                </div>
                {f.combo.map((c: Combo, i: number) => (
                  <div key={i} className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <select className={`${selectCls} sm:col-span-2`} value={c.componenteProdutoId} onChange={(e) => { const a = [...f.combo]; a[i] = { ...c, componenteProdutoId: e.target.value }; set({ combo: a }); }}>
                      <option value="">— produto —</option>
                      {(produtos ?? []).filter((p) => p.id !== editId).map((p) => (
                        <option key={p.id} value={p.id}>{p.nome}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <Input type="number" placeholder="Qtd" value={c.quantidade} onChange={(e) => { const a = [...f.combo]; a[i] = { ...c, quantidade: e.target.value }; set({ combo: a }); }} />
                      <Button type="button" variant="ghost" size="sm" onClick={() => set({ combo: f.combo.filter((_: any, x: number) => x !== i) })}>×</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Fiscal (NFC-e) */}
            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
                Fiscal (NFC-e) — NCM, CFOP, tributação
              </summary>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">NCM</Label>
                  <Input value={f.ncm} onChange={(e) => set({ ncm: e.target.value })} placeholder="21069090" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">CFOP</Label>
                  <Input value={f.cfop} onChange={(e) => set({ cfop: e.target.value })} placeholder="5102" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Origem</Label>
                  <Input value={f.origem} onChange={(e) => set({ origem: e.target.value })} placeholder="0" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">CSOSN (Simples)</Label>
                  <Input value={f.csosn} onChange={(e) => set({ csosn: e.target.value })} placeholder="102" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">CST ICMS (Normal)</Label>
                  <Input value={f.cstIcms} onChange={(e) => set({ cstIcms: e.target.value })} placeholder="—" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">GTIN / EAN</Label>
                  <Input value={f.gtin} onChange={(e) => set({ gtin: e.target.value })} placeholder="cód. de barras" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">CST PIS</Label>
                  <Input value={f.cstPis} onChange={(e) => set({ cstPis: e.target.value })} placeholder="07" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Alíq. PIS %</Label>
                  <Input type="number" value={f.aliqPis} onChange={(e) => set({ aliqPis: e.target.value })} placeholder="0" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">CST COFINS</Label>
                  <Input value={f.cstCofins} onChange={(e) => set({ cstCofins: e.target.value })} placeholder="07" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Alíq. COFINS %</Label>
                  <Input type="number" value={f.aliqCofins} onChange={(e) => set({ aliqCofins: e.target.value })} placeholder="0" />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">NCM é obrigatório para emitir NFC-e.</p>
            </details>

            <Button type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : editId ? 'Salvar alterações' : 'Cadastrar produto'}
            </Button>
          </form>
        </Card>

        {/* Destinos de produção (KDS/impressora) — só ao editar */}
        {editId && (
          <Card className="p-4">
            <h2 className="font-display text-lg font-semibold">Destinos de produção</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Para onde este produto vai ao ser vendido: um ou mais KDS e/ou impressoras. Sem seleção, herda o padrão do setor de produção.
            </p>
            {equipamentos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum KDS/impressora cadastrado. Cadastre em Cadastros → Equipamentos.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {equipamentos.map((e) => (
                    <label
                      key={e.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm ${destinosSel.includes(e.id) ? 'border-primary bg-primary/10' : 'border-border'}`}
                    >
                      <input
                        type="checkbox"
                        checked={destinosSel.includes(e.id)}
                        onChange={() => toggleDestino(e.id)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="flex-1">{e.nome}</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {e.tipo === 'impressora' ? 'impressora' : 'KDS'}
                      </span>
                    </label>
                  ))}
                </div>
                <Button type="button" className="mt-3" onClick={salvarDestinos} disabled={salvandoDest}>
                  {salvandoDest ? 'Salvando…' : 'Salvar destinos'}
                </Button>
              </>
            )}
          </Card>
        )}

        {/* Faixas de preço por volume (B2B) — só ao editar */}
        {editId && (
          <Card className="p-4">
            <h2 className="font-display text-lg font-semibold">Preço por volume (B2B)</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Preço unitário por faixa de quantidade (atacado/indústria). O maior <b>qtd. mínima</b> ≤ quantidade vendida é aplicado.
            </p>
            <div className="space-y-2">
              {faixas.map((fx, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Input type="number" placeholder="Qtd. mínima" value={fx.qtdMin} onChange={(e) => { const a = [...faixas]; a[i] = { ...fx, qtdMin: e.target.value }; setFaixas(a); }} />
                  <Input type="number" placeholder="Preço/un" value={fx.preco} onChange={(e) => { const a = [...faixas]; a[i] = { ...fx, preco: e.target.value }; setFaixas(a); }} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => setFaixas(faixas.filter((_, x) => x !== i))}>remover</Button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setFaixas([...faixas, { qtdMin: '', preco: '' }])}>＋ faixa</Button>
              <Button type="button" size="sm" onClick={salvarFaixas}>Salvar faixas</Button>
            </div>
          </Card>
        )}

        {/* Opcionais & adicionais (só ao editar um produto salvo) */}
        {editId && (
          <Card className="p-4">
            <h2 className="font-display text-lg font-semibold">Opcionais & adicionais</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              <b>Opcional (retirar):</b> cliente pede “sem cebola” — não dá baixa naquele ingrediente da ficha.{' '}
              <b>Adicional (extra):</b> “+ bacon” — soma preço e dá baixa no insumo.
            </p>

            <div className="space-y-3">
              {comps.length === 0 && (
                <p className="text-sm text-muted-foreground">Nenhum grupo. Crie um abaixo.</p>
              )}
              {comps.map((g) => (
                <GrupoComplemento
                  key={g.id}
                  grupo={g}
                  fichaIngs={fichaIngs}
                  insumos={insumos}
                  produtos={produtos ?? []}
                  onAddOpcao={addOpcao}
                  onDelGrupo={delGrupo}
                  onDelOpcao={delOpcao}
                />
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Novo grupo</Label>
                <Input
                  value={novoGrupo.nome}
                  onChange={(e) => setNovoGrupo((s) => ({ ...s, nome: e.target.value }))}
                  placeholder="Ex.: Remover ingredientes / Adicionais"
                />
              </div>
              <select
                aria-label="Tipo do grupo de complementos"
                className={`${selectCls} w-44`}
                value={novoGrupo.tipo}
                onChange={(e) => setNovoGrupo((s) => ({ ...s, tipo: e.target.value }))}
              >
                <option value="remover">Opcional (retirar)</option>
                <option value="adicionar">Adicional (extra)</option>
                <option value="escolha">Escolha (etapa — escolher 1/N)</option>
              </select>
              <Button type="button" onClick={addGrupo}>Adicionar grupo</Button>
            </div>
          </Card>
        )}

        {/* Lista */}
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Produtos {produtos ? `(${produtos.length})` : ''}
          </p>
          {!produtos && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {produtos?.length === 0 && <p className="text-sm text-muted-foreground">Nenhum produto cadastrado.</p>}
          <div className="space-y-2">
            {produtos?.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.nome}</span>
                    {p.codigo && <span className="font-mono text-[11px] text-muted-foreground">{p.codigo}</span>}
                    {p.categoriaNome && <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">{p.categoriaNome}</span>}
                    {p.tipo !== 'simples' && <span className="rounded bg-info/10 px-1.5 py-0.5 text-xs text-info">{p.tipo}</span>}
                    {!p.fichaId && p.controlaEstoque && <span className="rounded bg-warn/10 px-1.5 py-0.5 text-xs text-warn">sem ficha</span>}
                  </div>
                </div>
                <span className="font-mono text-sm font-bold">{brl(Number(p.precoVenda))}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => editar(p.id)}>Editar</Button>
                <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => remover(p.id, p.nome)}>×</Button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}

// Um grupo de complementos + suas opções + formulário de nova opção.
function GrupoComplemento({
  grupo,
  fichaIngs,
  insumos,
  produtos,
  onAddOpcao,
  onDelGrupo,
  onDelOpcao,
}: {
  grupo: any;
  fichaIngs: any[];
  insumos: any[];
  produtos: any[];
  onAddOpcao: (grupo: any, dados: any) => void;
  onDelGrupo: (id: string) => void;
  onDelOpcao: (id: string) => void;
}) {
  const remover = grupo.tipo === 'remover';
  const escolha = grupo.tipo === 'escolha';
  const badge = remover ? 'retirar' : escolha ? 'escolher' : 'adicionar';
  const [nome, setNome] = useState('');
  const [precoDelta, setPrecoDelta] = useState('');
  const [ref, setRef] = useState(''); // fichaIngredienteId (remover) / itemId (adicionar) / produtoRefId (escolha)
  const [quantidade, setQuantidade] = useState('1');

  function submit() {
    if (!nome.trim() && !ref) return;
    const dados: any = { nome: nome.trim() };
    if (remover) {
      dados.fichaIngredienteId = ref || undefined;
      if (!dados.nome && ref) {
        const ing = fichaIngs.find((i) => i.id === ref);
        dados.nome = ing?.insumoNome ?? ing?.subFichaNome ?? 'ingrediente';
      }
    } else if (escolha) {
      dados.precoDelta = precoDelta !== '' ? Number(String(precoDelta).replace(',', '.')) : 0;
      dados.produtoRefId = ref || undefined;
      if (!dados.nome && ref) dados.nome = produtos.find((p) => p.id === ref)?.nome ?? 'opção';
    } else {
      dados.precoDelta = precoDelta !== '' ? Number(String(precoDelta).replace(',', '.')) : 0;
      dados.itemId = ref || undefined;
      dados.quantidade = Number(String(quantidade).replace(',', '.')) || 1;
    }
    onAddOpcao(grupo, dados);
    setNome('');
    setPrecoDelta('');
    setRef('');
    setQuantidade('1');
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">
          {grupo.nome}{' '}
          <span className={`ml-1 rounded px-1.5 py-0.5 text-xs ${remover ? 'bg-warn/10 text-warn' : escolha ? 'bg-primary/10 text-primary' : 'bg-info/10 text-info'}`}>
            {badge}
          </span>
          {(grupo.min > 0 || grupo.max) && (
            <span className="ml-1 text-[11px] text-muted-foreground">
              {grupo.min > 0 ? 'obrigatório · ' : ''}{grupo.max ? `até ${grupo.max}` : ''}
            </span>
          )}
        </span>
        <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onDelGrupo(grupo.id)}>
          remover grupo
        </Button>
      </div>

      {(grupo.opcoes ?? []).length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">Sem opções ainda.</p>
      )}
      <div className="mb-2 space-y-1">
        {(grupo.opcoes ?? []).map((o: any) => (
          <div key={o.id} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-sm">
            <span className="flex-1">{o.nome}</span>
            {Number(o.precoDelta) > 0 && (
              <span className="font-mono text-xs text-primary">+ {brl(Number(o.precoDelta))}</span>
            )}
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onDelOpcao(o.id)}>×</Button>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input placeholder="Nome da opção" value={nome} onChange={(e) => setNome(e.target.value)} />
        {remover ? (
          <select
            aria-label="Ingrediente da ficha a retirar"
            className={`${selectCls} sm:col-span-2`}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          >
            <option value="">— ingrediente da ficha —</option>
            {fichaIngs.map((i) => (
              <option key={i.id} value={i.id}>{i.insumoNome ?? i.subFichaNome ?? 'ingrediente'}</option>
            ))}
          </select>
        ) : escolha ? (
          <>
            <Input type="number" placeholder="+ R$ (opcional)" value={precoDelta} onChange={(e) => setPrecoDelta(e.target.value)} />
            <select
              aria-label="Produto vinculado (opcional)"
              className={selectCls}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            >
              <option value="">— sem produto (só rótulo) —</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </>
        ) : (
          <>
            <Input type="number" placeholder="+ R$" value={precoDelta} onChange={(e) => setPrecoDelta(e.target.value)} />
            <select
              aria-label="Insumo a dar baixa"
              className={selectCls}
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            >
              <option value="">— insumo (baixa) —</option>
              {insumos.map((i) => (
                <option key={i.id} value={i.id}>{i.nome}</option>
              ))}
            </select>
            <Input type="number" placeholder="Qtd baixa" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </>
        )}
        <Button type="button" variant="outline" size="sm" onClick={submit}>＋ opção</Button>
      </div>
    </div>
  );
}
