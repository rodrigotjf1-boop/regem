// GESTÃO DO CATÁLOGO › PRODUTOS E PREÇOS (R3, fase F1; protótipo aprovado pelo dono em 11/11/2026 —
// `mockups/regem-conciliacao-ifood.html`). As regras puras da tela (sem React), conferidas por `npm run check:catalogo`.
//
// Os canais, no que o produto guarda:
//   • Regem (balcão e cardápio digital) — o preço de venda; a pausa desliga os dois juntos (`disponivelBalcao` e
//     `disponivelCardapio`). Desde a mig 399 essa pausa NÃO pausa no iFood: cada canal se pausa no seu botão.
//   • iFood — o preço no iFood (`precoIfood`, só com o iFood pelo Orzuni ligado), o "está no cardápio do iFood"
//     (`noIfood`) e o "Pausado no iFood" ('ifood' em `canaisPausados`). O esgotado do estoque também pausa lá.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ProdutoDaGestao = {
  id: string;
  nome: string;
  descricao?: string | null;
  codigo?: string | null;
  categoriaId?: string | null;
  categoriaNome?: string | null;
  imagemRef?: string | null;
  precoVenda?: string | number | null;
  precoIfood?: string | number | null;
  noIfood?: boolean;
  disponivelBalcao?: boolean;
  disponivelCardapio?: boolean;
  canaisPausados?: unknown;
  pausadoEstoque?: boolean;
  permiteNegativo?: boolean;
};
export type CategoriaDaGestao = { id: string; nome: string; ordem?: number | null };

/** A lista de canais pausados, sempre como lista de texto (o banco guarda jsonb; pode vir nulo). */
export function canaisPausados(p: Pick<ProdutoDaGestao, 'canaisPausados'>): string[] {
  const v = p.canaisPausados;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** O Regem pausado = fora do balcão E do cardápio digital. `parcial` diz quando só um dos dois está fora. */
export function pausaNoRegem(p: Pick<ProdutoDaGestao, 'disponivelBalcao' | 'disponivelCardapio'>): { pausado: boolean; parcial: string | null } {
  const balcao = p.disponivelBalcao !== false;
  const cardapio = p.disponivelCardapio !== false;
  if (!balcao && !cardapio) return { pausado: true, parcial: null };
  if (!balcao) return { pausado: false, parcial: 'fora do balcão' };
  if (!cardapio) return { pausado: false, parcial: 'fora do cardápio digital' };
  return { pausado: false, parcial: null };
}

export const pausadoNoIfood = (p: ProdutoDaGestao) => canaisPausados(p).includes('ifood');

/** Esgotado pelo estoque (todas as lojas): pausa o balcão, o cardápio e o iFood, até o estoque voltar. */
export const esgotado = (p: ProdutoDaGestao) => p.pausadoEstoque === true && p.permiteNegativo !== true;

const temValor = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';

/** Está no iFood e sem o preço de lá: o Regem não manda preço nenhum (só com o iFood pelo Orzuni ligado). */
export const semPrecoNoIfood = (p: ProdutoDaGestao) => p.noIfood === true && !temValor(p.precoIfood);

/** Pausado em algum canal (o Regem, ou o iFood quando o produto está lá). */
export function pausadoEmAlgumCanal(p: ProdutoDaGestao, comIfood: boolean): boolean {
  return pausaNoRegem(p).pausado || (comIfood && p.noIfood === true && pausadoNoIfood(p));
}

/**
 * O texto do preço digitado, conferido ANTES de mandar (o servidor confere de novo e diz o motivo):
 *  • vazio → `null` só onde vazio vale (o preço do iFood: "o Regem não mexe"); senão, erro;
 *  • aceita "39,90", "39.9", "1.234,50" e "R$ 39,90"; até 2 casas; maior que zero.
 * Devolve o valor em texto com ponto (o que a API recebe) ou o erro para mostrar no campo.
 */
export function precoDigitado(texto: string, permiteVazio: boolean): { valor: string | null } | { erro: string } {
  const t = String(texto ?? '').replace(/R\$\s?/i, '').trim();
  if (!t) return permiteVazio ? { valor: null } : { erro: 'Digite o preço, ex.: 39,90.' };
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d+)?$/.test(normal)) return { erro: 'Use só números, ex.: 39,90.' };
  const n = Number(normal);
  if (!(n > 0)) return { erro: permiteVazio ? 'Digite um preço maior que zero (ou deixe em branco).' : 'Digite um preço maior que zero.' };
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return { erro: 'Use no máximo 2 casas, ex.: 39,90.' };
  if (n > 999_999.99) return { erro: 'Preço alto demais: confira o valor.' };
  return { valor: n.toFixed(2) };
}

