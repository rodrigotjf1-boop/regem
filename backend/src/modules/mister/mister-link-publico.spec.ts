import {
  TETO_DE_LINKS_VIVOS,
  TEXTOS_DO_LINK_PUBLICO,
  VALIDADE_DO_LINK_DIAS,
  diaMesDe,
  ehCodigoPublico,
  ehPlanoDoRelatorio,
  enderecoDoLinkPublico,
  linhaDoLinkNaConversa,
  planoTemVenda,
  venceEm,
} from './mister-link-publico';
import type { PlanoDoPdfDoInsumo } from './relatorio-insumo-pdf';

// M3c — o link para encaminhar a quem não tem usuário (mig 443). As regras puras: o código, o endereço, a linha da
// conversa e a forma do que sai pela porta pública.

const plano = (): PlanoDoPdfDoInsumo => ({
  cabecalho: 'Burger da Praça · Loja Centro',
  gerado: 'Gerado em 18/11 às 21:40, a pedido de Ana Souza',
  titulo: 'Carne 56 g · 18/11, até 21:40',
  numeros: [
    { valor: '8 unidades', rotulo: 'Loja Centro' },
    { valor: '448 g', rotulo: 'pela conversão do cadastro' },
  ],
  grafico: {
    titulo: 'Por hora',
    barras: [
      { rotulo: '19h', valor: 0, texto: '0' },
      { rotulo: '20h', valor: 8, texto: '8' },
    ],
    linha: null,
    nota: null,
  },
  deOnde: [{ produto: 'X-Burger', detalhe: '3 vendidos · 1 por unidade', valor: '3' }],
  outros: null,
  fonte: 'Fonte: a baixa do estoque de cada venda fechada no período.',
});

describe('o link para encaminhar do Mister (M3c, mig 443) — as regras', () => {
  it('o código é o de 24 bytes em base64url (32 letras): o resto não é código de link', () => {
    expect(ehCodigoPublico('a'.repeat(32))).toBe(true);
    expect(ehCodigoPublico('Ab0_-'.repeat(6) + 'zz')).toBe(true);
    expect(ehCodigoPublico('a'.repeat(31))).toBe(false);
    expect(ehCodigoPublico('a'.repeat(33))).toBe(false);
    expect(ehCodigoPublico('a'.repeat(31) + '/')).toBe(false);
    expect(ehCodigoPublico('a'.repeat(31) + '.')).toBe(false);
    expect(ehCodigoPublico('')).toBe(false);
    expect(ehCodigoPublico(null)).toBe(false);
    expect(ehCodigoPublico(undefined)).toBe(false);
    expect(ehCodigoPublico(12345678901234567890123456789012)).toBe(false);
    expect(ehCodigoPublico(['a'.repeat(32)])).toBe(false);
  });

  it('o endereço é o da página sem login, noutro caminho que o do link com PIN, com ou sem barra no fim da base', () => {
    const c = 'x'.repeat(32);
    expect(enderecoDoLinkPublico('https://app.dmsregem.com', c)).toBe(`https://app.dmsregem.com/m/r/${c}`);
    expect(enderecoDoLinkPublico('https://app.dmsregem.com///', c)).toBe(`https://app.dmsregem.com/m/r/${c}`);
  });

  it('vale 7 dias, e a linha da conversa diz que é só leitura e até quando vale (no relógio da loja)', () => {
    expect(VALIDADE_DO_LINK_DIAS).toBe(7);
    const agora = new Date('2026-11-18T15:00:00Z'); // meio-dia em Brasília
    const vence = venceEm(agora);
    expect(vence.toISOString()).toBe('2026-11-25T15:00:00.000Z');
    expect(diaMesDe(vence)).toBe('25/11');
    // 01:00 UTC ainda é o dia anterior na loja (o fuso da loja, não o do servidor).
    expect(diaMesDe(new Date('2026-12-01T01:00:00Z'))).toBe('30/11');
    expect(linhaDoLinkNaConversa('https://app.dmsregem.com/m/r/abc', vence)).toBe('Link para encaminhar (só leitura, vale até 25/11): https://app.dmsregem.com/m/r/abc');
  });

  it('as frases: a de "não vale" é uma só (não diz se venceu, foi cancelado ou nunca existiu), e a do teto traz o número', () => {
    expect(TEXTOS_DO_LINK_PUBLICO.naoVale).toBe('Este link não vale mais. Peça outro a quem mandou.');
    expect(TEXTOS_DO_LINK_PUBLICO.teto).toContain(`${TETO_DE_LINKS_VIVOS} links`);
    expect(TEXTOS_DO_LINK_PUBLICO.desligado).toContain('PDF');
  });

  it('só sai pela porta pública o plano que a página sabe desenhar: outra forma não abre', () => {
    expect(ehPlanoDoRelatorio(plano())).toBe(true);
    expect(ehPlanoDoRelatorio({ ...plano(), outros: '1 unidade fora da ficha' })).toBe(true);
    expect(ehPlanoDoRelatorio({ ...plano(), grafico: { ...plano().grafico, linha: { valor: 4, texto: 'média 4' }, nota: 'até 21:40' } })).toBe(true);
    for (const torto of [
      null,
      undefined,
      'plano',
      [],
      {},
      { ...plano(), titulo: 12 },
      { ...plano(), titulo: 'x'.repeat(601) },
      { ...plano(), outros: 3 },
      { ...plano(), numeros: 'oito' },
      { ...plano(), numeros: [{ valor: 8, rotulo: 'Loja' }] },
      { ...plano(), numeros: Array.from({ length: 13 }, () => ({ valor: '1', rotulo: 'x' })) },
      { ...plano(), deOnde: [{ produto: 'X', detalhe: 'y' }] },
      { ...plano(), grafico: null },
      { ...plano(), grafico: { ...plano().grafico, barras: [{ rotulo: '19h', valor: 'oito', texto: '8' }] } },
      { ...plano(), grafico: { ...plano().grafico, barras: [{ rotulo: '19h', valor: Number.NaN, texto: '8' }] } },
      { ...plano(), grafico: { ...plano().grafico, linha: { valor: 'x', texto: 'média' } } },
      { ...plano(), grafico: { ...plano().grafico, nota: 7 } },
      { ...plano(), fonte: undefined },
    ])
      expect(ehPlanoDoRelatorio(torto)).toBe(false);
  });

  it('o relatório tem venda quando alguma barra passa de zero', () => {
    expect(planoTemVenda(plano())).toBe(true);
    const zerado = plano();
    zerado.grafico.barras = zerado.grafico.barras.map((b) => ({ ...b, valor: 0 }));
    expect(planoTemVenda(zerado)).toBe(false);
    zerado.grafico.barras = [];
    expect(planoTemVenda(zerado)).toBe(false);
  });
});
