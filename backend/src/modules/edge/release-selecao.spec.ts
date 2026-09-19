import { randomUUID } from 'node:crypto';
import { compararVersao, elegivel, escolherRelease, sorteioDaLoja, versaoRecolhida, ReleaseLinha } from './release-selecao';

// Distribuição ESCALONADA dos releases do servidor local (ERR-051): antes o último publicado ia
// para todas as lojas de uma vez, sem piloto, pausa ou recolhimento.
const rel = (versao: string, o: Partial<ReleaseLinha> = {}): ReleaseLinha => ({
  versao,
  url: `https://x/regem-edge-${versao}.zip`,
  sha256: 'a'.repeat(64),
  assinatura: 's',
  notas: null,
  publicado_em: '2026-09-01T00:00:00Z',
  ...o,
});

describe('distribuição escalonada dos releases do servidor local', () => {
  it('compara versão por número, não por texto', () => {
    expect(compararVersao('1.30.0', '1.29.3')).toBe(1);
    expect(compararVersao('1.9.0', '1.10.0')).toBe(-1);
    expect(compararVersao('1.30', '1.30.0')).toBe(0);
  });

  it('sorteio da loja é estável e fica entre 0 e 99', () => {
    const t = randomUUID();
    const a = sorteioDaLoja(t, '1.30.0');
    expect(sorteioDaLoja(t, '1.30.0')).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
  });

  it('percentual entrega a fatia certa — e subir o percentual mantém quem já recebeu', () => {
    const lojas = Array.from({ length: 4000 }, () => randomUUID());
    const r10 = rel('1.30.0', { percentual: 10 });
    const r30 = rel('1.30.0', { percentual: 30 });
    const em10 = lojas.filter((t) => elegivel(r10, t));
    const em30 = lojas.filter((t) => elegivel(r30, t));
    expect(em10.length / lojas.length).toBeGreaterThan(0.07);
    expect(em10.length / lojas.length).toBeLessThan(0.13);
    expect(em30.length / lojas.length).toBeGreaterThan(0.26);
    expect(em30.length / lojas.length).toBeLessThan(0.34);
    const set30 = new Set(em30);
    expect(em10.every((t) => set30.has(t))).toBe(true);
  });

  it('loja piloto recebe mesmo com 0%; as outras não', () => {
    const piloto = randomUUID();
    const r = rel('1.30.0', { percentual: 0, lojas_piloto: [piloto] });
    expect(elegivel(r, piloto)).toBe(true);
    expect(elegivel(r, randomUUID())).toBe(false);
  });

  it('pausado e recolhido não são oferecidos a ninguém (nem ao piloto)', () => {
    const piloto = randomUUID();
    expect(elegivel(rel('1.30.0', { pausado: true, lojas_piloto: [piloto] }), piloto)).toBe(false);
    expect(elegivel(rel('1.30.0', { recolhido: true }), piloto)).toBe(false);
  });

  it('sem identificação (servidor na 1.29.x, sem token) só vê release em 100%', () => {
    expect(elegivel(rel('1.30.0', { percentual: 50 }), null)).toBe(false);
    expect(elegivel(rel('1.30.0', { percentual: 100 }), null)).toBe(true);
    expect(elegivel(rel('1.30.0'), null)).toBe(true); // colunas ausentes (antes da mig 270) = 100%
  });

  it('vence a MAIOR versão elegível, não o último publicado', () => {
    const t = randomUUID();
    const lista = [
      rel('1.29.3', { publicado_em: '2026-09-10T00:00:00Z' }), // republicado depois
      rel('1.30.0', { publicado_em: '2026-09-05T00:00:00Z' }),
      rel('1.31.0', { publicado_em: '2026-09-11T00:00:00Z', percentual: 0 }), // ainda sem fatia
    ];
    expect(escolherRelease(lista, t)?.versao).toBe('1.30.0');
  });

  it('recolher a versão nova faz a loja receber a anterior liberada; nada elegível = null', () => {
    const t = randomUUID();
    expect(escolherRelease([rel('1.30.0', { recolhido: true }), rel('1.29.3')], t)?.versao).toBe('1.29.3');
    expect(escolherRelease([rel('1.30.0', { pausado: true })], t)).toBeNull();
  });

  it('avisa quando a versão que a loja roda foi recolhida', () => {
    const lista = [rel('1.30.0', { recolhido: true }), rel('1.29.3')];
    expect(versaoRecolhida(lista, '1.30.0')).toBe(true);
    expect(versaoRecolhida(lista, '1.29.3')).toBe(false);
    expect(versaoRecolhida(lista, undefined)).toBe(false);
  });
});
