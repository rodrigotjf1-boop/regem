import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TelaSenhasPublicoController } from './tela-senhas.controller';
import { TelaSenhasService } from './tela-senhas.service';
import { CartaoDaTela, erroDosTamanhos, montarQuadro, tamanhosDaTela, tempoProntoValido } from './tela-senhas.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TELA DE SENHAS (Cozinha em estações, entrega 4; mig 337). Decisões do dono (21/10/2026): TV em /senhas, pareada sem
// login; Preparando e Pronto só com números (LGPD); fundo branco com a logo e o nome da loja; tamanhos das letras de
// cada TV; tempo em Pronto (padrão 10 min, ou "até o balcão entregar") e aviso — e a senha sai antes quando o balcão
// entrega. Aqui: as regras puras, o tempo real (sala só da TV) e o serviço contra o Postgres real.

const T0 = new Date('2026-10-21T20:00:00Z');
const em = (min: number) => new Date(T0.getTime() + min * 60_000);
const c = (comandaId: string, status: string, extra: Partial<CartaoDaTela> = {}): CartaoDaTela => ({
  comandaId, senha: 7, senhaPrefixo: 'B', status, criadoEm: em(-20), prontoEm: null, ...extra,
});

describe('tela de senhas — regras', () => {
  it('pedido com alguma estação trabalhando fica em Preparando; todas prontas → Pronto, desde o pronto mais recente', () => {
    expect(montarQuadro([c('a', 'pronto', { prontoEm: em(-5) }), c('a', 'preparo')], T0, 10)).toEqual({ preparando: [{ id: 'a', senha: 7, prefixo: 'B' }], pronto: [] });
    expect(montarQuadro([c('a', 'recebido')], T0, 10).preparando).toHaveLength(1);
    const q = montarQuadro([c('a', 'pronto', { prontoEm: em(-5) }), c('a', 'pronto', { prontoEm: em(-2) })], T0, 10);
    expect(q.pronto).toEqual([{ id: 'a', senha: 7, prefixo: 'B', prontoEm: em(-2).toISOString(), saiEm: em(8).toISOString() }]);
  });

  it('a estação que marcou o cartão dela como entregue não tira a senha; todos entregues ou cancelados → sai', () => {
    expect(montarQuadro([c('a', 'entregue', { prontoEm: em(-6) }), c('a', 'pronto', { prontoEm: em(-1) })], T0, 10).pronto.map((s) => s.prontoEm)).toEqual([em(-1).toISOString()]);
    expect(montarQuadro([c('a', 'entregue'), c('a', 'entregue')], T0, 10)).toEqual({ preparando: [], pronto: [] });
    expect(montarQuadro([c('a', 'cancelado'), c('a', 'cancelado')], T0, 10)).toEqual({ preparando: [], pronto: [] });
    expect(montarQuadro([c('a', 'cancelado'), c('a', 'pronto', { prontoEm: em(-1) })], T0, 10).pronto).toHaveLength(1);
  });

  it('tempo em Pronto: passou o tempo → sai; 0 = só quando o balcão entregar', () => {
    expect(montarQuadro([c('a', 'pronto', { prontoEm: em(-11) })], T0, 10).pronto).toEqual([]);
    expect(montarQuadro([c('a', 'pronto', { prontoEm: em(-9) })], T0, 10).pronto).toHaveLength(1);
    expect(montarQuadro([c('a', 'pronto', { prontoEm: em(-300) })], T0, 0).pronto).toEqual([
      { id: 'a', senha: 7, prefixo: 'B', prontoEm: em(-300).toISOString(), saiEm: null },
    ]);
  });

  it('pedido sem senha (mesa, comanda) não aparece; cada senha leva só o número, a origem e os horários', () => {
    expect(montarQuadro([c('m', 'preparo', { senha: null })], T0, 10)).toEqual({ preparando: [], pronto: [] });
    const q = montarQuadro([c('a', 'preparo'), c('b', 'pronto', { senha: 8, senhaPrefixo: 'D', prontoEm: em(-1) })], T0, 10);
    expect(Object.keys(q.preparando[0]).sort()).toEqual(['id', 'prefixo', 'senha']);
    expect(Object.keys(q.pronto[0]).sort()).toEqual(['id', 'prefixo', 'prontoEm', 'saiEm', 'senha']);
  });

  it('ordem: Preparando do mais antigo; Pronto do mais recente; cada coluna até o limite', () => {
    const q = montarQuadro(
      [
        c('novo', 'preparo', { senha: 3, criadoEm: em(-2) }),
        c('velho', 'preparo', { senha: 1, criadoEm: em(-30) }),
        c('p1', 'pronto', { senha: 10, prontoEm: em(-8) }),
        c('p2', 'pronto', { senha: 11, prontoEm: em(-1) }),
      ],
      T0,
      10,
    );
    expect(q.preparando.map((s) => s.senha)).toEqual([1, 3]);
    expect(q.pronto.map((s) => s.senha)).toEqual([11, 10]);
    expect(montarQuadro([c('a', 'preparo'), c('b', 'preparo'), c('d', 'preparo')], T0, 10, 2).preparando).toHaveLength(2);
  });

  it('ajustes: tamanhos de 60% a 160% de 10 em 10 (o que falta vira 100%); tempo só dos que o seletor oferece', () => {
    expect(tamanhosDaTela({ pronto: 120, preparando: 55, titulos: 'x' })).toEqual({ pronto: 120, preparando: 100, titulos: 100 });
    expect(tamanhosDaTela(null)).toEqual({ pronto: 100, preparando: 100, titulos: 100 });
    expect(erroDosTamanhos({ pronto: 120, preparando: 100, titulos: 90 })).toBeNull();
    expect(erroDosTamanhos({ pronto: 120 })).toMatch(/três tamanhos/);
    expect(erroDosTamanhos({ pronto: 125, preparando: 100, titulos: 100 })).toMatch(/de 10 em 10/);
    expect(erroDosTamanhos({ pronto: 100, preparando: 100, titulos: 100, cor: 1 })).toMatch(/desconhecido/);
    expect([0, 2, 10, 30].every(tempoProntoValido)).toBe(true);
    expect([7, 60, -1, '10'].some(tempoProntoValido)).toBe(false);
  });
});

