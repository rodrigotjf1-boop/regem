// Confere as regras da tela "Rota da cozinha" (`src/lib/rota-cozinha.ts`; onda 2 da auditoria do KDS, mig 410):
//  · mover (antes, depois, junto, etapa nova), tirar, incluir e o "vai para" ajustado depois de cada mudança;
//  · o resumo do diálogo de salvar e os motivos de recusa — os MESMOS textos do servidor (`backend/src/common/rota-kds.ts`);
//  · milhares de edições aleatórias: toda rota que a tela deixa salvar passa na conferência do servidor, e nenhuma fica
//    em círculo (o "vai para" sempre aponta para uma etapa depois).
// Uso: npm run check:rota-cozinha
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const aqui = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'check-rota-cozinha-'));
async function carregar(caminho, nome) {
  const js = ts.transpileModule(readFileSync(caminho, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  writeFileSync(join(tmp, nome), js);
  return import(pathToFileURL(join(tmp, nome)).href);
}
const R = await carregar(join(aqui, '..', 'src', 'lib', 'rota-cozinha.ts'), 'rota.mjs');
const S = await carregar(join(aqui, '..', '..', 'backend', 'src', 'common', 'rota-kds.ts'), 'servidor.mjs');

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};
const k = (id, nome, o = {}) => ({ id, nome, escopo: 'producao', ativo: true, proximoKdsId: null, ...o });
// A lanchonete do protótipo: Chapa e Fritadeira (desligada) → Montagem → Despacho; Sobremesas ligado fora da rota.
const LANCH = [
  k('chapa', 'Chapa', { proximoKdsId: 'mont' }),
  k('frita', 'Fritadeira', { ativo: false, proximoKdsId: 'desp' }),
  k('mont', 'Montagem', { proximoKdsId: 'desp', imprimeAoAvancar: true, imprimeNoStatus: 'pronto', impressora: 'Impressora do balcão' }),
  k('desp', 'Despacho', { escopo: 'despacho', imprimeAoAvancar: true, imprimeNoStatus: 'entregue', impressora: 'Impressora do balcão' }),
  k('sobre', 'Sobremesas'),
  k('velho', 'KDS antigo', { ativo: false, proximoKdsId: 'mont' }), // desligado fora da rota: não entra na edição
];
const ROTA = { etapas: [{ nome: 'Preparo', kds: ['chapa', 'frita'] }, { nome: '', kds: ['mont'] }, { nome: 'Despacho', kds: ['desp'] }], kds: LANCH };
const nomeDe = (kds) => (id) => kds.find((x) => x.id === id)?.nome ?? id;

try {
  caso('iniciar: o "vai para" de cada um, os ligados fora da rota e quem já termina antes do fim', () => {
    const ed = R.iniciarEdicao(ROTA);
    assert.deepEqual(ed.fora, ['sobre']);
    assert.equal(ed.vai.chapa, 'mont');
    assert.equal(ed.vai.frita, 'desp');
    assert.equal(ed.vai.desp, null);
    assert.deepEqual(ed.termina, {});
    // Quem termina antes da última etapa fica marcado e o ajuste não o leva adiante.
    const r2 = { etapas: [{ nome: '', kds: ['chapa'] }, { nome: '', kds: ['desp'] }], kds: [k('chapa', 'Chapa'), k('desp', 'Despacho', { escopo: 'despacho' })] };
    const e2 = R.iniciarEdicao(r2);
    assert.equal(e2.termina.chapa, true);
    assert.equal(e2.vai.chapa, null);
  });

  caso('mover: "Depois" troca de etapa; o "vai para" que ficou para trás volta para a etapa seguinte', () => {
    let ed = R.iniciarEdicao({ etapas: [{ nome: '', kds: ['chapa'] }, { nome: '', kds: ['mont'] }, { nome: '', kds: ['desp'] }], kds: LANCH });
    ed = R.mover(ed, 'chapa', { tipo: 'depois' }, LANCH);
    assert.deepEqual(ed.etapas.map((e) => e.kds), [['mont'], ['chapa'], ['desp']]);
    assert.equal(ed.vai.mont, 'desp'); // a Montagem mandava para o Despacho (ainda depois dela) — fica
    assert.equal(ed.vai.chapa, 'desp'); // a Chapa mandava para a Montagem, agora atrás: vai para a etapa seguinte
    // Na mesma etapa de outro (paralelo): "Antes" abre uma etapa só dele.
    let p = R.mover(ed, 'chapa', { tipo: 'junto', etapa: 0 }, LANCH);
    assert.deepEqual(p.etapas.map((e) => e.kds), [['mont', 'chapa'], ['desp']]);
    p = R.mover(p, 'chapa', { tipo: 'antes' }, LANCH);
    assert.deepEqual(p.etapas.map((e) => e.kds), [['chapa'], ['mont'], ['desp']]);
    // Na ponta não anda; o original não muda (cada mudança devolve uma cópia).
    assert.equal(R.mover(p, 'chapa', { tipo: 'antes' }, LANCH), p);
    assert.deepEqual(ed.etapas.map((e) => e.kds), [['mont'], ['chapa'], ['desp']]);
  });

  caso('tirar e incluir: fora da rota termina nele; incluir entra na etapa 1', () => {
    let ed = R.iniciarEdicao(ROTA);
    ed = R.tirar(ed, 'mont', LANCH);
    assert.deepEqual(ed.etapas.map((e) => e.kds), [['chapa', 'frita'], ['desp']]);
    assert.ok(ed.fora.includes('mont'));
    assert.equal(ed.vai.mont, null);
    assert.equal(ed.vai.chapa, 'desp'); // a Montagem saiu: a Chapa vai à etapa seguinte
    ed = R.incluir(ed, 'sobre', LANCH);
    assert.deepEqual(ed.etapas[0].kds, ['chapa', 'frita', 'sobre']);
    assert.equal(ed.vai.sobre, 'desp');
    assert.ok(!ed.fora.includes('sobre'));
    assert.equal(R.incluir(ed, 'velho', LANCH), ed); // o desligado fora da rota não entra
  });

  caso('"vai para": as opções são só de etapas depois; "termina aqui" fica', () => {
    let ed = R.iniciarEdicao(ROTA);
    assert.deepEqual(R.opcoesDoVai(ed, 'chapa'), [{ id: 'mont', etapa: 2 }, { id: 'desp', etapa: 3 }]);
    assert.deepEqual(R.opcoesDoVai(ed, 'desp'), []);
    ed = R.escolherVai(ed, 'chapa', null, LANCH);
    assert.equal(ed.vai.chapa, null);
    ed = R.mover(ed, 'mont', { tipo: 'nova', pos: 0 }, LANCH);
    assert.equal(ed.vai.chapa, null, 'quem a pessoa marcou "termina aqui" continua terminando');
  });

  caso('o resumo do salvar: o que muda em cada KDS e as etapas', () => {
    let ed = R.iniciarEdicao(ROTA);
    ed = R.tirar(ed, 'mont', LANCH);
    ed = R.renomear(ed, 0, '  Chapa e fritura  ');
    const { linhas, motivos } = R.resumoDaEdicao(ROTA, ed);
    assert.deepEqual(motivos, []);
    assert.deepEqual(linhas, [
      { quem: 'Chapa', texto: 'vai para Montagem → vai para Despacho' },
      { quem: 'Montagem', texto: 'vai para Despacho → fora da rota (termina nele); os produtos continuam nele' },
      { quem: 'Despacho', texto: 'etapa 3 → etapa 2 (o "vai para" não muda)' },
      { quem: 'Etapas', texto: '1 · Preparo, 2 · Etapa 2, 3 · Despacho → 1 · Chapa e fritura, 2 · Despacho' },
    ]);
    assert.deepEqual(R.resumoDaEdicao(ROTA, R.iniciarEdicao(ROTA)).linhas, []);
  });

  caso('despacho fora do fim: a tela recusa com o MESMO texto do servidor', () => {
    let ed = R.iniciarEdicao(ROTA);
    ed = R.mover(ed, 'desp', { tipo: 'nova', pos: 0 }, LANCH);
    assert.equal(R.despachoNoFim(ed, LANCH), false);
    assert.equal(R.valeMover(R.iniciarEdicao(ROTA), 'desp', { tipo: 'nova', pos: 0 }, LANCH), false);
    const tela = R.resumoDaEdicao(ROTA, ed).motivos;
    const salvar = R.paraSalvar(ed);
    const servidor = S.conferirRota(salvar.etapas, salvar.vai, LANCH, nomeDe(LANCH)).motivos;
    assert.ok(tela.length && tela.every((m) => servidor.includes(m)), `${tela} × ${servidor}`);
    assert.deepEqual(R.resumoDaEdicao(ROTA, { etapas: [], vai: {}, termina: {}, fora: [] }).motivos, ['A rota precisa de pelo menos um KDS.']);
  });

  caso('o próximo de verdade pula o desligado (como o servidor) e quem recebe de quem', () => {
    const kds = [k('a', 'A', { proximoKdsId: 'b' }), k('b', 'B', { ativo: false, proximoKdsId: 'c' }), k('c', 'C'), k('x', 'X', { proximoKdsId: 'fora' })];
    assert.equal(R.proximoDeVerdade(kds, 'a'), 'c');
    assert.equal(R.proximoDeVerdade(kds, 'x'), null);
    assert.equal(R.proximoDeVerdade([k('p', 'P', { proximoKdsId: 'q' }), k('q', 'Q', { ativo: false, proximoKdsId: 'p' })], 'p'), null);
    assert.deepEqual(R.recebeDe(kds, 'c').map((x) => x.id), ['a']);
    assert.deepEqual(
      R.passosDoCaminho(LANCH, ROTA.etapas, ['chapa', 'mont', 'desp', 'sobre']).map((p) => p.detalhe),
      ['só avança', 'imprime ao ficar pronto · Impressora do balcão', 'imprime ao despachar · Impressora do balcão', 'fora da rota: termina aqui'],
    );
  });

  caso('5.000 edições aleatórias: o que a tela deixa salvar o servidor aceita, sem círculo; o que ela recusa o servidor recusa', () => {
    let semente = 20261111;
    const rnd = (n) => {
      semente = (semente * 1103515245 + 12345) % 2147483648;
      return semente % n;
    };
    const exemplos = [
      ROTA,
      { etapas: [{ nome: '', kds: ['coz'] }], kds: [k('coz', 'Cozinha')] },
      {
        etapas: [{ nome: '', kds: ['m'] }, { nome: '', kds: ['f'] }, { nome: '', kds: ['c'] }],
        kds: [k('m', 'Montagem', { proximoKdsId: 'f' }), k('f', 'Forno', { proximoKdsId: 'c' }), k('c', 'Corte', { escopo: 'despacho' }), k('bar', 'Bar'), k('sal', 'Saladas')],
      },
    ];
    let aceitas = 0;
    let recusadas = 0;
    for (let r = 0; r < 5000; r++) {
      const ex = exemplos[r % exemplos.length];
      let ed = R.iniciarEdicao(ex);
      for (let passo = 0; passo < 8; passo++) {
        const naRota = ed.etapas.flatMap((e) => e.kds);
        const op = rnd(7);
        if (op === 5 && ed.fora.length) ed = R.incluir(ed, ed.fora[rnd(ed.fora.length)], ex.kds);
        else if (!naRota.length) continue;
        else {
          const id = naRota[rnd(naRota.length)];
          if (op === 0) ed = R.mover(ed, id, { tipo: 'antes' }, ex.kds);
          else if (op === 1) ed = R.mover(ed, id, { tipo: 'depois' }, ex.kds);
          else if (op === 2) ed = R.mover(ed, id, { tipo: 'junto', etapa: rnd(ed.etapas.length) }, ex.kds);
          else if (op === 3) ed = R.mover(ed, id, { tipo: 'nova', pos: rnd(ed.etapas.length + 1) }, ex.kds);
          else if (op === 4 && rnd(3) === 0) ed = R.tirar(ed, id, ex.kds);
          else {
            const opc = R.opcoesDoVai(ed, id);
            ed = R.escolherVai(ed, id, opc.length && rnd(3) ? opc[rnd(opc.length)].id : null, ex.kds);
          }
        }
        // Nada em círculo: cada "vai para" aponta para uma etapa depois.
        for (const id of ed.etapas.flatMap((e) => e.kds)) {
          const alvo = ed.vai[id];
          if (alvo) assert.ok(R.idxDe(ed.etapas, alvo) > R.idxDe(ed.etapas, id), `círculo: ${id} → ${alvo}`);
        }
        const tela = R.resumoDaEdicao(ex, ed).motivos;
        const s = R.paraSalvar(ed);
        const servidor = S.conferirRota(s.etapas, s.vai, ex.kds, nomeDe(ex.kds));
        if (tela.length) {
          recusadas++;
          assert.ok(servidor.motivos.length, `a tela recusa e o servidor aceita: ${tela}`);
        } else {
          aceitas++;
          assert.deepEqual(servidor.motivos, [], `a tela aceita e o servidor recusa: ${servidor.motivos}`);
          // O servidor grava exatamente o "vai para" que a tela mostrou (e o desligado fora da rota fica como estava).
          for (const x of ex.kds) {
            const esperado = R.idxDe(ed.etapas, x.id) >= 0 ? ed.vai[x.id] ?? null : x.ativo ? null : x.proximoKdsId ?? null;
            assert.equal(servidor.vai[x.id] ?? null, esperado, `vai de ${x.id}`);
          }
        }
      }
    }
    assert.ok(aceitas > 1000 && recusadas > 50, `poucos casos: ${aceitas} aceitas, ${recusadas} recusadas`);
  });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`check:rota-cozinha — ${n} casos OK`);
