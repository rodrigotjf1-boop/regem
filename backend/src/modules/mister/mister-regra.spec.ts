import {
  Agora,
  FONTES_DA_REGRA,
  LinhaDaFonte,
  QuemFazARegra,
  Regra,
  avaliarRegra,
  chaveDaRegra,
  comOQueDeixaDeChegar,
  conferirRegra,
  descreverRegra,
  lerBotaoDaRegra,
  linhasDaRegra,
  olhaAgora,
  textoDoDisparo,
  botoesDaProposta,
} from './mister-regra';
import { FONTES_LIDAS, agoraNaLoja, dentroDoHorarioDaLoja } from './mister-regras.service';
import { FERRAMENTAS } from './mister-agente.regras';

// Versão 6, M6e (mig 472): as regras de cada pessoa — a conferência, a descrição e a avaliação, sem banco. Os exemplos do
// dono (20/11) só provam que a linguagem cabe neles; não são uma lista.

const presidente: QuemFazARegra = { presidente: true, pode: () => true, verValores: true };
const gerenteSemValores: QuemFazARegra = { presidente: false, pode: (p: string) => p === 'delivery', verValores: false };
const substituivel = (t: string) => ['pedido_parado', 'impressora', 'servidor_sem_sinal'].includes(t);
const conferir = (r: unknown, quem = presidente) => conferirRegra(r, quem, substituivel);
const ok = (r: unknown, quem = presidente): Regra => {
  const c = conferir(r, quem);
  if ('erro' in c) throw new Error(c.erro);
  return c.regra;
};
const AGORA = (hora = '21:40', dia = '2026-11-20', diaDaSemana = 5): Agora => ({ instante: new Date(`${dia}T${hora}:00-03:00`), dia, diaDaSemana, hora });
const pedido = (id: string, numero: number, campos: Record<string, unknown>): LinhaDaFonte => ({
  id,
  alvoId: id,
  rotulo: `#${numero} · iFood ${4800 + numero}`,
  unidadeId: null,
  campos: { numero, canal: 'ifood', tipo: 'entrega', situacao: 'em_preparo', ...campos },
});

const TRES_PARADOS = {
  fonte: 'pedidos',
  titulo: '3 pedidos há mais de 20 min em preparo',
  filtros: [
    { campo: 'situacao', op: '=', valor: 'em_preparo' },
    { campo: 'min_desde_aceite', op: '>', valor: 20 },
  ],
  medida: 'quantidade',
  condicao: { op: '>=', valor: 3 },
  quando: {},
  vezes: 'sempre',
  agrupar: true,
  substitui: ['pedido_parado'],
};

