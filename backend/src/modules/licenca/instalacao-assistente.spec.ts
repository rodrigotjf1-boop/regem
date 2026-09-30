import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { LicencaService, JANELA_CODIGO_CONFERIDO_MS } from './licenca.service';
import { EquipamentoService } from '../equipamento/equipamento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A chave de licença não entra no teste: o que se prova é a ordem das decisões, não o lease.
jest.mock('./lease', () => ({
  ...jest.requireActual('./lease'),
  licencaConfigurada: () => true,
  assinarLease: () => 'lease-de-teste',
}));

// O código que iria por e-mail fica guardado aqui (o teste digita o que o dono receberia).
const codigosEnviados: string[] = [];
jest.mock('../../common/mailer', () => ({
  ...jest.requireActual('../../common/mailer'),
  enviarCodigoVerificacao: async (_para: string, _nome: string, codigo: string) => {
    codigosEnviados.push(codigo);
    return true;
  },
}));

// O CÓDIGO DA TRAVA NO ASSISTENTE DO INSTALADOR (ERR-124) — contra o Postgres de verdade.
//
// Na loja (29/09), o código só era pedido no fim do script, 14 minutos depois de começar; ele
// vale 10 e venceu. Agora o assistente pergunta ANTES de copiar: /provisionamento/verificar diz o
// que a máquina vai encontrar (sem efeito), /reautorizar/verificar confere o código SEM mover, e o
// /reautorizar/confirmar sem código faz o move no fim com o pedido conferido. O que estes testes
// guardam: nada disso mexe na máquina antiga antes da hora, o pedido conferido é desta máquina e
// vence, e o instalador antigo (confirmar COM código) segue funcionando.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('instalacao-assistente.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const SENHA = 'Senha-Do-Dono-1';
const MIG = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');

