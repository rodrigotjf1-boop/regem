import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { BadRequestException } from '@nestjs/common';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { lerAjusteDaPonte } from '../ponte-chat/ajustes-da-ponte.service';
import { AJUSTE_DA_FILA_PADRAO, FilaEAvisosService, lerAjusteDaFila } from './fila-e-avisos.service';
import { AtendimentoService } from './atendimento.service';
import { AtendimentoController } from './atendimento.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// FILA E AVISOS (Onda 2 da central, mig 353), contra o Postgres real: o aviso ao gerente (quem entra, uma vez só, duas
// réplicas ao mesmo tempo), os ajustes (padrão, V15/V16, só as próprias colunas — V82) e o robô sem a posição quando o
// ajuste está desligado. A `robo_config` é só da nuvem: o teste aplica as migrations (o banco do CI é o de uma loja).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('fila-e-avisos-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(90_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

describe('o que a tela manda em "Fila e avisos"', () => {
  it('minutos da lista (número), liga/desliga só com booleano, ausente fica de fora', () => {
    expect(lerAjusteDaFila({ avisarGerenteMin: 5 })).toEqual({ avisarGerenteMin: 5 });
    expect(lerAjusteDaFila({ avisarGerenteMin: 0, dizerPosicao: false })).toEqual({ avisarGerenteMin: 0, dizerPosicao: false });
    expect(lerAjusteDaFila({})).toEqual({});
    expect(lerAjusteDaFila(null)).toEqual({});
    for (const ruim of [7, '5', true, null, 2.5, -3])
      expect(() => lerAjusteDaFila({ avisarGerenteMin: ruim })).toThrow('Avisar o gerente: escolha 2, 3, 5 ou 10 minutos, ou "Não avisar".');
    expect(() => lerAjusteDaFila({ dizerPosicao: 'sim' })).toThrow('dizerPosicao');
  });
});

