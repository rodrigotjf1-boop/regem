import { TAREFAS_ABERTAS } from './mapa/tarefas-abertas';
import { funcaoDoMapa } from './mapa/busca-no-mapa';
import { TEXTOS_DAS_TAREFAS, apresentacaoDaTarefa, camposParaAIa, pedidoDaTarefa, procurarTarefas, tarefasNoMister } from './mister-tarefas';
import { procurarTelas } from './mister-telas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Versão 10, C4a: fazer uma tarefa pelo mapa — a conferência do pedido e o "Vou fazer" do Regem (puro). A escrita de verdade,
// com o bilhete preso ao método e ao corpo, está em `auth/bilhete-do-mister-pg.spec.ts`.

const LOJA = { unidadeId: '11111111-1111-4111-8111-111111111111' };
const ID = '22222222-2222-4222-8222-222222222222';

describe('C4a · as tarefas abertas', () => {
  it('cada tarefa é uma escrita do mapa (botao ou pin), sem dado de pessoa nem foto; a lista tem os campos de cada item', () => {
    // C4 Onda 1: a exclusão entra (com a marca do mapa: apagar insumo e fornecedor pede o PIN). Nenhum campo de colaborador
    // (dado de pessoa não vai à IA) nem de foto (o Mister não manda foto por estas rotas).
    const PROIBIDOS = /^(colaborador\w*|delegadoId|responsavelId|colaboradorResolvidoId|colaboradorOverrideId|foto\w*|notaFotoRef)$/;
    for (const t of TAREFAS_ABERTAS) {
      const f = funcaoDoMapa(t.rota);
      expect([t.rota, f?.marca]).toEqual([t.rota, expect.stringMatching(/^(botao|pin)$/)]);
      const todos = t.campos.flatMap((c) => [c, ...(c.itens ?? [])]);
      for (const c of todos) {
        expect([t.rota, c.nome]).toEqual([t.rota, expect.stringMatching(/^[A-Za-z]\w{0,40}$/)]);
        expect([t.rota, PROIBIDOS.test(c.nome)]).toEqual([t.rota, false]);
      }
      for (const c of t.campos) if (c.tipo === 'lista') expect([t.rota, c.nome, c.itens?.length ?? 0]).toEqual([t.rota, c.nome, expect.any(Number)]);
    }
    // A marca da revisão da C4: apagar o insumo e o fornecedor pedem o PIN.
    expect(funcaoDoMapa('DELETE /api/v1/estoque/itens/{id}')?.marca).toBe('pin');
    expect(funcaoDoMapa('DELETE /api/v1/fornecedores/{id}')?.marca).toBe('pin');
  });

  it('nasce desligada (MISTER_FAZER_TAREFAS=1 liga) e a busca só traz tarefas quando pedem', () => {
    const antes = process.env.MISTER_FAZER_TAREFAS;
    try {
      delete process.env.MISTER_FAZER_TAREFAS;
      expect(tarefasNoMister()).toBe(false);
      expect(procurarTelas({ busca: 'pedido de manutenção' }).dados).not.toHaveProperty('tarefas');
      expect((procurarTelas({ busca: 'pedido de manutenção' }, { tarefas: true }).dados as any).tarefas[0].rota).toBe('POST /api/v1/manutencao');
    } finally {
      if (antes === undefined) delete process.env.MISTER_FAZER_TAREFAS;
      else process.env.MISTER_FAZER_TAREFAS = antes;
    }
  });
});

