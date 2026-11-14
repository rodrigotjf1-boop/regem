import {
  ATRASO_MAXIMO_DO_RELATORIO_MIN,
  PADRAO_DO_RELATORIO,
  conferirRelatorios,
  perguntaDoRelatorio,
  regraDoRelatorioQueVale,
  relatorioDevido,
} from './mister-relatorios.regras';
import { agoraNaOperacao } from './mister-relatorios.service';

// Os relatórios do Mister (mig 420): quando cada um vence, o que a tela pode mandar e a pergunta que o agente recebe.

const dia = (hora: string, diaSemana = 6, d = '2026-11-14') => ({ dia: d, hora, diaSemana });
const ligado = (hora: string, diaSemana: number | null = null) => ({ ligado: true, hora, diaSemana });

describe('quando o relatório vence', () => {
  it('desligado nunca vence; o padrão nasce desligado', () => {
    expect(PADRAO_DO_RELATORIO.resumo_dia.ligado).toBe(false);
    expect(PADRAO_DO_RELATORIO.resumo_semana.ligado).toBe(false);
    expect(relatorioDevido('resumo_dia', { ...ligado('23:30'), ligado: false }, dia('23:35'))).toBeNull();
  });

  it('o resumo do dia: do horário até 3 horas depois, também depois da meia-noite', () => {
    expect(relatorioDevido('resumo_dia', ligado('23:30'), dia('23:29'))).toBeNull();
    expect(relatorioDevido('resumo_dia', ligado('23:30'), dia('23:30'))).toEqual({ referencia: '2026-11-14', ate: '2026-11-14' });
    // 02:29 do dia 15: o horário foi ontem às 23:30 (179 min) — o resumo é do dia 14.
    expect(relatorioDevido('resumo_dia', ligado('23:30'), dia('02:29', 7, '2026-11-15'))).toEqual({ referencia: '2026-11-14', ate: '2026-11-14' });
    expect(ATRASO_MAXIMO_DO_RELATORIO_MIN).toBe(180);
    expect(relatorioDevido('resumo_dia', ligado('23:30'), dia('02:30', 7, '2026-11-15'))).toEqual({ referencia: '2026-11-14', ate: '2026-11-14' });
    expect(relatorioDevido('resumo_dia', ligado('23:30'), dia('02:31', 7, '2026-11-15'))).toBeNull();
    // Antes do horário no mesmo dia (09:00 com o resumo às 23:30): 14 h 30 depois do de ontem — não vence.
    expect(relatorioDevido('resumo_dia', ligado('23:30'), dia('09:00'))).toBeNull();
  });

  it('o resumo marcado antes das 6 h é da noite que passou', () => {
    expect(relatorioDevido('resumo_dia', ligado('02:00'), dia('02:10', 7, '2026-11-15'))).toEqual({ referencia: '2026-11-14', ate: '2026-11-14' });
    expect(relatorioDevido('resumo_dia', ligado('05:59'), dia('06:30', 7, '2026-11-15'))).toEqual({ referencia: '2026-11-14', ate: '2026-11-14' });
    expect(relatorioDevido('resumo_dia', ligado('06:00'), dia('06:30', 7, '2026-11-15'))).toEqual({ referencia: '2026-11-15', ate: '2026-11-15' });
  });

  it('o resumo da semana: só no dia escolhido, os 7 dias até a véspera', () => {
    // Segunda, 16/11, às 09:05: a semana passada inteira, de segunda 09/11 a domingo 15/11.
    expect(relatorioDevido('resumo_semana', ligado('09:00', 1), dia('09:05', 1, '2026-11-16'))).toEqual({ referencia: '2026-11-09', ate: '2026-11-15' });
    expect(relatorioDevido('resumo_semana', ligado('09:00', 1), dia('09:05', 2, '2026-11-17'))).toBeNull();
    expect(relatorioDevido('resumo_semana', ligado('09:00', 1), dia('08:59', 1, '2026-11-16'))).toBeNull();
    // Domingo às 23:00, conferido na segunda 00:30: o dia do envio foi o domingo.
    expect(relatorioDevido('resumo_semana', ligado('23:00', 7), dia('00:30', 1, '2026-11-16'))).toEqual({ referencia: '2026-11-08', ate: '2026-11-14' });
    expect(relatorioDevido('resumo_semana', ligado('23:00', 7), dia('00:30', 2, '2026-11-17'))).toBeNull();
  });

  it('o relógio da operação: o dia, a hora e o dia da semana de São Paulo', () => {
    // 12:05 UTC de segunda 16/11 = 09:05 em São Paulo.
    expect(agoraNaOperacao(new Date('2026-11-16T12:05:00Z'))).toEqual({ dia: '2026-11-16', hora: '09:05', diaSemana: 1 });
    // 02:30 UTC de segunda = 23:30 de domingo 15/11 em São Paulo.
    expect(agoraNaOperacao(new Date('2026-11-16T02:30:00Z'))).toEqual({ dia: '2026-11-15', hora: '23:30', diaSemana: 7 });
  });
});

