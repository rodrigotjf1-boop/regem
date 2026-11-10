// Confere as regras puras da tela da pausa dos pedidos (mig 392; `src/lib/pausa-dos-pedidos.ts`): a frase da prévia (a
// mesma conta do servidor para o "Outro motivo"), o destaque do WhatsApp em negrito, o aviso do cardápio online e o fim
// da pausa escolhido no diálogo. Transpila com o TypeScript do projeto e roda asserts do Node.  Uso: npm run check:pausa
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const tmp = mkdtempSync(join(tmpdir(), 'check-pausa-'));
let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};
try {
  const js = ts.transpileModule(readFileSync(join(src, 'lib', 'pausa-dos-pedidos.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  writeFileSync(join(tmp, 'pausa.mjs'), js);
  const p = await import(pathToFileURL(join(tmp, 'pausa.mjs')).href);

  caso('a frase da prévia: a pronta, ou o "Outro motivo" com maiúscula, em destaque e sem asterisco solto', () => {
    assert.equal(p.fraseDaPrevia('Estamos com *muitos pedidos agora*', 'ignorado'), 'Estamos com *muitos pedidos agora*');
    assert.equal(p.fraseDaPrevia(null, '  estamos   trocando o *gás* '), '*Estamos trocando o gás*');
    assert.equal(p.fraseDaPrevia(null, '   '), '*(o motivo que você escrever)*');
  });

  caso('o destaque do WhatsApp vira trechos em negrito (sem HTML)', () => {
    assert.deepEqual(p.trechosComDestaque('Estamos com *muitos pedidos agora* e pausamos.'), [
      { texto: 'Estamos com ', destaque: false },
      { texto: 'muitos pedidos agora', destaque: true },
      { texto: ' e pausamos.', destaque: false },
    ]);
    assert.deepEqual(p.trechosComDestaque('<b>x</b>'), [{ texto: '<b>x</b>', destaque: false }]);
    assert.deepEqual(p.trechosComDestaque('sem destaque'), [{ texto: 'sem destaque', destaque: false }]);
  });

  caso('o aviso do cardápio online: título, motivo, volta e que dá para olhar o cardápio', () => {
    assert.deepEqual(p.avisoDaPausa({ frase: 'Estamos com *muitos pedidos agora*', volta: { texto: 'às 21:40' } }), {
      titulo: '⏸️ Pedidos pausados por alguns minutos',
      motivo: 'Estamos com *muitos pedidos agora* e pausamos para não atrasar ninguém.',
      volta: '🕒 Voltamos às 21:40',
      rodape: 'Você pode olhar o cardápio à vontade. Assim que reabrirmos, é só pedir.',
    });
  });

  caso('o fim da prévia: N minutos, ou a próxima vez que o relógio marca HH:MM (passou, é amanhã)', () => {
    const agora = new Date(2026, 10, 10, 21, 10, 0);
    assert.equal(p.fimDaPrevia({ minutos: 30 }, agora).getTime(), new Date(2026, 10, 10, 21, 40).getTime());
    assert.equal(p.fimDaPrevia({ ate: '22:30' }, agora).getTime(), new Date(2026, 10, 10, 22, 30).getTime());
    assert.equal(p.fimDaPrevia({ ate: '00:30' }, agora).getTime(), new Date(2026, 10, 11, 0, 30).getTime());
    assert.equal(p.fimDaPrevia({ ate: '' }, agora), null);
    assert.deepEqual(p.voltaDaPrevia(new Date(2026, 10, 11, 0, 30), agora), { hora: '00:30', amanha: true, texto: 'amanhã às 00:30' });
    assert.deepEqual(p.voltaDaPrevia(new Date(2026, 10, 10, 21, 40), agora), { hora: '21:40', amanha: false, texto: 'às 21:40' });
  });

  caso('cada canal tem o texto do cartão e o nome na frase do botão', () => {
    for (const c of ['cardapio', 'ifood', 'food99']) {
      assert.ok(p.DESCRICAO_DO_CANAL[c], c);
      assert.ok(p.NOME_NA_FRASE[c], c);
    }
  });

  console.log(`\n${n} grupos de casos: tudo certo.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
