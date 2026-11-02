import { lerDisputa } from './ifood-disputa';
import { IfoodService } from './ifood.service';
import { montarRespostaAoIfood } from '../../atendimento/disputa-ifood.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('a foto da disputa só vem do endereço do iFood (leva o token da loja — V68)', () => {
  const svc = new IfoodService({} as any);
  const chamadas: string[] = [];
  (svc as any).req = async (_ig: any, caminho: string) => {
    chamadas.push(caminho);
    return new Response(Buffer.from('jpg'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  beforeEach(() => (chamadas.length = 0));

  it('outro endereço, http ou endereço quebrado: nem chama', async () => {
    for (const url of [
      'https://atacante.exemplo/evidences/1',
      'http://merchant-api.ifood.com.br/orders/x/evidences/1',
      'https://merchant-api.ifood.com.br.atacante.exemplo/x',
      'não é endereço',
    ]) {
      expect(await svc.fotoDaDisputa({} as any, url)).toBeNull();
    }
    expect(chamadas).toEqual([]);
  });

  it('o endereço do iFood: busca pelo caminho, com a credencial da loja', async () => {
    const f = await svc.fotoDaDisputa({} as any, 'https://merchant-api.ifood.com.br/orders/x/evidences/1?v=2');
    expect(f?.tipo).toBe('image/jpeg');
    expect(chamadas).toEqual(['/orders/x/evidences/1?v=2']);
  });
});

// A DISPUTA DO iFOOD lida como a documentação manda (Plataforma de negociação, conferida em 02/11/2026) e a resposta
// conferida ANTES de gastar a única que o iFood aceita. Os eventos abaixo são os exemplos da própria documentação.

const TOTAL = {
  id: 'evt_001',
  code: 'HSD',
  fullCode: 'HANDSHAKE_DISPUTE',
  orderId: 'ord_12345',
  merchantId: 'merchant_001',
  createdAt: '2024-04-25T18:02:46.921Z',
  metadata: {
    id: 'dispute_001',
    action: 'CANCELLATION',
    handshakeType: 'AFTER_DELIVERY',
    handshakeGroup: 'CUSTOMER_ORDER_SUPPORT',
    message: 'Comida chegou fria',
    expiresAt: '2024-04-25T18:09:46Z',
    timeoutAction: 'REJECT_CANCELLATION',
    createdAt: '2024-04-25T18:02:46Z',
    alternatives: [{ id: 'alt_001', type: 'REFUND', metadata: { maxAmount: { currency: 'BRL', value: '5000' } } }],
    acceptCancellationReasons: ['PRODUCT_QUALITY', 'CUSTOMER_SATISFACTION'],
    evidences: [{ url: 'https://merchant-api.ifood.com.br/orders/ord_12345/evidences/abc123', contentType: 'image/jpeg' }],
  },
};

const ATRASO = {
  code: 'HSD',
  orderId: 'ord_9',
  metadata: {
    id: 'dispute_009',
    action: 'CANCELLATION',
    handshakeType: 'DELAY',
    expiresAt: '2024-04-25T18:09:46Z',
    timeoutAction: 'ACCEPT_CANCELLATION',
    alternatives: [
      {
        id: 'alt_9',
        type: 'ADDITIONAL_TIME',
        metadata: { allowedsAdditionalTimeInMinutes: [15, 30, 45], allowedsAdditionalTimeReasons: ['HIGH_STORE_DEMAND', 'LATE_DELIVERY'] },
      },
    ],
  },
};

describe('a disputa lida do evento', () => {
  it('cancelamento total: fala, prazo, ação automática, proposta em CENTAVOS, motivos e foto', () => {
    const d = lerDisputa(TOTAL)!;
    expect(d).toMatchObject({
      id: 'dispute_001',
      pedidoExterno: 'ord_12345',
      acao: 'CANCELLATION',
      tipo: 'AFTER_DELIVERY',
      mensagem: 'Comida chegou fria',
      expiraEm: '2024-04-25T18:09:46Z',
      acaoAutomatica: 'REJECT_CANCELLATION',
      motivosParaAceitar: ['PRODUCT_QUALITY', 'CUSTOMER_SATISFACTION'],
    });
    expect(d.alternativas).toEqual([{ id: 'alt_001', tipo: 'REFUND', maxCentavos: 5000, minutos: [], motivos: [] }]);
    expect(d.fotos).toEqual([{ url: 'https://merchant-api.ifood.com.br/orders/ord_12345/evidences/abc123', tipo: 'image/jpeg' }]);
  });

  it('atraso: as opções de minutos e os motivos do atraso', () => {
    const d = lerDisputa(ATRASO)!;
    expect(d.alternativas[0]).toEqual({ id: 'alt_9', tipo: 'ADDITIONAL_TIME', maxCentavos: null, minutos: [15, 30, 45], motivos: ['HIGH_STORE_DEMAND', 'LATE_DELIVERY'] });
  });

  it('cancelamento parcial: os itens contestados (com o valor em centavos)', () => {
    const d = lerDisputa({
      code: 'HSD',
      metadata: {
        id: 'd2',
        action: 'PARTIAL_CANCELLATION',
        item: [{ id: 'i1', externalCode: 'BATATA', quantity: 1, amount: { value: '1290', currency: 'BRL' }, reason: 'MISSING_ITEM' }],
      },
    })!;
    expect(d.itens).toEqual([{ nome: null, codigo: 'BATATA', quantidade: 1, centavos: 1290, motivo: 'MISSING_ITEM' }]);
  });

  it('evento sem o id da disputa não vira caso', () => {
    expect(lerDisputa({ code: 'HSD', metadata: {} })).toBeNull();
  });
});

describe('a resposta conferida antes de ir ao iFood', () => {
  const total = lerDisputa(TOTAL)!;
  const atraso = lerDisputa(ATRASO)!;

  it('aceitar: só com um dos motivos que o iFood mandou nesta disputa', () => {
    expect(montarRespostaAoIfood(total, { acao: 'aceitar', motivo: 'PRODUCT_QUALITY', detalhe: 'comida fria' })).toEqual({
      acao: 'accept',
      corpo: { reason: 'PRODUCT_QUALITY', detailReason: 'comida fria' },
      resumo: { acao: 'aceitar', motivo: 'PRODUCT_QUALITY', detalhe: 'comida fria' },
    });
    expect(() => montarRespostaAoIfood(total, { acao: 'aceitar', motivo: 'WRONG_ORDER' })).toThrow('Escolha um dos motivos que o iFood aceita nesta disputa.');
  });

  it('recusar: só com um motivo da lista do iFood', () => {
    expect(montarRespostaAoIfood(total, { acao: 'recusar', motivo: 'INVENTORY_CHECK' }).corpo).toEqual({ reason: 'INVENTORY_CHECK' });
    expect(() => montarRespostaAoIfood(total, { acao: 'recusar', motivo: 'PORQUE_SIM' })).toThrow('Escolha o motivo da recusa na lista do iFood.');
  });

  it('propor devolver parte do valor: até o limite desta disputa, em centavos', () => {
    expect(montarRespostaAoIfood(total, { acao: 'propor', tipo: 'REFUND', centavos: 1290 }).corpo).toEqual({
      type: 'REFUND',
      metadata: { amount: { value: '1290', currency: 'BRL' } },
    });
    expect(() => montarRespostaAoIfood(total, { acao: 'propor', tipo: 'REFUND', centavos: 5001 })).toThrow('O iFood aceita no máximo R$');
    expect(() => montarRespostaAoIfood(total, { acao: 'propor', tipo: 'REFUND', centavos: 0 })).toThrow('Informe o valor da proposta.');
    expect(() => montarRespostaAoIfood(total, { acao: 'propor', tipo: 'BENEFIT', centavos: 100 })).toThrow('O iFood não oferece esta proposta nesta disputa.');
  });

  it('propor mais tempo: só os minutos e os motivos permitidos', () => {
    expect(montarRespostaAoIfood(atraso, { acao: 'propor', tipo: 'ADDITIONAL_TIME', minutos: 30, motivo: 'HIGH_STORE_DEMAND' }).corpo).toEqual({
      type: 'ADDITIONAL_TIME',
      metadata: { additionalTimeInMinutes: 30, reason: 'HIGH_STORE_DEMAND' },
    });
    expect(() => montarRespostaAoIfood(atraso, { acao: 'propor', tipo: 'ADDITIONAL_TIME', minutos: 20, motivo: 'HIGH_STORE_DEMAND' })).toThrow('Escolha 15, 30, 45 minutos.');
    expect(() => montarRespostaAoIfood(atraso, { acao: 'propor', tipo: 'ADDITIONAL_TIME', minutos: 15, motivo: 'X' })).toThrow('Escolha o motivo do atraso na lista do iFood.');
  });

  it('sem ação conhecida: recusa', () => {
    expect(() => montarRespostaAoIfood(total, {})).toThrow('Escolha aceitar, recusar ou propor.');
  });
});
