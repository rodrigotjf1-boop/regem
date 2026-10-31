/* eslint-disable @typescript-eslint/no-explicit-any */
import { normalizar, reais } from './robo-consultas';

// A BUSCA DO ROBÔ (Fase 5, F2 — pedido do dono de 30/10/2026). "Tem hambúrguer com bacon?":
//  • levam — os produtos que levam bacon: pela FICHA TÉCNICA quando o produto tem ficha (os ingredientes, descendo nas
//    sub-receitas, sem as embalagens), senão pela DESCRIÇÃO; o nome também vale ("X-Bacon");
//  • podeAdicionar — onde o bacon entra como ADICIONAL, com o preço (o preço pode mudar de um lanche para outro);
//  • parecidos — só quando nada acima casou (a busca por pontos de antes).
// Cada produto vai com as versões (tamanhos), os combos/trios que o levam e o LINK DIRETO dele no cardápio.
// "x-bacon", "xbacon" e "x bacon" casam igual. Os nomes da ficha são técnicos ("bacon fatiado 20 g"): servem só para
// ACHAR — o que sai para o robô é "leva bacon", nunca a receita, a quantidade ou o custo.

export type DadosDaBusca = {
  /** produtoId → palavras (normalizadas, com o singular) dos ingredientes da ficha, sub-receitas incluídas. Só produto COM ficha. */
  ingredientes: Map<string, Set<string>>;
  /** produtoId do combo → ids dos produtos que ele leva. */
  componentes: Map<string, string[]>;
  /** Link direto do produto no cardápio (abre o produto). */
  linkDoProduto?: (produtoId: string) => string;
};

/** Palavras que não ajudam a achar nada ("tem", "com", "quanto custa"). */
const PALAVRAS_VAZIAS = new Set(
  (
    'tem tens teria voces voce vcs vc com de do da dos das um uma uns umas o a os as e que quero queria gostaria algum ' +
    'alguma alguns algumas pra para por favor pf pfv no na nos nas me ai qual quais quanto quantos custa custam preco ' +
    'precos valor opcao opcoes cardapio hoje ainda mais ou oi ola bom boa dia tarde noite eu meu minha ter tenho vende ' +
    'vendem servem serve faz fazem ver saber pode podia poderia sim nao'
  ).split(' '),
);

/** Grupos de palavras que indicam o TIPO do produto: casam pelo nome ou pela categoria. */
export const GRUPOS: Record<'sanduiche' | 'bebida' | 'sobremesa' | 'porcao', string[]> = {
  sanduiche: ['hamburguer', 'hamburger', 'burger', 'burguer', 'lanche', 'sanduiche', 'sanduba', 'smash', 'x'],
  bebida: ['bebida', 'refri', 'refrigerante', 'suco', 'cerveja', 'agua', 'drink', 'chopp', 'cha', 'mate', 'soda', 'lata'],
  sobremesa: ['sobremesa', 'doce', 'milkshake', 'shake', 'acai', 'sorvete', 'pudim', 'brownie', 'torta', 'petit'],
  porcao: ['porcao', 'petisco', 'acompanhamento', 'frita', 'batata', 'onion', 'nugget', 'aneis', 'mandioca', 'polenta'],
};

/** As formas de uma palavra para comparar: ela e o singular simples ("porcoes" → "porcao", "batatas" → "batata"). */
export function formas(palavra: string): string[] {
  const w = normalizar(palavra).replace(/ /g, '');
  const f = new Set([w]);
  if (w.length > 4 && w.endsWith('oes')) f.add(`${w.slice(0, -3)}ao`);
  if (w.length > 4 && w.endsWith('aes')) f.add(`${w.slice(0, -3)}ao`);
  if (w.length > 5 && w.endsWith('es')) f.add(w.slice(0, -2));
  if (w.length > 3 && w.endsWith('s')) f.add(w.slice(0, -1));
  return [...f];
}

