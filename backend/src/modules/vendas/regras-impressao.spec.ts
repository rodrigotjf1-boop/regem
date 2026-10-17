import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { DeliveryService } from '../delivery/delivery.service';
import { VendasService } from './vendas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ONDE CADA DOCUMENTO SAI (central de impressão, fase 2; mig 327) — contra o Postgres real, como o
// servidor da loja (é ele quem tem a fila das impressoras dela).
//
// Teste do dono na loja (17/10/2026): sem impressora escolhida, a via ia para TODAS as de cupom.
// Decisões do mesmo dia: "1A 2A 3A" e "mais de um local para sair". O cenário é o da loja: 4
// impressoras de cupom (a USB do delivery ligada à estação, a antiga sem estação, a do servidor e a
// de etiquetas) e 2 PDVs.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('regras-impressao.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('onde cada documento sai (regras por documento)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, new FiscalService(db, auditoria), {} as any);
  const beneficio = () => new Proxy({}, { get: () => async () => undefined }) as any;
  const delivery = new DeliveryService(db, vendas, producao, beneficio(), beneficio(), eventos, { flashPedidos: () => undefined } as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const um = async (s: string, p: any[] = []) => (await q(s, p))[0].id as string;
  const edgeAntes = process.env.EDGE_MODE;
  beforeAll(() => {
    process.env.EDGE_MODE = 'true';
  });
  afterAll(async () => {
    if (edgeAntes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeAntes;
    if (empresas.length) {
      for (const t of ['impressao_job', 'comanda_item', 'comanda', 'delivery_config', 'equipamento', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => undefined);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => undefined);
    }
    await pool.end();
  });

  async function loja() {
    const t = await um(`insert into empresa (nome) values ('teste regras de impressão') returning id`);
    empresas.push(t);
    const u = await um(`insert into unidade (tenant_id, nome) values ($1, 'Loja') returning id`, [t]);
    const equip = (tipo: string, nome: string, extra = '', v: any[] = []) =>
      um(
        `insert into equipamento (tenant_id, unidade_id, tipo, nome, token${extra ? ', ' + extra : ''}) values ($1, $2, $3, $4, $5${v.map((_, i) => `, $${i + 6}`).join('')}) returning id`,
        [t, u, tipo, nome, `tok-${randomUUID()}`, ...v],
      );
    const estacao = await equip('estacao_impressao', 'estacao delivery');
    const imp = {
      usbDelivery: await equip('impressora', 'Caixa delivery', 'conexao, dispositivo, faz_cupom, estacao_id', ['local', 'MP-4200 TH', true, estacao]),
      antiga: await equip('impressora', 'Caixa deliv', 'conexao, dispositivo, faz_cupom', ['local', 'EPSON TM', true]),
      servidor: await equip('impressora', 'Caixa Regem', 'conexao, dispositivo, faz_cupom', ['local', 'Bematech', true]),
      etiquetas: await equip('impressora', 'Etiquetas', 'conexao, dispositivo, faz_cupom', ['local', 'Elgin L42', true]),
    };
    const pdv1 = await equip('pdv', 'PDV1', 'impressora_padrao_id', [imp.servidor]);
    const pdvDelivery = await equip('pdv', 'Pdv delivery', 'impressora_padrao_id', [imp.usbDelivery]);
    const comanda = await um(`insert into comanda (tenant_id, unidade_id, status, total, forma) values ($1, $2, 'fechada', 30, 'pix') returning id`, [t, u]);
    await q(`insert into comanda_item (tenant_id, comanda_id, descricao, quantidade, preco_unitario) values ($1, $2, 'X-burger', 1, 30)`, [t, comanda]);
    return { t, u, imp, pdv1, pdvDelivery, comanda };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const regras = (l: Loja, r: any) => delivery.setConfig(l.t, null, { impressaoRegras: r });
  const saiu = async (comanda: string) =>
    (await q(`select e.nome, j.vias from impressao_job j join equipamento e on e.id = j.equipamento_id where j.comanda_id = $1 order by e.nome`, [comanda]))
      .map((j: any) => (j.vias ? `${j.nome} ×${j.vias}` : j.nome));
  const limpar = (l: Loja) => q(`delete from impressao_job where tenant_id = $1`, [l.t]);

  it('sem regra, a via do delivery sai em todas as de cupom, como hoje (decisão 1A)', async () => {
    const l = await loja();
    await vendas.materializarCupomCaixa(l.t, l.comanda, null, 'delivery');
    expect(await saiu(l.comanda)).toEqual(['Caixa Regem', 'Caixa deliv', 'Caixa delivery', 'Etiquetas'].sort((a, b) => a.localeCompare(b)));
  });

  it('com a regra, a via do delivery sai SÓ nas escolhidas — mais de um lugar, com as vias de cada um', async () => {
    const l = await loja();
    await regras(l, { delivery: { impressoras: [{ id: l.imp.usbDelivery, vias: 2 }, { id: l.imp.servidor, vias: 1 }] } });
    const r: any = await vendas.materializarCupomCaixa(l.t, l.comanda, null, 'delivery');
    expect(r.enfileirados).toBe(2);
    expect(await saiu(l.comanda)).toEqual(['Caixa delivery ×2', 'Caixa Regem ×1']);
  });

  it('pedido do iFood aceito (canal externo) usa a regra; o do totem fica como sempre', async () => {
    const l = await loja();
    await regras(l, { delivery: { impressoras: [{ id: l.imp.usbDelivery, vias: 1 }] } });
    await (delivery as any).imprimirCupomCaixaExterno(l.t, { id: randomUUID(), canal: 'ifood', tipo: 'retirada', unidadeId: l.u, comandaId: l.comanda });
    expect(await saiu(l.comanda)).toEqual(['Caixa delivery ×1']);
    await limpar(l);
    await (delivery as any).imprimirCupomCaixaExterno(l.t, { id: randomUUID(), canal: 'totem', tipo: 'retirada', unidadeId: l.u, comandaId: l.comanda });
    expect((await saiu(l.comanda)).length).toBe(4); // sem regra para o totem: todas as de cupom
  });

  it('balcão: a impressora do PDV que vendeu, e também a lista (vias somadas na mesma impressora)', async () => {
    const l = await loja();
    await regras(l, { balcao: { pdv: true, pdvVias: 1, impressoras: [{ id: l.imp.usbDelivery, vias: 1 }] } });
    await producao.enfileirarViaCliente(l.t, l.u, l.comanda, 'venda', l.pdv1, null, 'cliente', null, { documento: 'balcao' });
    expect(await saiu(l.comanda)).toEqual(['Caixa delivery ×1', 'Caixa Regem ×1']);
    await limpar(l);
    await producao.enfileirarViaCliente(l.t, l.u, l.comanda, 'venda', l.pdvDelivery, null, 'cliente', null, { documento: 'balcao' });
    expect(await saiu(l.comanda)).toEqual(['Caixa delivery ×2']); // o PDV do delivery já é a USB
  });

  it('mesa: a "impressora do PDV" é a do caixa que fechou a conta (terminalDoPdv)', async () => {
    const l = await loja();
    await regras(l, { balcao: { pdv: true } });
    await producao.enfileirarViaCliente(l.t, l.u, l.comanda, 'conta', null, null, 'cliente', null, { documento: 'balcao', terminalDoPdv: l.pdv1 });
    expect(await saiu(l.comanda)).toEqual(['Caixa Regem ×1']);
  });

  it('comanda do entregador: nas mesmas do delivery (2A) ou na sua lista', async () => {
    const l = await loja();
    await regras(l, { delivery: { impressoras: [{ id: l.imp.usbDelivery, vias: 1 }] } });
    await producao.enfileirarViaCliente(l.t, l.u, l.comanda, 'entregador', null, null, 'cliente', null, { documento: 'entregador' });
    expect(await saiu(l.comanda)).toEqual(['Caixa delivery ×1']);
    await limpar(l);
    await regras(l, { entregador: { mesmasDoDelivery: false, impressoras: [{ id: l.imp.servidor, vias: 2 }] } });
    await producao.enfileirarViaCliente(l.t, l.u, l.comanda, 'entregador', null, null, 'cliente', null, { documento: 'entregador' });
    expect(await saiu(l.comanda)).toEqual(['Caixa Regem ×2']);
  });

  it('impressora que saiu de uso depois de escolhida fica de fora; se não sobra nenhuma, o caminho de sempre', async () => {
    const l = await loja();
    await regras(l, { delivery: { impressoras: [{ id: l.imp.usbDelivery, vias: 1 }, { id: l.imp.servidor, vias: 1 }] } });
    await q(`update equipamento set ativo = false where id = $1`, [l.imp.servidor]);
    await vendas.materializarCupomCaixa(l.t, l.comanda, null, 'delivery');
    expect(await saiu(l.comanda)).toEqual(['Caixa delivery ×1']);
    await limpar(l);
    await q(`update equipamento set ativo = false where id = $1`, [l.imp.usbDelivery]);
    await vendas.materializarCupomCaixa(l.t, l.comanda, null, 'delivery');
    expect(await saiu(l.comanda)).toEqual(['Caixa deliv', 'Etiquetas']); // as de cupom que sobraram
  });

  it('a reimpressão não usa a regra: sai num lugar só (ERR-247)', async () => {
    const l = await loja();
    await regras(l, { delivery: { impressoras: [{ id: l.imp.usbDelivery, vias: 1 }, { id: l.imp.servidor, vias: 1 }] } });
    const r: any = await vendas.reimprimirViasExterno(l.t, randomUUID(), l.comanda, null, null, l.pdvDelivery);
    expect(r.impressoras).toEqual(['Caixa delivery']);
  });

  it('salvar: confere as impressoras; ausente mantém; null volta a "sem regra"; a da loja vence a da rede', async () => {
    const l = await loja();
    const outra = await loja();
    await expect(regras(l, { delivery: { impressoras: [{ id: outra.imp.servidor }] } })).rejects.toThrow('Impressora não encontrada');
    await expect(regras(l, { delivery: { impressoras: [{ id: l.pdv1 }] } })).rejects.toThrow('Impressora não encontrada');
    await expect(regras(l, { delivery: { impressoras: [{ id: 'xyz' }] } })).rejects.toThrow('Impressora inválida');
    await q(`update equipamento set ativo = false where id = $1`, [l.imp.antiga]);
    await expect(regras(l, { delivery: { impressoras: [{ id: l.imp.antiga }] } })).rejects.toThrow('A impressora "Caixa deliv" está fora de uso');
    await expect(delivery.setConfig(l.t, null, { impressaoRegras: [] })).rejects.toThrow('Regras de impressão inválidas');

    await regras(l, { delivery: { impressoras: [{ id: l.imp.usbDelivery, vias: 7 }] }, balcao: { pdv: true } });
    await delivery.setConfig(l.t, null, { finalizadoHoras: 6 }); // sem o campo: mantém
    let cfg: any = await delivery.getConfig(l.t, null);
    expect(cfg.impressaoRegras.delivery.impressoras).toEqual([{ id: l.imp.usbDelivery, vias: 5 }]);
    expect(cfg.impressaoRegras.balcao).toEqual({ pdv: true, pdvVias: 1, impressoras: [] });
    await regras(l, { delivery: null }); // volta a "sem regra"; o balcão continua
    cfg = await delivery.getConfig(l.t, null);
    expect(cfg.impressaoRegras.delivery).toBeUndefined();
    expect(cfg.impressaoRegras.balcao).toBeTruthy();

    // A da loja vence a da rede.
    await regras(l, { delivery: { impressoras: [{ id: l.imp.servidor }] } }); // rede
    await delivery.setConfig(l.t, l.u, { impressaoRegras: { delivery: { impressoras: [{ id: l.imp.usbDelivery }] } } }); // loja
    await vendas.materializarCupomCaixa(l.t, l.comanda, null, 'delivery');
    expect(await saiu(l.comanda)).toEqual(['Caixa delivery ×1']);
  });
});
