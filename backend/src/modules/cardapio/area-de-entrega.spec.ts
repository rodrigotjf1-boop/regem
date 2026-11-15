import { CardapioPublicoController } from './cardapio.controller';
import { alcanceDasFaixas, raioConfigurado, recusaDaArea } from './area-de-entrega';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ÁREA DE ENTREGA DO PEDIDO DO CARDÁPIO (ERR-470): o pedido #71 saiu a ~119 km com frete R$ 0 e foi pago no Pix.
// As faixas são as da loja-piloto (a última, até 1,9 km, é R$ 0).
const RAIOS = [{ ateKm: 0.5, taxa: 5 }, { ateKm: 1, taxa: 5 }, { ateKm: 1.5, taxa: 6 }, { ateKm: 1.9, taxa: 0 }];
const RAIO = { areaModo: 'raio', raios: RAIOS, endLat: '-22.84', endLng: '-43.27' };
const taxa = (p: Partial<{ alemDaUltimaFaixa: boolean; semLocalizacao: boolean; km: number | null; bairro: any }> = {}) => ({
  alemDaUltimaFaixa: false,
  semLocalizacao: false,
  km: 1,
  bairro: null,
  ...p,
});

describe('área de entrega do cardápio (ERR-470)', () => {
  it('além da última faixa: recusa com a distância e o alcance', () => {
    expect(recusaDaArea(RAIO, taxa({ alemDaUltimaFaixa: true, km: 119.2 }))).toEqual({
      code: 'FORA_DA_AREA',
      message: 'Não entregamos nesse endereço: ele fica a ~119,2 km da loja, e a entrega vai até 1,9 km. Confira o endereço.',
    });
  });

  it('dentro das faixas: passa', () => {
    expect(recusaDaArea(RAIO, taxa({ km: 1.9 }))).toBeNull();
  });

  it('endereço que não se acha no mapa (loja configurada): recusa e pede a localização', () => {
    expect(recusaDaArea(RAIO, taxa({ semLocalizacao: true, km: null }))?.code).toBe('ENDERECO_NAO_ENCONTRADO');
  });

  it('modo distância com o cadastro da loja incompleto: não recusa (seria parar todas as entregas sem aviso)', () => {
    for (const cfg of [
      { ...RAIO, raios: [] },
      { ...RAIO, raios: [{ ateKm: 'x', taxa: 3 }] },
      { ...RAIO, endLat: null },
      { ...RAIO, endLng: '' },
    ]) {
      expect(raioConfigurado(cfg)).toBe(false);
      expect(recusaDaArea(cfg, taxa({ alemDaUltimaFaixa: true, km: 9000 }))).toBeNull();
      expect(recusaDaArea(cfg, taxa({ semLocalizacao: true }))).toBeNull();
    }
  });

  it('modo bairro: sem bairro da lista recusa; com bairro passa', () => {
    expect(recusaDaArea({ areaModo: 'bairro' }, taxa())?.code).toBe('BAIRRO_FORA_DA_AREA');
    expect(recusaDaArea({ areaModo: null }, taxa())?.code).toBe('BAIRRO_FORA_DA_AREA'); // sem modo = bairro (o padrão)
    expect(recusaDaArea({ areaModo: 'bairro' }, taxa({ bairro: { id: 'b1', nome: 'Penha' } }))).toBeNull();
  });

  it('alcance = a maior faixa válida, em qualquer ordem', () => {
    expect(alcanceDasFaixas([{ ateKm: 3 }, { ateKm: 1 }, { ateKm: 'x' }, { ateKm: -2 }])).toBe(3);
    expect(alcanceDasFaixas(null)).toBeNull();
  });

  it('a rota pública tira o `_sistema` do corpo (só a rotina da recorrência o usa)', async () => {
    const recebido: any[] = [];
    const ctrl = new (CardapioPublicoController as any)({ receberPedido: async (_t: string, dto: any) => recebido.push(dto) });
    await ctrl.pedido('tk', { _sistema: true, tipo: 'entrega', cliente: 'Ana' });
    expect(recebido[0]).toEqual({ tipo: 'entrega', cliente: 'Ana' });
    await ctrl.pedido('tk', null);
    expect(recebido[1]).toEqual({});
  });
});
