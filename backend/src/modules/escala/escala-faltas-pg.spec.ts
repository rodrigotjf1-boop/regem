import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { idEscalaAlocacao } from '../../common/id-deterministico';
import { EscalaController } from './escala.controller';
import { EscalaService } from './escala.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O RELATÓRIO DE FALTAS RESPEITA A LOJA (ERR-555): o nome de quem faltou é dado de pessoa. O gerente preso à loja A não
// pode ver as faltas da loja B da mesma empresa, e o presidente com uma loja escolhida vê só aquela.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('escala-faltas-pg.spec: sem TEST_PG_URL — PULADO');

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const DIA = '2026-09-22';

describe('a rota das faltas', () => {
  it('passa ao serviço a loja em uso', () => {
    const faltas = jest.fn();
    new EscalaController({ faltas } as any, {} as any).faltas({ tenantId: 'empresa' } as any, 'loja', '2026-09-01', '2026-09-30');
    expect(faltas).toHaveBeenCalledWith('empresa', '2026-09-01', '2026-09-30', 'loja');
  });
});

descrever('as faltas da escala por loja (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const service = new EscalaService(drizzle(pool) as any);
  let tenant = '';
  let lojaA = '';
  let lojaB = '';

  const uma = async (r: string) => (await pool.query(r)).rows[0].id as string;
  const loja = async (nome: string, pessoa: string) => {
    const { rows: [u] } = await pool.query(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [tenant, nome]);
    const { rows: [t] } = await pool.query(`insert into turno (tenant_id, unidade_id, nome, hora_inicio, hora_fim) values ($1, $2, 'Noite', '18:00', '23:00') returning id`, [tenant, u.id]);
    const { rows: [c] } = await pool.query(`insert into colaborador (tenant_id, unidade_id, nome) values ($1, $2, $3) returning id`, [tenant, u.id, pessoa]);
    const { rows: [s] } = await pool.query(`insert into setor (tenant_id, unidade_id, nome) values ($1, $2, 'Caixa') returning id`, [tenant, u.id]);
    const { rows: [f] } = await pool.query(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, 'execucao') returning id`, [tenant, `Caixa ${nome}`]);
    const { rows: [e] } = await pool.query(
      `insert into etiqueta (tenant_id, unidade_id, setor_id, funcao_id, sigla, contador) values ($1, $2, $3, $4, 'CX', 1) returning id`,
      [tenant, u.id, s.id, f.id],
    );
    await pool.query(
      `insert into escala_alocacao (id, tenant_id, unidade_id, data, turno_id, colaborador_id, etiqueta_id, presenca)
       values ($1, $2, $3, $4, $5, $6, $7, 'falta_injustificada')`,
      [idEscalaAlocacao(u.id, DIA, t.id, c.id), tenant, u.id, DIA, t.id, c.id, e.id],
    );
    return u.id as string;
  };
  const nomes = async (unidade?: string | null) => {
    const r: any = await service.faltas(tenant, DIA, DIA, unidade);
    return { lista: r.faltas.map((f: any) => f.colaboradorNome).sort(), resumo: r.resumo.map((x: any) => x.nome).sort() };
  };

  beforeAll(async () => {
    tenant = await uma(`insert into empresa (nome) values ('Teste faltas por loja') returning id`);
    lojaA = await loja('Loja A', 'Maria da A');
    lojaB = await loja('Loja B', 'Joana da B');
  }, 60000);

  afterAll(async () => {
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  it('com uma loja, só as faltas dela, na lista e no resumo', async () => {
    expect(await nomes(lojaA)).toEqual({ lista: ['Maria da A'], resumo: ['Maria da A'] });
    expect(await nomes(lojaB)).toEqual({ lista: ['Joana da B'], resumo: ['Joana da B'] });
  }, 60000);

  it('sem loja (presidente em "todas" ou empresa de loja única), a empresa inteira', async () => {
    expect((await nomes(null)).lista).toEqual(['Joana da B', 'Maria da A']);
  }, 60000);

  it('quem não tem loja e não é presidente (o id nulo do decorador) não vê nada', async () => {
    expect(await nomes(NIL_UUID)).toEqual({ lista: [], resumo: [] });
  }, 60000);
});
