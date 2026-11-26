import { LEITURAS_DO_MISTER, funcaoDoMapa, palavrasDoTexto, procurarNoMapa, raizDaPalavra } from './busca-no-mapa';

// A busca no mapa (versão 10, C3): pelo sentido das palavras, só as leituras que o Mister pode fazer.

describe('a busca no mapa do Regem', () => {
  it('a raiz junta plural e singular, sem acento', () => {
    expect(raizDaPalavra('cupons')).toBe(raizDaPalavra('cupons'));
    expect(palavrasDoTexto('Os cupons do cardápio')).toEqual(['cupo', 'cardap']);
    expect(palavrasDoTexto('vendas')).toEqual(palavrasDoTexto('venda'));
  });

  it('acha a tela pelo assunto: cupons do cardápio, taxa por bairro, fechamento do caixa, pendência de fornecedor', () => {
    const primeira = (b: string) => procurarNoMapa(b).achadas.map((a) => a.rota);
    expect(primeira('cupons de desconto do cardápio')[0]).toBe('GET /api/v1/cardapio/cupons');
    expect(primeira('taxa de entrega por bairro').slice(0, 3)).toContain('GET /api/v1/cardapio/bairros');
    expect(primeira('fechamentos de caixa').slice(0, 3)).toContain('GET /api/v1/financeiro/caixa/fechamentos');
    expect(primeira('pendências com fornecedores')[0]).toBe('GET /api/v1/fornecedores/pendencias');
  });

  it('cada achada traz os parâmetros do caminho e a consulta que a tela aceita', () => {
    const r = procurarNoMapa('ficha técnica de um produto');
    const ficha = r.achadas.find((a) => a.rota === 'GET /api/v1/fichas/{id}');
    expect(ficha?.parametros).toEqual(['id']);
    const comConsulta = procurarNoMapa('desperdícios do período').achadas.find((a) => a.rota === 'GET /api/v1/desperdicios');
    expect(comConsulta?.consulta).toEqual(expect.arrayContaining(['inicio', 'fim']));
  });

  it('nunca oferece tela com dado de pessoa: avisa que existe', () => {
    const r = procurarNoMapa('conversas do whatsapp com clientes');
    for (const a of r.achadas) expect(LEITURAS_DO_MISTER.map((f) => f.rota)).toContain(a.rota);
    expect(r.comDadoDePessoa).toBeGreaterThan(0);
  });

  it('busca vazia ou sem assunto não acha nada', () => {
    expect(procurarNoMapa('').achadas).toEqual([]);
    expect(procurarNoMapa('qual é o que da').achadas).toEqual([]);
  });

  it('as leituras do Mister são `le`, sem dado de pessoa', () => {
    expect(LEITURAS_DO_MISTER.length).toBeGreaterThan(100);
    for (const f of LEITURAS_DO_MISTER) expect([f.rota, f.marca, !!f.pessoal]).toEqual([f.rota, 'le', false]);
    expect(funcaoDoMapa('GET /api/v1/delivery/pedidos')?.pessoal).toBe(true);
    expect(funcaoDoMapa(' GET /api/v1/cardapio/cupons ')?.marca).toBe('le');
    expect(funcaoDoMapa('GET /api/v1/nao-existe')).toBeUndefined();
  });
});
