import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CardapioService } from './cardapio.service';
import { DeliveryService } from '../delivery/delivery.service';
import { cifrar, decifrar } from '../../common/cifra-segredo';
import { __esquecerTokensRede } from '../../common/erede';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PIX PELA REDE (e.Rede) NO CARDÁPIO ONLINE, no Postgres de verdade, com uma Rede falsa que responde como o
// sandbox respondeu em 05/11/2026 (pendente = `qrCodeResponse`/Pending; pago = `authorization`/Approved; mesma
// referência = 422 código 42). O que se prova, do salvar da tela até o pedido pago:
//  • a chave é guardada CIFRADA; PV inválido ou ligar sem chave é recusado sem gravar nada;
//  • gerar o PIX grava tid e provedor; gerar de novo devolve o MESMO QR (nunca um 2º PIX);
//  • chave guardada que não abre recusa a cobrança — nunca cai no "sem gateway", que aprovaria sem cobrar;
//  • "Verificar pagamento", a conferência de minuto (com a V84: pendente antigo não tranca) e o prazo de 10 min
//    (pago no último minuto entra; QR valendo espera; Rede fora do ar espera até 1 h);
//  • devolução do sinal pela Rede.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pix-rede-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

type PixFalso = { tid: string; reference: string; amount: number; status: 'Pending' | 'Approved'; expira: string };

