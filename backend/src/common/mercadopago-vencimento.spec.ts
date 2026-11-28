import { criarPixMP, MINIMO_DO_VENCIMENTO_NO_MP_MS, vencimentoNoMP } from './mercadopago';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O VENCIMENTO DO PIX NO MERCADO PAGO (ERR-653): o Pix de 5 min do adicional (pedido 77, 27/11/2026) foi recusado pelo
// banco do cliente ("o banco recebedor está com problema") com 1 minuto de vida, no Itaú e no Nubank. O MP só garante o
// vencimento de 30 min a 30 dias; abaixo disso aceita a data e a cobrança para de receber antes. Agora o MP recebe sempre
// o mínimo dele com folga, e o prazo do Regem (10 min) segue pelas rotinas que cancelam a cobrança no MP.

function mpDeMentira() {
  const corpos: any[] = [];
  const fetchFalso = async (_url: string, init: any = {}) => {
    corpos.push(init.body ? JSON.parse(init.body) : null);
    return {
      ok: true,
      status: 201,
      json: async () => ({ id: 555, status: 'pending', point_of_interaction: { transaction_data: { qr_code: '000201...', qr_code_base64: null, ticket_url: null } } }),
    } as any;
  };
  return { corpos, fetchFalso };
}

const dados = (expiraEm: Date) => ({
  valor: 17.5,
  descricao: 'Pedido #77 · item novo',
  referenciaExterna: 'adic-1',
  idempotencia: 'adicional-1',
  expiraEm,
});

describe('vencimento do Pix no Mercado Pago (ERR-653)', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  it('o prazo curto do Regem (5 ou 10 min) vai ao MP como o mínimo dele, com folga', async () => {
    for (const min of [5, 10]) {
      const mp = mpDeMentira();
      global.fetch = mp.fetchFalso as any;
      const antes = Date.now();
      await criarPixMP('tk', dados(new Date(antes + min * 60_000)));
      const vai = new Date(mp.corpos[0].date_of_expiration).getTime();
      // Nunca abaixo dos 30 min que o MP documenta (o teste não depende do relógio: mede contra o "antes").
      expect(vai - antes).toBeGreaterThanOrEqual(30 * 60_000);
      expect(vai - antes).toBeLessThanOrEqual(MINIMO_DO_VENCIMENTO_NO_MP_MS + 5_000);
      // O formato que o MP pede: ISO com offset, sem 'Z'.
      expect(mp.corpos[0].date_of_expiration).toMatch(/\+00:00$/);
    }
  });

  it('um prazo maior que o mínimo vai como está', async () => {
    const mp = mpDeMentira();
    global.fetch = mp.fetchFalso as any;
    const duasHoras = new Date(Date.now() + 2 * 3600_000);
    await criarPixMP('tk', dados(duasHoras));
    expect(new Date(mp.corpos[0].date_of_expiration).getTime()).toBe(duasHoras.getTime());
  });

  it('vencimentoNoMP: o maior entre o pedido e agora + o mínimo', () => {
    const agora = Date.parse('2026-11-27T15:24:48Z');
    expect(vencimentoNoMP(new Date(agora + 5 * 60_000), agora).getTime()).toBe(agora + MINIMO_DO_VENCIMENTO_NO_MP_MS);
    expect(vencimentoNoMP(new Date(agora + 40 * 60_000), agora).getTime()).toBe(agora + 40 * 60_000);
  });
});
