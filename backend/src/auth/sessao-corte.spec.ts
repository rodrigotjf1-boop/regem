import { anotarCorte, emitidoAntesDoCorte, esquecerMemoriaDosCortes, sessaoCortada } from './sessao-corte';

// "Perdi o celular" (Mister v6, M6c, mig 473): a conferência do corte das sessões de uma pessoa, sem banco de verdade (o
// caminho com o Postgres, a guarda e o serviço está na suíte do Mister com Postgres).

const PESSOA = '77777777-7777-4777-8777-777777777777';
const agoraSeg = () => Math.floor(Date.now() / 1000);
/** Um banco de mentira que devolve o corte (ou nada) e conta as idas. */
function banco(desde: Date | null) {
  const b = { idas: 0, execute: async () => (b.idas++, { rows: desde ? [{ desde }] : [] }) };
  return b;
}

describe('o corte das sessões ("Perdi o celular")', () => {
  beforeEach(() => esquecerMemoriaDosCortes());

  it('segundo a segundo: o token do mesmo segundo do corte vale; o do segundo anterior, não; sem corte, nada cai', () => {
    const corte = Date.UTC(2026, 10, 20, 15, 0, 0, 700);
    const seg = Math.floor(corte / 1000);
    expect(emitidoAntesDoCorte(seg - 1, corte)).toBe(true);
    expect(emitidoAntesDoCorte(seg, corte)).toBe(false);
    expect(emitidoAntesDoCorte(seg + 1, corte)).toBe(false);
    expect(emitidoAntesDoCorte(seg - 1000, null)).toBe(false);
  });

  it('pelo banco: o token de antes cai e o de depois entra; a leitura vale 30 s (uma ida só)', async () => {
    const b = banco(new Date());
    expect(await sessaoCortada(b as any, { sub: PESSOA, iat: agoraSeg() - 60 })).toBe(true);
    expect(await sessaoCortada(b as any, { sub: PESSOA, iat: agoraSeg() + 2 })).toBe(false);
    expect(b.idas).toBe(1);
  });

  it('sem corte no banco, a sessão segue', async () => {
    expect(await sessaoCortada(banco(null) as any, { sub: PESSOA, iat: agoraSeg() - 60 })).toBe(false);
  });

  it('o corte feito NESTE processo vale na hora, mesmo com a leitura "sem corte" guardada de antes', async () => {
    const b = banco(null);
    expect(await sessaoCortada(b as any, { sub: PESSOA, iat: agoraSeg() - 60 })).toBe(false);
    anotarCorte(PESSOA, Date.now());
    expect(await sessaoCortada(b as any, { sub: PESSOA, iat: agoraSeg() - 60 })).toBe(true);
  });

  it('o banco atrás do que este processo já sabe não desce o corte (depois dos 30 s, na leitura nova)', async () => {
    const t0 = Date.now();
    const iat = Math.floor(t0 / 1000) - 60;
    anotarCorte(PESSOA, t0);
    const relogio = jest.spyOn(Date, 'now').mockReturnValue(t0 + 31_000);
    try {
      const b = banco(null); // a leitura do banco (sem o corte: atrás da gravação feita aqui)
      expect(await sessaoCortada(b as any, { sub: PESSOA, iat })).toBe(true);
      expect(b.idas).toBe(1);
    } finally {
      relogio.mockRestore();
    }
  });

  it('sem a tabela (o servidor da loja antes da atualização) ou com o banco fora: não derruba a sessão', async () => {
    const semTabela = { execute: async () => Promise.reject(Object.assign(new Error('relação não existe'), { code: '42P01' })) };
    expect(await sessaoCortada(semTabela as any, { sub: PESSOA, iat: agoraSeg() - 60 })).toBe(false);
    expect(await sessaoCortada(undefined, { sub: PESSOA, iat: agoraSeg() - 60 })).toBe(false);
  });

  it('token sem pessoa (o de suporte), sem iat ou com lixo nunca está cortado — e nem vai ao banco', async () => {
    const b = banco(new Date());
    for (const p of [{ sub: 'sup:tecnico', iat: agoraSeg() - 60 }, { sub: PESSOA }, { sub: PESSOA, iat: 'x' }, null, {}]) {
      expect(await sessaoCortada(b as any, p)).toBe(false);
    }
    expect(b.idas).toBe(0);
  });
});
