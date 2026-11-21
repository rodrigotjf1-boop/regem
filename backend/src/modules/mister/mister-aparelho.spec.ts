import { corposDaConferencia, hashDoRemetente } from './mister-aparelho';

describe('Mister — o hash do aparelho (M6b, A1.0)', () => {
  it('pega o hash do contato de quem mandou', () => {
    const contatos = [
      { wa_id: '5521900000001', identity_key_hash: 'aaa111' },
      { wa_id: '5521900000002', identity_key_hash: 'bbb222' },
    ];
    expect(hashDoRemetente(contatos, '5521900000002')).toBe('bbb222');
  });

  it('com um contato só, é ele; com vários e nenhum igual, não adivinha', () => {
    expect(hashDoRemetente([{ identity_key_hash: 'ccc333' }], '5521900000003')).toBe('ccc333');
    expect(hashDoRemetente([{ wa_id: '1', identity_key_hash: 'a' }, { wa_id: '2', identity_key_hash: 'b' }], '3')).toBeNull();
  });

  it('sem o recurso ligado (sem o campo), ou com valor estranho, não há hash', () => {
    expect(hashDoRemetente([{ wa_id: '5521900000001' }], '5521900000001')).toBeNull();
    expect(hashDoRemetente(undefined, '5521900000001')).toBeNull();
    expect(hashDoRemetente([], '5521900000001')).toBeNull();
    expect(hashDoRemetente([{ wa_id: '1', identity_key_hash: 123 }], '1')).toBeNull();
    expect(hashDoRemetente([{ wa_id: '1', identity_key_hash: 'tem espaço; drop' }], '1')).toBeNull();
    expect(hashDoRemetente([{ wa_id: '1', identity_key_hash: 'x'.repeat(201) }], '1')).toBeNull();
  });

  it('as duas formas do corpo da doc, a da página "Phone Numbers" primeiro', () => {
    expect(corposDaConferencia(true)).toEqual([
      { user_identity_change: { enable_identity_key_check: true } },
      { user_identity_change: { enabled: true } },
    ]);
    expect(corposDaConferencia(false)[0]).toEqual({ user_identity_change: { enable_identity_key_check: false } });
  });
});
