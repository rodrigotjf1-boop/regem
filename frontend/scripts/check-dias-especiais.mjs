// Confere as regras do dia especial do horário na tela (`src/lib/dia-especial.ts`, H1b da mig 512) contra a regra do
// servidor (`backend/src/common/horario-da-data.ts`), lado a lado (V74): a escolha do dia especial de um dia pelo tipo do
// pedido (o "Para quando?"), a próxima abertura depois de um dia fechado (a prévia da gaveta = a faixa do cardápio), o
// horário da semana de um dia e as frases. O frontend não tem runner de testes: este script transpila os dois arquivos
// com o TypeScript do projeto e roda asserts do Node.
// Uso: npm run check:dias-especiais
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const aqui = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'check-dias-especiais-'));
const carregar = async (arquivo, nome) => {
  writeFileSync(
    join(tmp, nome),
    ts.transpileModule(readFileSync(arquivo, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText,
  );
  return import(pathToFileURL(join(tmp, nome)).href);
};
const tela = await carregar(join(aqui, '..', 'src', 'lib', 'dia-especial.ts'), 'tela.mjs');
const servidor = await carregar(join(aqui, '..', '..', 'backend', 'src', 'common', 'horario-da-data.ts'), 'servidor.mjs');

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};

// A semana de exemplo (a do protótipo): segunda fechada, terça a quinta 18:00–23:00, sexta e sábado 18:00–00:00, domingo
// 18:00–23:00. `dia` = 0 domingo … 6 sábado, como o `Horarios` das configurações grava.
const SEMANA = [
  { dia: 0, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 1, abre: '18:00', fecha: '23:00', ativo: false },
  { dia: 2, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 3, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 4, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 5, abre: '18:00', fecha: '00:00', ativo: true },
  { dia: 6, abre: '18:00', fecha: '00:00', ativo: true },
];
const especial = (p) => ({ id: p.nome, dataFim: null, abre: null, fecha: null, conjunto: 'todos', avisoAntes: true, pausarCanais: true, ...p });
// Meio-dia em São Paulo do dia (o servidor lê a hora de São Paulo).
const meioDiaSP = (d) => new Date(`${d}T15:00:00Z`);

caso('o horário da semana de um dia é o mesmo dos dois lados (fechado, aberto, ativo ausente, duas aberturas)', () => {
  const comDuas = [...SEMANA.filter((h) => h.dia !== 3), { dia: 3, abre: '19:00', fecha: '23:00' }, { dia: 3, abre: '11:00', fecha: '14:00' }];
  for (const [semana, dia] of [[SEMANA, '2026-12-21'], [SEMANA, '2026-12-25'], [comDuas, '2026-12-23'], [SEMANA, '2026-12-27']]) {
    const ab = servidor.aberturasDoDia(semana, [], dia);
    assert.deepEqual(tela.normalDoDia(semana, dia), ab === 'dia_inteiro' ? null : ab[0] ?? null, `dia ${dia}`);
  }
  assert.deepEqual(tela.normalDoDia(comDuas, '2026-12-23'), { abre: '11:00', fecha: '14:00' });
});

caso('a próxima abertura depois do dia fechado é a do servidor visto no primeiro dia (prévia = faixa do cardápio)', () => {
  const casos = [
    { nome: 'Natal', data: '2026-12-25', dataFim: null, semana: SEMANA, espera: 'sáb 18:00' },
    { nome: 'Domingo fechado, segunda já fechada', data: '2026-12-27', dataFim: null, semana: SEMANA, espera: 'ter 18:00' },
    { nome: 'Reforma da cozinha', data: '2027-01-12', dataFim: '2027-01-14', semana: SEMANA, espera: 'sex 18:00' },
    { nome: 'Férias coletivas', data: '2027-01-04', dataFim: '2027-01-12', semana: SEMANA, espera: '13/01 18:00' },
    { nome: 'Loja sem horário da semana', data: '2026-12-25', dataFim: null, semana: [], espera: 'sáb 00:00' },
  ];
  for (const c of casos) {
    const e = especial({ nome: c.nome, data: c.data, dataFim: c.dataFim, funcionamento: 'fechada' });
    const doServidor = servidor.proximaAberturaDaData(c.semana, [e], meioDiaSP(c.data));
    assert.equal(doServidor, c.espera, `servidor, ${c.nome}`);
    assert.equal(tela.proximaAberturaDepois(c.data, c.dataFim ?? c.data, c.semana), doServidor, `tela, ${c.nome}`);
  }
});

caso('o dia especial de um dia pelo tipo do pedido é o mesmo dos dois lados (o "Para quando?")', () => {
  const lista = [
    especial({ nome: 'Natal', data: '2026-12-25', funcionamento: 'fechada' }),
    especial({ nome: 'Véspera de Natal', data: '2026-12-24', funcionamento: 'horario', abre: '18:00', fecha: '21:00' }),
    especial({ nome: 'Só a entrega fechada', data: '2026-12-31', funcionamento: 'fechada', conjunto: 'entrega' }),
    especial({ nome: 'Só a retirada mais cedo', data: '2027-01-02', funcionamento: 'horario', abre: '17:00', fecha: '20:00', conjunto: 'retirada' }),
    especial({ nome: 'Reforma da cozinha', data: '2027-01-12', dataFim: '2027-01-14', funcionamento: 'fechada' }),
  ];
  const dias = ['2026-12-23', '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-31', '2027-01-02', '2027-01-12', '2027-01-13', '2027-01-14', '2027-01-15'];
  for (const tipo of ['entrega', 'retirada'])
    for (const dia of dias) {
      const doServidor = servidor.especialDaData(servidor.especiaisDoTipo(lista, tipo), dia);
      assert.equal(tela.especialDoDia(lista, dia, tipo)?.nome ?? null, doServidor?.nome ?? null, `${tipo} ${dia}`);
    }
  assert.equal(tela.especialDoDia(lista, '2026-12-31', 'retirada'), null);
  assert.equal(tela.especialDoDia(lista, '2026-12-31', 'entrega')?.nome, 'Só a entrega fechada');
  assert.equal(tela.especialDoDia(null, '2026-12-25', 'entrega'), null);
});

caso('as frases: a faixa de horas (com a virada da meia-noite), a volta e o outro horário', () => {
  assert.equal(tela.faixaDeHoras('18:00', '21:00'), 'das 18:00 às 21:00');
  assert.equal(tela.faixaDeHoras('20:00', '02:00'), 'das 20:00 às 02:00 do dia seguinte');
  assert.equal(tela.fraseDaVolta('18:00'), 'Voltamos às 18:00.');
  assert.equal(tela.fraseDaVolta('sáb 18:00'), 'Voltamos sáb às 18:00.');
  assert.equal(tela.fraseDaVolta('13/01 18:00'), 'Voltamos 13/01 às 18:00.');
  assert.deepEqual(tela.textosDoOutroHorario('Véspera de Natal', '18:00', '21:00'), {
    titulo: 'Hoje abrimos das 18:00 às 21:00',
    texto: 'Horário especial de Véspera de Natal.',
  });
});

caso('as datas: dia da semana, por extenso, somar dias (virada de mês e de ano) e a contagem do período', () => {
  assert.equal(tela.porExtenso('2026-12-25'), 'Sexta, 25/12');
  assert.equal(tela.somarDias('2026-12-30', 3), '2027-01-02');
  assert.equal(tela.somarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(tela.diasEntre('2027-01-12', '2027-01-14'), 3);
  assert.equal(tela.dataValida('2026-12-25'), true);
  assert.equal(tela.dataValida('25/12/2026'), false);
  for (const d of ['2026-12-21', '2026-12-25', '2027-01-03']) assert.equal(tela.diaDaSemana(d), servidor.diaDaSemanaDe(d), d);
});

rmSync(tmp, { recursive: true, force: true });
console.log(`check:dias-especiais — ${n} casos ok`);
