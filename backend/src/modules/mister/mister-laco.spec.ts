import { FalhaDaIa, PedidoDeIa, RespostaDaIa } from '../ia/ia-empresa.service';
import { FERRAMENTAS, FERRAMENTAS_QUE_NAO_SAO_CONSULTA, FERRAMENTA_DE_PROCURAR, FERRAMENTA_DO_QUE_FALTA, TETOS, podeRodarJunto } from './mister-agente.regras';
import { PortasDoLaco, Vagas, responderComFerramentas, rodarNaOrdem } from './mister-laco';
import type { ResultadoDaFerramenta } from './mister-ferramentas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// As consultas da mesma vez rodam juntas (o padrão de ferramentas do Hermes), com a resposta ao modelo, a trilha e o
// `colher` na ORDEM do pedido; a vez com uma ação roda uma de cada vez; o teto da pergunta e o do processo valem.

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const uso = { entrada: 1, saida: 1, cacheEscrita: 0, cacheLeitura: 0 };

/** A resposta do modelo que pede estas ferramentas numa vez só. */
const pede = (...ferramentas: Array<[nome: string, id: string, input?: Record<string, unknown>]>): RespostaDaIa =>
  ({
    texto: '',
    recusou: false,
    origem: 'empresa',
    uso,
    parou: 'tool_use',
    conteudo: ferramentas.map(([name, id, input]) => ({ type: 'tool_use', id, name, input: input ?? {} })),
  }) as any;
const fala = (texto: string): RespostaDaIa => ({ texto, recusou: false, origem: 'empresa', uso, parou: 'end_turn', conteudo: [{ type: 'text', text: texto }] }) as any;

/** Um laço com a IA de mentira (o roteiro em ordem) e ferramentas que anotam quem está rodando ao mesmo tempo. */
function montar(roteiro: RespostaDaIa[], demora: (nome: string, input: any) => number = () => 15) {
  const pedidos: PedidoDeIa[] = [];
  const comecou: string[] = [];
  const colhidos: string[] = [];
  let rodando = 0;
  let maximo = 0;
  const portas: PortasDoLaco = {
    modelo: 'claude-haiku-5-5',
    conversa: 'ESTA CONVERSA',
    pedir: async (p) => {
      pedidos.push(JSON.parse(JSON.stringify(p)));
      const passo = roteiro.shift();
      if (!passo) throw new Error('a IA de mentira ficou sem roteiro');
      return passo;
    },
    executar: async (nome, input: any) => {
      comecou.push(String(nome));
      rodando++;
      maximo = Math.max(maximo, rodando);
      await esperar(demora(String(nome), input));
      rodando--;
      return { ok: true, dados: { de: nome, marca: input?.marca ?? null } } as ResultadoDaFerramenta;
    },
    colher: (r) => {
      colhidos.push(String((r.dados as any).marca ?? r.dados.de));
    },
  };
  return { portas, pedidos, comecou, colhidos, maximo: () => maximo };
}

/** Os `tool_result` que voltaram ao modelo na segunda chamada. */
const resultadosDaVez = (pedidos: PedidoDeIa[], i = 1): any[] => (pedidos[i] as any).messages.at(-1).content;

