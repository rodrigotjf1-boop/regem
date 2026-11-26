import { TAREFAS_ABERTAS } from './mapa/tarefas-abertas';
import { funcaoDoMapa } from './mapa/busca-no-mapa';
import { TEXTOS_DAS_TAREFAS, camposParaAIa, pedidoDaTarefa, procurarTarefas, tarefasNoMister } from './mister-tarefas';
import { procurarTelas } from './mister-telas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Versão 10, C4a: fazer uma tarefa pelo mapa — a conferência do pedido e o "Vou fazer" do Regem (puro). A escrita de verdade,
// com o bilhete preso ao método e ao corpo, está em `auth/bilhete-do-mister-pg.spec.ts`.

const LOJA = { unidadeId: '11111111-1111-4111-8111-111111111111' };
const ID = '22222222-2222-4222-8222-222222222222';

describe('C4a · as tarefas abertas', () => {
  it('cada tarefa é uma escrita do mapa (botao ou pin), sem dado de pessoa, e nenhuma é exclusão', () => {
    for (const t of TAREFAS_ABERTAS) {
      const f = funcaoDoMapa(t.rota);
      expect([t.rota, f?.marca]).toEqual([t.rota, expect.stringMatching(/^(botao|pin)$/)]);
      expect(t.rota.startsWith('DELETE ')).toBe(false);
      for (const c of t.campos) expect([t.rota, c.nome]).toEqual([t.rota, expect.stringMatching(/^[A-Za-z]\w{0,40}$/)]);
    }
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
    expect(pedidoDaTarefa({ rota: 'DELETE /api/v1/setores/{id}', parametros: { id: ID } }, LOJA)).toEqual({ erro: TEXTOS_DAS_TAREFAS.fora });
    expect(pedidoDaTarefa({ rota: 'POST /api/v1/unidades', campos: { nome: 'X' } }, LOJA)).toEqual({ erro: TEXTOS_DAS_TAREFAS.fora });
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
