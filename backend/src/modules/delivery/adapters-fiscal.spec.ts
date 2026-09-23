import { adaptar, documentoDoCliente, enderecoFiscalCanal } from './adapters';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O QUE A NFC-e PRECISA DO PEDIDO DO CANAL.
//
// Dois campos que nenhum canal escreve igual: o CPF do cliente e o endereço em partes. O
// endereço em texto ("Rua A, 10 — Centro") serve ao entregador; o grupo `enderDest` do XML
// precisa de bairro, município e UF cada um no seu lugar, e sem eles a nota de entrega vira
// rejeição 788 — ou, no nosso caminho, sai declarada como presencial sem ninguém entender por quê.
//
// O documento é lido em várias grafias de propósito: o valor NÃO é usado às cegas (quem emite
// confere o dígito verificador), então o pior caso é a nota sair sem CPF, nunca com o errado.

describe('documento do cliente no payload do canal', () => {
  it('lê as grafias conhecidas', () => {
    expect(documentoDoCliente({ customer: { documentNumber: '111.444.777-35' } })).toBe('11144477735');
    expect(documentoDoCliente({ customer: { document: { value: '11144477735' } } })).toBe('11144477735');
    expect(documentoDoCliente({ customer: { document: '11144477735' } })).toBe('11144477735');
    expect(documentoDoCliente({ customer: { cpf: '11144477735' } })).toBe('11144477735');
    expect(documentoDoCliente({ customer: { documentNumber: '11222333000181' } })).toBe('11222333000181');
  });

  it('o que não tem tamanho de CPF nem de CNPJ é ignorado', () => {
    expect(documentoDoCliente({ customer: { documentNumber: '123' } })).toBeUndefined();
    expect(documentoDoCliente({ customer: {} })).toBeUndefined();
    expect(documentoDoCliente({})).toBeUndefined();
    expect(documentoDoCliente(null)).toBeUndefined();
  });
});

describe('endereço da entrega em campos separados', () => {
  it('grafia do iFood', () => {
    expect(
      enderecoFiscalCanal({
        streetName: 'Rua A', streetNumber: '10', complement: 'ap 2', neighborhood: 'Centro',
        city: 'Rio de Janeiro', state: 'RJ', postalCode: '21221240',
      }),
    ).toEqual({
      rua: 'Rua A', numero: '10', complemento: 'ap 2', bairro: 'Centro',
      cidade: 'Rio de Janeiro', uf: 'RJ', cep: '21221240',
    });
  });

  it('grafia do Cardápio Web / Open Delivery', () => {
    const e = enderecoFiscalCanal({ street: 'Rua B', number: 5, district: 'Penha', city: 'Niteroi', state: 'RJ' });
    expect(e).toMatchObject({ rua: 'Rua B', numero: '5', bairro: 'Penha', cidade: 'Niteroi', uf: 'RJ' });
  });

  it('grafia da 99Food (DiDi), que não segue Open Delivery', () => {
    const e = enderecoFiscalCanal({ poi_address: 'Av. C', house_number: '77', city: 'Rio de Janeiro' });
    expect(e).toMatchObject({ rua: 'Av. C', numero: '77', cidade: 'Rio de Janeiro' });
  });

  it('endereço ausente ou vazio não vira objeto vazio', () => {
    expect(enderecoFiscalCanal(null)).toBeUndefined();
    expect(enderecoFiscalCanal({})).toBeUndefined();
    expect(enderecoFiscalCanal('Rua A, 10')).toBeUndefined();
  });
});

describe('os adaptadores entregam o que a nota precisa', () => {
  it('iFood: documento e endereço estruturado', () => {
    const n = adaptar('ifood', {
      id: 'x', customer: { name: 'Fulano', documentNumber: '11144477735' },
      delivery: {
        deliveryAddress: {
          formattedAddress: 'Rua A, 10 - Centro', streetName: 'Rua A', streetNumber: '10',
          neighborhood: 'Centro', city: 'Rio de Janeiro', state: 'RJ', postalCode: '21221240',
        },
      },
      items: [{ name: 'X', quantity: 1, unitPrice: 10 }],
      total: { orderAmount: 10 },
    } as any);
    expect(n.documentoCliente).toBe('11144477735');
    expect(n.enderecoFiscal).toMatchObject({ bairro: 'Centro', cidade: 'Rio de Janeiro', uf: 'RJ' });
  });

  it('99Food: documento e endereço vindos do receive_address', () => {
    const n = adaptar('99food', {
      order_id: 1, customer: { documentNumber: '11144477735' },
      receive_address: { poi_address: 'Av. C', house_number: '77', city: 'Rio de Janeiro', name: 'Fulano' },
      items: [], price: { customer_need_paying_money: 1000 },
    } as any);
    expect(n.documentoCliente).toBe('11144477735');
    expect(n.enderecoFiscal).toMatchObject({ rua: 'Av. C', numero: '77' });
  });

  it('pedido sem documento continua funcionando como antes', () => {
    const n = adaptar('ifood', { id: 'x', customer: { name: 'Fulano' }, items: [], total: { orderAmount: 0 } } as any);
    expect(n.documentoCliente).toBeUndefined();
  });
});
