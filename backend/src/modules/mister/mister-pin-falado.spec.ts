import { pinFaladoLigado, pinNoTexto } from './mister-pin-falado';

// Versão 10, C5: falar o PIN — o PIN tirado da transcrição (puro). O caminho inteiro, com o Postgres, está em
// `mister-pg.teste-spec.ts`.

describe('C5 · o PIN falado', () => {
  it('nasce desligado (MISTER_PIN_FALADO=1 liga)', () => {
    const antes = process.env.MISTER_PIN_FALADO;
    try {
      delete process.env.MISTER_PIN_FALADO;
      expect(pinFaladoLigado()).toBe(false);
      process.env.MISTER_PIN_FALADO = '1';
      expect(pinFaladoLigado()).toBe(true);
    } finally {
      if (antes === undefined) delete process.env.MISTER_PIN_FALADO;
      else process.env.MISTER_PIN_FALADO = antes;
    }
  });

  it('os números por extenso, os dígitos e os dois juntos, na ordem; o "meia" é o 6; acento e pontuação não atrapalham', () => {
    expect(pinNoTexto('dois cinco oito zero')).toBe('2580');
    expect(pinNoTexto('Dois, cinco, oito, zero.')).toBe('2580');
    expect(pinNoTexto('2 5 8 0')).toBe('2580');
    expect(pinNoTexto('2580')).toBe('2580');
    expect(pinNoTexto('três meia um nove')).toBe('3619');
    expect(pinNoTexto('o meu PIN é um dois três quatro')).toBe('1234');
    expect(pinNoTexto('uma duas três quatro cinco seis')).toBe('123456');
    expect(pinNoTexto('25 oito 0')).toBe('2580');
  });

  it('fora de 4 a 6 dígitos, nada (o Mister diz que não entendeu — não conta como PIN errado)', () => {
    expect(pinNoTexto('bom dia')).toBeNull();
    expect(pinNoTexto('um dois três')).toBeNull();
    expect(pinNoTexto('um dois três quatro cinco seis sete')).toBeNull();
    expect(pinNoTexto('')).toBeNull();
    expect(pinNoTexto(null)).toBeNull();
  });
});
