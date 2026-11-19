import {
  ajustesDoAgendado,
  conferirHorario,
  horarioDoTexto,
  rotuloDaJanela,
  diasPermitidos,
  emSaoPaulo,
  inicioDoPreparo,
  instanteDeSaoPaulo,
  janelasDoDia,
  janelasMaisPerto,
  preparoDoTipo,
  quandoDoAgendado,
  trechosDoDia,
} from './pedido-agendado';

// O PEDIDO AGENDADO (mig 455, D4 — protótipo `regem-atendente-alergenos-agendado.html`, parte 2, G1–G10).

// Quarta, 18/11/2026. São Paulo = UTC−3.
const sp = (diaHora: string) => instanteDeSaoPaulo(diaHora)!;
const HORARIOS = [
  // quarta 18:00–23:00; quinta 19:00–02:00 (vira a meia-noite)
  { dia: 3, ativo: true, abre: '18:00', fecha: '23:00' },
  { dia: 4, ativo: true, abre: '19:00', fecha: '02:00' },
];
const LIGADO = { ativo: true, antecedenciaMin: 45, dias: 1, limite: 4 };

describe('pedido agendado: hora de São Paulo', () => {
  it('o texto sem fuso vira o instante de São Paulo (a nuvem roda em UTC) e volta igual', () => {
    expect(sp('2026-11-18T19:30').toISOString()).toBe('2026-11-18T22:30:00.000Z');
    expect(emSaoPaulo(new Date('2026-11-19T02:15:00Z'))).toEqual({ dia: '2026-11-18', hora: '23:15', diaHora: '2026-11-18T23:15', semana: 3 });
    expect(instanteDeSaoPaulo('2026-02-30T19:00')).toBeNull(); // data que não existe
    expect(instanteDeSaoPaulo('2026-11-18 19:30')).toBeNull();
    expect(instanteDeSaoPaulo(null)).toBeNull();
  });

  it('os dias permitidos contam pelo dia de São Paulo (às 22:30 de SP já é outro dia em UTC)', () => {
    expect(diasPermitidos(new Date('2026-11-19T01:30:00Z'), 1)).toEqual(['2026-11-18', '2026-11-19']);
    expect(diasPermitidos(new Date('2026-11-19T01:30:00Z'), 0)).toEqual(['2026-11-18']);
  });

  it('os ajustes: os de fábrica (G10) e o que está fora da lista volta ao padrão', () => {
    expect(ajustesDoAgendado({})).toEqual({ ativo: false, antecedenciaMin: 45, dias: 1, limite: null });
    expect(ajustesDoAgendado({ agendadoAtivo: true, agendadoAntecedenciaMin: 50, agendadoDias: 9, agendadoLimiteJanela: 5 })).toEqual({
      ativo: true,
      antecedenciaMin: 45,
      dias: 1,
      limite: 4,
    });
    expect(ajustesDoAgendado({ agendadoAtivo: true, agendadoAntecedenciaMin: 90, agendadoDias: 7, agendadoLimiteJanela: 8 }).limite).toBe(8);
  });
});

