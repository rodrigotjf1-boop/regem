import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'reflect-metadata';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService } from './sync.service';
import { TABELAS_CADASTRO_DA_LOJA, TABELAS_SYNC, modoPush } from './sync-config';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { ModuloController } from '../modulo/modulo.controller';
import { EmpresaController } from '../empresa/empresa.controller';
import { FiscalController } from '../fiscal/fiscal.controller';
import { AuthController } from '../../auth/auth.controller';
import { PrefsService } from '../colaborador/prefs.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CADASTRO DA LOJA SOBE, COM TRAVAS (fase 3B, decisão do dono de 23/10/2026: "sobe também, com travas"). O cadastro
// editado no servidor da loja (loja, setor, função, perfil, colaborador, turno, etiqueta, alertas do KDS, fichas,
// variações, combos, os vínculos) passa a subir, a mais nova vence — mas a nuvem não aceita da loja: nível de presidente,
// o acesso pela nuvem, mudança no registro do presidente, desfazer bloqueio/desligamento/exclusão feitos aqui, loja
// nova ou apagada. Módulos, empresa e configuração fiscal continuam só da nuvem. Postgres real (o push da nuvem).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cadastro-sobe-com-travas.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

describe('cadastro da loja — direção e rotas', () => {
  it('o cadastro da fase 3B sobe (a mais nova vence); empresa, módulos e config fiscal continuam só descendo', () => {
    for (const t of TABELAS_CADASTRO_DA_LOJA) {
      expect([t, TABELAS_SYNC.find((x) => x.tabela === t)?.direcao]).toEqual([t, 'ambos']);
      expect([t, modoPush(t)]).toEqual([t, 'lww']);
    }
    for (const t of ['empresa', 'modulo_ativacao', 'fiscal_config'])
      expect([t, TABELAS_SYNC.find((x) => x.tabela === t)?.direcao]).toEqual([t, 'desce']);
  });

  it('as gravações que ficam só da nuvem são @CloudOnly (no servidor da loja respondem 404)', () => {
    const marcada = (cls: any, metodo: string) => Reflect.getMetadata(CLOUD_ONLY, cls.prototype[metodo]) === true;
    expect(marcada(ModuloController, 'setar')).toBe(true);
    expect(marcada(EmpresaController, 'atualizarConfig')).toBe(true);
    expect(marcada(FiscalController, 'setConfig')).toBe(true);
    expect(marcada(AuthController, 'register')).toBe(true);
    expect(marcada(AuthController, 'verificarCadastro')).toBe(true);
    // A leitura continua no servidor da loja.
    expect(marcada(ModuloController, 'meus')).toBe(false);
  });
});

