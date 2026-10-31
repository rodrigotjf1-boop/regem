import { assinarConversa, lerConversa, VALIDADE_DA_CONVERSA_MS } from './conversa-do-robo';

// A ficha da conversa (Fase 5, F3): só o Regem assina; a loja e o telefone vêm dela; vence em 12 h; mexeu, não vale.
describe('ficha da conversa do robô', () => {
  const antes = process.env.BOT_RESOLVER_SECRET;
  const T = '11111111-2222-3333-4444-555555555555';
  beforeEach(() => {
    process.env.BOT_RESOLVER_SECRET = 'senha-do-robo';
  });
  afterAll(() => {
    if (antes === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes;
  });

  it('assina e lê: a loja, o telefone e a chave (com/sem 55 e nono dígito)', () => {
    const f = assinarConversa(T, '552187654321')!;
    expect(lerConversa(f)).toEqual({ tenantId: T, telefone: '552187654321', chave: '21987654321' });
  });

  it('vence em 12 h', () => {
    const agora = Date.now();
    const f = assinarConversa(T, '5521987654321', agora)!;
    expect(lerConversa(f, agora + VALIDADE_DA_CONVERSA_MS - 1000)).not.toBeNull();
    expect(lerConversa(f, agora + VALIDADE_DA_CONVERSA_MS + 1)).toBeNull();
  });

  it('ficha mexida (outro telefone no corpo, assinatura trocada, pedaço a mais) não vale', () => {
    const f = assinarConversa(T, '5521987654321')!;
    const [corpo, assinatura] = f.split('.');
    const outroCorpo = Buffer.from(JSON.stringify({ t: T, f: '5521911112222', e: Date.now() + 60_000 })).toString('base64url');
    expect(lerConversa(`${outroCorpo}.${assinatura}`)).toBeNull();
    expect(lerConversa(`${corpo}.${assinatura.slice(0, -2)}xx`)).toBeNull();
    expect(lerConversa(`${f}.extra`)).toBeNull();
    expect(lerConversa('')).toBeNull();
    expect(lerConversa(undefined)).toBeNull();
  });

  it('com outra senha do robô a ficha não confere; sem senha, nada se assina nem se lê', () => {
    const f = assinarConversa(T, '5521987654321')!;
    process.env.BOT_RESOLVER_SECRET = 'outra';
    expect(lerConversa(f)).toBeNull();
    delete process.env.BOT_RESOLVER_SECRET;
    expect(assinarConversa(T, '5521987654321')).toBeNull();
    expect(lerConversa(f)).toBeNull();
  });
});
