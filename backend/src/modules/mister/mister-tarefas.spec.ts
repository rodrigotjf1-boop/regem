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

describe('C4 Onda 2 · delivery e cardápio', () => {
  const ID2 = '33333333-3333-4333-8333-333333333333';
  const marca = (rota: string) => (pedidoDaTarefa({ rota, parametros: { id: ID, opcaoId: ID2 }, campos: {} }, LOJA) as any).f?.marca ?? funcaoDoMapa(rota)?.marca;

  it('as marcas: excluir o produto, o preço do complemento no app e na etapa e o custo em massa pedem o PIN; o resto é botão', () => {
    for (const r of ['DELETE /api/v1/produtos/{id}', 'PUT /api/v1/produtos/opcoes/{id}/preco-canal', 'PUT /api/v1/produtos/complementos-catalogo/{id}/opcoes/{opcaoId}/preco', 'PATCH /api/v1/produtos/opcoes/massa/preco']) {
      expect([r, funcaoDoMapa(r)?.marca]).toEqual([r, 'pin']);
    }
    for (const r of ['POST /api/v1/delivery/pausas/estender', 'PATCH /api/v1/delivery/pix-prioritario', 'DELETE /api/v1/produtos/categorias/{id}', 'POST /api/v1/produtos/{id}/duplicar', 'DELETE /api/v1/produtos/opcoes/{id}']) {
      expect([r, funcaoDoMapa(r)?.marca]).toEqual([r, 'botao']);
    }
    expect(marca('DELETE /api/v1/produtos/{id}')).toBe('pin');
  });

  it('o aviso e a situação "vindos da loja" são da credencial do servidor da loja: interna e fora das tarefas', () => {
    for (const r of ['POST /api/v1/delivery/aviso-da-loja', 'POST /api/v1/delivery/status-da-loja']) {
      expect(funcaoDoMapa(r)?.marca).toBe('interna');
      expect(TAREFAS_ABERTAS.some((t) => t.rota === r)).toBe(false);
    }
    // As mudanças de situação do pedido ficam com as ações prontas (o id do pedido só vem com dado de cliente).
    expect(TAREFAS_ABERTAS.some((t) => t.rota.startsWith('POST /api/v1/delivery/pedidos'))).toBe(false);
  });

  it('estender a pausa: o canal da lista e os minutos de 10 a 30', () => {
    const e = pedidoDaTarefa({ rota: 'POST /api/v1/delivery/pausas/estender', campos: { canal: 'food99', minutos: 20 } }, LOJA) as any;
    expect([e.metodo, e.caminho, e.corpo]).toEqual(['POST', '/api/v1/delivery/pausas/estender', { canal: 'food99', minutos: 20 }]);
    expect(e.resumo).toContain('Canal: 99');
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/delivery/pausas/estender', campos: { canal: 'regem', minutos: 10 } }, LOJA)).toHaveProperty('erro', expect.stringContaining('cardapio'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/delivery/pausas/estender', campos: { canal: 'ifood', minutos: 60 } }, LOJA)).toHaveProperty('erro', expect.stringContaining('Mais minutos'));
  });

  it('o preço do complemento na etapa: os dois ids no caminho e a vírgula vira ponto', () => {
    const p = pedidoDaTarefa({ rota: 'PUT /api/v1/produtos/complementos-catalogo/{id}/opcoes/{opcaoId}/preco', parametros: { id: ID, opcaoId: ID2 }, campos: { valor: '4,50' } }, LOJA) as any;
    expect([p.metodo, p.caminho, p.corpo]).toEqual(['PUT', `/api/v1/produtos/complementos-catalogo/${ID}/opcoes/${ID2}/preco`, { valor: 4.5 }]);
    expect(pedidoDaTarefa({ rota: 'PUT /api/v1/produtos/complementos-catalogo/{id}/opcoes/{opcaoId}/preco', parametros: { id: ID }, campos: { valor: 4.5 } }, LOJA)).toHaveProperty('erro', expect.stringContaining('opcaoId'));
    expect(pedidoDaTarefa({ rota: 'PUT /api/v1/produtos/opcoes/{id}/preco-canal', parametros: { id: ID }, campos: { canal: 'regem', valor: 3 } }, LOJA)).toHaveProperty('erro', expect.stringContaining('99food'));
  });

  it('vender sem saldo e a pausa da opção pedem o sim ou não; o custo em massa pede a lista e o valor', () => {
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/produtos/{id}/permite-negativo', parametros: { id: ID } }, LOJA)).toHaveProperty('erro', expect.stringContaining('Vender sem saldo'));
    const n = pedidoDaTarefa({ rota: 'POST /api/v1/produtos/{id}/permite-negativo', parametros: { id: ID }, campos: { ativo: false } }, LOJA) as any;
    expect(n.corpo).toEqual({ ativo: false });
    const o = pedidoDaTarefa({ rota: 'PUT /api/v1/produtos/opcoes/{id}/pausa-canal', parametros: { id: ID }, campos: { canal: '99food', pausado: true } }, LOJA) as any;
    expect(o.corpo).toEqual({ canal: '99food', pausado: true });
    expect(pedidoDaTarefa({ rota: 'PATCH /api/v1/produtos/opcoes/massa/preco', campos: { ids: [ID, ID2] } }, LOJA)).toHaveProperty('erro', expect.stringContaining('Custo'));
    const m = pedidoDaTarefa({ rota: 'PATCH /api/v1/produtos/opcoes/massa/preco', campos: { ids: [ID, ID2], precoCusto: 1.25 } }, LOJA) as any;
    expect(m.corpo).toEqual({ ids: [ID, ID2], precoCusto: 1.25 });
  });
});

