import { agoraDaOperacao, HORA_HABITUAL, limitesDoEnvio, minutoDaOperacao } from './hora-habitual';

// A hora habitual da campanha (F7 parte 4b): o relógio do dia de OPERAÇÃO (a madrugada é do dia anterior, como a grade do
// perfil) e os limites do momento de envio — sem banco.
describe('hora habitual (sem banco)', () => {
  it('o agora no dia de operação: São Paulo, e a madrugada fica no dia anterior passando de 1440', () => {
    // 18/11/2026 é quarta-feira. 18h00 UTC = 15h00 em São Paulo.
    expect(agoraDaOperacao(new Date('2026-11-18T18:00:00Z'))).toEqual({ dia: 3, minuto: 15 * 60 });
    // Quinta 02h30 em São Paulo (05h30 UTC) ainda é a quarta de operação: 1440 + 150.
    expect(agoraDaOperacao(new Date('2026-11-19T05:30:00Z'))).toEqual({ dia: 3, minuto: 1440 + 150 });
    // Segunda 01h00 em São Paulo é o domingo de operação (7).
    expect(agoraDaOperacao(new Date('2026-11-23T04:00:00Z'))).toEqual({ dia: 7, minuto: 1440 + 60 });
    // Às 04h00 em ponto já é o dia novo.
    expect(agoraDaOperacao(new Date('2026-11-19T07:00:00Z'))).toEqual({ dia: 4, minuto: 4 * 60 });
  });

  it('o minuto do relógio vira o do dia de operação só antes do corte (4h)', () => {
    expect(minutoDaOperacao(70)).toBe(1510);
    expect(minutoDaOperacao(4 * 60)).toBe(240);
    expect(minutoDaOperacao(23 * 60)).toBe(1380);
  });

  it('os limites: a janela da campanha (até a que vira a meia-noite), com 10 min de folga; sem janela ou janela torta, 8h–23h', () => {
    expect(limitesDoEnvio()).toEqual({ de: HORA_HABITUAL.cedo, ate: HORA_HABITUAL.tarde });
    expect(limitesDoEnvio('11:00', '14:00')).toEqual({ de: 660, ate: 830 });
    expect(limitesDoEnvio('18:00:00', '02:00:00')).toEqual({ de: 1080, ate: 1440 + 120 - 10 });
    expect(limitesDoEnvio('20:00', '20:00')).toEqual({ de: 480, ate: 1380 });
    expect(limitesDoEnvio('20:00', null)).toEqual({ de: 480, ate: 1380 });
  });
});
