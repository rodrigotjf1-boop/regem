// Confere as regras puras do checkout em etapas do cardápio (`components/loja/cardapio/etapas.ts`).
// O frontend não tem runner de testes: este script transpila os dois arquivos com o TypeScript que
// já é dependência do projeto e roda asserts do Node.  Uso: npm run check:etapas
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'loja', 'cardapio');
const tmp = mkdtempSync(join(tmpdir(), 'check-etapas-'));
for (const nome of ['tipos-template', 'etapas']) {
  const js = ts.transpileModule(readFileSync(join(raiz, `${nome}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText.replace("'./tipos-template'", "'./tipos-template.mjs'");
  writeFileSync(join(tmp, `${nome}.mjs`), js);
}
const { etapasAtivas, falta, faltaNoPedido, rotuloAvancar, tituloEtapa } = await import(pathToFileURL(join(tmp, 'etapas.mjs')).href);
const { templateDe, ehTemplate, dadosNaEntrega } = await import(pathToFileURL(join(tmp, 'tipos-template.mjs')).href);

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};
const ctx = (p = {}) => ({ template: 'fluxo', mesaDireta: false, isServico: false, isIndustria: false, expresso: false, ...p });
const chkOk = { tipo: 'entrega', bairroId: 'b1', rua: 'Rua A', numero: '10', nome: 'Ana', telefone: '(21) 97777-6666', forma: 'pix', lat: -22.8, lng: -43.2 };
const est = (p = {}, chk = {}) => ({
  template: 'fluxo',
  qtdItens: 2,
  chk: { ...chkOk, ...chk },
  mesaDireta: false,
  isServico: false,
  isIndustria: false,
  areaRaio: false,
  temBairros: true,
  fechadaSemAgenda: false,
  horarioLabel: 'Abre às 18:00',
  precisaAgendar: false,
  tipoDisponivel: true,
  pagamentos: ['pix', 'entrega'],
  formasCartao: ['Credito'],
  ...p,
});

try {
  caso('template: valor desconhecido ou layout antigo cai no Regem Fluxo', () => {
    for (const v of ['classic', 'fastfood', 'grid', '', null, undefined, 7]) assert.equal(templateDe(v), 'fluxo');
    for (const v of ['galeria', 'balcao', 'oferta', 'fluxo']) assert.equal(templateDe(v), v);
    assert.equal(ehTemplate('Fluxo'), false);
    assert.equal(dadosNaEntrega('balcao'), false);
    assert.equal(dadosNaEntrega('galeria'), true);
  });

  caso('etapas: 3 nos templates com dados na entrega, 4 no Balcão', () => {
    assert.deepEqual(etapasAtivas(ctx({ template: 'galeria' })), ['sacola', 'entrega', 'pagamento']);
    assert.deepEqual(etapasAtivas(ctx({ template: 'oferta' })), ['sacola', 'entrega', 'pagamento']);
    assert.deepEqual(etapasAtivas(ctx()), ['sacola', 'entrega', 'pagamento']);
    assert.deepEqual(etapasAtivas(ctx({ template: 'balcao' })), ['sacola', 'entrega', 'dados', 'pagamento']);
  });

  caso('etapas: mesa só tem a Sacola; expresso é Sacola → Revisar; indústria não tem pagamento', () => {
    assert.deepEqual(etapasAtivas(ctx({ mesaDireta: true, expresso: true })), ['sacola']);
    assert.deepEqual(etapasAtivas(ctx({ expresso: true })), ['sacola', 'revisar']);
    assert.deepEqual(etapasAtivas(ctx({ isIndustria: true })), ['sacola', 'entrega']);
    assert.deepEqual(etapasAtivas(ctx({ template: 'balcao', isIndustria: true })), ['sacola', 'entrega', 'dados']);
  });

  caso('sacola: vazia e loja fechada sem agendamento bloqueiam; fechada com agendamento passa', () => {
    assert.equal(falta('sacola', est({ qtdItens: 0 })).mensagem, 'Sua sacola está vazia');
    assert.equal(falta('sacola', est({ fechadaSemAgenda: true })).mensagem, 'Loja fechada · Abre às 18:00');
    assert.equal(falta('sacola', est({ fechadaSemAgenda: true, horarioLabel: null })).mensagem, 'Loja fechada');
    assert.equal(falta('sacola', est()), null);
  });

  caso('entrega por bairro: bairro → rua, na ordem da tela; número não é exigido', () => {
    assert.equal(falta('entrega', est({}, { bairroId: '' })).campo, 'bairroId');
    assert.equal(falta('entrega', est({ temBairros: false }, { bairroId: '' })).mensagem, 'Esta loja ainda não tem área de entrega');
    assert.equal(falta('entrega', est({}, { rua: '  ' })).campo, 'rua');
    assert.equal(falta('entrega', est({}, { numero: '' })), null);
  });

  caso('entrega por raio: não pede bairro, pede a localização', () => {
    assert.equal(falta('entrega', est({ areaRaio: true }, { bairroId: '' })), null);
    assert.equal(falta('entrega', est({ areaRaio: true }, { bairroId: '', lat: '', lng: '' })).campo, 'localizacao');
  });

  caso('retirada não pede endereço; tipo indisponível bloqueia', () => {
    assert.equal(falta('entrega', est({}, { tipo: 'retirada', bairroId: '', rua: '' })), null);
    assert.equal(falta('entrega', est({ tipoDisponivel: false })).mensagem, 'Entrega indisponível agora');
    assert.equal(falta('entrega', est({ tipoDisponivel: false }, { tipo: 'retirada' })).mensagem, 'Retirada indisponível agora');
  });

  caso('agendamento obrigatório quando o pedido é agendado (e nos serviços)', () => {
    assert.equal(falta('entrega', est({ precisaAgendar: true }, { agendamento: '' })).campo, 'agendamento');
    assert.equal(falta('entrega', est({ precisaAgendar: true }, { agendamento: '2026-10-02T19:30' })), null);
    assert.equal(falta('entrega', est({ isServico: true, precisaAgendar: true }, { agendamento: '', bairroId: '', rua: '' })).mensagem, 'Escolha o dia e a hora');
  });

  caso('dados: nome e telefone com DDD; na entrega só nos templates sem a etapa Dados', () => {
    assert.equal(falta('entrega', est({}, { nome: '' })).campo, 'nome');
    assert.equal(falta('entrega', est({}, { telefone: '9777-6666' })).campo, 'telefone');
    assert.equal(falta('entrega', est({ template: 'balcao' }, { nome: '', telefone: '' })), null);
    assert.equal(falta('dados', est({ template: 'balcao' }, { nome: '' })).campo, 'nome');
    assert.equal(falta('dados', est({ mesaDireta: true }, { nome: '', telefone: '' })), null);
  });

  caso('pagamento: forma, bandeira do cartão e documento da nota', () => {
    assert.equal(falta('pagamento', est({}, { forma: '' })).campo, 'forma');
    assert.equal(falta('pagamento', est({ pagamentos: [] }, { forma: '' })), null);
    assert.equal(falta('pagamento', est({ isIndustria: true }, { forma: '' })), null);
    assert.equal(falta('pagamento', est({}, { forma: 'cartao' })).campo, 'bandeira');
    assert.equal(falta('pagamento', est({ formasCartao: [] }, { forma: 'cartao' })), null);
    assert.equal(falta('pagamento', est({}, { cupomFiscal: true, cpf: '123' })).campo, 'cpf');
    assert.equal(falta('pagamento', est({}, { cupomFiscal: true, cpf: '123.456.789-09' })), null);
    assert.equal(falta('pagamento', est({}, { cupomFiscal: true, cpf: '36219750000104' })), null);
  });

  caso('revisar (expresso) confere tudo de uma vez, na ordem entrega → dados → pagamento', () => {
    assert.equal(falta('revisar', est()), null);
    assert.equal(falta('revisar', est({}, { bairroId: '', nome: '', forma: '' })).campo, 'bairroId');
    assert.equal(falta('revisar', est({}, { nome: '', forma: '' })).campo, 'nome');
    assert.equal(falta('revisar', est({}, { forma: '' })).campo, 'forma');
  });

  caso('faltaNoPedido aponta a primeira etapa com pendência', () => {
    const e = ['sacola', 'entrega', 'pagamento'];
    assert.equal(faltaNoPedido(e, est()), null);
    assert.equal(faltaNoPedido(e, est({}, { forma: '' })).etapa, 'pagamento');
    assert.equal(faltaNoPedido(e, est({}, { rua: '', forma: '' })).etapa, 'entrega');
  });

  caso('rótulos do botão e títulos das etapas', () => {
    const r = (p) => rotuloAvancar({ etapa: 'pagamento', proxima: null, mesaDireta: false, isServico: false, isIndustria: false, agendado: false, tipo: 'entrega', ...p });
    assert.equal(r({ etapa: 'sacola', proxima: 'entrega' }), 'Continuar');
    assert.equal(r({ etapa: 'sacola', proxima: 'revisar' }), 'Revisar e pedir');
    assert.equal(r({ etapa: 'entrega', proxima: 'pagamento', tituloProxima: 'Pagamento' }), 'Ir para pagamento');
    assert.equal(r({}), 'Fazer pedido');
    assert.equal(r({ tipo: 'retirada' }), 'Confirmar pedido');
    assert.equal(r({ agendado: true }), 'Agendar pedido');
    assert.equal(r({ etapa: 'sacola', mesaDireta: true }), 'Enviar pedido');
    assert.equal(r({ isIndustria: true }), 'Solicitar orçamento');
    assert.equal(r({ isServico: true }), 'Confirmar agendamento');
    assert.equal(tituloEtapa('entrega', { template: 'fluxo', isServico: false, tipo: 'entrega' }), 'Entrega e contato');
    assert.equal(tituloEtapa('entrega', { template: 'balcao', isServico: false, tipo: 'retirada' }), 'Retirada');
    assert.equal(tituloEtapa('entrega', { template: 'fluxo', isServico: true, tipo: 'retirada' }), 'Atendimento');
  });

  console.log(`\n${n} grupos de casos: tudo certo.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