describe('pedido agendado: as janelas do dia (G2, G3, G7, G9)', () => {
  it('o trecho que vira a meia-noite: a quinta vai até 02:00 de sexta, e a madrugada de sexta é da quinta', () => {
    const quinta = trechosDoDia(HORARIOS, '2026-11-19');
    expect(quinta.map((t) => [t.inicio.toISOString(), t.fim.toISOString()])).toEqual([['2026-11-19T22:00:00.000Z', '2026-11-20T05:00:00.000Z']]);
    const sexta = trechosDoDia(HORARIOS, '2026-11-20');
    expect(sexta.map((t) => [emSaoPaulo(t.inicio).hora, emSaoPaulo(t.fim).hora])).toEqual([['00:00', '02:00']]);
    expect(trechosDoDia([], '2026-11-20')).toHaveLength(1); // sem horário = o dia inteiro
  });

  it('loja fechada (16:10): a primeira janela é a abertura mais o tempo de preparo; a última termina até o fechamento', () => {
    const j = janelasDoDia({ horarios: HORARIOS, dia: '2026-11-18', agora: sp('2026-11-18T16:10'), antecedenciaMin: 45, preparoMin: 40, limite: 4 });
    expect(j[0]).toMatchObject({ valor: '2026-11-18T18:45', hora: '18:45', rotulo: '18:45 às 19:00', esgotada: false });
    expect(j[j.length - 1].hora).toBe('22:45');
    expect(j).toHaveLength(17);
  });

  it('loja aberta (20:10): a antecedência manda (20:55 → a janela das 21:00)', () => {
    const j = janelasDoDia({ horarios: HORARIOS, dia: '2026-11-18', agora: sp('2026-11-18T20:10'), antecedenciaMin: 45, preparoMin: 40, limite: 4 });
    expect(j[0].hora).toBe('21:00');
  });

  it('o preparo maior que a antecedência manda (a cozinha não começa no passado)', () => {
    const j = janelasDoDia({ horarios: HORARIOS, dia: '2026-11-18', agora: sp('2026-11-18T20:10'), antecedenciaMin: 30, preparoMin: 60, limite: null });
    expect(j[0].hora).toBe('21:15');
  });

  it('a janela cheia vem esgotada; sem limite nunca esgota', () => {
    const ocupacao = new Map([['2026-11-18T19:30', 4], ['2026-11-18T19:45', 3]]);
    const j = janelasDoDia({ horarios: HORARIOS, dia: '2026-11-18', agora: sp('2026-11-18T16:10'), antecedenciaMin: 45, preparoMin: 40, limite: 4, ocupacao });
    expect(j.find((x) => x.hora === '19:30')).toMatchObject({ esgotada: true, ocupados: 4 });
    expect(j.find((x) => x.hora === '19:45')).toMatchObject({ esgotada: false, ocupados: 3 });
    const semLimite = janelasDoDia({ horarios: HORARIOS, dia: '2026-11-18', agora: sp('2026-11-18T16:10'), antecedenciaMin: 45, preparoMin: 40, limite: null, ocupacao });
    expect(semLimite.find((x) => x.hora === '19:30')?.esgotada).toBe(false);
  });

  it('G7: a pausa até 20:30 tira as janelas cujo preparo começaria antes dela', () => {
    const j = janelasDoDia({ horarios: HORARIOS, dia: '2026-11-18', agora: sp('2026-11-18T16:10'), antecedenciaMin: 45, preparoMin: 40, limite: 4, pausaAte: sp('2026-11-18T20:30') });
    expect(j[0].hora).toBe('21:15');
  });

  it('dia sem horário de funcionamento não tem janela', () => {
    expect(janelasDoDia({ horarios: HORARIOS, dia: '2026-11-17', agora: sp('2026-11-16T12:00'), antecedenciaMin: 45, preparoMin: 40, limite: 4 })).toEqual([]);
  });

  it('as livres mais perto da pedida (o que o atendente oferece quando encheu)', () => {
    const ocupacao = new Map([['2026-11-18T19:15', 4]]);
    const j = janelasDoDia({ horarios: HORARIOS, dia: '2026-11-18', agora: sp('2026-11-18T16:10'), antecedenciaMin: 45, preparoMin: 40, limite: 4, ocupacao });
    expect(janelasMaisPerto(j, '2026-11-18T19:15').map((x) => x.hora)).toEqual(['19:00', '19:30']);
  });
});

describe('pedido agendado: a conferência do servidor', () => {
  const base = { horarios: HORARIOS, agora: sp('2026-11-18T16:10'), preparoMin: 40 };
  it('desligado, formato, dia fora, janela fora e esgotada são recusados com a mensagem e as sugestões', () => {
    expect(conferirHorario({ ...base, ajustes: { ...LIGADO, ativo: false }, valor: '2026-11-18T19:30' })).toMatchObject({ ok: false, motivo: 'desligado' });
    expect(conferirHorario({ ...base, ajustes: LIGADO, valor: '19:30' })).toMatchObject({ ok: false, motivo: 'formato' });
    expect(conferirHorario({ ...base, ajustes: LIGADO, valor: '2026-11-21T19:30' })).toMatchObject({ ok: false, motivo: 'dia', mensagem: 'O pedido agendado vale até amanhã.' });
    const fora = conferirHorario({ ...base, ajustes: LIGADO, valor: '2026-11-18T19:40' });
    expect(fora).toMatchObject({ ok: false, motivo: 'fora' });
    const cheia = conferirHorario({ ...base, ajustes: LIGADO, valor: '2026-11-18T19:15', ocupacao: new Map([['2026-11-18T19:15', 4]]) });
    expect(cheia).toMatchObject({ ok: false, motivo: 'esgotada', mensagem: 'O horário das 19:15 já encheu. Escolha outro.' });
    expect((cheia as any).sugestoes.map((x: any) => x.hora)).toEqual(['19:00', '19:30']);
  });

  it('a janela livre passa, com o instante certo', () => {
    const ok = conferirHorario({ ...base, ajustes: LIGADO, valor: '2026-11-18T19:30' });
    expect(ok).toMatchObject({ ok: true });
    expect((ok as any).instante.toISOString()).toBe('2026-11-18T22:30:00.000Z');
  });
});

