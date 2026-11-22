import { FERRAMENTAS, INSTRUCOES_DO_MISTER, ehConsulta, entradaParaATrilha, podeRodarJunto } from './mister-agente.regras';
import {
  CAUSAS_DO_CANCELAMENTO,
  FOCOS_DA_ANALISE,
  LinhaOficial,
  NOME_DA_CAUSA,
  analiseDaMercadoria,
  analiseDaSemana,
  analiseDasFases,
  analiseDoPico,
  analiseDosCancelamentos,
  causaDoCancelamento,
  diaDeTrabalho,
  faixaDePico,
  itensDaFaixa,
  lerDiaDaSemana,
  lerLinhasOficiais,
  mesesCompletos,
  ultimosDiasDaSemana,
} from './mister-analises';
import { conferirConversa, CONVERSA_PADRAO } from './mister-conversa-config.service';
import { DescarteDoDia, botoesDoPadrao, padroesDoDescarte, regraDoPadrao, textoDaSugestao } from './mister-padroes';
import { planoDaMercadoria, planoDasFases, planoDoPico, planoDosCancelamentos } from './grafico/plano-da-analise';
import { imagemDoPlano } from './grafico/imagem-do-plano';
import { valeOPlano } from './grafico/plano-do-grafico';
import { refazerPlano } from './grafico/refazer-do-grafico';
import { FalhaDaIa } from '../ia/ia-empresa.service';
import { responderComFerramentas } from './mister-laco';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Versão 7, V7e: as contas das análises, a classificação dos cancelamentos (o texto livre traz nome de funcionário e nunca
// sai daqui), a troca de modelo só depois de uma análise com dados e o padrão do descarte. Os totais contra a conta oficial
// são provados com Postgres em `mister-pg.teste-spec.ts`.

const l = (dia: string, hora: number, pedidos: number, reais: number): LinhaOficial => ({ dia, hora, pedidos, centavos: Math.round(reais * 100) });

describe('a classificação dos cancelamentos', () => {
  it.each([
    ['fora da area de entrega (autorizado por Marcos)', 'fora_da_area'],
    ['FORA DA ÁREA', 'fora_da_area'],
    ['cancelado pelo cardapio_web', 'sem_motivo_do_canal'],
    ['cancelado pelo ifood', 'sem_motivo_do_canal'],
    ['Cancelado pelo 99food', 'sem_motivo_do_canal'],
    ['pediu duas vezes', 'repetido'],
    ['pediu repetido', 'repetido'],
    ['pediu repetio (autorizado por Marcos)', 'repetido'], // o erro de digitação que existe na loja real
    ['pedido em duplicidade', 'repetido'],
    ['cliente não atendeu', 'nao_atendeu'],
    ['engano', 'engano'],
    ['Cliente bloqueado', 'bloqueado'],
    ['pediu cancelamento', 'desistiu'],
    ['cancelou', 'desistiu'],
    ['teste', 'teste'],
    ['Pedido de TESTE (autorizado por Ana)', 'teste'],
    ['demorou demais', 'atraso'],
    ['acabou o bacon', 'item_em_falta'],
    ['falta de entregador', 'sem_entregador'],
    ['falta de pagamento', 'pagamento'],
    ['lançou errado', 'erro_de_lancamento'],
    ['', 'sem_motivo'],
    [null, 'sem_motivo'],
    ['   ', 'sem_motivo'],
    ['Marcos', 'outros'],
    ['(autorizado por Teste da Silva)', 'sem_motivo'],
    ['contestou o valor', 'outros'],
  ])('"%s" → %s', (motivo, causa) => {
    expect(causaDoCancelamento(motivo)).toBe(causa);
  });

  it('um nome depois de "autorizado por" não decide a causa', () => {
    expect(causaDoCancelamento('engano (autorizado por Teste Bloqueado)')).toBe('engano');
    expect(causaDoCancelamento('Marcos (autorizado por Fora da Area)')).toBe('outros');
  });

  it('toda causa tem nome, e o texto livre nunca sai da análise', () => {
    for (const c of CAUSAS_DO_CANCELAMENTO) expect(NOME_DA_CAUSA[c]).toBeTruthy();
    const grupos = [
      { motivo: 'fora da area (autorizado por Marcos Pereira)', dow: 5, hora: 21, pedidos: 4, centavos: 20000 },
      { motivo: 'Juliana', dow: 6, hora: 20, pedidos: 2, centavos: 8000 },
      { motivo: 'teste', dow: 1, hora: 10, pedidos: 3, centavos: 3000 },
      { motivo: 'cancelado pelo ifood', dow: 5, hora: 21, pedidos: 3, centavos: 9000 },
    ];
    const r = analiseDosCancelamentos(grupos, { pedidos: 12, centavos: 40000 }, true);
    const texto = JSON.stringify(r);
    expect(texto).not.toContain('Marcos');
    expect(texto).not.toContain('Juliana');
    expect(texto).not.toContain('autorizado');
    // O teste fica à parte e fora do total.
    expect(r.naoEntrou).toEqual({ pedidos: 9, valor: 370 });
    expect(r.pedidosDeTeste).toMatchObject({ pedidos: 3, valor: 30 });
    expect(r.principalCausa).toEqual({ causa: 'fora da área de entrega', pedidos: 4, valor: 200 });
    // A concentração não conta o teste, e sexta às 21h tem 7 dos 9.
    expect(r.ondeSeConcentra).toEqual({ diaDaSemana: { dia: 'sexta', pedidos: 7, partePct: 78 }, hora: { hora: '21h', pedidos: 7, partePct: 78 } });
    expect(r.avisos?.[0]).toContain('5 de 9 cancelamentos não dizem a causa');
  });

  it('sem permissão de valores não sai nenhum R$; com poucos, não diz onde se concentra', () => {
    const r = analiseDosCancelamentos([{ motivo: 'engano', dow: 2, hora: 19, pedidos: 2, centavos: 5000 }], { pedidos: 2, centavos: 5000 }, false);
    expect(r.naoEntrou).toEqual({ pedidos: 2, valor: null });
    expect(r.porCausa[0].valor).toBeNull();
    expect(r.ondeSeConcentra).toBeNull();
    expect(r.avisos?.[0]).toContain('ainda é pouco');
  });

  it('o que passou do teto de grupos entra em "outros" e o total continua certo', () => {
    const r = analiseDosCancelamentos([{ motivo: 'engano', dow: 2, hora: 19, pedidos: 2, centavos: 5000 }], { pedidos: 7, centavos: 12000 }, true);
    expect(r.naoEntrou).toEqual({ pedidos: 7, valor: 120 });
    expect(r.porCausa.find((c) => c.causa === 'outros motivos')).toMatchObject({ pedidos: 5, valor: 70, naoDizACausa: true });
  });
});

describe('a semana', () => {
  const base = { de: '2026-11-09', ate: '2026-11-15', deAnterior: '2026-11-02', ateAnterior: '2026-11-08', hoje: '2026-11-22', verValores: true };

  it('o período contra o anterior, a parte dos dois melhores dias e o mais fraco', () => {
    const r = analiseDaSemana({
      ...base,
      linhas: [l('2026-11-09', 20, 10, 100), l('2026-11-13', 20, 40, 400), l('2026-11-14', 21, 40, 400), l('2026-11-15', 20, 10, 100)],
      anteriores: [l('2026-11-02', 20, 10, 100), l('2026-11-06', 20, 20, 200), l('2026-11-07', 20, 20, 200), l('2026-11-08', 20, 10, 100)],
    });
    expect(r).toMatchObject({ faturamento: 1000, pedidos: 100, ticketMedio: 10, diasComVenda: 4 });
    expect(r.variacaoPct).toEqual({ faturamento: 66.7, pedidos: 66.7, ticketMedio: 0 });
    expect(r.diferencaDeFaturamento).toEqual({ valor: 400, sentido: 'a mais' });
    expect(r.doisMelhoresDias).toEqual({ dias: ['sexta', 'sábado'], pedidos: 80, faturamento: 800, partePct: 80 });
    expect(r.diaMaisFraco).toMatchObject({ dia: 'segunda', pedidos: 10 });
    expect(r.diasSemVenda).toEqual(['terça', 'quarta', 'quinta']);
    expect(r.porDiaDaSemana.map((d) => d.dia)).toEqual(['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
  });

  it('sem valores: nada em reais, e as partes são de pedidos', () => {
    const r = analiseDaSemana({ ...base, verValores: false, linhas: [l('2026-11-09', 20, 10, 900), l('2026-11-10', 20, 30, 100), l('2026-11-11', 20, 10, 100)], anteriores: [] });
    expect(r.faturamento).toBeNull();
    expect(r.ticketMedio).toBeNull();
    expect(r.variacaoPct.faturamento).toBeNull();
    expect(r.diferencaDeFaturamento).toBeNull();
    expect(r.porDiaDaSemana.every((d) => d.faturamento === null)).toBe(true);
    expect(r.doisMelhoresDias).toMatchObject({ dias: ['terça', 'segunda'], faturamento: null, partePct: 80 });
    expect(JSON.stringify(r)).not.toContain('900');
  });

  it('pouco dado: diz que não dá para apontar melhor e pior, e que não há o que comparar', () => {
    const r = analiseDaSemana({ ...base, linhas: [l('2026-11-09', 20, 10, 100)], anteriores: [] });
    expect(r.doisMelhoresDias).toBeNull();
    expect(r.diaMaisFraco).toBeNull();
    expect(r.avisos).toEqual(expect.arrayContaining([expect.stringContaining('não há com o que comparar'), expect.stringContaining('Poucos dias com venda')]));
    expect(analiseDaSemana({ ...base, ate: '2026-11-22', linhas: [], anteriores: [] }).avisos?.[0]).toContain('inclui hoje');
  });
});

describe('o pico', () => {
  it('a faixa é a menor janela com metade dos pedidos, e a noite passa da meia-noite', () => {
    expect(faixaDePico([{ hora: 19, pedidos: 20 }, { hora: 20, pedidos: 45 }, { hora: 21, pedidos: 35 }])).toEqual({ horas: [20, 21], de: '20h', ate: '22h' });
    expect(faixaDePico([{ hora: 20, pedidos: 80 }, { hora: 21, pedidos: 20 }])).toEqual({ horas: [20], de: '20h', ate: '21h' });
    // Flat: nenhuma janela chega à metade em 3 horas; fica a de 3 com mais pedidos.
    const plano = [12, 13, 14, 15, 16, 17, 18, 19].map((hora) => ({ hora, pedidos: hora === 18 ? 12 : 10 }));
    expect(faixaDePico(plano)!.horas).toHaveLength(3);
    // Atravessa a meia-noite: 23h e 00h são vizinhas.
    expect(faixaDePico([{ hora: 23, pedidos: 40 }, { hora: 0, pedidos: 40 }, { hora: 20, pedidos: 10 }])).toEqual({ horas: [23, 0], de: '23h', ate: '01h' });
    expect(faixaDePico([])).toBeNull();
  });

  it('a venda da madrugada é da noite anterior', () => {
    expect(diaDeTrabalho('2026-11-14', 1)).toBe('2026-11-13');
    expect(diaDeTrabalho('2026-11-14', 6)).toBe('2026-11-14');
    const r = analiseDoPico({
      dias: ['2026-11-13'],
      porSemanas: false,
      hoje: '2026-11-22',
      verValores: true,
      linhas: [l('2026-11-13', 1, 5, 50), l('2026-11-13', 20, 25, 250), l('2026-11-13', 21, 25, 250), l('2026-11-14', 1, 10, 100), l('2026-11-14', 20, 99, 999)],
    });
    expect(r.totalDoDia).toEqual({ pedidos: 60, faturamento: 600 });
    expect(r.porHora.map((h) => h.hora)).toEqual(['20h', '21h', '01h']);
    expect(r.faixaDePico).toMatchObject({ de: '20h', ate: '22h', pedidos: 50, faturamento: 500, partePct: 83 });
  });

  it('ao longo das semanas: os dias certos, a média por dia e o aviso de pouco dado', () => {
    expect(ultimosDiasDaSemana(5, 3, '2026-11-20')).toEqual(['2026-10-30', '2026-11-06', '2026-11-13']);
    expect(ultimosDiasDaSemana(5, 2, '2026-11-21')).toEqual(['2026-11-13', '2026-11-20']);
    expect(lerDiaDaSemana('sexta-feira')).toBe(5);
    expect(lerDiaDaSemana('SÁB')).toBe(6);
    expect(lerDiaDaSemana('terca')).toBe(2);
    expect(lerDiaDaSemana('xis')).toBeNull();
    const r = analiseDoPico({ dias: ['2026-11-06', '2026-11-13'], porSemanas: true, hoje: '2026-11-22', verValores: true, linhas: [l('2026-11-06', 20, 10, 100), l('2026-11-13', 20, 30, 300)] });
    expect(r.faixaDePico?.mediaPorDia).toEqual({ pedidos: 20, faturamento: 200 });
    expect(r.avisos?.[0]).toContain('pouco para falar em padrão');
  });

  it('os itens e os pares, com "em X de Y pedidos"; com poucos pedidos, nada de pares', () => {
    const r = itensDaFaixa([{ item: 'Smash', quantidade: 58, pedidos: 50 }], [{ a: 'Batata', b: 'Smash', juntos: 38 }, { a: 'Coca', b: 'Smash', juntos: 1 }], 94, 100);
    expect(r.saemJuntos).toEqual([{ itens: 'Batata + Smash', juntos: 38, de: 94, frase: 'em 38 de 94 pedidos', partePct: 40 }]);
    expect(r.observacaoDosItens).toContain('6 pedido(s)');
    expect(itensDaFaixa([], [{ a: 'A', b: 'B', juntos: 3 }], 4, 4).saemJuntos).toEqual([]);
  });

  it('a parte sem valores é de pedidos e o R$ não sai', () => {
    const r = analiseDoPico({ dias: ['2026-11-13'], porSemanas: false, hoje: '2026-11-22', verValores: false, linhas: [l('2026-11-13', 20, 30, 700), l('2026-11-13', 21, 10, 100)] });
    expect(r.faixaDePico).toMatchObject({ faturamento: null, partePct: 75 });
    expect(r.totalDoDia.faturamento).toBeNull();
    expect(r.porHora.every((h) => h.faturamento === null)).toBe(true);
  });
});

describe('as fases do mês', () => {
  it('só meses COMPLETOS, inclusive na virada do ano', () => {
    expect(mesesCompletos('2026-11-22').map((m) => m.nome)).toEqual(['agosto', 'setembro', 'outubro']);
    expect(mesesCompletos('2026-11-22')[2]).toEqual({ de: '2026-10-01', ate: '2026-10-31', nome: 'outubro' });
    expect(mesesCompletos('2027-02-01').map((m) => m.de)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(mesesCompletos('2026-03-15')[2].ate).toBe('2026-02-28');
  });

  it('por dia conta só os dias em que a loja vendeu, e o dia fechado não puxa a média', () => {
    const meses = [{ de: '2026-10-01', ate: '2026-10-31', nome: 'outubro' }, { de: '2026-09-01', ate: '2026-09-30', nome: 'setembro' }];
    const linhas: LinhaOficial[] = [];
    for (const m of ['09', '10']) {
      for (let d = 1; d <= 10; d++) linhas.push(l(`2026-${m}-${String(d).padStart(2, '0')}`, 20, 10, 100));
      // Na fase do fim a loja abriu só em 8 dos dias, vendendo menos por dia.
      for (let d = 21; d <= 28; d++) linhas.push(l(`2026-${m}-${d}`, 20, 5, 40));
      for (let d = 11; d <= 20; d++) linhas.push(l(`2026-${m}-${d}`, 20, 8, 80));
    }
    const r = analiseDasFases(linhas, meses, true);
    expect(r.fases.map((f) => f.diasComVenda)).toEqual([20, 20, 16]);
    expect(r.fases[0]).toMatchObject({ vendaPorDia: 100, pedidosPorDia: 10, ticketMedio: 10 });
    expect(r.fases[2]).toMatchObject({ vendaPorDia: 40, pedidosPorDia: 5, ticketMedio: 8 });
    expect(r.doComecoParaOFim).toEqual({ vendaPorDiaPct: -60, pedidosPorDiaPct: -50, ticketPct: -20 });
    expect(r.comoContei).toContain('só os dias em que a loja vendeu');
    expect(r.totalDosMeses.faturamento).toBe(2 * (1000 + 800 + 320));
  });

  it('mês incompleto e um mês só: diz isso e não conclui', () => {
    const meses = mesesCompletos('2026-11-22');
    const r = analiseDasFases([l('2026-10-02', 20, 10, 100), l('2026-10-25', 20, 10, 50)], meses, true);
    expect(r.doComecoParaOFim).toBeNull();
    expect(r.avisos?.join(' ')).toContain('Ainda não há dois meses completos');
    expect(r.avisos?.join(' ')).toContain('agosto, setembro e outubro');
  });

  it('sem valores: nada em reais', () => {
    const r = analiseDasFases([l('2026-10-02', 20, 10, 100)], mesesCompletos('2026-11-22'), false);
    expect(r.fases[0]).toMatchObject({ faturamento: null, vendaPorDia: null, ticketMedio: null, pedidosPorDia: 10 });
    expect(r.totalDosMeses.faturamento).toBeNull();
  });
});

describe('a mercadoria perdida', () => {
  it('nada lançado não vira R$ 0: o valor fica nulo e diz o que falta lançar', () => {
    const r = analiseDaMercadoria([], [], 0, true);
    expect(r.temDados).toBe(false);
    expect(r.valorPerdido).toBeNull();
    expect(r.desperdicio.valor).toBeNull();
    expect(r.contagem.valorQueFaltou).toBeNull();
    expect(r.oQueFalta?.join(' ')).toContain('Estoque › aba "Desperdício"');
    expect(r.oQueFalta?.join(' ')).toContain('Estoque › aba "Contagem"');
  });

  it('o registro sem custo conta na quantidade e não no valor, e a resposta diz', () => {
    const r = analiseDaMercadoria([{ item: 'Tomate', unidade: 'kg', registros: 1, quantidade: 3, centavos: 0, semCusto: 1 }], [], 0, true);
    expect(r.temDados).toBe(true);
    expect(r.valorPerdido).toBeNull();
    expect(r.desperdicio).toMatchObject({ registros: 1, registrosSemCusto: 1, valor: null });
    expect(r.desperdicio.itens[0]).toMatchObject({ item: 'Tomate', quantidade: 3, valor: null, registrosSemCusto: 1 });
    expect(r.oQueFalta?.join(' ')).toContain('1 registro(s) de desperdício sem custo');
  });

  it('soma desperdício e o que faltou na contagem; a sobra não abate', () => {
    const r = analiseDaMercadoria(
      [{ item: 'Tomate', unidade: 'kg', registros: 2, quantidade: 16, centavos: 12400, semCusto: 0 }],
      [
        { item: 'Muçarela', unidade: 'kg', diferenca: -4.3, centavos: 16800 },
        { item: 'Bacon', unidade: 'kg', diferenca: 2, centavos: 8800 },
      ],
      5,
      true,
    );
    expect(r.valorPerdido).toBe(292);
    expect(r.contagem.valorQueFaltou).toBe(168);
    expect(r.contagem.faltou).toEqual([{ item: 'Muçarela', quantidade: 4.3, unidade: 'kg', valor: 168 }]);
    expect(r.contagem.sobrou).toMatchObject({ itens: 1, valor: 88 });
    expect(r.oQueFalta).toBeUndefined();
  });

  it('sem valores, nenhum R$', () => {
    const r = analiseDaMercadoria([{ item: 'Tomate', unidade: 'kg', registros: 1, quantidade: 3, centavos: 900, semCusto: 0 }], [{ item: 'Bacon', unidade: 'kg', diferenca: -1, centavos: 500 }], 1, false);
    expect(r.valorPerdido).toBeNull();
    expect(r.desperdicio.valor).toBeNull();
    expect(r.desperdicio.itens[0].valor).toBeNull();
    expect(r.contagem.faltou[0].valor).toBeNull();
    expect(r.contagem.valorQueFaltou).toBeNull();
  });
});

describe('a conta oficial e o resto', () => {
  it('cada linha se arredonda em centavos antes de somar, como na conta oficial', () => {
    const r = lerLinhasOficiais([{ chave: '2026-11-13', hora: 20, qtd: 2, fat: '10.005' }, { chave: '2026-11-13', hora: 20, qtd: 1, fat: '0.335' }]);
    expect(r.map((x) => x.centavos)).toEqual([1001, 34]);
  });

  it('a ferramenta existe, é consulta, tem os quatro focos e a trilha guarda o foco', () => {
    const f = FERRAMENTAS.find((x) => x.name === 'analisar_vendas')!;
    expect(f.input_schema.properties.foco.enum).toEqual([...FOCOS_DA_ANALISE]);
    expect(ehConsulta('analisar_vendas')).toBe(true);
    expect(podeRodarJunto('analisar_vendas')).toBe(true);
    expect(entradaParaATrilha({ foco: 'pico', diaDaSemana: 'sexta', semanas: 4 })).toEqual({ foco: 'pico', diaDaSemana: 'sexta', semanas: 4 });
    expect(FERRAMENTAS.find((x) => x.name === 'mostrar_grafico')!.input_schema.properties.tipo.enum).toEqual(expect.arrayContaining(['pico', 'fases_do_mes', 'cancelamentos_por_causa', 'mercadoria_perdida']));
  });

  it('as instruções: o resultado primeiro, o fato separado da sugestão, nunca aplica sozinho, e sem dado não estima', () => {
    expect(INSTRUCOES_DO_MISTER).toContain('AS ANÁLISES DE VENDA');
    expect(INSTRUCOES_DO_MISTER).toContain('Primeiro o RESULTADO');
    expect(INSTRUCOES_DO_MISTER).toContain('"O que os números mostram:"');
    expect(INSTRUCOES_DO_MISTER).toContain('"Minha sugestão:"');
    expect(INSTRUCOES_DO_MISTER).toContain('não chame nenhuma ferramenta que propõe ou muda algo por causa dela');
    expect(INSTRUCOES_DO_MISTER).toContain('nunca use média do setor');
    expect(INSTRUCOES_DO_MISTER).toContain('nunca diga "R$ 0 de perda"');
    expect(INSTRUCOES_DO_MISTER).toContain('Não aponte pessoa');
  });

  it('"Análises mais profundas" nasce desligada e só aceita booleano (V15)', () => {
    expect(CONVERSA_PADRAO.analisesProfundas).toBe(false);
    expect(conferirConversa({ analisesProfundas: true })).toEqual({ analisesProfundas: true });
    expect(conferirConversa({ analisesProfundas: false })).toEqual({ analisesProfundas: false });
    for (const v of ['true', 1, null, {}]) expect(conferirConversa({ analisesProfundas: v })).toHaveProperty('erro');
  });
});

describe('os gráficos das análises', () => {
  const lidoEm = '22/11 às 09:10';
  it('o pico: a faixa em destaque, a imagem sai, e sem valores não há R$', () => {
    const porHora = [
      { hora: '19h', pedidos: 10, faturamento: 500 },
      { hora: '20h', pedidos: 40, faturamento: 2000 },
      { hora: '21h', pedidos: 30, faturamento: 1500 },
    ];
    const faixa = { de: '20h', ate: '22h', pedidos: 70, faturamento: 3500, partePct: 88 };
    const p = planoDoPico({ loja: 'Loja', rotulo: '13/11', verValores: true, lidoEm, diasComVenda: 1, porHora, faixa, horasDaFaixa: ['20h', '21h'] });
    expect(p.titulo).toBe('Das 20h às 22h sai 88% da venda');
    expect(p.faixa).toEqual([2, 3]);
    expect(valeOPlano(p)).toBe(true);
    expect(imagemDoPlano(p).subarray(1, 4).toString()).toBe('PNG');
    const sem = planoDoPico({ loja: 'Loja', rotulo: '13/11', verValores: false, lidoEm, diasComVenda: 2, porHora: porHora.map((h) => ({ ...h, faturamento: null })), faixa: { ...faixa, faturamento: null }, horasDaFaixa: ['20h', '21h'] });
    expect(JSON.stringify(sem)).not.toContain('R$');
    expect(sem.titulo).toContain('dos pedidos');
    expect(sem.barras?.map((b) => b.valor)).toEqual([5, 20, 15]);
  });

  it('o "refazer" tira a faixa quando a ordem muda, e mantém quando só o título muda', () => {
    const p = planoDoPico({ loja: 'L', rotulo: 'x', verValores: true, lidoEm, diasComVenda: 1, porHora: [{ hora: '20h', pedidos: 1, faturamento: 5 }, { hora: '21h', pedidos: 3, faturamento: 9 }], faixa: { de: '21h', ate: '22h', pedidos: 3, faturamento: 9, partePct: 75 }, horasDaFaixa: ['21h'] });
    const mesmo = refazerPlano(p, { titulo: 'O pico da noite' });
    expect('plano' in mesmo && mesmo.plano.faixa).toEqual([2]);
    const ordem = refazerPlano(p, { ordem: 'maior' });
    expect('plano' in ordem && ordem.plano.faixa).toBeUndefined();
  });

  it('as fases, os cancelamentos e a mercadoria', () => {
    const f = planoDasFases({
      loja: 'L',
      meses: 'agosto, setembro e outubro',
      verValores: true,
      lidoEm,
      fases: [
        { fase: 'dias 1 a 10', diasComVenda: 30, vendaPorDia: 6125, pedidosPorDia: 123 },
        { fase: 'dias 11 a 20', diasComVenda: 30, vendaPorDia: 5242, pedidosPorDia: 110 },
        { fase: 'dias 21 ao fim', diasComVenda: 32, vendaPorDia: 4320, pedidosPorDia: 100 },
      ],
      doComecoParaOFim: { vendaPorDiaPct: -29.5, pedidosPorDiaPct: -18.7 },
    });
    expect(f.titulo).toBe('A venda cai ao longo do mês');
    expect(f.destaque).toBe(3);
    const c = planoDosCancelamentos({ loja: 'L', rotulo: 'x', verValores: false, lidoEm, naoEntrou: { pedidos: 9, valor: null }, porCausa: [{ causa: 'atraso', pedidos: 5, valor: null }, { causa: 'engano', pedidos: 4, valor: null }] });
    expect(c.titulo).toBe('Cancelamentos: 9 pedidos');
    expect(JSON.stringify(c)).not.toContain('R$');
    expect(c.partes?.[0].nome).toBe('atraso (5)');
    const m = planoDaMercadoria({ loja: 'L', rotulo: 'x', lidoEm, valorPerdido: 292, desperdicio: [{ item: 'Tomate', valor: 124 }, { item: 'Sem custo', valor: null }], faltou: [{ item: 'Muçarela', valor: 168 }] });
    expect(m.partes?.map((x) => x.nome)).toEqual(['Muçarela (contagem)', 'Tomate']);
    expect(valeOPlano(planoDaMercadoria({ loja: 'L', rotulo: 'x', lidoEm, valorPerdido: null, desperdicio: [], faltou: [] }))).toBe(false);
  });
});

describe('o modelo maior só depois de uma análise com dados (V7-7)', () => {
  const usar = (nome: string, input: any = {}) => ({ texto: '', recusou: false, origem: 'lojista', uso: { entrada: 1, cacheEscrita: 0, cacheLeitura: 0, saida: 1 }, parou: 'tool_use', conteudo: [{ type: 'tool_use', id: `t-${nome}`, name: nome, input }] });
  const falar = { texto: 'Pronto.', recusou: false, origem: 'lojista', uso: { entrada: 1, cacheEscrita: 0, cacheLeitura: 0, saida: 1 }, parou: 'end_turn', conteudo: [{ type: 'text', text: 'Pronto.' }] };
  const rodar = async (roteiro: any[], executar: (n: unknown) => any, modeloDaAnalise: string | null = 'claude-sonnet-5-5') => {
    const modelos: string[] = [];
    const fim = await responderComFerramentas(
      {
        modelo: 'claude-haiku-5-5',
        modeloDaAnalise,
        conversa: 'c',
        pedir: async (p: any) => {
          modelos.push(p.modelo);
          return roteiro.shift();
        },
        executar: async (n) => executar(n),
      },
      [],
      'como foi a semana?',
    );
    return { modelos, fim };
  };

  it('a pergunta começa no modelo de sempre e só a volta depois da análise usa o maior; a trilha diz qual escreveu', async () => {
    const { modelos, fim } = await rodar([usar('analisar_vendas', { foco: 'semana' }), falar], () => ({ ok: true, dados: { pedidos: 10 } }));
    expect(modelos).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(fim.trilha.modelo).toBe('claude-sonnet-5-5');
  });

  it('desligado, outra consulta, análise vazia ou com erro: fica no modelo de sempre', async () => {
    expect((await rodar([usar('analisar_vendas'), falar], () => ({ ok: true, dados: { pedidos: 1 } }), null)).modelos).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5']);
    expect((await rodar([usar('vendas_do_periodo'), falar], () => ({ ok: true, dados: {} }))).modelos).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5']);
    expect((await rodar([usar('analisar_vendas'), falar], () => ({ ok: true, dados: { semDados: true } }))).modelos).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5']);
    const comErro = await rodar([usar('analisar_vendas'), falar], () => ({ ok: false, dados: { erro: 'não li' } }));
    expect(comErro.modelos).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5']);
    expect(comErro.fim.trilha.modelo).toBe('claude-haiku-5-5');
  });

  it('se o modelo maior falha, o de sempre responde; se o de sempre falha, a falha aparece', async () => {
    const falha = new FalhaDaIa('limite' as any, 'lojista');
    const pedidos: string[] = [];
    const respostas: any[] = [usar('analisar_vendas', { foco: 'semana' }), falha, falar];
    const fim = await responderComFerramentas(
      {
        modelo: 'claude-haiku-5-5',
        modeloDaAnalise: 'claude-sonnet-5-5',
        conversa: 'c',
        pedir: async (p: any) => {
          pedidos.push(p.modelo);
          const r = respostas.shift();
          if (r instanceof FalhaDaIa) throw r;
          return r;
        },
        executar: async () => ({ ok: true, dados: { pedidos: 10 } }),
      },
      [],
      'como foi a semana?',
    );
    expect(pedidos).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(fim).toMatchObject({ texto: 'Pronto.', motivo: null, trilha: { modelo: 'claude-haiku-5-5' } });
    const semIa = await responderComFerramentas(
      {
        modelo: 'claude-haiku-5-5',
        modeloDaAnalise: 'claude-sonnet-5-5',
        conversa: 'c',
        pedir: async () => {
          throw falha;
        },
        executar: async () => ({ ok: true, dados: {} }),
      },
      [],
      'como foi a semana?',
    );
    expect(semIa).toMatchObject({ texto: null, motivo: 'limite' });
  });
});

describe('o padrão do descarte', () => {
  const hoje = '2026-11-23'; // segunda
  const d = (dia: string, quantidade = 16, unidade: string | null = 'kg', centavos: number | null = 12400, item = 'Tomate', itemId = 'i1'): DescarteDoDia => ({ itemId, item, dia, quantidade, unidade, centavos });

  it('3 das últimas 5 semanas no mesmo dia viram padrão; 2 não', () => {
    // Segundas: 16/11, 09/11, 02/11, 26/10, 19/10.
    const [p] = padroesDoDescarte([d('2026-11-16'), d('2026-11-09'), d('2026-11-02'), d('2026-10-26')], hoje);
    expect(p).toMatchObject({ item: 'Tomate', diaDaSemana: 1, semanas: 4, quantidadePorVez: 16, unidade: 'kg', valorPorVez: 124 });
    expect(padroesDoDescarte([d('2026-11-16'), d('2026-11-09')], hoje)).toEqual([]);
  });

  it('fora da janela não conta, e dias da semana diferentes não se somam', () => {
    // 12/10 está fora das 5 semanas; hoje não conta.
    expect(padroesDoDescarte([d('2026-11-16'), d('2026-11-09'), d('2026-10-12'), d('2026-11-23')], hoje)).toEqual([]);
    expect(padroesDoDescarte([d('2026-11-16'), d('2026-11-10'), d('2026-11-04')], hoje)).toEqual([]);
  });

  it('um padrão por item: o dia com mais semanas', () => {
    const r = padroesDoDescarte([d('2026-11-16'), d('2026-11-09'), d('2026-11-02'), d('2026-11-20'), d('2026-11-13'), d('2026-11-06'), d('2026-10-30')], hoje);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ diaDaSemana: 5, semanas: 4 });
  });

  it('unidades diferentes não se somam, e sem custo em algum dia o valor fica de fora', () => {
    const [p] = padroesDoDescarte([d('2026-11-16', 1, 'kg'), d('2026-11-09', 2, 'cx'), d('2026-11-02', 3, 'kg', null)], hoje);
    expect(p).toMatchObject({ quantidadePorVez: null, unidade: null, valorPorVez: null });
  });

  it('o texto: fato e sugestão separados, o R$ só para quem vê, sem dizer quanto comprar, e só o "Deixa assim"', () => {
    const [p] = padroesDoDescarte([d('2026-11-16'), d('2026-11-09'), d('2026-11-02'), d('2026-10-26')], hoje);
    const { itemId: _i, ...resto } = p;
    const dados = { tipo: 'descarte_no_dia_da_semana' as const, ...resto };
    const com = textoDaSugestao(dados, false, true);
    expect(com).toContain('Percebi um padrão: Tomate');
    expect(com).toContain('O que os números mostram: em 4 das últimas 5 segundas houve descarte de Tomate, cerca de 16 kg por vez, R$ 124,00 por vez.');
    expect(com).toContain('Minha sugestão:');
    expect(com).toContain('Nada muda sem você pedir.');
    expect(textoDaSugestao(dados, false, false)).not.toContain('R$');
    expect(botoesDoPadrao('descarte_no_dia_da_semana', '00000000-0000-4000-8000-000000000001', false).map((b) => b.titulo)).toEqual(['Deixa assim']);
    expect(regraDoPadrao(dados)).toBeNull();
  });
});
