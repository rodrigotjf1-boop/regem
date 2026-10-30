import { buscarNoCardapio, normalizar, reais, resumoDaLoja, taxaDoBairro } from './robo-consultas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS CONSULTAS DO ROBÔ (Fase 2): o resumo do cardápio público que o modelo de linguagem lê. A fonte é a mesma do
// cardápio online — o teste prova o recorte: preço já escrito como o cliente vê, busca sem acento, esgotado, taxa.
const MENU: any = {
  loja: {
    nome: 'Mister Burguer',
    aberto: true,
    tempoEntregaMin: 40,
    tempoRetiradaMin: 15,
    pedidoMinimo: 20,
    freteGratisAcima: null,
    pagamentos: ['Pix', 'Dinheiro'],
    endereco: { texto: 'Rua A, 10, Centro, Rio de Janeiro - RJ', referencia: 'ao lado da praça' },
    instagram: '@mister',
    areaModo: 'bairro',
  },
  abertaAgora: true,
  abertoPorTipo: { entrega: true, retirada: true, local: false },
  horarioLabel: 'Aberta até 23:00',
  proximaAbertura: { entrega: null, retirada: null },
  tipos: { delivery: true, retirada: true, local: false },
  bairros: [
    { nome: 'Centro', taxa: 5 },
    { nome: 'Copacabana', taxa: 8.5 },
    { nome: 'Barra da Tijuca', taxa: 12 },
  ],
  categorias: [
    { id: 'c1', nome: 'Hambúrgueres' },
    { id: 'c2', nome: 'Bebidas' },
  ],
  robo: { saudacao: 'Olá!', ausencia: 'Fechados', prompt: 'Troca em 30 min', mensagens: [{ gatilho: 'pix', resposta: 'Aceitamos' }] },
  produtos: [
    {
      nome: 'X-Bacon',
      descricao: 'Pão, carne 180g, bacon crocante e queijo',
      precoVenda: 32.9,
      precoDe: null,
      categoriaId: 'c1',
      esgotado: false,
      variacoes: [],
      grupos: [{ opcoes: [{ nome: 'Bacon extra', precoDelta: 4 }, { nome: 'Sem cebola', precoDelta: 0 }] }],
    },
    { nome: 'Hambúrguer da Casa', descricao: 'O clássico', precoVenda: 28, precoDe: 30, categoriaId: 'c1', esgotado: true, variacoes: [], grupos: [] },
    { nome: 'Coca-Cola', descricao: 'Lata 350ml', precoVenda: 6, categoriaId: 'c2', esgotado: false, variacoes: [{ nome: '2L', precoVenda: 14 }], grupos: [] },
  ],
};

describe('consultas do robô — cardápio', () => {
  it('preço escrito como o cliente vê (sem "R$ 12,9")', () => {
    expect(reais(32.9)).toBe('R$ 32,90');
    expect(reais(8.5)).toBe('R$ 8,50');
    expect(reais('x')).toBeNull();
    expect(normalizar('  Hambúrguer  da   Casa ')).toBe('hamburguer da casa');
  });

  it('resumo da loja: aberta agora, como atende, pagamento, taxas, link e o que a loja escreveu para o robô', () => {
    const r = resumoDaLoja(MENU, 'https://app.dmsregem.com/c/abc');
    expect(r).toMatchObject({
      nome: 'Mister Burguer',
      abertaAgora: true,
      horario: 'Aberta até 23:00',
      atende: { entrega: { abertaAgora: true, tempoMin: 40 }, retirada: { abertaAgora: true, tempoMin: 15 }, noLocal: null },
      pedidoMinimo: 'R$ 20,00',
      pagamentos: ['Pix', 'Dinheiro'],
      linkCardapio: 'https://app.dmsregem.com/c/abc',
      taxaPor: 'bairro',
    });
    expect(r.bairros).toContainEqual({ nome: 'Copacabana', taxa: 'R$ 8,50' });
    expect(r.robo.baseDeConhecimento).toBe('Troca em 30 min');
    expect(r.robo.respostasProntas).toHaveLength(1);
  });

  it('busca sem acento, o nome casando primeiro; esgotado e adicionais com preço', () => {
    const r: any = buscarNoCardapio(MENU, 'hamburguer');
    expect(r.itens[0].nome).toBe('Hambúrguer da Casa');
    expect(r.itens[0]).toMatchObject({ preco: 'R$ 28,00', precoAntes: 'R$ 30,00', esgotado: true, categoria: 'Hambúrgueres' });
    const bacon: any = (buscarNoCardapio(MENU, 'bacon') as any).itens[0];
    expect(bacon.nome).toBe('X-Bacon');
    expect(bacon.opcoes).toEqual(['Bacon extra (+R$ 4,00)', 'Sem cebola']);
    const coca: any = (buscarNoCardapio(MENU, 'coca') as any).itens[0];
    expect(coca.variacoes).toEqual([{ nome: '2L', preco: 'R$ 14,00' }]);
    expect(buscarNoCardapio(MENU, 'pizza')).toMatchObject({ total: 0, itens: [] });
  });

  it('sem texto: as categorias com os itens (o "o que tem aí?")', () => {
    const r: any = buscarNoCardapio(MENU, '');
    expect(r.total).toBe(3);
    expect(r.categorias.map((c: any) => c.nome)).toEqual(['Hambúrgueres', 'Bebidas']);
    expect(r.categorias[0].itens[1]).toEqual({ nome: 'Hambúrguer da Casa', preco: 'R$ 28,00', esgotado: true });
  });

  it('taxa: o bairro exato (sem acento/maiúscula), os parecidos ou a lista', () => {
    expect(taxaDoBairro(MENU, 'copacabana')).toEqual({ modo: 'bairro', encontrado: true, bairro: 'Copacabana', taxa: 'R$ 8,50' });
    expect(taxaDoBairro(MENU, 'Barra')).toEqual({
      modo: 'bairro',
      encontrado: false,
      parecidos: [{ nome: 'Barra da Tijuca', taxa: 'R$ 12,00' }],
    });
    expect((taxaDoBairro(MENU, '') as any).bairros).toHaveLength(3);
    expect(taxaDoBairro({ ...MENU, loja: { ...MENU.loja, areaModo: 'raio' } }, 'centro').modo).toBe('distancia');
  });
});

