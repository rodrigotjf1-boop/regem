// AS AÇÕES DA LOJA PELA CONVERSA (versão 9, fase O5; `docs/plano-mister.md` § "Versão 9", decisões V9-5, V9-6 e V9-8). O dono: "não é
// sempre que se cria cupom, promoção… porém temos que conseguir fazer tudo via conversa". Cupom e conta a pagar mexem com dinheiro:
// PIN pelo link, como o preço. Tirar um cupom é de botão. Aqui só a conferência e o que a página do PIN mostra; sem banco.

export type ParametrosDaLoja = ParametrosDaLojaBase | ParametrosDaLojaExtra;
export type ParametrosDaLojaBase =
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
  if (acao === 'mudar_produto' || acao === 'mudar_fornecedor' || acao === 'trocar_turno' || acao === 'folga_na_escala') return conferirAcaoExtra(acao, en, hoje);
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

// ───────────────────────────── versão 9, O5 segunda parte: o cardápio, o fornecedor e a escala ─────────────────────────────
// O catálogo do protótipo ("O que ele faz"): mudar a descrição e a categoria do produto, mudar o contato do fornecedor, trocar a
// pessoa de um turno e dar folga (a vaga fica aberta). Tudo com o botão, pelos serviços de Cadastros › Cardápio, Fornecedores e Escala.

export type ParametrosDaLojaExtra =
  | { acao: 'mudar_produto'; produto: string; nomeNovo: string | null; descricao: string | null; categoria: string | null }
  | { acao: 'mudar_fornecedor'; fornecedor: string; nomeNovo: string | null; contato: string | null; telefone: string | null; email: string | null }
  | { acao: 'trocar_turno'; quemSai: string; quemEntra: string; dia: string; turno: string | null }
  | { acao: 'folga_na_escala'; quem: string; dia: string; turno: string | null };

const opcionalTexto = (v: unknown, max: number): string | null => {
  const t = texto(v);
  return t ? t.slice(0, max) : null;
};
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const diaDaSemana = (iso: string) => ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][new Date(`${iso}T12:00:00Z`).getUTCDay()];
export const diaComSemana = (iso: string) => `${diaDaSemana(iso)}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function conferirAcaoExtra(acao: ParametrosDaLojaExtra['acao'], en: Record<string, unknown>, hoje: string): { parametros: ParametrosDaLojaExtra; resumo: string } | { erro: string } {
  if (acao === 'mudar_produto') {
    const produto = texto(en.produto);
    if (produto.length < 2 || produto.length > 80) return { erro: 'Diga o produto como aparece no cardápio.' };
    const nomeNovo = opcionalTexto(en.nomeNovoDoProduto, 80);
    if (nomeNovo !== null && (nomeNovo.length < 2 || !/\p{L}/u.test(nomeNovo))) return { erro: 'O nome novo do produto precisa de letras.' };
    const descricao = opcionalTexto(en.descricaoDoProduto, 500);
    const categoria = opcionalTexto(en.categoriaDoProduto, 60);
    if (!nomeNovo && !descricao && !categoria) return { erro: 'Diga o que mudar no produto: o nome, a descrição ou a categoria.' };
    return { parametros: { acao, produto, nomeNovo, descricao, categoria }, resumo: '' };
  }
  if (acao === 'mudar_fornecedor') {
    const fornecedor = texto(en.fornecedor);
    if (fornecedor.length < 2 || fornecedor.length > 80) return { erro: 'Diga o fornecedor como está cadastrado.' };
    const nomeNovo = opcionalTexto(en.nomeNovoDoFornecedor, 80);
    if (nomeNovo !== null && (nomeNovo.length < 2 || !/\p{L}/u.test(nomeNovo))) return { erro: 'O nome novo do fornecedor precisa de letras.' };
    const contato = opcionalTexto(en.contato, 80);
    const fone = texto(en.foneDoFornecedor).replace(/\D/g, '');
    if (fone && (fone.length < 10 || fone.length > 13)) return { erro: 'O telefone do fornecedor vai com o DDD (10 a 13 números).' };
    const email = opcionalTexto(en.emailDoFornecedor, 254);
    if (email !== null && !EMAIL.test(email)) return { erro: 'Esse e-mail não parece certo.' };
    if (!nomeNovo && !contato && !fone && !email) return { erro: 'Diga o que mudar no fornecedor: o nome, o contato, o telefone ou o e-mail.' };
    return { parametros: { acao, fornecedor, nomeNovo, contato, telefone: fone || null, email }, resumo: '' };
  }
  const dia = texto(en.diaDaEscala);
  if (!dataValida(dia)) return { erro: 'Diga o dia da escala em AAAA-MM-DD.' };
  if (dia < hoje) return { erro: 'Esse dia já passou: a escala de dias passados muda só na tela.' };
  const turno = opcionalTexto(en.turnoDaEscala, 40);
  if (acao === 'trocar_turno') {
    const quemSai = texto(en.quemSai);
    const quemEntra = texto(en.quemEntra);
    if (quemSai.length < 2 || quemEntra.length < 2) return { erro: 'Diga quem sai e quem entra no turno.' };
    return { parametros: { acao, quemSai: quemSai.slice(0, 80), quemEntra: quemEntra.slice(0, 80), dia, turno }, resumo: '' };
  }
  const quem = texto(en.quemSai);
  if (quem.length < 2) return { erro: 'Diga quem fica de folga.' };
  return { parametros: { acao: 'folga_na_escala', quem: quem.slice(0, 80), dia, turno }, resumo: '' };
}

/** O resumo da mudança do produto, com o nome do cadastro (o achado) e a categoria achada. */
export function resumoDoProduto(nome: string, p: { nomeNovo: string | null; descricao: string | null }, categoria: string | null): string {
  const partes = [
    ...(p.nomeNovo ? [`o nome para "${p.nomeNovo}"`] : []),
    ...(p.descricao ? [`a descrição para "${p.descricao.length > 120 ? `${p.descricao.slice(0, 117)}…` : p.descricao}"`] : []),
    ...(categoria ? [`a categoria para ${categoria}`] : []),
  ];
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)}` : partes[0];
  return `Mudar ${lista} do produto "${nome}" em Cadastros › Cardápio. Vale no cardápio digital e no balcão; o iFood e a 99 seguem o que a Gestão do catálogo manda.`;
}

export function resumoDoFornecedor(nome: string, p: { nomeNovo: string | null; contato: string | null; telefone: string | null; email: string | null }): string {
  const partes = [
    ...(p.nomeNovo ? [`o nome para "${p.nomeNovo}"`] : []),
    ...(p.contato ? [`o contato para ${p.contato}`] : []),
    ...(p.telefone ? [`o telefone para o número terminado em ${p.telefone.slice(-4)}`] : []),
    ...(p.email ? [`o e-mail para ${p.email}`] : []),
  ];
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)}` : partes[0];
  return `Mudar ${lista} do fornecedor "${nome}" em Fornecedores.`;
}

export function resumoDaTroca(quemSai: string, quemEntra: string, dia: string, turno: { nome: string; inicio: string; fim: string }): string {
  return `Trocar ${quemSai} por ${quemEntra} na escala de ${diaComSemana(dia)}, turno ${turno.nome} (${turno.inicio}–${turno.fim}). As regras da CLT são conferidas antes de gravar.`;
}

export function resumoDaFolga(quem: string, dia: string, turno: { nome: string; inicio: string; fim: string }): string {
  return `Dar folga a ${quem} em ${diaComSemana(dia)}: sai do turno ${turno.nome} (${turno.inicio}–${turno.fim}) e a vaga fica aberta na escala para outra pessoa.`;
}