/** As palavras de um texto, cada uma nas suas formas (para "contém a palavra"). */
export function palavrasDe(texto: unknown): Set<string> {
  const s = new Set<string>();
  for (const w of normalizar(texto).split(' ')) {
    if (!w || /\d/.test(w)) continue; // medida e número ("20 g", "350ml") não são ingrediente
    for (const f of formas(w)) s.add(f);
  }
  return s;
}

const compacto = (s: unknown) => normalizar(s).replace(/ /g, '');
const grupoDa = (palavra: string): keyof typeof GRUPOS | null => {
  for (const g of Object.keys(GRUPOS) as (keyof typeof GRUPOS)[]) {
    if (formas(palavra).some((f) => GRUPOS[g].includes(f))) return g;
  }
  return null;
};

/** O papel da categoria para as sugestões do fim do pedido: bebida, sobremesa ou porção (pelo nome). */
export function papelDaCategoria(nome: unknown): 'bebida' | 'sobremesa' | 'porcao' | null {
  const ws = palavrasDe(nome);
  for (const g of ['bebida', 'sobremesa', 'porcao'] as const) if (GRUPOS[g].some((p) => ws.has(p))) return g;
  return null;
}

/** As categorias do cardápio separadas pelo papel (bebidas, sobremesas, porções), para oferecer no fim do pedido. */
export function categoriasPorPapel(menu: any): { bebidas: string[]; sobremesas: string[]; porcoes: string[] } {
  const r = { bebidas: [] as string[], sobremesas: [] as string[], porcoes: [] as string[] };
  for (const c of Array.isArray(menu?.categorias) ? menu.categorias : []) {
    const p = papelDaCategoria(c?.nome);
    if (p === 'bebida') r.bebidas.push(c.nome);
    else if (p === 'sobremesa') r.sobremesas.push(c.nome);
    else if (p === 'porcao') r.porcoes.push(c.nome);
  }
  return r;
}

type Termo = { texto: string; formas: string[]; grupo: keyof typeof GRUPOS | null };

/** Os termos da pergunta, sem as palavras vazias. "X" sozinho fica (é o "x" de x-bacon). */
export function termosDaBusca(busca: unknown): Termo[] {
  const vistos = new Set<string>();
  const termos: Termo[] = [];
  for (const w of normalizar(busca).split(' ')) {
    if (!w || PALAVRAS_VAZIAS.has(w) || vistos.has(w)) continue;
    if (w.length < 2 && w !== 'x') continue;
    vistos.add(w);
    termos.push({ texto: w, formas: formas(w), grupo: grupoDa(w) });
  }
  return termos;
}

type Adicional = { nome: string; palavras: Set<string>; preco: number };

function adicionaisDo(p: any): Adicional[] {
  const lista: Adicional[] = [];
  for (const g of Array.isArray(p?.grupos) ? p.grupos : []) {
    if (String(g?.tipo ?? '') === 'remover') continue; // "Sem cebola" não é adicional
    for (const o of Array.isArray(g?.opcoes) ? g.opcoes : []) {
      if (o?.informativa) continue; // ponto da carne, talheres: não cobra nem adiciona nada
      lista.push({ nome: String(o.nome), palavras: palavrasDe(o.nome), preco: Number(o.precoDelta) || 0 });
    }
  }
  return lista;
}

const casa = (t: Termo, palavras: Set<string>) => t.formas.some((f) => palavras.has(f));

type Analise = {
  p: any;
  leva: boolean;
  porque: 'nome' | 'ficha' | 'descricao' | null;
  adicionais: { termo: string; adicional: Adicional }[];
  pontos: number;
};

/**
 * A busca do robô. `menu` = o do cardápio público (`CardapioService.menu`); `dados` = ingredientes da ficha, combos e o
 * link do produto (`CardapioService.dadosDaBuscaDoRobo`).
 */