// Teste do robô com a loja piloto (29/10/2026): o Gemini errou o que o Regem não entregava — o X bacon (o cliente
// escreve "x-bacon"), os horários da semana ("abrem amanhã?") e a entrega por distância ("não entregamos em Copacabana").
describe('consultas do robô — o que faltava no teste de 29/10', () => {
  const COM_DADOS: any = {
    ...MENU,
    loja: { ...MENU.loja, areaModo: 'raio', raios: [{ taxa: 6, ateKm: 1.5 }, { taxa: 5, ateKm: 0.5 }, { taxa: 0, ateKm: 1.9 }] },
    horarios: [
      { dia: 5, abre: '19:00', fecha: '05:45', ativo: true },
      { dia: 0, abre: '19:00', fecha: '03:00', ativo: true },
      { dia: 1, abre: '11:00', fecha: '15:00', ativo: false },
    ],
    produtos: [
      ...MENU.produtos,
      { nome: 'TRIO X-BACON', descricao: 'X-bacon, batata e refri', precoVenda: 36, categoriaId: 'c1', esgotado: false, variacoes: [], grupos: [] },
      { nome: 'X bacon', descricao: 'Pão, carne e bacon', precoVenda: 26, categoriaId: 'c1', esgotado: false, variacoes: [], grupos: [] },
    ],
  };

  it('"x-bacon" acha o "X bacon" primeiro (hífen e pontuação viram espaço)', () => {
    expect(normalizar('X-Bacon')).toBe('x bacon');
    expect(normalizar('Cheddar !!!')).toBe('cheddar');
    const r: any = buscarNoCardapio(COM_DADOS, 'x-bacon');
    expect(r.itens.map((i: any) => i.nome).slice(0, 2)).toEqual(['X bacon', 'X-Bacon']);
    expect(r.itens[0].preco).toBe('R$ 26,00');
    expect(r.itens.map((i: any) => i.nome)).toContain('TRIO X-BACON');
  });

  it('o resumo traz o dia de hoje em São Paulo e os horários da semana (madrugada marcada)', () => {
    // 30/10/2026 03:15 UTC = sexta-feira 30/10, 00:15 em São Paulo (o dia vira pelo fuso da loja, não pelo UTC)
    const r: any = resumoDaLoja(COM_DADOS, 'https://app.dmsregem.com/c/abc', new Date('2026-10-30T03:15:00Z'));
    expect(r.agora).toEqual({ diaDaSemana: 'sexta', hora: '00:15' });
    expect((resumoDaLoja(COM_DADOS, 'x', new Date('2026-10-30T02:59:00Z')) as any).agora).toEqual({ diaDaSemana: 'quinta', hora: '23:59' });
    expect(r.horariosDaSemana).toEqual([
      { dia: 'domingo', abre: '19:00', fecha: '03:00', fechaNoDiaSeguinte: true },
      { dia: 'sexta', abre: '19:00', fecha: '05:45', fechaNoDiaSeguinte: true },
    ]);
  });

  it('entrega por distância: as faixas em ordem e como funciona, no resumo e na taxa', () => {
    const faixas = [
      { ateKm: 0.5, taxa: 'R$ 5,00' },
      { ateKm: 1.5, taxa: 'R$ 6,00' },
      { ateKm: 1.9, taxa: 'grátis' },
    ];
    const r: any = resumoDaLoja(COM_DADOS, 'x');
    expect(r.taxaPor).toBe('distancia');
    expect(r.entregaPorDistancia.faixas).toEqual(faixas);
    expect(r.entregaPorDistancia.comoFunciona).toMatch(/cardápio online calcula/);
    expect(taxaDoBairro(COM_DADOS, 'copacabana')).toMatchObject({ modo: 'distancia', encontrado: false, faixas });
    // Por bairro, nada muda.
    expect(resumoDaLoja(MENU, 'x').entregaPorDistancia).toBeNull();
  });
});
