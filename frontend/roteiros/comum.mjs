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

// ── M3d: a imagem do "como faço" do Mister ──────────────────────────────────────────────────────────────────────────
// A tela de verdade (com os dados de exemplo do roteiro — nunca dado de loja), com os lugares numerados (1, 2, 3…) num
// contorno dourado, salva em `frontend/public/como-faco/<id>.png`: o servidor manda pelo endereço público. Só gera com
// GERAR_COMO_FACO=1 (a imagem muda só quando a tela muda; o arquivo entra no git). Sem a variável, só confere as marcas.
export const PASTA_DO_COMO_FACO = new URL('../public/como-faco/', import.meta.url);

export async function fotoDoComoFaco(page, id, marcas) {
  const caixas = [];
  for (const m of marcas) caixas.push(await m.boundingBox().catch(() => null));
  const achou = caixas.map((c) => !!c && c.width > 0 && c.height > 0);
  if (process.env.GERAR_COMO_FACO !== '1' || achou.some((x) => !x)) return { gerou: false, achou };
  await page.evaluate((cx) => {
    const camada = document.createElement('div');
    camada.id = 'marcas-do-como-faco';
    camada.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    cx.forEach((c, i) => {
      const contorno = document.createElement('div');
      contorno.style.cssText = `position:fixed;left:${c.x - 4}px;top:${c.y - 4}px;width:${c.width + 8}px;height:${c.height + 8}px;border:3px solid #E2A340;border-radius:10px`;
      const numero = document.createElement('div');
      numero.textContent = String(i + 1);
      numero.style.cssText = `position:fixed;left:${Math.max(2, c.x - 16)}px;top:${Math.max(2, c.y - 16)}px;width:26px;height:26px;border-radius:13px;background:#E2A340;color:#0F2230;font:700 15px/26px Arial,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.35)`;
      camada.append(contorno, numero);
    });
    document.body.append(camada);
  }, caixas);
  const { fileURLToPath } = await import('node:url');
  const { mkdirSync } = await import('node:fs');
  const pasta = fileURLToPath(PASTA_DO_COMO_FACO);
  mkdirSync(pasta, { recursive: true });
  await page.screenshot({ path: `${pasta}${id}.png` });
  await page.evaluate(() => document.getElementById('marcas-do-como-faco')?.remove());
  return { gerou: true, achou };
}
