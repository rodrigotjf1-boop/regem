import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { exigirBooleano } from './exigir';
import { mapPgError } from './errors/pg-error';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Guardas dos erros do registro interno (set/2026): corpo vazio que DESLIGAVA configurações e
// dado malformado que virava 500.
describe('exigirBooleano (campo liga/desliga obrigatório)', () => {
  it('aceita true/false (e "true"/"false")', () => {
    expect(exigirBooleano(true, 'x')).toBe(true);
    expect(exigirBooleano(false, 'x')).toBe(false);
    expect(exigirBooleano('true', 'x')).toBe(true);
    expect(exigirBooleano('false', 'x')).toBe(false);
  });
  it('ausente ou lixo → 400 com o nome do campo (antes: virava false em silêncio)', () => {
    for (const v of [undefined, null, '', 0, 1, 'sim', {}])
      expect(() => exigirBooleano(v, 'bloquear')).toThrow(BadRequestException);
    expect(() => exigirBooleano(undefined, 'bloquear')).toThrow(/bloquear/);
  });
});

describe('mapPgError: formato de entrada inválido vira 400 (antes: 500)', () => {
  it.each(['22P02', '22007', '22008', '22003', '22001'])('%s → 400', (code) => {
    const e = mapPgError({ code, message: 'x' } as any);
    expect(e?.getStatus()).toBe(400);
  });
});

describe('controllers não transformam campo AUSENTE em false', () => {
  const SRC = join(__dirname, '..');
  const arquivos = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.controller.ts') ? [p] : [];
    });
  it('nenhum `!!dto.campo` / `!!dto?.campo` em controller (use exigirBooleano; consentimento: === true)', () => {
    const ruins = arquivos(SRC)
      .filter((p) => /!!dto\??\.[a-zA-Z]+/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(SRC, p));
    expect(ruins).toEqual([]);
  });
});