describe('C4 Onda 3 · cozinha e ponto', () => {
  it('as marcas: cancelar a ordem e limpar a fila pedem o PIN; criar, liberar, iniciar e o fechamento do ponto são de botão', () => {
    for (const r of ['POST /api/v1/ordens-producao/{id}/cancelar', 'POST /api/v1/producao/fila/limpar']) expect([r, funcaoDoMapa(r)?.marca]).toEqual([r, 'pin']);
    for (const r of ['POST /api/v1/ordens-producao', 'POST /api/v1/ordens-producao/{id}/liberar', 'POST /api/v1/ordens-producao/{id}/iniciar', 'POST /api/v1/ponto/fechamentos/gerar']) {
      expect([r, funcaoDoMapa(r)?.marca]).toEqual([r, 'botao']);
    }
  });

  it('fora de propósito: a escala e o ponto de uma pessoa, os candidatos, concluir a ordem (PIN de quem produziu) e o cartão do KDS', () => {
    const abertas = new Set(TAREFAS_ABERTAS.map((t) => t.rota));
    for (const r of [
      'POST /api/v1/escala',
      'POST /api/v1/escala/gerar',
      'POST /api/v1/ponto/ajuste',
      'POST /api/v1/ponto/marcacao-manual',
      'PATCH /api/v1/vagas/candidatos/{id}/situacao',
      'POST /api/v1/ordens-producao/{id}/concluir',
      'POST /api/v1/producao/pedidos/{id}/avancar',
      'POST /api/v1/producao/pedidos/{id}/cancelar',
      'PUT /api/v1/producao/kds/rota',
    ]) {
      expect([r, abertas.has(r)]).toEqual([r, false]);
    }
  });

  it('a ordem de produção: a ficha, a quantidade e o dia; a loja vem da conversa; cancelar pede o motivo', () => {
    const o = pedidoDaTarefa({ rota: 'POST /api/v1/ordens-producao', campos: { fichaId: ID, quantidadePlanejada: '2,5', unidade: 'kg', dataProducao: '2026-11-28', liberar: true } }, LOJA) as any;
    expect(o.corpo).toEqual({ fichaId: ID, quantidadePlanejada: 2.5, unidade: 'kg', dataProducao: '2026-11-28', liberar: true, unidadeId: LOJA.unidadeId });
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/ordens-producao', campos: { fichaId: ID, quantidadePlanejada: 0, dataProducao: '2026-11-28' } }, LOJA)).toHaveProperty('erro', expect.stringContaining('Quantidade'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/ordens-producao', campos: { fichaId: ID, quantidadePlanejada: 1, dataProducao: '2026-11-28', colaboradorId: ID } }, LOJA)).toHaveProperty('erro', expect.stringContaining('"colaboradorId"'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/ordens-producao/{id}/cancelar', parametros: { id: ID } }, LOJA)).toHaveProperty('erro', expect.stringContaining('Motivo'));
  });

  it('limpar a fila só de uma loja: sem a loja da conversa, recusa', () => {
    const l = pedidoDaTarefa({ rota: 'POST /api/v1/producao/fila/limpar' }, LOJA) as any;
    expect(l.corpo).toEqual({ unidadeId: LOJA.unidadeId });
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/producao/fila/limpar' }, { unidadeId: null })).toEqual({ erro: TEXTOS_DAS_TAREFAS.semLoja });
  });

  it('o fechamento do ponto: o mês AAAA-MM, conferido aqui (a rota troca o mês torto pelo anterior, calada)', () => {
    const f = pedidoDaTarefa({ rota: 'POST /api/v1/ponto/fechamentos/gerar', campos: { competencia: '2026-10' } }, LOJA) as any;
    expect(f.corpo).toEqual({ competencia: '2026-10' });
    expect(f.resumo).toContain('Mês: 10/2026');
    for (const ruim of ['2026-13', '10/2026', '2026-1', 'outubro']) {
      expect(pedidoDaTarefa({ rota: 'POST /api/v1/ponto/fechamentos/gerar', campos: { competencia: ruim } }, LOJA)).toHaveProperty('erro', expect.stringContaining('AAAA-MM'));
    }
    expect(camposParaAIa(TAREFAS_ABERTAS.find((t) => t.rota === 'POST /api/v1/ponto/fechamentos/gerar')!)).toEqual([{ nome: 'competencia', tipo: 'mês AAAA-MM', rotulo: 'Mês', obrigatorio: true }]);
  });
});