describe('mister — o laço com as consultas juntas', () => {
  it('as consultas pedidas na mesma vez rodam juntas e a pergunta fecha com a resposta do modelo', async () => {
    const l = montar([pede(['resumo_do_dia', 'a'], ['vendas_do_periodo', 'b'], ['estoque_em_alerta', 'c']), fala('Pronto.')]);
    const fim = await responderComFerramentas(l.portas, [], 'como está a loja?');
    expect(fim.motivo).toBeNull();
    expect(fim.texto).toBe('Pronto.');
    expect(l.maximo()).toBe(3);
    expect(fim.trilha.ferramentas!.map((f) => f.nome)).toEqual(['resumo_do_dia', 'vendas_do_periodo', 'estoque_em_alerta']);
  });

  it('a resposta ao modelo, a trilha e o colher seguem a ORDEM do pedido, mesmo quando a segunda termina antes', async () => {
    const l = montar(
      [pede(['vendas_do_periodo', 'lenta', { marca: 'primeira' }], ['resumo_do_dia', 'rapida', { marca: 'segunda' }]), fala('Ok.')],
      (_n, input) => (input?.marca === 'primeira' ? 60 : 5),
    );
    const fim = await responderComFerramentas(l.portas, [], 'vendas e resumo');
    expect(l.maximo()).toBe(2);
    expect(resultadosDaVez(l.pedidos).map((r) => r.tool_use_id)).toEqual(['lenta', 'rapida']);
    expect(l.colhidos).toEqual(['primeira', 'segunda']);
    expect(fim.trilha.ferramentas!.map((f) => f.nome)).toEqual(['vendas_do_periodo', 'resumo_do_dia']);
    expect(fim.motivo === null && fim.resultados.map((r: any) => r.marca)).toEqual(['primeira', 'segunda']);
  });

  it('com uma AÇÃO na vez (propor), tudo roda uma de cada vez, na ordem pedida', async () => {
    const l = montar([pede(['resumo_do_dia', 'a'], ['propor_procedimento', 'b'], ['servidor_e_incidentes', 'c']), fala('Proposta a caminho.')]);
    await responderComFerramentas(l.portas, [], 'resolve a impressora');
    expect(l.maximo()).toBe(1);
    expect(l.comecou).toEqual(['resumo_do_dia', 'propor_procedimento', 'servidor_e_incidentes']);
  });

  it(`no máximo ${TETOS.consultasJuntas} consultas juntas por vez`, async () => {
    const nomes = ['resumo_do_dia', 'vendas_do_periodo', 'estoque_em_alerta', 'cancelamentos', 'caixas_e_sangrias', 'equipe_do_dia'];
    const l = montar([pede(...nomes.map((n, i) => [n, `t${i}`] as [string, string])), fala('Ok.')]);
    const fim = await responderComFerramentas(l.portas, [], 'tudo');
    expect(l.maximo()).toBe(TETOS.consultasJuntas);
    expect(fim.trilha.ferramentas!).toHaveLength(nomes.length);
  });

  it('o teto de consultas da pergunta se decide na ordem: o que passa dele não roda e volta como limite', async () => {
    const pedidos = Array.from({ length: TETOS.ferramentas + 2 }, (_, i) => ['resumo_do_dia', `t${i}`, { marca: `m${i}` }] as [string, string, any]);
    const l = montar([pede(...pedidos), fala('Com o que deu.')]);
    const fim = await responderComFerramentas(l.portas, [], 'muita coisa');
    expect(l.comecou).toHaveLength(TETOS.ferramentas);
    const voltas = resultadosDaVez(l.pedidos);
    expect(voltas).toHaveLength(TETOS.ferramentas + 2);
    expect(voltas.slice(0, TETOS.ferramentas).every((r) => !r.is_error)).toBe(true);
    expect(voltas.slice(TETOS.ferramentas).map((r) => [r.tool_use_id, r.is_error])).toEqual([
      [`t${TETOS.ferramentas}`, true],
      [`t${TETOS.ferramentas + 1}`, true],
    ]);
    expect(JSON.parse(voltas.at(-1).content).erro).toMatch(/Limite de consultas/);
    expect(fim.trilha.ferramentas!).toHaveLength(TETOS.ferramentas);
  });

  it('o nome que não existe e a anotação do que falta não tiram a vez das consultas juntas', () => {
    expect(podeRodarJunto('resumo_do_dia')).toBe(true);
    expect(podeRodarJunto('como_usar_o_regem')).toBe(true);
    expect(podeRodarJunto('anotar_o_que_falta')).toBe(true);
    expect(podeRodarJunto('apagar_tudo')).toBe(true);
  });

  it('toda ferramenta que FAZ algo (a lista das que não são consulta, menos a anotação e a busca no mapa) roda uma de cada vez', () => {
    // C3: procurar no mapa não lê dado da loja (não é consulta) e não muda nada — roda junto, como a anotação.
    const acoes = FERRAMENTAS_QUE_NAO_SAO_CONSULTA.filter((n) => n !== FERRAMENTA_DO_QUE_FALTA && n !== FERRAMENTA_DE_PROCURAR);
    expect(acoes).toEqual(expect.arrayContaining(['propor_procedimento', 'mandar_link', 'corrigir_documento', 'link_para_encaminhar', 'cancelar_links']));
    for (const acao of acoes) expect([acao, podeRodarJunto(acao)]).toEqual([acao, false]);
    // E as outras do catálogo são consultas: rodam juntas.
    for (const f of FERRAMENTAS.filter((x) => !FERRAMENTAS_QUE_NAO_SAO_CONSULTA.includes(x.name))) expect([f.name, podeRodarJunto(f.name)]).toEqual([f.name, true]);
  });

  it('falha da IA continua virando o motivo (não lança)', async () => {
    const l = montar([]);
    l.portas.pedir = async () => {
      throw new FalhaDaIa('sem_credito' as any, 'empresa' as any);
    };
    const fim = await responderComFerramentas(l.portas, [], 'oi');
    expect(fim.motivo).toBe('sem_credito');
  });

  it('erro de verdade numa consulta sobe depois que as outras da vez terminam', async () => {
    const l = montar([pede(['resumo_do_dia', 'a'], ['vendas_do_periodo', 'b']), fala('nunca chega')]);
    let terminou = false;
    l.portas.executar = async (nome) => {
      if (nome === 'resumo_do_dia') throw new Error('quebrou');
      await esperar(20);
      terminou = true;
      return { ok: true, dados: {} };
    };
    await expect(responderComFerramentas(l.portas, [], 'x')).rejects.toThrow('quebrou');
    expect(terminou).toBe(true);
  });
});