descrever('cadastro da loja sobe com travas (push na nuvem)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });
  const enviar = (tabela: string, linhas: any[]) => svc.push(ctx() as any, [{ tabela, linhas } as any]);
  const agora = () => new Date().toISOString();
  const umaHoraAtras = () => new Date(Date.now() - 3600_000).toISOString();
  const um = async (s: string, p: any[]) => (await q(s, p)).rows[0];

  const ids: Record<string, string> = {};
  const perfil = async (nome: string, nivel: string) => {
    const id = randomUUID();
    await q(`insert into perfil_acesso (id, tenant_id, nome, nivel, updated_at) values ($1,$2,$3,$4,$5)`, [id, T, nome, nivel, umaHoraAtras()]);
    return id;
  };
  const funcao = async (nome: string, categoria: string) => {
    const id = randomUUID();
    await q(`insert into funcao (id, tenant_id, nome, categoria, updated_at) values ($1,$2,$3,$4,$5)`, [id, T, nome, categoria, umaHoraAtras()]);
    return id;
  };
  const colaborador = async (nome: string, o: { perfil?: string; funcao?: string; podeNuvem?: boolean; status?: string; senha?: string } = {}) => {
    const id = randomUUID();
    await q(
      `insert into colaborador (id, tenant_id, nome, perfil_acesso_id, funcao_id, pode_nuvem, status, senha_hash, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, T, nome, o.perfil ?? null, o.funcao ?? null, !!o.podeNuvem, o.status ?? 'ativo', o.senha ?? null, umaHoraAtras()],
    );
    return id;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste cadastro sobe')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`,
      [SERVIDOR, T, 'tok-servidor-' + SERVIDOR]);
    ids.loja = randomUUID();
    await q(`insert into unidade (id, tenant_id, nome, updated_at) values ($1,$2,'Loja 1',$3)`, [ids.loja, T, umaHoraAtras()]);
    ids.pPres = await perfil('Presidência', 'presidente');
    ids.pGer = await perfil('Gerência', 'gerente');
    ids.pExec = await perfil('Caixa', 'execucao');
    ids.fPres = await funcao('Dono', 'presidente');
    ids.fExec = await funcao('Cozinha', 'execucao');
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (!pool) return;
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    for (const t of ['sync_exclusao', 'colaborador', 'funcao', 'perfil_acesso', 'setor', 'unidade', 'equipamento'])
      await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });
  beforeEach(() => jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined));

  it('cadastro comum sobe; o acesso pela nuvem fica o daqui (nem liga, nem desliga pela loja)', async () => {
    const ana = await colaborador('Ana', { perfil: ids.pExec });
    const gil = await colaborador('Gil', { perfil: ids.pGer, podeNuvem: true });
    await enviar('colaborador', [
      { id: ana, nome: 'Ana Souza', perfil_acesso_id: ids.pExec, pode_nuvem: true, status: 'ativo', updated_at: agora() },
      { id: gil, nome: 'Gil', perfil_acesso_id: ids.pGer, pode_nuvem: false, status: 'ativo', updated_at: agora() },
    ]);
    expect(await um('select nome, pode_nuvem from colaborador where id = $1', [ana])).toEqual({ nome: 'Ana Souza', pode_nuvem: false });
    expect((await um('select pode_nuvem from colaborador where id = $1', [gil])).pode_nuvem).toBe(true);
  });

  it('colaborador novo vindo da loja entra, mas sem o acesso pela nuvem', async () => {
    const novo = randomUUID();
    await enviar('colaborador', [{ id: novo, nome: 'Bia', perfil_acesso_id: ids.pExec, pode_nuvem: true, status: 'ativo', updated_at: agora() }]);
    expect(await um('select nome, pode_nuvem from colaborador where id = $1', [novo])).toEqual({ nome: 'Bia', pode_nuvem: false });
  });

  it('o registro do presidente não muda pela loja — nem a senha', async () => {
    const dono = await colaborador('Dono', { perfil: ids.pPres, podeNuvem: true, senha: 'hash-do-dono' });
    const r: any = await enviar('colaborador', [
      { id: dono, nome: 'Dono', perfil_acesso_id: ids.pPres, pode_nuvem: true, status: 'ativo', senha_hash: 'hash-forjado', updated_at: agora() },
    ]);
    expect((await um('select senha_hash from colaborador where id = $1', [dono])).senha_hash).toBe('hash-do-dono');
    expect(r.resultado.colaborador).toEqual({ aplicadas: 0, ignoradas: 1 });
    expect((svc as any).logger.warn).toHaveBeenCalledWith(expect.stringMatching(/travas do cadastro.*registro do presidente/));
  });

  it('ninguém vira presidente pela loja — pelo perfil nem pela função', async () => {
    const caio = await colaborador('Caio', { perfil: ids.pExec });
    const novo = randomUUID();
    const r: any = await enviar('colaborador', [
      { id: caio, nome: 'Caio', perfil_acesso_id: ids.pPres, status: 'ativo', updated_at: agora() },
      { id: novo, nome: 'Intruso', perfil_acesso_id: null, funcao_id: ids.fPres, status: 'ativo', updated_at: agora() },
    ]);
    expect((await um('select perfil_acesso_id from colaborador where id = $1', [caio])).perfil_acesso_id).toBe(ids.pExec);
    expect((await q('select 1 from colaborador where id = $1', [novo])).rowCount).toBe(0);
    expect(r.resultado.colaborador).toEqual({ aplicadas: 0, ignoradas: 2 });
  });

  it('perfil: o nível não muda pela loja, e o perfil do presidente não muda nada', async () => {
    let r: any = await enviar('perfil_acesso', [{ id: ids.pGer, nome: 'Gerência', nivel: 'presidente', updated_at: agora() }]);
    expect(r.resultado.perfil_acesso).toEqual({ aplicadas: 0, ignoradas: 1 });
    r = await enviar('perfil_acesso', [{ id: ids.pGer, nome: 'Gerência geral', nivel: 'supervisao', updated_at: agora() }]);
    expect(await um('select nome, nivel from perfil_acesso where id = $1', [ids.pGer])).toEqual({ nome: 'Gerência geral', nivel: 'gerente' });
    r = await enviar('perfil_acesso', [{ id: ids.pPres, nome: 'Outro', nivel: 'presidente', permissoes: {}, updated_at: agora() }]);
    expect((await um('select nome from perfil_acesso where id = $1', [ids.pPres])).nome).toBe('Presidência');
    expect(r.resultado.perfil_acesso).toEqual({ aplicadas: 0, ignoradas: 1 });
    // A cópia do perfil do presidente "rebaixada" (nível de gerente) também não passa — senão o nível ficaria, mas o nome
    // e as permissões do perfil do presidente mudariam pela loja.
    r = await enviar('perfil_acesso', [{ id: ids.pPres, nome: 'Rebaixado', nivel: 'gerente', permissoes: {}, updated_at: agora() }]);
    expect((await um('select nome from perfil_acesso where id = $1', [ids.pPres])).nome).toBe('Presidência');
    expect(r.resultado.perfil_acesso).toEqual({ aplicadas: 0, ignoradas: 1 });
  });

  it('função: não vira nem deixa de ser de presidente pela loja; o resto sobe', async () => {
    const r: any = await enviar('funcao', [
      { id: ids.fExec, nome: 'Cozinha', categoria: 'presidente', updated_at: agora() },
      { id: ids.fPres, nome: 'Dono', categoria: 'gerente', updated_at: agora() },
    ]);
    expect(r.resultado.funcao).toEqual({ aplicadas: 0, ignoradas: 2 });
    expect((await um('select categoria::text as c from funcao where id = $1', [ids.fPres])).c).toBe('presidente');
    await enviar('funcao', [{ id: ids.fExec, nome: 'Cozinha quente', categoria: 'execucao', updated_at: agora() }]);
    expect((await um('select nome from funcao where id = $1', [ids.fExec])).nome).toBe('Cozinha quente');
  });

  it('bloqueado ou desligado na nuvem não volta a ativo por uma cópia velha da loja', async () => {
    const duda = await colaborador('Duda', { perfil: ids.pExec, status: 'bloqueado' });
    let r: any = await enviar('colaborador', [{ id: duda, nome: 'Duda', perfil_acesso_id: ids.pExec, status: 'ativo', telefone: '21000', updated_at: agora() }]);
    expect(r.resultado.colaborador).toEqual({ aplicadas: 0, ignoradas: 1 });
    expect((await um('select status from colaborador where id = $1', [duda])).status).toBe('bloqueado');
    // A cópia que já sabe do bloqueio sobe normalmente.
    r = await enviar('colaborador', [{ id: duda, nome: 'Duda', perfil_acesso_id: ids.pExec, status: 'bloqueado', telefone: '21999', updated_at: agora() }]);
    expect(await um('select status, telefone from colaborador where id = $1', [duda])).toEqual({ status: 'bloqueado', telefone: '21999' });
  });

  it('o que a nuvem excluiu (exclusão lógica) não ressuscita por uma cópia da loja', async () => {
    const setor = randomUUID();
    await q(`insert into setor (id, tenant_id, unidade_id, nome, deleted_at, updated_at) values ($1,$2,$3,'Bar',now(),$4)`,
      [setor, T, ids.loja, umaHoraAtras()]);
    await enviar('setor', [{ id: setor, unidade_id: ids.loja, nome: 'Bar novo', deleted_at: null, updated_at: agora() }]);
    const s = await um('select nome, deleted_at from setor where id = $1', [setor]);
    expect(s.nome).toBe('Bar');
    expect(s.deleted_at).not.toBeNull();
  });

  it('loja nova e loja apagada só pela nuvem; a loja que existe pode ser editada', async () => {
    const nova = randomUUID();
    let r: any = await enviar('unidade', [{ id: nova, nome: 'Loja 2', updated_at: agora() }]);
    expect(r.resultado.unidade).toEqual({ aplicadas: 0, ignoradas: 1 });
    expect((await q('select 1 from unidade where id = $1', [nova])).rowCount).toBe(0);
    r = await enviar('unidade', [{ id: ids.loja, nome: 'Loja 1', deleted_at: agora(), updated_at: agora() }]);
    expect(r.resultado.unidade).toEqual({ aplicadas: 0, ignoradas: 1 });
    expect((await um('select deleted_at from unidade where id = $1', [ids.loja])).deleted_at).toBeNull();
    await enviar('unidade', [{ id: ids.loja, nome: 'Loja Centro', updated_at: agora() }]);
    expect((await um('select nome from unidade where id = $1', [ids.loja])).nome).toBe('Loja Centro');
  });

  it('exclusão vinda da loja: o perfil e o registro do presidente e as lojas ficam; o resto vale', async () => {
    const dono = await colaborador('Dono 2', { perfil: ids.pPres });
    const pAvulso = await perfil('Supervisão', 'supervisao');
    const exc = (tabela: string, registroId: string) => ({ id: randomUUID(), tabela, registro_id: registroId, created_at: agora() });
    const r: any = await enviar('sync_exclusao', [
      exc('perfil_acesso', ids.pPres),
      exc('colaborador', dono),
      exc('unidade', ids.loja),
      exc('perfil_acesso', pAvulso),
    ]);
    expect((await q('select 1 from perfil_acesso where id = $1', [ids.pPres])).rowCount).toBe(1);
    expect((await q('select 1 from colaborador where id = $1', [dono])).rowCount).toBe(1);
    expect((await q('select 1 from unidade where id = $1', [ids.loja])).rowCount).toBe(1);
    expect((await q('select 1 from perfil_acesso where id = $1', [pAvulso])).rowCount).toBe(0);
    expect(r.resultado.sync_exclusao).toEqual({ aplicadas: 1, ignoradas: 3 });
  });

  it('a preferência de tela não conta como edição do cadastro (a data do colaborador não muda)', async () => {
    const eva = await colaborador('Eva', { perfil: ids.pExec });
    const antes = (await um('select updated_at from colaborador where id = $1', [eva])).updated_at;
    await new PrefsService(drizzle(pool, { schema }) as any).patch(T, eva, { sidebar: 'collapsed' });
    const depois = await um('select updated_at, ui_prefs from colaborador where id = $1', [eva]);
    expect(depois.ui_prefs).toEqual({ sidebar: 'collapsed' });
    expect(new Date(depois.updated_at).toISOString()).toBe(new Date(antes).toISOString());
  });
});

