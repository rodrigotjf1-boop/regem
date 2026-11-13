import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { decifrar } from '../../common/cifra-segredo';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { hojeISO, somarDias } from '../../common/data';
import { ClienteDeIa, IaEmpresaService } from './ia-empresa.service';
import { testesDoMisterComPostgres } from '../mister/mister-pg.teste-spec';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A IA DA EMPRESA (mig 415), contra o Postgres real, com o provedor de mentira (nada vai à Anthropic). O que se prova:
// sem chave não há IA; a da distribuição atende quem não tem a própria e cada chamada SOMA na linha do dia; a chave do
// lojista é provada antes de guardar, fica cifrada e não volta pela API nem pela auditoria; a chave do lojista que falha
// NÃO cai para a da distribuição (o custo não muda de dono em silêncio) e a situação dela acompanha; chamadas ao mesmo
// tempo não perdem soma; a chave e o uso são de UMA empresa; no servidor da loja não há IA.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ia-empresa-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);
const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

const CHAVE_A = `sk-ant-api03-${'a'.repeat(60)}AAAA`;
const CHAVE_B = `sk-ant-api03-${'b'.repeat(60)}BBBB`;
const DA_DISTRIBUICAO = `sk-ant-api03-${'d'.repeat(60)}DDDD`;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const RESPOSTA = () => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: 'Olá' }],
  usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 },
});
const recusa = (status: number, message = '', codigo?: string): never => {
  throw { status, message, codigo };
};

class IaDeMentira extends IaEmpresaService {
  chamadas: Array<{ chave: string; pedido: any }> = [];
  /** O que o provedor de mentira faz com cada chave: devolve a resposta ou lança a recusa. */
  comportamento: (chave: string, pedido: any) => any = () => RESPOSTA();
  protected criarCliente(chave: string): ClienteDeIa {
    return {
      messages: {
        create: async (pedido: any) => {
          this.chamadas.push({ chave, pedido });
          return this.comportamento(chave, pedido);
        },
      },
    };
  }
}

