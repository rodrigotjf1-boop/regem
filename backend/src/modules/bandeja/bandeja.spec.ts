import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { chaveConfere, chaveDaBandeja, doProprioComputador } from './bandeja-chave';
import { BandejaGuard } from './bandeja.guard';
import { BandejaService, CAIU_MS, haQuanto, ondeDigitar } from './bandeja.service';
import { PresencaService, versaoInformada } from '../equipamento/presenca.service';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TotemTokenGuard } from '../totem/totem-token.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ÍCONE DO SERVIDOR DA LOJA (fase 4 do pedido de 22–23/10/2026). O dono quer, no servidor, um ícone perto do relógio
// com TODOS os aparelhos ligados a ele, a versão instalada em cada lugar e as ações (gerar código, revogar, reativar).
// "O ícone é livre" (23/10): sem senha — por isso a rota só atende o próprio computador, com a chave do arquivo dele.

const modoAntes = { edge: process.env.EDGE_MODE, arq: process.env.BANDEJA_CHAVE_ARQ, versao: process.env.APP_VERSION, loja: process.env.EDGE_UNIDADE_ID };
function restaurar() {
  for (const [k, v] of Object.entries({ EDGE_MODE: modoAntes.edge, BANDEJA_CHAVE_ARQ: modoAntes.arq, APP_VERSION: modoAntes.versao, EDGE_UNIDADE_ID: modoAntes.loja })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('ícone do servidor — a chave e quem pode chamar', () => {
  let pasta: string;
  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), 'bandeja-'));
    process.env.BANDEJA_CHAVE_ARQ = join(pasta, 'bandeja.key');
    process.env.EDGE_MODE = 'true';
  });
  afterEach(() => {
    rmSync(pasta, { recursive: true, force: true });
    restaurar();
  });

  it('a chave nasce no primeiro uso, no arquivo, e é a mesma nas leituras seguintes', () => {
    const k = chaveDaBandeja();
    expect(k).toMatch(/^[0-9a-f]{48}$/);
    expect(readFileSync(process.env.BANDEJA_CHAVE_ARQ!, 'utf8')).toBe(k);
    expect(chaveDaBandeja()).toBe(k);
    expect(chaveConfere(k)).toBe(true);
    expect(chaveConfere(k.slice(0, -1) + (k.endsWith('0') ? '1' : '0'))).toBe(false);
    expect(chaveConfere('')).toBe(false);
    expect(chaveConfere(undefined)).toBe(false);
  });

  it('a chave nasce quando o sistema LIGA no servidor da loja (o ícone a lê antes da 1ª chamada); na nuvem, não', () => {
    const svc = new BandejaService({} as any, {} as any, {} as any);
    process.env.EDGE_MODE = 'false';
    svc.onModuleInit();
    expect(existsSync(process.env.BANDEJA_CHAVE_ARQ!)).toBe(false);
    process.env.EDGE_MODE = 'true';
    svc.onModuleInit();
    expect(readFileSync(process.env.BANDEJA_CHAVE_ARQ!, 'utf8')).toMatch(/^[0-9a-f]{48}$/);
  });

  it('"do próprio computador" é só o endereço de volta (127.0.0.1 / ::1), em todas as formas', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(doProprioComputador(a)).toBe(true);
    for (const a of ['192.168.0.23', '::ffff:192.168.0.23', '', undefined, '127.0.0.2']) expect(doProprioComputador(a)).toBe(false);
  });

  const ctx = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;

  it('o guard: na nuvem a rota nem existe; de outro PC, recusa — mesmo com a chave e X-Forwarded-For de 127.0.0.1', () => {
    const g = new BandejaGuard();
    const chave = chaveDaBandeja();
    process.env.EDGE_MODE = 'false';
    expect(() => g.canActivate(ctx({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-bandeja-chave': chave } }))).toThrow(NotFoundException);
    process.env.EDGE_MODE = 'true';
    // Com `trust proxy`, o req.ip viria do cabeçalho que o PC da rede escreve: o guard olha a conexão de verdade.
    const deFora = { ip: '127.0.0.1', socket: { remoteAddress: '::ffff:192.168.0.23' }, headers: { 'x-bandeja-chave': chave, 'x-forwarded-for': '127.0.0.1' } };
    expect(() => g.canActivate(ctx(deFora))).toThrow(ForbiddenException);
    expect(() => g.canActivate(ctx({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-bandeja-chave': 'outra' } }))).toThrow(UnauthorizedException);
    expect(() => g.canActivate(ctx({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }))).toThrow(UnauthorizedException);
    expect(g.canActivate(ctx({ socket: { remoteAddress: '::1' }, headers: { 'x-bandeja-chave': chave } }))).toBe(true);
  });
});

describe('presença do KDS, da TV e do totem (D2) e a versão de cada lugar', () => {
  afterEach(restaurar);
  const db: any = { execute: async () => ({ rows: [] }) };
  const base = { tenantId: 't1', ip: '192.168.0.40', endereco: 'regem.local', maquina: null, versao: '1.30.9' };

  it('a versão informada só vale com cara de versão', () => {
    expect(versaoInformada('1.30.9')).toBe('1.30.9');
    expect(versaoInformada(' 1.30.10-rc1 ')).toBe('1.30.10-rc1');
    for (const v of ['', '   ', '<script>', 'a b', 'x'.repeat(41), 12, null, undefined]) expect(versaoInformada(v)).toBeNull();
  });

  it('conectado pelo tempo real: segue "visto agora" por horas; cai só quando a ÚLTIMA conexão cai', () => {
    process.env.EDGE_MODE = 'true';
    const p = new PresencaService(db);
    const t0 = Date.parse('2026-10-23T18:00:00Z');
    p.conectou({ ...base, id: 'kds-1', tipo: 'kds' }, new Date(t0));
    p.conectou({ ...base, id: 'kds-1', tipo: 'kds' }, new Date(t0 + 1000)); // a mesma tela em duas abas
    const tres = t0 + 3 * 3_600_000;
    expect(p.doTenant('t1', tres).find((x) => x.id === 'kds-1')?.vistoEm).toBe(new Date(tres).toISOString());
    p.desconectou('kds-1', new Date(tres));
    expect(p.doTenant('t1', tres + 1000).find((x) => x.id === 'kds-1')?.vistoEm).toBe(new Date(tres + 1000).toISOString());
    p.desconectou('kds-1', new Date(tres + 2000));
    expect(p.doTenant('t1', tres + 60_000).find((x) => x.id === 'kds-1')?.vistoEm).toBe(new Date(tres + 2000).toISOString());
  });

  it('"PCs conectados" da tela Servidor local continua contando só PCs (KDS, TV e totem fora)', () => {
    process.env.EDGE_MODE = 'true';
    const p = new PresencaService(db);
    const agora = Date.now();
    p.notar({ ...base, id: 'pdv-1', tipo: 'pdv', ip: '192.168.0.21' }, new Date(agora - 5_000));
    p.conectou({ ...base, id: 'kds-1', tipo: 'kds', ip: '192.168.0.40' }, new Date(agora - 5_000));
    p.conectou({ ...base, id: 'tv-1', tipo: 'tela_senhas', ip: '192.168.0.41' }, new Date(agora - 5_000));
    p.notar({ ...base, id: 'to-1', tipo: 'totem', ip: '192.168.0.42' }, new Date(agora - 5_000));
    expect(p.pcsConectados('t1', 3 * 60_000, agora)).toBe(1);
  });

  it('o tempo real anota o KDS (pela credencial) e a TV; o gestor não; a queda desanota', async () => {
    process.env.EDGE_MODE = 'true';
    const p = new PresencaService(db);
    const equip: any = {
      validarToken: async () => ({ id: 'kds-1', tenantId: 't1', unidadeId: null, tipo: 'kds', nome: 'KDS chapa' }),
      validarTela: async () => ({ id: 'tv-1', tenantId: 't1', unidadeId: null }),
      registrarPing: async () => undefined,
    };
    const g = new RealtimeGateway({ verify: () => ({ tenant: 't1', sub: 'c1' }) } as any, equip, p);
    (g as any).server = { to: () => ({ emit: () => undefined }) };
    const sock = (auth: any) => ({ handshake: { auth, address: '::ffff:192.168.0.40', headers: { host: 'regem.local:3002' } }, data: {} as any, join: () => undefined, emit: () => undefined, disconnect: () => undefined });
    const kds = sock({ token: 'tok', versao: '1.30.8' });
    const tv = sock({ tela: { id: 'tv-1', segredo: 's' }, versao: '1.30.9' });
    const gestor = sock({ jwt: 'x' });
    await g.handleConnection(kds as any);
    await g.handleConnection(tv as any);
    await g.handleConnection(gestor as any);
    const agora = p.doTenant('t1');
    expect(agora.map((x) => [x.id, x.tipo, x.versao, x.ip]).sort()).toEqual([
      ['kds-1', 'kds', '1.30.8', '192.168.0.40'],
      ['tv-1', 'tela_senhas', '1.30.9', '192.168.0.40'],
    ]);
    g.handleDisconnect(kds as any);
    g.handleDisconnect(gestor as any);
    expect((p as any).mapa.get('kds-1').conectado).toBe(false);
    expect((p as any).mapa.get('tv-1').conectado).toBe(true);
  });

  it('o totem fica "em uso" a cada chamada com o token dele (sem versão: o app é outro)', async () => {
    process.env.EDGE_MODE = 'true';
    const p = new PresencaService(db);
    const guard = new TotemTokenGuard({ validarToken: async () => ({ id: 'to-1', tenantId: 't1', unidadeId: 'u1', tipo: 'totem' }) } as any, p);
    const req: any = { headers: { 'x-device-token': 'tok', host: 'regem.local:3002' }, ip: '::ffff:192.168.0.42' };
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any);
    expect(p.doTenant('t1')).toEqual([expect.objectContaining({ id: 'to-1', tipo: 'totem', ip: '192.168.0.42', versao: null })]);
  });

  it('textos de tempo e onde digitar o código (os nomes como estão nas telas)', () => {
    expect(haQuanto(5_000)).toBe('agora');
    expect(haQuanto(40_000)).toBe('há 40 s');
    expect(haQuanto(4 * 60_000)).toBe('há 4 min');
    expect(haQuanto(3 * 3_600_000)).toBe('há 3 h');
    expect(haQuanto(3 * 86_400_000)).toBe('há 3 dias');
    expect(ondeDigitar('pdv')?.passos.join(' ')).toContain('"Parear e liberar o caixa"');
    expect(ondeDigitar('estacao_impressao')?.passos.join(' ')).toContain('"Regem neste PC"');
    expect(ondeDigitar('tela_senhas')?.passos.join(' ')).toContain('"Parear esta TV"');
    expect(ondeDigitar('kds')).toBeNull();
  });
});

// ---------- Com Postgres real (banco de LOJA, como o do CI) ----------
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('bandeja.spec: sem TEST_PG_URL — a parte com Postgres foi PULADA');

descrever('ícone do servidor — o que ele mostra e o que faz (Postgres)', () => {
  jest.setTimeout(60_000);
  let pool: Pool;
  let presenca: PresencaService;
  let equip: EquipamentoService;
  let svc: BandejaService;
  const auditados: any[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const LOJA = randomUUID();
  const OUTRA = randomUUID();
  const SEGUNDA = randomUUID();
  const ids: Record<string, string> = {};
  const impressoras: any[] = [];
  const minutos = (m: number) => new Date(Date.now() + m * 60_000);

  const equipar = async (chave: string, tipo: string, nome: string, extra: Record<string, any> = {}) => {
    const cols = { id: randomUUID(), tenant_id: T, unidade_id: LOJA, tipo, nome, token: 'tok-' + randomUUID(), ...extra };
    const nomes = Object.keys(cols);
    await q(`insert into equipamento (${nomes.join(',')}) values (${nomes.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(cols));
    ids[chave] = cols.id;
    return cols.id as string;
  };
  const de = async () => {
    const r: any = await svc.estado();
    return { r, por: (chave: string) => r.aparelhos.find((a: any) => a.id === ids[chave]) };
  };

  beforeAll(async () => {
    process.env.EDGE_MODE = 'true';
    process.env.APP_VERSION = '1.30.9';
    process.env.EDGE_UNIDADE_ID = LOJA;
    pool = new Pool({ connectionString: URL_PG });
    const db: any = drizzle(pool, { schema });
    presenca = new PresencaService(db);
    equip = new EquipamentoService(db, { registrar: async (e: any) => void auditados.push(e) } as any, presenca);
    svc = new BandejaService(db, equip, { estadoImpressoras: async () => impressoras } as any);
    // A sync_state nasce com o sync-daemon (não é migration): no banco do CI, criada como ele cria.
    await q(`create table if not exists sync_state (chave text primary key, valor text)`);
    await q(`insert into empresa (id, nome) values ($1, 'teste bandeja')`, [T]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1, $2, 'Loja Centro'), ($3, $2, 'Outra loja')`, [LOJA, T, OUTRA]);

    const pdv = await equipar('pdv', 'pdv', 'Caixa 1');
    await equipar('salao', 'salao', 'Garçom 2', { pdv_main_id: pdv });
    await equipar('estacao', 'estacao_impressao', 'PC do delivery', { segredo_hash: 'x' });
    await equipar('kds', 'kds', 'KDS chapa');
    await equipar('tv', 'tela_senhas', 'TV do balcão', { segredo_hash: 'x' });
    await equipar('totem', 'totem', 'Totem da entrada');
    await equipar('ponto', 'terminal_ponto', 'Ponto da entrada');
    await equipar('imp', 'impressora', 'Caixa delivery', { padrao: true });
    await equipar('revogado', 'pdv', 'Caixa antigo', { ativo: false, revogado_em: minutos(-3 * 1440) });
    await equipar('velho', 'pdv', 'Caixa de 2025', { ativo: false, revogado_em: minutos(-40 * 1440) });
    await equipar('semLoja', 'kds', 'KDS da rede', { unidade_id: null });
    await equipar('outraLoja', 'pdv', 'Caixa da outra loja', { unidade_id: OUTRA });
    await equipar('gogem', 'pdv', 'Caixa GoGeM', { integrador: 'gogem' });
    await q(`update equipamento set estacao_id = $1 where id = $2`, [ids.estacao, ids.imp]);
    impressoras.push({ id: ids.imp, semResponder: false, estado: 'sem_papel', pendentes: 2 });

    // Os sinais: o caixa na tela 1.30.8 (abriu antes da atualização); o garçom parou de responder há 10 min; a estação
    // bateu agora, instalada na 1.30.8; o KDS conectado; o totem chamou há 20 s; a TV pareada e sem conexão.
    presenca.notar({ id: ids.pdv, tenantId: T, tipo: 'pdv', ip: '192.168.0.21', endereco: 'regem.local', maquina: null, versao: '1.30.8' });
    presenca.notar({ id: ids.salao, tenantId: T, tipo: 'salao', ip: '192.168.0.50', endereco: 'regem.local', maquina: null, versao: '1.30.9' }, minutos(-8));
    await q(`insert into estacao_status (equipamento_id, tenant_id, unidade_id, versao, maquina, impressoras, visto_em) values ($1,$2,$3,'1.30.8','CX-DELIVERY','[]'::jsonb, now())`, [ids.estacao, T, LOJA]);
    presenca.conectou({ id: ids.kds, tenantId: T, tipo: 'kds', ip: '192.168.0.40', endereco: 'regem.local', maquina: null, versao: '1.30.9' });
    presenca.notar({ id: ids.totem, tenantId: T, tipo: 'totem', ip: '192.168.0.42', endereco: 'regem.local', maquina: null, versao: null }, new Date(Date.now() - 20_000));
    await q(`insert into sync_state (chave, valor) values ('nuvem_contato', $1) on conflict (chave) do update set valor = excluded.valor`, [
      JSON.stringify({ okEm: new Date(Date.now() - 12_000).toISOString(), falhandoDesde: null }),
    ]);
  });
  afterAll(async () => {
    restaurar();
    if (!pool) return;
    await q(`delete from sync_state where chave = 'nuvem_contato'`).catch(() => undefined);
    await q('delete from estacao_status where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from caixa_sessao where tenant_id = $1', [T]).catch(() => undefined);
    await q('update equipamento set estacao_id = null, pdv_main_id = null where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from unidade where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id in ($1, $2)', [T, SEGUNDA]).catch(() => undefined);
    await pool.end();
  });

  it('cada aparelho desta loja (ou sem loja), com a situação, o texto e a versão de cada lugar', async () => {
    const { r, por } = await de();
    expect(r.servidor).toEqual({ versao: '1.30.9', loja: 'Loja Centro', nuvem: { situacao: 'ok', linha: expect.stringMatching(/^nuvem sincronizada há 1\d s$/) } });
    // Outra loja e revogado há mais de 30 dias: fora.
    expect(por('outraLoja')).toBeUndefined();
    expect(por('velho')).toBeUndefined();
    expect(por('semLoja')).toBeDefined();

    expect(por('pdv')).toMatchObject({ situacao: 'conectado', linha: 'conectado agora · 192.168.0.21', versao: '1.30.8', versaoDe: 'tela', versaoAntiga: true,
      linhaVersao: 'versão antiga 1.30.8 — feche e abra o Regem neste aparelho', alerta: false, acoes: { codigo: true, revogar: true, reativar: false } });
    expect(por('salao')).toMatchObject({ situacao: 'caiu', linha: 'parou de responder há 8 min · último IP 192.168.0.50 · ligado ao Caixa 1', versaoAntiga: false, alerta: false });
    expect(por('estacao')).toMatchObject({ situacao: 'conectado', linha: 'conectada agora', versao: '1.30.8', versaoDe: 'pc',
      linhaVersao: 'versão antiga 1.30.8 — reinstale este PC com o instalador 1.30.9', acoes: { codigo: true } });
    expect(por('kds')).toMatchObject({ situacao: 'conectado', linha: 'conectado agora · 192.168.0.40', versao: '1.30.9', versaoAntiga: false, acoes: { codigo: false, revogar: true } });
    expect(por('tv')).toMatchObject({ situacao: 'desligado', linha: 'pareada · sem conexão agora', acoes: { codigo: true } });
    expect(por('totem')).toMatchObject({ situacao: 'conectado', linha: expect.stringMatching(/^em uso · última chamada há 2\d s · 192\.168\.0\.42$/), versao: null, versaoDe: null });
    expect(por('ponto')).toMatchObject({ situacao: 'sem_sinal', linha: 'não informa · entra com login de pessoa' });
    expect(por('imp')).toMatchObject({ situacao: 'conectado', linha: 'sem papel · 2 tickets esperando', estacaoId: ids.estacao, acoes: { revogar: false } });
    expect(por('revogado')).toMatchObject({ situacao: 'revogado', linha: expect.stringMatching(/^revogado há 3 dias · dá para reativar até \d\d\/\d\d$/), acoes: { codigo: false, revogar: false, reativar: true } });
    expect(por('gogem').acoes.codigo).toBe(false);
    expect(r.resumo).toMatchObject({ caidos: 1, versaoAntiga: 2, alerta: false });
  });

  it('o caixa, a estação e o KDS que caem acendem o alerta (D3); o garçom e a TV, não', async () => {
    presenca.desconectou(ids.kds, minutos(-4));
    const { r, por } = await de();
    expect(por('kds')).toMatchObject({ situacao: 'caiu', linha: 'parou de responder há 4 min · último IP 192.168.0.40', alerta: true });
    expect(r.resumo.alerta).toBe(true);
    // Uma queda que não foi contada (conexão de antes de o servidor reiniciar) não refaz o "visto".
    const antes = (presenca as any).mapa.get(ids.kds).vistoEm;
    presenca.desconectou(ids.kds);
    expect((presenca as any).mapa.get(ids.kds).vistoEm).toBe(antes);
    // Depois de 1 h sem sinal: "desligado", sem alerta (não é queda durante o uso). A memória guarda 10 min; depois vale
    // a hora da última conexão gravada no banco (`ultimo_ping`).
    (presenca as any).mapa.delete(ids.kds);
    await q(`update equipamento set ultimo_ping = $2 where id = $1`, [ids.kds, new Date(Date.now() - CAIU_MS - 60_000)]);
    expect((await de()).por('kds')).toMatchObject({ situacao: 'desligado', linha: 'visto pela última vez há 1 h', alerta: false });
  });

  // Decisão do dono (25/10/2026): o "caixa" do ícone é o TERMINAL; o amarelo vale só com o caixa FINANCEIRO aberto nele
  // (parado no meio da venda). Caixa fechado e terminal desligado no fim do dia é normal.
  it('o terminal de caixa só acende o alerta com o caixa (financeiro) ABERTO nele; com o caixa fechado, desligar é normal', async () => {
    (presenca as any).mapa.delete(ids.pdv);
    presenca.notar({ id: ids.pdv, tenantId: T, tipo: 'pdv', ip: '192.168.0.21', endereco: 'regem.local', maquina: null, versao: '1.30.9' }, minutos(-8));
    expect((await de()).por('pdv')).toMatchObject({ situacao: 'desligado', linha: 'caixa fechado · visto pela última vez há 8 min · último IP 192.168.0.21', alerta: false });
    // O caixa de OUTRO terminal aberto não conta.
    await q(`insert into caixa_sessao (tenant_id, unidade_id, terminal_id, status) values ($1, $2, $3, 'aberta')`, [T, LOJA, ids.gogem]);
    expect((await de()).por('pdv').alerta).toBe(false);
    // Abre o caixa DESTE terminal: o mesmo silêncio vira alerta.
    await q(`insert into caixa_sessao (tenant_id, unidade_id, terminal_id, status) values ($1, $2, $3, 'aberta')`, [T, LOJA, ids.pdv]);
    const aberto = await de();
    expect(aberto.por('pdv')).toMatchObject({ situacao: 'caiu', linha: 'parou de responder há 8 min · caixa aberto · último IP 192.168.0.21', alerta: true });
    expect(aberto.r.resumo.alerta).toBe(true);
    // Com o caixa aberto, segue amarelo depois de 1 h (o caixa aberto e parado continua sendo problema).
    (presenca as any).mapa.delete(ids.pdv);
    await q(`update equipamento set ultimo_uso_em = $2 where id = $1`, [ids.pdv, new Date(Date.now() - CAIU_MS - 60_000)]);
    expect((await de()).por('pdv')).toMatchObject({ situacao: 'caiu', linha: 'parou de responder há 1 h · caixa aberto', alerta: true });
    // Fechou o caixa: desligado, sem alerta.
    await q(`update caixa_sessao set status = 'fechada', fechada_em = now() where terminal_id = $1`, [ids.pdv]);
    expect((await de()).por('pdv')).toMatchObject({ situacao: 'desligado', linha: 'caixa fechado · visto pela última vez há 1 h', alerta: false });
  });

  it('a nuvem fora: "sem sincronizar com a nuvem há N min"', async () => {
    await q(`update sync_state set valor = $1 where chave = 'nuvem_contato'`, [
      JSON.stringify({ okEm: minutos(-9).toISOString(), falhandoDesde: minutos(-7).toISOString() }),
    ]);
    expect((await de()).r.servidor.nuvem).toEqual({ situacao: 'falhando', linha: 'sem sincronizar com a nuvem há 7 min' });
  });

  it('gerar código, revogar e reativar pelo ícone — com as regras do serviço e a auditoria do computador', async () => {
    auditados.length = 0;
    const quem = { maquina: 'SERVIDOR-LOJA', usuario: 'caixa' };
    const c: any = await svc.agir('codigo', ids.pdv, quem);
    expect(c.codigo).toMatch(/^\d{6}$/);
    expect(c.onde.titulo).toBe('No caixa');
    expect(auditados.at(-1)).toMatchObject({ acao: 'terminal_codigo_gerado', atorId: null, atorTipo: 'sistema', origem: 'bandeja_servidor',
      detalhe: { pelo: 'ícone do servidor', maquina: 'SERVIDOR-LOJA', usuarioWindows: 'caixa' } });

    await expect(svc.agir('codigo', ids.kds, quem)).rejects.toThrow('"KDS chapa" não pareia por código.');
    await expect(svc.agir('codigo', ids.gogem, quem)).rejects.toThrow('não pareia por código');
    await expect(svc.agir('revogar', ids.imp, quem)).rejects.toThrow('é o aparelho padrão e não se revoga');
    await expect(svc.agir('revogar', ids.outraLoja, quem)).rejects.toThrow('Aparelho não encontrado neste servidor');

    await svc.agir('revogar', ids.salao, quem);
    expect((await q('select ativo, segredo_hash from equipamento where id = $1', [ids.salao]))[0]).toEqual({ ativo: false, segredo_hash: null });
    expect(auditados.at(-1)).toMatchObject({ acao: 'revogou_equipamento', origem: 'bandeja_servidor' });
    await expect(svc.agir('revogar', ids.salao, quem)).rejects.toThrow('já está revogado');

    const v: any = await svc.agir('reativar', ids.salao, quem);
    expect(v).toMatchObject({ ok: true, nome: 'Garçom 2', codigo: expect.stringMatching(/^\d{6}$/), onde: { titulo: 'No celular ou tablet do garçom' } });
    expect(auditados.at(-1)).toMatchObject({ acao: 'reativou_equipamento', origem: 'bandeja_servidor', detalhe: { usuarioWindows: 'caixa' } });
    await expect(svc.agir('reativar', ids.velho, quem)).rejects.toThrow('foi revogado há mais de 30 dias');
  });

  it('sem a loja do instalador e com mais de uma empresa no banco, não adivinha', async () => {
    delete process.env.EDGE_UNIDADE_ID;
    await q(`insert into empresa (id, nome) values ($1, 'segunda empresa')`, [SEGUNDA]);
    await expect(svc.estado()).rejects.toThrow('ainda não sabe de qual loja é');
    process.env.EDGE_UNIDADE_ID = LOJA;
  });
});
