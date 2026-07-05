'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { vazio, type Variacao, type Combo } from '@/components/produtos/types';
import { useProdutosData } from '@/components/produtos/use-produtos-data';
import { CategoriasCard } from '@/components/produtos/categorias-card';
import { ProdutoForm } from '@/components/produtos/produto-form';
import { DestinosCard } from '@/components/produtos/destinos-card';
import { FaixasCard } from '@/components/produtos/faixas-card';
import { ComplementosCard } from '@/components/produtos/complementos-card';
import { ProdutosLista } from '@/components/produtos/produtos-lista';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function ProdutosPage() {
  const router = useRouter();
  const { produtos, categorias, fichas, setores, equipamentos, erro, setErro, reload } =
    useProdutosData();

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
  const [destinosSel, setDestinosSel] = useState<string[]>([]);
  const [salvandoDest, setSalvandoDest] = useState(false);
  const [faixas, setFaixas] = useState<{ qtdMin: string; preco: string }[]>([]);

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
        destaque: p.destaque ?? false,
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
        destaque: f.destaque,
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

        <CategoriasCard
          categorias={categorias}
          catNome={catNome}
          setCatNome={setCatNome}
          catParent={catParent}
          setCatParent={setCatParent}
          onAdd={addCategoria}
          catLabel={catLabel}
        />

        <ProdutoForm
          f={f}
          set={set}
          editId={editId}
          salvando={salvando}
          categorias={categorias}
          fichas={fichas}
          setores={setores}
          produtos={produtos}
          catLabel={catLabel}
          onSubmit={salvar}
          onCancel={novo}
        />

        {editId && (
          <DestinosCard
            equipamentos={equipamentos}
            destinosSel={destinosSel}
            toggleDestino={toggleDestino}
            salvandoDest={salvandoDest}
            onSalvar={salvarDestinos}
          />
        )}

        {editId && (
          <FaixasCard faixas={faixas} setFaixas={setFaixas} onSalvar={salvarFaixas} />
        )}

        {editId && (
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
        )}

        <ProdutosLista produtos={produtos} onEditar={editar} onRemover={remover} />
      </div>
    </Shell>
  );
}
