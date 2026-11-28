import { corposDaConferencia, hashDoRemetente } from './mister-aparelho';

describe('Mister — o hash do aparelho (M6b, A1.0)', () => {
  it('pega o hash do contato de quem mandou', () => {
    const contatos = [
      { wa_id: '5521900000001', identity_key_hash: 'aaa111' },
      { wa_id: '5521900000002', identity_key_hash: 'bbb222' },
    ];
    expect(hashDoRemetente(contatos, '5521900000002')).toBe('bbb222');
  });

  // ERR-648 (rodada 7, MIS-A-12): antes, o contato único valia mesmo com outro `wa_id` (ou sem ele).
  it('ERR-648: só vale o contato com o wa_id de quem mandou — o contato único de outro remetente (ou sem wa_id) não', () => {
    expect(hashDoRemetente([{ identity_key_hash: 'ccc333' }], '5521900000003')).toBeNull();
    expect(hashDoRemetente([{ wa_id: '5521900000009', identity_key_hash: 'ccc333' }], '5521900000003')).toBeNull();
    expect(hashDoRemetente([{ wa_id: '5521900000003', identity_key_hash: 'ccc333' }], '5521900000003')).toBe('ccc333');
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
