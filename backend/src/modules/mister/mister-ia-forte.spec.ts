import { FalhaDaIa } from '../ia/ia-empresa.service';
import { valoresSemConta } from './mister-agente.regras';
import { temTarefaAberta, type DocumentoEmAndamento, type ListaEmAndamento } from './mister-andamento';
import { CONVERSA_PADRAO, conferirConversa } from './mister-conversa-config.service';
import { responderComFerramentas } from './mister-laco';

// Versão 9, O6 (o dono: "intercalar Haiku e Sonnet"): com uma tarefa em andamento e o ajuste ligado, a pergunta inteira no modelo
// maior; no resto, o de sempre. E a régua da avaliação, que reprovava a conta por dia e a média (a rodada de 24/11, 89 de 91).

const falar = { texto: 'Pronto.', recusou: false, origem: 'lojista', uso: { entrada: 1, cacheEscrita: 0, cacheLeitura: 0, saida: 1 }, parou: 'end_turn', conteudo: [{ type: 'text', text: 'Pronto.' }] };

describe('a IA mais forte nas tarefas (O6)', () => {
  const rodar = async (modeloDaTarefa: string | null, respostas: any[]) => {
    const pedidos: { modelo: string; maxTokens: number }[] = [];
    const fim = await responderComFerramentas(
      {
        modelo: 'claude-haiku-5-5',
        modeloDaTarefa,
        conversa: 'c',
        pedir: async (p: any) => {
          pedidos.push({ modelo: p.modelo, maxTokens: p.maxTokens });
          const r = respostas.shift();
          if (r instanceof FalhaDaIa) throw r;
          return r;
        },
        executar: async () => ({ ok: true, dados: {} }),
      },
      [],
      'o 4 é a carne de 120',
    );
    return { pedidos, fim };
  };

  it('com tarefa aberta, a pergunta inteira começa no maior, com o teto dele', async () => {
    const { pedidos, fim } = await rodar('claude-sonnet-5-5', [falar]);
    expect(pedidos).toEqual([{ modelo: 'claude-sonnet-5-5', maxTokens: 8000 }]);
    expect(fim.trilha.modelo).toBe('claude-sonnet-5-5');
  });

  it('sem tarefa, o de sempre; se o maior falha, o de sempre responde', async () => {
    expect((await rodar(null, [falar])).pedidos.map((p) => p.modelo)).toEqual(['claude-haiku-5-5']);
    const { pedidos, fim } = await rodar('claude-sonnet-5-5', [new FalhaDaIa('limite' as any, 'lojista'), falar]);
    expect(pedidos.map((p) => p.modelo)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(fim).toMatchObject({ texto: 'Pronto.', trilha: { modelo: 'claude-haiku-5-5' } });
  });

  it('a tarefa aberta é o documento que espera a pessoa ou a lista em andamento', () => {
    const doc = (situacao: string): DocumentoEmAndamento => ({ tipo: 'nota', situacao, motivo: null, hora: '10:00', valorCentavos: null, beneficiario: null, nota: null });
    const lista = (situacao: string): ListaEmAndamento => ({ situacao, hora: '10:00', itens: [], leitura: null, pedidoCriado: false });
    expect(temTarefaAberta([doc('falta')], [])).toBe(true);
    expect(temTarefaAberta([doc('confirmar')], [])).toBe(true);
    expect(temTarefaAberta([], [lista('montando')])).toBe(true);
    expect(temTarefaAberta([doc('lancado'), doc('recusado')], [lista('criada'), lista('descartada')])).toBe(false);
    expect(temTarefaAberta([], [])).toBe(false);
  });

  it('o ajuste nasce desligado e só aceita sim ou não', () => {
    expect(CONVERSA_PADRAO.iaForteNasTarefas).toBe(false);
    expect(conferirConversa({ iaForteNasTarefas: true })).toEqual({ iaForteNasTarefas: true });
    expect(conferirConversa({ iaForteNasTarefas: 'sim' })).toHaveProperty('erro');
  });
});

describe('a régua da avaliação: a conta por dia e a média', () => {
  it('c05 de 24/11: o faturamento dividido pelos dias de cada semana', () => {
    const vendas = [{ faturamento: 24876.45, numeroDeVendas: 498, ticketMedio: 49.95 }, { faturamento: 38420.35, numeroDeVendas: 812, ticketMedio: 47.32 }];
    const t =
      'Na Loja Centro foram *R$ 24.876,45*. Na semana passada, *R$ 38.420,35*. Isso dá *R$ 13.543,90 a menos*. Por dia: esta semana R$ 4.975,29 e a passada R$ 5.488,62. Ticket R$ 49,95 contra R$ 47,32.';
    expect(valoresSemConta(t, vendas)).toEqual([]);
  });

  it('c86 de 24/11: o mês que faltou vem negativo, e a média dos três meses', () => {
    const caixa = [{ saldo: 38420, mesesNoBanco: [{ mes: '2026-08', sobra: -6500 }, { mes: '2026-09', sobra: -5700 }, { mes: '2026-10', sobra: -6550 }], burnRate: 6250 }];
    expect(valoresSemConta('Saldo *R$ 38.420,00*. Faltou *-R$ 6.500,00*, *-R$ 5.700,00* e *-R$ 6.550,00*. Média de *R$ 6.250,00* por mês.', caixa)).toEqual([]);
    // Sem o burnRate na consulta, a média continua sendo conta sobre os valores da resposta.
    const semMedia = [{ saldo: 38420, mesesNoBanco: [{ sobra: -6500 }, { sobra: -5700 }, { sobra: -6550 }] }];
    expect(valoresSemConta('Faltou -R$ 6.500,00, -R$ 5.700,00 e -R$ 6.550,00: média de R$ 6.250,00.', semMedia)).toEqual([]);
  });

  it('o valor inventado continua reprovado', () => {
    expect(valoresSemConta('Foram R$ 24.876,45 e o lucro foi R$ 7.777,77.', [{ faturamento: 24876.45 }])).toEqual([777777]);
  });
});
