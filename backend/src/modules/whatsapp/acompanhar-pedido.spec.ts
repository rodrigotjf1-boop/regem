import { acompanharPedido, horaDoPedido } from './acompanhar-pedido';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "Cadê meu pedido?" com a previsão real (26/11/2026): o que o atendente recebe de cada pedido em andamento.
const BASE = 'https://app.dmsregem.com';
// 26/11/2026 19:40 em São Paulo (UTC−3).
const as = (hhmm: string) => new Date(`2026-11-26T${hhmm}:00-03:00`);

describe('o acompanhamento do pedido para o atendente', () => {
  it('a entrega da loja que saiu: as horas, a previsão, a parada e o link de acompanhar', () => {
    const a = acompanharPedido(
      {
        status: 'despachado',
        tipo: 'entrega',
        canal: 'cardapio',
        criadoEm: as('19:40'),
        confirmadoEm: as('19:41'),
        prontoEm: as('20:02'),
        despachadoEm: as('20:05'),
        rastreioToken: 'tok123',
        ordemParada: 2,
      },
      { basePublica: BASE, chegaPorVoltaDe: '20h35', totalDeParadas: 3 },
    );
    expect(a).toEqual({
      quemEntrega: 'loja',
      recebidoAs: '19h40',
      aceitoAs: '19h41',
      prontoAs: '20h02',
      saiuAs: '20h05',
      chegaPorVoltaDe: '20h35',
      parada: { suaEntrega: 2, de: 3 },
      agendadoPara: null,
      linkAcompanhar: 'https://app.dmsregem.com/r/tok123',
      acompanhaPeloApp: null,
    });
  });

  it('em preparo: sem "saiu", sem previsão e sem parada (mesmo que alguém mande)', () => {
    const a = acompanharPedido(
      { status: 'confirmado', tipo: 'entrega', canal: 'cardapio', criadoEm: as('19:40'), confirmadoEm: as('19:41'), despachadoEm: as('20:05'), ordemParada: 1 },
      { basePublica: BASE, chegaPorVoltaDe: '20h35', totalDeParadas: 3 },
    )!;
    expect(a.saiuAs).toBeNull();
    expect(a.chegaPorVoltaDe).toBeNull();
    expect(a.parada).toBeNull();
    expect(a.aceitoAs).toBe('19h41');
  });

  it('o entregador do iFood: acompanha pelo app, sem previsão nossa e sem o nosso link', () => {
    const a = acompanharPedido(
      { status: 'despachado', tipo: 'entrega', canal: 'ifood', raw: { delivery: { deliveredBy: 'IFOOD' } }, despachadoEm: as('20:05'), rastreioToken: 'tok' },
      { basePublica: BASE, chegaPorVoltaDe: '20h35' },
    )!;
    expect(a).toMatchObject({ quemEntrega: 'plataforma', saiuAs: '20h05', chegaPorVoltaDe: null, linkAcompanhar: null, acompanhaPeloApp: 'pelo app do iFood' });
    const n99 = acompanharPedido({ status: 'despachado', tipo: 'entrega', canal: '99food', raw: { delivery_type: 1 } }, { basePublica: BASE })!;
    expect(n99).toMatchObject({ quemEntrega: 'plataforma', acompanhaPeloApp: 'pelo app da 99' });
  });

  it('retirada: sem "saiu"; o agendado com o dia e a hora; uma parada só não vira "1ª de 1"', () => {
    const r = acompanharPedido({ status: 'pronto', tipo: 'retirada', canal: 'cardapio', prontoEm: as('20:02'), rastreioToken: 't' }, { basePublica: BASE })!;
    expect(r).toMatchObject({ quemEntrega: 'retirada', prontoAs: '20h02', saiuAs: null, linkAcompanhar: 'https://app.dmsregem.com/r/t' });
    const ag = acompanharPedido({ status: 'novo', tipo: 'entrega', canal: 'cardapio', retiradaTipo: 'agendado', agendamento: new Date('2026-11-28T23:00:00Z') }, { basePublica: BASE })!;
    expect(ag.agendadoPara).toBe('28/11 às 20h00');
    const uma = acompanharPedido({ status: 'despachado', tipo: 'entrega', canal: 'cardapio', ordemParada: 1 }, { basePublica: BASE, totalDeParadas: 1 })!;
    expect(uma.parada).toBeNull();
  });

  it('pedido encerrado ou cancelado: nada (o texto da situação basta); sem base https, sem link', () => {
    for (const status of ['entregue', 'concluido', 'cancelado', '']) expect(acompanharPedido({ status, tipo: 'entrega' }, { basePublica: BASE })).toBeNull();
    expect(acompanharPedido({ status: 'novo', tipo: 'entrega', canal: 'cardapio', rastreioToken: 't' }, { basePublica: 'http://inseguro' })!.linkAcompanhar).toBeNull();
    expect(horaDoPedido(null)).toBeNull();
    expect(horaDoPedido('lixo')).toBeNull();
  });
});