export function procurarNoCardapio(menu: any, busca: string, dados: DadosDaBusca, limite = 10) {
  const produtos: any[] = Array.isArray(menu?.produtos) ? menu.produtos : [];
  const cats = new Map<string, string>((Array.isArray(menu?.categorias) ? menu.categorias : []).map((c: any) => [c.id, c.nome]));
  const porId = new Map(produtos.map((p) => [p.id, p]));
  let termos = termosDaBusca(busca);
  const qCompacta = termos.map((t) => t.texto).join('');

  const nomeW = new Map<string, Set<string>>();
  const catW = new Map<string, Set<string>>();
  const ingW = new Map<string, { palavras: Set<string>; fonte: 'ficha' | 'descricao' }>();
  for (const p of produtos) {
    nomeW.set(p.id, palavrasDe(p.nome));
    catW.set(p.id, palavrasDe(cats.get(p.categoriaId)));
    const ficha = dados.ingredientes.get(p.id);
    // Combo: os ingredientes dos produtos que ele leva (o trio leva o bacon do X-Bacon).
    const doCombo = (dados.componentes.get(p.id) ?? []).flatMap((id) => [...(dados.ingredientes.get(id) ?? [])]);
    if (ficha || doCombo.length) ingW.set(p.id, { palavras: new Set([...(ficha ?? []), ...doCombo]), fonte: 'ficha' });
    else ingW.set(p.id, { palavras: palavrasDe(p.descricao), fonte: 'descricao' });
  }

  const grupoCasa = (t: Termo, p: any) => {
    const g = t.grupo as keyof typeof GRUPOS;
    const ws = new Set([...(nomeW.get(p.id) ?? []), ...(catW.get(p.id) ?? [])]);
    if (GRUPOS[g].some((x) => ws.has(x))) return true;
    return g === 'sanduiche' && /^x[a-z]/.test(compacto(p.nome)); // "X-Bacon", "Xsalada"
  };
  // Termo de TIPO que não casa com nenhum produto não ajuda a separar: sai (o cardápio não usa essa palavra).
  termos = termos.filter((t) => !t.grupo || produtos.some((p) => grupoCasa(t, p)));

  const analisar = (p: any): Analise => {
    const nome = nomeW.get(p.id)!;
    const cat = catW.get(p.id)!;
    const ing = ingW.get(p.id)!;
    const adds = adicionaisDo(p);
    let leva = termos.length > 0;
    let porque: Analise['porque'] = null;
    let pontos = 0;
    const adicionais: Analise['adicionais'] = [];
    const nomeCompacto = compacto(p.nome);
    const casaInteiro = qCompacta.length >= 4 && nomeCompacto.includes(qCompacta);
    if (casaInteiro) pontos += 100;
    if (nomeCompacto === qCompacta) pontos += 100;
    for (const t of termos) {
      if (t.grupo) {
        if (grupoCasa(t, p)) {
          pontos += 5;
          continue;
        }
        leva = false;
        continue;
      }
      if (casa(t, nome) || (t.texto.length >= 4 && nomeCompacto.includes(t.texto))) {
        pontos += 30;
        porque = porque ?? 'nome';
        continue;
      }
      if (casa(t, ing.palavras)) {
        pontos += 20;
        porque = porque === 'nome' ? 'nome' : ing.fonte;
        continue;
      }
      if (casa(t, cat)) {
        pontos += 10;
        continue;
      }
      const ad = adds.find((a) => casa(t, a.palavras));
      if (ad) {
        adicionais.push({ termo: t.texto, adicional: ad });
        leva = false;
        continue;
      }
      leva = false;
    }
    if (casaInteiro) {
      leva = true;
      porque = 'nome';
    }
    return { p, leva, porque: leva ? porque ?? 'nome' : null, adicionais, pontos };
  };

  const combosQueLevam = (id: string) =>
    [...dados.componentes]
      .filter(([, comps]) => comps.includes(id))
      .map(([comboId]) => porId.get(comboId))
      .filter(Boolean)
      .map((c: any) => ({ nome: c.nome, preco: reais(c.precoVenda), esgotado: !!c.esgotado }));

  const item = (p: any, porque: Analise['porque']) => ({
    id: p.id,
    nome: p.nome,
    preco: reais(p.precoVenda),
    precoAntes: p.precoDe != null ? reais(p.precoDe) : null,
    categoria: cats.get(p.categoriaId) ?? null,
    esgotado: !!p.esgotado,
    porque,
    descricao: p.descricao ? String(p.descricao).replace(/\s+/g, ' ').trim().slice(0, 160) : null,
    variacoes: (Array.isArray(p?.variacoes) ? p.variacoes : []).slice(0, 8).map((v: any) => ({ nome: v.nome, preco: reais(v.precoVenda) })),
    combos: combosQueLevam(p.id).slice(0, 4),
    itensDoCombo: (dados.componentes.get(p.id) ?? []).map((id) => porId.get(id)?.nome).filter(Boolean),
    link: dados.linkDoProduto ? dados.linkDoProduto(p.id) : null,
  });

  if (!termos.length && !qCompacta) return { busca, levam: [], podeAdicionar: [], parecidos: [] };

  const analises = produtos.map(analisar);
  const levam = analises
    .filter((a) => a.leva)
    .sort((a, b) => b.pontos - a.pontos || Number(!!a.p.esgotado) - Number(!!b.p.esgotado) || String(a.p.nome).localeCompare(String(b.p.nome)));

  // Onde o termo entra como ADICIONAL: o resto da pergunta casou (o "hambúrguer"), só o "bacon" é adicional.
  const porAdicional = new Map<string, { adicional: string; precos: number[]; em: string[] }>();
  for (const a of analises) {
    if (a.leva || !a.adicionais.length) continue;
    const resto = termos.filter((t) => !a.adicionais.some((x) => x.termo === t.texto));
    const restoCasa = resto.every((t) => {
      if (t.grupo) return grupoCasa(t, a.p);
      return casa(t, nomeW.get(a.p.id)!) || casa(t, ingW.get(a.p.id)!.palavras) || casa(t, catW.get(a.p.id)!);
    });
    if (!restoCasa || a.p.esgotado) continue;
    for (const x of a.adicionais) {
      const chave = normalizar(x.adicional.nome);
      const g = porAdicional.get(chave) ?? { adicional: x.adicional.nome, precos: [], em: [] };
      g.precos.push(x.adicional.preco);
      if (!g.em.includes(a.p.nome)) g.em.push(a.p.nome);
      porAdicional.set(chave, g);
    }
  }
  const podeAdicionar = [...porAdicional.values()].map((g) => {
    const min = Math.min(...g.precos);
    const max = Math.max(...g.precos);
    const preco = min === max ? (min > 0 ? `+${reais(min)}` : 'sem custo') : `de +${reais(min)} a +${reais(max)}`;
    return { adicional: g.adicional, preco, em: g.em.slice(0, 12), total: g.em.length };
  });

  // Nada casou: a busca por pontos de antes (nome > categoria > descrição), para o robô ter o que oferecer.
  let parecidos: any[] = [];
  if (!levam.length && !podeAdicionar.length) {
    const ws = termos.filter((t) => !t.grupo);
    parecidos = produtos
      .map((p) => {
        let s = 0;
        for (const t of ws) {
          if (casa(t, nomeW.get(p.id)!)) s += 10;
          else if (casa(t, catW.get(p.id)!)) s += 5;
          else if (casa(t, ingW.get(p.id)!.palavras)) s += 3;
        }
        return { p, s };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || String(a.p.nome).localeCompare(String(b.p.nome)))
      .slice(0, 8)
      .map((x) => item(x.p, null));
  }

  return {
    busca,
    levam: levam.slice(0, limite).map((a) => item(a.p, a.porque)),
    totalLevam: levam.length,
    podeAdicionar,
    parecidos,
    paraOCliente: listaParaOCliente(termos, levam, produtos, qCompacta),
  };
}

/** O "núcleo" do nome para juntar o lanche com o trio dele: "TRIO 07" = "Numero 07" = "7"; "TRIO X-BACON" = "X bacon". */
export function nucleoDoNome(nome: unknown): string {
  return normalizar(nome)
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(trio|combo)\s+/, '')
    .replace(/^(numero|num|no|n)\s*(?=\d)/, '')
    .replace(/\b0+(\d)/g, '$1')
    .replace(/ /g, '');
}