descrever('código da trava no assistente do instalador (ERR-124)', () => {
  // `ativacao` e `reautorizacao_edge` são só da NUVEM (migs 082 e 220) e o banco do CI é montado
  // como servidor de loja: as duas vêm das migrations de verdade, num schema só deste teste, sem a
  // FK para a `empresa` compartilhada (ERR-109) — mesmo arranjo do servidor-da-loja.spec.
  const SCHEMA = `teste_assistente_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  const db = drizzle(pool) as any;
  const equip = new EquipamentoService(db, { registrar: async () => {} } as any);
  const svc = new LicencaService(db, equip, {} as any);
  (svc as any).statusConta = async () => ({ ativa: true });
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;

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

  /**
   * Uma empresa com servidor de loja na máquina `fp-antiga-*`, ativação ligada a ela e a trava
   * (`reauth_ativo`) como pedido. `lojas` > 1 cria mais unidades (a primeira é a matriz).
   */
  async function empresaComServidor(o: { trava: boolean; lojas?: number }) {
    const t = (await q(`insert into empresa (nome) values ('Teste assistente do instalador') returning id`))[0].id as string;
    empresas.push(t);
    const unidades: string[] = [];
    for (let i = 0; i < (o.lojas ?? 1); i++) {
      const [u] = await q(`insert into unidade (tenant_id, nome, tipo) values ($1,$2,$3) returning id`, [
        t,
        i === 0 ? 'Matriz' : `Loja ${i + 1}`,
        i === 0 ? 'matriz' : 'filial',
      ]);
      unidades.push(u.id);
    }
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Dono','presidente') returning id`, [t]))[0].id;
    const email = `dono-${randomUUID()}@teste.regem`;
    await q(`insert into colaborador (tenant_id, nome, funcao_id, email, senha_hash) values ($1,'Dono',$2,$3,$4)`, [
      t,
      funcao,
      email,
      await bcrypt.hash(SENHA, 4),
    ]);
    const fpAntiga = `fp-antiga-${randomUUID()}`;
    const token = randomBytes(24).toString('hex');
    const [srv] = await q(
      `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo, fingerprint, last_push_ts)
       values ($1,$2,'Servidor da loja','servidor_local',$3,true,$4, now() - interval '1 hour') returning id`,
      [t, unidades[0], token, fpAntiga],
    );
    await q(
      `insert into ativacao (tenant_id, token_hash, status, device_fingerprint, reauth_ativo, reauth_metodo)
       values ($1,$2,'ativado',$3,$4,'email')`,
      [t, randomUUID(), fpAntiga, o.trava],
    );
    return { t, unidades, email, fpAntiga, servidor: { id: srv.id as string, token } };
  }

  const equipamentoDe = async (id: string) => (await q(`select * from equipamento where id = $1`, [id]))[0];
  const ativacaoDe = async (t: string) => (await q(`select * from ativacao where tenant_id = $1`, [t]))[0];
  const pedidosDe = async (t: string) =>
    q(`select * from reautorizacao_edge where tenant_id = $1 order by criado_em`, [t]);

  /** Pede o código como o assistente e devolve o que o dono recebeu por e-mail. */
  async function pedirCodigo(email: string, fingerprint: string): Promise<string> {
    const antes = codigosEnviados.length;
    await svc.reautorizarSolicitar({ email, senha: SENHA, fingerprint, metodo: 'email' });
    expect(codigosEnviados.length).toBe(antes + 1);
    return codigosEnviados[codigosEnviados.length - 1];
  }

  it('máquina liberada: "pronto", e a verificação não mexe em nada', async () => {
    const e = await empresaComServidor({ trava: false });
    const antesEq = await equipamentoDe(e.servidor.id);
    const antesAt = await ativacaoDe(e.t);

    const r: any = await svc.verificarInstalacao({ email: e.email, senha: SENHA, fingerprint: 'fp-maquina-nova' });

    expect(r).toEqual({ situacao: 'pronto' });
    const depoisEq = await equipamentoDe(e.servidor.id);
    expect([depoisEq.token, depoisEq.fingerprint, depoisEq.ativo]).toEqual([antesEq.token, antesEq.fingerprint, antesEq.ativo]);
    const depoisAt = await ativacaoDe(e.t);
    expect([depoisAt.device_fingerprint, depoisAt.status]).toEqual([antesAt.device_fingerprint, antesAt.status]);
    expect((await q(`select count(*)::int n from equipamento where tenant_id = $1`, [e.t]))[0].n).toBe(1);
  });

  it('empresa com duas lojas: primeiro a escolha da loja; escolhida, segue a avaliação', async () => {
    const e = await empresaComServidor({ trava: true, lojas: 2 });

    const r1: any = await svc.verificarInstalacao({ email: e.email, senha: SENHA, fingerprint: 'fp-maquina-nova' });
    expect(r1.situacao).toBe('escolher_loja');
    expect(r1.unidades).toEqual([
      { id: e.unidades[0], nome: 'Matriz', matriz: true },
      { id: e.unidades[1], nome: 'Loja 2', matriz: false },
    ]);

    const r2: any = await svc.verificarInstalacao({
      email: e.email,
      senha: SENHA,
      fingerprint: 'fp-maquina-nova',
      unidadeId: e.unidades[1],
    });
    expect(r2.situacao).toBe('codigo');
  });

  it('loja de outra empresa não passa', async () => {
    const e = await empresaComServidor({ trava: false });
    const outra = await empresaComServidor({ trava: false });
    await expect(
      svc.verificarInstalacao({ email: e.email, senha: SENHA, fingerprint: 'fp-x', unidadeId: outra.unidades[0] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('senha errada: 401, antes de qualquer coisa', async () => {
    const e = await empresaComServidor({ trava: true });
    await expect(
      svc.verificarInstalacao({ email: e.email, senha: 'errada', fingerprint: 'fp-maquina-nova' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('trava ligada e outra máquina: "codigo"; a MESMA máquina reinstalando segue "pronto"', async () => {
    const e = await empresaComServidor({ trava: true });
    const r: any = await svc.verificarInstalacao({ email: e.email, senha: SENHA, fingerprint: 'fp-maquina-nova' });
    expect(r).toEqual({ situacao: 'codigo', metodoPreferido: 'email', temTotp: false, jaConferido: false });

    const mesma: any = await svc.verificarInstalacao({ email: e.email, senha: SENHA, fingerprint: e.fpAntiga });
    expect(mesma).toEqual({ situacao: 'pronto' });
  });

  it('assistente: confere o código SEM mover; o fim da instalação move sem pedir o código de novo', async () => {
    const e = await empresaComServidor({ trava: true });
    const fpNova = `fp-nova-${randomUUID()}`;
    const codigo = await pedirCodigo(e.email, fpNova);

    // Código errado conta tentativa e não confere nada.
    const errado = codigo === '000000' ? '111111' : '000000';
    await expect(
      svc.reautorizarVerificar({ email: e.email, senha: SENHA, fingerprint: fpNova, codigo: errado }),
    ).rejects.toThrow(UnauthorizedException);
    expect((await pedidosDe(e.t))[0].tentativas).toBe(1);

    const antes = Date.now();
    const r: any = await svc.reautorizarVerificar({ email: e.email, senha: SENHA, fingerprint: fpNova, codigo });
    expect(r.ok).toBe(true);
    const validoAte = new Date(r.validoAte).getTime();
    expect(validoAte).toBeGreaterThanOrEqual(antes + JANELA_CODIGO_CONFERIDO_MS - 5_000);
    expect(validoAte).toBeLessThanOrEqual(Date.now() + JANELA_CODIGO_CONFERIDO_MS + 5_000);
    const [pedido] = await pedidosDe(e.t);
    expect(pedido.status).toBe('verificada');

    // A máquina antiga segue funcionando: o token dela é o mesmo, a ativação ainda aponta para ela.
    expect((await equipamentoDe(e.servidor.id)).token).toBe(e.servidor.token);
    expect((await ativacaoDe(e.t)).device_fingerprint).toBe(e.fpAntiga);

    // O assistente, rodado de novo dentro da janela, pula a tela do código.
    const de_novo: any = await svc.verificarInstalacao({ email: e.email, senha: SENHA, fingerprint: fpNova });
    expect(de_novo.jaConferido).toBe(true);

    // Fim da instalação: confirmar SEM código faz o move.
    const mov: any = await svc.reautorizarConfirmar({ email: e.email, senha: SENHA, fingerprint: fpNova });
    expect(typeof mov.syncToken).toBe('string');
    expect(mov.syncToken).not.toBe(e.servidor.token);
    const movido = await equipamentoDe(e.servidor.id);
    expect(movido.token).toBe(mov.syncToken); // a máquina antiga cai em 401 a partir daqui
    expect(movido.fingerprint).toBe(fpNova);
    expect((await ativacaoDe(e.t)).device_fingerprint).toBe(fpNova);
    expect((await pedidosDe(e.t))[0].status).toBe('aprovada');

    // O pedido foi usado: não move de novo sem outro código.
    await expect(
      svc.reautorizarConfirmar({ email: e.email, senha: SENHA, fingerprint: fpNova }),
    ).rejects.toThrow(BadRequestException);
  });

  it('confirmar sem código e sem pedido conferido: 400, e nada gira', async () => {
    const e = await empresaComServidor({ trava: true });
    const fpNova = `fp-nova-${randomUUID()}`;
    await pedirCodigo(e.email, fpNova); // pedido PENDENTE — ninguém conferiu
    await expect(
      svc.reautorizarConfirmar({ email: e.email, senha: SENHA, fingerprint: fpNova }),
    ).rejects.toThrow(BadRequestException);
    expect((await equipamentoDe(e.servidor.id)).token).toBe(e.servidor.token);
    expect((await ativacaoDe(e.t)).device_fingerprint).toBe(e.fpAntiga);
  });

  it('o pedido conferido é DESTA máquina: outra não move com ele', async () => {
    const e = await empresaComServidor({ trava: true });
    const fpA = `fp-a-${randomUUID()}`;
    const codigo = await pedirCodigo(e.email, fpA);
    await svc.reautorizarVerificar({ email: e.email, senha: SENHA, fingerprint: fpA, codigo });

    await expect(
      svc.reautorizarConfirmar({ email: e.email, senha: SENHA, fingerprint: `fp-b-${randomUUID()}` }),
    ).rejects.toThrow(BadRequestException);
    expect((await equipamentoDe(e.servidor.id)).token).toBe(e.servidor.token);
  });

  it('a janela do pedido conferido vence', async () => {
    const e = await empresaComServidor({ trava: true });
    const fpNova = `fp-nova-${randomUUID()}`;
    const codigo = await pedirCodigo(e.email, fpNova);
    await svc.reautorizarVerificar({ email: e.email, senha: SENHA, fingerprint: fpNova, codigo });
    await q(`update reautorizacao_edge set expira_em = now() - interval '1 minute' where tenant_id = $1`, [e.t]);

    const r: any = await svc.verificarInstalacao({ email: e.email, senha: SENHA, fingerprint: fpNova });
    expect(r.jaConferido).toBe(false);
    await expect(
      svc.reautorizarConfirmar({ email: e.email, senha: SENHA, fingerprint: fpNova }),
    ).rejects.toThrow(BadRequestException);
    expect((await equipamentoDe(e.servidor.id)).token).toBe(e.servidor.token);
  });

  it('código vencido (10 min) no assistente: 400 com a mensagem para pedir outro', async () => {
    const e = await empresaComServidor({ trava: true });
    const fpNova = `fp-nova-${randomUUID()}`;
    const codigo = await pedirCodigo(e.email, fpNova);
    await q(`update reautorizacao_edge set expira_em = now() - interval '1 minute' where tenant_id = $1`, [e.t]);

    const erro: any = await svc
      .reautorizarVerificar({ email: e.email, senha: SENHA, fingerprint: fpNova, codigo })
      .catch((x) => x);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(String(erro.message)).toMatch(/expirado/i);
    expect((await pedidosDe(e.t))[0].status).toBe('pendente');
  });

  it('o instalador ANTIGO (confirmar com o código, sem o assistente) segue movendo', async () => {
    const e = await empresaComServidor({ trava: true });
    const fpNova = `fp-nova-${randomUUID()}`;
    const codigo = await pedirCodigo(e.email, fpNova);

    const mov: any = await svc.reautorizarConfirmar({ email: e.email, senha: SENHA, fingerprint: fpNova, codigo });

    expect((await equipamentoDe(e.servidor.id)).token).toBe(mov.syncToken);
    expect((await pedidosDe(e.t))[0].status).toBe('aprovada');
  });

  it('o /instalar segue devolvendo o que os instaladores leem (escolha da loja e trava)', async () => {
    const duas = await empresaComServidor({ trava: false, lojas: 2 });
    const escolha: any = await svc
      .instalarSelfService({ email: duas.email, senha: SENHA, fingerprint: 'fp-maquina-nova' })
      .catch((x) => x);
    expect(escolha).toBeInstanceOf(BadRequestException);
    expect(escolha.getResponse()).toMatchObject({ escolhaUnidade: true });
    expect(escolha.getResponse().unidades.map((u: any) => [u.id, u.nome, u.tipo])).toEqual([
      [duas.unidades[0], 'Matriz', 'matriz'],
      [duas.unidades[1], 'Loja 2', 'filial'],
    ]);

    const travada = await empresaComServidor({ trava: true });
    const trava: any = await svc
      .instalarSelfService({ email: travada.email, senha: SENHA, fingerprint: 'fp-maquina-nova' })
      .catch((x) => x);
    expect(trava).toBeInstanceOf(ForbiddenException);
    expect(trava.getResponse()).toMatchObject({ reauthRequired: true, metodos: ['email'], metodoPreferido: 'email' });
    // A trava não mexe na máquina antiga.
    expect((await equipamentoDe(travada.servidor.id)).token).toBe(travada.servidor.token);
  });
});