describe('C4 Onda 4 · dinheiro e fiscal (tudo com PIN)', () => {
  const ONDA_4 = [
    'DELETE /api/v1/financeiro/titulos/{id}',
    'POST /api/v1/financeiro/titulos/{id}/estornar',
    'POST /api/v1/financeiro/formas-pagamento/{id}/ativa',
    'POST /api/v1/fiscal/contingencia/transmitir',
    'POST /api/v1/fidelidade/planos/{id}/finalizar',
    'POST /api/v1/cashback/planos/{id}/finalizar',
  ];

  it('as seis abertas pedem o PIN', () => {
    for (const r of ONDA_4) {
      expect([r, TAREFAS_ABERTAS.some((t) => t.rota === r), funcaoDoMapa(r)?.marca]).toEqual([r, true, 'pin']);
      expect([r, (pedidoDaTarefa({ rota: r, parametros: { id: ID }, campos: r.endsWith('/ativa') ? { ativo: true } : {} }, LOJA) as any).f?.marca]).toEqual([r, 'pin']);
    }
  });

  it('fora de propósito: pessoas e acessos, lojas e empresa, o caixa e a venda do PDV, emitir, cancelar e inutilizar nota', () => {
    const abertas = new Set(TAREFAS_ABERTAS.map((t) => t.rota));
    for (const r of [
      'POST /api/v1/colaboradores',
      'PATCH /api/v1/colaboradores/{id}/acesso',
      'POST /api/v1/perfis',
      'PUT /api/v1/contadores',
      'POST /api/v1/unidades',
      'PATCH /api/v1/empresas/config',
      'POST /api/v1/financeiro/caixa/abrir',
      'POST /api/v1/financeiro/caixa/movimentar',
      'POST /api/v1/vendas/comandas',
      'POST /api/v1/vendas/mesas/{id}/fechar',
      'POST /api/v1/fiscal/comandas/{id}/emitir',
      'POST /api/v1/fiscal/notas/{id}/cancelar',
      'POST /api/v1/fiscal/inutilizar',
      'POST /api/v1/fiscal/sefaz/status',
      'POST /api/v1/financeiro/titulos',
      'POST /api/v1/financeiro/titulos/{id}/pagar',
    ]) {
      expect([r, abertas.has(r)]).toEqual([r, false]);
    }
  });

  it('a conta vai com o corpo vazio; a forma de pagamento pede o sim ou não', () => {
    const d = pedidoDaTarefa({ rota: 'DELETE /api/v1/financeiro/titulos/{id}', parametros: { id: ID } }, LOJA) as any;
    expect([d.metodo, d.caminho, d.corpo]).toEqual(['DELETE', `/api/v1/financeiro/titulos/${ID}`, {}]);
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/financeiro/titulos/{id}/estornar', parametros: { id: ID }, campos: { valor: 10 } }, LOJA)).toHaveProperty('erro', expect.stringContaining('"valor"'));
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/financeiro/formas-pagamento/{id}/ativa', parametros: { id: ID } }, LOJA)).toHaveProperty('erro', expect.stringContaining('Ativa'));
    const f = pedidoDaTarefa({ rota: 'POST /api/v1/financeiro/formas-pagamento/{id}/ativa', parametros: { id: ID }, campos: { ativo: false } }, LOJA) as any;
    expect(f.corpo).toEqual({ ativo: false });
    expect(f.resumo).toContain('Ativa: não');
  });
});

