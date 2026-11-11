import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ProducaoPedidoService } from './producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Os avisos que cada KDS recebe (auditoria do KDS de 11/11/2026, onda 2 — A13; mig 408): a escolha fica na linha do KDS em
// `kds_tela_ajuste.avisos`; a lista das telas devolve o que cada uma recebe (o salvo por cima do padrão do tipo de tela);
// salvar grava SÓ a coluna dela (o mapa é do painel do Delivery — V82), audita o que mudou e avisa as telas.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('kds-avisos-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

descrever('os avisos de cada KDS (Postgres)', () => {
  let pool: Pool;
  let svc: ProducaoPedidoService;
  const auditado: any[] = [];
  const emitidos: { nome: string; dado: any }[] = [];
  const T = randomUUID();
  const OUTRA = randomUUID();
  const U = randomUUID();
  const U2 = randomUUID();
  const COZINHA = randomUUID();
  const DESPACHO = randomUUID();
  const DE_OUTRA_LOJA = randomUUID();
  const DA_OUTRA_EMPRESA = randomUUID();
  const ATOR = { id: randomUUID(), perfil: 'gerente' };
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new ProducaoPedidoService(
      drizzle(pool, { schema }) as any,
      { registrar: async (a: any) => void auditado.push(a) } as any,
      { emit: (nome: string, dado: any) => emitidos.push({ nome, dado }) } as any,
    );
    await q(`insert into empresa (id, nome) values ($1,'teste avisos do KDS'), ($2,'outra empresa')`, [T, OUTRA]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$2,'Loja'), ($3,$2,'Outra loja')`, [U, T, U2]);
    const kds = (id: string, tenant: string, unidade: string | null, nome: string, escopo: string) =>
      q(`insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, escopo, ativo) values ($1,$2,$3,$4,$5,'kds',$6,true)`, [
        id,
        tenant,
        unidade,
        nome,
        'tok-' + id,
        escopo,
      ]);
    await kds(COZINHA, T, U, 'Cozinha', 'producao');
    await kds(DESPACHO, T, U, 'Despacho', 'despacho');
    await kds(DE_OUTRA_LOJA, T, U2, 'Chapa da outra loja', 'producao');
    await kds(DA_OUTRA_EMPRESA, OUTRA, null, 'Cozinha da outra empresa', 'producao');
  });

  afterAll(async () => {
    if (!pool) return;
    for (const t of ['kds_tela_ajuste', 'equipamento', 'unidade'])
      await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => undefined);
    await q(`delete from empresa where id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => undefined);
    await pool.end();
  });

  const daTela = async (id: string) => (await svc.telasDeKds(T, U)).find((t: any) => t.id === id) as any;

  it('sem nada salvo, cada tela recebe o padrão do tipo dela (preparo sem gestão e sem "cliente chegou")', async () => {
    expect((await daTela(COZINHA)).avisos).toEqual({ loja: true, farol: true, pausa: true, estoque: true, chegou: false, gestao: false });
    expect((await daTela(DESPACHO)).avisos).toEqual({ loja: true, farol: true, pausa: true, estoque: true, chegou: true, gestao: true });
  });

  it('salvar grava só os avisos (o mapa do painel fica), audita o que mudou e avisa as telas; de novo igual não audita', async () => {
    // O painel do Delivery já tinha mandado o mapa para este KDS.
    await q(`insert into kds_tela_ajuste (id, tenant_id, mostra_mapa) values ($1,$2,true)`, [COZINHA, T]);
    const r = await svc.salvarAvisosDoKds(T, ATOR, COZINHA, { avisos: { gestao: true, estoque: false } }, U);
    expect(r).toMatchObject({ mudou: true, avisos: { gestao: true, estoque: false, chegou: false, loja: true } });
    const linha = (await q(`select mostra_mapa, avisos from kds_tela_ajuste where id = $1`, [COZINHA]))[0];
    expect(linha.mostra_mapa).toBe(true);
    expect(linha.avisos).toMatchObject({ gestao: true, estoque: false });
    const tela = await daTela(COZINHA);
    expect(tela.avisos).toMatchObject({ gestao: true, estoque: false, chegou: false });
    expect(tela.mapa).toBe(true);
    expect(auditado).toHaveLength(1);
    expect(auditado[0]).toMatchObject({
      tenantId: T,
      acao: 'configurou_avisos_kds',
      entidadeId: COZINHA,
      atorId: ATOR.id,
      detalhe: { kds: 'Cozinha', ligou: ['gestao'], desligou: ['estoque'] },
    });
    expect(emitidos.filter((e) => e.nome === 'kds.telas.mudou')).toHaveLength(1);
    // Mandar o mesmo de novo: nada muda, nada a auditar.
    expect(await svc.salvarAvisosDoKds(T, ATOR, COZINHA, { avisos: { gestao: true } }, U)).toMatchObject({ mudou: false });
    expect(auditado).toHaveLength(1);
  });

  it('a linha que ainda não existe nasce só com os avisos (o mapa no padrão, desligado)', async () => {
    await svc.salvarAvisosDoKds(T, ATOR, DESPACHO, { avisos: { chegou: false } }, U);
    const linha = (await q(`select mostra_mapa, avisos from kds_tela_ajuste where id = $1`, [DESPACHO]))[0];
    expect(linha).toMatchObject({ mostra_mapa: false, avisos: expect.objectContaining({ chegou: false, gestao: true }) });
  });

  it('recusa o que não vale: cancelado/alterado, valor que não é ligado/desligado, KDS de outra loja ou de outra empresa', async () => {
    await expect(svc.salvarAvisosDoKds(T, ATOR, COZINHA, { avisos: { cancelado: false } }, U)).rejects.toMatchObject({ status: 400 });
    await expect(svc.salvarAvisosDoKds(T, ATOR, COZINHA, { avisos: { gestao: 'sim' } }, U)).rejects.toMatchObject({ status: 400 });
    await expect(svc.salvarAvisosDoKds(T, ATOR, DE_OUTRA_LOJA, { avisos: { gestao: true } }, U)).rejects.toMatchObject({ status: 404 });
    await expect(svc.salvarAvisosDoKds(T, ATOR, DA_OUTRA_EMPRESA, { avisos: { gestao: true } }, U)).rejects.toMatchObject({ status: 404 });
    await expect(svc.salvarAvisosDoKds(T, ATOR, 'nao-e-uuid', { avisos: { gestao: true } }, U)).rejects.toMatchObject({ status: 404 });
    // Nada foi gravado pelas recusas.
    expect((await q(`select count(*)::int as n from kds_tela_ajuste where id = any($1::uuid[])`, [[DE_OUTRA_LOJA, DA_OUTRA_EMPRESA]]))[0].n).toBe(0);
  });
});
