import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chaveDaConversa, conversasDoLote, ehSoAgradecimento } from './casos-do-chat';
import { TEXTO_MAX } from './texto-do-chat';

// Os casos do chat do iFood e da 99 (ponte do chat, Etapa 2) — as regras sem banco: o agradecimento curto que não abre
// caso, a chave da conversa e o lote. E a mesma trava de contato na tela e no servidor (V74: a tela avisa, o servidor
// decide — com a mesma conta).

describe('casos do chat: o agradecimento curto', () => {
  it.each(['Obrigada!', 'ok', 'Ok, valeu', 'obrigadaaaa', 'muito obrigado 😊', '👍', '🙏❤️', 'tá bom', 'Beleza!', 'OBG', 'Valeu, show!'])(
    '"%s" é só agradecimento',
    (t) => expect(ehSoAgradecimento(t)).toBe(true),
  );
  it.each(['Oi', 'Cadê meu pedido?', 'obrigado?', 'ok mas cadê?', 'bom dia', '', '?', 'Pode pedir ele pra subir por favor, é uma criança que vai pegar', 'ok 21999990000'])(
    '"%s" não é',
    (t) => expect(ehSoAgradecimento(t)).toBe(false),
  );
});

describe('casos do chat: a chave e o lote', () => {
  it('a chave: o pedido na plataforma, senão o do Regem, senão o número; sem nada, nenhuma', () => {
    expect(chaveDaConversa({ pedidoExterno: 'abc', pedidoId: 'u1', pedidoNumero: '4821' })).toBe('ext:abc');
    expect(chaveDaConversa({ pedidoId: 'u1', pedidoNumero: '4821' })).toBe('id:u1');
    expect(chaveDaConversa({ pedidoNumero: '4821' })).toBe('num:4821');
    expect(chaveDaConversa({})).toBeNull();
  });

  it('agrupa por canal e conversa: a última fala vale; "só agradecimento" só se TODAS forem', () => {
    const base = { pedidoId: null, pedidoNumero: null, cliente: 'Maria S.', unidadeId: null };
    const lote = conversasDoLote([
      { ...base, canal: 'ifood', pedidoExterno: 'a', texto: 'Cadê meu pedido?', criadoEm: '2026-11-05T20:00:00Z' },
      { ...base, canal: 'ifood', pedidoExterno: 'a', texto: 'Obrigada!', criadoEm: '2026-11-05T20:01:00Z' },
      { ...base, canal: 'ifood', pedidoExterno: 'b', texto: 'Obrigada!', criadoEm: '2026-11-05T20:00:30Z' },
      { ...base, canal: '99food', pedidoExterno: 'a', texto: 'Oi', criadoEm: '2026-11-05T20:00:10Z' },
      { ...base, canal: 'ifood', pedidoExterno: null, texto: 'sem pedido', criadoEm: '2026-11-05T20:00:00Z' },
    ]);
    const por = Object.fromEntries(lote.map((c) => [`${c.canal}|${c.chave}`, c]));
    expect(Object.keys(por).sort()).toEqual(['99food|ext:a', 'ifood|ext:a', 'ifood|ext:b']);
    expect(por['ifood|ext:a']).toMatchObject({ texto: 'Obrigada!', so_agradecimento: false, cliente: 'Maria S.' });
    expect(por['ifood|ext:b']).toMatchObject({ so_agradecimento: true });
    expect(por['99food|ext:a']).toMatchObject({ texto: 'Oi', so_agradecimento: false });
  });
});

describe('a trava de contato: a mesma na tela e no servidor (V74)', () => {
  const regra = (arquivo: string) => {
    const fonte = readFileSync(arquivo, 'utf8');
    const m = fonte.match(/return (\/.+\/[a-z]*)\.test\(texto\);/);
    if (!m) throw new Error(`a regra não foi achada em ${arquivo}`);
    return m[1];
  };
  it('a expressão e o limite de letras são os mesmos', () => {
    const servidor = regra(join(__dirname, 'texto-do-chat.ts'));
    const tela = regra(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'lib', 'texto-do-chat.ts'));
    expect(tela).toBe(servidor);
    const fonteTela = readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'lib', 'texto-do-chat.ts'), 'utf8');
    expect(fonteTela).toContain(`export const TEXTO_MAX_DO_CHAT = ${TEXTO_MAX};`);
  });
});
