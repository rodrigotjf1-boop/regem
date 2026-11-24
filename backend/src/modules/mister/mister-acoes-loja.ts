// AS AÇÕES DA LOJA PELA CONVERSA (versão 9, fase O5; `docs/plano-mister.md` § "Versão 9", decisões V9-5, V9-6 e V9-8). O dono: "não é
// sempre que se cria cupom, promoção… porém temos que conseguir fazer tudo via conversa". Cupom e conta a pagar mexem com dinheiro:
// PIN pelo link, como o preço. Tirar um cupom é de botão. Aqui só a conferência e o que a página do PIN mostra; sem banco.

export type ParametrosDaLoja =
  | {
      acao: 'criar_cupom';
      codigo: string;
      tipo: 'percentual' | 'valor' | 'fretegratis';
      valor: number;
      minimo: number | null;
      validoAte: string | null;
      usosMaximos: number | null;
      soClientesNovos: boolean;
      nome: string | null;
    }
  | { acao: 'remover_cupom'; codigo: string }
  | { acao: 'lancar_conta'; descricao: string; valor: number; vencimento: string; fornecedor: string | null; categoria: string | null };

const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const numero = (v: unknown): number | null | 'ruim' => (v === undefined || v === null || v === '' ? null : typeof v === 'number' && Number.isFinite(v) ? v : 'ruim');
export const reaisBr = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (iso: string) => DATA.test(iso) && !Number.isNaN(new Date(`${iso}T12:00:00Z`).getTime()) && new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso;
const MAX_CUPOM = 99_999.99;
const MAX_CONTA = 9_999_999.99;

/** O desconto do cupom em palavras ("10% de desconto", "R$ 5,00 de desconto", "frete grátis"). */
export function descontoDoCupom(p: { tipo: string; valor: number }): string {
  if (p.tipo === 'fretegratis') return 'frete grátis';
  return p.tipo === 'valor' ? `${reaisBr(p.valor)} de desconto` : `${p.valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% de desconto`;
}

export function conferirAcaoDaLoja(acao: ParametrosDaLoja['acao'], en: Record<string, unknown>, hoje: string): { parametros: ParametrosDaLoja; resumo: string } | { erro: string } {
  if (acao === 'criar_cupom' || acao === 'remover_cupom') {
    const codigo = texto(en.codigoDoCupom).toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(codigo)) return { erro: 'O código do cupom vai com 3 a 20 letras ou números, sem espaço (ex.: SMASH10).' };
    if (acao === 'remover_cupom') return { parametros: { acao, codigo }, resumo: `Tirar o cupom ${codigo}: ele deixa de valer no cardápio e no balcão.` };
    const tipo = en.tipoDoDesconto === 'valor' || en.tipoDoDesconto === 'fretegratis' ? en.tipoDoDesconto : en.tipoDoDesconto === 'percentual' || en.tipoDoDesconto === undefined ? 'percentual' : null;
    if (!tipo) return { erro: 'O desconto é percentual, valor (em reais) ou fretegratis.' };
    const valor = tipo === 'fretegratis' ? 0 : numero(en.valorDoDesconto);
    if (tipo !== 'fretegratis' && (valor === null || valor === 'ruim' || valor <= 0 || valor > (tipo === 'percentual' ? 100 : MAX_CUPOM)))
      return { erro: tipo === 'percentual' ? 'Diga o desconto em porcentagem (de 1 a 100).' : 'Diga o desconto em reais.' };
    const minimo = numero(en.pedidoMinimo);
    if (minimo === 'ruim' || (minimo !== null && (minimo < 0 || minimo > MAX_CUPOM))) return { erro: 'O pedido mínimo é um valor em reais.' };
    const validoAte = texto(en.validoAte) || null;
    if (validoAte && (!dataValida(validoAte) || validoAte < hoje)) return { erro: 'A validade vai em AAAA-MM-DD, de hoje em diante.' };
    const usos = numero(en.usosMaximos);
    if (usos === 'ruim' || (usos !== null && (!Number.isInteger(usos) || usos < 1 || usos > 1_000_000))) return { erro: 'O limite de usos é um número inteiro.' };
    const nome = texto(en.nomeDoCupom).slice(0, 60) || null;
    const p = { acao, codigo, tipo, valor: valor as number, minimo, validoAte, usosMaximos: usos, soClientesNovos: en.soClientesNovos === true, nome } as const;
    return { parametros: p, resumo: resumoDoCupom(p) };
  }
  const descricao = texto(en.descricaoDaConta).slice(0, 120);
  if (descricao.length < 3) return { erro: 'Diga o que é a conta (ex.: "Conta de luz de novembro").' };
  const valor = numero(en.valorDaConta);
  if (valor === null || valor === 'ruim' || valor <= 0 || valor > MAX_CONTA) return { erro: 'Diga o valor da conta em reais.' };
  const vencimento = texto(en.vencimentoDaConta);
  if (!dataValida(vencimento)) return { erro: 'Diga o vencimento em AAAA-MM-DD.' };
  const fornecedor = texto(en.fornecedor).slice(0, 80) || null;
  const categoria = texto(en.categoriaDaConta).slice(0, 40) || null;
  const p = { acao: 'lancar_conta' as const, descricao, valor: Math.round(valor * 100) / 100, vencimento, fornecedor, categoria };
  return { parametros: p, resumo: resumoDaConta(p, fornecedor) };
}

