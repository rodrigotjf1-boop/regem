import {
  aplicarAosDias,
  horasDaJanela,
  lerDiaDaSemana,
  recusaDoHorario,
  situacaoDoDia,
  textoDaJanela,
} from '../../common/horarios-da-loja';
import { ACOES, ACOES_DE_PIN, apresentacaoDoHorario, conferirAcao, resumoDoHorario, sigaDaAcao, type MudancaDeHorario } from './mister-acoes';

// M6j, lote 9: o horário da semana da loja, com o PIN pelo link.

const SEMANA = [
  { dia: 0, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 1, abre: '18:00', fecha: '23:00', ativo: false },
  { dia: 5, abre: '18:00', fecha: '02:00', ativo: true },
];
const base: MudancaDeHorario = {
  dias: [{ dia: 0, de: { abre: '18:00', fecha: '23:00' }, para: { abre: '19:00', fecha: '23:30' } }],
  conjunto: 'unico',
  loja: null,
  todasAsLojas: false,
  incluiHoje: false,
};

describe('Mister · ações (lote 9) — o horário da loja', () => {
  it('é de PIN, pela permissão da rota da configuração', () => {
    expect(ACOES_DE_PIN).toContain('mudar_horario');
    expect(ACOES.mudar_horario).toMatchObject({ nivel: 'pin', permissao: 'loja', prazoMin: 15 });
    expect(ACOES.mudar_horario.pedeVerValores).toBeUndefined();
    expect(sigaDaAcao('mudar_horario')).toContain('Abrir no Regem');
  });

  it('lê os dias como a pessoa diz, e nada além disso', () => {
    expect(['domingo', 'Terça-feira', 'sáb', 'SEX.', ' quarta '].map(lerDiaDaSemana)).toEqual([0, 2, 6, 5, 3]);
    for (const ruim of ['hoje', 'amanhã', 'feriado', 'constructor', '', 0, null, undefined]) expect(lerDiaDaSemana(ruim)).toBeNull();
  });

  it('pede os dias e as duas horas, ou "fechado"', () => {
    expect(conferirAcao('mudar_horario', { dias: ['sábado', 'domingo', 'domingo'], abre: '18:00', fecha: '02:00' })).toEqual({
      parametros: { acao: 'mudar_horario', dias: [0, 6], janela: { abre: '18:00', fecha: '02:00' }, horarioDe: null },
      resumo: 'Mudar o horário de Domingo e Sábado para 18:00 às 02:00 do dia seguinte.',
    });
    expect(conferirAcao('mudar_horario', { dias: ['segunda'], fechado: true })).toMatchObject({ parametros: { janela: null }, resumo: 'Mudar o horário de Segunda para fechado.' });
    expect(conferirAcao('mudar_horario', { dias: ['segunda'], abre: '18:00', fecha: '23:00', horarioDe: 'retirada' })).toMatchObject({ parametros: { horarioDe: 'retirada' } });
    for (const en of [
      { abre: '18:00', fecha: '23:00' },
      { dias: [], abre: '18:00', fecha: '23:00' },
      { dias: ['hoje'], abre: '18:00', fecha: '23:00' },
      { dias: ['domingo'], abre: '18:00' },
      { dias: ['domingo'], abre: '25:00', fecha: '23:00' },
      { dias: ['domingo'], abre: '18h', fecha: '23h' },
      { dias: ['domingo'], abre: '18:00', fecha: '18:00' },
      { dias: ['domingo'], fechado: true, abre: '18:00', fecha: '23:00' },
      { dias: ['domingo'], abre: '18:00', fecha: '23:00', horarioDe: 'mesa' },
    ])
      expect(conferirAcao('mudar_horario', en)).toHaveProperty('erro');
  });

  it('a lista vazia é "sempre aberta": mudar um dia só nela é recusado', () => {
    expect(recusaDoHorario([], [{ dia: 0, janela: { abre: '18:00', fecha: '23:00' } }])).toContain('ainda não tem o horário da semana');
    expect(recusaDoHorario(null, [{ dia: 0, janela: null }])).toContain('ainda não tem o horário da semana');
  });

  it('não deixa a loja sem nenhum dia aberto, nem mexe em dia com duas janelas', () => {
    expect(recusaDoHorario(SEMANA, [{ dia: 0, janela: null }, { dia: 5, janela: null }])).toContain('sem nenhum dia aberto');
    expect(recusaDoHorario(SEMANA, [{ dia: 0, janela: null }])).toBeNull();
    const dobrado = [...SEMANA, { dia: 0, abre: '11:00', fecha: '15:00', ativo: true }];
    expect(situacaoDoDia(dobrado, 0).varias).toBe(true);
    expect(recusaDoHorario(dobrado, [{ dia: 0, janela: { abre: '18:00', fecha: '23:00' } }])).toContain('Domingo tem mais de um horário');
  });

  it('troca só os dias pedidos; o fechado guarda as horas, e o que a linha tem a mais fica', () => {
    const lista = aplicarAosDias([{ ...SEMANA[0], extra: 'x' }, SEMANA[1], SEMANA[2]], [
      { dia: 0, janela: null },
      { dia: 1, janela: { abre: '11:00', fecha: '15:00' } },
      { dia: 3, janela: { abre: '10:00', fecha: '12:00' } },
    ]);
    expect(lista).toEqual([
      { dia: 0, abre: '18:00', fecha: '23:00', ativo: false, extra: 'x' },
      { dia: 1, abre: '11:00', fecha: '15:00', ativo: true },
      { dia: 3, abre: '10:00', fecha: '12:00', ativo: true },
      SEMANA[2],
    ]);
  });

  it('a janela: o texto e as horas, virando a meia-noite', () => {
    expect(textoDaJanela(null)).toBe('fechado');
    expect(textoDaJanela({ abre: '18:00', fecha: '23:00' })).toBe('18:00 às 23:00');
    expect(textoDaJanela({ abre: '18:00', fecha: '02:00' })).toBe('18:00 às 02:00 do dia seguinte');
    expect(horasDaJanela({ abre: '18:00', fecha: '02:00' })).toBe(8);
    expect(horasDaJanela({ abre: '11:30', fecha: '15:00' })).toBe(3.5);
  });

  it('o resumo e a página dizem o de → para, o que vale agora e onde não vale', () => {
    const r = resumoDoHorario(base);
    expect(r).toContain('Domingo de 18:00 às 23:00 para 19:00 às 23:30');
    expect(r).toContain('O horário do iFood e da 99 é o de lá');
    expect(resumoDoHorario({ ...base, incluiHoje: true })).toContain('Hoje é um dos dias');
    expect(resumoDoHorario({ ...base, todasAsLojas: true })).toContain('vale em todas as lojas');
    expect(resumoDoHorario({ ...base, dias: [{ dia: 0, de: null, para: { abre: '04:00', fecha: '03:00' } }] })).toContain('mais de 18 horas');
    const pagina = apresentacaoDoHorario({ ...base, conjunto: 'retirada', loja: 'Loja Centro' });
    expect(pagina).toMatchObject({ titulo: 'Mudar o horário da loja?', detalhe: 'Retirada e consumo no local · Loja Centro', valor: null, botao: 'Autorizar a mudança' });
    expect(pagina.itens[0]).toBe('Domingo: de 18:00 às 23:00 para 19:00 às 23:30.');
  });
});