descrever('PIX pela Rede no cardápio online (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const cancelados: string[] = [];
  const deliveryFalso = {
    aceitar: async () => undefined,
    cancelarSistema: async (_t: string, id: string) => {
      cancelados.push(id);
      await pool.query(`update pedido_externo set status = 'cancelado' where id = $1`, [id]);
    },
  } as any;
  const u = {} as any;
  const cardapio = new CardapioService(db, u, deliveryFalso, u, u, u, u, u);
  const delivery = new DeliveryService(db, u, u, u, u, u, { flashPedidos: () => {} } as any);
  const empresas: string[] = [];
  const chaveAntes = process.env.SEGREDOS_CHAVE;
  const fetchAntes = global.fetch;
  const loteAntes = CardapioService.LOTE_PIX_REDE;

  // ===== a Rede falsa =====
  const pixs = new Map<string, PixFalso>();
  const tidsQueFalham = new Set<string>();
  const devolucoes: { tid: string; amount: number }[] = [];
  let seq = 4001261105;
  const resp = (status: number, corpo: any) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
  const consulta = (p: PixFalso) =>
    p.status === 'Pending'
      ? { qrCodeResponse: { returnCode: '00', kind: 'Pix', reference: p.reference, amount: p.amount, tid: p.tid, status: 'Pending', expirationQrCode: p.expira, qrCodeData: `EMV-${p.tid}`, qrCodeImage: `IMG-${p.tid}` } }
      : { authorization: { returnCode: '00', kind: 'Pix', reference: p.reference, amount: p.amount, tid: p.tid, status: 'Approved' }, capture: { amount: p.amount } };

  beforeAll(() => {
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    global.fetch = (async (url: any, init: any) => {
      const u = new URL(String(url));
      const metodo = init?.method ?? 'GET';
      if (u.pathname.endsWith('/oauth2/token')) return resp(200, { access_token: 'tk', expires_in: 1439 });
      const m = u.pathname.match(/\/v2\/transactions(?:\/(\d+))?(\/refunds)?$/);
      if (!m) throw new Error(`fetch inesperado: ${url}`);
      const [, tid, refunds] = m;
      if (tid && tidsQueFalham.has(tid)) throw new TypeError('fetch failed');
      if (metodo === 'POST' && !tid) {
        const b = JSON.parse(init.body);
        if ([...pixs.values()].some((p) => p.reference === b.reference)) return resp(422, { returnCode: '42', returnMessage: 'Reference: Order number already exists.' });
        const p: PixFalso = { tid: String(++seq), reference: b.reference, amount: b.amount, status: 'Pending', expira: `${b.qrCode.dateTimeExpiration}-03:00` };
        pixs.set(p.tid, p);
        return resp(200, { tid: p.tid, reference: p.reference, amount: p.amount, qrCodeResponse: { qrCodeData: `EMV-${p.tid}`, qrCodeImage: `IMG-${p.tid}` }, returnCode: '00', returnMessage: 'Success.' });
      }
      if (metodo === 'GET' && !tid) {
        const p = [...pixs.values()].find((x) => x.reference === u.searchParams.get('reference'));
        return p ? resp(200, consulta(p)) : resp(404, { returnCode: '78' });
      }
      const p = pixs.get(String(tid));
      if (!p) return resp(404, { returnCode: '78', returnMessage: 'Transaction not found.' });
      if (refunds) {
        devolucoes.push({ tid: p.tid, amount: JSON.parse(init.body).amount });
        return resp(200, { refundId: randomUUID(), tid: p.tid, returnCode: '359', returnMessage: 'Refund successful.' });
      }
      return resp(200, consulta(p));
    }) as any;
  });
  beforeEach(() => {
    __esquecerTokensRede();
    tidsQueFalham.clear();
    cancelados.length = 0;
    devolucoes.length = 0;
    CardapioService.LOTE_PIX_REDE = loteAntes;
  });
  afterAll(async () => {
    global.fetch = fetchAntes;
    if (chaveAntes === undefined) delete process.env.SEGREDOS_CHAVE;
    else process.env.SEGREDOS_CHAVE = chaveAntes;
    CardapioService.LOTE_PIX_REDE = loteAntes;
    if (empresas.length) {
      for (const t of ['pedido_externo', 'integracao', 'cardapio_config'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  /** Empresa com o cardápio no ar (aceite manual, para a aprovação não depender da produção). */
  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste pix rede') returning id`))[0].id as string;
    empresas.push(t);
    const token = `tk-${randomUUID()}`;
    await q(`insert into cardapio_config (tenant_id, token, ativo, auto_kds) values ($1, $2, true, false)`, [t, token]);
    return { t, token };
  }
  const integracaoRede = (t: string, guardada: string, ativo = true) =>
    q(`insert into integracao (tenant_id, canal, ativo, client_id, client_secret) values ($1, 'rede', $2, '12345678', $3)`, [t, ativo, guardada]);
  const pedido = async (t: string, extra: Record<string, unknown> = {}) => {
    const cols = ['tenant_id', 'canal', 'tipo', 'itens', 'total', 'status', ...Object.keys(extra)];
    const vals = [t, 'cardapio', 'retirada', '[]', 25, 'novo', ...Object.values(extra)];
    const r = await q(`insert into pedido_externo (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) returning id`, vals);
    return r[0].id as string;
  };
  const ler = async (id: string) => (await q(`select status, pago, status_pagamento, gateway_provider, gateway_payment_id, sinal_status from pedido_externo where id = $1`, [id]))[0];
  /** Um PIX da Rede já gerado para o pedido (sem passar pela tela). */
  const pixGerado = (pedidoId: string, status: PixFalso['status'], expira: Date) => {
    const p: PixFalso = { tid: String(++seq), reference: `pedido-${pedidoId}`, amount: 2500, status, expira: expira.toISOString() };
    pixs.set(p.tid, p);
    return p.tid;
  };
  const aguardandoRede = (t: string, tid: string, minutosAtras: number) =>
    pedido(t, { status_pagamento: 'aguardando', gateway_provider: 'rede', gateway_payment_id: tid, criado_em: new Date(Date.now() - minutosAtras * 60_000) });

  describe('salvar na tela de Integrações', () => {
    it('guarda a chave CIFRADA e o PV; recusa PV com letra e ligar sem chave — sem gravar nada', async () => {
      const { t } = await loja();
      await expect(delivery.salvarIntegracao(t, { canal: 'rede', ativo: true, clientId: '93A66769', clientSecret: 'chave-real' })).rejects.toThrow('só com números');
      await expect(delivery.salvarIntegracao(t, { canal: 'rede', ativo: true, clientId: '12345678' })).rejects.toThrow('informe o PV e a chave');
      await expect(delivery.salvarIntegracao(t, { canal: 'rede', ativo: 'talvez', clientId: '12345678', clientSecret: 'x' })).rejects.toThrow('"ativo"');
      expect(await q(`select 1 from integracao where tenant_id = $1`, [t])).toHaveLength(0);

      await delivery.salvarIntegracao(t, { canal: 'rede', ativo: true, clientId: '12.345.678', clientSecret: '  chave-real  ' });
      const [row] = await q(`select client_id, client_secret, token, ativo from integracao where tenant_id = $1 and canal = 'rede'`, [t]);
      expect(row.client_id).toBe('12345678');
      expect(row.client_secret).not.toContain('chave-real');
      expect(decifrar(row.client_secret)).toBe('chave-real');
      expect(row.ativo).toBe(true);

      // Salvar de novo sem a chave (campo em branco) mantém a guardada; desligar não pede chave.
      await delivery.salvarIntegracao(t, { canal: 'rede', ativo: false, clientId: '', clientSecret: '' });
      const [depois] = await q(`select client_id, client_secret, ativo from integracao where tenant_id = $1 and canal = 'rede'`, [t]);
      expect(depois).toEqual({ client_id: '12345678', client_secret: row.client_secret, ativo: false });
    });

    it('a lista mostra a Rede com o PV e "chave salva", nunca a chave', async () => {
      const { t } = await loja();
      await delivery.salvarIntegracao(t, { canal: 'rede', ativo: true, clientId: '12345678', clientSecret: 'chave-real' });
      const rede = (await delivery.listarIntegracoes(t)).find((i: any) => i.canal === 'rede');
      expect(rede).toMatchObject({ canal: 'rede', ativo: true, clientId: '12345678', temSecret: true, temToken: false });
      expect(JSON.stringify(rede)).not.toContain('chave-real');
    });

    it('"Testar conexão" usa a chave salva quando o campo está vazio', async () => {
      const { t } = await loja();
      await delivery.salvarIntegracao(t, { canal: 'rede', ativo: true, clientId: '12345678', clientSecret: 'chave-real' });
      expect(await delivery.testarGatewayPix(t, 'rede')).toEqual({ ok: true, conta: 'PV 12345678' });
    });

    it('PIX primário: aceita a Rede e recusa o desconhecido (ERR-042)', async () => {
      const { t } = await loja();
      expect(await delivery.setPixPrioritario(t, 'rede')).toEqual({ gateway: 'rede' });
      expect(await delivery.getPixPrioritario(t)).toEqual({ gateway: 'rede' });
      await expect(delivery.setPixPrioritario(t, 'itau')).rejects.toThrow('mercadopago, pagseguro ou rede');
      expect(await delivery.getPixPrioritario(t)).toEqual({ gateway: 'rede' });
    });
  });

  describe('cobrar', () => {
    it('gera o PIX pela Rede, grava tid e provedor; gerar de novo devolve o MESMO QR (nunca um 2º PIX)', async () => {
      const { t, token } = await loja();
      await integracaoRede(t, cifrar('chave-real'));
      const id = await pedido(t);
      const r1: any = await cardapio.pagarPedidoPublico(token, id);
      expect(r1).toMatchObject({ ok: true, statusPagamento: 'aguardando', gateway: 'rede' });
      const tid = r1.pix.qrCode.replace('EMV-', '');
      expect(r1.pix).toEqual({ qrCode: `EMV-${tid}`, qrCodeBase64: `IMG-${tid}`, ticketUrl: null });
      expect(await ler(id)).toMatchObject({ gateway_provider: 'rede', gateway_payment_id: tid, status_pagamento: 'aguardando', pago: false });
      expect(pixs.get(tid)?.reference).toBe(`pedido-${id}`);

      const r2: any = await cardapio.pagarPedidoPublico(token, id); // página recarregada
      expect(r2.pix.qrCode).toBe(`EMV-${tid}`);
      expect([...pixs.values()].filter((p) => p.reference === `pedido-${id}`)).toHaveLength(1);
    });

    it('chave guardada que não abre: recusa a cobrança — o pedido NÃO é aprovado sem pagar', async () => {
      const { t, token } = await loja();
      await integracaoRede(t, 'v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      const id = await pedido(t);
      await expect(cardapio.pagarPedidoPublico(token, id)).rejects.toThrow('Pagamento indisponível');
      expect(await ler(id)).toMatchObject({ pago: false, status_pagamento: 'na_entrega' });
    });

    it('integração desligada: a Rede não entra na lista de gateways', async () => {
      const { t, token } = await loja();
      await integracaoRede(t, cifrar('chave-real'), false);
      const id = await pedido(t);
      const antes = pixs.size;
      await cardapio.pagarPedidoPublico(token, id).catch(() => null);
      expect(pixs.size).toBe(antes);
    });
  });

  describe('confirmar o pagamento', () => {
    it('"Verificar pagamento": pago na Rede → pedido pago', async () => {
      const { t, token } = await loja();
      await integracaoRede(t, cifrar('chave-real'));
      const id = await pedido(t);
      const r: any = await cardapio.pagarPedidoPublico(token, id);
      const tid = r.pix.qrCode.replace('EMV-', '');
      expect(await cardapio.verificarPagamentoPublico(token, id)).toMatchObject({ pago: false, statusPagamento: 'aguardando' });
      pixs.get(tid)!.status = 'Approved';
      expect(await cardapio.verificarPagamentoPublico(token, id)).toMatchObject({ pago: true, statusPagamento: 'aprovado' });
      expect(await ler(id)).toMatchObject({ pago: true, status_pagamento: 'aprovado' });
    });

    it('conferência de minuto: aprova o pago, deixa o pendente — e N+10 pendentes mais antigos não trancam o novo (V84)', async () => {
      const { t } = await loja();
      await integracaoRede(t, cifrar('chave-real'));
      CardapioService.LOTE_PIX_REDE = 3;
      const pendentes: string[] = [];
      for (let i = 0; i < 13; i++) {
        const tidP = pixGerado(randomUUID(), 'Pending', new Date(Date.now() + 5 * 60_000));
        pendentes.push(await aguardandoRede(t, tidP, 10 - i * 0.5)); // de 10 a 4 min atrás
      }
      const tidPago = pixGerado(randomUUID(), 'Approved', new Date(Date.now() + 5 * 60_000));
      const pago = await aguardandoRede(t, tidPago, 0); // o mais novo (mais novo também que os de outros testes)
      await cardapio.conferirPixRede();
      expect(await ler(pago)).toMatchObject({ pago: true, status_pagamento: 'aprovado' });
      for (const id of pendentes) expect(await ler(id)).toMatchObject({ pago: false, status_pagamento: 'aguardando', status: 'novo' });
    });

    it('prazo de 10 min: pago no último minuto ENTRA; QR ainda valendo espera; vencido cancela', async () => {
      const { t } = await loja();
      await integracaoRede(t, cifrar('chave-real'));
      const pagoNoFim = await aguardandoRede(t, pixGerado(randomUUID(), 'Approved', new Date(Date.now() - 60_000)), 11);
      const qrValendo = await aguardandoRede(t, pixGerado(randomUUID(), 'Pending', new Date(Date.now() + 3 * 60_000)), 11);
      const vencido = await aguardandoRede(t, pixGerado(randomUUID(), 'Pending', new Date(Date.now() - 5 * 60_000)), 16);
      await cardapio.expirarPixNaoPagos();
      expect(await ler(pagoNoFim)).toMatchObject({ pago: true, status_pagamento: 'aprovado', status: 'novo' });
      expect(cancelados).not.toContain(pagoNoFim);
      expect(cancelados).not.toContain(qrValendo);
      expect(await ler(qrValendo)).toMatchObject({ status: 'novo', status_pagamento: 'aguardando' });
      expect(cancelados).toContain(vencido);
    });

    it('prazo com a Rede fora do ar: espera; passada 1 h do pedido, cancela', async () => {
      const { t } = await loja();
      await integracaoRede(t, cifrar('chave-real'));
      const tid1 = pixGerado(randomUUID(), 'Pending', new Date(Date.now() - 60_000));
      const tid2 = pixGerado(randomUUID(), 'Pending', new Date(Date.now() - 60_000));
      tidsQueFalham.add(tid1);
      tidsQueFalham.add(tid2);
      const recente = await aguardandoRede(t, tid1, 12);
      const antigo = await aguardandoRede(t, tid2, 61);
      await cardapio.expirarPixNaoPagos();
      expect(cancelados).not.toContain(recente);
      expect(cancelados).toContain(antigo);
    });
  });

  it('devolução do sinal pela Rede: devolve o valor do sinal e marca reembolsado', async () => {
    const { t } = await loja();
    await integracaoRede(t, cifrar('chave-real'));
    const tid = pixGerado(randomUUID(), 'Approved', new Date());
    const id = await pedido(t, { sinal_status: 'pago', sinal_valor: 10, gateway_provider: 'rede', gateway_payment_id: tid, pago: false });
    expect(await cardapio.reembolsarSinal(t, id)).toEqual({ ok: true });
    expect(devolucoes).toEqual([{ tid, amount: 1000 }]);
    expect((await ler(id)).sinal_status).toBe('reembolsado');
  });
});
