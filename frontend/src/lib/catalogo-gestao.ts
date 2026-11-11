// GESTÃO DO CATÁLOGO › PRODUTOS E PREÇOS (R3, fase F1; protótipo aprovado pelo dono em 11/11/2026 —
// `mockups/regem-conciliacao-ifood.html`). As regras puras da tela (sem React), conferidas por `npm run check:catalogo`.
//
// Os canais, no que o produto guarda:
//   • Regem (balcão e cardápio digital) — o preço de venda; a pausa desliga os dois juntos (`disponivelBalcao` e
//     `disponivelCardapio`). Desde a mig 399 essa pausa NÃO pausa no iFood: cada canal se pausa no seu botão.
//   • iFood — o preço no iFood (`precoIfood`, só com o iFood pelo Orzuni ligado), o "está no cardápio do iFood"
//     (`noIfood`) e o "Pausado no iFood" ('ifood' em `canaisPausados`). O esgotado do estoque também pausa lá.
//   • 99 (fase F2, mig 401/402) — o preço na 99 (`preco99`, só com o direito "Preço e pausa na 99" ligado), o "está no
//     cardápio da 99" (`na99`) e o "Pausado na 99" ('99food' em `canaisPausados`). O esgotado também pausa lá. Vão à 99
//     na hora, item a item; o código NÃO muda lá (a 99 não troca o código de um item).

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
  preco99?: string | number | null;
  na99?: boolean;
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
export const pausadoNa99 = (p: ProdutoDaGestao) => canaisPausados(p).includes('99food');

/** Esgotado pelo estoque (todas as lojas): pausa o balcão, o cardápio, o iFood e a 99, até o estoque voltar. */
export const esgotado = (p: ProdutoDaGestao) => p.pausadoEstoque === true && p.permiteNegativo !== true;

const temValor = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';

/** Está no iFood e sem o preço de lá: o Regem não manda preço nenhum (só com o iFood pelo Orzuni ligado). */
export const semPrecoNoIfood = (p: ProdutoDaGestao) => p.noIfood === true && !temValor(p.precoIfood);

/** Está na 99 e sem o preço de lá: o Regem não muda o preço lá (o "Exportar catálogo" da 99 manda o de venda). */
export const semPrecoNa99 = (p: ProdutoDaGestao) => p.na99 === true && !temValor(p.preco99);

/** Pausado em algum canal (o Regem, ou o iFood / a 99 quando o produto está lá). */
export function pausadoEmAlgumCanal(p: ProdutoDaGestao, comIfood: boolean, com99 = false): boolean {
  return (
    pausaNoRegem(p).pausado ||
    (comIfood && p.noIfood === true && pausadoNoIfood(p)) ||
    (com99 && p.na99 === true && pausadoNa99(p))
  );
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
  preco99: string;
  na99: boolean;
  pausa99: boolean;
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
    preco99: precoNoCampo(p.preco99),
    na99: p.na99 === true,
    pausa99: pausadoNa99(p),
  };
}

export type CanalDaGestao = 'regem' | 'ifood' | '99food';

export type PlanoDaEdicao = {
  erros: string[];
  /** O que muda no Regem, em palavras. */
  regem: string[];
  /** O que vai ao iFood agora (pelo Orzuni). */
  ifoodVai: string[];
  /** O que NÃO vai ao iFood (e onde se muda). */
  ifoodAtencao: string[];
  /** O que vai à 99 agora. */
  n99Vai: string[];
  /** O que NÃO vai à 99 (e por quê). */
  n99Atencao: string[];
  mudou: boolean;
  /** As gravações, na ordem: o PATCH do cadastro, depois os preços, depois as pausas. */
  patch: Record<string, unknown>;
  precos: { canal: CanalDaGestao; valor: string | null }[];
  pausas: { canal: CanalDaGestao; pausado: boolean }[];
};

