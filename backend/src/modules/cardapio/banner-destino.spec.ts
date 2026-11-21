import { bannerNoPeriodo, lerDestinoDoBanner, lerPeriodoDoBanner } from './banner-destino';

const ID = '11111111-1111-4111-8111-111111111111';

describe('o destino do banner (B3)', () => {
  it('os destinos de antes seguem como estão', () => {
    expect(lerDestinoDoBanner(`item:${ID}`, 1)).toBe(`item:${ID}`);
    expect(lerDestinoDoBanner(`category:${ID.toUpperCase()}`, 1)).toBe(`category:${ID}`);
    expect(lerDestinoDoBanner('coupon:sextou10', 1)).toBe('coupon:SEXTOU10');
    expect(lerDestinoDoBanner('https://exemplo.com.br/promo?x=1', 1)).toBe('https://exemplo.com.br/promo?x=1');
  });
  it('os destinos novos: vagas, o Clube e as páginas do Regem; vazio = nada', () => {
    for (const d of ['vagas', 'clube:premios', 'clube:regras', 'regem:avaliar', 'regem:regras']) expect(lerDestinoDoBanner(d, 1)).toBe(d);
    expect(lerDestinoDoBanner('', 1)).toBeNull();
    expect(lerDestinoDoBanner(undefined, 1)).toBeNull();
    expect(lerDestinoDoBanner('   ', 1)).toBeNull();
  });
  it('recusa o que o cardápio não sabe abrir, com o número do banner', () => {
    expect(() => lerDestinoDoBanner('http://exemplo.com', 2)).toThrow('Banner 2: o link externo precisa começar com https://.');
    expect(() => lerDestinoDoBanner('javascript:alert(1)', 1)).toThrow('Banner 1: escolha para onde o banner leva de novo.');
    expect(() => lerDestinoDoBanner('item:nao-e-id', 1)).toThrow('escolha o produto de novo');
    expect(() => lerDestinoDoBanner('category:', 1)).toThrow('escolha a categoria de novo');
    expect(() => lerDestinoDoBanner('coupon:com espaço', 3)).toThrow('Banner 3: escolha o cupom de novo.');
    expect(() => lerDestinoDoBanner('clube:outra', 1)).toThrow('escolha para onde o banner leva de novo');
    expect(() => lerDestinoDoBanner(`https://exemplo.com/${'a'.repeat(600)}`, 1)).toThrow('passa de 500 letras');
  });
});

describe('o período do banner (B3, mig 482)', () => {
  it('lê de e até (vazio = sem limite) e recusa o até antes do de', () => {
    expect(lerPeriodoDoBanner('', null, 1)).toEqual({ de: null, ate: null });
    expect(lerPeriodoDoBanner('2026-11-20', '2026-11-30', 1)).toEqual({ de: '2026-11-20', ate: '2026-11-30' });
    expect(lerPeriodoDoBanner(undefined, '2026-12-01', 1)).toEqual({ de: null, ate: '2026-12-01' });
    expect(() => lerPeriodoDoBanner('2026-11-30', '2026-11-20', 2)).toThrow('Banner 2: "até" vem antes de "aparece de".');
    expect(() => lerPeriodoDoBanner('30/11/2026', null, 1)).toThrow('a data "aparece de" não é válida');
  });
  it('aparece só dentro do período (os dois dias contam)', () => {
    const b = { apareceDe: '2026-11-20', apareceAte: '2026-11-30' };
    expect(bannerNoPeriodo(b, '2026-11-19')).toBe(false);
    expect(bannerNoPeriodo(b, '2026-11-20')).toBe(true);
    expect(bannerNoPeriodo(b, '2026-11-30')).toBe(true);
    expect(bannerNoPeriodo(b, '2026-12-01')).toBe(false);
    expect(bannerNoPeriodo({}, '2026-12-01')).toBe(true);
    expect(bannerNoPeriodo({ apareceAte: '2026-11-30' }, '2020-01-01')).toBe(true);
  });
});
