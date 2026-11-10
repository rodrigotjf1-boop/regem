// Confere as regras da ficha do candidato no navegador (`src/lib/vagas-ficha.ts`, mig 389) e que as LISTAS de opções
// da tela são as mesmas que o servidor aceita (`backend/src/modules/vagas/vagas.ts`, lidas como texto — o arquivo do
// servidor importa o Nest). Mudou uma lista lá, este script reprova até mudar aqui. Uso: npm run check:vagas
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..', 'src', 'lib');
const tmp = mkdtempSync(join(tmpdir(), 'check-vagas-'));
writeFileSync(
  join(tmp, 'vagas-ficha.mjs'),
  ts.transpileModule(readFileSync(join(raiz, 'vagas-ficha.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText,
);
const v = await import(pathToFileURL(join(tmp, 'vagas-ficha.mjs')).href);
const servidor = readFileSync(join(aqui, '..', '..', 'backend', 'src', 'modules', 'vagas', 'vagas.ts'), 'utf8');
const listaDoServidor = (nome) => {
  const m = servidor.match(new RegExp(`export const ${nome} = \\[([^\\]]*)\\] as const`));
  assert.ok(m, `lista ${nome} não achada no servidor`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};

const HOJE = '2026-11-10';
const pagina = {
  loja: { nome: 'Loja Teste', logoRef: null, logoEmoji: null },
  cores: { principal: null, destaque: null },
  pagina: {
    titulo: 't', frase: 'f',
    funcoes: [
      { codigo: 'chapeiro', nome: 'Chapeiro(a)', salario: 'R$ 1.900,00', lideranca: false },
      { codigo: 'gerencia', nome: 'Gerência', salario: 'R$ 2.500,00', lideranca: true },
    ],
    beneficios: [], vagaFixa: true, horista: true,
    horarios: { '12x36': { ativa: true, inicio: '15:00', fim: '03:00' }, '5x2': { ativa: true, inicio: '19:00', fim: '03:00' }, horista: { ativa: true, inicio: '19:00', fim: '03:00', dias: ['sex', 'sab', 'dom'] } },
    idadeMinima: 18, guardaMeses: 12, perguntas: { cnh: true, feriados: true, ja_trabalhou: true, indicacao: true, sobre: true },
  },
  termos: { guarda: '', comunicacao: { resumo: '', texto: [] } },
};
const ficha = (extra = {}) => ({ ...v.fichaVazia('qr_loja'), ...extra });
const campos = (n, f) => v.errosDaEtapa(n, f, pagina, HOJE).map((e) => e.campo);

try {
  caso('as listas da tela são as do servidor', () => {
    const pares = [
      ['SETORES', v.SETOR_ROTULO], ['DIAS', v.DIA_ROTULO], ['TEMPOS', v.TEMPO_ROTULO], ['VINCULOS', v.VINCULO_ROTULO],
      ['CARGOS', v.CARGO_ROTULO], ['EQUIPES', v.EQUIPE_ROTULO], ['GRAU_ATUAL', v.GRAU_ATUAL_ROTULO], ['GRAU_FINAL', v.GRAU_FINAL_ROTULO],
      ['TURNOS_ESTUDO', v.TURNO_ESTUDO_ROTULO], ['MEIOS', v.MEIO_ROTULO], ['UBER_MOTIVOS', v.UBER_ROTULO], ['COMECA', v.COMECA_ROTULO],
      ['SEXOS', v.SEXO_ROTULO], ['ORIGENS_DECLARADAS', v.ORIGEM_ROTULO], ['SITUACOES', v.SITUACAO_ROTULO],
    ];
    for (const [nome, mapa] of pares) assert.deepEqual(Object.keys(mapa).sort(), listaDoServidor(nome).sort(), nome);
  });

  caso('etapa 1: nome com sobrenome, idade mínima, WhatsApp com DDD (com ou sem o 55)', () => {
    assert.deepEqual(campos(1, ficha({ nome: 'Maria', nascimento: '2012-01-01', whatsapp: '123' })), ['nome', 'nascimento', 'whatsapp']);
    assert.deepEqual(campos(1, ficha({ nome: 'Maria Silva', nascimento: '2000-05-10', whatsapp: '+55 21 3333-0000' })), []);
    assert.equal(v.idadeEm('2000-11-11', HOJE), 25);
  });

  caso('etapa 3: o horista pede os dias; a vaga fixa pede a escala', () => {
    assert.deepEqual(campos(3, ficha({ tipo: 'horista' })), ['dias']);
    assert.deepEqual(campos(3, ficha({ tipo: 'fixa' })), ['escala']);
    assert.deepEqual(campos(3, ficha({ tipo: 'tanto', escala: '12x36', dias: ['sex'] })), []);
  });

  caso('etapa 4: cargo de liderança marcado pede a liderança com descrição', () => {
    const f = ficha({ funcoes: ['gerencia'], experiencia: 'primeiro', liderou: 'sim', lids: [{ id: 'a', cargo: 'gerente', empresa: 'X', equipe: 'ate5', tempo: '2a', vinculo: 'carteira', descricao: '' }] });
    assert.deepEqual(campos(4, f), ['lids']);
    assert.deepEqual(campos(4, ficha({ funcoes: ['chapeiro'], experiencia: 'primeiro' })), []);
  });

  caso('etapa 6: transporte público pede conduções; Uber pede o motivo; os dois pedem o valor', () => {
    const base = { cep: '20000-000', numero: '1', bairro: 'Centro', cidade: 'Rio' };
    assert.deepEqual(campos(6, ficha({ ...base, meio: ['publico', 'uber'] })), ['conducoes', 'uber_motivo', 'valor']);
    assert.deepEqual(campos(6, ficha({ ...base, meio: ['pe'] })), []);
    assert.deepEqual(campos(6, ficha({ ...base, meio: ['uber'], uber_motivo: 'outro', valor_ida: '4,70', valor_volta: '18,00' })), ['uber_motivo']);
  });

  caso('etapa 7: o consentimento da guarda é obrigatório; o termo de mensagens não', () => {
    assert.deepEqual(campos(7, ficha({ trabalhando: 'nao', comeca: 'imediato' })), ['consentimento']);
    assert.deepEqual(campos(7, ficha({ trabalhando: 'nao', comeca: 'imediato', consentimento: true, comunicacao: false })), []);
  });

  caso('valor em reais pela máscara e o corpo do envio no formato do servidor', () => {
    assert.equal(v.mascaraReais('470'), '4,70');
    assert.equal(v.mascaraReais('1800'), '18,00');
    assert.equal(v.brl(v.reais('4,70') + v.reais('18,00')), 'R$ 22,70');
    const c = v.corpoDoEnvio(
      ficha({ tipo: 'fixa', escala: '12x36', dias: ['sex'], experiencia: 'primeiro', estuda: 'nao', grau_final: 'medio', meio: ['pe'], valor_ida: '9,99', exps: [{ id: 'x', empresa: 'A' }] }),
      'balcao',
    );
    assert.equal(c.escala, '12x36');
    assert.deepEqual(c.dias, []); // vaga fixa não manda os dias
    assert.deepEqual(c.exps, []); // primeiro emprego não manda experiência
    assert.equal(c.valor_ida, undefined); // a pé não manda valor
    assert.equal(c.estuda, false);
    assert.equal(c.origem, 'balcao');
  });

  caso('a origem do link vira "como ficou sabendo"', () => {
    assert.equal(v.origemDeclaradaDoLink('balcao'), 'qr_loja');
    assert.equal(v.origemDeclaradaDoLink('instagram'), 'instagram');
    assert.equal(v.origemDeclaradaDoLink('robo'), 'whatsapp');
    assert.equal(v.origemDeclaradaDoLink(null), '');
    assert.equal(v.horarioTexto({ ativa: true, inicio: '15:00', fim: '03:00' }), 'das 15h às 3h');
  });

  console.log(`check-vagas: ${n} casos OK`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
