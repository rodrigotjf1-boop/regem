import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { EntregadorService } from './entregador.service';
import { DeliveryService } from '../delivery/delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Finalizar a entrega com o código certo para cada tipo de pedido — o backend decide, o app obedece.
const ENTREGADOR: any = { tenantId: 't1', colaboradorId: 'c1', nome: 'Ana', funcaoNome: 'Entregador' };
const IFOOD_LOJA = { delivery: { deliveredBy: 'MERCHANT' } };
const IFOOD_PLATAFORMA = { delivery: { deliveredBy: 'IFOOD' } };
const DE99_LOJA = {
  delivery_type: 2,
  receive_address: { locator: '56244631', handover_page_url: 'https://food-b-h5.99app.com/pt-BR/v2/confirmation-entrega' },
};

function servico(ped: any) {
  const db: any = {
    select: () => ({ from: () => ({ where: async () => (ped ? [ped] : []) }) }),
    execute: async () => ({ rows: [] }),
  };
  const delivery: any = {
    confirmarEntregaComCodigo: jest.fn(async () => ({ ok: true, valid: true })),
    marcarEntregue: jest.fn(async () => ({})),
  };
  const svc = new EntregadorService(db, delivery, {} as any);
  (svc as any).avancarSaida = jest.fn(async () => undefined);
  return { svc, delivery };
}

describe('app do entregador — o que o pedido mostra (resumo)', () => {
  const resumo = (p: any) => (new EntregadorService({} as any, {} as any, {} as any) as any).resumo(p);

  it('iFood da loja: código do CANAL, só online — nunca o código do Regem (que todo pedido tem por padrão)', () => {
    const r = resumo({ id: 'p', canal: 'ifood', tipo: 'entrega', raw: IFOOD_LOJA, codigoEntrega: '4821' });
    expect(r).toMatchObject({
      modoEntrega: 'propria_canal', precisaCodigo: true, codigoDoCanal: 'ifood', conferencia: 'online',
      codigoEntregaHash: null, entrega99: null,
    });
    expect(JSON.stringify(r)).not.toContain('4821');
  });

  it('99 da loja: código do canal, pode guardar sem sinal, com o plano B (localizador + página da 99)', () => {
    const r = resumo({ id: 'p', canal: '99food', tipo: 'entrega', raw: DE99_LOJA, codigoEntrega: '4821' });
    expect(r).toMatchObject({
      modoEntrega: 'propria_canal', precisaCodigo: true, codigoDoCanal: '99food', conferencia: 'depois',
      codigoEntregaHash: null,
      entrega99: { localizador: '56244631', pagina: 'https://food-b-h5.99app.com/pt-BR/v2/confirmation-entrega' },
    });
  });

  it('entrega da loja pelo cardápio: código do Regem conferido no aparelho pelo hash, nunca em texto', () => {
    const r = resumo({ id: 'p', canal: 'cardapio', tipo: 'entrega', raw: null, codigoEntrega: '4821' });
    expect(r).toMatchObject({
      modoEntrega: 'propria_loja', precisaCodigo: true, codigoDoCanal: null, conferencia: 'hash',
      codigoEntregaHash: createHash('sha256').update('4821').digest('hex'),
    });
    expect(JSON.stringify({ ...r, raw: undefined })).not.toContain('4821');
  });

  it('logística do canal e retirada: sem código', () => {
    expect(resumo({ canal: 'ifood', tipo: 'entrega', raw: IFOOD_PLATAFORMA, codigoEntrega: '1' })).toMatchObject({
      modoEntrega: 'logistica_canal', precisaCodigo: false, conferencia: null,
    });
    expect(resumo({ canal: 'cardapio', tipo: 'retirada', codigoEntrega: '1' })).toMatchObject({
      modoEntrega: 'retirada', precisaCodigo: false, conferencia: null, codigoEntregaHash: null,
    });
  });
});