describe('C4a · o pedido da tarefa', () => {
  it('o pedido certo: o corpo só com os campos conhecidos, a loja da conversa e o "Vou fazer" do Regem', () => {
    const p = pedidoDaTarefa({ rota: 'POST /api/v1/setores', campos: { nome: '  Bar  ' } }, LOJA) as any;
    expect(p.metodo).toBe('POST');
    expect(p.caminho).toBe('/api/v1/setores');
    expect(p.corpo).toEqual({ unidadeId: LOJA.unidadeId, nome: 'Bar' });
    expect(p.resumo).toContain('Nome do setor: Bar');
    const m = pedidoDaTarefa({ rota: 'POST /api/v1/manutencao', campos: { titulo: 'Coifa pingando', prioridade: 'critica' } }, LOJA) as any;
    expect(m.corpo).toEqual({ titulo: 'Coifa pingando', prioridade: 'critica' });
    expect(m.resumo).toContain('Prioridade: crítica');
  });

  it('recusa: tarefa fora da lista, campo a mais, campo da loja vindo da IA, obrigatório faltando, tipo errado', () => {
    // C4 Onda 1: o que segue fora — a alteração que zera o que não vem (a função), a interna e a de outra área.
    expect(pedidoDaTarefa({ rota: 'PATCH /api/v1/funcoes/{id}', parametros: { id: ID }, campos: { nome: 'Chapeiro' } }, LOJA)).toEqual({ erro: TEXTOS_DAS_TAREFAS.fora });
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/estoque/snapshot' }, LOJA)).toEqual({ erro: TEXTOS_DAS_TAREFAS.fora });
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/unidades', campos: { nome: 'X' } }, LOJA)).toEqual({ erro: TEXTOS_DAS_TAREFAS.fora });
    // A exclusão não tem campos (o que vier é recusado).
    expect(pedidoDaTarefa({ rota: 'DELETE /api/v1/setores/{id}', parametros: { id: ID }, campos: { motivo: 'x' } }, LOJA)).toHaveProperty('erro', expect.stringContaining('não tem o campo "motivo"'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/setores', campos: { nome: 'Bar', cor: 'red' } }, LOJA)).toHaveProperty('erro', expect.stringContaining('não tem o campo "cor"'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/setores', campos: { nome: 'Bar', unidadeId: ID } }, LOJA)).toHaveProperty('erro', expect.stringContaining('"unidadeId"'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/setores', campos: {} }, LOJA)).toHaveProperty('erro', expect.stringContaining('Nome do setor'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/turnos', campos: { nome: 'Noite', horaInicio: '25:00', horaFim: '23:00' } }, LOJA)).toHaveProperty('erro', expect.stringContaining('HH:MM'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/dias-especiais', campos: { nome: 'Natal', data: '25/12/2026' } }, LOJA)).toHaveProperty('erro', expect.stringContaining('AAAA-MM-DD'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/manutencao', campos: { titulo: 'x', prioridade: 'urgentissima' } }, LOJA)).toHaveProperty('erro', expect.stringContaining('baixa, normal, alta, critica'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/janelas-pico', campos: { nome: 'Almoço', horaInicio: '11:00', horaFim: '14:00', diaSemana: 9 } }, LOJA)).toHaveProperty('erro', expect.stringContaining('de 0 a 6'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/turnos', campos: { nome: 'Noite', horaInicio: '18:00', horaFim: '23:00', setorId: 'inventado' } }, LOJA)).toHaveProperty('erro', expect.stringContaining('id'));
  });

  it('a loja: sem a loja da conversa, o campo obrigatório pede a loja; o opcional fica de fora', () => {
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/setores', campos: { nome: 'Bar' } }, { unidadeId: null })).toEqual({ erro: TEXTOS_DAS_TAREFAS.semLoja });
    const d = pedidoDaTarefa({ rota: 'POST /api/v1/dias-especiais', campos: { nome: 'Natal', data: '2026-12-25', tipo: 'feriado' } }, { unidadeId: null }) as any;
    expect(d.corpo).toEqual({ nome: 'Natal', data: '2026-12-25', tipo: 'feriado' });
  });

  it('o parâmetro do caminho e o nome do registro pelo que as leituras desta pergunta trouxeram', () => {
    const origem = [{ resposta: [{ id: ID, titulo: 'Coifa da cozinha pingando', status: 'aberto' }] }];
    const p = pedidoDaTarefa({ rota: 'POST /api/v1/manutencao/{id}/status', parametros: { id: ID }, campos: { status: 'concluido' } }, LOJA, origem) as any;
    expect(p.caminho).toBe(`/api/v1/manutencao/${ID}/status`);
    expect(p.resumo).toContain('Registro: Coifa da cozinha pingando');
    expect(p.resumo).toContain('Situação nova: concluído');
    // Sem a leitura, o "Vou fazer" mostra o fim do id (nunca um nome inventado).
    expect((pedidoDaTarefa({ rota: 'POST /api/v1/manutencao/{id}/status', parametros: { id: ID }, campos: { status: 'concluido' } }, LOJA) as any).resumo).toContain('Registro: …222222');
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/estoque/alertas/{id}/resolver', parametros: { id: '..' } }, LOJA)).toHaveProperty('erro');
  });

  it('a busca das tarefas e os campos que a IA recebe (sem o campo da loja)', () => {
    const t = procurarTarefas('criar um setor');
    expect(t[0].rota).toBe('POST /api/v1/setores');
    expect(t[0].campos).toEqual([{ nome: 'nome', tipo: 'texto', rotulo: 'Nome do setor', obrigatorio: true }]);
    expect(camposParaAIa(TAREFAS_ABERTAS.find((x) => x.rota === 'POST /api/v1/manutencao')!)[2]).toEqual({ nome: 'prioridade', tipo: 'opcao', rotulo: 'Prioridade', opcoes: ['baixa', 'normal', 'alta', 'critica'] });
    expect(procurarTarefas('')).toEqual([]);
  });
});

