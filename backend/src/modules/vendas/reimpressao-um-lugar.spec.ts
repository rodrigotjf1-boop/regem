import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from './vendas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A REIMPRESSÃO SAI NUM LUGAR SÓ (ERR-247) — contra o Postgres real (TEST_PG_URL).
//
// O dono (17/10/2026), na loja: "quando eu imprimia lá [no PC do delivery] uma reimpressão, saía na
// impressora USB e também saía uma via lá no servidor. O ideal é a reimpressão sair só onde está
// configurado". A reimpressão não dizia de que PC vinha: sem impressora escolhida, caía na regra
// "todas as de cupom" — e a loja tem 4 marcadas (a USB do delivery, ligada à estação, e 3 que o
// servidor imprime, inclusive a de etiquetas). O cenário abaixo é o dela.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('reimpressao-um-lugar.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('reimpressão: num lugar só', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, new FiscalService(db, auditoria), {} as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const um = async (s: string, p: any[] = []) => (await q(s, p))[0].id as string;
  // A reimpressão da loja roda no SERVIDOR DA LOJA (é ele quem tem a fila das impressoras dela).
  const edgeAntes = process.env.EDGE_MODE;
  beforeAll(() => {
    process.env.EDGE_MODE = 'true';
  });

  afterAll(async () => {
    if (edgeAntes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeAntes;
    if (empresas.length) {
      await pool.query(`delete from comanda_item_complemento where comanda_item_id in (select id from comanda_item where tenant_id = any($1::uuid[]))`, [empresas]).catch(() => undefined);
      for (const t of ['impressao_job', 'comanda_item', 'comanda', 'equipamento', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => undefined);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => undefined);
    }
    await pool.end();
  });

  async function loja() {
    const t = await um(`insert into empresa (nome) values ('teste reimpressão') returning id`);
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
      antiga: await equip('impressora', 'Caixa deliv', 'conexao, dispositivo, faz_cupom, faz_producao', ['local', 'EPSON TM', true, true]),
      servidor: await equip('impressora', 'Caixa Regem', 'conexao, dispositivo, faz_cupom', ['local', 'Bematech', true]),
      etiquetas: await equip('impressora', 'Etiquetas', 'conexao, dispositivo, faz_cupom', ['local', 'Elgin L42', true]),
    };
    const pdvDelivery = await equip('pdv', 'Pdv delivery', 'impressora_padrao_id', [imp.usbDelivery]);
    const pdvSemImpressora = await equip('pdv', 'PDV sem impressora');
    // Uma venda com adicional e observação.
    const comanda = await um(`insert into comanda (tenant_id, unidade_id, status, total, forma) values ($1, $2, 'fechada', 30, 'pix') returning id`, [t, u]);
    const item = await um(
      `insert into comanda_item (tenant_id, comanda_id, descricao, quantidade, preco_unitario, observacao) values ($1, $2, 'X-burger', 1, 30, 'sem cebola') returning id`,
      [t, comanda],
    );
    await q(`insert into comanda_item_complemento (tenant_id, comanda_item_id, tipo, nome, preco_delta) values ($1, $2, 'adicionar', 'Bacon', 4), ($1, $2, 'adicionar', 'Bacon', 4)`, [t, item]);
    return { t, u, imp, pdvDelivery, pdvSemImpressora, comanda };
  }
  const jobs = async (comanda: string) =>
    q(`select e.nome, j.conteudo, j.status from impressao_job j join equipamento e on e.id = j.equipamento_id where j.comanda_id = $1 order by j.criado_em, e.nome`, [comanda]);

  it('pedida no PC do delivery (terminal pareado): sai SÓ na USB dele — antes saía nas 4 de cupom', async () => {
    const l = await loja();
    const r: any = await vendas.reimprimirViasExterno(l.t, randomUUID(), l.comanda, null, null, l.pdvDelivery);
    expect(r.enfileirados).toBe(1);
    expect(r.impressoras).toEqual(['Caixa delivery']);
    expect(r.aviso).toBeNull();
    expect((await jobs(l.comanda)).map((j: any) => j.nome)).toEqual(['Caixa delivery']);
  });

  it('a via reimpressa leva os adicionais e a observação, como a 1ª (antes saía sem)', async () => {
    const l = await loja();
    await vendas.reimprimirViasExterno(l.t, randomUUID(), l.comanda, null, null, l.pdvDelivery);
    const [j] = await jobs(l.comanda);
    expect(j.conteudo).toContain('X-burger');
    expect(j.conteudo).toMatch(/2x Bacon/);
    expect(j.conteudo).toMatch(/sem cebola/);
  });

  it('sem terminal: sai onde a via desta venda saiu antes — a IMPRESSA, não a que deu erro', async () => {
    const l = await loja();
    await q(`insert into impressao_job (tenant_id, unidade_id, equipamento_id, comanda_id, via, conteudo, status, criado_em) values
      ($1, $2, $3, $4, 'cliente', 'via 1', 'impresso', now() - interval '10 minutes'),
      ($1, $2, $5, $4, 'cliente', 'via 1', 'erro', now() - interval '9 minutes')`, [l.t, l.u, l.imp.servidor, l.comanda, l.imp.etiquetas]);
    const r: any = await vendas.reimprimirViasExterno(l.t, randomUUID(), l.comanda, null, null, null);
    expect(r.impressoras).toEqual(['Caixa Regem']);
    expect((await q(`select count(*)::int as n from impressao_job where comanda_id = $1 and conteudo <> 'via 1'`, [l.comanda]))[0].n).toBe(1);
  });

  it('a impressora escolhida manda; terminal sem impressora cai em onde saiu antes', async () => {
    const l = await loja();
    const escolhida: any = await vendas.reimprimirViasExterno(l.t, randomUUID(), l.comanda, l.imp.servidor, null, l.pdvDelivery);
    expect(escolhida.impressoras).toEqual(['Caixa Regem']);
    const semImpressora: any = await vendas.reimprimirViasExterno(l.t, randomUUID(), l.comanda, null, null, l.pdvSemImpressora);
    expect(semImpressora.impressoras).toEqual(['Caixa Regem']); // a última enviada (nenhuma impressa ainda)
  });

  it('venda que nunca imprimiu e PC que não é terminal: UMA só (pelo nome), e o aviso diz qual e como acertar', async () => {
    const l = await loja();
    const r: any = await vendas.reimprimirViasExterno(l.t, randomUUID(), l.comanda, null, null, null);
    expect(r.enfileirados).toBe(1);
    expect(r.impressoras).toEqual(['Caixa deliv']);
    expect(r.aviso).toMatch(/^Reimpressão enviada só para a Caixa deliv\. Para sair na impressora deste PC, pareie o PC como terminal de PDV/);
  });

  it('a venda (não é reimpressão) continua como sempre: com o terminal, a impressora dele; sem, todas as de cupom', async () => {
    const l = await loja();
    const comTerminal = await producao.enfileirarViaCliente(l.t, l.u, l.comanda, 'venda', l.pdvDelivery);
    expect(comTerminal.impressoras).toEqual(['Caixa delivery']);
    const semTerminal = await producao.enfileirarViaCliente(l.t, l.u, l.comanda, 'venda', null);
    expect([...semTerminal.impressoras].sort()).toEqual(['Caixa Regem', 'Caixa deliv', 'Caixa delivery', 'Etiquetas'].sort());
  });

  it('terminal de OUTRA empresa não serve de atalho', async () => {
    const a = await loja();
    const b = await loja();
    const r: any = await vendas.reimprimirViasExterno(a.t, randomUUID(), a.comanda, null, null, b.pdvDelivery);
    expect(r.impressoras).not.toContain('Caixa delivery'); // a USB da outra loja não é desta
    expect(r.enfileirados).toBe(1);
  });
});
