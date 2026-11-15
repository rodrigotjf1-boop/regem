import { situacaoDa99, situacaoVelha } from './situacao-99';

// A SITUAÇÃO DA LOJA NA 99 — o `data` do aviso `shopStatus` (doc 1957) e do detalhe da loja (doc 1943).
const EM = new Date('2026-11-12T23:10:00Z');

describe('situação da loja na 99', () => {
  it('cada sub_biz_status vira um estado', () => {
    const esperado: Record<number, string> = {
      1: 'aberta',
      2: 'pausada',
      3: 'fechada',
      4: 'desconectada',
      5: 'fora_do_horario',
      6: 'bloqueada',
      7: 'sem_entregador',
    };
    for (const [sub, estado] of Object.entries(esperado)) expect(situacaoDa99({ sub_biz_status: Number(sub) }, EM, 'aviso')?.estado).toBe(estado);
  });

  it('o exemplo do aviso da doc (aberta) e o fechado só pelo biz_status', () => {
    expect(
      situacaoDa99({ biz_status: 1, sub_biz_status: 1, store_availability_status: 1, store_unavailable_reason: '', store_unavailable_end_time: 0 }, EM, 'aviso'),
    ).toEqual({ estado: 'aberta', motivo: null, ate: null, em: EM.toISOString(), fonte: 'aviso' });
    expect(situacaoDa99({ biz_status: 2 }, EM, 'leitura')?.estado).toBe('fechada');
  });

  it('aberta no sistema mas "não atende" agora: pausada, com o motivo e o fim que a 99 diz', () => {
    expect(
      situacaoDa99({ biz_status: 1, sub_biz_status: 1, store_availability_status: 2, store_unavailable_reason: 'Sem energia', store_unavailable_end_time: 1763000000 }, EM, 'aviso'),
    ).toEqual({ estado: 'pausada', motivo: 'Sem energia', ate: new Date(1763000000 * 1000).toISOString(), em: EM.toISOString(), fonte: 'aviso' });
  });

  it('o código da pausa (1001) vira o motivo em palavras', () => {
    expect(situacaoDa99({ sub_biz_status: 2, pause_reason_code: 1001 }, EM, 'leitura')?.motivo).toBe('problema de equipamento ou falta de energia');
  });

  it('sem campo de situação reconhecível: null (não inventa)', () => {
    expect(situacaoDa99({}, EM, 'aviso')).toBeNull();
    expect(situacaoDa99({ sub_biz_status: 99 }, EM, 'aviso')).toBeNull();
    expect(situacaoDa99(null, EM, 'aviso')).toBeNull();
    expect(situacaoDa99('x', EM, 'aviso')).toBeNull();
  });

  it('velha: nunca lida ou com mais de 6 h', () => {
    expect(situacaoVelha(undefined, EM)).toBe(true);
    expect(situacaoVelha({ em: 'lixo' }, EM)).toBe(true);
    expect(situacaoVelha({ em: new Date(EM.getTime() - 5 * 3_600_000).toISOString() }, EM)).toBe(false);
    expect(situacaoVelha({ em: new Date(EM.getTime() - 7 * 3_600_000).toISOString() }, EM)).toBe(true);
  });
});
