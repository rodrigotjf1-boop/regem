import { dadosDoEntregador, lerDeliveryStatus, limitesDaEntrega, telefone99, unix } from './entregador-99';

// O entregador na 99 — regras puras (doc oficial: Self Delivery Order Dispatched, Update Courier
// Track, Logistics Webhooks).
describe('99 — o entregador', () => {
  it('lê o webhook deliveryStatus sem tocar no id de 64 bits, com nome acentuado e previsão', () => {
    const raw =
      '{"app_id":5764607618872501234,"app_shop_id":"001","timestamp":1790000000,"type":"deliveryStatus",' +
      '"data":{"order_id":5764608647577512345,"delivery_status":130,"rider_name":"Jo\\u00e3o da Silva",' +
      '"rider_phone":"21998765432","rider_to_B_ETA":"1790000600"}}';
    expect(lerDeliveryStatus(raw)).toEqual({
      status: 130,
      entregadorNome: 'João da Silva',
      entregadorTelefone: '21998765432',
      chegadaLojaPrevista: new Date(1790000600 * 1000),
      eventoEm: new Date(1790000000 * 1000),
    });
    // campos ausentes/vazios viram null; sem status não é evento de entrega
    expect(lerDeliveryStatus('{"data":{"delivery_status":120,"rider_name":""}}')).toMatchObject({
      status: 120, entregadorNome: null, entregadorTelefone: null, chegadaLojaPrevista: null, eventoEm: null,
    });
    expect(lerDeliveryStatus('{"data":{"order_id":1}}')).toBeNull();
  });

  it('telefone brasileiro: DDI à parte, só dígitos; lixo não vira telefone', () => {
    expect(telefone99('+55 (21) 99876-5432')).toEqual({ codigo: '+55', numero: '21998765432' });
    expect(telefone99('(21) 3333-4444')).toEqual({ codigo: '+55', numero: '2133334444' });
    expect(telefone99('021 99876-5432')).toEqual({ codigo: '+55', numero: '21998765432' });
    expect(telefone99('1234')).toBeNull();
    expect(telefone99(null)).toBeNull();
  });

  it('telefone do ENTREGADOR só com o "compartilhar contato" ligado; senão o da loja; sem nenhum, não avisa', () => {
    const comOptIn = dadosDoEntregador({
      nome: '  Ana  Paula Souza ', telefoneEntregador: '21999990000', compartilhaContato: true, telefoneLoja: '2133334444',
    });
    expect(comOptIn).toEqual({
      telefoneDe: 'entregador',
      dados: {
        courier_name: 'Ana Paula Souza', courier_first_name: 'Ana', courier_last_name: 'Paula Souza',
        courier_phone_code: '+55', courier_phone: '21999990000',
      },
    });
    const semOptIn = dadosDoEntregador({
      nome: 'Beto', telefoneEntregador: '21999990000', compartilhaContato: false, telefoneLoja: '(21) 3333-4444',
    });
    expect(semOptIn).toMatchObject({ telefoneDe: 'loja', dados: { courier_phone: '2133334444', courier_last_name: 'Beto' } });
    expect(JSON.stringify(semOptIn)).not.toContain('999990000');
    expect(dadosDoEntregador({ nome: 'Caio', telefoneEntregador: null, compartilhaContato: true, telefoneLoja: '' })).toBeNull();
    expect(dadosDoEntregador({ nome: null, telefoneEntregador: null, compartilhaContato: false, telefoneLoja: '2133334444' })!
      .dados.courier_name).toBe('Entregador');
  });

  it('previsão: a da 99 se estiver à frente; senão 30 min após a saída; nunca no passado', () => {
    const agora = new Date('2026-09-29T12:00:00Z');
    const saiu = new Date('2026-09-29T11:55:00Z');
    const da99 = unix(new Date('2026-09-29T12:40:00Z'));
    expect(limitesDaEntrega(saiu, da99, agora)).toEqual({ coleta: saiu, entrega: new Date('2026-09-29T12:40:00Z') });
    expect(limitesDaEntrega(saiu, 0, agora)).toEqual({ coleta: saiu, entrega: new Date('2026-09-29T12:25:00Z') });
    // saiu faz tempo (verificador atrasado) e a previsão da 99 já passou → 10 min a partir de agora
    const antigo = new Date('2026-09-29T10:00:00Z');
    expect(limitesDaEntrega(antigo, unix(new Date('2026-09-29T11:00:00Z')), agora).entrega).toEqual(
      new Date('2026-09-29T12:10:00Z'),
    );
    // relógio da loja à frente: a coleta nunca fica no futuro
    expect(limitesDaEntrega(new Date('2026-09-29T12:05:00Z'), 0, agora).coleta).toEqual(agora);
  });
});
