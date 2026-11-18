import {
  FRANQUIA_DO_ATENDIMENTO,
  MINUTOS_DA_VOLTA,
  MINUTOS_ENTRE_LEITURAS,
  diaDoIntervalo,
  ehCobrada,
  erroDaMeta,
  franquiaPorNumero,
  grupoDaCategoria,
  inicioDoDiaEmSegundos,
  linhasDeModeloPorDia,
  linhasPorDia,
  mesesAntes,
  nomeDoModelo,
  papelDoNumero,
  periodoDaConsulta,
  pontosDoModelo,
  pontosDoPreco,
  projecaoDoMes,
  resumoDasLinhas,
  ultimoDoMes,
} from './whatsapp-gasto';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// O GASTO DO WHATSAPP OFICIAL (G1, mig 445) — as regras puras: o que a Meta devolve, o dia no fuso da loja, os tipos, o
// período da tela, a projeção e a franquia.
const s = (iso: string) => Date.parse(iso) / 1000;

describe('gasto do WhatsApp oficial — regras puras', () => {
  it('a volta é curta (o relógio do @Interval recomeça a cada deploy — ERR-521) e cada conta é lida de 30 em 30', () => {
    expect(MINUTOS_DA_VOLTA).toBeLessThanOrEqual(5);
    expect(MINUTOS_ENTRE_LEITURAS).toBe(30);
    const servico = readFileSync(join(__dirname, 'whatsapp-gasto.service.ts'), 'utf8');
    expect(servico).toContain('@Interval(MINUTOS_DA_VOLTA * 60_000)');
    expect(servico).not.toContain('@Interval(MINUTOS_ENTRE_LEITURAS');
  });

  it('o grupo da tela para cada categoria da Meta', () => {
    expect(grupoDaCategoria('MARKETING')).toBe('marketing');
    expect(grupoDaCategoria('MARKETING_LITE')).toBe('marketing');
    expect(grupoDaCategoria('utility')).toBe('utilidade');
    expect(grupoDaCategoria('SERVICE')).toBe('atendimento');
    expect(grupoDaCategoria('AUTHENTICATION_INTERNATIONAL')).toBe('autenticacao');
    expect(grupoDaCategoria('REFERRAL_CONVERSION')).toBe('outros');
    expect(grupoDaCategoria(null)).toBe('outros');
    expect(ehCobrada('REGULAR')).toBe(true);
    expect(ehCobrada('FREE_CUSTOMER_SERVICE')).toBe(false);
    expect(ehCobrada('FREE_ENTRY_POINT')).toBe(false);
  });

  it('lê os pontos da consulta de preço na forma documentada; o que não serve fica de fora', () => {
    const json = {
      currency: 'BRL',
      pricing_analytics: {
        data: [
          {
            data_points: [
              { start: s('2026-11-18T15:00:00Z'), end: s('2026-11-18T15:30:00Z'), phone_number: '+55 21 9999-2210', pricing_type: 'regular', pricing_category: 'marketing', volume: 412, cost: 132.5404 },
              { start: s('2026-11-18T15:00:00Z'), end: s('2026-11-18T15:30:00Z'), phone_number: '552199992210', pricing_type: 'FREE_CUSTOMER_SERVICE', pricing_category: 'SERVICE', volume: '3', cost: 0 },
              { start: 'x', end: s('2026-11-18T15:30:00Z'), pricing_type: 'REGULAR', pricing_category: 'UTILITY', volume: 1, cost: 0.035 },
              { start: s('2026-11-18T16:00:00Z'), end: s('2026-11-18T15:30:00Z'), pricing_type: 'REGULAR', pricing_category: 'UTILITY', volume: 1, cost: 0.035 },
              { start: s('2026-11-18T16:00:00Z'), end: s('2026-11-18T16:30:00Z'), pricing_type: 'REGULAR', pricing_category: 'UTILITY', volume: -4, cost: 'abc' },
            ],
          },
        ],
      },
    };
    expect(pontosDoPreco(json)).toEqual([
      { inicio: s('2026-11-18T15:00:00Z'), fim: s('2026-11-18T15:30:00Z'), numero: '552199992210', categoria: 'MARKETING', tipo: 'REGULAR', mensagens: 412, custo: 132.5404 },
      { inicio: s('2026-11-18T15:00:00Z'), fim: s('2026-11-18T15:30:00Z'), numero: '552199992210', categoria: 'SERVICE', tipo: 'FREE_CUSTOMER_SERVICE', mensagens: 3, custo: 0 },
      { inicio: s('2026-11-18T16:00:00Z'), fim: s('2026-11-18T16:30:00Z'), numero: '', categoria: 'UTILITY', tipo: 'REGULAR', mensagens: 0, custo: 0 },
    ]);
    expect(pontosDoPreco({})).toEqual([]);
    expect(pontosDoPreco({ pricing_analytics: { data: 'x' } })).toEqual([]);
  });

  it('o dia é o da loja: a meia hora das 23h30 de São Paulo é do dia, e o ponto diário (UTC) cai no próprio dia', () => {
    // 02:30Z de 19/11 = 23:30 de 18/11 em São Paulo
    expect(diaDoIntervalo(s('2026-11-19T02:30:00Z'), s('2026-11-19T03:00:00Z'))).toBe('2026-11-18');
    expect(diaDoIntervalo(s('2026-11-19T03:00:00Z'), s('2026-11-19T03:30:00Z'))).toBe('2026-11-19');
    expect(diaDoIntervalo(s('2026-10-31T00:00:00Z'), s('2026-11-01T00:00:00Z'))).toBe('2026-10-31');
    expect(inicioDoDiaEmSegundos('2026-11-18')).toBe(s('2026-11-18T03:00:00Z'));
    expect(inicioDoDiaEmSegundos('2026-11-18', 'UTC')).toBe(s('2026-11-18T00:00:00Z'));
  });

  it('soma por número, dia, categoria e tipo — uma linha por chave da tabela', () => {
    const p = (ini: string, cat: string, tipo: string, n: number, c: number, numero = '552199992210') => ({ inicio: s(ini), fim: s(ini) + 1800, numero, categoria: cat, tipo, mensagens: n, custo: c });
    const linhas = linhasPorDia([
      p('2026-11-18T12:00:00Z', 'UTILITY', 'REGULAR', 2, 0.07),
      p('2026-11-18T22:00:00Z', 'UTILITY', 'REGULAR', 1, 0.035),
      p('2026-11-19T02:30:00Z', 'UTILITY', 'REGULAR', 1, 0.035), // ainda 18/11 em São Paulo
      p('2026-11-19T03:30:00Z', 'UTILITY', 'REGULAR', 5, 0.175), // 19/11
      p('2026-11-18T12:00:00Z', 'UTILITY', 'REGULAR', 4, 0.14, '552199997731'), // outro número
    ]);
    expect(linhas).toEqual(
      expect.arrayContaining([
        { numero: '552199992210', dia: '2026-11-18', categoria: 'UTILITY', tipo: 'REGULAR', mensagens: 4, custo: 0.14 },
        { numero: '552199992210', dia: '2026-11-19', categoria: 'UTILITY', tipo: 'REGULAR', mensagens: 5, custo: 0.175 },
        { numero: '552199997731', dia: '2026-11-18', categoria: 'UTILITY', tipo: 'REGULAR', mensagens: 4, custo: 0.14 },
      ]),
    );
    expect(linhas).toHaveLength(3);
  });

  it('o gasto por modelo: só o "amount_spent" conta; modelo sem id fica de fora', () => {
    const json = {
      data: [
        {
          data_points: [
            { template_id: '111', start: s('2026-11-14T00:00:00Z'), end: s('2026-11-15T00:00:00Z'), delivered: 412, cost: [{ type: 'amount_spent', value: 132.54 }, { type: 'cost_per_delivered', value: 0.32 }] },
            { template_id: '111', start: s('2026-11-14T00:00:00Z'), end: s('2026-11-15T00:00:00Z'), delivered: 1, cost: [{ type: 'amount_spent', value: 0.32 }] },
            { start: s('2026-11-14T00:00:00Z'), end: s('2026-11-15T00:00:00Z'), delivered: 9, cost: [] },
          ],
        },
      ],
    };
    expect(linhasDeModeloPorDia(pontosDoModelo(json))).toEqual([{ dia: '2026-11-14', modeloId: '111', mensagens: 413, custo: 132.86 }]);
  });

  it('o período da tela', () => {
    expect(periodoDaConsulta({}, '2026-11-18')).toEqual({ tipo: 'mes', de: '2026-11-01', ate: '2026-11-18', mesCorrente: true });
    expect(periodoDaConsulta({ periodo: 'passado' }, '2026-11-18')).toEqual({ tipo: 'passado', de: '2026-10-01', ate: '2026-10-31', mesCorrente: false });
    expect(periodoDaConsulta({ periodo: 'passado' }, '2027-01-05')).toEqual({ tipo: 'passado', de: '2026-12-01', ate: '2026-12-31', mesCorrente: false });
    expect(periodoDaConsulta({ periodo: 'tres' }, '2026-02-10')).toEqual({ tipo: 'tres', de: '2025-12-01', ate: '2026-02-10', mesCorrente: false });
    expect(periodoDaConsulta({ periodo: 'outro', de: '2026-11-01', ate: '2026-11-18' }, '2026-11-18').mesCorrente).toBe(true);
    expect(periodoDaConsulta({ periodo: 'outro', de: '2026-11-03', ate: '2026-11-10' }, '2026-11-18')).toEqual({ tipo: 'outro', de: '2026-11-03', ate: '2026-11-10', mesCorrente: false });
    const recusa = (q: any) => {
      try {
        periodoDaConsulta(q, '2026-11-18');
        return 'aceitou';
      } catch (e: any) {
        return e.message;
      }
    };
    expect(recusa({ periodo: 'semana' })).toBe('Período desconhecido.');
    expect(recusa({ periodo: 'outro', de: '2026-11-01' })).toBe('Escolha as duas datas do período.');
    expect(recusa({ periodo: 'outro', de: '2026-02-30', ate: '2026-03-02' })).toBe('Escolha as duas datas do período.');
    expect(recusa({ periodo: 'outro', de: '2026-11-10', ate: '2026-11-03' })).toBe('A data inicial vem depois da final.');
    expect(recusa({ periodo: 'outro', de: '2026-11-10', ate: '2026-11-19' })).toBe('O período vai até hoje.');
    expect(recusa({ periodo: 'outro', de: '2025-11-01', ate: '2026-11-18' })).toBe('A Meta guarda o gasto de até 12 meses.');
  });

  it('o último dia do mês e os meses para trás (virada de ano e fevereiro)', () => {
    expect(ultimoDoMes('2028-02-10')).toBe('2028-02-29');
    expect(ultimoDoMes('2026-12-05')).toBe('2026-12-31');
    expect(mesesAntes('2026-11-18', 12)).toBe('2025-11-01');
    expect(mesesAntes('2026-01-31', 1)).toBe('2025-12-01');
  });

  it('a projeção: o ritmo até agora × os dias do mês; antes de um dia inteiro, nenhuma', () => {
    // 19/11 00:30Z = 18/11 21:30 em São Paulo: 17 dias e 21h30 decorridos
    const decorridos = 17 + (21 * 60 + 30) / 1440;
    expect(projecaoDoMes(205.43, new Date('2026-11-19T00:30:00Z'))).toBeCloseTo((205.43 / decorridos) * 30, 1);
    expect(projecaoDoMes(10, new Date('2026-11-01T20:00:00Z'))).toBeNull(); // 17h do dia 1º
    expect(projecaoDoMes(10, new Date('2026-11-02T03:00:00Z'))).toBeCloseTo(300, 1); // meia-noite do dia 2: um dia inteiro
  });

  it('o resumo: totais, cobradas e grátis por tipo, todos os dias do período e "outros" só quando há', () => {
    const periodo = { tipo: 'outro' as const, de: '2026-11-13', ate: '2026-11-15', mesCorrente: false };
    const r = resumoDasLinhas(
      [
        { numero: 'a', dia: '2026-11-14', categoria: 'MARKETING', tipo: 'REGULAR', mensagens: 412, custo: 132.54 },
        { numero: 'a', dia: '2026-11-14', categoria: 'UTILITY', tipo: 'REGULAR', mensagens: 60, custo: 2.1 },
        { numero: 'a', dia: '2026-11-15', categoria: 'SERVICE', tipo: 'FREE_CUSTOMER_SERVICE', mensagens: 70, custo: 0 },
        { numero: 'a', dia: '2026-11-15', categoria: 'SERVICE', tipo: 'REGULAR', mensagens: 20, custo: 0.7 },
      ],
      periodo,
    );
    expect(r.total).toEqual({ custo: 135.34, mensagens: 562, cobradas: 492 });
    expect(r.tipos.map((t) => t.grupo)).toEqual(['marketing', 'utilidade', 'atendimento', 'autenticacao']);
    expect(r.tipos.find((t) => t.grupo === 'atendimento')).toEqual({ grupo: 'atendimento', mensagens: 90, cobradas: 20, gratis: 70, custo: 0.7 });
    expect(r.dias).toEqual([
      { dia: '2026-11-13', custo: 0, marketing: 0 },
      { dia: '2026-11-14', custo: 134.64, marketing: 132.54 },
      { dia: '2026-11-15', custo: 0.7, marketing: 0 },
    ]);
    const comOutros = resumoDasLinhas([{ numero: 'a', dia: '2026-11-14', categoria: 'REFERRAL_CONVERSION', tipo: 'REGULAR', mensagens: 1, custo: 0.1 }], periodo);
    expect(comOutros.tipos.map((t) => t.grupo)).toContain('outros');
  });

  it('a franquia do atendimento por número (entregues, cobradas ou não) e o papel do número pelo final', () => {
    const f = franquiaPorNumero([
      { numero: '552199992210', dia: 'x', categoria: 'SERVICE', tipo: 'TODOS', mensagens: 1200, custo: 0 },
      { numero: '552199997731', dia: 'x', categoria: 'SERVICE', tipo: 'TODOS', mensagens: 12, custo: 0 },
      { numero: '552199997731', dia: 'x', categoria: 'MARKETING', tipo: 'REGULAR', mensagens: 400, custo: 0 },
    ]);
    expect(f).toEqual([
      { numero: '552199992210', usadas: 1200, limite: FRANQUIA_DO_ATENDIMENTO },
      { numero: '552199997731', usadas: 12, limite: FRANQUIA_DO_ATENDIMENTO },
    ]);
    // o mesmo celular com o nono dígito (no cadastro) e sem ele (na Meta)
    const nums = [{ numero: '+55 21 99999-2210', papel: 'principal' }, { numero: '2199997731', papel: 'marketing' }];
    expect(papelDoNumero('552199992210', nums)).toBe('principal');
    expect(papelDoNumero('5521999992210', nums)).toBe('principal');
    expect(papelDoNumero('552199997731', nums)).toBe('marketing');
    expect(papelDoNumero('551133334444', nums)).toBeNull();
    expect(papelDoNumero('123', nums)).toBeNull();
  });

  it('o nome do modelo e o erro da Meta (sem o rastro interno dela)', () => {
    expect(nomeDoModelo('pedido_saiu_para_entrega')).toBe('Pedido saiu para entrega');
    expect(nomeDoModelo('')).toBe('Modelo sem nome');
    const e = erroDaMeta(400, { error: { message: 'Invalid parameter', code: 100, error_subcode: 33, fbtrace_id: 'AbCdEf' } });
    expect(e).toBe('A Meta respondeu 400: Invalid parameter (código 100/33)');
    expect(e).not.toContain('AbCdEf');
    expect(erroDaMeta(500, {})).toBe('A Meta respondeu 500');
  });
});