/** Os limites do iFood (o Orzuni recusa acima; o servidor não manda). */
export const LIMITE_NOME_IFOOD = 100;
export const LIMITE_DESCRICAO_IFOOD = 500;
/** Os limites da 99 (doc 1967 "Update One Item"; o servidor não manda acima). */
export const LIMITE_NOME_99 = 180;
export const LIMITE_DESCRICAO_99 = 1500;

const reais = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? 'sem preço' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const doisDecimais = (v: unknown) => (temValor(v) && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : null);
/** "R$ 45,00 → R$ 49,90"; sem preço antes, só o novo ("R$ 49,90") — nada de "sem preço → …". */
const deAte = (antes: unknown, depois: string | null) => {
  const a = doisDecimais(antes);
  return a === null ? reais(depois) : `${reais(a)} → ${reais(depois)}`;
};

/**
 * O que salvar a gaveta faz — a mesma conta que a tela mostra em "Ao salvar" e que o salvar executa. Os erros vêm ANTES
 * de qualquer gravação (V86): código que já é de outro produto, nome ou categoria vazios, preço inválido.
 */
export function analisarEdicao(
  p: ProdutoDaGestao,
  e: EdicaoDoProduto,
  ctx: {
    comIfood: boolean;
    com99?: boolean;
    podeMudarPreco: boolean;
    outros: Pick<ProdutoDaGestao, 'id' | 'nome' | 'codigo'>[];
    categorias: CategoriaDaGestao[];
  },
): PlanoDaEdicao {
  const erros: string[] = [];
  const regem: string[] = [];
  const ifoodVai: string[] = [];
  const ifoodAtencao: string[] = [];
  const n99Vai: string[] = [];
  const n99Atencao: string[] = [];
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
        else ifoodVai.push(`preço ${deAte(p.precoIfood, r.valor)}`);
      }
    }
    if (e.noIfood && e.pausaIfood !== pausadoNoIfood(p)) {
      pausas.push({ canal: 'ifood', pausado: e.pausaIfood });
      if (liga) ifoodVai.push(e.pausaIfood ? 'pausa' : 'reativa');
      if (!e.pausaIfood && esgotado(p)) ifoodAtencao.push('esgotado pelo estoque: segue pausado no iFood até o estoque voltar');
    }
    if (e.noIfood) {
      if (!liga) ifoodAtencao.push('sem código PDV: nada vai ao iFood (é pelo código que o item se liga)');
      else if (p.noIfood === true) {
        // R3 F1b (Orzuni 1.2.0): o código, o nome e a descrição vão ao iFood — a troca do código sai antes do resto.
        if ('codigo' in patch && codAntes) ifoodVai.unshift(`troca o código ${codAntes} → ${cod}`);
        const vaiNome = 'nome' in patch;
        const vaiDesc = 'descricao' in patch;
        if (vaiNome || vaiDesc) ifoodVai.push(vaiNome && vaiDesc ? 'nome e descrição' : vaiNome ? 'nome' : 'descrição');
        if (vaiNome && nome.length > LIMITE_NOME_IFOOD) ifoodAtencao.push(`o iFood aceita nome até ${LIMITE_NOME_IFOOD} caracteres: o nome não vai`);
        if (vaiDesc && desc.length > LIMITE_DESCRICAO_IFOOD)
          ifoodAtencao.push(`o iFood aceita descrição até ${LIMITE_DESCRICAO_IFOOD} caracteres: a descrição não vai`);
      } else if ('nome' in patch || 'descricao' in patch) {
        // Entrar no iFood não sobrescreve o cadastro de lá (o item já existe no Gestor de Pedidos com o nome dele).
        ifoodAtencao.push('ao entrar no iFood, o nome e a descrição de lá ficam como estão');
      }
      if (liga && 'imagemRef' in patch) ifoodAtencao.push('a foto no iFood muda no Gestor de Pedidos');
    }
  }

  // A 99 (R3 F2): o preço, a situação, o nome e a descrição vão na hora, item a item, pelo código PDV.
  if (ctx.com99) {
    const liga = !!cod;
    if (e.na99 !== (p.na99 === true)) {
      patch.na99 = e.na99;
      if (liga) n99Vai.push(e.na99 ? 'entra no cardápio da 99: vão o preço e a situação' : 'sai do cardápio da 99: o item lá fica pausado');
    }
    if (ctx.podeMudarPreco) {
      const r = precoDigitado(e.preco99, true);
      if ('erro' in r) erros.push(`Preço na 99: ${r.erro}`);
      else if (r.valor !== doisDecimais(p.preco99)) {
        precos.push({ canal: '99food', valor: r.valor });
        if (!e.na99 || !liga) regem.push(`preço na 99 ${reais(doisDecimais(p.preco99))} → ${reais(r.valor)} (guardado)`);
        else if (r.valor === null) n99Atencao.push('preço em branco: o Regem deixa de mexer no preço de lá');
        else n99Vai.push(`preço ${deAte(p.preco99, r.valor)}`);
      }
    }
    if (e.na99 && e.pausa99 !== pausadoNa99(p)) {
      pausas.push({ canal: '99food', pausado: e.pausa99 });
      if (liga) n99Vai.push(e.pausa99 ? 'pausa' : 'reativa');
      if (!e.pausa99 && esgotado(p)) n99Atencao.push('esgotado pelo estoque: segue pausado na 99 até o estoque voltar');
    }
    if (e.na99) {
      if (!liga) n99Atencao.push('sem código PDV: nada vai à 99 (é pelo código que o item se liga)');
      else if (p.na99 === true && 'codigo' in patch && codAntes) {
        // A 99 não troca o código de um item (o `app_item_id` é fixo): o código novo liga a outro item de lá.
        n99Atencao.push(`a 99 não troca o código de um item: com o código ${cod}, o produto passa a ligar ao item da 99 que tem esse código`);
        if ('nome' in patch || 'descricao' in patch) n99Atencao.push('com o código novo, o nome e a descrição de lá ficam como estão');
      } else if (p.na99 === true) {
        const vaiNome = 'nome' in patch;
        const vaiDesc = 'descricao' in patch;
        if (vaiNome || vaiDesc) n99Vai.push(vaiNome && vaiDesc ? 'nome e descrição' : vaiNome ? 'nome' : 'descrição');
        if (vaiNome && nome.length > LIMITE_NOME_99) n99Atencao.push(`a 99 aceita nome até ${LIMITE_NOME_99} caracteres: o nome não vai`);
        if (vaiDesc && desc.length > LIMITE_DESCRICAO_99) n99Atencao.push(`a 99 aceita descrição até ${LIMITE_DESCRICAO_99} caracteres: a descrição não vai`);
      } else if ('nome' in patch || 'descricao' in patch) {
        n99Atencao.push('ao entrar na 99, o nome e a descrição de lá ficam como estão');
      }
      if (liga && 'imagemRef' in patch) n99Atencao.push('a foto da 99 não muda pelo Regem ainda');
    }
  }

  const mudou = Object.keys(patch).length > 0 || precos.length > 0 || pausas.length > 0;
  return { erros, regem, ifoodVai, ifoodAtencao, n99Vai, n99Atencao, mudou, patch, precos, pausas };
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

