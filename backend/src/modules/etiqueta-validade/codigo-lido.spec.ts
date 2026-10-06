import { candidatosCodigoLido, escolherPorCodigoLido, verificadorEan13 } from './codigo-lido';

// O texto que o LEITOR entrega × o código gravado na etiqueta. Os valores vêm de uma
// leitura real (leitor de mesa 2D em 06/10/2026): a etiqueta 866855088746 impressa em
// EAN-13 voltou do leitor como 8668550887469.
describe('código lido da etiqueta de validade', () => {
  it('calcula o verificador EAN-13 (conferido com um produto de prateleira)', () => {
    expect(verificadorEan13('789895961202')).toBe('2'); // 7898959612022
    expect(verificadorEan13('866855088746')).toBe('9');
  });

  it('Code128 e QR: o leitor devolve os 12 dígitos gravados', () => {
    expect(candidatosCodigoLido('866855088746')[0]).toBe('866855088746');
  });

  it('EAN-13: 13 dígitos com verificador certo → procura também pelos 12 gravados', () => {
    expect(candidatosCodigoLido('8668550887469')).toEqual(['8668550887469', '866855088746']);
  });

  it('13 dígitos com verificador ERRADO não viram outro código', () => {
    expect(candidatosCodigoLido('8668550887460')).toEqual(['8668550887460']);
  });

  it('código que começa com zero lido como UPC-A (sem o zero, com o verificador)', () => {
    const gravado = '012345678905';
    const upcA = gravado.slice(1) + verificadorEan13(gravado); // o que o leitor entrega
    expect(upcA).toHaveLength(12);
    expect(candidatosCodigoLido(upcA)).toEqual([upcA, gravado]);
  });

  it('tira espaço e quebra de linha do leitor; vazio não procura nada', () => {
    expect(candidatosCodigoLido('  866855088746\r\n')[0]).toBe('866855088746');
    expect(candidatosCodigoLido('   ')).toEqual([]);
    expect(candidatosCodigoLido(undefined)).toEqual([]);
    expect(candidatosCodigoLido(null)).toEqual([]);
  });

  it('texto que não é código nosso passa como veio (a busca responde "não encontrado")', () => {
    expect(candidatosCodigoLido('ABC-123')).toEqual(['ABC-123']);
  });

  it('entre as achadas, o texto exato vence o derivado', () => {
    const exata = { codigo: '8668550887469', id: 'exata' };
    const derivada = { codigo: '866855088746', id: 'derivada' };
    const candidatos = candidatosCodigoLido('8668550887469');
    expect(escolherPorCodigoLido(candidatos, [derivada, exata])?.id).toBe('exata');
    expect(escolherPorCodigoLido(candidatos, [derivada])?.id).toBe('derivada');
    expect(escolherPorCodigoLido(candidatos, [])).toBeNull();
  });
});
