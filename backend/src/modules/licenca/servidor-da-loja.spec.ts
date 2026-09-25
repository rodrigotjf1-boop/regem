import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { LicencaService } from './licenca.service';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { hashCodigoReauth } from './reauth-instalacao';
import { escolherServidorDaLoja } from './servidor-da-loja';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A chave de licença não entra no teste: o que se prova é QUAL equipamento a instalação e a
// re-autorização usam, não a assinatura do lease.
jest.mock('./lease', () => ({
  ...jest.requireActual('./lease'),
  licencaConfigurada: () => true,
  assinarLease: () => 'lease-de-teste',
}));

// QUAL `servidor_local` É O DESTA INSTALAÇÃO (ERR-108) — contra o Postgres de verdade.
//
// O piloto tem 6 `servidor_local`: servidores de loja, sobras de instalação que nunca
// sincronizaram, e a credencial do GoGeM (que também é um `servidor_local`). A instalação pegava
// "o primeiro" e religava todos; a re-autorização girava o mais recente — que podia ser o do
// GoGeM, e aí a venda do totem e o cardápio dele paravam com 401.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('servidor-da-loja.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const SENHA = 'Senha-Da-Dona-1';
const MIG = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');

descrever('qual servidor_local é o desta instalação (ERR-108)', () => {
  // A licença (`ativacao` completa, `reautorizacao_edge`) é só da NUVEM (migs 082 e 220), e o banco
  // do CI é montado como servidor de loja. As duas vêm das migrations de verdade, num schema só
  // deste teste, na frente do `public` — o resto (empresa, equipamento…) é o de sempre, e nenhuma
  // outra spec enxerga as cópias.
  const SCHEMA = `teste_licenca_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  const db = drizzle(pool) as any;
  const equip = new EquipamentoService(db, { registrar: async () => {} } as any);
  const svc = new LicencaService(db, equip, {} as any);
  (svc as any).statusConta = async () => ({ ativa: true });
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;

  // Sem a FK para a `empresa` COMPARTILHADA: com ela, o `delete from empresa` em cascata das outras
  // specs passava por estas cópias, e o `drop schema` do fim entrava em impasse com ele (deadlock).
  const semFkParaEmpresa = (s: string) =>
    s.replace(/\s+references\s+empresa\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // instalação e re-autorização são da NUVEM
    await pool.query(`create schema ${SCHEMA}`);
    await pool.query(semFkParaEmpresa(readFileSync(join(MIG, '082_licenca_revenda.sql'), 'utf8')));
    await pool.query(semFkParaEmpresa(readFileSync(join(MIG, '220_edge_reautorizacao_instalacao.sql'), 'utf8')));
    const [fk] = await q(
      `select count(*)::int n from pg_constraint c join pg_namespace s on s.oid = c.connamespace
        where s.nspname = $1 and c.contype = 'f' and c.confrelid = 'public.empresa'::regclass`,
      [SCHEMA],
    );
    if (fk.n) throw new Error('as cópias da licença ainda apontam para a empresa compartilhada — ajuste semFkParaEmpresa');
  }, 60_000);
  afterAll(async () => {
    if (edgeOriginal !== undefined) process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  }, 120_000);

  async function servidor(
    t: string,
    u: string | null,
    nome: string,
    o: { pushDiasAtras?: number; criadoDiasAtras: number; integrador?: string; fingerprint?: string; ativo?: boolean },
  ) {
    const token = randomBytes(24).toString('hex');
    const [e] = await q(
      `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo, integrador, fingerprint,
                                last_push_ts, created_at)
       values ($1,$2,$3,'servidor_local',$4,$5,$6,$7,
               case when $8::int is null then null else now() - make_interval(days => $8::int) end,
               now() - make_interval(days => $9::int))
       returning id`,
      [t, u, nome, token, o.ativo ?? true, o.integrador ?? null, o.fingerprint ?? null, o.pushDiasAtras ?? null, o.criadoDiasAtras],
    );
    return { id: e.id as string, token };
  }

  /** O piloto: 3 servidores de loja (um da rede), 2 sobras que nunca sincronizaram e o GoGeM. */
  async function piloto() {
    const t = (await q(`insert into empresa (nome) values ('Teste servidor da loja') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Mister Burguer Steakhouse') returning id`, [t]))[0].id;
    const u2 = (await q(`insert into unidade (tenant_id, nome) values ($1,'Outra loja') returning id`, [t]))[0].id;
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Dona','presidente') returning id`, [t]))[0].id;
    const email = `dona-${randomUUID()}@teste.regem`;
    await q(`insert into colaborador (tenant_id, nome, funcao_id, email, senha_hash) values ($1,'Dona',$2,$3,$4)`, [
      t,
      funcao,
      email,
      await bcrypt.hash(SENHA, 4),
    ]);
    const s = {
      lojaTeste: await servidor(t, u, 'Servidor loja teste', { pushDiasAtras: 2, criadoDiasAtras: 20 }),
      rodrigo: await servidor(t, u, 'Rodrigo server', { pushDiasAtras: 22, criadoDiasAtras: 30 }),
      rede: await servidor(t, null, 'Mister Burguer ', { pushDiasAtras: 24, criadoDiasAtras: 40 }),
      sobra1: await servidor(t, u, 'Mister Burguer Steakhouse', { criadoDiasAtras: 10 }),
      gogem: await servidor(t, u, 'Mister Burguer Steakhouse', { criadoDiasAtras: 12, integrador: 'gogem' }),
      sobra2: await servidor(t, u, 'Servidor mister', { criadoDiasAtras: 1 }),
    };
    return { t, u, u2, email, s };
  }

  const equipamentoDe = async (id: string) => (await q(`select * from equipamento where id = $1`, [id]))[0];

  it('sem máquina ligada: o servidor de LOJA com o push mais recente — nunca o do GoGeM nem a sobra que nunca sincronizou', async () => {
    const p = await piloto();
    expect((await escolherServidorDaLoja(db, p.t, { unidadeId: p.u }))?.id).toBe(p.s.lojaTeste.id);
  });

  it('a máquina ligada (fingerprint) vence o push mais recente', async () => {
    const p = await piloto();
    await q(`update equipamento set fingerprint = 'fp-maquina-rodrigo' where id = $1`, [p.s.rodrigo.id]);
    const e = await escolherServidorDaLoja(db, p.t, { fingerprint: 'fp-maquina-rodrigo', unidadeId: p.u });
    expect(e?.id).toBe(p.s.rodrigo.id);
  });

  it('outra loja: só o servidor dela ou o da rede — nunca o de outra loja', async () => {
    const p = await piloto();
    expect((await escolherServidorDaLoja(db, p.t, { unidadeId: p.u2 }))?.id).toBe(p.s.rede.id);
  });

  it('empresa só com a credencial do GoGeM e sobras: nenhum servidor para reusar', async () => {
    const t = (await q(`insert into empresa (nome) values ('Só GoGeM') returning id`))[0].id as string;
    empresas.push(t);
    await servidor(t, null, 'GoGeM', { criadoDiasAtras: 5, integrador: 'gogem' });
    await servidor(t, null, 'Sobra', { criadoDiasAtras: 1 });
    expect(await escolherServidorDaLoja(db, t, {})).toBeNull();
  });

  it('instalar: reusa o servidor de loja e o liga à máquina — sem religar os desativados, o do GoGeM fica como está', async () => {
    const p = await piloto();
    await q(`update equipamento set ativo = false, revogado_em = now() where id = any($1::uuid[])`, [
      [p.s.sobra1.id, p.s.rodrigo.id],
    ]);
    const r: any = await svc.instalarSelfService({ email: p.email, senha: SENHA, fingerprint: `fp-${randomUUID()}`, unidadeId: p.u });

    expect(r.syncToken).toBe(p.s.lojaTeste.token);
    const escolhido = await equipamentoDe(p.s.lojaTeste.id);
    expect(escolhido.ativo).toBe(true);
    expect(escolhido.fingerprint).toMatch(/^fp-/); // ligado a esta máquina: a próxima instalação o acha
    // Antes: "update ... where tenant and tipo='servidor_local'" religava TODOS.
    expect((await equipamentoDe(p.s.sobra1.id)).ativo).toBe(false);
    expect((await equipamentoDe(p.s.rodrigo.id)).ativo).toBe(false);
    const gogem = await equipamentoDe(p.s.gogem.id);
    expect(gogem.token).toBe(p.s.gogem.token);
    expect(gogem.fingerprint).toBeNull();
    expect((await q(`select count(*)::int n from equipamento where tenant_id = $1 and tipo = 'servidor_local'`, [p.t]))[0].n).toBe(6);
  });

  it('servidor DESATIVADO de outra máquina não volta a valer numa instalação (pode ser a máquina roubada)', async () => {
    const p = await piloto();
    await q(`update equipamento set ativo = false, revogado_em = now() where id = $1`, [p.s.lojaTeste.id]);
    const r: any = await svc.instalarSelfService({ email: p.email, senha: SENHA, fingerprint: `fp-${randomUUID()}`, unidadeId: p.u });

    expect(r.syncToken).not.toBe(p.s.lojaTeste.token);
    expect(r.syncToken).toBe(p.s.rodrigo.token); // o servidor de loja ATIVO da mesma loja
    expect((await equipamentoDe(p.s.lojaTeste.id)).ativo).toBe(false);
  });

  it('a MESMA máquina reinstalando cura o servidor dela, mesmo desativado', async () => {
    const p = await piloto();
    const fp = `fp-${randomUUID()}`;
    await q(`update equipamento set ativo = false, revogado_em = now(), fingerprint = $2 where id = $1`, [p.s.lojaTeste.id, fp]);
    const r: any = await svc.instalarSelfService({ email: p.email, senha: SENHA, fingerprint: fp, unidadeId: p.u });

    expect(r.syncToken).toBe(p.s.lojaTeste.token);
    const curado = await equipamentoDe(p.s.lojaTeste.id);
    expect(curado.ativo).toBe(true);
    expect(curado.revogado_em).toBeNull();
  });

  it('instalar numa empresa só com a credencial do GoGeM: cria um servidor novo e não toca no do GoGeM', async () => {
    const t = (await q(`insert into empresa (nome) values ('Instalação nova') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id;
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Dona','presidente') returning id`, [t]))[0].id;
    const email = `dona-${randomUUID()}@teste.regem`;
    await q(`insert into colaborador (tenant_id, nome, funcao_id, email, senha_hash) values ($1,'Dona',$2,$3,$4)`, [
      t,
      funcao,
      email,
      await bcrypt.hash(SENHA, 4),
    ]);
    const gogem = await servidor(t, u, 'GoGeM', { criadoDiasAtras: 3, integrador: 'gogem' });

    const r: any = await svc.instalarSelfService({ email, senha: SENHA, fingerprint: `fp-${randomUUID()}` });

    expect(r.syncToken).not.toBe(gogem.token);
    const todos = await q(`select id, token, fingerprint from equipamento where tenant_id = $1 and tipo = 'servidor_local'`, [t]);
    expect(todos).toHaveLength(2);
    const novo = todos.find((e: any) => e.id !== gogem.id);
    expect(novo.token).toBe(r.syncToken);
    expect(novo.fingerprint).toMatch(/^fp-/);
    expect((await equipamentoDe(gogem.id)).token).toBe(gogem.token);
  });

  it('re-autorizar: gira o token do servidor da máquina ANTIGA — nunca o do GoGeM, mesmo sendo ele o mais novo', async () => {
    const p = await piloto();
    // O GoGeM passa a ser o servidor_local MAIS RECENTE — o que a rotação antiga pegava.
    await q(`update equipamento set created_at = now() where id = $1`, [p.s.gogem.id]);
    await q(`update equipamento set fingerprint = 'fp-maquina-antiga' where id = $1`, [p.s.rodrigo.id]);
    await q(
      `insert into ativacao (tenant_id, token_hash, status, device_fingerprint, reauth_ativo, reauth_metodo)
       values ($1,$2,'ativado','fp-maquina-antiga',true,'email')`,
      [p.t, randomUUID()],
    );
    await q(
      `insert into reautorizacao_edge (tenant_id, unidade_id, fingerprint_novo, metodo, codigo_hash, expira_em, status)
       values ($1,$2,'fp-maquina-nova','email',$3, now() + interval '5 minutes','pendente')`,
      [p.t, p.u, hashCodigoReauth('123456')],
    );

    const r: any = await svc.reautorizarConfirmar({ email: p.email, senha: SENHA, fingerprint: 'fp-maquina-nova', codigo: '123456' });

    const movido = await equipamentoDe(p.s.rodrigo.id);
    expect(movido.token).toBe(r.syncToken);
    expect(movido.token).not.toBe(p.s.rodrigo.token);
    expect(movido.fingerprint).toBe('fp-maquina-nova');
    expect(r.unidadeId).toBe(p.u);
    expect((await equipamentoDe(p.s.gogem.id)).token).toBe(p.s.gogem.token); // o GoGeM segue vendendo
    expect((await equipamentoDe(p.s.lojaTeste.id)).token).toBe(p.s.lojaTeste.token);
  });

  it('pedido de re-autorização: a loja vem do servidor que vai ser movido', async () => {
    const p = await piloto();
    await q(`update equipamento set unidade_id = $2 where id = $1`, [p.s.lojaTeste.id, p.u2]);
    await q(`update equipamento set fingerprint = 'fp-da-loja-2' where id = $1`, [p.s.lojaTeste.id]);
    await q(
      `insert into ativacao (tenant_id, token_hash, status, device_fingerprint, reauth_ativo, reauth_metodo)
       values ($1,$2,'ativado','fp-da-loja-2',true,'email')`,
      [p.t, randomUUID()],
    );

    await svc.reautorizarSolicitar({ email: p.email, senha: SENHA, fingerprint: 'fp-outra-maquina' });

    const [pedido] = await q(`select unidade_id from reautorizacao_edge where tenant_id = $1`, [p.t]);
    expect(pedido.unidade_id).toBe(p.u2);
  });
});
