import { lerGraficoLivre, planoLivre, valoresSemOrigem } from './plano-livre';
import { valeOPlano } from './plano-do-grafico';

// Versão 10, C10b: o gráfico de qualquer consulta, desenhado pelo Regem (puro). O caminho do laço (a origem passada pelo agente)
// é o mesmo da imagem da C10a; a avaliação traz o c125.

const ESTOQUE = { abaixoDoMinimo: { itens: [{ item: 'Bacon fatiado', saldo: 0.8, minimo: 2 }, { item: 'Coca-Cola lata', saldo: 18, minimo: 48 }, { item: 'Pão de hambúrguer', saldo: 12, minimo: 40 }] } };
const pedido = (o: Record<string, unknown> = {}) => ({
  forma: 'horizontais',
  titulo: 'O que falta para o mínimo',
  medida: 'quantidade',
  itens: [
    { rotulo: 'Coca-Cola lata', valor: 30 },
    { rotulo: 'Pão de hambúrguer', valor: 28 },
    { rotulo: 'Bacon fatiado', valor: 1.2 },
  ],
  ...o,
});

describe('C10b · o gráfico livre', () => {
  it('lê a forma, o título, a unidade e os itens; recusa o que não dá para desenhar', () => {
    expect(lerGraficoLivre(pedido())).toMatchObject({ forma: 'horizontais', unidade: 'quantidade', itens: [{ rotulo: 'Coca-Cola lata', valor: 30 }, expect.anything(), expect.anything()] });
    expect(lerGraficoLivre(pedido({ forma: 'pizza' }))).toHaveProperty('erro');
    expect(lerGraficoLivre(pedido({ titulo: 'x' }))).toHaveProperty('erro');
    expect(lerGraficoLivre(pedido({ medida: 'kg' }))).toHaveProperty('erro');
    expect(lerGraficoLivre(pedido({ itens: [{ rotulo: 'só um', valor: 1 }] }))).toHaveProperty('erro');
    expect(lerGraficoLivre(pedido({ itens: [{ rotulo: 'a', valor: '30' }, { rotulo: 'b', valor: 2 }] }))).toEqual({ erro: '"a": o valor é um número (zero ou mais), sem texto.' });
    expect(lerGraficoLivre(pedido({ forma: 'participacao', medida: 'porcentagem' }))).toHaveProperty('erro');
    expect(lerGraficoLivre(pedido({ destaque: 9 }))).toEqual({ erro: 'O destaque é a posição de 1 a 3.' });
  });
  it('a origem: o número que veio, a diferença de dois ("quanto falta") e a porcentagem da conta; o inventado não passa', () => {
    const o = { resultados: [ESTOQUE], falas: [] };
    expect(valoresSemOrigem(lerGraficoLivre(pedido()) as any, o)).toEqual([]);
    expect(valoresSemOrigem(lerGraficoLivre(pedido({ itens: [{ rotulo: 'Coca', valor: 18 }, { rotulo: 'Pão', valor: 12 }] })) as any, o)).toEqual([]);
    expect(valoresSemOrigem(lerGraficoLivre(pedido({ itens: [{ rotulo: 'Coca', valor: 31 }, { rotulo: 'Pão', valor: 999 }] })) as any, o)).toEqual(['Coca (31)', 'Pão (999)']);
    // 18 de 48 = 37,5%
    expect(valoresSemOrigem(lerGraficoLivre(pedido({ medida: 'porcentagem', itens: [{ rotulo: 'Coca', valor: 37.5 }, { rotulo: 'Pão', valor: 30 }] })) as any, o)).toEqual([]);
    // Sem a origem do laço, nenhum número passa.
    expect(valoresSemOrigem(lerGraficoLivre(pedido()) as any, { resultados: [], falas: [] })).toHaveLength(3);
  });
  it('o plano: deitadas e tabela em partes, colunas e linha em barras, o total só na participação; vale para desenhar', () => {
    const deitadas = planoLivre(lerGraficoLivre(pedido()) as any, { loja: 'Loja Centro', lidoEm: '26/11 09:10' });
    expect(deitadas).toMatchObject({ forma: 'horizontais', titulo: 'O que falta para o mínimo', sub: 'Loja Centro', kpi: null, partes: [{ nome: 'Coca-Cola lata', valor: 30, texto: '30' }, expect.anything(), { nome: 'Bacon fatiado', texto: '1,2' }] });
    expect(deitadas.rodape).toContain('desenhado pelo Regem');
    expect(valeOPlano(deitadas)).toBe(true);
    const colunas = planoLivre(lerGraficoLivre(pedido({ forma: 'colunas', medida: 'reais', itens: [{ rotulo: 'Fornecedores e insumos', valor: 18420 }, { rotulo: 'Folha', valor: 14900 }] })) as any, { loja: 'L', lidoEm: 'x' });
    expect(colunas.barras).toEqual([{ rotulo: 'Fornecedore…', valor: 18420, texto: 'R$ 18.420' }, { rotulo: 'Folha', valor: 14900, texto: 'R$ 14.900' }]);
    expect(valeOPlano(colunas)).toBe(true);
    const pizza = planoLivre(lerGraficoLivre(pedido({ forma: 'participacao', medida: 'reais', itens: [{ rotulo: 'iFood', valor: 6000 }, { rotulo: 'Balcão', valor: 4000 }] })) as any, { loja: 'L', lidoEm: 'x' });
    expect(pizza.kpi).toBe('R$ 10.000');
  });
});
