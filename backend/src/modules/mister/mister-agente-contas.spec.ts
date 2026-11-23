import { entradaDoGraficoPorHora, periodoDaFerramenta, valoresSemConta } from './mister-agente.regras';

// A conta que a resposta faz sobre os próprios valores, e o gráfico por hora de um dia (ERR-591).

describe('o valor que não veio da consulta', () => {
  const pix = [{ pedidos: [{ valor: 58.95 }, { valor: 41.85 }] }];

  it('a soma certa dos valores que a resposta mostra não é invenção', () => {
    expect(valoresSemConta('Pix de R$ 58,95 e pedido de R$ 41,85. Somando, *R$ 100,80*.', pix)).toEqual([]);
    const contas = [{ itens: [{ v: 300 }, { v: 120 }, { v: 650.55 }, { v: 300 }, { v: 500 }] }];
    expect(valoresSemConta('R$ 300,00, R$ 120,00, R$ 650,55, R$ 300,00 e R$ 500,00. Total: R$ 1.870,55.', contas)).toEqual([]);
  });

  it('a diferença entre dois valores da resposta também é conta', () => {
    expect(valoresSemConta('De R$ 58,95 para R$ 41,85: R$ 17,10 a menos.', pix)).toEqual([]);
  });

  it('soma errada, valor solto e soma de valor que a resposta não mostrou são invenção', () => {
    expect(valoresSemConta('Pix de R$ 58,95 e pedido de R$ 41,85. Somando, R$ 100,90.', pix)).toEqual([10090]);
    expect(valoresSemConta('Você faturou R$ 9.999,99.', pix)).toEqual([999999]);
    expect(valoresSemConta('Somando tudo, R$ 100,80.', pix)).toEqual([10080]);
  });

  it('valor arredondado não passa como conta', () => {
    expect(valoresSemConta('Saiu R$ 16.500,00, ou seja, mais de R$ 15 mil.', [{ saiu: 16500 }])).toEqual([1500]);
  });

  it('resposta sem valor, ou só com valor da consulta, não tem o que apontar', () => {
    expect(valoresSemConta('Tudo certo por aqui.', pix)).toEqual([]);
    expect(valoresSemConta('O pedido foi de R$ 58,95.', pix)).toEqual([]);
  });

  it('resposta com valores demais não trava: aponta o solto', () => {
    const muitos = Array.from({ length: 30 }, (_, i) => i + 1);
    const texto = `${muitos.map((v) => `R$ ${v},00`).join(' ')} e R$ 999,99`;
    const ini = Date.now();
    expect(valoresSemConta(texto, [muitos])).toEqual([99999]);
    expect(Date.now() - ini).toBeLessThan(500);
  });
});

describe('o gráfico por hora de um dia (ERR-591)', () => {
  const HOJE = '2026-11-13';
  const periodo = (en: Record<string, unknown>) => periodoDaFerramenta(entradaDoGraficoPorHora(en), HOJE, 'hoje');

  it('"ontem" pelo dia é ontem, e não hoje', () => {
    expect(periodo({ tipo: 'vendas_por_hora', dia: 'ontem' })).toMatchObject({ de: '2026-11-12', ate: '2026-11-12' });
    expect(periodo({ tipo: 'vendas_por_hora', dia: 'Ontem ' })).toMatchObject({ de: '2026-11-12', ate: '2026-11-12' });
  });

  it('um dia escrito vale como aquele dia; dia inválido é recusado', () => {
    expect(periodo({ tipo: 'vendas_por_hora', dia: '2026-11-05' })).toMatchObject({ de: '2026-11-05', ate: '2026-11-05' });
    expect(periodo({ tipo: 'vendas_por_hora', dia: 'semana' })).toHaveProperty('erro');
  });

  it('sem dia continua hoje; período e datas vencem o dia', () => {
    expect(periodo({ tipo: 'vendas_por_hora' })).toMatchObject({ de: HOJE, ate: HOJE });
    expect(periodo({ tipo: 'vendas_por_hora', dia: 'ontem', periodo: 'hoje' })).toMatchObject({ de: HOJE, ate: HOJE });
    expect(periodo({ tipo: 'vendas_por_hora', dia: 'ontem', de: '2026-11-03', ate: '2026-11-03' })).toMatchObject({ de: '2026-11-03' });
  });
});
