import { repetirNoImpasse } from './repetir-no-impasse';

// ERR-481: a transação idempotente que o Postgres derrubou por impasse repete inteira; qualquer outro erro sobe na hora.
const erro = (code: string) => Object.assign(new Error(`pg ${code}`), { code });

describe('repetirNoImpasse', () => {
  it('impasse (40P01) e serialização (40001) repetem; a 2ª tentativa vale', async () => {
    for (const code of ['40P01', '40001']) {
      let chamadas = 0;
      const repetidas: number[] = [];
      const r = await repetirNoImpasse(
        async () => {
          chamadas++;
          if (chamadas === 1) throw erro(code);
          return 'ok';
        },
        { pausaMs: 1, aoRepetir: (t) => repetidas.push(t) },
      );
      expect([r, chamadas, repetidas]).toEqual(['ok', 2, [1]]);
    }
  });

  it('outro erro (chave repetida, falta de tabela) sobe na hora, sem repetir', async () => {
    for (const code of ['23505', '42P01', 'ECONNRESET']) {
      let chamadas = 0;
      await expect(
        repetirNoImpasse(
          async () => {
            chamadas++;
            throw erro(code);
          },
          { pausaMs: 1 },
        ),
      ).rejects.toMatchObject({ code });
      expect(chamadas).toBe(1);
    }
  });

  it('três quedas seguidas: a terceira sobe como veio (nunca repete para sempre)', async () => {
    let chamadas = 0;
    await expect(
      repetirNoImpasse(
        async () => {
          chamadas++;
          throw erro('40P01');
        },
        { pausaMs: 1 },
      ),
    ).rejects.toMatchObject({ code: '40P01' });
    expect(chamadas).toBe(3);
  });
});
