import { BadRequestException } from '@nestjs/common';
import { lerItensDaPerda } from './itens-da-perda';

// A lista da perda como a tela manda (perda parcial no cancelamento, dono, 28/10/2026). A conferência contra a venda
// (o item é dela? a quantidade cabe?) está em `kds-delivery-cancelamentos.spec.ts`, contra o Postgres.
describe('lerItensDaPerda', () => {
  const ID = '0b6f1d1e-2b7a-4c55-9d2a-7a3c9b1e0f11';

  it('ausente = a tela antiga (o servidor faz o de sempre); lista vazia = nada se perdeu', () => {
    expect(lerItensDaPerda(undefined)).toBeNull();
    expect(lerItensDaPerda(null)).toBeNull();
    expect(lerItensDaPerda([])).toEqual([]);
  });

  it('item e quantidade; sem quantidade, o item inteiro', () => {
    expect(lerItensDaPerda([{ comandaItemId: ID, quantidade: 2 }, { comandaItemId: ID.replace('0b', '1c') }])).toEqual([
      { comandaItemId: ID, quantidade: 2 },
      { comandaItemId: ID.replace('0b', '1c'), quantidade: null },
    ]);
  });

  it('formato errado = 400, com o motivo', () => {
    expect(() => lerItensDaPerda('tudo')).toThrow(BadRequestException);
    expect(() => lerItensDaPerda([{ comandaItemId: 'x' }])).toThrow(/sem identificação/);
    expect(() => lerItensDaPerda([{ comandaItemId: ID, quantidade: 0 }])).toThrow(/quantidade perdida/);
    expect(() => lerItensDaPerda([{ comandaItemId: ID, quantidade: 'muito' }])).toThrow(/quantidade perdida/);
    expect(() => lerItensDaPerda(Array.from({ length: 201 }, () => ({ comandaItemId: ID })))).toThrow(/grande demais/);
  });
});
