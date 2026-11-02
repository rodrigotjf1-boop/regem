import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { AuthService } from '../../auth/auth.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { autorizarPorPinDoUsuario, NIVEIS_DA_PLATAFORMA } from '../../common/autorizacao-gestor';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { AtendimentoAppService } from './atendimento-app.service';
import { lerPresenca, MOTIVO_MAX } from './presenca';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O APP "REGEM ATENDIMENTO" (Onda 2, mig 353), contra o Postgres real: o celular pareia pela nuvem, cada pessoa entra com
// o PIN dela, a sessão só vale com aquele celular, a trava de PIN é por celular, e "Disponível / Ocupado" tem validade.
// A tabela da situação é só da nuvem: o teste aplica as migrations (o banco do CI é o de uma loja — ERR-329).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('atendimento-app-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

describe('o que o app manda em "Disponível / Ocupado"', () => {
  it('estado da lista; o motivo só no ocupado, aparado, até o limite', () => {
    expect(lerPresenca({ estado: 'disponivel', motivo: 'sobra' })).toEqual({ estado: 'disponivel', motivo: null });
    expect(lerPresenca({ estado: 'ocupado', motivo: '  embalando\n agora ' })).toEqual({ estado: 'ocupado', motivo: 'embalando agora' });
    expect(lerPresenca({ estado: 'ocupado' })).toEqual({ estado: 'ocupado', motivo: null });
    expect(lerPresenca({ estado: 'ocupado', motivo: 'x'.repeat(MOTIVO_MAX) }).motivo).toHaveLength(MOTIVO_MAX);
    expect(() => lerPresenca({ estado: 'ocupado', motivo: 'x'.repeat(MOTIVO_MAX + 1) })).toThrow(`no máximo ${MOTIVO_MAX}`);
    expect(() => lerPresenca({ estado: 'fora' })).toThrow('Escolha "Disponível" ou "Ocupado".');
    expect(() => lerPresenca(null)).toThrow('Escolha "Disponível" ou "Ocupado".');
  });
});

