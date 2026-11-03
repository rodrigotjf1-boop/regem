import {
  AJUSTES_PADRAO,
  aberturaDoDia,
  agoraNaOperacao,
  ajustesDaLinha,
  dataCurta,
  horaDoEnvio,
  lerAjustes,
  nomeCurto,
  podeMandarAgora,
  reais,
  textoCashbackQr,
} from './relacionamento';

// As automáticas (Onda 3 · PR 2): ajustes conferidos, horário do envio e o texto do aviso do cashback.
describe('automáticas — regras puras', () => {
  const semana = (abre: string, fecha = '23:00', dias = [0, 1, 2, 3, 4, 5, 6]) => dias.map((dia) => ({ dia, ativo: true, abre, fecha }));

  it('os ajustes: ausente fica de fora (V16), liga só com booleano (V15), fora da lista é recusado', () => {
    expect(lerAjustes({})).toEqual({});
    expect(lerAjustes({ cashbackAtivo: true, maxPorDia: 50, horario: '15:00' })).toEqual({ cashbackAtivo: true, maxPorDia: 50, horario: '15:00' });
    expect(() => lerAjustes({ cashbackAtivo: 'sim' })).toThrow('cashbackAtivo');
    expect(() => lerAjustes({ maxPorDia: 40 })).toThrow('10, 20, 30, 50 ou 100');
    expect(() => lerAjustes({ maxPorDia: '30' })).toThrow('10, 20, 30, 50 ou 100');
    expect(() => lerAjustes({ intervaloOfertasDias: 1 })).toThrow('3, 7, 15 ou 30');
    expect(() => lerAjustes({ horario: '12:00' })).toThrow('Horário do envio');
    expect(() => lerAjustes({ cashbackDiasAntes: 4 })).toThrow('1, 2, 3, 5 ou 7');
    expect(() => lerAjustes({ cashbackSaldoMin: 3 })).toThrow('R$ 1, 2, 5 ou 10');
  });

  it('a linha do banco: sem linha é o padrão (nasce desligado); valor torto vira o padrão do campo', () => {
    expect(ajustesDaLinha(undefined)).toEqual(AJUSTES_PADRAO);
    expect(AJUSTES_PADRAO.cashbackAtivo).toBe(false);
    expect(ajustesDaLinha({ intervalo_ofertas_dias: 15, max_por_dia: 999, horario: 'x', cashback_ativo: true, cashback_dias_antes: 5, cashback_saldo_min: '10.00' })).toEqual({
      intervaloOfertasDias: 15,
      maxPorDia: 30,
      horario: 'antes_de_abrir',
      cashbackAtivo: true,
      cashbackDiasAntes: 5,
      cashbackSaldoMin: 10,
    });
  });

  it('a abertura do dia é a mais cedo entre as lojas; dia sem loja aberta não tem envio', () => {
    const lojaA = semana('18:00');
    const lojaB = [{ dia: 2, ativo: true, abre: '11:30', fecha: '15:00' }];
    expect(aberturaDoDia([lojaA, lojaB], 2)).toBe('11:30');
    expect(aberturaDoDia([lojaA, lojaB], 3)).toBe('18:00');
    expect(aberturaDoDia([[{ dia: 1, ativo: false, abre: '08:00', fecha: '12:00' }]], 1)).toBeNull();
    expect(aberturaDoDia([[{ dia: 1, ativo: true, abre: '8h', fecha: '12:00' }]], 1)).toBeNull(); // hora torta não vale
    expect(horaDoEnvio([lojaA], 'antes_de_abrir', 4)).toBe('17:00');
    expect(horaDoEnvio([lojaA], 'ao_abrir', 4)).toBe('18:00');
    expect(horaDoEnvio([lojaA], '10:00', 4)).toBe('10:00');
    expect(horaDoEnvio([[]], '10:00', 4)).toBeNull(); // às 10:00, mas só em dia que a loja abre
  });

  it('nunca antes das 9h nem depois das 21h', () => {
    expect(horaDoEnvio([semana('07:00')], 'antes_de_abrir', 1)).toBe('09:00');
    expect(horaDoEnvio([semana('00:30', '06:00')], 'antes_de_abrir', 1)).toBe('09:00');
    expect(horaDoEnvio([semana('23:00', '23:59')], 'ao_abrir', 1)).toBe('21:00');
    expect(podeMandarAgora([semana('18:00')], 'antes_de_abrir', { dia: 1, hhmm: '16:59' })).toBe(false);
    expect(podeMandarAgora([semana('18:00')], 'antes_de_abrir', { dia: 1, hhmm: '17:00' })).toBe(true);
    expect(podeMandarAgora([semana('18:00')], 'antes_de_abrir', { dia: 1, hhmm: '21:00' })).toBe(false);
    expect(podeMandarAgora([semana('18:00', '23:00', [2])], 'antes_de_abrir', { dia: 1, hhmm: '17:30' })).toBe(false); // segunda fechada
  });

  it('o relógio da operação (São Paulo), não o do servidor', () => {
    // 03/11/2026 02:30 UTC = 02/11/2026 23:30 em São Paulo (segunda-feira)
    expect(agoraNaOperacao(new Date('2026-11-03T02:30:00Z'))).toEqual({ dia: 1, hhmm: '23:30' });
    expect(dataCurta(new Date('2026-11-07T01:00:00Z'))).toBe('06/11');
  });

  it('o texto do aviso pelo QR: saldo, data, como usar, o link e o jeito de sair — sem convite para comprar', () => {
    const t = textoCashbackQr({ nome: 'MARINA lopes', valor: 12.4, loja: 'Burger da Praça', vence: new Date('2026-11-06T15:00:00Z'), link: 'https://api/x/r/1' });
    expect(t).toContain('Oi, Marina! Seu cashback de R$ 12,40 na Burger da Praça vence em 06/11.');
    expect(t).toContain('Ele é descontado no seu próximo pedido pelo cardápio ou pelo WhatsApp.');
    expect(t).toContain('Ver meu saldo: https://api/x/r/1');
    expect(t).toContain('Para não receber estes avisos, responda SAIR.');
    expect(t).not.toMatch(/aproveite|use agora|corra/i);
    expect(textoCashbackQr({ nome: '', valor: 5, loja: 'X', vence: '2026-11-06T15:00:00Z', link: 'l' })).toMatch(/^Oi! Seu cashback de R\$ 5,00/);
    expect(reais(1234.5)).toBe('R$ 1.234,50');
    expect(nomeCurto('marina de souza lopes')).toBe('Marina L.');
    expect(nomeCurto('Paulo')).toBe('Paulo');
    expect(nomeCurto('')).toBe('Cliente sem nome');
  });
});