/** O valor do campo ao abrir o lápis: "39,90" (vazio quando não há preço). */
export function precoNoCampo(v: unknown): string {
  if (!temValor(v)) return '';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '';
}

// ── a gaveta de editar ─────────────────────────────────────────────────────────────────────────────────────────────
export type EdicaoDoProduto = {
  nome: string;
  descricao: string;
  codigo: string;
  categoriaId: string;
  imagemRef: string;
  precoRegem: string;
  precoIfood: string;
  pausaRegem: boolean;
  noIfood: boolean;
  pausaIfood: boolean;
};

export function edicaoInicial(p: ProdutoDaGestao): EdicaoDoProduto {
  return {
    nome: p.nome ?? '',
    descricao: p.descricao ?? '',
    codigo: p.codigo ?? '',
    categoriaId: p.categoriaId ?? '',
    imagemRef: p.imagemRef ?? '',
    precoRegem: precoNoCampo(p.precoVenda),
    precoIfood: precoNoCampo(p.precoIfood),
    pausaRegem: pausaNoRegem(p).pausado,
    noIfood: p.noIfood === true,
    pausaIfood: pausadoNoIfood(p),
  };
}

export type PlanoDaEdicao = {
  erros: string[];
  /** O que muda no Regem, em palavras. */
  regem: string[];
  /** O que vai ao iFood agora (pelo Orzuni). */
  ifoodVai: string[];
  /** O que NÃO vai ao iFood (e onde se muda). */
  ifoodAtencao: string[];
  mudou: boolean;
  /** As gravações, na ordem: o PATCH do cadastro, depois os preços, depois as pausas. */
  patch: Record<string, unknown>;
  precos: { canal: 'regem' | 'ifood'; valor: string | null }[];
  pausas: { canal: 'regem' | 'ifood'; pausado: boolean }[];
};

const reais = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? 'sem preço' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const doisDecimais = (v: unknown) => (temValor(v) && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : null);

/**
 * O que salvar a gaveta faz — a mesma conta que a tela mostra em "Ao salvar" e que o salvar executa. Os erros vêm ANTES
 * de qualquer gravação (V86): código que já é de outro produto, nome ou categoria vazios, preço inválido.
 */
