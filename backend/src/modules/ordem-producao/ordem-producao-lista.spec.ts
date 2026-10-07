import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { OrdemProducaoService } from './ordem-producao.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ORDENS DE PRODUÇÃO — a lista, o relatório e a recorrência, contra o Postgres real (TEST_PG_URL).
//
// • A lista devolvia as 500 mais recentes de QUALQUER situação: depois de 500 ordens concluídas, a
//   pendência antiga ("aguardando lançamento") saía da tela — justamente a que pede desfecho.
// • O resumo do relatório era somado sobre as 1000 linhas da tabela, não sobre o período.
// • "Repetir todo dia" exigia a loja no pedido (a tela nunca mandou → sempre recusava) e gravava a
//   que viesse, sem conferir de quem era.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ordem-producao-lista.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

descrever('ordens de produção: lista por situação, totais do relatório e recorrência', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const svc = new OrdemProducaoService(db, null as any, { registrar: async () => undefined } as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['ordem_producao', 'tarefa_def', 'ficha_tecnica', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    }
    await pool.end();
  }, 120_000);

  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste ordens de produção') returning id`))[0].id as string;
    empresas.push(t);
    const ficha = (await q(`insert into ficha_tecnica (tenant_id, nome, rendimento) values ($1, 'Ficha de teste', 1) returning id`, [t]))[0].id as string;
    const loja = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja de teste') returning id`, [t]))[0].id as string;
    return { t, ficha, loja };
  }
  const ordem = async (c: { t: string; ficha: string }, status: string, data: string) =>
    (await q(`insert into ordem_producao (tenant_id, ficha_id, data_producao, status, quantidade_planejada) values ($1, $2, $3, $4, 1) returning id`, [c.t, c.ficha, data, status]))[0].id as string;
  /** `n` ordens de uma vez, uma por dia a partir de `inicio`. */
  const muitas = (c: { t: string; ficha: string }, n: number, status: string, inicio: string, planejada = 1, produzida: number | null = null) =>
    q(
      `insert into ordem_producao (tenant_id, ficha_id, data_producao, status, quantidade_planejada, quantidade_produzida)
       select $1, $2, $3::date + (g % 60), $4, $5, $6 from generate_series(1, $7) g`,
      [c.t, c.ficha, inicio, status, planejada, produzida, n],
    );

  it('sem `situacao`, a pendência antiga some atrás de 500 concluídas; com `abertas`, ela vem', async () => {
    const c = await empresa();
    const pendente = await ordem(c, 'aguardando_lancamento', '2026-01-05');
    const planejada = await ordem(c, 'planejada', '2026-01-06');
    const critica = await ordem(c, 'pendencia_critica', '2026-01-02');
    await muitas(c, 510, 'concluida_total', '2026-03-01');

    const tudo = await svc.listar(c.t);
    expect(tudo).toHaveLength(500);
    expect(tudo.map((o: any) => o.id)).not.toContain(pendente);

    const abertas = await svc.listar(c.t, { situacao: 'abertas' });
    expect(abertas.map((o: any) => o.id).sort()).toEqual([pendente, planejada, critica].sort());
  });

  it('`encerradas` traz só o que teve desfecho, dentro do período pedido', async () => {
    const c = await empresa();
    await ordem(c, 'em_producao', '2026-05-10');
    const dentro = [await ordem(c, 'concluida_parcial', '2026-05-10'), await ordem(c, 'nao_concluida', '2026-05-12'), await ordem(c, 'cancelada', '2026-05-20')];
    await ordem(c, 'concluida_total', '2026-04-30'); // antes do período
    const r = await svc.listar(c.t, { situacao: 'encerradas', de: '2026-05-01', ate: '2026-05-31' });
    expect(r.map((o: any) => o.id).sort()).toEqual(dentro.sort());
  });

  it('situação que a tela não conhece conta como aberta (não desaparece)', async () => {
    const c = await empresa();
    const nova = await ordem(c, 'situacao_nova', '2026-05-10');
    expect((await svc.listar(c.t, { situacao: 'abertas' })).map((o: any) => o.id)).toEqual([nova]);
    expect(await svc.listar(c.t, { situacao: 'encerradas' })).toEqual([]);
  });

  it('a lista respeita a empresa e a loja de quem pede', async () => {
    const a = await empresa();
    const b = await empresa();
    const outraLoja = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Outra loja de teste') returning id`, [a.t]))[0].id as string;
    const daLoja = await ordem(a, 'planejada', '2026-05-10');
    await q(`update ordem_producao set unidade_id = $1 where id = $2`, [a.loja, daLoja]);
    const daOutra = await ordem(a, 'planejada', '2026-05-10');
    await q(`update ordem_producao set unidade_id = $1 where id = $2`, [outraLoja, daOutra]);
    await ordem(b, 'planejada', '2026-05-10');
    expect((await svc.listar(a.t, { situacao: 'abertas' }, a.loja)).map((o: any) => o.id)).toEqual([daLoja]);
    expect((await svc.listar(a.t, { situacao: 'abertas' })).map((o: any) => o.id).sort()).toEqual([daLoja, daOutra].sort());
  });

  it('o resumo do relatório soma o período inteiro, mesmo com mais ordens que a tabela mostra', async () => {
    const c = await empresa();
    await muitas(c, 1005, 'concluida_parcial', '2026-06-01', 2, 1.5);
    await ordem(c, 'cancelada', '2026-06-02'); // não entra no relatório
    const r = await svc.relatorio(c.t, '2026-06-01', '2026-08-31');
    expect(r.itens).toHaveLength(1000);
    expect(r.resumo).toMatchObject({ ordens: 1005, planejadoTotal: 2010, produzidoTotal: 1507.5, quebraTotal: 502.5, aderenciaMedia: 75 });
    // e fora do período não há nada
    expect((await svc.relatorio(c.t, '2027-01-01', '2027-01-31')).resumo).toMatchObject({ ordens: 0, planejadoTotal: 0, produzidoTotal: 0, aderenciaMedia: null });
  });

  it('recorrência: a loja vem do escopo de quem pede, ou é conferida contra a empresa', async () => {
    const a = await empresa();
    const b = await empresa();
    const corpo = { fichaId: a.ficha, quantidadePlanejada: 3, unidade: 'un', titulo: 'Ficha de teste', canais: ['linha_tempo'] };

    // sem loja (como a tela mandava): recusa
    await expect(svc.criarRecorrencia(a.t, randomUUID(), corpo)).rejects.toThrow('Recorrência exige ficha e unidade');
    // usuário de loja: vale a dele, mesmo que o pedido traga outra
    const daLoja: any = await svc.criarRecorrencia(a.t, randomUUID(), { ...corpo, unidadeId: b.loja }, a.loja);
    expect(daLoja.unidadeId).toBe(a.loja);
    // usuário de rede: a loja informada tem de ser da empresa
    await expect(svc.criarRecorrencia(a.t, randomUUID(), { ...corpo, unidadeId: b.loja })).rejects.toThrow('Unidade inválida');
    expect(((await svc.criarRecorrencia(a.t, randomUUID(), { ...corpo, unidadeId: a.loja })) as any).unidadeId).toBe(a.loja);
    // ficha de outra empresa: recusa
    await expect(svc.criarRecorrencia(a.t, randomUUID(), { ...corpo, fichaId: b.ficha, unidadeId: a.loja })).rejects.toThrow('Ficha técnica não encontrada');

    // nada foi gravado na outra empresa, e a ordem de hoje nasceu na loja certa
    expect(await q(`select 1 from tarefa_def where tenant_id = $1`, [b.t])).toEqual([]);
    const ordens = await q(`select unidade_id, status, quantidade_planejada::float as qtd from ordem_producao where tenant_id = $1`, [a.t]);
    expect(ordens.length).toBeGreaterThan(0);
    for (const o of ordens) expect(o).toEqual({ unidade_id: a.loja, status: 'liberada', qtd: 3 });
  });
});
