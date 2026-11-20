import {
  diaValido,
  eventosDaRegra,
  feriadosNacionais,
  lerEventoDaLoja,
  ocorrencias,
  pascoa,
  quintoDiaUtil,
} from './calendario-regra';

// A regra fixa do calendário da loja (F2 do plano do perfil do cliente): datas conferidas à mão contra o calendário.
describe('calendário da loja — a regra fixa', () => {
  it('Páscoa (Meeus/Jones/Butcher)', () => {
    expect(pascoa(2024)).toBe('2024-03-31');
    expect(pascoa(2025)).toBe('2025-04-20');
    expect(pascoa(2026)).toBe('2026-04-05');
    expect(pascoa(2027)).toBe('2027-03-28');
  });

  it('feriados por lei, a Paixão e os pontos facultativos (Carnaval e Corpus Christi NÃO são feriado)', () => {
    const f = feriadosNacionais(2026);
    expect(f.map((x) => x.dia)).toEqual([
      '2026-01-01', '2026-04-03', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
    ]);
    expect(f.find((x) => x.dia === '2026-11-20')).toMatchObject({ fonte: 'Lei 14.759/2023', tipo: 'feriado' });
    const ano = eventosDaRegra('2026-01-01', '2026-12-31');
    const ponto = ano.filter((e) => e.tipo === 'ponto_facultativo').map((e) => e.dia);
    expect(ponto).toEqual(['2026-02-16', '2026-02-17', '2026-02-18', '2026-06-04']);
    expect(ano.filter((e) => e.grupo === 'feriado' && e.tipo === 'feriado').map((e) => e.dia)).not.toContain('2026-02-16');
  });

  it('comemorativas de regra fixa', () => {
    const c = Object.fromEntries(eventosDaRegra('2026-01-01', '2026-12-31').filter((e) => e.tipo === 'comemorativa').map((e) => [e.nome, e.dia]));
    expect(c['Dia das Mães']).toBe('2026-05-10');
    expect(c['Dia dos Pais']).toBe('2026-08-09');
    expect(c['Black Friday']).toBe('2026-11-27');
    expect(eventosDaRegra('2025-11-01', '2025-11-30').find((e) => e.nome === 'Black Friday')?.dia).toBe('2025-11-28');
    // Sem lei, a fonte diz que é costume.
    expect(eventosDaRegra('2026-08-01', '2026-08-31').find((e) => e.nome === 'Dia dos Pais')).toMatchObject({ confianca: 'costume' });
  });

  it('5º dia útil: o sábado conta; domingo, feriado e a Paixão não', () => {
    expect(quintoDiaUtil(2026, 11)).toBe('2026-11-07'); // 02/11 (Finados) não conta; 07 é sábado
    expect(quintoDiaUtil(2026, 12)).toBe('2026-12-05');
    expect(quintoDiaUtil(2027, 1)).toBe('2027-01-07'); // 01/01 não conta
    expect(quintoDiaUtil(2026, 4)).toBe('2026-04-07'); // 03/04 (Paixão) não conta
    expect(quintoDiaUtil(2026, 9)).toBe('2026-09-05');
  });

  it('o 13º, o vale do dia 20 (costume) e a ordem por dia', () => {
    const nov = eventosDaRegra('2026-11-15', '2026-11-30');
    expect(nov.map((e) => `${e.dia} ${e.tipo}`)).toEqual([
      '2026-11-15 feriado',
      '2026-11-20 feriado',
      '2026-11-20 dinheiro',
      '2026-11-27 comemorativa',
      '2026-11-30 dinheiro',
    ]);
    expect(nov.find((e) => e.nome.startsWith('Vale'))).toMatchObject({ confianca: 'costume' });
    expect(eventosDaRegra('2026-12-20', '2026-12-20').map((e) => e.nome)).toEqual(['Vale (adiantamento) do dia 20', '13º salário — prazo da 2ª parcela']);
    // A chave é estável: o mesmo evento no mesmo ano dá sempre a mesma.
    expect(eventosDaRegra('2026-11-20', '2026-11-20')[0].chave).toBe('regra:feriado:consciencia-negra:2026');
  });

  it('as ocorrências do evento da loja: uma vez, toda semana desde o dia, todo ano (29/02 só no bissexto)', () => {
    expect(ocorrencias('2026-11-28', 'nao', '2026-11-20', '2026-12-31')).toEqual(['2026-11-28']);
    expect(ocorrencias('2026-10-01', 'nao', '2026-11-20', '2026-12-31')).toEqual([]);
    expect(ocorrencias('2026-11-26', 'semana', '2026-11-20', '2026-12-10')).toEqual(['2026-11-26', '2026-12-03', '2026-12-10']);
    expect(ocorrencias('2026-10-01', 'semana', '2026-11-20', '2026-12-04')).toEqual(['2026-11-26', '2026-12-03']); // quinta
    expect(ocorrencias('2026-12-10', 'semana', '2026-11-20', '2026-12-04')).toEqual([]);
    expect(ocorrencias('2020-01-20', 'ano', '2026-01-01', '2027-12-31')).toEqual(['2026-01-20', '2027-01-20']);
    expect(ocorrencias('2024-02-29', 'ano', '2025-01-01', '2028-12-31')).toEqual(['2028-02-29']);
    expect(ocorrencias('2027-01-20', 'ano', '2026-01-01', '2027-12-31')).toEqual(['2027-01-20']);
  });

  it('confere o evento da loja e recusa o que não serve', () => {
    expect(lerEventoDaLoja({ nome: '  Show  no estádio ', tipo: 'show', dia: '2026-12-05', hora: '21:30', repete: 'nao' })).toEqual({
      nome: 'Show no estádio', tipo: 'show', dia: '2026-12-05', hora: '21:30', repete: 'nao',
    });
    expect(lerEventoDaLoja({ nome: 'São Sebastião', tipo: 'feriado_municipal', dia: '2027-01-20', repete: 'ano' }).hora).toBeNull();
    expect(() => lerEventoDaLoja({ nome: 'x', tipo: 'show', dia: '2026-12-05' })).toThrow(/nome/);
    expect(() => lerEventoDaLoja({ nome: 'Show', tipo: 'jogo', dia: '2026-12-05' })).toThrow(/tipo/);
    expect(() => lerEventoDaLoja({ nome: 'Show', tipo: 'show', dia: '2026-02-30' })).toThrow(/dia/);
    expect(() => lerEventoDaLoja({ nome: 'Show', tipo: 'show', dia: '2026-12-05', hora: '25:00' })).toThrow(/Hora/);
    expect(() => lerEventoDaLoja({ nome: 'Show', tipo: 'show', dia: '2026-12-05', repete: 'mes' })).toThrow(/repete/);
    expect(diaValido('2028-02-29')).toBe(true);
    expect(diaValido('2027-02-29')).toBe(false);
  });
});