describe('pedido agendado: preparo e o texto ao cliente', () => {
  it('G3: o preparo começa o tempo de entrega (ou de retirada) antes; sem tempo, 40 e 20', () => {
    expect(preparoDoTipo({ tempoEntregaMin: 35, tempoRetiradaMin: 15 }, 'entrega')).toBe(35);
    expect(preparoDoTipo({ tempoEntregaMin: 35, tempoRetiradaMin: 15 }, 'retirada')).toBe(15);
    expect(preparoDoTipo({}, 'entrega')).toBe(40);
    expect(preparoDoTipo({}, 'local')).toBe(20);
    expect(emSaoPaulo(inicioDoPreparo(sp('2026-11-18T19:30'), 40)).hora).toBe('18:50');
  });

  it('"hoje, 19:30", "amanhã, 20:00" e "sáb 21/11, 19:00", com o fim da janela', () => {
    const agora = sp('2026-11-18T16:10');
    expect(quandoDoAgendado(sp('2026-11-18T19:30'), agora)).toEqual({ texto: 'hoje, 19:30', hora: '19:30', ate: '19:45' });
    expect(quandoDoAgendado(sp('2026-11-19T20:00'), agora).texto).toBe('amanhã, 20:00');
    expect(quandoDoAgendado(sp('2026-11-21T19:00'), agora).texto).toBe('sáb 21/11, 19:00');
  });
});

describe('pedido agendado pelo atendente (D4c): o horário que o cliente disse', () => {
  const agora = sp('2026-11-18T16:10'); // quarta

  it('lê "19:30", "19h30", "19h", "20 horas", "hoje", "amanhã", "depois de amanhã" e "dd/mm"', () => {
    expect(horarioDoTexto('19:30', agora)).toEqual({ valor: '2026-11-18T19:30' });
    expect(horarioDoTexto('às 19h30', agora)).toEqual({ valor: '2026-11-18T19:30' });
    expect(horarioDoTexto('19h', agora)).toEqual({ valor: '2026-11-18T19:00' });
    expect(horarioDoTexto('lá pelas 20 horas', agora)).toEqual({ valor: '2026-11-18T20:00' });
    expect(horarioDoTexto('Hoje 19:30', agora)).toEqual({ valor: '2026-11-18T19:30' });
    expect(horarioDoTexto('Amanhã às 20h', agora)).toEqual({ valor: '2026-11-19T20:00' });
    expect(horarioDoTexto('depois de amanhã 19:00', agora)).toEqual({ valor: '2026-11-20T19:00' });
    expect(horarioDoTexto('22/11 12:00', agora)).toEqual({ valor: '2026-11-22T12:00' });
    // dd/mm que já passou é do ano que vem.
    expect(horarioDoTexto('05/01 12:00', agora)).toEqual({ valor: '2027-01-05T12:00' });
  });

  it('"o quanto antes" tira o agendamento; sem hora (ou hora impossível) não se entende', () => {
    for (const t of ['o quanto antes', 'Sem agendar', 'desmarcar']) expect(horarioDoTexto(t, agora)).toEqual({ tirar: true });
    for (const t of ['no almoço', 'à noite', '', '25:00', '19:75']) expect(horarioDoTexto(t, agora)).toBeNull();
  });

  it('as opções "Hoje 19:30", "Amanhã 12:00" e "22/11 12:00" voltam ao mesmo horário quando o cliente toca', () => {
    for (const valor of ['2026-11-18T19:30', '2026-11-19T12:00', '2026-11-22T12:00']) {
      const rotulo = rotuloDaJanela(valor, agora);
      expect(horarioDoTexto(rotulo, agora)).toEqual({ valor });
    }
    expect(rotuloDaJanela('2026-11-18T19:30', agora)).toBe('Hoje 19:30');
    expect(rotuloDaJanela('2026-11-19T12:00', agora)).toBe('Amanhã 12:00');
    expect(rotuloDaJanela('2026-11-22T12:00', agora)).toBe('22/11 12:00');
  });
});
