import { esquecerDigitando, pararDigitando, renovandoAgora, renovarDigitando, trocarRelogioDoDigitando } from './digitando-renovado';

// O "digitando…" renovado (26/11/2026): a Meta tira o indicador em 25 s e a resposta do robô leva mais que isso.
describe('o "digitando…" renovado enquanto o robô pensa', () => {
  let agora: number;
  beforeEach(() => {
    jest.useFakeTimers();
    agora = 1_800_000_000_000;
    trocarRelogioDoDigitando(() => agora);
  });
  afterEach(() => {
    esquecerDigitando();
    trocarRelogioDoDigitando(null);
    jest.useRealTimers();
  });
  const passar = async (ms: number) => {
    agora += ms;
    await jest.advanceTimersByTimeAsync(ms);
  };

  it('renova a cada 20 s até a resposta sair; depois de parar, não manda mais', async () => {
    const mostrar = jest.fn();
    renovarDigitando('t1', '5521999998888', mostrar);
    await passar(19_000);
    expect(mostrar).toHaveBeenCalledTimes(0);
    await passar(1_000);
    expect(mostrar).toHaveBeenCalledTimes(1);
    await passar(20_000);
    expect(mostrar).toHaveBeenCalledTimes(2);
    pararDigitando('t1', '+55 (21) 99999-8888'); // o mesmo telefone, escrito de outro jeito
    expect(renovandoAgora('t1', '5521999998888')).toBe(false);
    await passar(60_000);
    expect(mostrar).toHaveBeenCalledTimes(2);
  });

  it('o robô que não responde não deixa o "digitando" para sempre: para sozinho em 2,5 min', async () => {
    const mostrar = jest.fn();
    renovarDigitando('t1', '5521999998888', mostrar);
    await passar(150_000);
    const ate = mostrar.mock.calls.length;
    expect(ate).toBeLessThanOrEqual(7);
    expect(renovandoAgora('t1', '5521999998888')).toBe(false);
    await passar(60_000);
    expect(mostrar).toHaveBeenCalledTimes(ate);
  });

  it('uma conversa não mexe na outra; recomeçar não duplica; falha do indicador não derruba nada', async () => {
    const a = jest.fn();
    const b = jest.fn(() => {
      throw new Error('Meta fora');
    });
    renovarDigitando('t1', '5521999998888', a);
    renovarDigitando('t1', '5521999998888', a); // a mesma conversa de novo: um relógio só
    renovarDigitando('t2', '5521999998888', b);
    await passar(20_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    pararDigitando('t2', '5521999998888');
    expect(renovandoAgora('t1', '5521999998888')).toBe(true);
    // Sem empresa ou sem telefone: não começa.
    renovarDigitando('', '5521999998888', a);
    renovarDigitando('t3', '', a);
    expect(renovandoAgora('', '5521999998888')).toBe(false);
    expect(renovandoAgora('t3', '')).toBe(false);
  });
});
