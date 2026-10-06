import { randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { hojeISO } from '../../common/data';
import { EtiquetaValidadeService } from './etiqueta-validade.service';
import { CAMPOS_PADRAO, dataBr } from './etiqueta-conteudo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// MODELO DA ETIQUETA (mig 306) — contra Postgres (TEST_PG_URL): o modelo salvo, e o job
// de impressão que nasce dele. O desenho em si é conferido em `etiqueta-moderna.spec.ts`.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
jest.setTimeout(60_000);

descrever('modelo da etiqueta de validade (Postgres real)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let db: any;
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const servico = () => new (EtiquetaValidadeService as any)(db, auditoria, { emit: jest.fn() }, {}) as EtiquetaValidadeService;

  async function empresa() {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `Loja etiqueta ${id.slice(0, 6)}`]);
    empresas.push(id);
    // uma impressora ativa: sem ela a etiqueta fica só no sistema e não há job para ler
    await q(
      `insert into equipamento (tenant_id, nome, tipo, token, ativo, escopo) values ($1, 'Etiquetadora', 'impressora', $2, true, 'producao')`,
      [id, randomBytes(16).toString('hex')],
    );
    return id;
  }
  const pessoa = async (tenant: string, nome: string) =>
    (await q(`insert into colaborador (tenant_id, nome) values ($1, $2) returning id`, [tenant, nome]))[0].id as string;
  const insumo = async (tenant: string, nome: string, validade: string) =>
    (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, validade) values ($1, $2, 'saco', $3) returning id`, [tenant, nome, validade]))[0].id as string;
  /** O job que a geração gravou + os dados que foram no cabeçalho (null = clássico). */
  async function ultimoJob(tenant: string) {
    const [j] = await q(`select conteudo from impressao_job where tenant_id = $1 and via = 'etiqueta' order by criado_em desc limit 1`, [tenant]);
    const linhas = String(j.conteudo).split('\n');
    const m = /;v=2;d=([A-Za-z0-9_-]+)$/.exec(linhas[0]);
    return { cabecalho: linhas[0], linhas, dados: m ? JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')) : null };
  }
  const comResponsavel = CAMPOS_PADRAO.map((c) => (c.campo === 'responsavel' ? { ...c, visivel: true } : c));

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    for (const id of empresas) {
      for (const tabela of ['impressao_job', 'etiqueta_validade', 'etiqueta_template', 'lote', 'item_estoque', 'fornecedor', 'equipamento', 'colaborador']) {
        await q(`delete from ${tabela} where tenant_id = $1`, [id]);
      }
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool.end();
  });

  it('nasce clássico; salvar moderno vale só para a empresa; salvar SEM o campo mantém; valor estranho é recusado', async () => {
    const t = await empresa();
    const outra = await empresa();
    const s = servico();
    expect((await s.getTemplate(t)).modelo).toBe('classico');

    const salvo = await s.salvarTemplate(t, { campos: CAMPOS_PADRAO, tamanho: '60x40', codigoTipo: 'qr', modelo: 'moderno' });
    expect(salvo).toMatchObject({ modelo: 'moderno', tamanho: '60x40', codigoTipo: 'qr' });
    expect((await s.getTemplate(t)).modelo).toBe('moderno');
    expect((await s.getTemplate(outra)).modelo).toBe('classico');

    // tela antiga (ou outra integração) salva sem o campo: o modelo escolhido fica
    const semCampo = await s.salvarTemplate(t, { campos: CAMPOS_PADRAO, tamanho: '50x30', codigoTipo: 'qr' });
    expect(semCampo).toMatchObject({ modelo: 'moderno', tamanho: '50x30' });

    await expect(s.salvarTemplate(t, { campos: CAMPOS_PADRAO, tamanho: '50x30', modelo: 'xpto' })).rejects.toBeInstanceOf(BadRequestException);
    expect((await s.getTemplate(t)).modelo).toBe('moderno');

    const volta = await s.salvarTemplate(t, { campos: CAMPOS_PADRAO, tamanho: '50x30', codigoTipo: 'qr', modelo: 'classico' });
    expect(volta.modelo).toBe('classico');
    // a primeira gravação de quem nunca salvou, sem o campo, nasce clássica
    expect((await s.salvarTemplate(outra, { campos: CAMPOS_PADRAO, tamanho: '40x40' })).modelo).toBe('classico');
  });

  it('moderno: o job leva no cabeçalho a hora, quem gerou, o lote e o fornecedor — e o corpo clássico', async () => {
    const t = await empresa();
    const ana = await pessoa(t, 'Ana Paula Souza');
    const s = servico();
    await s.salvarTemplate(t, { campos: comResponsavel, tamanho: '60x40', codigoTipo: 'qr', modelo: 'moderno' });
    const item = await insumo(t, 'Kit blend', '2026-12-20');
    const forn = (await q(`insert into fornecedor (tenant_id, nome) values ($1, 'Heinz') returning id`, [t]))[0].id;
    const lote = (await q(
      `insert into lote (tenant_id, item_id, codigo, fornecedor_id, validade, quantidade) values ($1, $2, 'L2709', $3, '2026-11-30', 10) returning id`,
      [t, item, forn],
    ))[0].id;

    const r = await s.criar(t, ana, { loteId: lote }, null);
    expect(r.criadas).toBe(1);
    const job = await ultimoJob(t);
    expect(job.cabecalho).toMatch(/^@ETIQUETA:60x40;v=2;d=/);
    expect(job.dados).toMatchObject({
      m: 'moderno', produto: 'Kit blend', manip: dataBr(hojeISO()), validade: '30/11/2026', codigo: r.etiquetas[0].codigo,
      cod: 'qr', unidade: 'saco', status: 'FECHADO', resp: 'Ana S.', lote: 'L2709', fornecedor: 'Heinz',
    });
    expect(job.dados.hora).toMatch(/^\d{2}:\d{2}$/);
    expect(job.dados.loja).toMatch(/^Loja etiqueta /);
    // o corpo é o de sempre: servidor de loja antigo imprime por ele
    expect(job.linhas).toEqual(expect.arrayContaining(['@BKit blend', '@BVALIDADE: 30/11/2026', 'Resp.: Ana S.', `@QR:${r.etiquetas[0].codigo}`]));
  });

  it('moderno: fabricação de OUTRO dia não leva hora; responsável desligado não vai; sem lote não há lote', async () => {
    const t = await empresa();
    const ze = await pessoa(t, 'José');
    const s = servico();
    await s.salvarTemplate(t, { campos: CAMPOS_PADRAO, tamanho: '40x40', codigoTipo: 'nenhum', modelo: 'moderno' });
    const item = await insumo(t, 'Queijo prato', '2026-12-01');
    await s.criar(t, ze, { itemId: item, fabricacao: '2026-01-05' }, null);
    const { dados } = await ultimoJob(t);
    expect(dados).toMatchObject({ m: 'moderno', produto: 'Queijo prato', manip: '05/01/2026', validade: '01/12/2026', cod: 'nenhum' });
    for (const k of ['hora', 'resp', 'lote', 'fornecedor']) expect(dados).not.toHaveProperty(k);
  });

  it('clássico: o job sai sem carga nenhuma, como antes da migration', async () => {
    const t = await empresa();
    const s = servico();
    const item = await insumo(t, 'Tomate', '2026-12-01');
    await s.criar(t, await pessoa(t, 'Rodrigo de Oliveira'), { itemId: item }, null);
    const job = await ultimoJob(t);
    expect(job.cabecalho).toBe('@ETIQUETA:40x40');
    expect(job.dados).toBeNull();
    expect(job.linhas).not.toEqual(expect.arrayContaining([expect.stringMatching(/^Resp\.:/)]));
  });

  it('etiqueta de outra empresa não empresta nome nem lote', async () => {
    const t = await empresa();
    const outra = await empresa();
    const deFora = await pessoa(outra, 'Pessoa De Fora');
    const s = servico();
    await s.salvarTemplate(t, { campos: comResponsavel, tamanho: '60x40', codigoTipo: 'qr', modelo: 'moderno' });
    const item = await insumo(t, 'Alface', '2026-12-01');
    await s.criar(t, deFora, { itemId: item }, null); // ator de outra empresa: o nome não aparece
    expect((await ultimoJob(t)).dados).not.toHaveProperty('resp');
  });
});
