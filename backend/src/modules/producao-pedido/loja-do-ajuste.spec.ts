import { ForbiddenException } from '@nestjs/common';
import { NIL_UUID } from '../../auth/unidade-atual.decorator';
import { lojaDoAjuste } from './producao-pedido.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-646 (rodada 7 de segurança, MIS-B-01): os ajustes por loja do KDS (cores, senha) gravavam na loja do corpo — o gerente de
// uma loja mudava o de outra ou o padrão da empresa inteira.
describe('a loja em que um ajuste do KDS é gravado', () => {
  const LOJA_A = '11111111-1111-4111-8111-111111111111';
  const LOJA_B = '22222222-2222-4222-8222-222222222222';
  const quem = (categoria: string) => ({ categoria }) as any;

  it('ERR-646: o presidente escolhe (a do corpo ou o padrão da empresa); o gerente grava só na loja dele', () => {
    expect(lojaDoAjuste(quem('presidente'), null, LOJA_B)).toBe(LOJA_B);
    expect(lojaDoAjuste(quem('presidente'), LOJA_A, undefined)).toBeNull();
    // O gerente da A pede a B, ou o padrão da empresa: grava na A.
    expect(lojaDoAjuste(quem('gerente'), LOJA_A, LOJA_B)).toBe(LOJA_A);
    expect(lojaDoAjuste(quem('gerente'), LOJA_A, null)).toBe(LOJA_A);
    // A empresa de uma loja só (`atual` null): como antes.
    expect(lojaDoAjuste(quem('gerente'), null, LOJA_A)).toBe(LOJA_A);
    // Sem loja no cadastro: recusa.
    expect(() => lojaDoAjuste(quem('gerente'), NIL_UUID, LOJA_B)).toThrow(ForbiddenException);
  });
});
