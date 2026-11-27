import { aberturaDeAgora, aberturasDoDia, especiaisDoTipo, especialDaData, proximaAberturaDaData, type DiaEspecialDoHorario } from './horario-da-data';
import { conferirHorario, janelasDoDia, trechosDoDia } from './pedido-agendado';

// Dias especiais (H1, protótipo aprovado em 27/11/2026): o horário de uma data = o do dia especial, senão o da semana.
// A semana do protótipo: segunda fechada; terça a quinta 18:00–23:00; sexta e sábado 18:00–00:00; domingo 18:00–23:00.
const SEMANA = [
  { dia: 0, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 1, abre: '18:00', fecha: '23:00', ativo: false },
  { dia: 2, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 3, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 4, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 5, abre: '18:00', fecha: '00:00', ativo: true },
  { dia: 6, abre: '18:00', fecha: '00:00', ativo: true },
];
const esp = (e: Partial<DiaEspecialDoHorario>): DiaEspecialDoHorario => ({
  data: '2026-12-25', dataFim: null, nome: 'Natal', funcionamento: 'fechada', abre: null, fecha: null, conjunto: 'todos', ...e,
});
const NATAL = esp({});
const VESPERA = esp({ data: '2026-12-24', nome: 'Véspera de Natal', funcionamento: 'horario', abre: '18:00', fecha: '21:00' });
const REFORMA = esp({ data: '2027-01-12', dataFim: '2027-01-14', nome: 'Reforma da cozinha' });
const ESPECIAIS = [NATAL, VESPERA, REFORMA];
// "Agora" em São Paulo (UTC−3): o instante UTC que dá a data e a hora pedidas.
const em = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`);

describe('o horário de uma data (dias especiais)', () => {
  it('a data com dia especial: fechada = nenhuma abertura; outro horário = a dele; sem especial = a da semana', () => {
    expect(aberturasDoDia(SEMANA, ESPECIAIS, '2026-12-25')).toEqual([]);
    expect(aberturasDoDia(SEMANA, ESPECIAIS, '2026-12-24')).toEqual([{ abre: '18:00', fecha: '21:00' }]);
    expect(aberturasDoDia(SEMANA, ESPECIAIS, '2026-12-26')).toEqual([{ abre: '18:00', fecha: '00:00' }]); // sábado
    expect(aberturasDoDia(SEMANA, ESPECIAIS, '2026-12-28')).toEqual([]); // segunda, fechada na semana
    // horário normal: só confirma — vale a semana
    expect(aberturasDoDia(SEMANA, [esp({ funcionamento: 'normal' })], '2026-12-25')).toEqual([{ abre: '18:00', fecha: '00:00' }]);
  });

  it('o período cobre todos os dias, inclusive o último; o especial mais recente vence o mais antigo', () => {
    for (const d of ['2027-01-12', '2027-01-13', '2027-01-14']) expect(aberturasDoDia(SEMANA, ESPECIAIS, d)).toEqual([]);
    expect(aberturasDoDia(SEMANA, ESPECIAIS, '2027-01-15')).toEqual([{ abre: '18:00', fecha: '00:00' }]);
    const ferias = esp({ data: '2027-01-10', dataFim: '2027-01-20', nome: 'Férias' });
    const abreNoMeio = esp({ data: '2027-01-15', funcionamento: 'horario', abre: '19:00', fecha: '22:00', nome: 'Evento' });
    expect(especialDaData([ferias, abreNoMeio], '2027-01-15')?.nome).toBe('Evento');
    expect(especialDaData([ferias, abreNoMeio], '2027-01-16')?.nome).toBe('Férias');
  });

  it('o conjunto: o especial só da entrega não fecha a retirada (e o consumo no local segue a retirada)', () => {
    const soEntrega = [esp({ conjunto: 'entrega' })];
    expect(especiaisDoTipo(soEntrega, 'entrega')).toHaveLength(1);
    expect(especiaisDoTipo(soEntrega, 'retirada')).toHaveLength(0);
    expect(especiaisDoTipo(soEntrega, 'local')).toHaveLength(0);
    expect(especiaisDoTipo([esp({ conjunto: 'retirada' })], 'local')).toHaveLength(1);
    expect(especiaisDoTipo(ESPECIAIS, undefined)).toHaveLength(3);
  });

  it('aberta agora: o dia especial fecha mesmo dentro do horário da semana; a madrugada da véspera continua dela', () => {
    expect(aberturaDeAgora(SEMANA, ESPECIAIS, em('2026-12-25', '19:00'))).toBeNull(); // Natal, fechada
    expect(aberturaDeAgora(SEMANA, [], em('2026-12-25', '19:00'))).toEqual({ abre: '18:00', fecha: '00:00' });
    expect(aberturaDeAgora(SEMANA, ESPECIAIS, em('2026-12-24', '20:30'))).toEqual({ abre: '18:00', fecha: '21:00' });
    expect(aberturaDeAgora(SEMANA, ESPECIAIS, em('2026-12-24', '21:30'))).toBeNull(); // a véspera fecha às 21:00
    // sábado 26/12 18:00–00:00: depois da meia-noite, domingo 27 00:00 ainda é a abertura de sábado
    expect(aberturaDeAgora(SEMANA, ESPECIAIS, em('2026-12-27', '00:00'))).toEqual({ abre: '18:00', fecha: '00:00' });
    // a loja das 18h às 02h na véspera de um dia fechado: a madrugada do dia fechado segue aberta (é da véspera)
    const ate2 = [{ dia: 4, abre: '18:00', fecha: '02:00', ativo: true }];
    expect(aberturaDeAgora(ate2, [esp({ data: '2026-12-25' })], em('2026-12-25', '01:30'))).toEqual({ abre: '18:00', fecha: '02:00' });
  });

  it('sem horário da semana: o dia inteiro, a não ser que o dia especial diga outra coisa', () => {
    expect(aberturasDoDia([], [], '2026-12-25')).toBe('dia_inteiro');
    expect(aberturaDeAgora([], [], em('2026-12-25', '03:00'))).toBe('dia_inteiro');
    expect(aberturaDeAgora([], [NATAL], em('2026-12-25', '03:00'))).toBeNull();
    expect(aberturaDeAgora([], [VESPERA], em('2026-12-24', '19:00'))).toEqual({ abre: '18:00', fecha: '21:00' });
  });

  it('o agendado: o dia fechado não tem janela e a recusa diz o porquê; o de outro horário só oferece as janelas dele', () => {
    const agora = em('2026-12-22', '12:00');
    const base = { agora, antecedenciaMin: 45, preparoMin: 30, limite: null };
    expect(janelasDoDia({ ...base, horarios: SEMANA, dia: '2026-12-25', especiais: ESPECIAIS })).toEqual([]);
    expect(janelasDoDia({ ...base, horarios: SEMANA, dia: '2026-12-25' }).length).toBeGreaterThan(0); // sem o especial, abre
    const vespera = janelasDoDia({ ...base, horarios: SEMANA, dia: '2026-12-24', especiais: ESPECIAIS });
    expect(vespera[0].hora).toBe('18:30'); // abre 18:00 + 30 de preparo
    expect(vespera.at(-1)!.hora).toBe('20:45'); // a última janela termina às 21:00
    const ajustes = { ativo: true, antecedenciaMin: 45, dias: 7, limite: null };
    expect(conferirHorario({ ajustes, valor: '2026-12-25T20:00', horarios: SEMANA, agora, preparoMin: 30, especiais: ESPECIAIS })).toMatchObject({
      ok: false,
      motivo: 'fora',
      mensagem: 'No dia 25/12 (Natal) a loja está fechada. Escolha outro dia.',
    });
    expect(conferirHorario({ ajustes, valor: '2026-12-24T20:00', horarios: SEMANA, agora, preparoMin: 30, especiais: ESPECIAIS })).toMatchObject({ ok: true });
    // a madrugada do sábado 26 (aberto até 00:00) não invade o domingo; o trecho de hoje e o de ontem continuam separados
    expect(trechosDoDia(SEMANA, '2026-12-25', ESPECIAIS)).toEqual([]);
  });

  it('a próxima abertura pula o dia fechado e o período inteiro (com a data quando passa de 6 dias)', () => {
    expect(proximaAberturaDaData(SEMANA, ESPECIAIS, em('2026-12-25', '10:00'))).toBe('sáb 18:00');
    expect(proximaAberturaDaData(SEMANA, ESPECIAIS, em('2026-12-24', '10:00'))).toBe('18:00');
    expect(proximaAberturaDaData(SEMANA, [esp({ data: '2027-01-05', dataFim: '2027-01-14' })], em('2027-01-05', '10:00'))).toBe('15/01 18:00');
    expect(proximaAberturaDaData([], [], em('2026-12-25', '10:00'))).toBeNull();
  });
});
