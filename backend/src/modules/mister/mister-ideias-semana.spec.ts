import {
  DIAS_DAS_IDEIAS_NA_CONVERSA,
  FECHO_DAS_IDEIAS,
  PADRAO_DO_RELATORIO,
  RECURSO_DO_RELATORIO,
  RELATORIO_NA_TELA,
  conferirRelatorios,
  ehSemanal,
  linhasDasIdeias,
  perguntaDoRelatorio,
  regraDoRelatorioQueVale,
  relatorioDevido,
  soAoPresidente,
} from './mister-relatorios.regras';
import { semValoresNoTexto } from './mister-agente.regras';
import { parametrosDoResumo } from './mister-modelos';

// Versão 10, C8: as ideias da semana — um relatório semanal da IA, só ao presidente, sem migration (a tabela da mig 420).

const ligado = (hora: string, diaSemana: number | null = null) => ({ ligado: true, hora, diaSemana });

describe('as ideias da semana (C8)', () => {
  it('nasce desligado, na segunda às 9h, com a IA e o recurso próprio no medidor; só ao presidente', () => {
    expect(PADRAO_DO_RELATORIO.ideias_semana).toEqual({ ligado: false, hora: '09:00', diaSemana: 1 });
    expect(RELATORIO_NA_TELA.ideias_semana).toMatchObject({ titulo: 'Ideias da semana', usaIa: true });
    expect(RELATORIO_NA_TELA.ideias_semana.vaiPara).toContain('o presidente');
    expect(RECURSO_DO_RELATORIO.ideias_semana).toBe('mister_ideias_semana');
    expect(soAoPresidente('ideias_semana')).toBe(true);
    expect(soAoPresidente('resumo_semana')).toBe(false);
    expect(ehSemanal('ideias_semana')).toBe(true);
    expect(ehSemanal('resumo_dia')).toBe(false);
  });

  it('vence como o resumo da semana: só no dia escolhido, falando dos 7 dias até a véspera', () => {
    // Segunda, 16/11, às 09:05: de segunda 09/11 a domingo 15/11.
    expect(relatorioDevido('ideias_semana', ligado('09:00', 1), { dia: '2026-11-16', hora: '09:05', diaSemana: 1 })).toEqual({ referencia: '2026-11-09', ate: '2026-11-15' });
    expect(relatorioDevido('ideias_semana', ligado('09:00', 1), { dia: '2026-11-17', hora: '09:05', diaSemana: 2 })).toBeNull();
    // Domingo às 20h.
    expect(relatorioDevido('ideias_semana', ligado('20:00', 7), { dia: '2026-11-15', hora: '20:10', diaSemana: 7 })).toEqual({ referencia: '2026-11-08', ate: '2026-11-14' });
    expect(relatorioDevido('ideias_semana', { ligado: false, hora: '09:00', diaSemana: 1 }, { dia: '2026-11-16', hora: '09:05', diaSemana: 1 })).toBeNull();
  });

  it('a tela manda o dia da semana; sem ele, a recusa; a regra salva torta volta ao padrão', () => {
    expect(conferirRelatorios({ relatorios: [{ tipo: 'ideias_semana', ligado: true, hora: '20:00', diaSemana: 7 }] })).toEqual([
      { tipo: 'ideias_semana', regra: { ligado: true, hora: '20:00', diaSemana: 7 } },
    ]);
    expect(conferirRelatorios({ relatorios: [{ tipo: 'ideias_semana', ligado: true, hora: '09:00' }] })).toEqual({ erro: 'Ideias da semana: escolha o dia da semana.' });
    expect(regraDoRelatorioQueVale('ideias_semana', { ligado: true, hora: 'x', diaSemana: 0 })).toEqual({ ligado: true, hora: '09:00', diaSemana: 1 });
  });

  it('a pergunta à IA: o período, até 3 ideias numeradas, só com número de consulta, nada proposto agora e o fecho do "faz a 2"', () => {
    const p = perguntaDoRelatorio('ideias_semana', { referencia: '2026-11-09', ate: '2026-11-15' });
    expect(p).toContain('*Ideias da semana, 09/11 a 15/11*');
    expect(p).toContain('de 2026-11-09 até 2026-11-15');
    expect(p).toContain('ATÉ 3 ideias');
    expect(p).toContain('Só ideia com número que veio de uma consulta');
    expect(p).toContain('não use propor_acao nem fazer_no_regem');
    expect(p).toContain(FECHO_DAS_IDEIAS);
    expect(p).toContain('Não use mostrar_grafico');
  });

  it('o convite fora das 24 horas diz o que está pronto', () => {
    expect(parametrosDoResumo('ideias_semana', { referencia: '2026-11-09', ate: '2026-11-15' }, 'Burger da Praça')[0]).toBe('resumo com as ideias da semana de 09/11 a 15/11');
  });

  it('as ideias no bloco da conversa: a data, o texto, o caminho do botão; sem valores para quem não os vê', () => {
    expect(DIAS_DAS_IDEIAS_NA_CONVERSA).toBe(3);
    const texto = '*Ideias da semana, 09/11 a 15/11*\n1) A terça vendeu R$ 1.200,00 a menos: combo na terça.\n2) Cancelamentos subiram.';
    const l = linhasDasIdeias(texto, new Date('2026-11-16T12:10:00Z'), true, semValoresNoTexto);
    expect(l[0]).toContain('em 16/11');
    expect(l[0]).toContain('"faz a 1", "a 2", "a 3"');
    expect(l[0]).toContain('nunca faça sem ele');
    expect(l.slice(1).join('\n')).toContain('R$ 1.200,00');
    const sem = linhasDasIdeias(texto, new Date('2026-11-16T12:10:00Z'), false, semValoresNoTexto);
    expect(sem.join('\n')).not.toContain('1.200');
    expect(linhasDasIdeias('   ', new Date(), true, semValoresNoTexto)).toEqual([]);
  });
});
