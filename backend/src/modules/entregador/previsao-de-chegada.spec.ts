import { PgDialect } from 'drizzle-orm/pg-core';
import { EntregadorService } from './entregador.service';
import { DeliveryService } from '../delivery/delivery.service';

const dialeto = new PgDialect();

/* eslint-disable @typescript-eslint/no-explicit-any */

// A PREVISÃO DE CHEGADA NO "SAIU PARA ENTREGA" (Onda 0, 01/11/2026): o aviso diz "Chega por volta das 20h15". A conta é a
// do rastreio (posição AO VIVO do entregador, roteiro, OSRM) e mora no EntregadorService, que a entrega ao
// DeliveryService quando sobe (o contrário seria dependência circular).
describe('previsão de chegada — a hora e o texto', () => {
  it('"por volta das": arredonda PARA CIMA em 5 min, no fuso da operação', () => {
    // 23h11 UTC = 20h11 em São Paulo.
    expect(DeliveryService.horaPorVolta(new Date('2026-11-01T23:11:00Z'))).toBe('20h15');
    expect(DeliveryService.horaPorVolta(new Date('2026-11-01T23:15:00Z'))).toBe('20h15');
    expect(DeliveryService.horaPorVolta(new Date('2026-11-01T23:15:01Z'))).toBe('20h20');
    expect(DeliveryService.horaPorVolta(new Date('2026-11-02T02:58:00Z'))).toBe('00h00'); // vira o dia
  });

  it('o texto do "saiu" leva a hora quando há previsão; sem ela, o texto de sempre', () => {
    const texto = (extra: any) =>
      (DeliveryService as any).textoNotificacao('saiu_entrega', { canal: 'ifood', displayId: '81', ...extra }).texto as string;
    expect(texto({ previsaoChegada: '20h15' })).toBe(
      'Seu pedido #81 saiu para entrega! 🛵 Chega por volta das 20h15. Acompanhe a chegada pelo botão abaixo.',
    );
    expect(texto({})).toBe('Seu pedido #81 saiu para entrega! 🛵 Acompanhe a chegada pelo botão abaixo.');
  });
});

describe('previsão de chegada — a conta do entregador', () => {
  /** O banco falso responde o pedido e a posição; `pos` null = sem GPS ao vivo. */
  function servico(ped: any, pos: any) {
    const db: any = {
      execute: async (q: any) => {
        const sqlTxt = dialeto.sqlToQuery(q).sql;
        if (sqlTxt.includes('entregador_posicao')) return { rows: pos ? [pos] : [] };
        return { rows: ped ? [ped] : [] };
      },
    };
    const svc: any = new EntregadorService(db, {} as any, {} as any);
    svc.etaAcumulado = jest.fn(async () => 18);
    svc.coordDoPedido = jest.fn(async () => ({ lat: -22.91, lng: -43.2 }));
    svc.duracaoRotaOsrm = jest.fn(async () => 9);
    return svc;
  }
  const NO_AR = { id: 'p1', status: 'despachado', entregador_id: 'c1', saida_id: null, ordem_parada: null };
  const GPS = { lat: -22.9, lng: -43.2 };

  it('com roteiro: a conta acumulada do rastreio (as paradas antes desta)', async () => {
    const svc = servico({ ...NO_AR, saida_id: 's1', ordem_parada: 2 }, GPS);
    expect(await svc.previsaoDeChegadaMin('t1', 'p1')).toBe(18);
    expect(svc.etaAcumulado).toHaveBeenCalledWith('t1', expect.objectContaining({ id: 'p1' }), { lat: -22.9, lng: -43.2 });
  });

  it('sem roteiro: direto ao endereço pelas ruas; sem OSRM, a distância reta a 25 km/h', async () => {
    const svc = servico(NO_AR, GPS);
    expect(await svc.previsaoDeChegadaMin('t1', 'p1')).toBe(9);
    svc.duracaoRotaOsrm = jest.fn(async () => null);
    expect(await svc.previsaoDeChegadaMin('t1', 'p1')).toBe(3); // ~1,1 km a 25 km/h
  });

  it('sem previsão: pedido que não está a caminho, sem entregador, sem GPS ao vivo, endereço sem coordenadas', async () => {
    expect(await servico({ ...NO_AR, status: 'pronto' }, GPS).previsaoDeChegadaMin('t1', 'p1')).toBeNull();
    expect(await servico({ ...NO_AR, entregador_id: null }, GPS).previsaoDeChegadaMin('t1', 'p1')).toBeNull();
    expect(await servico(NO_AR, null).previsaoDeChegadaMin('t1', 'p1')).toBeNull();
    const semEndereco = servico(NO_AR, GPS);
    semEndereco.coordDoPedido = jest.fn(async () => null);
    expect(await semEndereco.previsaoDeChegadaMin('t1', 'p1')).toBeNull();
  });

  it('ao subir, entrega a conta ao DeliveryService', async () => {
    const delivery: any = { definirPrevisaoDeChegada: jest.fn() };
    const svc: any = new EntregadorService({} as any, delivery, {} as any);
    svc.onModuleInit();
    expect(delivery.definirPrevisaoDeChegada).toHaveBeenCalledWith(expect.any(Function));
  });
});
