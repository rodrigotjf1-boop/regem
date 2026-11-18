import {
  LEMBRETE_DIAS_MAX,
  conferirTextoDoLembrete,
  fimDaNoite,
  idDaReferencia,
  instanteNaLoja,
  lerQuando,
  quandoNaConversa,
  referenciaDoPedido,
  textoDaMudancaDoPedido,
  textoDoLembreteNaHora,
} from './mister-vigia';

// O "fica de olho" e o lembrete (versão 4, M4d, mig 452): as regras puras — a hora da loja, o fim da noite, o "quando" do
// lembrete, o texto e as mensagens.

// Quarta, 18/11/2026, 21:16 na loja (UTC−3) = 00:16 UTC de quinta.
const AGORA = new Date('2026-11-19T00:16:00Z');

describe('mister — o vigia: a hora da loja', () => {
  it('a data e a hora da loja viram o instante certo, sem depender do fuso do servidor; data que não existe = null', () => {
    expect(instanteNaLoja('2026-11-19', '10:00')?.toISOString()).toBe('2026-11-19T13:00:00.000Z');
    expect(instanteNaLoja('2026-11-18', '23:30')?.toISOString()).toBe('2026-11-19T02:30:00.000Z');
    expect(instanteNaLoja('2026-02-31', '10:00')).toBeNull();
    expect(instanteNaLoja('2026-11-19', '25:00')).toBeNull();
    expect(instanteNaLoja('19/11/2026', '10:00')).toBeNull();
  });

  it('o "fica de olho" vale até o próximo 06:00 da loja (de madrugada, o mesmo dia)', () => {
    expect(fimDaNoite(AGORA).toISOString()).toBe('2026-11-19T09:00:00.000Z'); // 21:16 de quarta → 06:00 de quinta
    expect(fimDaNoite(new Date('2026-11-19T05:30:00Z')).toISOString()).toBe('2026-11-19T09:00:00.000Z'); // 02:30 → 06:00 do mesmo dia
    expect(fimDaNoite(new Date('2026-11-19T09:00:00Z')).toISOString()).toBe('2026-11-20T09:00:00.000Z'); // 06:00 em ponto → o de amanhã
  });
});

describe('mister — o vigia: o lembrete', () => {
  it('o quando: AAAA-MM-DDTHH:MM da loja, no futuro e até 30 dias', () => {
    expect(lerQuando('2026-11-19T10:00', AGORA)).toEqual({ quando: new Date('2026-11-19T13:00:00Z') });
    expect(lerQuando('2026-11-19 10:00', AGORA)).toEqual({ quando: new Date('2026-11-19T13:00:00Z') });
    expect(lerQuando('amanhã às 10h', AGORA)).toEqual({ erro: expect.stringContaining('AAAA-MM-DDTHH:MM') });
    expect(lerQuando('2026-11-18T20:00', AGORA)).toEqual({ erro: 'Essa hora já passou. Diga uma hora daqui para frente.' });
    expect(lerQuando('2026-11-18T21:16', AGORA)).toEqual({ erro: 'Essa hora já passou. Diga uma hora daqui para frente.' });
    expect(lerQuando('2026-12-25T10:00', AGORA)).toEqual({ erro: `O lembrete vale até ${LEMBRETE_DIAS_MAX} dias à frente.` });
    expect(lerQuando('2026-02-30T10:00', AGORA)).toEqual({ erro: 'Essa data não existe. Diga o dia e a hora de novo.' });
  });

  it('o texto: uma linha de até 200 letras, sem link e sem senha', () => {
    expect(conferirTextoDoLembrete('  pagar   o gás\n ')).toEqual({ texto: 'pagar o gás' });
    expect(conferirTextoDoLembrete('ligar pro fornecedor da carne às 10h')).toEqual({ texto: 'ligar pro fornecedor da carne às 10h' });
    expect(conferirTextoDoLembrete('   ')).toEqual({ erro: 'Diga do que é para lembrar.' });
    expect(conferirTextoDoLembrete('x'.repeat(201))).toEqual({ erro: 'O lembrete cabe em 200 letras.' });
    expect(conferirTextoDoLembrete('ver https://exemplo.com')).toEqual({ erro: 'O lembrete não guarda link.' });
    expect(conferirTextoDoLembrete('a senha do wi-fi é 1234')).toEqual({ erro: 'O lembrete não guarda senha, PIN ou código.' });
  });

  it('o dia como na conversa: hoje, amanhã, ou o dia da semana', () => {
    expect(quandoNaConversa(new Date('2026-11-19T01:30:00Z'), AGORA)).toBe('hoje às 22:30');
    expect(quandoNaConversa(new Date('2026-11-19T13:00:00Z'), AGORA)).toBe('amanhã, 19/11, às 10:00');
    expect(quandoNaConversa(new Date('2026-11-21T13:00:00Z'), AGORA)).toBe('sábado, 21/11, às 10:00');
  });

  it('a mensagem na hora', () => {
    expect(textoDoLembreteNaHora('pagar o gás')).toBe('🔔 Lembrete que você pediu: pagar o gás.');
    expect(textoDoLembreteNaHora('pagar o gás!')).toBe('🔔 Lembrete que você pediu: pagar o gás!');
  });
});

describe('mister — o vigia: o pedido', () => {
  it('a frase de cada mudança, com a hora; a final diz que deixa de olhar', () => {
    expect(textoDaMudancaDoPedido('#284 · iFood 4821', 'despachado', '21:42')).toBe('✅ O #284 · iFood 4821 saiu para entrega às 21:42.');
    expect(textoDaMudancaDoPedido('#284 · iFood 4821', 'pronto', '21:30')).toBe('👀 O #284 · iFood 4821 ficou pronto às 21:30.');
    expect(textoDaMudancaDoPedido('#284 · iFood 4821', 'entregue', '22:05')).toBe('✅ O #284 · iFood 4821 foi entregue às 22:05. Deixo de olhar este pedido.');
    expect(textoDaMudancaDoPedido('#284 · iFood 4821', 'cancelado', null)).toBe('⚠️ O #284 · iFood 4821 foi cancelado. Deixo de olhar este pedido.');
  });

  it('a referência guarda só o id do pedido, e a leitura recusa o malformado', () => {
    const id = '0b9f1c2e-1111-4aaa-8bbb-123456789abc';
    expect(referenciaDoPedido(id)).toBe(`pe:${id}`);
    expect(idDaReferencia(`pe:${id.toUpperCase()}`)).toBe(id);
    expect(idDaReferencia('pe:1; drop table x')).toBeNull();
    expect(idDaReferencia(null)).toBeNull();
  });
});
