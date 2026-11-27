import { diasDoPeriodo, feriadosSemResposta, type FeriadoSugerido } from './feriados-sem-resposta';
import { somarDias } from '../../common/horario-da-data';
import { eventosDaRegra } from '../perfil-cliente/calendario-regra';

// H2a dos dias especiais: os feriados que a loja ainda não respondeu (protótipo `regem-dias-especiais.html`, "Próximos
// feriados sem resposta" e a faixa 10 dias antes).
describe('feriados sem resposta', () => {
  const normal = (d: string) => (d === '2026-12-28' ? null : '18:00 às 23:00');
  const lei: FeriadoSugerido[] = eventosDaRegra('2026-12-01', '2027-01-31')
    .filter((e) => e.tipo === 'feriado' || e.tipo === 'ponto_facultativo')
    .map((e) => ({ chave: e.chave, data: e.dia, nome: e.nome, origem: e.tipo === 'feriado' ? 'lei' : 'ponto_facultativo' }));

  it('a lei entra na janela; o que passou e o que está longe, não', () => {
    const r = feriadosSemResposta({ hoje: '2026-12-01', ate: '2026-12-31', candidatos: lei, respostas: [], normalDoDia: normal });
    expect(r.map((f) => `${f.data} ${f.nome} ${f.origem}`)).toEqual(['2026-12-25 Natal lei']);
    expect(r[0]).toMatchObject({ chave: 'regra:feriado:natal:2026', normal: '18:00 às 23:00' });
  });

  it('qualquer dia especial que cobre a data responde — também o "horário normal" e o período; a chave gravada também', () => {
    const base = { hoje: '2026-12-01', ate: '2027-01-31', candidatos: lei, normalDoDia: normal };
    const todos = feriadosSemResposta({ ...base, respostas: [] }).map((f) => f.data);
    expect(todos).toEqual(['2026-12-25', '2027-01-01']);
    expect(feriadosSemResposta({ ...base, respostas: [{ data: '2026-12-25', dataFim: null, feriadoChave: null }] }).map((f) => f.data)).toEqual(['2027-01-01']);
    expect(feriadosSemResposta({ ...base, respostas: [{ data: '2026-12-24', dataFim: '2027-01-02', feriadoChave: null }] })).toEqual([]);
    // a resposta gravada com a chave do feriado vale mesmo em outra data (a loja mudou o dia do feriado da cidade)
    expect(feriadosSemResposta({ ...base, respostas: [{ data: '2026-12-26', dataFim: null, feriadoChave: 'regra:feriado:natal:2026' }] }).map((f) => f.data)).toEqual(['2027-01-01']);
  });

  it('a mesma data em duas fontes aparece uma vez, com o nome que a loja deu (Escala e calendário antes da lei)', () => {
    const candidatos: FeriadoSugerido[] = [
      ...lei,
      { chave: 'calendario:c1:2026-12-25', data: '2026-12-25', nome: 'Natal da cidade', origem: 'calendario' },
      { chave: 'escala:e1:2027-01-01', data: '2027-01-01', nome: 'Ano-novo da Escala', origem: 'escala' },
      { chave: 'calendario:c2:2027-01-20', data: '2027-01-20', nome: 'Aniversário da cidade', origem: 'calendario' },
    ];
    const r = feriadosSemResposta({ hoje: '2026-12-01', ate: '2027-01-31', candidatos, respostas: [], normalDoDia: normal });
    expect(r.map((f) => `${f.data} ${f.nome} ${f.origem}`)).toEqual([
      '2026-12-25 Natal da cidade calendario',
      '2027-01-01 Ano-novo da Escala escala',
      '2027-01-20 Aniversário da cidade calendario',
    ]);
  });

  it('o dia fechado na semana vem com o normal vazio (a faixa diz "fechada"); nome em branco não entra', () => {
    const r = feriadosSemResposta({
      hoje: '2026-12-01',
      ate: '2026-12-31',
      candidatos: [
        { chave: 'escala:e2:2026-12-28', data: '2026-12-28', nome: 'Folga da cidade', origem: 'escala' },
        { chave: 'escala:e3:2026-12-29', data: '2026-12-29', nome: '  ', origem: 'escala' },
      ],
      respostas: [],
      normalDoDia: normal,
    });
    expect(r).toEqual([{ chave: 'escala:e2:2026-12-28', data: '2026-12-28', nome: 'Folga da cidade', origem: 'escala', normal: null }]);
  });

  it('os dias do período do feriado da Escala, com teto', () => {
    expect(diasDoPeriodo('2026-12-30', '2027-01-02', somarDias)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(diasDoPeriodo('2026-12-30', null, somarDias)).toEqual(['2026-12-30']);
    expect(diasDoPeriodo('2026-12-30', '2026-12-01', somarDias)).toEqual(['2026-12-30']);
    expect(diasDoPeriodo('2026-01-01', '2026-12-31', somarDias, 5)).toHaveLength(5);
  });
});