descrever('fila e avisos (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const avisos: any[] = [];
  const auditados: any[] = [];
  const eventos = { emit: (ev: string, p: any) => void avisos.push({ ev, p }) } as any;
  const svc = new FilaEAvisosService(db, eventos, { registrar: async (e: any) => void auditados.push(e) } as any);
  const empresas: string[] = [];
  let A: string; // empresa sem ajuste (padrão: 3 min)
  let B: string; // empresa com 10 min
  let Z: string; // empresa com o aviso desligado (0)
  let gerente: string;

  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(comTravaDaEmpresa(readFileSync(MIG(arq), 'utf8')));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });
  const empresa = async (nome: string) => {
    const [{ id }] = await q(`insert into empresa (nome) values ($1) returning id`, [nome]);
    empresas.push(id);
    return id as string;
  };
  const caso = async (t: string, minutosAtras: number, extra: Record<string, unknown> = {}) => {
    const c = { responsavel_id: null, aguardando_desde: null, prazo_em: null, status: 'aberto', detalhe: null, ...extra } as any;
    const [{ id }] = await q(
      `insert into atendimento_chamado (tenant_id, tipo, canal, prioridade, criado_em, responsavel_id, aguardando_desde, prazo_em, status, detalhe)
       values ($1, 'humano', 'whatsapp', 'normal', now() - make_interval(mins => $2), $3, $4, $5, $6, $7) returning id`,
      [t, minutosAtras, c.responsavel_id, c.aguardando_desde, c.prazo_em, c.status, c.detalhe],
    );
    return id as string;
  };
  const marca = async (id: string) => (await q(`select detalhe -> 'escalado' as e, detalhe from atendimento_chamado where id = $1`, [id]))[0];
  // A rotina varre a nuvem inteira (no CI, as specs dividem o banco): o teste olha só os casos DELE.
  const meus = () => avisos.filter((a) => a.ev === 'atendimento.mudou' && a.p.motivo === 'escalou' && empresas.includes(a.p.tenantId));

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    // A 363 ("O robô faz mudanças simples", no grupo "Pedido alterado") altera o carrinho da 344 (ERR-273).
    // A 373: "O robô cobra no Pix o item posto em pedido já pago" (`robo_config.cobra_adicional_pix`) — ERR-273.
    // A 379: "Horário da equipe" (`robo_config.equipe_*`) — o aviso ao gerente não marca o recado (ERR-273).
    // A 380: "Perfil do atendente virtual" (`robo_config.atendente_perfis`) — o GET dos ajustes lê (ERR-273).
    for (const m of [
      '342_robo_pausa_e_config.sql',
      '353_app_atendimento.sql',
      '344_robo_carrinho.sql',
      '363_robo_mudanca_do_pedido.sql',
      '373_pedido_adicional_pix.sql',
      '379_horario_da_equipe.sql',
      '380_perfis_do_atendente.sql',
    ])
      await aplicar(m);
    A = await empresa('teste aviso ao gerente A');
    B = await empresa('teste aviso ao gerente B');
    Z = await empresa('teste aviso ao gerente Z');
    await q(`insert into robo_config (tenant_id, avisar_gerente_min) values ($1, 10), ($2, 0)`, [B, Z]);
    [{ id: gerente }] = await q(`insert into colaborador (tenant_id, nome) values ($1, 'Gerente A') returning id`, [A]);
  });
  beforeEach(() => {
    avisos.length = 0;
    auditados.length = 0;
    delete process.env.EDGE_MODE;
  });
  afterAll(async () => {
    delete process.env.EDGE_MODE;
    for (const t of ['atendimento_chamado', 'robo_config', 'colaborador'])
      await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
    await q(`delete from empresa where id = any($1::uuid[])`, [empresas]).catch(() => {});
    await pool.end();
  });

  it('marca o caso que espera uma pessoa há mais que o ajuste (padrão 3 min) — e só ele', async () => {
    const velho = await caso(A, 4);
    const novo = await caso(A, 2);
    const comAlguem = await caso(A, 30, { responsavel_id: gerente });
    const aguardando = await caso(A, 30, { aguardando_desde: new Date() });
    const comPrazo = await caso(A, 30, { prazo_em: new Date(Date.now() + 600_000) });
    const resolvido = await caso(A, 30, { status: 'resolvido' });
    const dezMin = await caso(B, 11);
    const naoDez = await caso(B, 4);
    const desligado = await caso(Z, 60);
    const comOutraMarca = await caso(A, 5, { detalhe: JSON.stringify({ robo: { motivo: 'atraso' } }) });
    await svc.escalar(empresas);
    expect((await marca(velho)).e).toMatchObject({ minutos: 3 });
    expect((await marca(dezMin)).e).toMatchObject({ minutos: 10 });
    for (const id of [novo, comAlguem, aguardando, comPrazo, resolvido, naoDez, desligado]) expect((await marca(id)).e).toBeNull();
    // mescla no banco: o resto do detalhe fica (V82)
    const outra = await marca(comOutraMarca);
    expect(outra.detalhe).toMatchObject({ robo: { motivo: 'atraso' }, escalado: { minutos: 3 } });
    expect(meus().map((a) => a.p.id).sort()).toEqual([velho, dezMin, comOutraMarca].sort());
  });

  it('UMA vez por caso: a volta seguinte não marca de novo; duas réplicas ao mesmo tempo, um aviso só', async () => {
    const id = await caso(A, 6);
    await svc.escalar(empresas);
    const primeira = (await marca(id)).e;
    expect(primeira).not.toBeNull();
    await svc.escalar(empresas);
    expect((await marca(id)).e).toEqual(primeira); // o "em" não anda
    expect(meus().filter((a) => a.p.id === id)).toHaveLength(1);
    const ids = await Promise.all([1, 2, 3, 4, 5].map(() => caso(A, 7)));
    avisos.length = 0;
    const outra = new FilaEAvisosService(db, eventos);
    await Promise.all([svc.escalar(empresas), outra.escalar(empresas), svc.escalar(empresas)]);
    const deles = meus().filter((a) => ids.includes(a.p.id));
    expect(deles.map((a) => a.p.id).sort()).toEqual([...ids].sort());
  });

  it('a volta não emperra: o que não vale (já avisado, com alguém, resolvido) não ocupa o limite', async () => {
    const F = await empresa('teste aviso não emperra');
    const [{ id: alguem }] = await q(`insert into colaborador (tenant_id, nome) values ($1, 'Alguém F') returning id`, [F]);
    // Os que NÃO valem são os mais antigos (a volta segue a ordem de chegada) — com o limite de 1, só a seleção certa
    // chega ao que vale.
    await caso(F, 90, { detalhe: JSON.stringify({ escalado: { em: new Date().toISOString(), minutos: 3 } }) });
    await caso(F, 80, { responsavel_id: alguem });
    await caso(F, 70, { status: 'resolvido' });
    const vale = await caso(F, 60);
    expect(await svc.escalar([F], 1)).toBe(1);
    expect((await marca(vale)).e).not.toBeNull();
  });

  it('a rotina só roda na nuvem (no servidor da loja não há robô nem app)', async () => {
    const id = await caso(A, 9);
    process.env.EDGE_MODE = 'true';
    try {
      await svc.tick();
    } finally {
      delete process.env.EDGE_MODE;
    }
    expect((await marca(id)).e).toBeNull();
    // (a volta da nuvem sem filtro marcaria casos de outras specs no banco dividido do CI: aqui, só as empresas do teste)
    await svc.escalar(empresas);
    expect((await marca(id)).e).not.toBeNull();
  });

  it('os ajustes: padrão sem linha; salva só o que veio (V16); não mexe nas colunas do robô (V82); fica na auditoria', async () => {
    const C = await empresa('teste ajustes da fila');
    const user = { tenantId: C, colaboradorId: null, categoria: 'gerente' } as any;
    expect(await svc.ajustes(C)).toEqual(AJUSTE_DA_FILA_PADRAO);
    expect(await svc.salvar(user, { avisarGerenteMin: 5 })).toEqual({ avisarGerenteMin: 5, dizerPosicao: true });
    await q(`update robo_config set pausa_minutos = 120 where tenant_id = $1`, [C]); // o outro escritor da linha
    expect(await svc.salvar(user, { dizerPosicao: false })).toEqual({ avisarGerenteMin: 5, dizerPosicao: false });
    expect((await q(`select pausa_minutos from robo_config where tenant_id = $1`, [C]))[0].pausa_minutos).toBe(120);
    expect(await svc.salvar(user, {})).toEqual({ avisarGerenteMin: 5, dizerPosicao: false });
    await expect(svc.salvar(user, { avisarGerenteMin: 4 })).rejects.toThrow('Avisar o gerente');
    await expect(svc.salvar(user, { dizerPosicao: 'nao' })).rejects.toThrow('dizerPosicao');
    expect(await svc.ajustes(C)).toEqual({ avisarGerenteMin: 5, dizerPosicao: false });
    expect(auditados.map((a) => a.acao)).toEqual(['aviso_ao_gerente_alterado', 'dizer_posicao_desligado']);
    expect(auditados[0]).toMatchObject({ entidadeTipo: 'robo_config', detalhe: { de: 3, para: 5 } });
  });

  it('a rota: confere a fila ANTES de gravar a 99 (um salvar com os dois grupos não grava pela metade)', async () => {
    const D = await empresa('teste rota de ajustes');
    const user = { tenantId: D, colaboradorId: null, categoria: 'gerente' } as any;
    const gravados99: any[] = [];
    const pedido99 = {
      ajustes: async () => ({ conectado99: true, ajuste99: { decidirCancelamento: true }, horasPermitidas: [4] }),
      salvarAjustes: async (_u: any, dto: any) => void gravados99.push(dto),
    } as any;
    const gravadosIfood: any[] = [];
    const chatIfood = {
      ajustes: async () => ({ conectadoIfood: true, ajusteIfood: { chat: true, avisarDisputa: true, avisarDeNovoMin: 2 }, minutosDeNovo: [1, 2, 3] }),
      salvarAjustes: async (_u: any, dto: any) => void gravadosIfood.push(dto),
    } as any;
    // "Cheguei" (mig 354): o grupo da retirada, gravado na loja em uso.
    const gravadosCheguei: any[] = [];
    const chegada = {
      ajustes: async (_t: string, loja: string | null) => ({ ativo: false, perguntarOnde: true, todasTelas: true, deNovoMin: 5, temCardapio: true, loja }),
      salvarAjustes: async (_u: any, loja: string | null, parcial: any) => void gravadosCheguei.push({ loja, parcial }),
    } as any;
    // "Pedido repetido" (mig 360): o grupo do pedido igual, gravado na loja em uso.
    const gravadosRepetido: any[] = [];
    const repetido = {
      ajustes: async (_t: string, loja: string | null) => ({ ativo: true, minutos: 30, temCardapio: true, janelas: [10, 15, 20, 30, 45, 60], loja }),
      salvarAjustes: async (_u: any, loja: string | null, parcial: any) => void gravadosRepetido.push({ loja, parcial }),
    } as any;
    // "Pedido alterado" (mig 362): o som do KDS, gravado no ajuste do KDS da loja em uso.
    const gravadosSom: any[] = [];
    const producao = {
      somDoAlterado: async () => '1min',
      salvarSomDoAlterado: async (_t: string, loja: string | null, som: string) => void gravadosSom.push({ loja, som }),
    } as any;
    // A ponte do chat (mig 366, parte A2): o grupo "iFood e 99 · chat pela ponte".
    const gravadosPonte: any[] = [];
    const ponte = {
      ajustes: async () => ({ ligada: false }),
      // a conferência de verdade do texto; o papel dos PCs, como o serviço recusa sem a principal
      conferir: async (_u: any, _loja: string | null, dto: any) => {
        lerAjusteDaPonte(dto);
        if (dto?.onde === 'escolher' && !dto.principalId) throw new BadRequestException('Escolha o PC principal da ponte.');
      },
      salvar: async (_u: any, loja: string | null, dto: any) => void gravadosPonte.push({ loja, dto }),
      situacao: async () => null,
    } as any;
    // O último é o chat do caso (ponte do chat, Etapa 2): os ajustes não passam por ele.
    const rota = new AtendimentoController({} as any, {} as any, pedido99, chatIfood, svc, chegada, repetido, producao, ponte, {} as any);
    // o texto do aviso da ponte com WhatsApp: nada é gravado (nem a fila, nem a 99, nem a ponte)
    await expect(
      rota.salvarAjustes(user, null, { fila: { avisarGerenteMin: 10 }, ajuste99: { decidirCancelamento: false }, ponte: { avisos: { saiu: { texto: 'Chama no whats' } } } }),
    ).rejects.toThrow('proíbem telefone, WhatsApp, Instagram ou link');
    expect([gravados99, gravadosPonte]).toEqual([[], []]);
    // o papel dos PCs recusado (precisa ler as pontes): também nada é gravado — a 99 viria antes da ponte
    await expect(rota.salvarAjustes(user, null, { ajuste99: { decidirCancelamento: false }, ponte: { onde: 'escolher' } })).rejects.toThrow(
      'Escolha o PC principal da ponte.',
    );
    expect([gravados99, gravadosPonte]).toEqual([[], []]);
    // o grupo do iFood torto: nada é gravado (nem a fila, nem a 99)
    await expect(rota.salvarAjustes(user, null, { fila: { avisarGerenteMin: 10 }, ifood: { avisarDeNovoMin: 5 }, ajuste99: { decidirCancelamento: false } })).rejects.toThrow('Avisar de novo');
    expect([gravados99, gravadosIfood]).toEqual([[], []]);
    expect((await svc.ajustes(D)).avisarGerenteMin).toBe(3);
    await expect(rota.salvarAjustes(user, null, { fila: { avisarGerenteMin: 4 }, ajuste99: { decidirCancelamento: false } })).rejects.toThrow('Avisar o gerente');
    expect(gravados99).toEqual([]);
    // o grupo do "Cheguei" torto: nada é gravado de nenhum grupo
    await expect(rota.salvarAjustes(user, null, { fila: { avisarGerenteMin: 10 }, cheguei: { deNovoMin: 7 } })).rejects.toThrow('Avisar de novo: escolha 3, 5 ou 10');
    await expect(rota.salvarAjustes(user, null, { ajuste99: { decidirCancelamento: false }, cheguei: { ativo: 'sim' } })).rejects.toThrow();
    expect([gravados99, gravadosCheguei, (await svc.ajustes(D)).avisarGerenteMin]).toEqual([[], [], 3]);
    const r: any = await rota.salvarAjustes(user, null, { fila: { avisarGerenteMin: 10 } });
    expect(gravados99).toEqual([]); // só a fila veio: a 99 nem é chamada (funciona sem a 99 conectada)
    expect(r).toMatchObject({ conectado99: true, fila: { avisarGerenteMin: 10, dizerPosicao: true }, minutosDoAviso: [0, 2, 3, 5, 10], conectadoIfood: true, minutosDeNovo: [1, 2, 3], cheguei: { ativo: false, temCardapio: true }, minutosDeNovoCheguei: [3, 5, 10] });
    await rota.salvarAjustes(user, null, { ifood: { chat: false } });
    expect(gravadosIfood).toEqual([{ chat: false }]);
    await rota.salvarAjustes(user, null, { ajuste99: { decidirCancelamento: false } });
    expect(gravados99).toHaveLength(1);
    const comLoja: any = await rota.salvarAjustes(user, 'loja-x', { cheguei: { ativo: true, deNovoMin: 10 } });
    expect(gravadosCheguei).toEqual([{ loja: 'loja-x', parcial: { ativo: true, deNovoMin: 10 } }]);
    expect(comLoja.cheguei.loja).toBe('loja-x'); // a resposta relê a mesma loja
    // o grupo do "Pedido repetido" torto (janela fora da lista, liga/desliga em texto): nada é gravado de nenhum grupo
    await expect(rota.salvarAjustes(user, null, { cheguei: { ativo: false }, repetido: { minutos: 25 } })).rejects.toThrow('Pedido igual: escolha 10, 15, 20, 30, 45 ou 60');
    await expect(rota.salvarAjustes(user, null, { cheguei: { ativo: false }, repetido: { ativo: 'não' } })).rejects.toThrow();
    expect([gravadosCheguei.length, gravadosRepetido]).toEqual([1, []]);
    const comRepetido: any = await rota.salvarAjustes(user, 'loja-x', { repetido: { ativo: false, minutos: 45 } });
    expect(gravadosRepetido).toEqual([{ loja: 'loja-x', parcial: { ativo: false, minutos: 45 } }]);
    expect(comRepetido.repetido).toMatchObject({ temCardapio: true, janelas: [10, 15, 20, 30, 45, 60], loja: 'loja-x' });
    // o grupo do "Pedido alterado" torto (som fora da lista): nada é gravado de nenhum grupo
    await expect(rota.salvarAjustes(user, null, { cheguei: { ativo: false }, alterado: { som: '5min' } })).rejects.toThrow('Som do pedido alterado');
    expect([gravadosCheguei.length, gravadosSom]).toEqual([1, []]);
    const comSom: any = await rota.salvarAjustes(user, 'loja-x', { alterado: { som: 'uma' } });
    expect(gravadosSom).toEqual([{ loja: 'loja-x', som: 'uma' }]);
    expect(comSom.alterado).toEqual({ som: '1min', sons: ['uma', '1min', '2min'], roboMuda: true, roboCobraPix: false });
    // "O robô faz mudanças simples" (mig 363), no mesmo grupo: nasce ligado; só verdadeiro/falso; o som não muda junto.
    auditados.length = 0;
    await expect(rota.salvarAjustes(user, null, { alterado: { roboMuda: 'sim' } })).rejects.toThrow('O robô faz mudanças simples');
    expect(gravadosSom).toHaveLength(1);
    const desligado: any = await rota.salvarAjustes(user, null, { alterado: { roboMuda: false } });
    expect(desligado.alterado.roboMuda).toBe(false);
    expect(gravadosSom).toHaveLength(1);
    expect((await q(`select muda_pedido from robo_config where tenant_id = $1`, [D]))[0].muda_pedido).toBe(false);
    // Grava SÓ a coluna dela (V82): a fila que esta empresa salvou antes continua.
    expect((await svc.ajustes(D)).avisarGerenteMin).toBe(10);
    await rota.salvarAjustes(user, null, { alterado: { roboMuda: false } }); // de novo: nada muda, nada na auditoria
    expect(auditados.map((a) => a.acao)).toEqual(['robo_muda_pedido_desligado']);
    expect((await rota.salvarAjustes(user, null, { alterado: { roboMuda: true } })).alterado.roboMuda).toBe(true);
    // "O robô cobra no Pix o item posto em pedido já pago" (mig 373): nasce DESLIGADO; só verdadeiro/falso; grava só a dela.
    auditados.length = 0;
    await expect(rota.salvarAjustes(user, null, { alterado: { roboCobraPix: 'sim' } })).rejects.toThrow('O robô cobra no Pix');
    const comPix: any = await rota.salvarAjustes(user, null, { alterado: { roboCobraPix: true } });
    expect(comPix.alterado).toMatchObject({ roboCobraPix: true, roboMuda: true });
    expect((await q(`select muda_pedido, cobra_adicional_pix from robo_config where tenant_id = $1`, [D]))[0]).toEqual({ muda_pedido: true, cobra_adicional_pix: true });
    expect(auditados.map((a) => a.acao)).toEqual(['robo_cobra_adicional_pix_ligado']);
    expect((await rota.salvarAjustes(user, null, { alterado: { roboCobraPix: false } })).alterado.roboCobraPix).toBe(false);
    await expect(rota.salvarAjustes(user, null, { alterado: {} })).rejects.toThrow('nada para salvar');
  });

  it('"Dizer ao cliente a posição na fila" desligado: o robô não recebe a posição (o "já tem alguém" segue)', async () => {
    const E = await empresa('teste posição na fila');
    const atendimento = new AtendimentoService(db, eventos, {} as any, undefined, svc);
    const dados = (tel: string) => ({ tipo: 'humano', telefone: tel, mensagem: 'quero falar com alguém' }) as any;
    const ligado = await atendimento.abrirPeloRobo(E, null, dados('21900000001'));
    expect(ligado.posicao).toBe(1);
    await svc.salvar({ tenantId: E, colaboradorId: null, categoria: 'gerente' } as any, { dizerPosicao: false });
    const desligado = await atendimento.abrirPeloRobo(E, null, dados('21900000002'));
    expect(desligado).toMatchObject({ ok: true, posicao: null, comAlguem: false });
    await q(`update atendimento_chamado set responsavel_id = $2 where id = $1`, [desligado.id, gerente]);
    const somado = await atendimento.abrirPeloRobo(E, null, dados('21900000002'));
    expect(somado).toMatchObject({ jaAberto: true, comAlguem: true, posicao: null });
    // no servidor da loja não há robô nem a tabela: a resposta segue como sempre
    process.env.EDGE_MODE = 'true';
    try {
      expect(await svc.dizPosicao(E)).toBe(true);
    } finally {
      delete process.env.EDGE_MODE;
    }
  });
});