descrever('app "Regem Atendimento" (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const jwt = new JwtService({ secret: 'segredo-de-teste', signOptions: { expiresIn: '12h' } });
  // A auditoria de verdade (a trava de PIN conta as falhas no audit_log), com cópia do que foi registrado.
  const real = new AuditoriaService(db);
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => { auditados.push(e); await real.registrar(e); } } as any;
  const equipamentos = new EquipamentoService(db, auditoria);
  const app = new AtendimentoAppService(db, new AuthService(db, jwt, auditoria), equipamentos, auditoria);
  const T = randomUUID();
  let lojaA: string;
  let lojaB: string;
  const gente: Record<string, string> = {};
  let cel: { id: string; segredo: string };

  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(readFileSync(MIG(arq), 'utf8'));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });

  async function pessoa(
    nome: string,
    o: { cat?: string; pin: string; unidadeId?: string | null; semPedidos?: boolean; status?: string; excluido?: boolean },
  ) {
    const funcaoId = o.cat ? (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,$2,$3) returning id`, [T, `F ${nome}`, o.cat]))[0].id : null;
    const perfilId = o.semPedidos
      ? (await q(`insert into perfil_acesso (tenant_id, nome, nivel, permissoes) values ($1,$2,'execucao',$3) returning id`, [T, `P ${nome}`, JSON.stringify({ pdv: true, pedidos: false })]))[0].id
      : null;
    const [{ id }] = await q(
      `insert into colaborador (tenant_id, nome, funcao_id, perfil_acesso_id, unidade_id, pin_hash, status, deleted_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [T, nome, funcaoId, perfilId, o.unidadeId ?? null, await bcrypt.hash(o.pin, 4), o.status ?? 'ativo', o.excluido ? new Date() : null],
    );
    gente[nome] = id;
  }

  // O caminho do dono: Equipamentos › "App de atendimento" › Gerar código; o app digita o código ("Primeira vez neste aparelho").
  async function celular(unidadeId: string, nome: string) {
    const criado = await equipamentos.criar(T, gente.Ana, 'gerente', { tipo: 'atendimento', nome, unidadeId } as any);
    expect(criado).toMatchObject({ tipo: 'atendimento', pareado: false });
    const { codigo, onde } = await equipamentos.gerarCodigo(T, criado.id, gente.Ana, 'gerente');
    expect(onde?.titulo).toBe('No celular, no app Regem Atendimento');
    const p = await equipamentos.parearPorCodigo(codigo, 'Moto G (teste)', 'atendimento');
    return { id: p.terminalId as string, segredo: p.segredo as string };
  }
  const erro = (p: Promise<unknown>) => p.then(() => null, (e: any) => e);
  const passar = async (bearer: string, headers: Record<string, string> = {}) => {
    const req: any = { headers: { authorization: `Bearer ${bearer}`, ...headers } };
    await new JwtAuthGuard(jwt, db).canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any);
    return req;
  };

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    for (const m of ['342_robo_pausa_e_config.sql', '353_app_atendimento.sql']) await aplicar(m);
    await q(`insert into empresa (id, nome) values ($1, 'teste app de atendimento')`, [T]);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: lojaB }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja B') returning id`, [T]);
    await pessoa('Ana', { cat: 'gerente', pin: '2468', unidadeId: lojaA });
    await pessoa('Bruno', { cat: 'execucao', pin: '1357', unidadeId: lojaA });
    await pessoa('Duda', { cat: 'execucao', pin: '1122', unidadeId: lojaB });
    await pessoa('Pres', { cat: 'presidente', pin: '9090' });
    await pessoa('SemPedidos', { pin: '5566', unidadeId: lojaA, semPedidos: true });
    await pessoa('Excluido', { cat: 'gerente', pin: '7788', unidadeId: lojaA, excluido: true });
    await pessoa('Bloqueado', { cat: 'execucao', pin: '3344', unidadeId: lojaA, status: 'bloqueado' });
    await pessoa('Desligado', { cat: 'execucao', pin: '4455', unidadeId: lojaA, status: 'desligado' });
    await pessoa('SemLoja', { cat: 'execucao', pin: '6677' });
    cel = await celular(lojaA, 'Celular do balcão');
  });
  beforeEach(() => {
    auditados.length = 0;
    delete process.env.EDGE_MODE;
  });
  afterAll(async () => {
    delete process.env.EDGE_MODE;
    for (const t of ['atendimento_presenca', 'audit_log', 'equipamento', 'colaborador', 'perfil_acesso', 'funcao', 'unidade'])
      await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });

  it('pareia pela nuvem e entra com o PIN: a sessão sai presa ao celular, na loja do celular, e fica registrada', async () => {
    const r = await app.entrar(cel.id, cel.segredo, '2468');
    expect(r).toMatchObject({ nome: 'Ana', categoria: 'gerente', colaboradorId: gente.Ana, unidadeId: lojaA, loja: 'Loja A', aparelho: { id: cel.id, nome: 'Celular do balcão' } });
    expect(jwt.verify(r.access_token) as any).toMatchObject({ ap: cel.id, uni: lojaA, sub: gente.Ana, tenant: T });
    expect(auditados).toEqual([expect.objectContaining({ acao: 'entrou_no_app_atendimento', atorId: gente.Ana, entidadeId: cel.id })]);
    // a tela Equipamentos mostra "pareado" e o último uso (não "nunca usado")
    const [e] = await q(`select segredo_hash is not null as pareado, ultimo_uso_em, pareamento_codigo from equipamento where id = $1`, [cel.id]);
    expect(e).toMatchObject({ pareado: true, pareamento_codigo: null });
    expect(e.ultimo_uso_em).not.toBeNull();
  });

  it('a sessão do app só vale com o celular: sem o cabeçalho, ou com o de outro aparelho, 401', async () => {
    const r = await app.entrar(cel.id, cel.segredo, '1357');
    expect((await erro(passar(r.access_token)))?.message).toBe('Esta sessão é do app de atendimento: entre pelo celular pareado.');
    expect((await erro(passar(r.access_token, { 'x-terminal-id': randomUUID() })))?.message).toBe('Esta sessão é do app de atendimento: entre pelo celular pareado.');
    const req = await passar(r.access_token, { 'x-terminal-id': cel.id });
    expect(req.user).toMatchObject({ colaboradorId: gente.Bruno, aparelhoId: cel.id, unidadeId: lojaA, categoria: 'execucao' });
    // a sessão do computador (sem `ap`) segue como sempre, e não vira "app"
    const web = await passar(jwt.sign({ sub: gente.Ana, tenant: T, cat: 'gerente' }));
    expect(web.user.aparelhoId).toBeUndefined();
  });

  it('o aparelho prova quem é: segredo errado, id de outro tipo e revogado não entram — só a revogação faz o app esquecer', async () => {
    const codigo = async (p: Promise<unknown>) => ((await erro(p)) as any)?.getResponse?.().code;
    expect(await codigo(app.entrar(cel.id, 'segredo-errado', '2468'))).toBe('TERMINAL_NAO_RECONHECIDO');
    expect(await codigo(app.entrar('nao-e-um-id', cel.segredo, '2468'))).toBe('TERMINAL_NAO_RECONHECIDO');
    expect(await codigo(app.entrar(cel.id, undefined, '2468'))).toBe('TERMINAL_NAO_RECONHECIDO');
    // um caixa com o segredo certo não entra pelo app
    const [{ id: caixa }] = await q(
      `insert into equipamento (tenant_id, unidade_id, tipo, nome, token, segredo_hash)
       values ($1, $2, 'pdv', 'Caixa', $3, encode(sha256('s-do-caixa'::bytea), 'hex')) returning id`,
      [T, lojaA, `tok-caixa-${T}`],
    );
    expect(await codigo(app.entrar(caixa, 's-do-caixa', '2468'))).toBe('TERMINAL_NAO_RECONHECIDO');
    const outro = await celular(lojaA, 'Celular revogado');
    await equipamentos.revogar(T, outro.id, gente.Ana, 'gerente');
    expect(await codigo(app.entrar(outro.id, outro.segredo, '2468'))).toBe('TERMINAL_REVOGADO');
    expect(auditados.some((a) => a.acao === 'entrou_no_app_atendimento')).toBe(false);
  });

  it('PIN errado conta na trava DESTE celular: 10 erros em 5 min travam, mesmo com o PIN certo — o outro celular segue', async () => {
    const travado = await celular(lojaA, 'Celular da trava');
    for (let i = 0; i < 10; i++) expect((await erro(app.entrar(travado.id, travado.segredo, '0000')))?.message).toBe('PIN inválido.');
    expect(auditados.filter((a) => a.acao === 'pin_falhou' && a.entidadeId === travado.id)).toHaveLength(10);
    expect((await erro(app.entrar(travado.id, travado.segredo, '2468')))?.message).toBe('Muitas tentativas de PIN neste celular. Tente novamente em 5 minutos.');
    await expect(app.entrar(cel.id, cel.segredo, '2468')).resolves.toMatchObject({ nome: 'Ana' });
    // PIN fora do formato nem procura (e não conta)
    expect((await erro(app.entrar(cel.id, cel.segredo, '12')))?.message).toBe('PIN deve ter de 4 a 6 dígitos.');
  });

  it('quem não entra: excluído, bloqueado, desligado, sem acesso ao atendimento e de outra loja; o presidente fica na loja do celular', async () => {
    expect((await erro(app.entrar(cel.id, cel.segredo, '7788')))?.message).toBe('PIN inválido.'); // excluído: o PIN nem confere
    expect((await erro(app.entrar(cel.id, cel.segredo, '3344')))?.message).toBe('Acesso bloqueado. Fale com o presidente.');
    expect((await erro(app.entrar(cel.id, cel.segredo, '4455')))?.message).toBe('Acesso encerrado. Fale com o presidente.');
    expect((await erro(app.entrar(cel.id, cel.segredo, '5566')))?.message).toBe('O seu perfil não tem acesso ao atendimento. Fale com o gerente.');
    expect((await erro(app.entrar(cel.id, cel.segredo, '1122')))?.message).toBe('Este celular é de outra loja. Entre num celular da sua loja.');
    expect(auditados.some((a) => a.acao === 'entrou_no_app_atendimento')).toBe(false);
    const p = await app.entrar(cel.id, cel.segredo, '9090');
    expect(p).toMatchObject({ categoria: 'presidente', unidadeId: lojaA, loja: 'Loja A' });
    expect((jwt.verify(p.access_token) as any).uni).toBe(lojaA);
    // quem não é presidente e não tem loja segue como no computador: sem loja (não ganha a do celular)
    const s = await app.entrar(cel.id, cel.segredo, '6677');
    expect(s).toMatchObject({ categoria: 'execucao', unidadeId: null, loja: null });
    expect((jwt.verify(s.access_token) as any).uni).toBeNull();
  });

  it('"Disponível / Ocupado": só do app, com validade de 3 min, "desde" anda só quando muda; "Sair" tira da vez na hora', async () => {
    const bruno = { tenantId: T, colaboradorId: gente.Bruno, categoria: 'execucao', unidadeId: lojaA, aparelhoId: cel.id } as any;
    const ana = { tenantId: T, colaboradorId: gente.Ana, categoria: 'gerente', unidadeId: lojaA, aparelhoId: cel.id } as any;
    expect((await erro(app.marcar({ ...bruno, aparelhoId: undefined }, { estado: 'disponivel' })))?.message).toBe(
      'A situação "Disponível / Ocupado" é do app de atendimento.',
    );
    expect(await app.marcar(bruno, { estado: 'disponivel', motivo: 'ignorado' })).toMatchObject({ estado: 'disponivel', motivo: null, valeMin: 3 });
    // o aviso de "ainda estou aqui" não mexe no "desde"
    await q(`update atendimento_presenca set desde = now() - interval '10 minutes' where colaborador_id = $1`, [gente.Bruno]);
    const aviso = await app.marcar(bruno, { estado: 'disponivel' });
    expect(Date.now() - new Date(aviso.desde).getTime()).toBeGreaterThan(9 * 60_000);
    // mudou a situação: o "desde" anda
    const ocupado = await app.marcar(bruno, { estado: 'ocupado', motivo: 'embalando' });
    expect(ocupado).toMatchObject({ estado: 'ocupado', motivo: 'embalando' });
    expect(Date.now() - new Date(ocupado.desde).getTime()).toBeLessThan(60_000);
    await app.marcar(ana, { estado: 'disponivel' });
    let p = await app.presenca(ana, lojaA);
    expect(p.eu).toMatchObject({ colaboradorId: gente.Ana, estado: 'disponivel', motivo: null });
    expect(p.equipe.map((x) => [x.nome, x.estado, x.motivo])).toEqual([
      ['Ana', 'disponivel', null],
      ['Bruno', 'ocupado', 'embalando'],
    ]);
    // a loja B não vê quem é da loja A
    expect((await app.presenca({ ...ana, colaboradorId: gente.Duda, unidadeId: lojaB }, lojaB)).equipe).toEqual([]);
    // parou de avisar há mais de 3 min (o celular apagou): sai da lista; ao voltar, o "desde" recomeça
    await q(`update atendimento_presenca set atualizado_em = now() - interval '4 minutes', desde = now() - interval '1 hour' where colaborador_id = $1`, [gente.Bruno]);
    p = await app.presenca(ana, lojaA);
    expect(p.equipe.map((x) => x.nome)).toEqual(['Ana']);
    const volta = await app.marcar(bruno, { estado: 'ocupado', motivo: 'embalando' });
    expect(Date.now() - new Date(volta.desde).getTime()).toBeLessThan(60_000);
    // "Sair": some da lista na hora e fica registrado
    await app.sair(bruno);
    expect((await app.presenca(ana, lojaA)).equipe.map((x) => x.nome)).toEqual(['Ana']);
    expect(auditados).toContainEqual(expect.objectContaining({ acao: 'saiu_do_app_atendimento', atorId: gente.Bruno, entidadeId: cel.id }));
    // excluído some da lista mesmo com o aviso em dia
    await app.marcar({ ...bruno, colaboradorId: gente.Excluido }, { estado: 'disponivel' });
    expect((await app.presenca(ana, lojaA)).equipe.map((x) => x.nome)).toEqual(['Ana']);
  });

  it('o PIN de quem está no app decide a disputa e a 99: gerente e presidente sim; o resto ouve "chame o gerente"', async () => {
    const decide = (id: string | null, pin: string) => autorizarPorPinDoUsuario(db, T, id, pin, NIVEIS_DA_PLATAFORMA);
    await expect(decide(gente.Ana, '2468')).resolves.toEqual({ id: gente.Ana, nome: 'Ana' });
    await expect(decide(gente.Pres, '9090')).resolves.toEqual({ id: gente.Pres, nome: 'Pres' });
    await expect(decide(gente.Ana, '0000')).rejects.toThrow('PIN inválido.');
    await expect(decide(gente.Ana, '1357')).rejects.toThrow('PIN inválido.'); // o PIN de outra pessoa não vale
    await expect(decide(gente.Bruno, '1357')).rejects.toThrow('Só gerente e presidente respondem. Chame o gerente.');
    await expect(decide(gente.Ana, '')).rejects.toThrow('Confirme com o seu PIN.');
    await expect(decide(null, '2468')).rejects.toThrow('Entre com o seu PIN no app para responder.');
    await expect(decide(gente.Excluido, '7788')).rejects.toThrow('O seu acesso não vale mais.');
    await expect(decide(gente.Bloqueado, '3344')).rejects.toThrow('O seu acesso não vale mais.');
    await expect(autorizarPorPinDoUsuario(db, randomUUID(), gente.Ana, '2468', NIVEIS_DA_PLATAFORMA)).rejects.toThrow('O seu acesso não vale mais.');
  });

  it('código de outro aparelho não é gasto: o do caixa no app e o do app no caixa', async () => {
    const [{ id: caixa }] = await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token) values ($1, $2, 'pdv', 'Caixa 2', $3) returning id`, [
      T,
      lojaA,
      `tok-caixa2-${T}`,
    ]);
    const doCaixa = (await equipamentos.gerarCodigo(T, caixa, gente.Ana, 'gerente')).codigo;
    expect((await erro(equipamentos.parearPorCodigo(doCaixa, 'fp', 'atendimento')))?.message).toBe(
      'Este código é de "Caixa 2", não deste aparelho — digite-o no caixa. Ele continua valendo.',
    );
    const { id: novo } = await equipamentos.criar(T, gente.Ana, 'gerente', { tipo: 'atendimento', nome: 'Celular novo', unidadeId: lojaA } as any);
    const doApp = (await equipamentos.gerarCodigo(T, novo, gente.Ana, 'gerente')).codigo;
    expect((await erro(equipamentos.parearPorCodigo(doApp, 'fp', 'pdv')))?.message).toBe(
      'Este código é de "Celular novo", não deste aparelho — digite-o no celular, no app Regem Atendimento. Ele continua valendo.',
    );
    const codigos = await q(`select id, pareamento_codigo from equipamento where id = any($1::uuid[])`, [[caixa, novo]]);
    expect(Object.fromEntries(codigos.map((c: any) => [c.id, c.pareamento_codigo]))).toEqual({ [caixa]: doCaixa, [novo]: doApp });
  });

  it('no SERVIDOR DA LOJA o app só aparece: cadastrar, código, trocar, editar, revogar, reativar e parear são recusados', async () => {
    const revogado = await celular(lojaA, 'Celular para reativar');
    await equipamentos.revogar(T, revogado.id, gente.Ana, 'gerente');
    const pendente = await equipamentos.criar(T, gente.Ana, 'gerente', { tipo: 'atendimento', nome: 'Celular pendente', unidadeId: lojaA } as any);
    const { codigo } = await equipamentos.gerarCodigo(T, pendente.id, gente.Ana, 'gerente');
    const NA_NUVEM = 'O app de atendimento só se cadastra e se pareia pela nuvem: abra esta mesma tela no Regem na nuvem. Aqui, no servidor da loja, ele só aparece.';
    process.env.EDGE_MODE = 'true';
    try {
      expect((await erro(equipamentos.criar(T, gente.Ana, 'gerente', { tipo: 'atendimento', nome: 'X', unidadeId: lojaA } as any)))?.message).toBe(NA_NUVEM);
      expect((await erro(equipamentos.gerarCodigo(T, cel.id, gente.Ana, 'gerente')))?.message).toBe(NA_NUVEM);
      expect((await erro(equipamentos.trocarMaquina(T, cel.id, gente.Ana, 'gerente')))?.message).toBe(NA_NUVEM);
      expect((await erro(equipamentos.atualizar(T, cel.id, { nome: 'Outro nome' })))?.message).toBe(NA_NUVEM);
      expect((await erro(equipamentos.revogar(T, cel.id, gente.Ana, 'gerente')))?.message).toBe(NA_NUVEM);
      expect((await erro(equipamentos.reativar(T, revogado.id, gente.Ana, 'gerente')))?.message).toBe(NA_NUVEM);
      expect((await erro(equipamentos.parearPorCodigo(codigo, 'fp', 'atendimento')))?.message).toBe(NA_NUVEM);
    } finally {
      delete process.env.EDGE_MODE;
    }
    // nada mudou aqui — e o código segue valendo na nuvem
    expect((await q(`select ativo, nome, segredo_hash is not null as pareado from equipamento where id = $1`, [cel.id]))[0]).toEqual({
      ativo: true,
      nome: 'Celular do balcão',
      pareado: true,
    });
    expect((await q(`select ativo from equipamento where id = $1`, [revogado.id]))[0].ativo).toBe(false);
    await expect(equipamentos.parearPorCodigo(codigo, 'fp', 'atendimento')).resolves.toMatchObject({ terminalId: pendente.id });
  });

  it('reativar o celular revogado (na nuvem) volta com código novo: o segredo foi apagado na revogação', async () => {
    const r = await celular(lojaA, 'Celular que volta');
    await equipamentos.revogar(T, r.id, gente.Ana, 'gerente');
    const volta = await equipamentos.reativar(T, r.id, gente.Ana, 'gerente');
    expect(volta.codigo).toMatch(/^\d{6}$/);
    expect(volta.onde?.titulo).toBe('No celular, no app Regem Atendimento');
    expect((await erro(app.entrar(r.id, r.segredo, '2468')) as any)?.getResponse?.().code).toBe('TERMINAL_NAO_RECONHECIDO');
    const novo = await equipamentos.parearPorCodigo(volta.codigo!, 'fp', 'atendimento');
    await expect(app.entrar(r.id, novo.segredo, '2468')).resolves.toMatchObject({ nome: 'Ana' });
  });
});