describe('tela de senhas — tempo real (sala só da TV)', () => {
  const telaCerta = { id: 'tela-1', tenantId: 't1', unidadeId: 'u1', nome: 'TV', tipo: 'tela_senhas' };
  const montar = () => {
    let pings = 0;
    const g = new RealtimeGateway({ verify: () => { throw new Error('sem jwt'); } } as any, {
      validarTela: async (id: string, s: string | null) => (id === 'tela-1' && s === 'certo' ? telaCerta : null),
      registrarPing: async () => { pings++; },
    } as any);
    const emits: any[] = [];
    (g as any).server = { to: (room: string) => ({ emit: (ev: string, payload: any) => emits.push({ room, ev, payload }) }) };
    return { g, emits, pings: () => pings };
  };
  const socket = (auth: any) => {
    const salas: string[] = [];
    const s: any = { handshake: { auth, headers: {} }, data: {}, join: (r: string) => salas.push(r), emit: jest.fn(), disconnect: jest.fn(), salas };
    return s;
  };

  it('a TV com id e segredo certos entra SÓ na sala de senhas (nunca na da empresa); errado → desconecta', async () => {
    const { g } = montar();
    const boa = socket({ tela: { id: 'tela-1', segredo: 'certo' } });
    await g.handleConnection(boa);
    expect(boa.salas).toEqual(['senhas:t1']);
    expect(boa.data.ctx.role).toBe('tela');
    const ruim = socket({ tela: { id: 'tela-1', segredo: 'errado' } });
    await g.handleConnection(ruim);
    expect(ruim.salas).toEqual([]);
    expect(ruim.disconnect).toHaveBeenCalled();
  });

  it('mudança na cozinha e ajuste salvo avisam a sala de senhas SEM o conteúdo do pedido', () => {
    const { g, emits } = montar();
    g.onProducaoEvento({ tenantId: 't1', tipo: 'status', status: 'pronto', pedidoId: 'p1', destinoEquipamentoId: 'k1' });
    const aviso = emits.find((e) => e.room === 'senhas:t1');
    expect(aviso.ev).toBe('senhas:mudou');
    expect(Object.keys(aviso.payload)).toEqual(['em']);
    g.onTelaSenhasMudou({ tenantId: 't1' });
    expect(emits.filter((e) => e.room === 'senhas:t1' && e.ev === 'senhas:mudou')).toHaveLength(2);
  });

  it('a TV não grava ping (a linha dela sincroniza; o uso não pode desfazer o ajuste — ERR-235)', async () => {
    const { g, pings } = montar();
    await g.onPing({ data: { ctx: { equipamentoId: 'tela-1', role: 'tela' } } } as any);
    expect(pings()).toBe(0);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('tela-senhas.spec: sem TEST_PG_URL — a parte com Postgres foi PULADA');

descrever('tela de senhas — serviço (Postgres real)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const auditorias: any[] = [];
  const eventos: any[] = [];
  const auditoria = { registrar: async (x: any) => void auditorias.push(x) } as any;
  const equip = new EquipamentoService(db, auditoria);
  const svc = new TelaSenhasService(db, auditoria, { emit: (n: string, p: any) => eventos.push({ n, p }) } as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const um = async (s: string, p: any[] = []) => (await q(s, p))[0].id as string;

  // O banco do CI é de LOJA (sem as tabelas só da nuvem): o `edgeAtivo` da nuvem lê o `edge_heartbeat` — criado aqui
  // "como nuvem", no formato das outras specs (reativar, estação de impressão).
  beforeAll(async () => {
    await q(`create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(),
             ativacao_id uuid, tenant_id uuid, unidade_id uuid, versao text, estado text, ultimo_sync timestamptz,
             disco_livre_mb integer, clientes integer, fingerprint text, saude jsonb, erro text,
             recebido_em timestamptz not null default now())`);
  });

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['producao_pedido', 'comanda', 'kds_cor_config', 'cardapio_config', 'equipamento', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => undefined);
      await pool.query(`delete from edge_heartbeat where tenant_id = any($1::uuid[])`, [empresas]).catch(() => undefined);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => undefined);
    }
    await pool.end();
  }, 120_000);

  // Uma empresa com duas lojas e uma TV na "Loja Centro", pareada pelo caminho de verdade (código → segredo).
  async function cenario() {
    const t = await um(`insert into empresa (nome) values ('teste tela de senhas') returning id`);
    empresas.push(t);
    const u = await um(`insert into unidade (tenant_id, nome) values ($1, 'Loja Centro') returning id`, [t]);
    const outra = await um(`insert into unidade (tenant_id, nome) values ($1, 'Loja Norte') returning id`, [t]);
    const tv = await um(
      `insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo) values ($1, $2, 'tela_senhas', 'TV do balcão', $3, true) returning id`,
      [t, u, randomUUID()],
    );
    const { codigo } = await equip.gerarCodigo(t, tv, randomUUID(), 'presidente');
    const par = await equip.parearPorCodigo(codigo, undefined, 'tela_senhas');
    return { t, u, outra, tv, segredo: par.segredo };
  }
  const cartao = async (t: string, o: { comanda: string; status: string; senha?: number | null; prefixo?: string | null; unidade?: string | null; destino?: string; criadoHa?: number; prontoHa?: number | null }) => {
    // O cartão aponta para a venda (chave estrangeira no banco): a comanda existe antes.
    await q(`insert into comanda (id, tenant_id, unidade_id, status, total) values ($1, $2, $3, 'fechada', 10) on conflict (id) do nothing`, [o.comanda, t, o.unidade ?? null]);
    return q(
      `insert into producao_pedido (tenant_id, unidade_id, comanda_id, destino_tipo, status, senha, senha_prefixo, criado_em, pronto_em)
       values ($1, $2, $3, $4, $5, $6, $7, now() - make_interval(mins => $8::int),
               case when $9::int is null then null else now() - make_interval(mins => $9::int) end)`,
      [t, o.unidade ?? null, o.comanda, o.destino ?? 'kds', o.status, o.senha === undefined ? 1 : o.senha, o.prefixo === undefined ? 'B' : o.prefixo, o.criadoHa ?? 5, o.prontoHa ?? null],
    );
  };
  const telaDe = async (t: string, tv: string) => {
    const [r] = await q(`select id, tenant_id as "tenantId", unidade_id as "unidadeId", nome, tela_tamanhos as "telaTamanhos" from equipamento where id = $1`, [tv]);
    return r;
  };

  it('o quadro: só a loja da TV (ou sem loja), só cartões de KDS, janela de 12 h, só números', async () => {
    const s = await cenario();
    const id = () => randomUUID();
    const [a, b, cc] = [id(), id(), id()];
    await cartao(s.t, { comanda: a, status: 'preparo', senha: 12, prefixo: 'B', unidade: s.u });
    await cartao(s.t, { comanda: b, status: 'pronto', senha: 7, prefixo: 'D', unidade: s.u, prontoHa: 3 });
    await cartao(s.t, { comanda: b, status: 'pronto', senha: 7, prefixo: 'D', unidade: s.u, prontoHa: 1 });
    await cartao(s.t, { comanda: cc, status: 'pronto', senha: 30, prefixo: 'B', unidade: null, prontoHa: 5 });
    await cartao(s.t, { comanda: id(), status: 'preparo', senha: 99, unidade: s.outra }); // outra loja
    await cartao(s.t, { comanda: id(), status: 'preparo', senha: 50, unidade: s.u, destino: 'impressora' }); // só papel
    await cartao(s.t, { comanda: id(), status: 'preparo', senha: null, unidade: s.u }); // mesa, sem senha
    await cartao(s.t, { comanda: id(), status: 'preparo', senha: 61, unidade: s.u, criadoHa: 13 * 60 }); // fora da janela
    await cartao(s.t, { comanda: id(), status: 'pronto', senha: 62, unidade: s.u, prontoHa: 11 }); // passou dos 10 min
    const ent = id();
    await cartao(s.t, { comanda: ent, status: 'entregue', senha: 63, unidade: s.u, prontoHa: 2 });
    // Pedido com KDS E papel: o cartão de papel nunca fica "pronto" (ninguém o marca numa tela) — se entrasse na conta,
    // a senha ficaria presa em Preparando para sempre.
    const mista = id();
    await cartao(s.t, { comanda: mista, status: 'pronto', senha: 44, prefixo: 'B', unidade: s.u, prontoHa: 4 });
    await cartao(s.t, { comanda: mista, status: 'recebido', senha: 44, prefixo: 'B', unidade: s.u, destino: 'impressora' });
    const r = await svc.quadro(await telaDe(s.t, s.tv));
    expect(r.preparando).toEqual([{ id: a, senha: 12, prefixo: 'B' }]);
    expect(r.pronto.map((p) => [p.senha, p.prefixo])).toEqual([[7, 'D'], [44, 'B'], [30, 'B']]);
    expect(r.ajustes).toEqual({ tamanhos: { pronto: 100, preparando: 100, titulos: 100 }, prontoMin: 10, som: true });
    expect(new Date(r.agora).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('logo e nome: os da loja, senão os da empresa, campo a campo; sem nome público, o nome da unidade', async () => {
    const s = await cenario();
    expect(await svc.lojaDaTela(s.t, s.u)).toEqual({ nome: 'Loja Centro', logoRef: null, logoEmoji: null });
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, nome_publico, logo_ref) values ($1, null, $2, 'Burger da Esquina', 'https://exemplo/logo.png')`, [s.t, randomUUID()]);
    expect(await svc.lojaDaTela(s.t, s.u)).toEqual({ nome: 'Burger da Esquina', logoRef: 'https://exemplo/logo.png', logoEmoji: null });
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, nome_publico) values ($1, $2, $3, 'Burger Centro')`, [s.t, s.u, randomUUID()]);
    expect(await svc.lojaDaTela(s.t, s.u)).toEqual({ nome: 'Burger Centro', logoRef: 'https://exemplo/logo.png', logoEmoji: null });
  });

  it('tempo e aviso: loja → empresa → padrão, campo a campo; salvar grava na linha da EMPRESA sem mexer nas cores do KDS', async () => {
    const s = await cenario();
    await q(`insert into kds_cor_config (tenant_id, unidade_id, verde_ate_min, amarelo_ate_min) values ($1, null, 6, 12)`, [s.t]);
    expect(await svc.ajustesDaLoja(s.t, s.u)).toEqual({ prontoMin: 10, som: true });
    await svc.salvarAjustes(s.t, s.tv, { prontoMin: 5, som: false });
    const empresa = await q(`select verde_ate_min, amarelo_ate_min, tela_pronto_min, tela_som from kds_cor_config where tenant_id = $1 and unidade_id is null`, [s.t]);
    expect(empresa).toEqual([{ verde_ate_min: 6, amarelo_ate_min: 12, tela_pronto_min: 5, tela_som: false }]);
    // Uma loja com ajuste próprio do tempo (e sem o do aviso) herda o aviso da empresa.
    await q(`insert into kds_cor_config (tenant_id, unidade_id, tela_pronto_min) values ($1, $2, 20)`, [s.t, s.u]);
    expect(await svc.ajustesDaLoja(s.t, s.u)).toEqual({ prontoMin: 20, som: false });
    expect(await svc.ajustesDaLoja(s.t, s.outra)).toEqual({ prontoMin: 5, som: false });
  });

  it('sem ajuste da empresa: dois salvamentos juntos criam UMA linha (o índice único da 034), com as cores padrão', async () => {
    const s = await cenario();
    await Promise.all([svc.salvarAjustes(s.t, s.tv, { prontoMin: 15 }), svc.salvarAjustes(s.t, s.tv, { som: false })]);
    const linhas = await q(`select verde_ate_min, amarelo_ate_min, usa_preparo, usa_entregue from kds_cor_config where tenant_id = $1`, [s.t]);
    expect(linhas).toEqual([{ verde_ate_min: 5, amarelo_ate_min: 10, usa_preparo: true, usa_entregue: true }]);
  });

  it('salvar: ausente mantém, valor torto é recusado, e o que mudou vai para a auditoria e avisa as TVs', async () => {
    const s = await cenario();
    await svc.salvarAjustes(s.t, s.tv, { prontoMin: 2 });
    auditorias.length = 0;
    eventos.length = 0;
    const r = await svc.salvarAjustes(s.t, s.tv, { tamanhos: { pronto: 130, preparando: 100, titulos: 90 } });
    expect(r).toEqual({ tamanhos: { pronto: 130, preparando: 100, titulos: 90 }, prontoMin: 2, som: true });
    expect((await q(`select tela_tamanhos from equipamento where id = $1`, [s.tv]))[0].tela_tamanhos).toEqual({ pronto: 130, preparando: 100, titulos: 90 });
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]).toMatchObject({ acao: 'configurou_tela_senhas', entidadeId: s.tv, detalhe: { mudou: ['tamanhos'] } });
    expect(eventos).toEqual([{ n: 'tela.senhas.mudou', p: { tenantId: s.t } }]);
    // Valor torto: 400 e nada muda.
    await expect(svc.salvarAjustes(s.t, s.tv, { prontoMin: 7 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.salvarAjustes(s.t, s.tv, { som: 'sim' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.salvarAjustes(s.t, s.tv, { tamanhos: { pronto: 300, preparando: 100, titulos: 100 } })).rejects.toBeInstanceOf(BadRequestException);
    // Sem mudança: nem auditoria nem aviso.
    await svc.salvarAjustes(s.t, s.tv, { prontoMin: 2 });
    expect(auditorias).toHaveLength(1);
    expect(eventos).toHaveLength(1);
    expect(await svc.ajustesDaLoja(s.t, s.u)).toEqual({ prontoMin: 2, som: true });
  });

  it('com o servidor da loja ligado, a nuvem não salva os ajustes (403) — como o KDS', async () => {
    const s = await cenario();
    const existe = (await q(`select to_regclass('edge_heartbeat') as t`))[0].t;
    if (!existe) return console.warn('tela-senhas.spec: banco sem edge_heartbeat — caso do servidor da loja não conferido aqui');
    const ehEdge = process.env.EDGE_MODE;
    delete process.env.EDGE_MODE;
    try {
      await q(`insert into edge_heartbeat (tenant_id, recebido_em) values ($1, now())`, [s.t]);
      await expect(svc.salvarAjustes(s.t, s.tv, { prontoMin: 5 })).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      if (ehEdge !== undefined) process.env.EDGE_MODE = ehEdge;
    }
  });

  it('pareamento: o código de OUTRO equipamento não é gasto; a TV só passa com o segredo dela, ativa', async () => {
    const s = await cenario();
    const pdv = await um(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo) values ($1, $2, 'pdv', 'Caixa 1', $3, true) returning id`, [s.t, s.u, randomUUID()]);
    const { codigo } = await equip.gerarCodigo(s.t, pdv, randomUUID(), 'presidente');
    await expect(equip.parearPorCodigo(codigo, undefined, 'tela_senhas')).rejects.toThrow(/não de uma tela de senhas/);
    const [depois] = await q(`select pareamento_codigo, segredo_hash from equipamento where id = $1`, [pdv]);
    expect(depois).toEqual({ pareamento_codigo: codigo, segredo_hash: null });
    expect((await equip.validarTela(s.tv, s.segredo))?.id).toBe(s.tv);
    expect(await equip.validarTela(s.tv, 'segredo-errado')).toBeNull();
    expect(await equip.validarTela('nao-e-uuid', s.segredo)).toBeNull();
    await q(`update equipamento set ativo = false, revogado_em = now() where id = $1`, [s.tv]);
    expect(await equip.validarTela(s.tv, s.segredo)).toBeNull();
  });

  it('a TV lendo o quadro não grava "último uso" nem renova a linha dela (ERR-235)', async () => {
    const s = await cenario();
    const [antes] = await q(`select updated_at, ultimo_uso_em, ultimo_ping from equipamento where id = $1`, [s.tv]);
    const tela = await equip.validarTela(s.tv, s.segredo);
    const ctrl = new TelaSenhasPublicoController(svc, { ativo: async () => true } as any);
    await ctrl.quadro(tela);
    await ctrl.quadro(tela);
    const [depois] = await q(`select updated_at, ultimo_uso_em, ultimo_ping from equipamento where id = $1`, [s.tv]);
    expect(depois).toEqual(antes);
  });

  it('KDS desligado na loja: a rota da TV responde 403 com o motivo (e não o quadro)', async () => {
    const s = await cenario();
    const tela = await equip.validarTela(s.tv, s.segredo);
    const ctrl = new TelaSenhasPublicoController(svc, { ativo: async () => false } as any);
    await expect(ctrl.quadro(tela)).rejects.toThrow(/KDS está desligado/);
  });
});