export function analisarEdicao(
  p: ProdutoDaGestao,
  e: EdicaoDoProduto,
  ctx: { comIfood: boolean; podeMudarPreco: boolean; outros: Pick<ProdutoDaGestao, 'id' | 'nome' | 'codigo'>[]; categorias: CategoriaDaGestao[] },
): PlanoDaEdicao {
  const erros: string[] = [];
  const regem: string[] = [];
  const ifoodVai: string[] = [];
  const ifoodAtencao: string[] = [];
  const patch: Record<string, unknown> = {};
  const precos: PlanoDaEdicao['precos'] = [];
  const pausas: PlanoDaEdicao['pausas'] = [];

  const nome = e.nome.trim();
  if (!nome) erros.push('Digite o nome do produto.');
  else if (nome !== (p.nome ?? '').trim()) {
    patch.nome = nome;
    regem.push(`nome "${(p.nome ?? '').trim()}" → "${nome}"`);
  }
  const desc = e.descricao.trim();
  if (desc !== (p.descricao ?? '').trim()) {
    patch.descricao = desc || null;
    regem.push(desc ? 'descrição' : 'descrição apagada');
  }
  const codAntes = (p.codigo ?? '').trim();
  const cod = e.codigo.trim();
  if (cod !== codAntes) {
    const dono = cod ? ctx.outros.find((o) => o.id !== p.id && (o.codigo ?? '').trim() === cod) : undefined;
    if (dono) erros.push(`O código ${cod} já é do produto "${dono.nome}": um código liga a um produto só.`);
    else {
      patch.codigo = cod || null;
      regem.push(`código PDV ${codAntes || '(sem código)'} → ${cod || '(sem código)'}`);
    }
  }
  if (!e.categoriaId) erros.push('Escolha a categoria.');
  else if (e.categoriaId !== (p.categoriaId ?? '')) {
    patch.categoriaId = e.categoriaId;
    const nomeCat = ctx.categorias.find((c) => c.id === e.categoriaId)?.nome ?? 'outra';
    regem.push(`categoria ${p.categoriaNome ?? '(sem categoria)'} → ${nomeCat}`);
  }
  const foto = e.imagemRef.trim();
  if (foto !== (p.imagemRef ?? '').trim()) {
    patch.imagemRef = foto || null;
    regem.push(foto ? 'foto' : 'foto tirada');
  }

  if (ctx.podeMudarPreco) {
    const r = precoDigitado(e.precoRegem, false);
    if ('erro' in r) erros.push(`Preço de venda: ${r.erro}`);
    else if (r.valor !== doisDecimais(p.precoVenda)) {
      precos.push({ canal: 'regem', valor: r.valor });
      regem.push(`preço de venda ${reais(doisDecimais(p.precoVenda))} → ${reais(r.valor)}`);
    }
  }
  if (e.pausaRegem !== pausaNoRegem(p).pausado) {
    pausas.push({ canal: 'regem', pausado: e.pausaRegem });
    regem.push(e.pausaRegem ? 'pausado no balcão e no cardápio digital' : 'volta ao balcão e ao cardápio digital');
  }

  if (ctx.comIfood) {
    const liga = !!cod;
    if (e.noIfood !== (p.noIfood === true)) {
      patch.noIfood = e.noIfood;
      if (liga) ifoodVai.push(e.noIfood ? 'entra no cardápio do iFood: vão o preço e a situação' : 'sai do cardápio do iFood: o item lá fica pausado');
    }
    if (ctx.podeMudarPreco) {
      const r = precoDigitado(e.precoIfood, true);
      if ('erro' in r) erros.push(`Preço no iFood: ${r.erro}`);
      else if (r.valor !== doisDecimais(p.precoIfood)) {
        precos.push({ canal: 'ifood', valor: r.valor });
        if (!e.noIfood || !liga) regem.push(`preço no iFood ${reais(doisDecimais(p.precoIfood))} → ${reais(r.valor)} (guardado)`);
        else if (r.valor === null) ifoodAtencao.push('preço em branco: o Regem deixa de mexer no preço de lá');
        else ifoodVai.push(`preço ${reais(doisDecimais(p.precoIfood))} → ${reais(r.valor)}`);
      }
    }
    if (e.noIfood && e.pausaIfood !== pausadoNoIfood(p)) {
      pausas.push({ canal: 'ifood', pausado: e.pausaIfood });
      if (liga) ifoodVai.push(e.pausaIfood ? 'pausa' : 'reativa');
      if (!e.pausaIfood && esgotado(p)) ifoodAtencao.push('esgotado pelo estoque: segue pausado no iFood até o estoque voltar');
    }
    if (e.noIfood) {
      if (!liga) ifoodAtencao.push('sem código PDV: nada vai ao iFood (é pelo código que o item se liga)');
      else {
        if ('nome' in patch || 'descricao' in patch) ifoodAtencao.push('o nome e a descrição no iFood mudam no Gestor de Pedidos');
        if ('codigo' in patch && codAntes)
          ifoodAtencao.push(`no iFood o item segue com o código ${codAntes}: troque lá no Gestor de Pedidos para o preço e a pausa chegarem`);
        if ('imagemRef' in patch) ifoodAtencao.push('a foto no iFood muda no Gestor de Pedidos');
      }
    }
  }

  const mudou = Object.keys(patch).length > 0 || precos.length > 0 || pausas.length > 0;
  return { erros, regem, ifoodVai, ifoodAtencao, mudou, patch, precos, pausas };
}

/**
 * Os produtos agrupados por categoria, na ordem do cardápio (a `ordem` da categoria; depois o nome); "Sem categoria" por
 * último (produto sem categoria ou com uma que não existe mais). Dentro do grupo, por nome.
 */
export function agruparPorCategoria<T extends ProdutoDaGestao>(produtos: T[], categorias: CategoriaDaGestao[]): { id: string; nome: string; produtos: T[] }[] {
  const ordem = [...categorias].sort((a, b) => (a.ordem ?? 9999) - (b.ordem ?? 9999) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const existe = new Set(ordem.map((c) => c.id));
  const porNome = (a: T, b: T) => a.nome.localeCompare(b.nome, 'pt-BR');
  const grupos = ordem
    .map((c) => ({ id: c.id, nome: c.nome, produtos: produtos.filter((p) => p.categoriaId === c.id).sort(porNome) }))
    .filter((g) => g.produtos.length > 0);
  const sem = produtos.filter((p) => !p.categoriaId || !existe.has(p.categoriaId)).sort(porNome);
  if (sem.length) grupos.push({ id: '', nome: 'Sem categoria', produtos: sem });
  return grupos;
}