describe('app do entregador — finalizar', () => {
  it('iFood/99 da loja sem código: pede o código DO CANAL (não cai no código do Regem)', async () => {
    const { svc, delivery } = servico({ canal: 'ifood', tipo: 'entrega', raw: IFOOD_LOJA, codigoEntrega: '4821' });
    await expect(svc.finalizar(ENTREGADOR, 'p1')).rejects.toThrow('código de entrega do iFood');
    expect(delivery.confirmarEntregaComCodigo).not.toHaveBeenCalled();
    expect(delivery.marcarEntregue).not.toHaveBeenCalled();
  });

  it('iFood/99 da loja com código: confere no canal (e o código do Regem não interfere)', async () => {
    const { svc, delivery } = servico({ canal: '99food', tipo: 'entrega', raw: DE99_LOJA, codigoEntrega: '4821' });
    await expect(svc.finalizar(ENTREGADOR, 'p1', ' 5107 ')).resolves.toEqual({ ok: true, valid: true });
    expect(delivery.confirmarEntregaComCodigo).toHaveBeenCalledWith('t1', 'c1', 'p1', '5107');
    expect((svc as any).avancarSaida).toHaveBeenCalled();
  });

  it('pedido que o entregador do iFood/99 leva: a loja não finaliza', async () => {
    const { svc, delivery } = servico({ canal: 'ifood', tipo: 'entrega', raw: IFOOD_PLATAFORMA });
    await expect(svc.finalizar(ENTREGADOR, 'p1', '1234')).rejects.toThrow('entregador do iFood');
    expect(delivery.confirmarEntregaComCodigo).not.toHaveBeenCalled();
  });

  it('entrega da loja (cardápio): código do Regem — errado recusa, certo marca entregue', async () => {
    const { svc, delivery } = servico({ canal: 'cardapio', tipo: 'entrega', raw: null, codigoEntrega: '4821' });
    await expect(svc.finalizar(ENTREGADOR, 'p1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.finalizar(ENTREGADOR, 'p1', '0000')).resolves.toMatchObject({ valid: false });
    expect(delivery.marcarEntregue).not.toHaveBeenCalled();
    await expect(svc.finalizar(ENTREGADOR, 'p1', '4821')).resolves.toEqual({ ok: true, valid: true });
    expect(delivery.marcarEntregue).toHaveBeenCalledTimes(1);
    expect(delivery.confirmarEntregaComCodigo).not.toHaveBeenCalled();
  });

  it('escanear pedido da logística do canal: recusa com o motivo', async () => {
    const { svc } = servico({ id: 'p1', canal: '99food', tipo: 'entrega', raw: { delivery_type: 1 }, status: 'pronto' });
    await expect(svc.scan(ENTREGADOR, 'https://app.dmsregem.com/e/abc123')).rejects.toThrow('entregador do 99');
  });
});

describe('confirmar com o código do canal — o estado do Regem vem ANTES do canal', () => {
  function delivery(status: string) {
    const svc: any = Object.create(DeliveryService.prototype);
    svc.carregar = jest.fn(async () => ({ id: 'p1', status, canal: 'ifood', externalId: 'ext-1' }));
    svc.ifood = {
      integracaoDoTenant: jest.fn(async () => ({ id: 'ig' })),
      verificarCodigoEntrega: jest.fn(async () => ({ valid: true })),
    };
    svc.marcarEntregue = jest.fn(async () => ({}));
    return svc;
  }

  it('já entregue/concluído (reenvio da fila offline do app): responde feito, sem ir ao canal', async () => {
    for (const st of ['entregue', 'concluido']) {
      const svc = delivery(st);
      await expect(svc.confirmarEntregaComCodigo('t1', 'c1', 'p1', '1234')).resolves.toEqual({ ok: true, valid: true, jaFeito: true });
      expect(svc.ifood.verificarCodigoEntrega).not.toHaveBeenCalled();
    }
  });

  it('fora de rota: recusa ANTES de o canal concluir o pedido do lado dele', async () => {
    const svc = delivery('pronto');
    await expect(svc.confirmarEntregaComCodigo('t1', 'c1', 'p1', '1234')).rejects.toThrow('em rota');
    expect(svc.ifood.verificarCodigoEntrega).not.toHaveBeenCalled();
  });

  it('em rota: confere no canal e marca entregue', async () => {
    const svc = delivery('despachado');
    await expect(svc.confirmarEntregaComCodigo('t1', 'c1', 'p1', ' 12 34 ')).resolves.toEqual({ ok: true, valid: true });
    expect(svc.ifood.verificarCodigoEntrega).toHaveBeenCalledWith({ id: 'ig' }, 'ext-1', '1234');
    expect(svc.marcarEntregue).toHaveBeenCalledWith('t1', 'c1', 'p1');
  });
});
