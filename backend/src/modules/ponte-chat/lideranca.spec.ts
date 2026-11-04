import { quemResponde, VIVA_POR_MS, type PonteCandidata } from './lideranca';

// A regra ÚNICA de quem responde pelo chat de um canal numa loja (mig 366): só uma ponte envia.
describe('quem responde pelo canal', () => {
  const agora = 1_800_000_000_000;
  const ponte = (id: string, o: Partial<PonteCandidata> = {}): PonteCandidata => ({
    id,
    papel: 'auto',
    vistoEm: agora - 10_000,
    logada: true,
    criadaEm: agora - 86_400_000,
    ...o,
  });

  it('ninguém viva e logada: ninguém responde', () => {
    expect(quemResponde([], agora)).toBeNull();
    expect(quemResponde([ponte('a', { logada: false })], agora)).toBeNull();
    expect(quemResponde([ponte('a', { vistoEm: agora - VIVA_POR_MS - 1 })], agora)).toBeNull();
  });

  it('a principal dos ajustes vence; depois a automática; a reserva só sem as outras', () => {
    const lista = [ponte('r', { papel: 'reserva', criadaEm: 1 }), ponte('a', { papel: 'auto' }), ponte('p', { papel: 'principal' })];
    expect(quemResponde(lista, agora)).toBe('p');
    expect(quemResponde(lista.filter((x) => x.id !== 'p'), agora)).toBe('a');
    expect(quemResponde(lista.filter((x) => x.id === 'r'), agora)).toBe('r');
  });

  it('principal sem sinal ou fora da plataforma: a próxima assume', () => {
    const lista = [ponte('p', { papel: 'principal', vistoEm: agora - VIVA_POR_MS - 5_000 }), ponte('r', { papel: 'reserva' })];
    expect(quemResponde(lista, agora)).toBe('r');
    expect(quemResponde([ponte('p', { papel: 'principal', logada: false }), ponte('r', { papel: 'reserva' })], agora)).toBe('r');
  });

  it('empate: a pareada primeiro, sempre a mesma (não troca de PC a cada sinal)', () => {
    const velha = ponte('z', { criadaEm: agora - 9_000_000, vistoEm: agora - 100_000 });
    const nova = ponte('a', { criadaEm: agora - 1_000, vistoEm: agora - 1 });
    expect(quemResponde([nova, velha], agora)).toBe('z');
    expect(quemResponde([velha, nova], agora)).toBe('z');
    // mesma data de cadastro: o id decide (estável)
    expect(quemResponde([ponte('b', { criadaEm: 5 }), ponte('a', { criadaEm: 5 })], agora)).toBe('a');
  });
});
