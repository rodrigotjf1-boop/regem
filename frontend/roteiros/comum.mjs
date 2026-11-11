// Peças comuns dos roteiros de tela (ver README.md): o navegador, a conferência, o login falso e a resposta simulada.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** As 16 larguras da regra de tela (nenhuma barra de rolagem horizontal em nenhuma delas). */
export const LARGURAS = [320, 360, 375, 390, 414, 480, 540, 600, 640, 720, 768, 834, 1024, 1280, 1440, 1920];
/** `--rapido`: uma de cada faixa — celular pequeno, celular, tablet, notebook, monitor. */
export const LARGURAS_RAPIDO = [320, 375, 768, 1280, 1920];

/** Abre o Chrome instalado no PC (ou o Edge); `ROTEIRO_CHROME` aponta outro executável. Sem janela. */
export async function abrirNavegador() {
  let chromium;
  try {
    ({ chromium } = require('playwright-core'));
  } catch {
    throw new Error('Falta o Playwright dos roteiros: rode "npm ci" dentro de frontend/roteiros (uma vez).');
  }
  if (process.env.ROTEIRO_CHROME) return chromium.launch({ executablePath: process.env.ROTEIRO_CHROME, headless: true });
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* tenta o próximo */
    }
  }
  throw new Error('Não achei o Chrome nem o Edge neste PC. Aponte o executável em ROTEIRO_CHROME.');
}

/**
 * Uma conferência por roteiro: `ok(condição, mensagem)` anota e SEGUE — o roteiro não para na primeira falha, para a
 * pessoa ver tudo o que quebrou de uma vez.
 */
export function criarConferencia(nome, escrever) {
  const falhas = [];
  let total = 0;
  const ok = (cond, msg) => {
    total++;
    escrever(`${cond ? 'OK   ' : 'FALHA'} [${nome}] ${msg}`, !cond);
    if (!cond) falhas.push(msg);
  };
  return {
    ok,
    falhas,
    get total() {
      return total;
    },
  };
}

/** Login falso: a API é simulada, então ninguém confere a assinatura; a tela só lê o que vem dentro do token. */
export function tokenFalso(dados) {
  const corpo = { sub: 'u1', tenantId: 't1', exp: 4102444800, ...dados };
  return 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify(corpo)).toString('base64url') + '.x';
}

/** Responde uma chamada interceptada da API com JSON. */
export const responder = (route, corpo, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });

/** Texto numa linha só, curto (para a mensagem da conferência). */
export const umaLinha = (t, n = 160) => String(t ?? '').replace(/\s*\n\s*/g, ' / ').slice(0, n);