describe('mister — rodarNaOrdem e as vagas do processo', () => {
  it('uma de cada vez para no primeiro erro (como antes): a seguinte não começa', async () => {
    const comecou: number[] = [];
    const tarefas = [0, 1, 2].map((i) => async () => {
      comecou.push(i);
      if (i === 1) throw new Error(`falhou ${i}`);
      return i;
    });
    await expect(rodarNaOrdem(tarefas, 1)).rejects.toThrow('falhou 1');
    expect(comecou).toEqual([0, 1]);
  });

  it('devolve na ordem das tarefas, não na de quem terminou', async () => {
    const r = await rodarNaOrdem([40, 5, 20].map((ms, i) => async () => (await esperar(ms), i)), 3);
    expect(r).toEqual([0, 1, 2]);
  });

  it('as vagas seguram o total do processo e a vaga volta mesmo quando o trabalho falha', async () => {
    const vagas = new Vagas(2);
    let rodando = 0;
    let maximo = 0;
    const trabalho = (falha: boolean) =>
      vagas.com(async () => {
        rodando++;
        maximo = Math.max(maximo, rodando);
        await esperar(10);
        rodando--;
        if (falha) throw new Error('falhou');
        return 'ok';
      });
    const r = await Promise.allSettled([trabalho(true), trabalho(false), trabalho(true), trabalho(false), trabalho(false)]);
    expect(maximo).toBe(2);
    expect(r.map((x) => x.status)).toEqual(['rejected', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
    // Depois de tudo, as duas vagas estão livres: duas entram juntas na hora.
    rodando = 0;
    maximo = 0;
    await Promise.all([trabalho(false), trabalho(false)]);
    expect(maximo).toBe(2);
  });

  it('duas perguntas ao mesmo tempo dividem as vagas do processo (TETOS.consultasNoProcesso)', async () => {
    const vagas = new Vagas(TETOS.consultasNoProcesso);
    let rodando = 0;
    let maximo = 0;
    const laco = () => {
      const l = montar([pede(['resumo_do_dia', 'a'], ['vendas_do_periodo', 'b'], ['estoque_em_alerta', 'c']), fala('Ok.')]);
      const executar = l.portas.executar;
      l.portas.executar = (n, e) =>
        vagas.com(async () => {
          rodando++;
          maximo = Math.max(maximo, rodando);
          try {
            return await executar(n, e);
          } finally {
            rodando--;
          }
        });
      return responderComFerramentas(l.portas, [], 'como está?');
    };
    const fins = await Promise.all([laco(), laco()]);
    expect(fins.every((f) => f.motivo === null)).toBe(true);
    expect(maximo).toBe(TETOS.consultasNoProcesso);
  });

  it('ERR-660 (rodada 7, MIS-H-05): o prazo é TOTAL — a chamada seguinte recebe só o que sobrou; com pouco, não chama', async () => {
    const agora = jest.spyOn(Date, 'now');
    let relogio = 1_000_000;
    agora.mockImplementation(() => relogio);
    try {
      const m = montar([pede(['vendas_do_periodo', 't1']), pede(['vendas_do_periodo', 't2']), fala('fim')], () => 0);
      const pedirOriginal = m.portas.pedir;
      // Cada chamada "leva" 30 s do relógio.
      m.portas.pedir = async (p) => {
        const r = await pedirOriginal(p);
        relogio += 30_000;
        return r;
      };
      const fim = await responderComFerramentas(m.portas, [], 'quanto vendi?');
      // 1ª: 30 s (sobram 75); 2ª: 30 s (sobram 45); 3ª: só os 15 s que sobraram dos 75 — nunca mais 30 s fixos.
      expect(m.pedidos.map((p) => p.prazoMs)).toEqual([30_000, 30_000, 15_000]);
      expect(fim.motivo).toBeNull();
      // Com 72 s gastos, não chama mais.
      relogio = 2_000_000;
      const m2 = montar([pede(['vendas_do_periodo', 't1']), fala('fim')], () => 0);
      const pedir2 = m2.portas.pedir;
      m2.portas.pedir = async (p) => {
        const r = await pedir2(p);
        relogio += 72_000;
        return r;
      };
      expect((await responderComFerramentas(m2.portas, [], 'quanto vendi?')).motivo).toBe('nao_fechou');
      expect(m2.pedidos).toHaveLength(1);
    } finally {
      agora.mockRestore();
    }
  });

  it('ERR-660 (MIS-H-05): a pergunta que já somou o teto de tokens de entrada não chama mais', async () => {
    const grande = { entrada: TETOS.tokensDeEntradaPorPergunta, saida: 1, cacheEscrita: 0, cacheLeitura: 0 };
    const m = montar([{ ...pede(['vendas_do_periodo', 't1']), uso: grande } as any, fala('não devia chegar aqui')], () => 0);
    expect((await responderComFerramentas(m.portas, [], 'quanto vendi?')).motivo).toBe('nao_fechou');
    expect(m.pedidos).toHaveLength(1);
  });
});
