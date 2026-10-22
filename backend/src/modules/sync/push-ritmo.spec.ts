import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O RITMO DO ENVIO do servidor da loja (edge/sync-push-ritmo.mjs, ERR-278). 429 "em curso" e envio que passou do tempo
// não são falha de sincronização: o lote fica para o próximo ciclo (o daemon não esticava mais o intervalo nem tirava o
// servidor de "vivo" por isso); o lote que passou do tempo volta menor. O arquivo é ESM puro sem import (o jest roda em
// CommonJS): avaliado como texto — é exatamente o código que o daemon usa.
function carregar(): Record<string, any> {
  const fonte = readFileSync(join(__dirname, '..', '..', '..', 'edge', 'sync-push-ritmo.mjs'), 'utf8');
  const nomes = [...fonte.matchAll(/^export (?:const|async function|function) (\w+)/gm)].map((m) => m[1]);
  const corpo = fonte.replace(/^export (const|async function|function) /gm, '$1 ') + `\nreturn { ${nomes.join(', ')} };`;
  return new Function(corpo)();
}
const m = carregar();

describe('ritmo do envio do servidor da loja (edge/sync-push-ritmo.mjs)', () => {
  it('429 "em curso" e tempo esgotado adiam o lote; o resto é falha de verdade', () => {
    expect(m.motivoDoAdiamento(429, 'push HTTP 429: Já há um push deste dispositivo em curso.')).toMatch(/outro envio/);
    // A causa como o daemon monta (fetchT): mensagem + causa aninhada do undici.
    expect(m.motivoDoAdiamento(undefined, 'This operation was aborted | causa: TimeoutError The operation was aborted due to timeout')).toMatch(/passou do tempo/);
    expect(m.motivoDoAdiamento(undefined, 'TimeoutError')).toMatch(/passou do tempo/);
    for (const [status, causa] of [
      [500, 'push HTTP 500: erro interno'],
      [502, 'push HTTP 502: bad gateway'],
      [401, 'push HTTP 401: Token de sync inválido.'],
      [400, 'push HTTP 400: Tabela não permitida no push'],
      [undefined, 'fetch failed | causa: ECONNREFUSED'],
      [undefined, ''],
    ] as const) {
      expect(m.motivoDoAdiamento(status, causa)).toBeNull();
    }
  });

  it('tempo esgotado se reconhece pelas mensagens do undici e do .NET', () => {
    expect(m.ehTempoEsgotado('The operation was aborted due to timeout')).toBe(true);
    expect(m.ehTempoEsgotado('This operation was aborted')).toBe(true);
    expect(m.ehTempoEsgotado('TimeoutError')).toBe(true);
    expect(m.ehTempoEsgotado('The operation timed out')).toBe(true);
    expect(m.ehTempoEsgotado('ECONNRESET')).toBe(false);
    expect(m.ehTempoEsgotado(undefined)).toBe(false);
  });

  it('lote que passou do tempo volta com a metade, até o piso; o que dá certo volta a crescer até o teto', () => {
    expect(m.loteDepoisDoTempoEsgotado(200)).toBe(100);
    expect(m.loteDepoisDoTempoEsgotado(100)).toBe(50);
    expect(m.loteDepoisDoTempoEsgotado(30)).toBe(m.LOTE_MINIMO);
    expect(m.loteDepoisDoTempoEsgotado(m.LOTE_MINIMO)).toBe(m.LOTE_MINIMO);
    expect(m.loteDepoisDoSucesso(50, 200)).toBe(100);
    expect(m.loteDepoisDoSucesso(150, 200)).toBe(200);
    expect(m.loteDepoisDoSucesso(200, 200)).toBe(200);
    expect(m.loteDepoisDoSucesso(5, 200)).toBe(m.LOTE_MINIMO);
  });

  it('adiado muitas vezes seguidas vira falha (aparece na saúde e na telemetria)', () => {
    expect(m.adiamentoViraFalha(1)).toBe(false);
    expect(m.adiamentoViraFalha(m.ADIAMENTOS_ATE_FALHA - 1)).toBe(false);
    expect(m.adiamentoViraFalha(m.ADIAMENTOS_ATE_FALHA)).toBe(true);
    expect(m.adiamentoViraFalha(m.ADIAMENTOS_ATE_FALHA + 5)).toBe(true);
  });

  it('o daemon usa o ritmo: importa o módulo, não repete o POST que passou do tempo e o --descarregar não apaga o banco', () => {
    const daemon = readFileSync(join(__dirname, '..', '..', '..', 'edge', 'sync-daemon.mjs'), 'utf8');
    expect(daemon).toMatch(/from '\.\/sync-push-ritmo\.mjs'/);
    expect(daemon).toMatch(/if \(!idempotente && ehTempoEsgotado\(causaErro\(e\)\)\) break;/);
    expect(daemon).toMatch(/if \(envioAdiado\) \{\s*\/\/[^\n]*\n\s*console\.error\(\s*`descarregar: \$\{n\} linha\(s\) enviadas, mas o envio de/);
  });
});
