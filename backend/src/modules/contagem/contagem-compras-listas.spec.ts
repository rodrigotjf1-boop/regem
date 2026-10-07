import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { hojeISO, somarDias } from '../../common/data';
import { periodoDaConsulta } from '../../common/periodo';
import { ComprasService } from '../compras/compras.service';
import { ContagemService } from './contagem.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONTAGEM e COMPRAS — o que as abas novas do Estoque pedem ao servidor, contra Postgres
// (TEST_PG_URL): a lista de contagem com responsável e produtos, a EDIÇÃO da lista, o histórico
// das contagens; e a lista de compras com valor estimado e corte por período.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
jest.setTimeout(60_000);

descrever('contagem e compras: listas das abas do Estoque (Postgres real)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let db: any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const eventos = { emit: jest.fn() };
  const contagem = () => new (ContagemService as any)(db, eventos, auditoria) as ContagemService;
  const compras = () => new (ComprasService as any)(db, eventos, auditoria) as ComprasService;
  const hoje = hojeISO();
  const ha = (dias: number) => somarDias(hoje, -dias);

  async function empresa() {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `Contagem teste ${id.slice(0, 6)}`]);
    empresas.push(id);
    return id;
  }
  const pessoa = async (t: string, nome: string) =>
    (await q(`insert into colaborador (tenant_id, nome) values ($1, $2) returning id`, [t, nome]))[0].id as string;
  const produto = async (t: string, nome: string) =>
    (await q(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, $2, 'kg') returning id`, [t, nome]))[0].id as string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    for (const id of empresas) {
      for (const tabela of [
        'movimento_estoque', 'contagem_item', 'contagem_execucao', 'contagem_lista_item', 'contagem_lista',
        'compra_item', 'compra_lista', 'item_estoque', 'fornecedor', 'colaborador',
      ]) {
        await q(`delete from ${tabela} where tenant_id = $1`, [id]);
      }
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool.end();
  });

  // ── contagem ───────────────────────────────────────────────────────────────────────────
  it('contagem: a lista traz o responsável e os produtos; editar troca tudo e não deixa dia de outra recorrência', async () => {
    const t = await empresa();
    const outra = await empresa();
    const [ana, caio] = [await pessoa(t, 'Ana de teste'), await pessoa(t, 'Caio de teste')];
    const [a, b, c] = [await produto(t, 'Arroz de teste'), await produto(t, 'Feijão de teste'), await produto(t, 'Sal de teste')];
    const alheio = await produto(outra, 'Produto alheio');
    const s = contagem();

    const criada: any = await s.createLista(t, { nome: 'Geral de teste', recorrencia: 'semanal', diaSemana: 1, hora: '08:00', delegadoId: ana, itemIds: [a, b] } as any);
    let [l]: any[] = await s.listListas(t);
    expect(l).toMatchObject({ nome: 'Geral de teste', itens: 2, delegadoNome: 'Ana de teste', recorrencia: 'semanal', diaSemana: 1 });
    expect([...l.itemIds].sort()).toEqual([a, b].sort());

    const editada: any = await s.updateLista(t, criada.id, {
      nome: 'Mensal de teste', recorrencia: 'mensal', diaSemana: 3, diaMes: 5, hora: '07:30', delegadoId: caio, enviarKds: false, itemIds: [b, c, alheio],
    } as any);
    expect(editada).toMatchObject({ nome: 'Mensal de teste', itens: 2 }); // o produto de outra empresa não entra
    [l] = await s.listListas(t);
    expect(l).toMatchObject({ nome: 'Mensal de teste', recorrencia: 'mensal', diaMes: 5, diaSemana: null, delegadoNome: 'Caio de teste', enviarKds: false, enviarDashboard: true, itens: 2 });
    expect(String(l.hora).slice(0, 5)).toBe('07:30');
    expect([...l.itemIds].sort()).toEqual([b, c].sort());

    // sem responsável e avulsa: limpa responsável e os dois dias
    await s.updateLista(t, criada.id, { nome: 'Avulsa de teste', recorrencia: 'avulsa', diaMes: 9, itemIds: [a] } as any);
    [l] = await s.listListas(t);
    expect(l).toMatchObject({ recorrencia: 'avulsa', diaMes: null, diaSemana: null, delegadoNome: null, hora: null, itens: 1 });

    await expect(s.updateLista(t, criada.id, { nome: 'Sem produto', itemIds: [alheio] } as any)).rejects.toThrow(BadRequestException);
    await expect(s.updateLista(outra, criada.id, { nome: 'Invasão', itemIds: [alheio] } as any)).rejects.toThrow(NotFoundException);
    await s.removerLista(t, criada.id);
    await expect(s.updateLista(t, criada.id, { nome: 'Já excluída', itemIds: [a] } as any)).rejects.toThrow(NotFoundException);
    expect(await s.listListas(t)).toEqual([]);
  });

  it('contagem: o histórico mostra cada contagem feita, quem abriu, quantos contou e quantos deram diferença', async () => {
    const t = await empresa();
    const ana = await pessoa(t, 'Ana de teste');
    const [a, b, c] = [await produto(t, 'Arroz de teste'), await produto(t, 'Feijão de teste'), await produto(t, 'Sal de teste')];
    await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade) values ($1, $2, 'entrada', 10), ($1, $3, 'entrada', 4)`, [t, a, b]);
    const s = contagem();
    const lista: any = await s.createLista(t, { nome: 'Histórico de teste', recorrencia: 'avulsa', itemIds: [a, b, c] } as any);
    expect(await s.historico(t, lista.id)).toEqual([]);

    const exec: any = await s.iniciarExecucao(t, lista.id, ana);
    await s.salvarContagem(t, exec.id, ana, { itens: [{ itemId: a, contado: 10 }, { itemId: b, contado: 3 }], aplicarAjuste: true } as any);
    const h: any[] = await s.historico(t, lista.id);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ id: exec.id, status: 'concluida', quemNome: 'Ana de teste', itens: 3, contados: 2, comDiferenca: 1 });
    expect(String(h[0].data).slice(0, 10)).toBe(hoje);
    // outra empresa não lê o histórico alheio
    await expect(s.historico(await empresa(), lista.id)).rejects.toThrow(NotFoundException);
  });

  // ── compras ────────────────────────────────────────────────────────────────────────────
  it('compras: a lista traz itens, valor estimado e quantos estão sem custo — o valor só para quem vê R$', async () => {
    const t = await empresa();
    const [forn] = await q(`insert into fornecedor (tenant_id, nome) values ($1, 'Atacado de teste') returning id`, [t]);
    const ana = await pessoa(t, 'Ana de teste');
    const [a, b, c] = [await produto(t, 'Arroz de teste'), await produto(t, 'Feijão de teste'), await produto(t, 'Sal de teste')];
    const s = compras();
    await s.createLista(t, {
      nome: 'Compra de teste', fornecedorId: forn.id, delegadoId: ana, dataRecebimento: somarDias(hoje, 2),
      itens: [{ itemId: a, quantidade: 10, custoUnitario: 5.5 }, { itemId: b, quantidade: 4, custoUnitario: 8 }, { itemId: c, quantidade: 2 }],
    } as any);

    const [l]: any[] = await s.listListas(t);
    expect(l).toMatchObject({
      nome: 'Compra de teste', status: 'aberta', itens: 3, valorEstimado: 87, itensSemCusto: 1,
      fornecedorId: forn.id, fornecedorNome: 'Atacado de teste', delegadoId: ana, delegadoNome: 'Ana de teste',
    });
    const [semR]: any[] = await s.listListas(t, null, { inicio: null, fim: null }, false);
    expect(semR).toMatchObject({ itens: 3, valorEstimado: null, itensSemCusto: 1 });

    // o detalhe (ver itens / conferir) segue a mesma regra: custo só para quem vê R$
    const custos = async (ver: boolean) =>
      ((await s.getLista(t, l.id, null, ver)) as any).itens
        .map((i: any) => (i.custoUnitario == null ? -1 : Number(i.custoUnitario)))
        .sort((x: number, y: number) => x - y);
    expect(await custos(true)).toEqual([-1, 5.5, 8]); // -1 = o item sem custo informado
    expect(await custos(false)).toEqual([-1, -1, -1]);
  });

  it('compras: o período corta só as já recebidas; a que aguarda aparece sempre', async () => {
    const t = await empresa();
    const a = await produto(t, 'Arroz de teste');
    const s = compras();
    const nova = async (nome: string) => ((await s.createLista(t, { nome, itens: [{ itemId: a, quantidade: 1 }] } as any)) as any).id as string;
    const antiga = await nova('Recebida há 60 dias');
    const recente = await nova('Recebida há 5 dias');
    const esquecida = await nova('Aguardando há 90 dias');
    await nova('Aguardando de hoje');
    await q(`update compra_lista set status = 'recebida', recebida_em = now() - interval '60 days', created_at = now() - interval '70 days' where id = $1`, [antiga]);
    await q(`update compra_lista set status = 'recebida', recebida_em = now() - interval '5 days' where id = $1`, [recente]);
    await q(`update compra_lista set created_at = now() - interval '90 days', data_recebimento = $2 where id = $1`, [esquecida, ha(80)]);

    const nomes = async (p?: any) => (await s.listListas(t, null, p)).map((l: any) => l.nome).sort();
    expect(await nomes()).toEqual(['Aguardando de hoje', 'Aguardando há 90 dias', 'Recebida há 5 dias', 'Recebida há 60 dias']);
    expect(await nomes(periodoDaConsulta(ha(30), hoje))).toEqual(['Aguardando de hoje', 'Aguardando há 90 dias', 'Recebida há 5 dias']);
    expect(await nomes(periodoDaConsulta(ha(3), hoje))).toEqual(['Aguardando de hoje', 'Aguardando há 90 dias']);
    expect(await nomes(periodoDaConsulta(ha(90), ha(30)))).toEqual(['Aguardando de hoje', 'Aguardando há 90 dias', 'Recebida há 60 dias']);
  });
});
