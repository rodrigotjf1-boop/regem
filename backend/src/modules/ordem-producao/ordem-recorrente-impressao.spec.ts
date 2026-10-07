import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { OrdemProducaoService, idOrdemRecorrente } from './ordem-producao.service';
import { hojeISO } from '../../common/data';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ORDEM DE PRODUÇÃO QUE SE REPETE: o id e a via em papel — contra o Postgres real (TEST_PG_URL).
//
// • A rotina que cria a ordem do dia roda na nuvem E no servidor da loja. Com id aleatório cada lado
//   criava a sua, e a segunda a chegar pelo sincronismo batia no índice único (empresa, definição,
//   dia). O id passa a sair da definição + o dia: os dois lados chegam à MESMA linha.
// • Decisão do dono (07/10/2026): na ordem que se repete dá para escolher imprimir ou não, e em
//   qual impressora. A via sai UMA vez por ordem, do lado que tem a fila daquela loja.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ordem-recorrente-impressao.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

descrever('ordem recorrente: id da chave de negócio e via em papel uma vez só', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const svc = new OrdemProducaoService(db, null as any, { registrar: async () => undefined } as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;
  const hoje = hojeISO();
  const comoNuvem = () => { delete process.env.EDGE_MODE; };
  const comoServidorDaLoja = () => { process.env.EDGE_MODE = 'true'; };

  beforeEach(comoNuvem);
  afterAll(async () => {
    if (edgeOriginal !== undefined) process.env.EDGE_MODE = edgeOriginal; else delete process.env.EDGE_MODE;
    if (empresas.length) {
      for (const t of ['impressao_job', 'ordem_producao', 'tarefa_def', 'equipamento', 'ficha_tecnica', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    }
    await pool.end();
  }, 120_000);

  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste ordem recorrente') returning id`))[0].id as string;
    empresas.push(t);
    const loja = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja de teste') returning id`, [t]))[0].id as string;
    const ficha = (await q(`insert into ficha_tecnica (tenant_id, nome, rendimento) values ($1, 'Molho de teste', 1) returning id`, [t]))[0].id as string;
    const equip = async (tipo: string, nome: string, extra = '') =>
      (await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token${extra ? ', ativo' : ''}) values ($1, $2, $3, $4, $5${extra ? ', false' : ''}) returning id`, [t, loja, tipo, nome, randomBytes(12).toString('hex')]))[0].id as string;
    return { t, loja, ficha, imp: await equip('impressora', 'Impressora de teste'), equip };
  }
  const recorrencia = (c: any, extra: Record<string, unknown> = {}) =>
    svc.criarRecorrencia(c.t, randomUUID(), { fichaId: c.ficha, quantidadePlanejada: 4, unidade: 'un', titulo: 'Molho de teste', canais: ['impressao'], impressoraId: c.imp, ...extra }, c.loja) as Promise<any>;
  const vias = (t: string) => q(`select id, equipamento_id, via, conteudo, status from impressao_job where tenant_id = $1`, [t]);
  const ordens = (t: string) => q(`select id, tarefa_def_id, status, impressora_id from ordem_producao where tenant_id = $1 order by created_at`, [t]);

  it('a ordem do dia nasce com o id da definição + o dia; gerar de novo (ou o outro lado já ter gerado) não duplica', async () => {
    const c = await empresa();
    const def = await recorrencia(c, { canais: [], impressoraId: null });
    let os = await ordens(c.t);
    expect(os).toHaveLength(1);
    expect(os[0].id).toBe(idOrdemRecorrente(def.id, hoje));
    expect(await svc.gerarRecorrentes(c.t, hoje)).toBe(0);
    expect(await ordens(c.t)).toHaveLength(1);
    // o mesmo id que o Postgres calcula (é a conta que a rotina de impressão usa para reconhecer a ordem)
    const [sql] = await q(`select md5($1::uuid::text || $2::date::text)::uuid as id`, [def.id, hoje]);
    expect(sql.id).toBe(os[0].id);
    // o outro lado gerou primeiro e a linha chegou pelo sincronismo: aqui a rotina só não cria outra
    const amanha = new Date(Date.parse(`${hoje}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    await q(`insert into ordem_producao (id, tenant_id, unidade_id, ficha_id, data_producao, status, tarefa_def_id, quantidade_planejada) values ($1, $2, $3, $4, $5, 'liberada', $6, 4)`, [idOrdemRecorrente(def.id, amanha), c.t, c.loja, c.ficha, amanha, def.id]);
    expect(await svc.gerarRecorrentes(c.t, amanha)).toBe(0);
    os = await ordens(c.t);
    expect(os).toHaveLength(2);
  });

  it('loja sem servidor local: a nuvem grava a via na impressora escolhida — uma vez', async () => {
    const c = await empresa();
    await recorrencia(c);
    let v = await vias(c.t);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ equipamento_id: c.imp, via: 'producao', status: 'pendente' });
    expect(v[0].conteudo).toContain('ORDEM DE PRODUÇÃO');
    expect(v[0].conteudo).toContain('Molho de teste');
    expect(v[0].conteudo).toContain('Assinatura');
    // a rotina de 10 em 10 minutos passa de novo (a geral, de todas as empresas, e a da empresa): nada novo aqui
    await svc.imprimirRecorrentesDoDia();
    expect(await svc.imprimirRecorrentesDoDia(c.t)).toBe(0);
    v = await vias(c.t);
    expect(v).toHaveLength(1);
  });

  it('sem "Impressão" marcada, ou sem impressora, nada é impresso', async () => {
    const c = await empresa();
    await recorrencia(c, { canais: ['linha_tempo'] });
    await recorrencia(c, { canais: ['impressao'], impressoraId: null });
    expect(await ordens(c.t)).toHaveLength(2);
    expect(await svc.imprimirRecorrentesDoDia(c.t)).toBe(0);
    expect(await vias(c.t)).toEqual([]);
  });

  it('loja COM servidor local: a nuvem não grava (a fila dela não é lida lá); o servidor da loja imprime, uma vez', async () => {
    const c = await empresa();
    await c.equip('servidor_local', 'Servidor de teste');
    await recorrencia(c);
    expect(await ordens(c.t)).toHaveLength(1);
    expect(await vias(c.t)).toEqual([]); // na nuvem: nada
    // a mesma ordem, vista do servidor da loja (chegou pelo sincronismo, ou ele mesmo gerou)
    comoServidorDaLoja();
    expect(await svc.imprimirRecorrentesDoDia(c.t)).toBe(1);
    expect(await svc.imprimirRecorrentesDoDia(c.t)).toBe(0);
    expect(await vias(c.t)).toHaveLength(1);
  });

  it('ordem já iniciada, impressora inativa e ordem avulsa com a mesma definição não entram', async () => {
    const c = await empresa();
    const inativa = await c.equip('impressora', 'Impressora inativa', 'inativa');
    // criadas sem passar pela impressão (como se tivessem chegado pelo sincronismo)
    const def = async (canais: string[], impressoraId: string | null) =>
      (await q(`insert into tarefa_def (tenant_id, unidade_id, origem, titulo, recorrencia_tipo, recorrencia_config) values ($1, $2, 'recorrente', 'Produção: teste', 'diaria', $3::jsonb) returning id`,
        [c.t, c.loja, JSON.stringify({ ordemProducao: { fichaId: c.ficha, quantidade: 1, canais, impressoraId } })]))[0].id as string;
    const ordem = (id: string, defId: string, status: string, impressoraId: string | null) =>
      q(`insert into ordem_producao (id, tenant_id, unidade_id, ficha_id, data_producao, status, tarefa_def_id, quantidade_planejada, canais, impressora_id) values ($1, $2, $3, $4, $5, $6, $7, 1, '["impressao"]'::jsonb, $8)`,
        [id, c.t, c.loja, c.ficha, hoje, status, defId, impressoraId]);
    const [d1, d2, d3] = [await def(['impressao'], c.imp), await def(['impressao'], inativa), await def(['impressao'], c.imp)];
    await ordem(idOrdemRecorrente(d1, hoje), d1, 'em_producao', c.imp); // já começou: não precisa mais do papel
    await ordem(idOrdemRecorrente(d2, hoje), d2, 'liberada', inativa); // impressora desligada
    await ordem(randomUUID(), d3, 'liberada', c.imp); // avulsa (id aleatório): imprime na criação, pelo caminho dela
    expect(await svc.imprimirRecorrentesDoDia(c.t)).toBe(0);
    expect(await vias(c.t)).toEqual([]);
    // a impressora volta: a via sai na passada seguinte
    await q(`update equipamento set ativo = true where id = $1`, [inativa]);
    expect(await svc.imprimirRecorrentesDoDia(c.t)).toBe(1);
    expect((await vias(c.t))[0].equipamento_id).toBe(inativa);
  });

  it('a rotina geral não mistura empresas', async () => {
    const a = await empresa();
    const b = await empresa();
    await recorrencia(a);
    await recorrencia(b);
    expect(await vias(a.t)).toHaveLength(1);
    expect(await vias(b.t)).toHaveLength(1);
    expect((await vias(a.t))[0].equipamento_id).toBe(a.imp);
    expect((await vias(b.t))[0].equipamento_id).toBe(b.imp);
  });
});
