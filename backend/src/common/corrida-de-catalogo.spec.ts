import { ehCorridaDeCatalogo, repetirNaCorridaDeCatalogo } from './corrida-de-catalogo';

describe('corrida de catálogo nas specs (ERR-194)', () => {
  const corrida = () => new Error('could not open relation with OID 21779');

  it('reconhece só o erro da corrida', () => {
    expect(ehCorridaDeCatalogo(corrida())).toBe(true);
    expect(ehCorridaDeCatalogo(new Error('relation "cupom" does not exist'))).toBe(false);
    expect(ehCorridaDeCatalogo(undefined)).toBe(false);
  });

  it('roda de novo quando a corrida acontece e devolve o resultado da vez que deu certo', async () => {
    let vezes = 0;
    const r = await repetirNaCorridaDeCatalogo(async () => {
      vezes++;
      if (vezes < 3) throw corrida();
      return 'ok';
    }, 4, 1);
    expect(r).toBe('ok');
    expect(vezes).toBe(3);
  });

  it('qualquer outro erro sobe na primeira vez', async () => {
    let vezes = 0;
    await expect(
      repetirNaCorridaDeCatalogo(async () => {
        vezes++;
        throw new Error('syntax error at or near "alter"');
      }, 4, 1),
    ).rejects.toThrow('syntax error');
    expect(vezes).toBe(1);
  });

  it('desiste depois das tentativas e sobe o erro da corrida', async () => {
    let vezes = 0;
    await expect(
      repetirNaCorridaDeCatalogo(async () => {
        vezes++;
        throw corrida();
      }, 3, 1),
    ).rejects.toThrow('could not open relation with OID');
    expect(vezes).toBe(3);
  });
});
