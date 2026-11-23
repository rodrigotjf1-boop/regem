import { somarDias } from '../perfil-cliente/calendario-regra';
import { type LinhaOficial } from './mister-analises';
import { compararDias, diasDeChuva, diasDoTipo } from './mister-comparacao-dias';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Versão 8, E2: a venda em dias de jogo, feriado e chuva contra os mesmos dias da semana sem evento.
const linha = (dia: string, pedidos: number, reais = pedidos * 50, hora = 20): LinhaOficial => ({ dia, hora, pedidos, centavos: reais * 100 });
const RIO = 3304557;
const cidade = { situacao: 'ok' as const, municipio: RIO, uf: 'RJ' };

/** N sextas seguidas de evento, cada uma com as 8 sextas anteriores comuns. */
function semanas(diasDoEvento: number, pedidosNoEvento: number, pedidosComuns: number) {
  const dias: string[] = [];
  const linhas: LinhaOficial[] = [];
  for (let i = 0; i < diasDoEvento; i++) {
    const d = somarDias('2026-11-20', -7 * i * 9);
    dias.push(d);
    linhas.push(linha(d, pedidosNoEvento));
    for (let k = 1; k <= 8; k++) linhas.push(linha(somarDias(d, -7 * k), pedidosComuns));
  }
  return { dias, linhas };
}

describe('a venda em dias assim', () => {
  it('compara com o mesmo dia da semana e dá a variação em pedidos e em reais', () => {
    const { dias, linhas } = semanas(4, 120, 100);
    const r: any = compararDias({ dias, linhas, comEvento: new Set(dias), verValores: true });
    expect(r.diasComparados).toBe(4);
    expect(r.pedidosPorDia).toEqual({ emDiasAssim: 120, diasComuns: 100, variacaoPct: 20 });
    expect(r.vendaPorDia).toEqual({ emDiasAssim: 6000, diasComuns: 5000, variacaoPct: 20 });
    expect(r).not.toHaveProperty('poucoDado');
  });

  it('com menos de 4 dias não sai número (V8-10)', () => {
    const { dias, linhas } = semanas(3, 120, 100);
    const r: any = compararDias({ dias, linhas, comEvento: new Set(dias), verValores: true });
    expect(r).toMatchObject({ diasComparados: 3, poucoDado: true });
    expect(r.oQueFalta).toContain('Só 3 dias');
    expect(r).not.toHaveProperty('pedidosPorDia');
    expect(r).not.toHaveProperty('vendaPorDia');
  });

  it('quem não vê valores recebe só os pedidos', () => {
    const { dias, linhas } = semanas(4, 120, 100);
    const r: any = compararDias({ dias, linhas, comEvento: new Set(dias), verValores: false });
    expect(r.pedidosPorDia).toBeDefined();
    expect(r).not.toHaveProperty('vendaPorDia');
  });

  it('a venda da madrugada é da noite anterior', () => {
    const { dias, linhas } = semanas(4, 100, 100);
    const madrugada = dias.map((d) => linha(somarDias(d, 1), 20, 1000, 1));
    const r: any = compararDias({ dias, linhas: [...linhas, ...madrugada], comEvento: new Set(dias), verValores: false });
    expect(r.pedidosPorDia.emDiasAssim).toBe(120);
  });

  it('dia com outro evento fica fora da referência, e a loja fechada não conta', () => {
    const d = '2026-11-20';
    const linhas = [linha(d, 100), linha(somarDias(d, -7), 1000), linha(somarDias(d, -14), 50), linha(somarDias(d, -21), 50), linha(somarDias(d, -28), 50)];
    const dias = [d, somarDias(d, -63), somarDias(d, -126), somarDias(d, -189)];
    for (const x of dias.slice(1)) {
      linhas.push(linha(x, 100));
      for (let k = 1; k <= 4; k++) linhas.push(linha(somarDias(x, -7 * k), 50));
    }
    const r: any = compararDias({ dias, linhas, comEvento: new Set([...dias, somarDias(d, -7)]), verValores: false });
    expect(r.pedidosPorDia).toEqual({ emDiasAssim: 100, diasComuns: 50, variacaoPct: 100 });
    const fechado: any = compararDias({ dias: ['2026-11-21'], linhas, comEvento: new Set(), verValores: false });
    expect(fechado.diasComparados).toBe(0);
    expect(fechado.oQueFalta).toContain('Ainda não há dia assim');
  });
});

describe('os dias de cada tipo', () => {
  const ev = (o: any) => ({ tipo: 'jogo', nome: 'Botafogo x São Paulo', dia_inteiro: false, inicio: '2026-11-23T23:00:00.000Z', fuso: 'America/Sao_Paulo', abrangencia: [{ nivel: 'municipio', valor: String(RIO) }], situacao: 'confirmado', ...o });
  const janela = { daLoja: [], cidade, de: '2026-07-01', ate: '2026-11-30' };

  it('jogo da cidade conta; o de outra cidade não, a não ser pedido pelo nome', () => {
    const fora = ev({ nome: 'Santos x Grêmio', inicio: '2026-11-25T00:00:00.000Z', abrangencia: [{ nivel: 'nacional', valor: 'BR' }] });
    const r = diasDoTipo({ ...janela, tipo: 'jogo', daBase: [ev({}), fora] });
    expect([...r.dias]).toEqual(['2026-11-23']);
    expect([...r.comEvento]).toEqual(['2026-11-23']);
    expect([...diasDoTipo({ ...janela, tipo: 'jogo', nome: 'gremio', daBase: [ev({}), fora] }).dias]).toEqual(['2026-11-24']);
  });

  it('o calendário entra, e o feriado cadastrado pela loja conta como feriado', () => {
    const r = diasDoTipo({
      ...janela,
      tipo: 'feriado',
      daBase: [],
      daLoja: [
        { dia: '2026-09-07', grupo: 'feriado', tipo: 'feriado', nome: 'Independência', origem: 'regra' },
        { dia: '2026-10-20', grupo: 'feriado', tipo: 'feriado_municipal', nome: 'Da cidade', origem: 'loja' },
        { dia: '2026-10-21', grupo: 'loja', tipo: 'show', nome: 'Show', origem: 'loja' },
      ],
    });
    expect([...r.dias].sort()).toEqual(['2026-09-07', '2026-10-20']);
    expect(r.comEvento.has('2026-10-21')).toBe(true);
  });
});

describe('a chuva', () => {
  it('com poucos dias gravados, diz quantos tem e por volta de quando vai dar', () => {
    const r: any = diasDeChuva([{ dia: '2026-11-22', chuva: true }, { dia: '2026-11-23', chuva: false }], '2026-05-27', '2026-11-22', '2026-11-23');
    expect(r.ainda).toMatchObject({ ainda: true, diasGravados: 2, precisaDe: 60, daParaCompararPorVoltaDe: '20/01' });
  });
  it('com 60 dias, a referência fica só com os dias que a previsão disse sem chuva', () => {
    const lidos = Array.from({ length: 60 }, (_, i) => ({ dia: somarDias('2026-09-01', i), chuva: i % 2 === 0 }));
    const r: any = diasDeChuva(lidos, '2026-09-01', '2026-10-30', '2026-11-01');
    expect(r.dias.size).toBe(30);
    expect(r.foraDaReferencia.has('2026-09-01')).toBe(true);
    expect(r.foraDaReferencia.has('2026-09-02')).toBe(false);
    expect(r.foraDaReferencia.has('2026-08-15')).toBe(true);
  });
});
