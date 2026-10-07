import { BadRequestException } from '@nestjs/common';
import { MOTIVOS_DESPERDICIO, exigirMotivo, normalizarMotivo } from './motivos';

// Motivo do desperdício é LISTA FECHADA: o que já se gravava e os jeitos comuns de escrever caem
// num motivo da lista; o resto é recusado (não vira motivo novo).
describe('motivos de desperdício', () => {
  it('a lista é a aprovada e cada item é a própria forma normalizada', () => {
    expect([...MOTIVOS_DESPERDICIO]).toEqual(['Validade', 'Preparo', 'Queda', 'Transporte', 'Outro']);
    for (const m of MOTIVOS_DESPERDICIO) expect(normalizarMotivo(m)).toBe(m);
  });

  it('reconhece caixa, acento, espaço e o que o sistema já gravava', () => {
    expect(normalizarMotivo('validade')).toBe('Validade'); // a perda por etiqueta gravava assim
    expect(normalizarMotivo('  PREPARO ')).toBe('Preparo');
    expect(normalizarMotivo('Validade vencida')).toBe('Validade');
    expect(normalizarMotivo('queimou')).toBe('Preparo');
    expect(normalizarMotivo('Quebra')).toBe('Queda');
    expect(normalizarMotivo('outros')).toBe('Outro');
  });

  it('texto fora da lista não vira motivo', () => {
    for (const t of ['forno', 'cliente devolveu', '', '   ', 'validade e queda']) expect([t, normalizarMotivo(t)]).toEqual([t, null]);
    expect(normalizarMotivo(undefined)).toBeNull();
    expect(normalizarMotivo(3)).toBeNull();
  });

  it('exigirMotivo devolve o da lista ou recusa com 400 mostrando as opções', () => {
    expect(exigirMotivo('queda')).toBe('Queda');
    expect(() => exigirMotivo('forno')).toThrow(BadRequestException);
    expect(() => exigirMotivo('forno')).toThrow(/Validade, Preparo, Queda, Transporte, Outro/);
  });
});