// ══ COMPLEMENTOS (R3, fase F3a; protótipo, "Produtos | Complementos") ═══════════════════════════════════════════════
// O complemento é a OPÇÃO do catálogo (Cadastros › Cardápio › Opções) dentro de um grupo (a etapa). O preço no Regem é
// POR GRUPO (o que o balcão e o cardápio digital cobram nele); nos apps é UM por código PDV, em todos os grupos. A pausa
// é por canal ('regem', 'ifood', '99food' em `canaisPausados`) e vale em todos os grupos; o "Em falta" (`esgotado`, do
// Cadastros) pausa em TODOS os canais. Opção sem código PDV é informativa: vai como observação, sem preço nem apps.

export type OpcaoDoGrupo = {
  opcaoId: string;
  nome: string;
  codigoPdv?: string | null;
  /** O preço NESTE grupo (Regem). */
  preco?: string | number | null;
  esgotado?: boolean;
  ativo?: boolean;
  canaisPausados?: unknown;
  precoIfood?: string | number | null;
  preco99?: string | number | null;
  imagemRef?: string | null;
};
export type GrupoDeComplementos = { id: string; nome: string; ativo?: boolean; produtos: { id: string; nome: string }[]; opcoes: OpcaoDoGrupo[] };

/** Opção sem código PDV: informativa (vai como observação, sem preço nem estoque, não liga aos apps). */
export const informativa = (o: Pick<OpcaoDoGrupo, 'codigoPdv'>) => !(o.codigoPdv ?? '').trim();