// H2b dos dias especiais (protótipo `regem-dias-especiais.html`, "No Mister", decisão 8): o dia especial do horário pela
// conversa, com o PIN pelo link — o mesmo cadastro da tela (sem a loja), e mudar manda só o que muda.
describe('H2b · o dia especial do horário pela conversa', () => {
  const ROTAS = ['POST /api/v1/cardapio/dias-especiais', 'PATCH /api/v1/cardapio/dias-especiais/{id}', 'DELETE /api/v1/cardapio/dias-especiais/{id}'];

  it('criar, mudar e excluir pedem o PIN (fechar a loja tira venda) e nenhum leva a loja', () => {
    for (const r of ROTAS) {
      expect([r, funcaoDoMapa(r)?.marca]).toEqual([r, 'pin']);
      expect([r, TAREFAS_ABERTAS.find((t) => t.rota === r)?.campos.some((c) => c.tipo === 'loja')]).toEqual([r, false]);
    }
    // O da Escala é outro cadastro (o de cima), com a loja e o botão.
    expect(funcaoDoMapa('POST /api/v1/dias-especiais')?.marca).toBe('botao');
  });

  it('criar: o corpo como a tela manda, sem a loja; o "Vou fazer" diz o dia e como a loja fica; o como-fica fora da lista é recusado', () => {
    const p = pedidoDaTarefa(
      { rota: 'POST /api/v1/cardapio/dias-especiais', campos: { data: '2026-12-31', nome: 'Véspera de Ano-novo', funcionamento: 'horario', abre: '18:00', fecha: '21:00' } },
      LOJA,
    ) as any;
    expect([p.metodo, p.caminho]).toEqual(['POST', '/api/v1/cardapio/dias-especiais']);
    expect(p.corpo).toEqual({ data: '2026-12-31', nome: 'Véspera de Ano-novo', funcionamento: 'horario', abre: '18:00', fecha: '21:00' });
    expect(p.corpo).not.toHaveProperty('unidadeId');
    expect(p.resumo).toContain('Como a loja fica: outro horário');
    expect(p.resumo).toContain('Fecha às: 21:00');
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/cardapio/dias-especiais', campos: { data: '2026-12-25', nome: 'Natal', funcionamento: 'meio_periodo' } }, LOJA)).toHaveProperty('erro');
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/cardapio/dias-especiais', campos: { data: '2026-12-25', funcionamento: 'fechada' } }, LOJA)).toHaveProperty('erro', expect.stringContaining('Nome'));
    // A resposta ao feriado da lista leva a chave dele (sai dos "sem resposta").
    const f = pedidoDaTarefa({ rota: 'POST /api/v1/cardapio/dias-especiais', campos: { data: '2026-12-25', nome: 'Natal', funcionamento: 'fechada', feriadoChave: 'regra:feriado:natal:2026' } }, LOJA) as any;
    expect(f.corpo).toEqual({ data: '2026-12-25', nome: 'Natal', funcionamento: 'fechada', feriadoChave: 'regra:feriado:natal:2026' });
  });

  it('mudar manda só o que muda (o serviço mantém o resto); excluir vai com o corpo vazio', () => {
    const m = pedidoDaTarefa({ rota: 'PATCH /api/v1/cardapio/dias-especiais/{id}', parametros: { id: ID }, campos: { fecha: '22:00' } }, LOJA) as any;
    expect([m.metodo, m.caminho, m.corpo]).toEqual(['PATCH', `/api/v1/cardapio/dias-especiais/${ID}`, { fecha: '22:00' }]);
    const d = pedidoDaTarefa({ rota: 'DELETE /api/v1/cardapio/dias-especiais/{id}', parametros: { id: ID } }, LOJA) as any;
    expect([d.metodo, d.caminho, d.corpo]).toEqual(['DELETE', `/api/v1/cardapio/dias-especiais/${ID}`, {}]);
  });
});