// O OUTRO LADO — o servidor da loja recebendo da nuvem (pull do sync-daemon): o que a nuvem bloqueou ou excluiu vale lá
// mesmo com a cópia local "mais nova" (a nuvem recusa a cópia da loja; sem isto a pessoa seguiria ativa na loja). A regra
// mora em `condicaoSobrescrever`, avaliada a partir do TEXTO do daemon (como em cartao-estado-final.spec).
const FONTE_DAEMON = readFileSync(join(__dirname, '..', '..', '..', 'edge', 'sync-daemon.mjs'), 'utf8').replace(/\r\n/g, '\n');
function condicaoDoDaemon(): (tabela: string, cols: Set<string>) => string {
  const i = FONTE_DAEMON.indexOf('function condicaoSobrescrever(');
  if (i < 0) throw new Error('não achei condicaoSobrescrever no sync-daemon.mjs');
  const funcao = FONTE_DAEMON.slice(i, FONTE_DAEMON.indexOf('\n}\n', i) + 3);
  const q = FONTE_DAEMON.match(/^const q = .*$/m)?.[0];
  const terminais = FONTE_DAEMON.match(/^const ESTADOS_TERMINAIS = .*$/m)?.[0];
  if (!q || !terminais) throw new Error('sync-daemon.mjs mudou: q / ESTADOS_TERMINAIS não encontrados');
  return new Function(`${q}\n${terminais}\n${funcao}\nreturn condicaoSobrescrever;`)();
}