const MAX_NA_LISTA = 12;

/**
 * A LISTA PRONTA para o cliente quando a pergunta é de INGREDIENTE (F5 — teste do dono, 31/10/2026: "tem opção com
 * bacon?" e o robô citou só o X-Bacon e o trio, deixando de fora o Número 08 e o 15, que levam bacon pela ficha, e não
 * disse que dava para adicionar bacon). TODOS os que levam, um por linha, com o preço; o trio vai junto do lanche
 * ("no trio, R$ 29,00"); e no fim onde dá para pôr o ingrediente a mais, com o preço do adicional. Pergunta só pelo nome
 * de um produto ("quanto custa o x-bacon?") não tem lista: o robô responde com o produto e o link.
 */
function listaParaOCliente(termos: Termo[], levam: Analise[], produtos: any[], qCompacta: string): string | null {
  const ingrediente = termos.filter((t) => !t.grupo);
  if (!ingrediente.length) return null;
  // O cliente disse o NOME de um produto ("x-bacon"): é pergunta do produto, não do ingrediente.
  if (levam.some((a) => compacto(a.p.nome) === qCompacta)) return null;
  const porIngrediente = levam.some((a) => a.porque === 'ficha' || a.porque === 'descricao');
  // Onde o ingrediente entra como adicional (em qualquer lanche à venda — também "bacon a mais" no que já leva).
  const precos: number[] = [];
  for (const p of produtos) {
    if (p?.esgotado) continue;
    for (const a of adicionaisDo(p)) if (ingrediente.some((t) => casa(t, a.palavras))) precos.push(a.preco);
  }
  if (!porIngrediente && !precos.length) return null;

  const ehTrioP = (p: any) => /^(trio|combo)\b/.test(normalizar(p?.nome));
  const trios = new Map<string, any>(); // núcleo → o trio/combo que leva
  for (const a of levam) if (ehTrioP(a.p) && !trios.has(nucleoDoNome(a.p.nome))) trios.set(nucleoDoNome(a.p.nome), a.p);
  const usados = new Set<string>();
  const vistos = new Set<string>();
  const linhas: string[] = [];
  let resto = 0;
  // Os lanches primeiro (cada um puxa o seu trio); depois os trios que sobraram.
  for (const a of [...levam.filter((x) => !ehTrioP(x.p)), ...levam.filter((x) => ehTrioP(x.p))]) {
    const p = a.p;
    const ehTrio = ehTrioP(p);
    const chave = `${normalizar(p.nome)}|${reais(p.precoVenda)}`;
    if (vistos.has(chave)) continue; // o mesmo produto cadastrado duas vezes
    if (ehTrio && usados.has(nucleoDoNome(p.nome))) continue; // já foi junto do lanche
    vistos.add(chave);
    if (linhas.length >= MAX_NA_LISTA) {
      resto++;
      continue;
    }
    const trio = !ehTrio ? trios.get(nucleoDoNome(p.nome)) : null;
    if (trio && !trio.esgotado) usados.add(nucleoDoNome(p.nome));
    const extra = p.esgotado ? ' (esgotado agora)' : trio && !trio.esgotado ? ` (no trio, ${reais(trio.precoVenda)})` : '';
    linhas.push(`• ${p.nome} — ${reais(p.precoVenda)}${extra}`);
  }
  const oQue = ingrediente.map((t) => t.texto).join(' ');
  const partes: string[] = [];
  if (linhas.length) partes.push(`Com ${oQue} temos:`, ...linhas);
  if (resto) partes.push(`E mais ${resto} no cardápio.`);
  if (precos.length) {
    const min = Math.min(...precos);
    const max = Math.max(...precos);
    const preco = min === max ? (min > 0 ? `+${reais(min)}` : 'sem custo') : `de +${reais(min)} a +${reais(max)}`;
    partes.push(`${linhas.length ? 'E dá' : 'Dá'} para pôr ${oQue} a mais nos lanches: ${preco}.`);
  }
  return partes.join('\n');
}
