import { serieDaSenha } from './serie-da-senha';

describe('serieDaSenha (R6)', () => {
  it('totem sai na série do BALCÃO e reaproveita a senha impressa', () => {
    expect(serieDaSenha('totem', '12')).toEqual({ senhaPrefixo: 'B', senhaReservada: 12 });
    expect(serieDaSenha('TOTEM', '7')).toEqual({ senhaPrefixo: 'B', senhaReservada: 7 });
  });

  it('totem sem senha utilizável tira uma nova, mas ainda na série do balcão', () => {
    for (const d of [null, undefined, '', 'abc', '0', '-3']) {
      expect(serieDaSenha('totem', d as any)).toEqual({
        senhaPrefixo: 'B',
        senhaReservada: null,
      });
    }
  });

  it('os demais canais não mudam de série (seguem no padrão, delivery)', () => {
    for (const canal of ['ifood', 'cardapio', '99food', 'anotaai', null, undefined]) {
      expect(serieDaSenha(canal as any, '12')).toEqual({});
    }
  });
});