describe('o servidor da loja recebendo o cadastro da nuvem — a lista do daemon', () => {
  it('a lista do cadastro dentro de condicaoSobrescrever é a mesma do sync-config', () => {
    const i = FONTE_DAEMON.indexOf('function condicaoSobrescrever(');
    const trecho = FONTE_DAEMON.slice(i, FONTE_DAEMON.indexOf('].includes(tabela);', i));
    const lista = [...trecho.slice(trecho.indexOf('const cadastro = [')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...lista].sort()).toEqual([...TABELAS_CADASTRO_DA_LOJA].sort());
  });
});

descrever('o servidor da loja recebendo o cadastro da nuvem (pull)', () => {
  let pool: Pool;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const esquema = `teste_cadastro_${Date.now()}`;
  let condicao: string;
  const aplicar = (l: { id: string; status: string; deleted_at: Date | null; updated_at: Date }) =>
    q(
      `insert into colaborador (id, status, deleted_at, updated_at) values ($1,$2,$3,$4)
       on conflict (id) do update set status = excluded.status, deleted_at = excluded.deleted_at,
         updated_at = excluded.updated_at${condicao}`,
      [l.id, l.status, l.deleted_at, l.updated_at],
    );
  const ler = async (id: string) => (await q('select status, deleted_at from colaborador where id = $1', [id]))[0];
  const antes = () => new Date(Date.now() - 3600_000);

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${esquema}` });
    await q(`create schema ${esquema}`);
    await q(`create table colaborador (id uuid primary key, status text not null, deleted_at timestamptz, updated_at timestamptz)`);
    condicao = condicaoDoDaemon()('colaborador', new Set(['id', 'status', 'deleted_at', 'updated_at']));
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`drop schema if exists ${esquema} cascade`).catch(() => undefined);
    await pool.end();
  });

  it('bloqueio da nuvem vale na loja mesmo com a cópia local mais nova', async () => {
    const id = randomUUID();
    await aplicar({ id, status: 'ativo', deleted_at: null, updated_at: new Date() }); // a loja mexeu depois
    await aplicar({ id, status: 'bloqueado', deleted_at: null, updated_at: antes() }); // o bloqueio da nuvem, mais velho
    expect((await ler(id)).status).toBe('bloqueado');
  });

  it('exclusão da nuvem vale na loja mesmo com a cópia local mais nova', async () => {
    const id = randomUUID();
    await aplicar({ id, status: 'ativo', deleted_at: null, updated_at: new Date() });
    await aplicar({ id, status: 'ativo', deleted_at: antes(), updated_at: antes() });
    expect((await ler(id)).deleted_at).not.toBeNull();
  });

  it('o resto segue pela data: o bloqueio feito na loja não é desfeito por uma cópia mais velha da nuvem', async () => {
    const id = randomUUID();
    await aplicar({ id, status: 'bloqueado', deleted_at: null, updated_at: new Date() });
    await aplicar({ id, status: 'ativo', deleted_at: null, updated_at: antes() });
    expect((await ler(id)).status).toBe('bloqueado');
  });
});
