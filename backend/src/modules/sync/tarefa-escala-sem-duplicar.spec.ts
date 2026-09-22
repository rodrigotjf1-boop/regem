import { Pool } from 'pg';
import { idEscalaAlocacao, idTarefaInstancia, uuidDeChave } from '../../common/id-deterministico';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TAREFA E ESCALA SINCRONIZAM SEM DUPLICAR (mig 277).
//
// As duas são MATERIALIZADAS por rotina, e a rotina roda na nuvem e no servidor local.
// Com `id` aleatório, cada lado criava a mesma tarefa do mesmo dia com um id diferente e
// o sincronismo — que casa linha por id — duplicaria em vez de conciliar: a tarefa
// apareceria duas vezes no Meu Dia e a mesma pessoa duas vezes no turno. Por isso as duas
// ficaram de fora até existir uma CHAVE DE NEGÓCIO e um id derivado dela.
//
// O teste prova as três coisas que sustentam isso: o id do TypeScript é igual ao do SQL
// (senão cada lado geraria um id diferente do mesmo jeito), a segunda criação vira a mesma
// linha, e a chave única barra a duplicata que venha por outro caminho.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('tarefa-escala-sem-duplicar.spec: sem TEST_PG_URL — PULADO');

describe('id derivado da chave de negócio', () => {
  it('a mesma chave dá sempre o mesmo id', () => {
    const a = idTarefaInstancia('def-1', 'loja-1', '2026-09-20');
    const b = idTarefaInstancia('def-1', 'loja-1', '2026-09-20');
    expect(a).toBe(b);
  });

  it('chaves diferentes dão ids diferentes (dia, loja e definição entram na conta)', () => {
    const base = idTarefaInstancia('def-1', 'loja-1', '2026-09-20');
    expect(idTarefaInstancia('def-1', 'loja-1', '2026-09-21')).not.toBe(base);
    expect(idTarefaInstancia('def-1', 'loja-2', '2026-09-20')).not.toBe(base);
    expect(idTarefaInstancia('def-2', 'loja-1', '2026-09-20')).not.toBe(base);
  });

  it('tem o formato de uuid', () => {
    expect(uuidDeChave('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

descrever('contra o Postgres', () => {
  const pool = new Pool({ connectionString: URL_PG });
  let tenant = '';
  let unidade = '';
  let def = '';
  let turnoId = '';
  let colab = '';
  let etiq = ''; // a vaga da escala sempre pertence a uma etiqueta (função/setor)

  beforeAll(async () => {
    const e = await pool.query(`insert into empresa (nome) values ('Teste chave') returning id`);
    tenant = e.rows[0].id;
    const u = await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [tenant]);
    unidade = u.rows[0].id;
    const d = await pool.query(
      `insert into tarefa_def (tenant_id, unidade_id, titulo, horario) values ($1,$2,'Abrir a loja','08:00') returning id`,
      [tenant, unidade],
    );
    def = d.rows[0].id;
    const t = await pool.query(
      `insert into turno (tenant_id, unidade_id, nome, hora_inicio, hora_fim) values ($1,$2,'Manhã','08:00','16:00') returning id`,
      [tenant, unidade],
    );
    turnoId = t.rows[0].id;
    const c = await pool.query(`insert into colaborador (tenant_id, nome) values ($1,'Maria') returning id`, [tenant]);
    colab = c.rows[0].id;
    const s = await pool.query(
      `insert into setor (tenant_id, unidade_id, nome) values ($1,$2,'Caixa') returning id`,
      [tenant, unidade],
    );
    const fn = await pool.query(
      `insert into funcao (tenant_id, nome, categoria) values ($1,'Caixa','execucao') returning id`,
      [tenant],
    );
    const et = await pool.query(
      `insert into etiqueta (tenant_id, unidade_id, setor_id, funcao_id, sigla, contador)
       values ($1,$2,$3,$4,'CX',1) returning id`,
      [tenant, unidade, s.rows[0].id, fn.rows[0].id],
    );
    etiq = et.rows[0].id;
  });

  afterAll(async () => {
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  it('o id do TypeScript é IGUAL ao do SQL (senão cada lado geraria um id diferente)', async () => {
    const r = await pool.query(
      `select md5($1::text || coalesce($2::text,'') || $3::text)::uuid as id`,
      [def, unidade, '2026-09-20'],
    );
    expect(r.rows[0].id).toBe(idTarefaInstancia(def, unidade, '2026-09-20'));

    const r2 = await pool.query(
      `select md5($1::text || $2::text || $3::text || $4::text)::uuid as id`,
      [unidade, '2026-09-20', turnoId, colab],
    );
    expect(r2.rows[0].id).toBe(idEscalaAlocacao(unidade, '2026-09-20', turnoId, colab));
  }, 60000);

  it('a tarefa criada pelos DOIS lados vira uma linha só', async () => {
    const dia = '2026-09-22';
    const id = idTarefaInstancia(def, unidade, dia);
    // Lado A (servidor local) materializa o dia.
    await pool.query(
      `insert into tarefa_instancia (id, tenant_id, unidade_id, tarefa_def_id, data) values ($1,$2,$3,$4,$5)`,
      [id, tenant, unidade, def, dia],
    );
    // Lado B (nuvem) materializa o MESMO dia e a linha chega pelo sync (upsert por id).
    await pool.query(
      `insert into tarefa_instancia (id, tenant_id, unidade_id, tarefa_def_id, data, estado)
       values ($1,$2,$3,$4,$5,'pendente')
       on conflict (id) do update set estado = excluded.estado`,
      [id, tenant, unidade, def, dia],
    );
    const r = await pool.query(
      `select count(*)::int as n from tarefa_instancia where tarefa_def_id = $1 and data = $2 and deleted_at is null`,
      [def, dia],
    );
    expect(r.rows[0].n).toBe(1);
  }, 60000);

  it('a escala da mesma pessoa no mesmo turno vira uma linha só', async () => {
    const dia = '2026-09-23';
    const id = idEscalaAlocacao(unidade, dia, turnoId, colab);
    for (const tipo of ['titular', 'titular']) {
      await pool.query(
        `insert into escala_alocacao (id, tenant_id, unidade_id, data, turno_id, colaborador_id, tipo, etiqueta_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (id) do update set tipo = excluded.tipo`,
        [id, tenant, unidade, dia, turnoId, colab, tipo, etiq],
      );
    }
    const r = await pool.query(
      `select count(*)::int as n from escala_alocacao
        where data = $1 and turno_id = $2 and colaborador_id = $3 and deleted_at is null`,
      [dia, turnoId, colab],
    );
    expect(r.rows[0].n).toBe(1);
  }, 60000);

  it('duplicata por outro caminho (id diferente) é barrada pela chave única', async () => {
    const dia = '2026-09-24';
    await pool.query(
      `insert into tarefa_instancia (id, tenant_id, unidade_id, tarefa_def_id, data)
       values (gen_random_uuid(),$1,$2,$3,$4)`,
      [tenant, unidade, def, dia],
    );
    await expect(
      pool.query(
        `insert into tarefa_instancia (id, tenant_id, unidade_id, tarefa_def_id, data)
         values (gen_random_uuid(),$1,$2,$3,$4)`,
        [tenant, unidade, def, dia],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  }, 60000);

  it('vagas EM ABERTO (sem pessoa) convivem no mesmo turno — a chave nova não as barra', async () => {
    // A vaga é a etiqueta do dia (já existe a trava `uq_escala_etiqueta_dia`), então duas
    // vagas no mesmo turno são duas etiquetas. A chave de negócio nova ignora quem não tem
    // pessoa, justamente para não impedir isto.
    const dia = '2026-09-25';
    const s2 = await pool.query(
      `insert into setor (tenant_id, unidade_id, nome) values ($1,$2,'Salão') returning id`,
      [tenant, unidade],
    );
    const f2 = await pool.query(
      `insert into funcao (tenant_id, nome, categoria) values ($1,'Garçom','execucao') returning id`,
      [tenant],
    );
    const et2 = await pool.query(
      `insert into etiqueta (tenant_id, unidade_id, setor_id, funcao_id, sigla, contador)
       values ($1,$2,$3,$4,'GA',1) returning id`,
      [tenant, unidade, s2.rows[0].id, f2.rows[0].id],
    );
    for (const e of [etiq, et2.rows[0].id]) {
      await pool.query(
        `insert into escala_alocacao (tenant_id, unidade_id, data, turno_id, tipo, etiqueta_id)
         values ($1,$2,$3,$4,'titular',$5)`,
        [tenant, unidade, dia, turnoId, e],
      );
    }
    const r = await pool.query(
      `select count(*)::int as n from escala_alocacao
        where data = $1 and turno_id = $2 and colaborador_id is null`,
      [dia, turnoId],
    );
    expect(r.rows[0].n).toBe(2);
  }, 60000);
});
