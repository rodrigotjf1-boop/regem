// O CARDÁPIO PELA CONVERSA (versão 9, etapa 7 do pedido do dono de 24/11: "cardápio: produto novo, categoria nova, promoção").
// Pelo MESMO serviço de Cadastros › Cardápio (`ProdutoService.criarCategoria`, `criar` e `atualizar`):
//  • a categoria nova entra no fim da lista;
//  • o produto novo entra com o nome, o preço, a categoria e a descrição — sem foto, sem ficha técnica, sem código PDV e sem baixa
//    no estoque (o resto do cadastro fica na tela);
//  • a promoção é o preço "por" do cardápio digital (o "de" é o preço normal), ligada ou tirada com o PIN (é preço).
// O Regem não tem promoção com data de fim: ela fica ligada até alguém tirar (a conversa diz isso). Aqui só a conferência; sem banco.

export type ParametrosDoCardapio =
  | { acao: 'criar_categoria'; nome: string }
  | { acao: 'criar_produto'; nome: string; preco: number; categoria: string | null; descricao: string | null }
  | { acao: 'promocao_do_produto'; produto: string; precoPromocional: number | null };

const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
export const reaisCardapio = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MAX_PRECO = 100_000;

function lerPreco(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_PRECO) return null;
  return Math.round(v * 100) / 100;
}

export function conferirCardapio(acao: ParametrosDoCardapio['acao'], en: Record<string, unknown>): { parametros: ParametrosDoCardapio; resumo: string } | { erro: string } {
  if (acao === 'criar_categoria') {
    const nome = texto(en.nomeDaCategoria).slice(0, 60);
    if (nome.length < 2) return { erro: 'Diga o nome da categoria nova.' };
    return { parametros: { acao, nome }, resumo: `Criar a categoria "${nome}" em Cadastros › Cardápio.` };
  }
  if (acao === 'criar_produto') {
    const nome = texto(en.nomeDoProduto).slice(0, 100);
    if (nome.length < 2) return { erro: 'Diga o nome do produto novo.' };
    const preco = lerPreco(en.precoDoProduto);
    if (preco === null) return { erro: 'Diga o preço de venda do produto novo, em reais.' };
    const categoria = texto(en.categoriaDoProduto).slice(0, 60) || null;
    const descricao = texto(en.descricaoDoProduto).slice(0, 300) || null;
    return { parametros: { acao, nome, preco, categoria, descricao }, resumo: `Criar o produto "${nome}" por ${reaisCardapio(preco)}${categoria ? ` na categoria "${categoria}"` : ''}.` };
  }
  const produto = texto(en.produto).slice(0, 100);
  if (produto.length < 2) return { erro: 'Diga qual produto do cardápio.' };
  if (en.tirarPromocao === true) return { parametros: { acao, produto, precoPromocional: null }, resumo: `Tirar a promoção de "${produto}".` };
  const promo = lerPreco(en.precoPromocional);
  if (promo === null) return { erro: 'Diga o preço da promoção (o "por"), em reais — ou que é para tirar a promoção.' };
  return { parametros: { acao, produto, precoPromocional: promo }, resumo: `Pôr "${produto}" em promoção por ${reaisCardapio(promo)}.` };
}

export function resumoDoProdutoNovo(p: { nome: string; preco: number; descricao: string | null }, categoria: string | null): string {
  return (
    `Criar o produto "${p.nome}" por ${reaisCardapio(p.preco)}${categoria ? ` na categoria "${categoria}"` : ' sem categoria'}${p.descricao ? `, com a descrição "${p.descricao}"` : ''}. ` +
    'Ele entra no cardápio sem foto, sem ficha técnica, sem código PDV e sem baixa no estoque: o resto do cadastro fica em Cadastros › Cardápio.'
  );
}

/** A promoção: o preço "por" menor que o normal; tirar só o que está em promoção. */
export function conferirPromocao(p: { nome: string; precoVenda: number; precoPromocional: number | null }, novo: number | null): string | null {
  if (novo === null) return p.precoPromocional === null ? `"${p.nome}" não está em promoção.` : null;
  if (novo >= p.precoVenda) return `A promoção tem de ser menor que o preço normal de "${p.nome}" (${reaisCardapio(p.precoVenda)}).`;
  if (p.precoPromocional !== null && Math.abs(p.precoPromocional - novo) < 0.005) return `"${p.nome}" já está em promoção por ${reaisCardapio(novo)}.`;
  return null;
}

export function resumoDaPromocao(p: { nome: string; precoVenda: number; precoPromocional: number | null }, novo: number | null): string {
  if (novo === null) return `Tirar a promoção de "${p.nome}": o preço volta a ${reaisCardapio(p.precoVenda)} no cardápio digital (estava por ${reaisCardapio(p.precoPromocional as number)}).`;
  return (
    `Pôr "${p.nome}" em promoção no cardápio digital: de ${reaisCardapio(p.precoVenda)} por ${reaisCardapio(novo)}` +
    `${p.precoPromocional !== null ? ` (hoje está por ${reaisCardapio(p.precoPromocional)})` : ''}. ` +
    'Fica ligada até alguém tirar (o Regem não tem promoção com data de fim). O preço do iFood e da 99 não muda.'
  );
}

/** A página do PIN da promoção. */
export function apresentacaoDaPromocao(p: Record<string, any>): { titulo: string; itens: string[]; detalhe: string | null; valor: number | null; botao: string } {
  const tirar = p.precoPromocional === null;
  return {
    titulo: tirar ? 'Tirar a promoção' : 'Pôr em promoção',
    itens: [`Produto: ${p.nomeDoProduto}`, `Preço normal: ${reaisCardapio(Number(p.precoVenda))}`, ...(tirar ? ['Sem promoção (volta ao preço normal)'] : [])],
    detalhe: tirar ? 'Vale no cardápio digital.' : 'Vale no cardápio digital e fica ligada até alguém tirar. O preço do iFood e da 99 não muda.',
    valor: tirar ? null : Number(p.precoPromocional),
    botao: tirar ? 'Tirar a promoção' : 'Pôr em promoção',
  };
}