describe('C4 Onda 1 · os campos novos e a exclusão', () => {
  const ID2 = '33333333-3333-4333-8333-333333333333';

  it('a lista de itens: cada item conferido como os de fora, o corpo como a rota quer e o "Vou fazer" com uma linha por item', () => {
    const p = pedidoDaTarefa(
      {
        rota: 'POST /api/v1/compras/listas/{id}/receber',
        parametros: { id: ID },
        campos: { notaRef: '17201', itens: [{ compraItemId: ID, qtdRecebida: '2,5', divergencia: 'parcial' }, { compraItemId: ID2, qtdRecebida: 0, validadeIndefinida: 'true' }] },
      },
      LOJA,
    ) as any;
    expect(p.metodo).toBe('POST');
    expect(p.corpo).toEqual({ notaRef: '17201', itens: [{ compraItemId: ID, qtdRecebida: 2.5, divergencia: 'parcial' }, { compraItemId: ID2, qtdRecebida: 0, validadeIndefinida: true }] });
    expect(p.resumo).toContain('O que chegou: 2 itens');
    expect(p.resumo).toContain('Como veio: veio em parte');
    // O item com campo errado é recusado com o número do item.
    const ruim = pedidoDaTarefa({ rota: 'POST /api/v1/compras/listas/{id}/receber', parametros: { id: ID }, campos: { itens: [{ compraItemId: ID, qtdRecebida: -1 }] } }, LOJA);
    expect(ruim).toHaveProperty('erro', expect.stringContaining('item 1'));
    const vazia = pedidoDaTarefa({ rota: 'POST /api/v1/compras/listas/{id}/receber', parametros: { id: ID }, campos: { itens: [] } }, LOJA);
    expect(vazia).toHaveProperty('erro', expect.stringContaining('lista de 1 a'));
    const aMais = pedidoDaTarefa({ rota: 'POST /api/v1/compras/listas/{id}/receber', parametros: { id: ID }, campos: { itens: [{ compraItemId: ID, qtdRecebida: 1, fotoRef: 'x' }] } }, LOJA);
    expect(aMais).toHaveProperty('erro', expect.stringContaining('"fotoRef"'));
  });

  it('número com casas, sim ou não e a lista de ids (sem repetir)', () => {
    const c = pedidoDaTarefa(
      { rota: 'POST /api/v1/contagem/listas', campos: { nome: 'Câmara fria', recorrencia: 'semanal', diaSemana: 1, enviarKds: false, itemIds: [ID, ID2, ID.toUpperCase()] } },
      LOJA,
    ) as any;
    expect(c.corpo).toEqual({ nome: 'Câmara fria', recorrencia: 'semanal', diaSemana: 1, enviarKds: false, itemIds: [ID, ID2] });
    expect(c.resumo).toContain('Avisar no KDS: não');
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/contagem/listas', campos: { nome: 'X', itemIds: ['inventado'] } }, LOJA)).toHaveProperty('erro', expect.stringContaining('ids'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/fichas/embalagem', campos: { mesmaEmbalagem: 'talvez' } }, LOJA)).toHaveProperty('erro', expect.stringContaining('true ou false'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/fichas', campos: { nome: 'X Burger', rendimento: 0 } }, LOJA)).toHaveProperty('erro', expect.stringContaining('Rendimento'));
    const f = pedidoDaTarefa({ rota: 'POST /api/v1/fichas', campos: { nome: 'X Burger', precoVenda: 32.9, ingredientes: [{ insumoNome: 'Pão', quantidade: 1, unidade: 'unidade' }] } }, LOJA) as any;
    expect(f.corpo).toEqual({ nome: 'X Burger', precoVenda: 32.9, ingredientes: [{ insumoNome: 'Pão', quantidade: 1, unidade: 'unidade' }] });
  });

  it('a exclusão: sem campos vai com o corpo vazio; a tarefa do dia pede o motivo', () => {
    const d = pedidoDaTarefa({ rota: 'DELETE /api/v1/setores/{id}', parametros: { id: ID } }, LOJA) as any;
    expect([d.metodo, d.caminho, d.corpo]).toEqual(['DELETE', `/api/v1/setores/${ID}`, {}]);
    expect(pedidoDaTarefa({ rota: 'DELETE /api/v1/tarefas-instancias/{id}', parametros: { id: ID } }, LOJA)).toHaveProperty('erro', expect.stringContaining('Motivo'));
    const t = pedidoDaTarefa({ rota: 'DELETE /api/v1/tarefas-instancias/{id}', parametros: { id: ID }, campos: { motivo: 'feita fora do sistema' } }, LOJA) as any;
    expect(t.corpo).toEqual({ motivo: 'feita fora do sistema' });
    // A de PIN segue a marca do mapa.
    expect((pedidoDaTarefa({ rota: 'DELETE /api/v1/estoque/itens/{id}', parametros: { id: ID } }, LOJA) as any).f.marca).toBe('pin');
  });

  it('a página do PIN mostra o "Vou fazer" da tarefa', () => {
    expect(apresentacaoDaTarefa({ frase: 'Estoque: remover item', resumo: 'Estoque: remover item.\n• Registro: Ovo' })).toEqual({
      titulo: 'Autorizar: estoque: remover item?',
      itens: ['Registro: Ovo'],
      detalhe: null,
      valor: null,
      botao: 'Autorizar',
    });
  });
});