descrever('a IA da empresa (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const T = randomUUID();
  const FORA = randomUUID();
  const COLAB = randomUUID();
  const auditados: any[] = [];
  const svc = new IaDeMentira(db, { registrar: async (e: any) => void auditados.push(e) } as any);
  const antes = { chave: process.env.ANTHROPIC_API_KEY, desligada: process.env.IA_CHAVE_DA_DISTRIBUICAO_DESLIGADA, segredos: process.env.SEGREDOS_CHAVE, edge: process.env.EDGE_MODE };
  const SEGREDOS = randomBytes(32).toString('base64');

  const presidente = (tenant = T) => ({ tenantId: tenant, colaboradorId: COLAB, categoria: 'presidente', unidadeId: null }) as any;
  const pedido = { recurso: 'copiloto', modelo: 'claude-haiku-5-5', maxTokens: 400, system: 'instruções', messages: [{ role: 'user' as const, content: 'pergunta' }] };
  const usoDe = (tenant = T) =>
    q(
      `select to_char(dia, 'YYYY-MM-DD') as dia, recurso, provedor, modelo, origem, chamadas, falhas, tokens_entrada::int as entrada,
              tokens_cache_escrita::int as "cacheEscrita", tokens_cache_leitura::int as "cacheLeitura", tokens_saida::int as saida
         from ia_uso_dia where tenant_id = $1 order by recurso, origem`,
      [tenant],
    );
  const guardada = (tenant = T) => q(`select * from ia_credencial where tenant_id = $1`, [tenant]);
  const salvar = (chave: string) => svc.salvar(presidente(), { provedor: 'anthropic', chave });

  beforeAll(async () => {
    // A 415 é só da nuvem: o banco do CI é o de uma loja (ERR-273). Duas vezes: a migration é idempotente.
    for (let i = 0; i < 2; i++)
      await repetirNaCorridaDeCatalogo(async () => {
        const c = await pool.connect();
        try {
          await c.query('begin');
          await c.query(comTravaDaEmpresa(readFileSync(MIG('415_ia_por_empresa.sql'), 'utf8')));
          await c.query('commit');
        } catch (e) {
          await c.query('rollback').catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      });
    await q(`insert into empresa (id, nome) values ($1, 'teste ia'), ($2, 'teste ia (de fora)')`, [T, FORA]);
  });
  afterAll(async () => {
    const volta = (nome: string, valor: string | undefined) => (valor === undefined ? delete process.env[nome] : (process.env[nome] = valor));
    volta('ANTHROPIC_API_KEY', antes.chave);
    volta('IA_CHAVE_DA_DISTRIBUICAO_DESLIGADA', antes.desligada);
    volta('SEGREDOS_CHAVE', antes.segredos);
    volta('EDGE_MODE', antes.edge);
    for (const t of ['ia_uso_dia', 'ia_credencial']) await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [[T, FORA]]).catch(() => {});
    await q(`delete from empresa where id = any($1::uuid[])`, [[T, FORA]]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    process.env.ANTHROPIC_API_KEY = DA_DISTRIBUICAO;
    process.env.SEGREDOS_CHAVE = SEGREDOS;
    delete process.env.IA_CHAVE_DA_DISTRIBUICAO_DESLIGADA;
    delete process.env.EDGE_MODE; // como NUVEM
    for (const t of ['ia_uso_dia', 'ia_credencial']) await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [[T, FORA]]);
    auditados.length = 0;
    svc.chamadas.length = 0;
    svc.comportamento = () => RESPOSTA();
  });

  it('sem chave nenhuma não há IA: nada vai ao provedor e nada é medido', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await svc.temAcesso(T)).toBe(false);
    await expect(svc.pedir(T, pedido)).rejects.toMatchObject({ name: 'FalhaDaIa', motivo: 'sem_chave', origem: null });
    expect(svc.chamadas).toEqual([]);
    expect(await usoDe()).toEqual([]);
    expect(await svc.situacao(T)).toEqual({ provedoresAceitos: ['anthropic'], origem: null, chave: null });
  });

  it('sem chave própria, a da distribuição atende; cada chamada SOMA na linha do dia (o dia é o da operação)', async () => {
    expect(await svc.temAcesso(T)).toBe(true);
    const r = await svc.pedir(T, pedido);
    // Os blocos como vieram e o motivo da parada acompanham a resposta (é o que o laço de ferramentas do Mister usa).
    expect(r).toEqual({ conteudo: [{ type: 'text', text: 'Olá' }], parou: 'end_turn', texto: 'Olá', recusou: false, origem: 'distribuicao', uso: { entrada: 100, cacheEscrita: 30, cacheLeitura: 40, saida: 20 } });
    expect(svc.chamadas[0]).toEqual({
      chave: DA_DISTRIBUICAO,
      pedido: { model: 'claude-haiku-5-5', max_tokens: 400, system: 'instruções', messages: [{ role: 'user', content: 'pergunta' }] },
    });
    await svc.pedir(T, pedido);
    expect(await usoDe()).toEqual([
      { dia: hojeISO(), recurso: 'copiloto', provedor: 'anthropic', modelo: 'claude-haiku-5-5', origem: 'distribuicao', chamadas: 2, falhas: 0, entrada: 200, cacheEscrita: 60, cacheLeitura: 80, saida: 40 },
    ]);
    expect((await svc.situacao(T)).origem).toBe('incluida');
  });

  it('a distribuição pode parar de atender quem não tem chave própria (IA_CHAVE_DA_DISTRIBUICAO_DESLIGADA)', async () => {
    process.env.IA_CHAVE_DA_DISTRIBUICAO_DESLIGADA = '1';
    expect(await svc.temAcesso(T)).toBe(false);
    await expect(svc.pedir(T, pedido)).rejects.toMatchObject({ motivo: 'sem_chave' });
    expect(svc.chamadas).toEqual([]);
  });

  it('o modelo que se recusa a responder volta marcado, com o texto vazio de quem chamou decidir', async () => {
    svc.comportamento = () => ({ ...RESPOSTA(), stop_reason: 'refusal', content: [] });
    expect(await svc.pedir(T, pedido)).toMatchObject({ texto: '', recusou: true });
  });

  it('o que não é chave é recusado ANTES de qualquer chamada ou gravação, e a frase não repete o que foi colado', async () => {
    const ruins = ['', 'abc', `sk-ant-api03-${'x'.repeat(30)} ${'x'.repeat(30)}`, `sk-proj-${'x'.repeat(60)}`, `sk-ant-admin01-${'x'.repeat(60)}`];
    for (const ruim of ruins) {
      const erro: any = await salvar(ruim).catch((e) => e);
      expect(erro?.status).toBe(400);
      if (ruim.length > 10) expect(String(erro.message)).not.toContain('xxxx');
    }
    await expect(svc.salvar(presidente(), { provedor: 'openai', chave: CHAVE_A })).rejects.toThrow('ainda não é aceita');
    await expect(svc.salvar(presidente(), { chave: 12345 })).rejects.toThrow('Cole a chave de IA.');
    expect(svc.chamadas).toEqual([]);
    expect(await guardada()).toEqual([]);
    expect(auditados).toEqual([]);
  });

  it('a chave é PROVADA e guardada cifrada; a tela e a auditoria nunca recebem a chave', async () => {
    const r = await svc.salvar(presidente(), { provedor: 'anthropic', chave: `  ${CHAVE_A}\n` });
    expect(r).toEqual({
      provedoresAceitos: ['anthropic'],
      origem: 'propria',
      // as datas saem em ISO (UTC), não no formato cru do banco
      chave: { provedor: 'anthropic', final: 'AAAA', situacao: 'ok', conferidaEm: expect.stringMatching(ISO), salvaEm: expect.stringMatching(ISO) },
    });
    // a prova: uma chamada mínima, com a chave que está sendo cadastrada
    expect(svc.chamadas).toEqual([{ chave: CHAVE_A, pedido: { model: 'claude-haiku-5-5', max_tokens: 16, messages: [{ role: 'user', content: 'ok' }] } }]);
    const [l] = await guardada();
    expect(String(l.chave_cifrada).startsWith('v1:')).toBe(true);
    expect(JSON.stringify(l)).not.toContain(CHAVE_A);
    expect(decifrar(l.chave_cifrada)).toBe(CHAVE_A);
    expect(l).toMatchObject({ provedor: 'anthropic', final: 'AAAA', situacao: 'ok', ultimo_motivo: null, salva_por: COLAB });
    expect(JSON.stringify(r)).not.toContain(CHAVE_A);
    expect(JSON.stringify(r)).not.toContain('v1:');
    expect(auditados).toEqual([expect.objectContaining({ tenantId: T, acao: 'ia_chave_salva', entidadeTipo: 'ia_credencial', detalhe: { provedor: 'anthropic', final: 'AAAA', situacao: 'ok' } })]);
    expect(JSON.stringify(auditados)).not.toContain(CHAVE_A);
    // a prova também gasta, então também é medida (na chave do lojista)
    expect(await usoDe()).toEqual([expect.objectContaining({ recurso: 'prova', origem: 'lojista', chamadas: 1, falhas: 0 })]);

    // daqui em diante quem atende a empresa é a chave DELA
    const p = await svc.pedir(T, pedido);
    expect(p.origem).toBe('lojista');
    expect(svc.chamadas[1].chave).toBe(CHAVE_A);
    expect(await usoDe()).toEqual([
      expect.objectContaining({ recurso: 'copiloto', origem: 'lojista', chamadas: 1, entrada: 100, saida: 20 }),
      expect.objectContaining({ recurso: 'prova', origem: 'lojista', chamadas: 1 }),
    ]);
  });

  it('chave que o provedor recusa, ou que não deu para conferir, NÃO é guardada: a anterior continua', async () => {
    await salvar(CHAVE_A);
    svc.comportamento = (chave) => (chave === CHAVE_B ? recusa(401, 'invalid x-api-key') : RESPOSTA());
    await expect(salvar(CHAVE_B)).rejects.toThrow('A Anthropic recusou esta chave.');
    svc.comportamento = (chave) => (chave === CHAVE_B ? recusa(529, 'Overloaded') : RESPOSTA());
    await expect(salvar(CHAVE_B)).rejects.toThrow('Não deu para conferir a chave com a Anthropic agora.');
    svc.comportamento = (chave) => (chave === CHAVE_B ? recusa(400, 'max_tokens: Field required') : RESPOSTA());
    await expect(salvar(CHAVE_B)).rejects.toThrow('Não deu para conferir a chave com a Anthropic agora.');
    const [l] = await guardada();
    expect(l.final).toBe('AAAA');
    expect(decifrar(l.chave_cifrada)).toBe(CHAVE_A);
    expect(auditados.map((a) => a.acao)).toEqual(['ia_chave_salva']);
  });

  it('chave verdadeira sem crédito é guardada com a situação dela; "testar" acompanha o que o provedor diz', async () => {
    svc.comportamento = () => recusa(400, 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.');
    expect((await salvar(CHAVE_A)).chave).toMatchObject({ situacao: 'sem_credito', final: 'AAAA' });
    expect((await guardada())[0]).toMatchObject({ situacao: 'sem_credito', ultimo_motivo: 'sem_credito' });

    svc.comportamento = () => RESPOSTA();
    expect((await svc.testar(presidente())).chave).toMatchObject({ situacao: 'ok' });
    expect((await guardada())[0]).toMatchObject({ situacao: 'ok', ultimo_motivo: null });

    svc.comportamento = () => recusa(400, 'You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.');
    expect((await svc.testar(presidente())).chave).toMatchObject({ situacao: 'teto_atingido' });

    svc.comportamento = () => recusa(500, 'Internal server error');
    await expect(svc.testar(presidente())).rejects.toThrow('Não deu para conferir a chave com a Anthropic agora.');
    expect((await guardada())[0].situacao).toBe('teto_atingido'); // o provedor fora não diz nada da chave

    await expect(svc.testar(presidente(FORA))).rejects.toThrow('Não há chave de IA cadastrada nesta empresa.');
  });

  it('a chave do lojista que falha NÃO cai para a da distribuição: a recusa aparece, a situação muda e o medidor conta a falha', async () => {
    await salvar(CHAVE_A);
    svc.chamadas.length = 0;
    svc.comportamento = () => recusa(401, 'invalid x-api-key');
    await expect(svc.pedir(T, pedido)).rejects.toMatchObject({ motivo: 'chave_recusada', origem: 'lojista', status: 401 });
    expect(svc.chamadas.map((c) => c.chave)).toEqual([CHAVE_A]);
    expect((await guardada())[0]).toMatchObject({ situacao: 'chave_recusada', ultimo_motivo: 'chave_recusada' });
    expect(await usoDe()).toEqual(expect.arrayContaining([expect.objectContaining({ recurso: 'copiloto', origem: 'lojista', chamadas: 1, falhas: 1, entrada: 0, saida: 0 })]));

    // voltou a responder: a situação volta sozinha
    svc.comportamento = () => RESPOSTA();
    await svc.pedir(T, pedido);
    expect((await guardada())[0]).toMatchObject({ situacao: 'ok', ultimo_motivo: null });

    // limite por minuto passa sozinho: não diz nada da chave
    svc.comportamento = () => recusa(429, 'rate limited');
    await expect(svc.pedir(T, pedido)).rejects.toMatchObject({ motivo: 'limite_por_minuto', status: 429 });
    expect((await guardada())[0].situacao).toBe('ok');
    expect(svc.chamadas.every((c) => c.chave === CHAVE_A)).toBe(true);
  });

  it('dez chamadas ao mesmo tempo somam dez, numa linha só', async () => {
    await Promise.all(Array.from({ length: 10 }, () => svc.pedir(T, pedido)));
    expect(await usoDe()).toEqual([expect.objectContaining({ recurso: 'copiloto', origem: 'distribuicao', chamadas: 10, falhas: 0, entrada: 1000, saida: 200 })]);
  });

  it('a chave e o uso são de UMA empresa: a de fora segue na da distribuição e não vê nada da outra', async () => {
    await salvar(CHAVE_A);
    await svc.pedir(T, pedido);
    svc.chamadas.length = 0;
    expect((await svc.pedir(FORA, pedido)).origem).toBe('distribuicao');
    expect(svc.chamadas[0].chave).toBe(DA_DISTRIBUICAO);
    expect(await svc.situacao(FORA)).toMatchObject({ origem: 'incluida', chave: null });
    expect((await svc.uso(FORA)).itens).toEqual([expect.objectContaining({ recurso: 'copiloto', origem: 'distribuicao', chamadas: 1 })]);
    expect((await svc.uso(T)).itens.every((i) => i.origem === 'lojista')).toBe(true);
  });

  it('remover apaga a chave do banco, anota e a empresa volta para a IA incluída', async () => {
    await salvar(CHAVE_A);
    auditados.length = 0;
    expect(await svc.remover(presidente())).toEqual({ provedoresAceitos: ['anthropic'], origem: 'incluida', chave: null });
    expect(await guardada()).toEqual([]);
    expect(auditados).toEqual([expect.objectContaining({ acao: 'ia_chave_removida', detalhe: { provedor: 'anthropic', final: 'AAAA' } })]);
    expect((await svc.pedir(T, pedido)).origem).toBe('distribuicao');
    await svc.remover(presidente()); // sem chave: nada a anotar
    expect(auditados).toHaveLength(1);
  });

  it('o medidor soma por recurso, modelo e origem no período e estima o custo; modelo sem preço fica fora da soma', async () => {
    const hoje = hojeISO();
    const linha = (tenant: string, dia: string, recurso: string, modelo: string, origem: string, n: { chamadas: number; entrada?: number; leitura?: number; saida?: number }) =>
      q(
        `insert into ia_uso_dia (tenant_id, dia, recurso, provedor, modelo, origem, chamadas, tokens_entrada, tokens_cache_leitura, tokens_saida)
         values ($1, $2, $3, 'anthropic', $4, $5, $6, $7, $8, $9)`,
        [tenant, dia, recurso, modelo, origem, n.chamadas, n.entrada ?? 0, n.leitura ?? 0, n.saida ?? 0],
      );
    await linha(T, hoje, 'copiloto', 'claude-haiku-5-5', 'lojista', { chamadas: 2, entrada: 600_000, saida: 600_000 });
    await linha(T, somarDias(hoje, -1), 'copiloto', 'claude-haiku-5-5', 'lojista', { chamadas: 1, entrada: 400_000, saida: 400_000 });
    await linha(T, hoje, 'mister', 'claude-sonnet-5-5', 'distribuicao', { chamadas: 4, entrada: 500_000, leitura: 1_000_000, saida: 100_000 });
    await linha(T, hoje, 'mister', 'modelo-novo', 'lojista', { chamadas: 7, entrada: 9_000_000 });
    await linha(T, somarDias(hoje, -40), 'copiloto', 'claude-haiku-5-5', 'lojista', { chamadas: 99, entrada: 99_000_000 }); // fora dos 30 dias
    await linha(FORA, hoje, 'copiloto', 'claude-opus-5-5', 'lojista', { chamadas: 50, entrada: 50_000_000 }); // de outra empresa

    const r = await svc.uso(T);
    expect(r).toMatchObject({ de: somarDias(hoje, -29), ate: hoje, semPreco: ['modelo-novo'], custoEstimadoUsd: { lojista: 0.6, distribuicao: 2.1 } });
    expect(r.itens).toEqual([
      { recurso: 'copiloto', provedor: 'anthropic', modelo: 'claude-haiku-5-5', origem: 'lojista', chamadas: 3, falhas: 0, tokens: { entrada: 1_000_000, cacheEscrita: 0, cacheLeitura: 0, saida: 1_000_000 }, custoEstimadoUsd: 0.6 },
      { recurso: 'mister', provedor: 'anthropic', modelo: 'claude-sonnet-5-5', origem: 'distribuicao', chamadas: 4, falhas: 0, tokens: { entrada: 500_000, cacheEscrita: 0, cacheLeitura: 1_000_000, saida: 100_000 }, custoEstimadoUsd: 2.1 },
      { recurso: 'mister', provedor: 'anthropic', modelo: 'modelo-novo', origem: 'lojista', chamadas: 7, falhas: 0, tokens: { entrada: 9_000_000, cacheEscrita: 0, cacheLeitura: 0, saida: 0 }, custoEstimadoUsd: null },
    ]);
    // só o dia de hoje
    expect((await svc.uso(T, hoje, hoje)).itens[0]).toMatchObject({ recurso: 'copiloto', chamadas: 2 });
    await expect(svc.uso(T, '2026-13-01', hoje)).rejects.toThrow('A data inicial não é uma data válida.');
  });

  it('no servidor da loja não há IA nem leitura da chave', async () => {
    await salvar(CHAVE_A);
    svc.chamadas.length = 0;
    process.env.EDGE_MODE = 'true';
    expect(await svc.temAcesso(T)).toBe(false);
    expect(await svc.acesso(T)).toBeNull();
    await expect(svc.pedir(T, pedido)).rejects.toMatchObject({ motivo: 'sem_chave' });
    expect(await svc.situacao(T)).toEqual({ provedoresAceitos: ['anthropic'], origem: null, chave: null });
    expect(svc.chamadas).toEqual([]);
  });

  it('chave guardada que não abre neste servidor (outra SEGREDOS_CHAVE): a empresa fica sem IA, e a da distribuição não assume', async () => {
    await salvar(CHAVE_A);
    svc.chamadas.length = 0;
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    expect(await svc.acesso(T)).toBeNull();
    await expect(svc.pedir(T, pedido)).rejects.toMatchObject({ motivo: 'sem_chave' });
    await expect(svc.testar(presidente())).rejects.toThrow('A chave guardada não pôde ser aberta.');
    expect(svc.chamadas).toEqual([]);
  });

  it('sem a chave de proteção no servidor, nada é guardado (nunca em texto puro)', async () => {
    delete process.env.SEGREDOS_CHAVE;
    await expect(salvar(CHAVE_A)).rejects.toThrow('O Regem não está pronto para guardar a chave agora.');
    expect(svc.chamadas).toEqual([]);
    expect(await guardada()).toEqual([]);
  });
});

// O Mister (mig 417) lê as tabelas da 415 no painel do console: os testes dele com banco rodam AQUI, na spec que já
// aplica a 415, e não numa spec à parte reaplicando a mesma migration só-nuvem (ERR-451).
testesDoMisterComPostgres();
