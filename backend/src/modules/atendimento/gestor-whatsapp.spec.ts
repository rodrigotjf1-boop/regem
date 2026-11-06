import {
  ehPararAvisos,
  ehVerPorAqui,
  ehVoltarAvisos,
  finalDoNumero,
  lerAjusteGestorWa,
  lerCodigoDeLigar,
  linkDoCaso,
  linkParaLigar,
  novoCodigo,
  resumoDoModelo,
  textoDeLigado,
  textoDoAviso,
} from './gestor-whatsapp';

/* eslint-disable @typescript-eslint/no-explicit-any */

// GERENTE NO WHATSAPP (mig 375) — as regras puras: o código de ligar, as palavras do gestor, os textos (as mesmas frases
// da tela, V39), a variável do modelo da Meta (uma linha) e o ajuste (V15).
const caso = (o: Record<string, unknown> = {}): any => ({
  id: 'c-1',
  tipo: 'disputa',
  canal: 'ifood',
  cliente: 'Ana P.',
  pedidoNumero: '4521',
  mensagem: 'Faltou a batata.',
  prazoEm: new Date('2026-11-06T22:58:00Z'), // 19:58 em São Paulo
  criadoEm: new Date('2026-11-06T22:50:00Z'),
  detalhe: { disputa: { acaoAutomatica: 'ACCEPT_CANCELLATION' } },
  ...o,
});

