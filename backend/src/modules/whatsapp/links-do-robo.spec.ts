import { hostDe, linkDoCardapioDaLoja, soLinksDaLoja } from './links-do-robo';

// Teste dos modelos de 29/10/2026: o Gemini mandou o cliente para anota.ai, Goomer e Zaply (o endereço da loja nesses
// sistemas, tirado da memória dele). Toda resposta do robô sai só com o link do cardápio da loja (ou o site dela).
const LOJA = 'https://app.dmsregem.com/c/525ad7a2c822';

describe('só o link da loja na resposta do robô', () => {
  const antes = process.env.CARDAPIO_PUBLIC_URL;
  afterEach(() => {
    if (antes === undefined) delete process.env.CARDAPIO_PUBLIC_URL;
    else process.env.CARDAPIO_PUBLIC_URL = antes;
  });

  it('o link do cardápio sai da mesma base do cardápio online', () => {
    process.env.CARDAPIO_PUBLIC_URL = 'https://app.dmsregem.com/';
    expect(linkDoCardapioDaLoja('abc')).toBe('https://app.dmsregem.com/c/abc');
    expect(hostDe('https://www.App.DmsRegem.com/c/x')).toBe('app.dmsregem.com');
    expect(hostDe('misterburguer.com.br')).toBe('misterburguer.com.br');
    expect(hostDe('')).toBeNull();
  });

  it('link de outro sistema vira o link do cardápio (as 4 respostas do teste)', () => {
    const casos = [
      'Você pode consultar o valor exato para Copacabana e ver nosso cardápio no link https://misterburguer.goomer.app.',
      'Acesse https://cardapio.zaply.com.br/misterburguersteakhouse para montar o seu pedido.',
      'As opções de pagamento você confere no cardápio online. https://sistema.anota.ai/cardapio/misterburguersteakhouse',
      'Confira as bebidas no cardápio online: https://anota.ai/misterburguersteakhouse OPCOES: Ver bebidas',
    ];
    for (const c of casos) {
      const r = soLinksDaLoja(c, LOJA);
      expect(r.trocados).toBe(1);
      expect(r.texto).toContain(LOJA);
      expect(r.texto).not.toMatch(/goomer|zaply|anota\.ai/);
    }
    expect(soLinksDaLoja(casos[0], LOJA).texto).toBe(`Você pode consultar o valor exato para Copacabana e ver nosso cardápio no link ${LOJA}.`);
  });

  it('o link certo, o personalizado e o site da loja passam sem mexer', () => {
    const t = `Monte seu pedido em ${LOJA}?cl=abc123 ou veja ${LOJA}. Nosso site: https://misterburguer.com.br/promo`;
    expect(soLinksDaLoja(t, LOJA, ['misterburguer.com.br'])).toEqual({ texto: t, trocados: 0 });
    expect(soLinksDaLoja('Siga a gente: https://instagram.com/mister', LOJA, ['instagram.com']).trocados).toBe(0);
    expect(soLinksDaLoja('sem link nenhum', LOJA)).toEqual({ texto: 'sem link nenhum', trocados: 0 });
  });

  it('com o link certo já na mensagem, o de fora sai sem repetir; dois de fora viram um só', () => {
    expect(soLinksDaLoja(`Cardápio: ${LOJA} ou https://anota.ai/mister .`, LOJA).texto).toBe(`Cardápio: ${LOJA} ou.`);
    const r = soLinksDaLoja('Veja https://anota.ai/x e https://goomer.app/y', LOJA);
    expect(r).toEqual({ texto: `Veja ${LOJA} e`, trocados: 2 });
    expect(soLinksDaLoja('Veja www.goomer.app/mister', LOJA).texto).toBe(`Veja ${LOJA}`);
  });
});
