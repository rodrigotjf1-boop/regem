// O ATLAS DE LETRAS DO GRÁFICO DO MISTER (M3c parte 3). Gera `backend/src/modules/mister/grafico/fonte-do-grafico.ts`:
// cada letra da Figtree (a fonte do corpo do Regem, licença SIL OFL — `frontend/src/fonts/figtree-var.woff2`) desenhada
// UMA vez pelo navegador num canvas, e guardada só a transparência de cada pixel. O servidor monta a imagem do gráfico
// com essas letras e o seu próprio codificador de PNG — sem biblioteca de imagem no backend.
//
// Rodar de novo só ao mudar a fonte, os tamanhos ou as letras:  node roteiros/fonte-do-grafico.mjs   (dentro de frontend/)
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirNavegador } from './comum.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const FONTE = join(aqui, '..', 'src', 'fonts', 'figtree-var.woff2');
const SAIDA = join(aqui, '..', '..', 'backend', 'src', 'modules', 'mister', 'grafico', 'fonte-do-grafico.ts');

// As letras que o gráfico escreve (rótulos, números, nomes de insumo e de loja); o que faltar sai como "?".
export const LETRAS =
  " 0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZáàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇñÑ.,:;%()/-+·×'\"!?&#$*ºª_<>=@[]–—…";
// Os três tamanhos: o título, o texto (valores e rótulos) e o pequeno (muitas barras).
const TAMANHOS = { titulo: { peso: 700, px: 30 }, texto: { peso: 600, px: 22 }, pequeno: { peso: 500, px: 17 } };

const navegador = await abrirNavegador();
try {
  const pagina = await navegador.newPage();
  const b64 = readFileSync(FONTE).toString('base64');
  await pagina.setContent(`<style>@font-face{font-family:F;src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:100 900}</style><p style="font-family:F">x</p>`);
  const fora = await pagina.evaluate(
    async ({ letras, tamanhos }) => {
      const res = {};
      for (const [nome, t] of Object.entries(tamanhos)) {
        await document.fonts.load(`${t.peso} ${t.px}px F`);
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.font = `${t.peso} ${t.px}px F`;
        const ref = ctx.measureText('Hg');
        const asc = Math.ceil(ref.fontBoundingBoxAscent);
        const desc = Math.ceil(ref.fontBoundingBoxDescent);
        const altura = asc + desc;
        const glifos = {};
        for (const ch of letras) {
          ctx.font = `${t.peso} ${t.px}px F`;
          const m = ctx.measureText(ch);
          const largura = Math.max(1, Math.ceil(m.width) + 2);
          c.width = largura;
          c.height = altura;
          ctx.font = `${t.peso} ${t.px}px F`;
          ctx.clearRect(0, 0, largura, altura);
          ctx.fillStyle = '#000';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText(ch, 1, asc);
          const d = ctx.getImageData(0, 0, largura, altura).data;
          const alfa = [];
          for (let i = 3; i < d.length; i += 4) alfa.push(d[i]);
          glifos[ch] = { avanco: Math.round(m.width * 100) / 100, largura, alfa };
        }
        res[nome] = { altura, base: asc, glifos };
      }
      return res;
    },
    { letras: LETRAS, tamanhos: TAMANHOS },
  );

  // Um bloco só de bytes (a transparência de todas as letras, em sequência), comprimido; o índice diz onde cada uma começa.
  const partes = [];
  let pos = 0;
  const indice = {};
  for (const [nome, t] of Object.entries(fora)) {
    indice[nome] = { altura: t.altura, base: t.base, glifos: {} };
    for (const [ch, g] of Object.entries(t.glifos)) {
      partes.push(Buffer.from(g.alfa));
      indice[nome].glifos[ch] = [g.avanco, g.largura, pos];
      pos += g.alfa.length;
    }
  }
  const dados = deflateSync(Buffer.concat(partes), { level: 9 }).toString('base64');
  const linhas = [];
  for (let i = 0; i < dados.length; i += 120) linhas.push(`  '${dados.slice(i, i + 120)}',`);
  const ts = [
    '// GERADO por `frontend/roteiros/fonte-do-grafico.mjs` — não editar à mão (rode o script de novo).',
    '// As letras da Figtree (licença SIL Open Font License 1.1, `frontend/src/fonts/figtree-var.woff2`), desenhadas uma vez',
    '// pelo navegador: só a transparência de cada pixel, comprimida. O gráfico do Mister monta a imagem com elas.',
    '/* eslint-disable */',
    '',
    `export const INDICE_DA_FONTE: Record<string, { altura: number; base: number; glifos: Record<string, [number, number, number]> }> = ${JSON.stringify(indice)};`,
    '',
    `export const BYTES_DA_FONTE = ${pos};`,
    '',
    'export const DADOS_DA_FONTE = [',
    ...linhas,
    "].join('');",
    '',
  ].join('\n');
  writeFileSync(SAIDA, ts);
  console.log(`ok: ${SAIDA} (${Object.keys(fora).length} tamanhos, ${pos} bytes de transparência, ${dados.length} em base64)`);
} finally {
  await navegador.close();
}
