'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, podeVerFinanceiro } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Shell } from '@/components/app-shell/shell';
import { vazio, type Variacao, type Combo } from '@/components/produtos/types';
import { useProdutosData } from '@/components/produtos/use-produtos-data';
import { CategoriasCard } from '@/components/produtos/categorias-card';
import { OpcoesCard } from '@/components/produtos/opcoes-card';
import { ComplementosCatalogoCard } from '@/components/produtos/complementos-catalogo-card';
import { ProdutoEtapasCard } from '@/components/produtos/produto-etapas-card';
import { ProdutoForm } from '@/components/produtos/produto-form';
import { DestinosCard } from '@/components/produtos/destinos-card';
import { FaixasCard } from '@/components/produtos/faixas-card';
import { ComplementosCard } from '@/components/produtos/complementos-card';
import { ProdutosLista } from '@/components/produtos/produtos-lista';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Canais de delivery cujo catálogo pode ser pausado por produto ("Ativo no iFood").
// Só marketplaces de cardápio — n8n/mercadopago/iugu não entram.
const CANAL_LABEL: Record<string, string> = {
  ifood: 'iFood',
  '99food': '99food',
  anotaai: 'Anota Aí',
  delivery_direto: 'Delivery Direto',
  cardapio_web: 'Cardápio Web',
  rappi: 'Rappi',
  keeta: 'Keeta',
};