describe('gerente no WhatsApp — regras', () => {
  it('o código de ligar: "REGEM 123456" com ou sem espaço, maiúscula, negrito; nada além disso', () => {
    for (const ok of ['REGEM 482913', 'regem 482913', 'Regem482913', '*REGEM* 482913', '  REGEM: 482913. '])
      expect(lerCodigoDeLigar(ok)).toBe('482913');
    for (const nao of ['482913', 'REGEM 48291', 'REGEM 4829134', 'meu código é REGEM 482913', 'regem abc123', '', null])
      expect(lerCodigoDeLigar(nao)).toBeNull();
  });

  it('PARAR AVISOS e VOLTAR AVISOS — "PARAR" sozinho continua sendo o opt-out de ofertas', () => {
    expect(ehPararAvisos('PARAR AVISOS')).toBe(true);
    expect(ehPararAvisos('parar os avisos.')).toBe(true);
    expect(ehPararAvisos('PARAR')).toBe(false);
    expect(ehPararAvisos('parar ofertas')).toBe(false);
    expect(ehVoltarAvisos('Voltar avisos')).toBe(true);
    expect(ehVoltarAvisos('VOLTAR')).toBe(false);
  });

  it('o botão do modelo chega como texto: "Ver por aqui" (sem ligar para maiúscula ou espaço)', () => {
    expect(ehVerPorAqui('Ver por aqui')).toBe(true);
    expect(ehVerPorAqui('  ver POR aqui ')).toBe(true);
    expect(ehVerPorAqui('ver')).toBe(false);
  });

  it('código de 6 dígitos, final do número, link do caso e o link que abre o WhatsApp com a mensagem pronta', () => {
    for (let i = 0; i < 50; i++) expect(novoCodigo()).toMatch(/^\d{6}$/);
    expect(finalDoNumero('5521987654321')).toBe('4321');
    expect(linkDoCaso('abc')).toMatch(/\/atendimento\?caso=abc$/);
    expect(linkParaLigar('+55 (21) 99999-0000', '482913')).toBe('https://wa.me/5521999990000?text=REGEM%20482913');
  });

  it('a disputa: título, o que o cliente disse, o prazo com a frase da tela e o link', () => {
    const t = textoDoAviso(caso(), 'decisao');
    expect(t.split('\n')).toEqual([
      '⚖️ *Disputa do iFood · pedido 4521*',
      'Ana P. diz: "Faltou a batata."',
      '⏱ Se ninguém responder até 19:58, o iFood aceita sozinho: cancela e o cliente recebe o valor de volta.',
      expect.stringMatching(/^Para responder, abra no Regem: https:\/\/.+\/atendimento\?caso=c-1$/),
    ]);
    expect(textoDoAviso(caso({ detalhe: { disputa: { acaoAutomatica: 'OUTRA' } } }), 'decisao')).toContain('o iFood decide sozinho.');
  });

  it('a 99: cancelamento (a 99 recusa sozinha) e reembolso (o Regem recusa; sem motivos, a 99 reembolsa)', () => {
    const can = textoDoAviso(caso({ tipo: 'cancelamento_99', canal: '99food', pedidoNumero: '77', detalhe: { pedido99: { motivoDoCliente: 'Demorou demais' } } }), 'decisao');
    expect(can).toContain('*99Food · cancelamento · pedido 77*');
    expect(can).toContain('Ana P. pediu para cancelar: "Demorou demais"');
    expect(can).toContain('a 99 recusa sozinha.');
    const reemb = textoDoAviso(caso({ tipo: 'reembolso_99', canal: '99food', detalhe: { pedido99: {} } }), 'decisao');
    expect(reemb).toContain('o Regem recusa com o motivo do ajuste.');
    expect(textoDoAviso(caso({ tipo: 'reembolso_99', detalhe: { semMotivoParaRecusar: true } }), 'decisao')).toContain('a 99 reembolsa sozinha.');
  });

  it('o cancelamento do cardápio sem prazo não promete hora; a mensagem longa é cortada numa linha só', () => {
    const t = textoDoAviso(caso({ tipo: 'cancelamento', canal: 'cardapio', prazoEm: null, mensagem: 'Pedi errado\n\n'.repeat(40) }), 'decisao');
    expect(t).toContain('*Cancelamento pedido no cardápio · pedido 4521*');
    expect(t).not.toContain('⏱');
    const disse = t.split('\n')[1];
    expect(disse.length).toBeLessThan(200);
    expect(disse.endsWith('…"')).toBe(true);
  });

  it('o caso que ninguém pegou: quem, canal, pedido, motivo e há quanto tempo espera', () => {
    const t = textoDoAviso(caso({ tipo: 'humano', canal: 'whatsapp', cliente: 'Carlos M.', pedidoNumero: '1180', prazoEm: null }), 'ninguem_pegou', new Date('2026-11-06T22:53:30Z'));
    expect(t.split('\n').slice(0, 2)).toEqual(['🔔 *Ninguém pegou um caso*', 'Carlos M. · WhatsApp · pedido 1180 · Quer falar com alguém. Esperando há 3 min.']);
  });

  it('a variável do modelo da Meta: uma linha, sem quebra, com o prazo', () => {
    expect(resumoDoModelo(caso(), 'decisao')).toBe('disputa do iFood no pedido 4521, responder até 19:58');
    expect(resumoDoModelo(caso({ tipo: 'cancelamento_99' }), 'decisao')).toBe('pedido de cancelamento na 99 no pedido 4521, responder até 19:58');
    const r = resumoDoModelo(caso({ cliente: 'Carlos\nM.' }), 'ninguem_pegou', new Date('2026-11-06T22:55:00Z'));
    expect(r).toBe('um caso de Carlos M. espera há 5 min sem ninguém');
    expect(r).not.toMatch(/[\n\t]/);
  });

  it('a resposta de quem ligou diz como parar', () => {
    const t = textoDeLigado('Ana Paula Souza', 'Loja Centro');
    expect(t).toContain('Pronto, Ana! Este WhatsApp está ligado a você no Regem da Loja Centro.');
    expect(t).toContain('responda PARAR AVISOS');
  });

  it('o ajuste: liga/desliga só com booleano (V15); ausente fica de fora', () => {
    expect(lerAjusteGestorWa({ ligado: true })).toEqual({ ligado: true });
    expect(lerAjusteGestorWa({ decisoes: false, ninguemPegou: true })).toEqual({ decisoes: false, ninguemPegou: true });
    expect(lerAjusteGestorWa(null)).toEqual({});
    for (const ruim of ['true', 1, null]) expect(() => lerAjusteGestorWa({ ligado: ruim })).toThrow('Gerente no WhatsApp');
  });
});
