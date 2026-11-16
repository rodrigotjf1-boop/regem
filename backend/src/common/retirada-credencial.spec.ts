import {
  anunciarRetiradaNaResposta,
  DIAS_MINIMOS_ATE_O_SUNSET,
  esquecerRetiradaLida,
  lerRetiradaDaCredencialAntiga,
  retiradaDaCredencialAntiga,
} from './retirada-credencial';

// O anúncio da retirada das credenciais antigas (Hub DMS F6, plano "Fim das portas antigas", P-1 e P-3): os cabeçalhos
// do Padrão DMS §12 (`Deprecation` pela RFC 9745, `Sunset` pela RFC 8594), lidos do ambiente e desligados sem ele.

describe('anúncio da retirada da credencial antiga (Deprecation + Sunset)', () => {
  afterEach(() => {
    delete process.env.INTEGRACAO_ANTIGA_ANUNCIO;
    delete process.env.INTEGRACAO_ANTIGA_SUNSET;
    delete process.env.INTEGRACAO_ANTIGA_LINK;
    esquecerRetiradaLida();
  });

  it('sem o dia do anúncio: desligado, sem motivo (nasce desligado)', () => {
    expect(lerRetiradaDaCredencialAntiga({})).toEqual({ ligada: false, motivo: null });
    expect(lerRetiradaDaCredencialAntiga({ INTEGRACAO_ANTIGA_ANUNCIO: '  ' })).toEqual({ ligada: false, motivo: null });
  });

  it('só o dia do anúncio: Sunset = anúncio + 90 dias, em data HTTP; Deprecation em segundos (@epoch)', () => {
    const r = lerRetiradaDaCredencialAntiga({ INTEGRACAO_ANTIGA_ANUNCIO: '2026-11-17' });
    expect(DIAS_MINIMOS_ATE_O_SUNSET).toBe(90);
    expect(r).toMatchObject({ ligada: true });
    if (!r.ligada) throw new Error('deveria estar ligada');
    expect(r.anuncio.toISOString()).toBe('2026-11-17T00:00:00.000Z');
    expect(r.sunset.toISOString()).toBe('2027-02-15T00:00:00.000Z');
    expect(r.cabecalhos).toEqual({ Deprecation: '@1794873600', Sunset: 'Mon, 15 Feb 2027 00:00:00 GMT' });
  });

  it('Sunset vazio no painel = o padrão (V58); Sunset com mais de 90 dias vale; o Link só https', () => {
    const vazio = lerRetiradaDaCredencialAntiga({ INTEGRACAO_ANTIGA_ANUNCIO: '2026-11-17', INTEGRACAO_ANTIGA_SUNSET: '' });
    expect(vazio.ligada && vazio.cabecalhos.Sunset).toBe('Mon, 15 Feb 2027 00:00:00 GMT');
    const longe = lerRetiradaDaCredencialAntiga({
      INTEGRACAO_ANTIGA_ANUNCIO: '2026-11-17',
      INTEGRACAO_ANTIGA_SUNSET: '2027-03-01',
      INTEGRACAO_ANTIGA_LINK: 'https://hub.dmstecnologias.com/mudancas',
    });
    expect(longe.ligada && longe.cabecalhos).toEqual({
      Deprecation: '@1794873600',
      Sunset: 'Mon, 01 Mar 2027 00:00:00 GMT',
      Link: '<https://hub.dmstecnologias.com/mudancas>; rel="deprecation"',
    });
  });

  it('configuração torta não liga (anunciar errado é pior que não anunciar), com o motivo', () => {
    const casos: Array<[Record<string, string>, RegExp]> = [
      [{ INTEGRACAO_ANTIGA_ANUNCIO: '17/11/2026' }, /ANUNCIO precisa ser uma data/],
      [{ INTEGRACAO_ANTIGA_ANUNCIO: '2026-02-30' }, /ANUNCIO precisa ser uma data/],
      [{ INTEGRACAO_ANTIGA_ANUNCIO: '2026-11-17', INTEGRACAO_ANTIGA_SUNSET: 'amanhã' }, /SUNSET precisa ser uma data/],
      [{ INTEGRACAO_ANTIGA_ANUNCIO: '2026-11-17', INTEGRACAO_ANTIGA_SUNSET: '2027-02-14' }, /a 89 dias do anúncio/],
      [{ INTEGRACAO_ANTIGA_ANUNCIO: '2026-11-17', INTEGRACAO_ANTIGA_SUNSET: '2026-11-01' }, /a -16 dias/],
      [{ INTEGRACAO_ANTIGA_ANUNCIO: '2026-11-17', INTEGRACAO_ANTIGA_LINK: 'http://hub.dmstecnologias.com/x' }, /LINK precisa ser/],
      [{ INTEGRACAO_ANTIGA_ANUNCIO: '2026-11-17', INTEGRACAO_ANTIGA_LINK: 'https://a:b@hub.dmstecnologias.com/' }, /LINK precisa ser/],
    ];
    for (const [env, motivo] of casos) {
      const r = lerRetiradaDaCredencialAntiga(env);
      expect([env, r.ligada]).toEqual([env, false]);
      expect(!r.ligada && r.motivo).toMatch(motivo);
    }
  });

  it('a resposta recebe os cabeçalhos só quando ligado; sem setHeader (ou sem resposta), nada quebra', () => {
    const cab: Record<string, string> = {};
    const res = { setHeader: (n: string, v: string) => (cab[n] = v) };
    anunciarRetiradaNaResposta(res);
    expect(cab).toEqual({});

    process.env.INTEGRACAO_ANTIGA_ANUNCIO = '2026-11-17';
    anunciarRetiradaNaResposta(res);
    expect(cab).toEqual({ Deprecation: '@1794873600', Sunset: 'Mon, 15 Feb 2027 00:00:00 GMT' });
    expect(() => anunciarRetiradaNaResposta(undefined)).not.toThrow();
    expect(() => anunciarRetiradaNaResposta({})).not.toThrow();
  });

  it('a leitura se refaz quando o ambiente muda (o painel troca a data sem reiniciar o teste)', () => {
    process.env.INTEGRACAO_ANTIGA_ANUNCIO = '2026-11-17';
    expect(retiradaDaCredencialAntiga().ligada).toBe(true);
    process.env.INTEGRACAO_ANTIGA_SUNSET = '2026-12-01';
    expect(retiradaDaCredencialAntiga().ligada).toBe(false);
    delete process.env.INTEGRACAO_ANTIGA_SUNSET;
    expect(retiradaDaCredencialAntiga().ligada).toBe(true);
  });
});