export default function ProdutosPage() {
  const router = useRouter();
  const { produtos, categorias, fichas, setores, equipamentos, erro, setErro, reload } =
    useProdutosData();

  const [f, setF] = useState<any>(vazio());
  const [editId, setEditId] = useState<string | null>(null);
  const [aba, setAba] = useState<'produtos' | 'complementos' | 'opcoes'>('produtos');
  const [formAberto, setFormAberto] = useState(false); // cadastro/edição em modal
  const [modalAba, setModalAba] = useState<'info' | 'complementos' | 'disponibilidade'>('info');
  const [catSel, setCatSel] = useState<string>(''); // categoria selecionada (filtra a grade)
  const [salvando, setSalvando] = useState(false);
  // Lido em estado (não no render) p/ não descasar o SSR — hydration mismatch.
  const [verFin, setVerFin] = useState(false);
  const [cardapio, setCardapio] = useState<any>(null); // token/base p/ "copiar link"
  const [integracoes, setIntegracoes] = useState<any[]>([]); // canais de delivery (ativos)

  // categoria rápida
  const [catNome, setCatNome] = useState('');

  // complementos (opcionais/adicionais) — só ao editar um produto salvo
  const [comps, setComps] = useState<any[]>([]);
  const [fichaIngs, setFichaIngs] = useState<any[]>([]);
  const [insumos, setInsumos] = useState<any[]>([]);
  const [novoGrupo, setNovoGrupo] = useState({ nome: '', tipo: 'remover' });

  // destinos de produção (KDS/impressora) — só ao editar
  const [destinosSel, setDestinosSel] = useState<string[]>([]);
  const [salvandoDest, setSalvandoDest] = useState(false);
  const [faixas, setFaixas] = useState<{ qtdMin: string; preco: string }[]>([]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    setVerFin(podeVerFinanceiro());
    api.cardapioConfig().then(setCardapio).catch(() => {});
    api.integracoesDelivery().then((r: any) => setIntegracoes(Array.isArray(r) ? r : [])).catch(() => {});
    reload();
  }, [reload, router]);

  const set = (patch: any) => setF((s: any) => ({ ...s, ...patch }));
  // Categorias são planas (sem subcategoria) — o rótulo é só o nome.
  const catLabel = (c: any) => c.nome;
  // Só os canais de delivery ATIVOS e em uso viram toggle no cadastro.
  const canaisAtivos = integracoes
    .filter((i) => i.ativo && CANAL_LABEL[i.canal])
    .map((i) => ({ canal: i.canal, label: CANAL_LABEL[i.canal] }));

  function novo() {
    setEditId(null);
    setF(vazio());
    setComps([]);
    setFichaIngs([]);
    setDestinosSel([]);
    setFaixas([]);
  }
  function abrirNovo() {
    novo();
    setModalAba('info');
    setFormAberto(true);
  }
  function fecharForm() {
    setFormAberto(false);
    novo();
  }
  const produtosFiltrados = catSel
    ? (produtos ?? []).filter((p: any) => p.categoriaId === catSel)
    : (produtos ?? []);

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
      setModalAba('info');
      setFormAberto(true);
      await carregarComplementos(id, p.fichaId || undefined);
      setF({
        codigo: p.codigo ?? '',
        nome: p.nome ?? '',
        descricao: p.descricao ?? '',
        categoriaId: p.categoriaId ?? '',
        fichaId: p.fichaId ?? '',
        itemId: p.itemId ?? '',
        tipo: p.tipo ?? 'simples',
        unidadeMedida: p.unidadeMedida ?? 'un',
        precoVenda: p.precoVenda ?? '',
        precoCusto: p.precoCusto ?? '',
        // Custo derivado (read-only, gateado no servidor por ver_financeiro).
        custoEfetivo: p.custoEfetivo ?? null,
        custoEfetivoDelivery: p.custoEfetivoDelivery ?? null,
        custoFonte: p.custoFonte ?? null,
        itemNome: p.itemNome ?? null,
        controlaEstoque: p.controlaEstoque ?? true,
        validadeDias: p.validadeDias ?? '',
        controlaValidade: p.controlaValidade ?? false,
        validadeFechadoDias: p.validadeFechadoDias ?? '',
        validadeAbertoDias: p.validadeAbertoDias ?? '',
        vaiParaProducao: p.vaiParaProducao ?? true,
        setorProducaoId: p.setorProducaoId ?? '',
        tempoPreparoMin: p.tempoPreparoMin ?? '',
        imagemRef: p.imagemRef ?? '',
        precoPromocional: p.precoPromocional ?? '',
        disponivelCardapio: p.disponivelCardapio ?? true,
        disponivelBalcao: p.disponivelBalcao ?? true,
        destaque: p.destaque ?? false,
        selos: p.selos ?? [],
        canaisPausados: p.canaisPausados ?? [],
        sugestoes: p.sugestoes ?? [],
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
          tamanho: v.atributos?.tamanho ?? '',
          cor: v.atributos?.cor ?? '',
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

  async function salvar(e?: React.FormEvent) {
    e?.preventDefault();
    setErro('');
    // Preço promocional ("por") tem de ser menor que o preço de venda ("de") —
    // senão o cardápio mostraria "de R$20 por R$30" (promoção mais cara).
    const pv = Number(String(f.precoVenda).replace(',', '.')) || 0;
    const pp = f.precoPromocional !== '' ? Number(String(f.precoPromocional).replace(',', '.')) : null;
    if (pp !== null && pp > 0 && pv > 0 && pp >= pv) {
      setErro('O preço promocional deve ser menor que o preço de venda.');
      return;
    }
    setSalvando(true);
    try {
      const body: any = {
        codigo: f.codigo || undefined,
        nome: f.nome,
        descricao: f.descricao || undefined,
        categoriaId: f.categoriaId || undefined,
        fichaId: f.fichaId || undefined,
        itemId: f.itemId || undefined,
        tipo: f.tipo,
        unidadeMedida: f.unidadeMedida || 'un',
        precoVenda: Number(String(f.precoVenda).replace(',', '.')) || 0,
        precoCusto:
          f.precoCusto !== '' ? Number(String(f.precoCusto).replace(',', '.')) : undefined,
        controlaEstoque: f.controlaEstoque,
        validadeDias: f.validadeDias !== '' ? Number(f.validadeDias) : undefined,
        controlaValidade: f.controlaValidade,
        validadeFechadoDias: f.validadeFechadoDias !== '' ? Number(f.validadeFechadoDias) : undefined,
        validadeAbertoDias: f.validadeAbertoDias !== '' ? Number(f.validadeAbertoDias) : undefined,
        vaiParaProducao: f.vaiParaProducao,
        setorProducaoId: f.setorProducaoId || undefined,
        tempoPreparoMin: f.tempoPreparoMin !== '' ? Number(f.tempoPreparoMin) : undefined,
        imagemRef: f.imagemRef || undefined,
        precoPromocional: f.precoPromocional !== '' ? Number(String(f.precoPromocional).replace(',', '.')) : undefined,
        disponivelCardapio: f.disponivelCardapio,
        disponivelBalcao: f.disponivelBalcao,
        destaque: f.destaque,
        selos: f.selos,
        canaisPausados: f.canaisPausados ?? [],
        sugestoes: f.sugestoes ?? [],
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
        variacoes: f.variacoes.map((v: Variacao) => {
          const atributos: Record<string, string> = {};
          if (v.tamanho?.trim()) atributos.tamanho = v.tamanho.trim();
          if (v.cor?.trim()) atributos.cor = v.cor.trim();
          return {
            nome: v.nome,
            codigo: v.codigo || undefined,
            precoVenda: Number(String(v.precoVenda).replace(',', '.')) || 0,
            fatorFicha: Number(String(v.fatorFicha).replace(',', '.')) || 1,
            atributos,
          };
        }),
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
      setFormAberto(false);
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

  // Reativar um esgotado SEM dar entrada (ativo=true) ou voltar a controlar (false).
  async function reativar(p: any, ativo: boolean) {
    if (
      ativo &&
      !confirm(
        `Reativar "${p.nome}" sem dar entrada no estoque?\n\n` +
          'O controle de estoque (bloqueio por falta) será DESATIVADO para este produto: ' +
          'ele fica disponível no cardápio e o estoque do insumo pode ficar em CONTAGEM NEGATIVA ' +
          '(só informativo). Volte a controlar quando repor.',
      )
    )
      return;
    try {
      await api.produtoPermiteNegativo(p.id, ativo);
      toast.success(ativo ? 'Produto reativado (contagem negativa).' : 'Controle de estoque religado.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao reativar');
    }
  }

  async function duplicar(p: any) {
    try {
      await api.duplicarProduto(p.id);
      toast.success(`"${p.nome}" duplicado.`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao duplicar');
    }
  }

  // Duplicar o produto que está aberto no editor (botão do cabeçalho).
  async function duplicarAtual() {
    if (!editId) return;
    try {
      await api.duplicarProduto(editId);
      toast.success('Produto duplicado.');
      setFormAberto(false);
      novo();
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao duplicar');
    }
  }

  // Ocultar/retomar = tira/devolve o produto dos dois canais (balcão + cardápio).
  async function pausar(p: any, ativar: boolean) {
    try {
      await api.atualizarProduto(p.id, { disponivelBalcao: ativar, disponivelCardapio: ativar });
      toast.success(ativar ? 'Produto retomado.' : 'Produto ocultado.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao alterar');
    }
  }

  function copiarLink(p: any) {
    const base = cardapio?.cardapioBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
    if (!cardapio?.token) {
      toast.error('Configure o cardápio digital primeiro (Delivery → Configurações).');
      return;
    }
    const link = `${base}/c/${cardapio.token}?p=${p.id}`;
    navigator.clipboard?.writeText(link).then(
      () => toast.success('Link do produto copiado.'),
      () => toast.error('Não foi possível copiar.'),
    );
  }

  async function addCategoria() {
    if (!catNome.trim()) return;
    try {
      await api.criarCategoriaProduto({ nome: catNome.trim() });
      setCatNome('');
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
    <Shell eyebrow="Cadastros" title="Cardápio">
      <div className="flex h-full min-h-0 w-full flex-col gap-4">
        {erro && <p className="text-destructive">{erro}</p>}

        {formAberto ? (
          /* ---------- Editor em página cheia (substitui a lista, sem modal) ---------- */
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Cabeçalho do editor: voltar · título · duplicar · salvar */}
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={fecharForm}
                aria-label="Voltar para a lista"
                className="grid h-9 w-9 flex-none place-items-center rounded-lg border border-border bg-card text-lg transition-colors hover:border-primary hover:text-primary"
              >
                ←
              </button>
              <div className="min-w-0">
                <p className="font-display text-[10px] font-bold uppercase tracking-wide text-primary/80">
                  Cardápio · {editId ? 'editar' : 'novo'}
                </p>
                <h2 className="truncate font-display text-lg font-bold">
                  {editId ? f.nome || 'Editar produto' : 'Novo produto'}
                </h2>
              </div>
              <div className="ml-auto flex gap-2">
                {editId && (
                  <Button type="button" variant="outline" size="sm" onClick={duplicarAtual}>
                    Duplicar
                  </Button>
                )}
                <Button type="button" size="sm" onClick={() => salvar()} disabled={salvando}>
                  {salvando ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
            </div>

            {/* Sub-abas: Informações · Complementos · Disponibilidade
                (as duas últimas só ao editar um produto já salvo). */}
            <div className="flex flex-wrap gap-1 border-b border-border">
              {([['info', 'Informações'], ['complementos', 'Complementos'], ['disponibilidade', 'Disponibilidade']] as const).map(([k, label]) => {
                const bloqueado = k !== 'info' && !editId;
                return (
                  <button
                    key={k}
                    type="button"
                    disabled={bloqueado}
                    onClick={() => setModalAba(k)}
                    title={bloqueado ? 'Salve o produto primeiro' : undefined}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                      modalAba === k ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
                    } ${bloqueado ? 'cursor-not-allowed opacity-40' : ''}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="scroll-fino min-h-0 flex-1 overflow-y-auto pr-1 pt-4">
              {modalAba === 'info' && (
                <ProdutoForm
                  f={f}
                  set={set}
                  editId={editId}
                  salvando={salvando}
                  categorias={categorias}
                  fichas={fichas}
                  insumos={insumos}
                  setores={setores}
                  produtos={produtos}
                  verFin={verFin}
                  catLabel={catLabel}
                  canaisAtivos={canaisAtivos}
                  onSubmit={salvar}
                  onCancel={fecharForm}
                />
              )}

              {modalAba === 'complementos' && editId && (
                <div className="space-y-4">
                  <ProdutoEtapasCard produtoId={editId} />
                  <ComplementosCard
                    comps={comps}
                    fichaIngs={fichaIngs}
                    insumos={insumos}
                    produtos={produtos ?? []}
                    novoGrupo={novoGrupo}
                    setNovoGrupo={setNovoGrupo}
                    onAddOpcao={addOpcao}
                    onDelGrupo={delGrupo}
                    onDelOpcao={delOpcao}
                    onAddGrupo={addGrupo}
                  />
                  <FaixasCard faixas={faixas} setFaixas={setFaixas} onSalvar={salvarFaixas} />
                </div>
              )}

              {modalAba === 'disponibilidade' && (
                <div className="space-y-4">
                  {/* Controle de validade — fonte das etiquetas (RDC 216).
                      Os canais de venda ficam na aba Informações (coluna Status). */}
                  <Card className="p-4">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={!!f.controlaValidade} onChange={(e) => set({ controlaValidade: e.target.checked })} className="h-4 w-4 accent-primary" />
                      Controla validade (gera etiqueta)
                    </label>
                    {f.controlaValidade && (
                      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Validade fechado (dias)</Label>
                          <Input type="number" value={f.validadeFechadoDias ?? ''} onChange={(e) => set({ validadeFechadoDias: e.target.value })} placeholder="ex.: 90" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Validade após aberto (dias)</Label>
                          <Input type="number" value={f.validadeAbertoDias ?? ''} onChange={(e) => set({ validadeAbertoDias: e.target.value })} placeholder="RDC 216: até 30" />
                        </div>
                      </div>
                    )}
                  </Card>

                  {editId && (
                    <DestinosCard
                      equipamentos={equipamentos}
                      destinosSel={destinosSel}
                      toggleDestino={toggleDestino}
                      salvandoDest={salvandoDest}
                      onSalvar={salvarDestinos}
                    />
                  )}

                  <Button type="button" onClick={() => salvar()} disabled={salvando}>
                    {salvando ? 'Salvando…' : 'Salvar disponibilidade'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ---------- Lista / abas do catálogo ---------- */
          <>
            <div className="flex flex-wrap items-center gap-1 border-b border-border">
              {([['produtos', 'Produtos'], ['complementos', 'Complementos'], ['opcoes', 'Opções']] as const).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setAba(k)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${aba === k ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                >
                  {label}
                </button>
              ))}
              {aba === 'produtos' && (
                <button
                  type="button"
                  onClick={abrirNovo}
                  className="mb-1 ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:border-primary hover:text-primary"
                >
                  ＋ Novo produto
                </button>
              )}
            </div>

            {aba === 'opcoes' && <div className="scroll-fino min-h-0 flex-1 overflow-y-auto pr-1"><OpcoesCard /></div>}
            {aba === 'complementos' && <div className="scroll-fino min-h-0 flex-1 overflow-y-auto pr-1"><ComplementosCatalogoCard /></div>}

            {aba === 'produtos' && (
              <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(240px,320px)_1fr]">
                {/* Sidebar de categorias — rola sozinha (separada do corpo) */}
                <div className="scroll-fino rounded-xl border border-border bg-card/40 p-1 lg:min-h-0 lg:overflow-y-auto">
                  <CategoriasCard
                    categorias={categorias}
                    catNome={catNome}
                    setCatNome={setCatNome}
                    onAdd={addCategoria}
                    catLabel={catLabel}
                    reload={reload}
                    selected={catSel}
                    onSelect={setCatSel}
                  />
                </div>
                {/* Lista de produtos agrupada por categoria — rola sozinha */}
                <div className="scroll-fino min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
                  <ProdutosLista
                    produtos={produtosFiltrados}
                    categorias={categorias}
                    onEditar={editar}
                    onRemover={remover}
                    onReativar={reativar}
                    onDuplicar={duplicar}
                    onPausar={pausar}
                    onCopiarLink={copiarLink}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
