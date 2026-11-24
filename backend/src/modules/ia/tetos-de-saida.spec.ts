import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ERR-593: nos modelos 5.5 o raciocínio vem ligado e conta no `max_tokens`. Um teto do tamanho da resposta corta o texto, às vezes
// sem sobrar nada. Esta conferência reprova teto escrito à mão abaixo do mínimo em qualquer chamada de IA do backend.

const RAIZ = join(__dirname, '..', '..');
const MINIMO = 1500;
/** A prova da chave só precisa de uma resposta qualquer: não usa o texto. */
const PODE_SER_MENOR = ['modules/ia/ia-empresa.service.ts'];

function arquivos(pasta: string): string[] {
  return readdirSync(pasta).flatMap((n) => {
    const c = join(pasta, n);
    if (statSync(c).isDirectory()) return arquivos(c);
    return n.endsWith('.ts') && !n.includes('.spec.') && !n.includes('teste-spec') ? [c] : [];
  });
}

describe('o teto de saída das chamadas de IA (ERR-593)', () => {
  it(`nenhuma chamada escreve teto abaixo de ${MINIMO}`, () => {
    const baixos: string[] = [];
    for (const c of arquivos(RAIZ)) {
      const nome = relative(RAIZ, c).replace(/\\/g, '/');
      if (PODE_SER_MENOR.includes(nome)) continue;
      for (const m of readFileSync(c, 'utf8').matchAll(/\b(?:maxTokens|max_tokens):\s*([\d_]+)/g)) {
        if (Number(m[1].replace(/_/g, '')) < MINIMO) baixos.push(`${nome}: ${m[0]}`);
      }
    }
    expect(baixos).toEqual([]);
  });

  it('os tetos em constante também', () => {
    const { SAIDA_DO_AVISO_ESCRITO } = require('../mister/mister-avisos-escritos');
    const { SAIDA_DO_MENTOR } = require('../mister/mister-instrucoes');
    const { SAIDA_MAX_TOKENS } = require('../mister/mister-sentinela');
    const { MAX_TOKENS_DA_FOTO, MAX_TOKENS_DA_LISTA_LIDA } = require('../mister/mister-midia.regras');
    const { MAX_TOKENS_DO_DOCUMENTO, MAX_TOKENS_DA_NOTA } = require('../../common/documento-por-foto');
    const { TETOS } = require('../mister/mister-agente.regras');
    for (const t of [SAIDA_DO_AVISO_ESCRITO, SAIDA_DO_MENTOR, SAIDA_MAX_TOKENS, MAX_TOKENS_DA_FOTO, MAX_TOKENS_DA_LISTA_LIDA, MAX_TOKENS_DO_DOCUMENTO, MAX_TOKENS_DA_NOTA, TETOS.maxTokens, TETOS.maxTokensDaAnalise]) {
      expect(t).toBeGreaterThanOrEqual(MINIMO);
    }
    expect(TETOS.maxTokensDaAnalise).toBeGreaterThan(TETOS.maxTokens);
  });
});
