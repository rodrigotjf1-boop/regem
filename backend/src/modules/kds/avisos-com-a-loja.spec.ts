import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { hojeISO, somarDias } from '../../common/data';
import { ContagemService } from '../contagem/contagem.service';
import { ComprasService } from '../compras/compras.service';
import { PedidoManutencaoService } from '../pedido-manutencao/pedido-manutencao.service';
import { EtiquetaValidadeService } from '../etiqueta-validade/etiqueta-validade.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O AVISO QUE NASCE DE UM REGISTRO COM LOJA LEVA A LOJA DELE (ERR-494). Quatro avisos do sistema saíam só com a empresa:
// numa rede de várias lojas, a compra recebida, a contagem concluída, as etiquetas vencendo e o novo pedido de manutenção
// de UMA loja apareciam nas telas de TODAS. Postgres real, os serviços de verdade; só os avisos são colhidos.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('avisos-com-a-loja.spec: sem TEST_PG_URL — PULADO');

descrever('os avisos do sistema levam a loja do registro (Postgres)', () => {
  jest.setTimeout(60_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const lojaA = randomUUID();
  const lojaB = randomUUID();
  const avisos: any[] = [];
  const eventos = { emit: (nome: string, a: any) => (nome === 'kds.alerta.sistema' ? avisos.push(a) : 0) } as any;
  const auditoria = { registrar: async () => undefined } as any;
  const meus = () => avisos.filter((a) => a.tenantId === T);
  let ana = '';
  let arroz = '';

  beforeAll(async () => {
    await q(`insert into empresa (id, nome) values ($1, 'teste avisos com a loja')`, [T]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1, $3, 'Loja A'), ($2, $3, 'Loja B')`, [lojaA, lojaB, T]);
    [{ id: ana }] = await q(`insert into colaborador (tenant_id, nome) values ($1, 'Ana de teste') returning id`, [T]);
    [{ id: arroz }] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Arroz de teste', 'kg') returning id`, [T]);
  });
  afterAll(async () => {
    for (const tab of [
      'titulo_financeiro', 'lote', 'movimento_estoque', 'contagem_item', 'contagem_execucao', 'contagem_lista_item', 'contagem_lista',
      'compra_item', 'compra_lista', 'etiqueta_validade', 'pedido_manutencao', 'item_estoque', 'colaborador', 'unidade',
    ])
      await q(`delete from ${tab} where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from empresa where id = $1`, [T]).catch(() => undefined);
    await pool.end();
  });
  beforeEach(() => {
    avisos.length = 0;
  });

  it('novo pedido de manutenção: o aviso vai com a loja de quem abriu e é de gestão (não toca no preparo)', async () => {
    const svc = new PedidoManutencaoService(db, eventos, auditoria);
    await svc.criar(T, ana, { titulo: 'Chapa não esquenta' }, lojaB);
    expect(meus()).toHaveLength(1);
    expect(meus()[0]).toMatchObject({ unidadeId: lojaB, detalhe: 'Chapa não esquenta', tipo: 'gestao' });
  });

  it('etiquetas de validade: um aviso por loja, com a conta de cada uma (a loja B não vê as vencidas da A)', async () => {
    const hoje = hojeISO();
    const etiqueta = (loja: string | null, validade: string) =>
      q(`insert into etiqueta_validade (tenant_id, unidade_id, descricao, validade, status) values ($1, $2, 'Molho de teste', $3, 'fechado')`, [T, loja, validade]);
    await etiqueta(lojaA, somarDias(hoje, -1)); // vencida
    await etiqueta(lojaA, somarDias(hoje, -2)); // vencida
    await etiqueta(lojaA, hoje); // a vencer
    await etiqueta(lojaB, somarDias(hoje, 1)); // a vencer
    await etiqueta(lojaB, somarDias(hoje, 30)); // longe: não conta
    const svc = new EtiquetaValidadeService(db, auditoria, eventos, undefined as any);
    await svc.alertasValidade();
    const porLoja = Object.fromEntries(meus().map((a) => [a.unidadeId, a]));
    expect(Object.keys(porLoja).sort()).toEqual([lojaA, lojaB].sort());
    expect(porLoja[lojaA]).toMatchObject({ detalhe: '1 a vencer · 2 vencida(s)', prioridade: 'danger', tipo: 'estoque' });
    expect(porLoja[lojaB]).toMatchObject({ detalhe: '1 a vencer · 0 vencida(s)', prioridade: 'alta' });
  });

  it('contagem concluída: o aviso vai com a loja da lista', async () => {
    const svc = new (ContagemService as any)(db, eventos, auditoria) as ContagemService;
    const lista: any = await svc.createLista(T, { nome: 'Freezer de teste', recorrencia: 'avulsa', itemIds: [arroz] } as any, lojaA);
    const exec: any = await svc.iniciarExecucao(T, lista.id, ana, lojaA);
    await svc.salvarContagem(T, exec.id, ana, { itens: [{ itemId: arroz, contado: 3 }], aplicarAjuste: false } as any);
    const concluida = meus().filter((a) => String(a.titulo).startsWith('Contagem concluída'));
    expect(concluida).toHaveLength(1);
    expect(concluida[0]).toMatchObject({ unidadeId: lojaA, tipo: 'gestao' });
  });

  it('compra recebida: o aviso vai com a loja da lista', async () => {
    const svc = new (ComprasService as any)(db, eventos, auditoria) as ComprasService;
    const lista: any = await svc.createLista(T, { nome: 'Compra de teste', enviarKds: true, itens: [{ itemId: arroz, quantidade: 2, custoUnitario: 5 }] } as any, lojaB);
    // A conferência é obrigatória e cobre a lista inteira (regra do serviço): a linha, o que chegou e a validade.
    const [linha] = await q(`select id from compra_item where lista_id = $1`, [lista.id]);
    await svc.receber(T, lista.id, ana, { itens: [{ compraItemId: linha.id, qtdRecebida: 2, validadeIndefinida: true }] } as any, lojaB);
    const recebida = meus().filter((a) => String(a.titulo).startsWith('Compra recebida'));
    expect(recebida).toHaveLength(1);
    expect(recebida[0]).toMatchObject({ unidadeId: lojaB, titulo: 'Compra recebida: Compra de teste', tipo: 'gestao' });
  });
});