/** O complemento está pausado NESTE canal: pela pausa do canal ou pelo "Em falta" (todos os canais). */
export function opcaoPausadaNo(o: OpcaoDoGrupo, canal: 'regem' | 'ifood' | '99food'): boolean {
  return o.esgotado === true || canaisPausados(o).includes(canal);
}

/** Pausado em algum canal visível (o Regem sempre; o iFood só com ele ligado). */
export function opcaoPausadaEmAlgumCanal(o: OpcaoDoGrupo, comIfood: boolean): boolean {
  return opcaoPausadaNo(o, 'regem') || (comIfood && !informativa(o) && opcaoPausadaNo(o, 'ifood'));
}

/** Com código e sem o preço do iFood (só com o iFood pelo Orzuni ligado): o Regem não manda preço nenhum. */
export const opcaoSemPrecoNoIfood = (o: OpcaoDoGrupo) => !informativa(o) && !temValor(o.precoIfood);

/** Os grupos em que a opção aparece (para a gaveta: o preço do Regem em cada um). */
export function gruposDaOpcao(grupos: GrupoDeComplementos[], opcaoId: string): { id: string; nome: string; preco: string | number | null | undefined }[] {
  return grupos.flatMap((g) => g.opcoes.filter((o) => o.opcaoId === opcaoId).map((o) => ({ id: g.id, nome: g.nome, preco: o.preco })));
}

export type EdicaoDaOpcao = {
  /** O preço digitado em cada grupo (grupoId → texto). */
  precos: Record<string, string>;
  precoIfood: string;
  pausaRegem: boolean;
  pausaIfood: boolean;
};

export function edicaoInicialDaOpcao(o: OpcaoDoGrupo, grupos: { id: string; preco: string | number | null | undefined }[]): EdicaoDaOpcao {
  return {
    precos: Object.fromEntries(grupos.map((g) => [g.id, precoNoCampo(g.preco) || '0,00'])),
    precoIfood: precoNoCampo(o.precoIfood),
    pausaRegem: canaisPausados(o).includes('regem'),
    pausaIfood: canaisPausados(o).includes('ifood'),
  };
}

/**
 * O preço do complemento digitado: zero VALE (grátis); vazio só onde vale ("o Regem não mexe", nos apps). Até 2 casas.
 * Devolve o valor com ponto (o que a API recebe) ou o erro para mostrar no campo.
 */
export function precoDoComplementoDigitado(texto: string, permiteVazio: boolean): { valor: string | null } | { erro: string } {
  const t = String(texto ?? '').replace(/R\$\s?/i, '').trim();
  if (!t) return permiteVazio ? { valor: null } : { erro: 'Digite o preço (0 para grátis), ex.: 4,50.' };
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  if (!/^\d+(\.\d+)?$/.test(normal)) return { erro: 'Use só números, ex.: 4,50.' };
  const n = Number(normal);
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return { erro: 'Use no máximo 2 casas, ex.: 4,50.' };
  if (n > 999_999.99) return { erro: 'Preço alto demais: confira o valor.' };
  return { valor: n.toFixed(2) };
}