describe('o que a tela pode mandar', () => {
  it('cada relatório inteiro e certo', () => {
    expect(conferirRelatorios({ relatorios: [{ tipo: 'resumo_dia', ligado: true, hora: '22:00' }] })).toEqual([{ tipo: 'resumo_dia', regra: { ligado: true, hora: '22:00', diaSemana: null } }]);
    expect(conferirRelatorios({ relatorios: [{ tipo: 'resumo_semana', ligado: false, hora: '09:00', diaSemana: 7 }] })).toEqual([
      { tipo: 'resumo_semana', regra: { ligado: false, hora: '09:00', diaSemana: 7 } },
    ]);
    // O dia da semana no resumo do dia é ignorado.
    expect(conferirRelatorios({ relatorios: [{ tipo: 'resumo_dia', ligado: true, hora: '22:00', diaSemana: 3 }] })).toEqual([{ tipo: 'resumo_dia', regra: { ligado: true, hora: '22:00', diaSemana: null } }]);
  });

  it('as recusas: liga/desliga só booleano (V15), horário e dia certos, nada repetido ou desconhecido', () => {
    expect(conferirRelatorios({ relatorios: [{ tipo: 'resumo_dia', ligado: 'true', hora: '22:00' }] })).toEqual({ erro: 'Resumo do dia: diga se fica ligado ou desligado.' });
    expect(conferirRelatorios({ relatorios: [{ tipo: 'resumo_dia', ligado: true, hora: '24:00' }] })).toEqual({ erro: 'Resumo do dia: escolha o horário.' });
    expect(conferirRelatorios({ relatorios: [{ tipo: 'resumo_dia', ligado: true, hora: '9:00' }] })).toEqual({ erro: 'Resumo do dia: escolha o horário.' });
    expect(conferirRelatorios({ relatorios: [{ tipo: 'resumo_semana', ligado: true, hora: '09:00' }] })).toEqual({ erro: 'Resumo da semana: escolha o dia da semana.' });
    expect(conferirRelatorios({ relatorios: [{ tipo: 'resumo_semana', ligado: true, hora: '09:00', diaSemana: 8 }] })).toEqual({ erro: 'Resumo da semana: escolha o dia da semana.' });
    expect(conferirRelatorios({ relatorios: [{ tipo: 'resumo_mes', ligado: true, hora: '09:00' }] })).toEqual({ erro: 'Relatório desconhecido.' });
    expect(
      conferirRelatorios({
        relatorios: [
          { tipo: 'resumo_dia', ligado: true, hora: '22:00' },
          { tipo: 'resumo_dia', ligado: false, hora: '22:00' },
        ],
      }),
    ).toEqual({ erro: 'Relatório repetido.' });
    expect(conferirRelatorios({ relatorios: [] })).toEqual({ erro: 'Nada para salvar.' });
    expect(conferirRelatorios(null)).toEqual({ erro: 'Nada para salvar.' });
  });

  it('a regra que vale: a salva, com o padrão no campo que faltar ou vier torto', () => {
    expect(regraDoRelatorioQueVale('resumo_dia', null)).toEqual({ ligado: false, hora: '23:30', diaSemana: null });
    expect(regraDoRelatorioQueVale('resumo_semana', { ligado: true, hora: 'xx', diaSemana: 9 })).toEqual({ ligado: true, hora: '09:00', diaSemana: 1 });
    expect(regraDoRelatorioQueVale('resumo_semana', { ligado: true, hora: '18:00', diaSemana: 5 })).toEqual({ ligado: true, hora: '18:00', diaSemana: 5 });
  });
});

describe('a pergunta que o agente recebe', () => {
  it('o período por extenso e o começo fixo da mensagem, como no protótipo', () => {
    const d = perguntaDoRelatorio('resumo_dia', { referencia: '2026-11-12', ate: '2026-11-12' });
    expect(d).toContain('resumo do dia 12/11 (2026-11-12)');
    expect(d).toContain('Comece com "*Resumo de quinta, 12/11*"');
    expect(d).toContain('Sem pergunta no fim');
    const s = perguntaDoRelatorio('resumo_semana', { referencia: '2026-11-09', ate: '2026-11-15' });
    expect(s).toContain('de 2026-11-09 até 2026-11-15');
    expect(s).toContain('Comece com "*Resumo da semana, 09/11 a 15/11*"');
    expect(s).toContain('comparados com os 7 dias anteriores');
  });
});