export function resumoDoCupom(p: Extract<ParametrosDaLoja, { acao: 'criar_cupom' }>): string {
  const partes = [
    descontoDoCupom(p),
    ...(p.minimo ? [`pedido mínimo de ${reaisBr(p.minimo)}`] : []),
    ...(p.validoAte ? [`até ${dataBr(p.validoAte)}`] : ['sem data para acabar']),
    ...(p.usosMaximos ? [`até ${p.usosMaximos} usos`] : []),
    ...(p.soClientesNovos ? ['só para clientes novos'] : []),
  ];
  return `Criar o cupom ${p.codigo}${p.nome ? ` ("${p.nome}")` : ''}: ${partes.join(', ')}. Ele passa a valer no cardápio e no balcão (PDV · Balcão › Cupons).`;
}

export function resumoDaConta(p: Extract<ParametrosDaLoja, { acao: 'lancar_conta' }>, fornecedor: string | null): string {
  return `Lançar a conta a pagar "${p.descricao}" de ${reaisBr(p.valor)}, vencendo em ${dataBr(p.vencimento)}${fornecedor ? `, do fornecedor ${fornecedor}` : ''}${p.categoria ? `, na categoria ${p.categoria}` : ''}. Ela fica em aberto em Financeiro › Contas a pagar.`;
}

/** O que a página do PIN mostra (a mesma forma do preço, do horário e da baixa). */
export function apresentacaoDoCupom(p: Extract<ParametrosDaLoja, { acao: 'criar_cupom' }>): { titulo: string; itens: string[]; detalhe: string | null; valor: number | null; botao: string } {
  return {
    titulo: `Criar o cupom ${p.codigo}`,
    itens: [descontoDoCupom(p), ...(p.minimo ? [`Pedido mínimo: ${reaisBr(p.minimo)}`] : []), p.validoAte ? `Vale até ${dataBr(p.validoAte)}` : 'Sem data para acabar', ...(p.usosMaximos ? [`Até ${p.usosMaximos} usos`] : []), ...(p.soClientesNovos ? ['Só para clientes novos'] : [])],
    detalhe: 'Ele passa a valer no cardápio digital e no balcão.',
    valor: null,
    botao: 'Criar o cupom',
  };
}

export function apresentacaoDaConta(p: Extract<ParametrosDaLoja, { acao: 'lancar_conta' }> & { nomeDoFornecedor?: string | null }): { titulo: string; itens: string[]; detalhe: string | null; valor: number | null; botao: string } {
  return {
    titulo: `Lançar a conta "${p.descricao}"`,
    itens: [`Vence em ${dataBr(p.vencimento)}`, ...(p.nomeDoFornecedor ? [`Fornecedor: ${p.nomeDoFornecedor}`] : []), ...(p.categoria ? [`Categoria: ${p.categoria}`] : [])],
    detalhe: 'Ela fica em aberto em Financeiro › Contas a pagar. Nada é pago.',
    valor: p.valor,
    botao: 'Lançar a conta',
  };
}
