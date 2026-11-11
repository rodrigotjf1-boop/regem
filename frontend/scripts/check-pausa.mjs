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

  caso('F2: o contador — segundos até o fim, "12:34" ou "1:02:03", e zero depois do fim', () => {
    const agora = Date.UTC(2026, 10, 11, 0, 10, 0);
    assert.equal(p.segundosAte('2026-11-11T00:22:34Z', agora), 754);
    assert.equal(p.segundosAte('2026-11-11T00:09:00Z', agora), 0);
    assert.equal(p.segundosAte('2026-11-11T00:10:00.400Z', agora), 1); // fração de segundo conta como 1 (não some antes)
    assert.equal(p.relogioDaPausa(754), '12:34');
    assert.equal(p.relogioDaPausa(59), '00:59');
    assert.equal(p.relogioDaPausa(3723), '1:02:03');
    assert.equal(p.relogioDaPausa(-5), '00:00');
  });

  caso('F2: a hora do aviso — faltam N min ou menos, com o aviso ligado; depois do fim, não', () => {
    assert.equal(p.naHoraDoAviso(300, 5), true);
    assert.equal(p.naHoraDoAviso(301, 5), false);
    assert.equal(p.naHoraDoAviso(10, 0), false); // "Não avisar"
    assert.equal(p.naHoraDoAviso(10, undefined), false); // servidor antigo, sem o aviso
    assert.equal(p.naHoraDoAviso(0, 5), false);
    assert.equal(p.faltamTexto(179), 'Faltam 3 min');
    assert.equal(p.faltamTexto(60), 'Falta 1 min');
    assert.equal(p.faltamTexto(42), 'Falta menos de 1 min');
  });

  caso('F3: a mensagem da pausa dá o MESMO texto do servidor (os casos de casos-mensagem-da-pausa.json)', () => {
    const casos = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'casos-mensagem-da-pausa.json'), 'utf8'));
    for (const c of casos.casos) assert.equal(p.montarMensagemDaPausa(c.modelo ?? casos.padrao, c.dados, { semDestaque: c.semDestaque }), c.esperado, c.nome);
    assert.equal(p.primeiroNome('ANA PAULA'), 'Ana');
    assert.equal(p.primeiroNome('5521999990000'), '');
  });

  caso('cada canal tem o texto do cartão e o nome na frase do botão', () => {
    for (const c of ['cardapio', 'ifood', 'food99']) {
      assert.ok(p.DESCRICAO_DO_CANAL[c], c);
      assert.ok(p.NOME_NA_FRASE[c], c);
    }
  });

  caso('F5: a pausa no iFood e na 99 como a faixa diz (pedindo, pausada lá, erro) e a cor de cada uma', () => {
    assert.deepEqual(p.situacaoNoCanal('ifood', { situacao: 'aplicada', erro: null }), { texto: 'Pausado no iFood pelo Regem', tom: 'ok' });
    assert.deepEqual(p.situacaoNoCanal('food99', { situacao: 'aplicada', erro: null }), {
      texto: 'Pausada na 99 pelo Regem (a 99 confirma em instantes)',
      tom: 'ok',
    });
    assert.deepEqual(p.situacaoNoCanal('ifood', { situacao: 'pausando', erro: null }), { texto: 'Pedindo a pausa ao iFood…', tom: 'espera' });
    assert.equal(
      p.situacaoNoCanal('food99', { situacao: 'pausando', erro: 'A 99 não respondeu agora — o Regem tenta de novo.' }).texto,
      'Pedindo a pausa à 99… (A 99 não respondeu agora — o Regem tenta de novo.)',
    );
    assert.deepEqual(p.situacaoNoCanal('ifood', { situacao: 'erro', erro: 'sem permissão' }), { texto: 'Não pausou no iFood: sem permissão', tom: 'erro' });
  });

  caso('F5: a 99 "até o fim do dia" não estende (mais de 35 min); o resto estende; a prévia do fim do dia é 23:59', () => {
    assert.equal(p.daPraEstender('food99', 30 * 60), true);
    assert.equal(p.daPraEstender('food99', 36 * 60), false);
    assert.equal(p.daPraEstender('ifood', 5 * 3600), true);
    const fim = p.fimDaPrevia({ fimDoDia: true }, new Date(2026, 10, 10, 21, 10));
    assert.equal(`${fim.getHours()}:${fim.getMinutes()}`, '23:59');
  });

  caso('"Todos os canais": marca todos (ou desmarca, se já estão); um a um também chega a "todos"; o botão diz "todos"', () => {
    const tres = ['cardapio', 'ifood', 'food99'];
    assert.deepEqual([...p.alternarTodos(new Set(['ifood']), tres)].sort(), ['cardapio', 'food99', 'ifood']);
    assert.deepEqual([...p.alternarTodos(new Set(tres), tres)], []);
    assert.equal(p.todosMarcados(new Set(['cardapio', 'food99', 'ifood']), tres), true);
    assert.equal(p.todosMarcados(new Set(['cardapio', 'ifood']), tres), false);
    assert.equal(p.todosMarcados(new Set(['cardapio']), ['cardapio']), false); // com um canal só, não há "todos"
    assert.equal(p.rotuloDoPausar([], tres), '⏸ Pausar');
    assert.equal(p.rotuloDoPausar(['ifood'], tres), '⏸ Pausar o iFood');
    assert.equal(p.rotuloDoPausar(['cardapio', 'food99'], tres), '⏸ Pausar 2 canais');
    assert.equal(p.rotuloDoPausar(tres, tres), '⏸ Pausar todos os canais');
    assert.equal(p.rotuloDoPausar(['cardapio', 'ifood'], ['cardapio', 'ifood']), '⏸ Pausar todos os canais');
    assert.equal(p.listaDeNomes(['Cardápio digital', 'iFood', '99']), 'Cardápio digital, iFood e 99');
    assert.equal(p.listaDeNomes(['Cardápio digital', '99']), 'Cardápio digital e 99');
  });

  console.log(`\n${n} grupos de casos: tudo certo.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