describe('a conferência da regra que a IA escreve', () => {
  it('os exemplos do dono cabem na linguagem', () => {
    expect(ok(TRES_PARADOS)).toMatchObject({ fonte: 'pedidos', medida: 'quantidade', condicao: { op: '>=', valor: 3 }, substitui: ['pedido_parado'] });
    expect(
      ok({ fonte: 'pedidos', titulo: 'Despacho acima de 30 min', filtros: [{ campo: 'min_aceite_ate_saida', op: '>', valor: 30 }], medida: 'cada_item', quando: {}, vezes: 'sempre', agrupar: true }),
    ).toMatchObject({ medida: 'cada_item', condicao: null });
    expect(
      ok({
        fonte: 'contas',
        titulo: 'Boleto Distribuidora Sul',
        filtros: [],
        alvo: { id: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90', rotulo: 'x' },
        medida: 'cada_item',
        quando: { data: '2026-11-25', em: '16:00' },
        vezes: 'uma_vez',
        agrupar: true,
      }),
    ).toMatchObject({ vezes: 'uma_vez', quando: { data: '2026-11-25', em: '16:00' } });
    expect(
      ok({
        fonte: 'tarefas',
        titulo: 'Limpar a chapa não feita',
        filtros: [{ campo: 'situacao', op: 'em', valor: ['pendente', 'em_execucao', 'parcial', 'nao_feita'] }],
        algum: [
          { campo: 'situacao', op: '=', valor: 'nao_feita' },
          { campo: 'min_apos_o_fim', op: '>', valor: 30 },
        ],
        alvo: { id: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b91', rotulo: 'Limpar a chapa' },
        medida: 'cada_item',
        quando: {},
        vezes: 'sempre',
        agrupar: true,
      }),
    ).toMatchObject({ algum: [{ campo: 'situacao' }, { campo: 'min_apos_o_fim' }] });
    expect(
      ok({ fonte: 'vendas', titulo: 'Venda abaixo de 2 mil às 20h', filtros: [{ campo: 'faturamento', op: '<', valor: 2000 }], medida: 'cada_item', quando: { dias: [2, 3, 4], em: '20:00' }, vezes: 'sempre', agrupar: true }),
    ).toMatchObject({ quando: { dias: [2, 3, 4], em: '20:00' } });
    expect(
      ok({
        fonte: 'equipamentos',
        titulo: 'Impressora da cozinha antes do fechamento',
        filtros: [
          { campo: 'tipo', op: '=', valor: 'impressora' },
          { campo: 'nome', op: 'contem', valor: 'cozinha' },
          { campo: 'no_expediente', op: '=', valor: true },
        ],
        medida: 'cada_item',
        quando: {},
        vezes: 'sempre',
        agrupar: true,
      }),
    ).toMatchObject({ fonte: 'equipamentos' });
  });

  it('recusa com a frase certa o que não existe ou não pode', () => {
    expect(conferir({ ...TRES_PARADOS, fonte: 'clima' })).toEqual({ erro: expect.stringContaining('Essa fonte não existe') });
    expect(conferir({ ...TRES_PARADOS, filtros: [{ campo: 'temperatura', op: '>', valor: 30 }] })).toEqual({ erro: expect.stringContaining('não tem o campo "temperatura"') });
    expect(conferir({ ...TRES_PARADOS, filtros: [{ campo: 'situacao', op: '>', valor: 'em_preparo' }] })).toEqual({ erro: expect.stringContaining('aceita') });
    expect(conferir({ ...TRES_PARADOS, filtros: [{ campo: 'situacao', op: '=', valor: 'atrasado' }] })).toEqual({ erro: expect.stringContaining('aceita:') });
    expect(conferir({ ...TRES_PARADOS, condicao: null })).toEqual({ erro: expect.stringContaining('quando dispara') });
    expect(conferir({ ...TRES_PARADOS, substitui: ['certificado'] })).toEqual({ erro: expect.stringContaining('crítico') });
    expect(conferir({ ...TRES_PARADOS, substitui: ['inventado'] })).toEqual({ erro: expect.stringContaining('não é um aviso da empresa') });
    expect(conferir({ ...TRES_PARADOS, titulo: '' })).toEqual({ erro: expect.stringContaining('título') });
    expect(conferir({ ...TRES_PARADOS, quando: { de: '18:00' } })).toEqual({ erro: expect.stringContaining('começo e do fim') });
    expect(conferir({ ...TRES_PARADOS, vezes: 'uma_vez' })).toEqual({ erro: expect.stringContaining('hora de olhar') });
    expect(conferir({ fonte: 'pedidos', titulo: 'tudo', filtros: [], medida: 'cada_item', quando: {}, vezes: 'sempre', agrupar: true })).toEqual({
      erro: expect.stringContaining('avisaria de tudo'),
    });
    expect(conferir({ fonte: 'caixas', titulo: 'x', filtros: [], alvo: { id: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90' }, medida: 'cada_item', quando: {}, vezes: 'sempre', agrupar: true })).toEqual({
      erro: expect.stringContaining('não se escolhe um item'),
    });
  });

  it('a permissão e os valores em reais são do perfil de quem cria', () => {
    expect(conferir({ ...TRES_PARADOS }, gerenteSemValores)).not.toHaveProperty('erro');
    expect(conferir({ fonte: 'contas', titulo: 'x', filtros: [{ campo: 'dias_para_vencer', op: '<=', valor: 1 }], medida: 'cada_item', quando: {}, vezes: 'sempre', agrupar: true }, gerenteSemValores)).toEqual({
      erro: expect.stringContaining('não dá acesso a contas a pagar'),
    });
    expect(conferir({ ...TRES_PARADOS, filtros: [{ campo: 'valor', op: '>', valor: 100 }] }, gerenteSemValores)).toEqual({ erro: expect.stringContaining('valores em reais') });
  });

  it('ERR-661 · MIS-I-12: a tarefa traz o nome de quem faz — só com a permissão da gestão das tarefas', () => {
    const TAREFA = { fonte: 'tarefas', titulo: 'Chapa', filtros: [{ campo: 'situacao', op: '=', valor: 'nao_feita' }], medida: 'cada_item', quando: {}, vezes: 'sempre', agrupar: true };
    expect(conferir(TAREFA, gerenteSemValores)).toEqual({ erro: expect.stringContaining('não dá acesso a tarefas de hoje') });
    expect(conferir({ ...TAREFA, filtros: [{ campo: 'quem', op: '=', valor: 'Ana' }] }, gerenteSemValores)).toEqual({ erro: expect.stringContaining('não dá acesso a tarefas de hoje') });
    const comChecklist: QuemFazARegra = { presidente: false, pode: (p: string) => p === 'checklist', verValores: false };
    expect(conferir(TAREFA, comChecklist)).not.toHaveProperty('erro');
  });
});

describe('a descrição (o código escreve)', () => {
  it('diz o que vai observar, quando dispara, como avisa e o que deixa de chegar', () => {
    const d = descreverRegra(ok(TRES_PARADOS));
    expect(d).toContain('Quando 3 ou mais pedidos em preparo passarem de 20 min, te mando uma mensagem só, com a lista.');
    expect(d).toContain('Com menos de 3, eu fico quieto.');
    expect(d).toContain('repito depois de 30 min, só se a lista mudar');
    expect(d).toContain('deixa de chegar');
    const b = descreverRegra(
      ok({ fonte: 'contas', titulo: 'Boleto', filtros: [], alvo: { id: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90', rotulo: 'Boleto · Distribuidora Sul' }, medida: 'cada_item', quando: { data: '2026-11-25', em: '16:00' }, vezes: 'uma_vez', agrupar: true }),
    );
    expect(b).toContain('só no dia 25/11/2026');
    expect(b).toContain('olhando às 16:00');
    expect(b).toContain('Avisa uma vez e a regra se encerra.');
  });
});

describe('a regra que junta os pedidos parados fica no lugar do aviso um a um (ERR-561)', () => {
  const { substitui: _, ...semSubstitui } = TRES_PARADOS;
  const com = (mudar: Record<string, unknown>) => ok({ ...semSubstitui, ...mudar });
  const situacao = (valor: unknown, op = '=') => [
    { campo: 'situacao', op, valor },
    { campo: 'min_desde_aceite', op: '>=', valor: 20 },
  ];

  it('a resposta que resumiu a proposta ganha a frase do que deixa de chegar; a que já fala disso não repete', () => {
    const frase = 'O aviso "pedido parado (em preparo)" deixa de chegar no seu WhatsApp enquanto a regra estiver ligada.';
    const resultados = [{ regras: [] }, { oQueVouFazer: 'x', dizerAntesDoConfirmar: frase }];
    expect(comOQueDeixaDeChegar('Montei a regra.', resultados)).toBe(`Montei a regra.\n\n${frase}`);
    expect(comOQueDeixaDeChegar('Montei. Os avisos deixam de chegar.', resultados)).toBe('Montei. Os avisos deixam de chegar.');
    expect(comOQueDeixaDeChegar('Vendeu bem hoje.', [{ total: 10 }])).toBe('Vendeu bem hoje.');
  });

  it('sem dizer nada, cala só a etapa da regra e diz isso antes do Confirmar', () => {
    const r = ok(semSubstitui);
    expect(r.substitui).toEqual(['pedido_parado:confirmado']);
    expect(descreverRegra(r)).toContain('O aviso "pedido parado (em preparo)" deixa de chegar no seu WhatsApp');
    expect(com({ filtros: situacao(['aguardando_aceite', 'em_preparo'], 'em') }).substitui).toEqual(['pedido_parado:novo', 'pedido_parado:confirmado']);
    expect(com({ filtros: situacao(['aguardando_aceite', 'em_preparo', 'pronto'], 'em') }).substitui).toEqual(['pedido_parado']);
  });

  it('não cala nada quando a regra não fala de pedido parado ou a pessoa quer os dois', () => {
    expect(com({ filtros: [{ campo: 'situacao', op: '=', valor: 'em_preparo' }] }).substitui).toBeUndefined(); // volume, sem tempo
    expect(com({ filtros: situacao('a_caminho') }).substitui).toBeUndefined();
    expect(com({ medida: 'cada_item', condicao: null }).substitui).toBeUndefined();
    expect(com({ agrupar: false }).substitui).toBeUndefined();
    expect(com({ condicao: { op: '<', valor: 3 } }).substitui).toBeUndefined();
    expect(com({ substitui: [] }).substitui).toBeUndefined();
  });

  it('a etapa do aviso é conferida', () => {
    expect(com({ substitui: ['pedido_parado:pronto'] }).substitui).toEqual(['pedido_parado:pronto']);
    for (const t of ['pedido_parado:inventada', 'impressora:confirmado', 'pedido_parado:novo:x']) {
      expect(conferir({ ...semSubstitui, substitui: [t] })).toEqual({ erro: expect.stringContaining('não é um aviso da empresa') });
    }
    expect(conferir({ ...semSubstitui, substitui: ['servidor_sem_sinal:novo'] })).toEqual({ erro: expect.stringContaining('crítico') });
  });

  it('duas regras que fazem o mesmo têm a mesma chave, com outro título, outra ordem ou outros avisos substituídos', () => {
    const a = ok(TRES_PARADOS);
    const b = ok({ ...TRES_PARADOS, titulo: 'Outro nome', filtros: [...TRES_PARADOS.filtros].reverse(), substitui: [] });
    expect(chaveDaRegra(a)).toBe(chaveDaRegra(b));
    expect(chaveDaRegra(a)).toBe(chaveDaRegra(ok({ ...TRES_PARADOS, intervaloMin: 45 })));
    expect(chaveDaRegra(a)).not.toBe(chaveDaRegra(ok({ ...TRES_PARADOS, condicao: { op: '>=', valor: 4 } })));
  });
});

describe('a avaliação', () => {
  const tres = ok(TRES_PARADOS);
  const linhas = [
    pedido('p22', 22, { min_desde_aceite: 24 }),
    pedido('p24', 24, { min_desde_aceite: 31 }),
    pedido('p28', 28, { min_desde_aceite: 22 }),
    pedido('p30', 30, { min_desde_aceite: 5 }),
    pedido('p31', 31, { min_desde_aceite: 40, situacao: 'pronto' }),
  ];

  it('3 pedidos parados há mais de 20 min: uma mensagem com a lista; com 2, nada', () => {
    expect(linhasDaRegra(tres, linhas).map((l) => l.id)).toEqual(['p22', 'p24', 'p28']);
    const r = avaliarRegra(tres, linhas, {}, AGORA());
    expect(r.disparos).toHaveLength(1);
    const texto = textoDoDisparo(tres, r.disparos[0]);
    expect(texto).toBe('⏱ 3 pedidos há mais de 20 min em preparo (3)\n• #22 · iFood 4822 · 24 min\n• #24 · iFood 4824 · 31 min\n• #28 · iFood 4828 · 22 min');
    expect(avaliarRegra(tres, linhas.slice(1), {}, AGORA()).disparos).toEqual([]);
  });

  it('enquanto continua, só repete depois do intervalo e se a lista mudar; caiu e voltou, avisa de novo', () => {
    const r1 = avaliarRegra(tres, linhas, {}, AGORA('21:40'));
    // um minuto depois, a mesma lista: nada
    expect(avaliarRegra(tres, linhas, r1.estado, AGORA('21:41')).disparos).toEqual([]);
    // 35 minutos depois, a mesma lista: nada (não mudou)
    expect(avaliarRegra(tres, linhas, r1.estado, AGORA('22:15')).disparos).toEqual([]);
    // 35 minutos depois, entrou mais um: avisa de novo
    const mais = [...linhas, pedido('p33', 33, { min_desde_aceite: 21 })];
    expect(avaliarRegra(tres, mais, r1.estado, AGORA('22:15')).disparos).toHaveLength(1);
    // caiu para 2 e voltou a 3 (a "borda"): avisa na hora
    const caiu = avaliarRegra(tres, linhas.slice(1), r1.estado, AGORA('21:45'));
    expect(caiu.estado.valendo).toBe(false);
    expect(avaliarRegra(tres, linhas, caiu.estado, AGORA('21:46')).disparos).toHaveLength(1);
  });

  it('cada item é avisado uma vez (o despacho acima de 30 min)', () => {
    const despacho = ok({ fonte: 'pedidos', titulo: 'Despacho acima de 30 min', filtros: [{ campo: 'min_aceite_ate_saida', op: '>', valor: 30 }], medida: 'cada_item', quando: {}, vezes: 'sempre', agrupar: true });
    const l = [pedido('a', 1, { min_aceite_ate_saida: 35 }), pedido('b', 2, { min_aceite_ate_saida: 12 })];
    const r1 = avaliarRegra(despacho, l, {}, AGORA());
    expect(r1.disparos.map((d) => d.itens.map((i) => i.id))).toEqual([['a']]);
    expect(avaliarRegra(despacho, l, r1.estado, AGORA('21:41')).disparos).toEqual([]);
    const l2 = [...l, pedido('c', 3, { min_aceite_ate_saida: 33 })];
    expect(avaliarRegra(despacho, l2, r1.estado, AGORA('21:42')).disparos.map((d) => d.itens.map((i) => i.id))).toEqual([['c']]);
    // sem agrupar: uma mensagem por item
    const solto = { ...despacho, agrupar: false };
    expect(avaliarRegra(solto, [pedido('x', 9, { min_aceite_ate_saida: 40 }), pedido('y', 8, { min_aceite_ate_saida: 41 })], {}, AGORA()).disparos).toHaveLength(2);
  });

  it('"em HH:MM" olha uma vez por dia, só depois da hora e até uma hora depois; a data e os dias da semana valem', () => {
    const vendas = ok({ fonte: 'vendas', titulo: 'Venda baixa às 20h', filtros: [{ campo: 'faturamento', op: '<', valor: 2000 }], medida: 'cada_item', quando: { dias: [2, 3, 4], em: '20:00' }, vezes: 'sempre', agrupar: true });
    const linha: LinhaDaFonte[] = [{ id: 'v:t:todas:2026-11-19', alvoId: 'v', rotulo: 'Vendas de hoje', unidadeId: null, campos: { faturamento: 1500 } }];
    const quinta = (hora: string) => AGORA(hora, '2026-11-19', 4);
    expect(olhaAgora(vendas, {}, quinta('19:59'))).toBe(false);
    const r = avaliarRegra(vendas, linha, {}, quinta('20:00'));
    expect(r.disparos).toHaveLength(1);
    expect(r.estado.olhouEm).toBe('2026-11-19');
    expect(olhaAgora(vendas, r.estado, quinta('20:05'))).toBe(false);
    expect(olhaAgora(vendas, {}, quinta('21:01'))).toBe(false);
    expect(olhaAgora(vendas, {}, AGORA('20:00', '2026-11-20', 5))).toBe(false); // sexta não está na regra
    // acima do valor: olhou e não avisou
    expect(avaliarRegra(vendas, [{ ...linha[0], campos: { faturamento: 2500 } }], {}, quinta('20:00')).disparos).toEqual([]);
  });

  it('a tarefa: não feita, ou pendente 30 min depois do fim', () => {
    const tarefa = ok({
      fonte: 'tarefas',
      titulo: 'Chapa',
      filtros: [{ campo: 'situacao', op: 'em', valor: ['pendente', 'em_execucao', 'parcial', 'nao_feita'] }],
      algum: [
        { campo: 'situacao', op: '=', valor: 'nao_feita' },
        { campo: 'min_apos_o_fim', op: '>', valor: 30 },
      ],
      alvo: { id: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b91', rotulo: 'Limpar a chapa' },
      medida: 'cada_item',
      quando: {},
      vezes: 'sempre',
      agrupar: true,
    });
    const t = (id: string, alvoId: string, campos: Record<string, unknown>): LinhaDaFonte => ({ id, alvoId, rotulo: 'Limpar a chapa', unidadeId: null, campos });
    const alvo = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b91';
    expect(linhasDaRegra(tarefa, [t('i1', alvo, { situacao: 'pendente', min_apos_o_fim: 10 })])).toEqual([]);
    expect(linhasDaRegra(tarefa, [t('i1', alvo, { situacao: 'pendente', min_apos_o_fim: 31 })])).toHaveLength(1);
    expect(linhasDaRegra(tarefa, [t('i1', alvo, { situacao: 'nao_feita', min_apos_o_fim: null })])).toHaveLength(1);
    expect(linhasDaRegra(tarefa, [t('i1', alvo, { situacao: 'feita', min_apos_o_fim: 90 })])).toEqual([]);
    expect(linhasDaRegra(tarefa, [t('i2', 'outra-tarefa', { situacao: 'nao_feita' })])).toEqual([]);
  });

  it('a janela do dia que passa da meia-noite', () => {
    const noite = ok({ ...TRES_PARADOS, quando: { de: '22:00', ate: '02:00' } });
    expect(olhaAgora(noite, {}, AGORA('23:30'))).toBe(true);
    expect(olhaAgora(noite, {}, AGORA('01:30'))).toBe(true);
    expect(olhaAgora(noite, {}, AGORA('12:00'))).toBe(false);
  });
});

describe('o horário da loja, o relógio e os botões', () => {
  it('dentro e fora do horário, inclusive o que passa da meia-noite', () => {
    const h = [
      { dia: 5, abre: '18:00', fecha: '23:30', ativo: true },
      { dia: 6, abre: '18:00', fecha: '02:00', ativo: true },
    ];
    expect(dentroDoHorarioDaLoja(h, AGORA('22:40', '2026-11-20', 5))).toBe(true);
    expect(dentroDoHorarioDaLoja(h, AGORA('23:45', '2026-11-20', 5))).toBe(false);
    expect(dentroDoHorarioDaLoja(h, AGORA('01:00', '2026-11-22', 0))).toBe(true); // a sobra de sábado
    expect(dentroDoHorarioDaLoja([], AGORA())).toBe(true);
  });

  it('o relógio da loja', () => {
    expect(agoraNaLoja(new Date('2026-11-21T02:30:00Z'))).toMatchObject({ dia: '2026-11-20', diaDaSemana: 5, hora: '23:30' });
  });

  it('os botões da proposta voltam lidos', () => {
    const [sim, mudar] = botoesDaProposta('3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90');
    expect(lerBotaoDaRegra(sim.id)).toEqual({ acao: 'sim', regraId: '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90' });
    expect(lerBotaoDaRegra(mudar.id)?.acao).toBe('mudar');
    expect(lerBotaoDaRegra('regra:sim:x')).toBeNull();
  });

  it('o catálogo e a leitura do motor andam juntos, e a ferramenta descreve todas as fontes', () => {
    expect([...FONTES_LIDAS].sort()).toEqual(FONTES_DA_REGRA.map((f) => f.nome).sort());
    const ferramenta = FERRAMENTAS.find((f) => f.name === 'regras')!;
    for (const f of FONTES_DA_REGRA) expect(ferramenta.description).toContain(`${f.nome} (`);
  });
});
