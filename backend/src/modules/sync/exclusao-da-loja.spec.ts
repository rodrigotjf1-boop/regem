import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService } from './sync.service';
import { TABELAS_EXCLUIVEIS_PELA_LOJA, TABELAS_SYNC } from './sync-config';

/* eslint-disable @typescript-eslint/no-explicit-any */

// EXCLUSÃO QUE VEM DA LOJA (fase 3 do pedido de 23/10/2026). Numa tabela que só desce, a nuvem é a dona — mas a
// exclusão feita no servidor da loja (perfil removido, o apaga-e-insere dos vínculos de função e de colaborador no
// modo local) apagava a linha da NUVEM e ficava gravada no `sync_exclusao` daqui, descendo para as OUTRAS lojas da
// empresa. Agora a nuvem só aceita da loja exclusão em tabela de mão dupla ('ambos'). E a linha recusada pelo banco
// no envio (chave repetida, pai que não chegou) deixa de sumir calada: vai para o log com a regra que recusou.
// Postgres real (o push da nuvem).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('exclusao-da-loja.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

describe('exclusão aceita da loja — só tabela de mão dupla', () => {
  it('nenhuma tabela que só desce (nem empresa) aceita exclusão vinda da loja', () => {
    const soDesce = TABELAS_SYNC.filter((t) => t.direcao === 'desce').map((t) => t.tabela);
    expect(soDesce.length).toBeGreaterThan(10);
    for (const t of soDesce) expect([t, TABELAS_EXCLUIVEIS_PELA_LOJA.has(t)]).toEqual([t, false]);
    for (const t of ['perfil_acesso', 'colaborador', 'funcao_setor', 'colaborador_funcao', 'kds_alerta_config', 'empresa'])
      expect([t, TABELAS_EXCLUIVEIS_PELA_LOJA.has(t)]).toEqual([t, false]);
    for (const t of ['categoria_item', 'mesa', 'delivery_config', 'produto']) expect([t, TABELAS_EXCLUIVEIS_PELA_LOJA.has(t)]).toEqual([t, true]);
  });
});

descrever('exclusão vinda da loja e linha recusada no envio (push na nuvem)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });
  const exclusao = (tabela: string, registroId: string) => ({
    id: randomUUID(), tabela, registro_id: registroId, created_at: new Date().toISOString(),
  });
  const enviar = (tabela: string, linhas: any[]) => svc.push(ctx() as any, [{ tabela, linhas } as any]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste exclusao da loja')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`,
      [SERVIDOR, T, 'tok-servidor-' + SERVIDOR]);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (!pool) return;
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    for (const t of ['sync_exclusao', 'delivery_config', 'categoria_item', 'perfil_acesso', 'equipamento'])
      await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it('perfil removido no servidor da loja não apaga o da nuvem nem fica gravado para descer às outras lojas', async () => {
    const perfil = randomUUID();
    const categoria = randomUUID();
    await q(`insert into perfil_acesso (id, tenant_id, nome, nivel) values ($1,$2,'Caixa','execucao')`, [perfil, T]);
    await q(`insert into categoria_item (id, tenant_id, nome) values ($1,$2,'Bebidas')`, [categoria, T]);
    const doPerfil = exclusao('perfil_acesso', perfil);
    const daCategoria = exclusao('categoria_item', categoria);
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

    const r: any = await enviar('sync_exclusao', [doPerfil, daCategoria]);

    expect((await q('select 1 from perfil_acesso where id = $1', [perfil])).rowCount).toBe(1); // a nuvem é a dona
    expect((await q('select 1 from categoria_item where id = $1', [categoria])).rowCount).toBe(0); // mão dupla: vale
    const gravadas = (await q('select id from sync_exclusao where tenant_id = $1', [T])).rows.map((x) => x.id);
    expect(gravadas).toEqual([daCategoria.id]); // a do perfil não desce para as outras lojas
    expect(r.resultado.sync_exclusao).toEqual({ aplicadas: 1, ignoradas: 1 });
    expect((svc as any).logger.warn).toHaveBeenCalledWith(expect.stringMatching(/recusada.*perfil_acesso/));
  });

  it('exclusão de tabela fora do sincronismo também é recusada', async () => {
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    const r: any = await enviar('sync_exclusao', [exclusao('impressao_job', randomUUID())]);
    expect(r.resultado.sync_exclusao).toEqual({ aplicadas: 0, ignoradas: 1 });
  });

  it('linha recusada pelo banco no envio vai para o log com a regra (configuração da loja criada com outro id)', async () => {
    // A nuvem já tem a configuração da empresa; a loja criou a dela, com OUTRO id, para a mesma empresa e loja.
    await q(`insert into delivery_config (id, tenant_id, unidade_id) values ($1,$2,null)`, [randomUUID(), T]);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    const r: any = await enviar('delivery_config', [
      { id: randomUUID(), tenant_id: T, unidade_id: null, updated_at: new Date().toISOString() },
    ]);
    expect(r.resultado.delivery_config).toEqual({ aplicadas: 0, ignoradas: 1 });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/push delivery_config: .*1× 23505 \(uq_delivery_config_tenant_unidade\)/));
  });
});