export type PlanoDaOpcao = {
  erros: string[];
  regem: string[];
  ifoodVai: string[];
  ifoodAtencao: string[];
  mudou: boolean;
  /** As gravações, na ordem: os preços de cada grupo, o preço do app, as pausas. */
  precosGrupo: { grupoId: string; valor: string }[];
  precosApp: { canal: 'ifood'; valor: string | null }[];
  pausas: { canal: 'regem' | 'ifood'; pausado: boolean }[];
};

/**
 * O que salvar a gaveta do complemento faz — a mesma conta que a tela mostra em "Ao salvar" e que o salvar executa. Os
 * erros vêm ANTES de qualquer gravação (V86). O "Em falta" não muda aqui (é do Cadastros) e segue pausando tudo.
 */
export function analisarEdicaoDaOpcao(
  o: OpcaoDoGrupo,
  grupos: { id: string; nome: string; preco: string | number | null | undefined }[],
  e: EdicaoDaOpcao,
  ctx: { comIfood: boolean; podeMudarPreco: boolean },
): PlanoDaOpcao {
  const erros: string[] = [];
  const regem: string[] = [];
  const ifoodVai: string[] = [];
  const ifoodAtencao: string[] = [];
  const precosGrupo: PlanoDaOpcao['precosGrupo'] = [];
  const precosApp: PlanoDaOpcao['precosApp'] = [];
  const pausas: PlanoDaOpcao['pausas'] = [];
  const liga = !informativa(o);

  if (ctx.podeMudarPreco && liga) {
    for (const g of grupos) {
      const r = precoDoComplementoDigitado(e.precos[g.id] ?? '', false);
      if ('erro' in r) erros.push(`Preço em "${g.nome}": ${r.erro}`);
      else if (r.valor !== doisDecimais(g.preco ?? 0)) {
        precosGrupo.push({ grupoId: g.id, valor: r.valor as string });
        regem.push(`preço em "${g.nome}" ${reais(doisDecimais(g.preco ?? 0))} → ${reais(r.valor)}`);
      }
    }
  }
  if (e.pausaRegem !== canaisPausados(o).includes('regem')) {
    pausas.push({ canal: 'regem', pausado: e.pausaRegem });
    regem.push(e.pausaRegem ? 'pausado no balcão e no cardápio digital, em todos os grupos' : 'volta ao balcão e ao cardápio digital');
    if (!e.pausaRegem && o.esgotado) regem.push('segue fora: está "Em falta" (Cadastros › Cardápio › Opções)');
  }
  if (ctx.comIfood && liga) {
    if (ctx.podeMudarPreco) {
      const r = precoDoComplementoDigitado(e.precoIfood, true);
      if ('erro' in r) erros.push(`Preço no iFood: ${r.erro}`);
      else if (r.valor !== doisDecimais(o.precoIfood)) {
        precosApp.push({ canal: 'ifood', valor: r.valor });
        if (r.valor === null) ifoodAtencao.push('preço em branco: o Regem deixa de mexer no preço de lá');
        else ifoodVai.push(`preço ${deAte(o.precoIfood, r.valor)}, em todos os grupos com o código ${o.codigoPdv}`);
      }
    }
    if (e.pausaIfood !== canaisPausados(o).includes('ifood')) {
      pausas.push({ canal: 'ifood', pausado: e.pausaIfood });
      ifoodVai.push(e.pausaIfood ? 'pausa' : 'reativa');
      if (!e.pausaIfood && o.esgotado) ifoodAtencao.push('está "Em falta": segue pausado no iFood');
    }
  }
  const mudou = precosGrupo.length > 0 || precosApp.length > 0 || pausas.length > 0;
  return { erros, regem, ifoodVai, ifoodAtencao, mudou, precosGrupo, precosApp, pausas };
}
