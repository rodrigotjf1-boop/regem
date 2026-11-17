import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DIAS_DE_INATIVIDADE, InatividadeProcessor } from './inatividade.processor';
import { DistribuicaoService } from '../distribuicao/distribuicao.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// EMPRESA INATIVA HÁ 2 MESES É DESLIGADA — contra Postgres (TEST_PG_URL), pela instrução de verdade: quem a regra pega,
// quem ela NÃO pega (cada sinal de uso, quem paga, a própria Regem, a recém-criada, a que a distribuição acabou de
// religar), o que ela grava (empresa, integrações, auditoria) e que rodar de novo não repete.
// O banco do CI é dividido com os outros testes: tudo aqui é restrito às empresas DESTE teste (`soEmpresas`), e o
// `tick` (que não tem restrição) só é provado pelo que ele chama.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('inatividade-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('empresa inativa há 2 meses é desligada (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const proc = new InatividadeProcessor(db);
  const ids: Record<string, string> = {};
  const todas = () => Object.values(ids);
  let edgeTemEquipamento = false;
  const antes = { flag: process.env.DESLIGAR_INATIVAS, edge: process.env.EDGE_MODE };

  const empresa = async (
    nome: string,
    o: { criadaHa?: number; assinatura?: string | null; distribuidor?: boolean; status?: string; apagada?: boolean } = {},
  ) => {
    const id = randomUUID();
    await q(
      `insert into empresa (id, nome, created_at, assinatura_status, is_distribuidor, status, deleted_at)
       values ($1, $2, now() - make_interval(days => $3::int), $4, $5, $6, $7)`,
      [id, `inatividade · ${nome}`, o.criadaHa ?? 100, o.assinatura ?? null, o.distribuidor ?? false, o.status ?? 'ativo', o.apagada ? new Date() : null],
    );
    ids[nome] = id;
    return id;
  };
  const acaoNaAuditoria = (T: string, dias: number, ator = 'usuario') =>
    q(
      `insert into audit_log (tenant_id, acao, actor_tipo, created_at) values ($1, 'teste_de_inatividade', $2, now() - make_interval(days => $3::int))`,
      [T, ator, dias],
    );
  const batida = (T: string, dias: number) =>
    edgeTemEquipamento
      ? q(`insert into edge_status (equipamento_id, tenant_id, recebido_em) values (gen_random_uuid(), $1, now() - make_interval(days => $2::int))`, [T, dias])
      : q(`insert into edge_status (tenant_id, recebido_em) values ($1, now() - make_interval(days => $2::int))`, [T, dias]);
  const aparelho = (T: string, dias: number) =>
    q(
      `insert into equipamento (tenant_id, tipo, nome, token, ultimo_ping) values ($1, 'kds', 'KDS de teste', $2, now() - make_interval(days => $3::int))`,
      [T, `tk-${randomUUID()}`, dias],
    );
  const venda = async (T: string, dias: number) => {
    const [l] = await q(
      `insert into comanda (tenant_id, updated_at) values ($1, now() - make_interval(days => $2::int))
       returning round(extract(epoch from (now() - updated_at)) / 86400) as dias`,
      [T, dias],
    );
    // Se um gatilho carimbasse a data na criação, o teste da "venda antiga" não provaria nada.
    expect(Number(l.dias)).toBe(dias);
  };
  const integracao = (T: string, canal: string, ativo: boolean) =>
    q(`insert into integracao (tenant_id, canal, ativo, token, config) values ($1, $2, $3, 'credencial-de-teste', '{"guardado":"sim"}')`, [T, canal, ativo]);
  const acaoDaDistribuicao = (T: string, acao: string, dias: number) =>
    q(`insert into distribuicao_auditoria (usuario_nome, perfil, acao, alvo, criado_em) values ('teste', 'diretoria', $1, $2, now() - make_interval(days => $3::int))`, [acao, T, dias]);

  const situacao = async () =>
    Object.fromEntries(
      (await q(`select id, status from empresa where id = any($1::uuid[])`, [todas()])).map((l) => [
        Object.keys(ids).find((n) => ids[n] === l.id) as string,
        l.status as string,
      ]),
    );
  const ligadas = async (T: string) =>
    (await q(`select canal from integracao where tenant_id = $1 and ativo = true order by canal`, [T])).map((l) => l.canal as string);
  const registros = (T: string) =>
    q(`select usuario_nome, perfil, detalhe from distribuicao_auditoria where alvo = $1 and acao = 'desligou_por_inatividade' order by criado_em`, [T]);
  const nomes = (lista: { id: string }[]) => lista.map((e) => Object.keys(ids).find((n) => ids[n] === e.id)).sort();

  beforeAll(async () => {
    delete process.env.EDGE_MODE;
    delete process.env.DESLIGAR_INATIVAS;
    // As duas tabelas são só da nuvem: o banco do CI (de loja) não tem — cria a forma mínima, como as outras specs.
    for (const ddl of [
      `create table if not exists edge_status (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`,
      `create table if not exists distribuicao_auditoria (id uuid primary key default gen_random_uuid(), usuario_id uuid, usuario_nome text, perfil text, acao text not null, alvo text, detalhe jsonb not null default '{}', ip text, criado_em timestamptz not null default now())`,
    ])
      await pool.query(ddl).catch((e: any) => {
        if (!['23505', '42P07'].includes(e?.code)) throw e;
      });
    edgeTemEquipamento = (await q(`select 1 from information_schema.columns where table_name = 'edge_status' and column_name = 'equipamento_id'`)).length > 0;

    // QUEM A REGRA PEGA
    await empresa('parada'); // nenhum sinal, nunca
    await integracao(ids.parada, 'cardapio_web', true);
    await integracao(ids.parada, 'ifood', true);
    await integracao(ids.parada, 'anotaai', false); // já estava desligada: não entra na conta do que foi desligado
    await empresa('so a integracao agiu'); // o que a integração faz sozinha não é uso
    await acaoNaAuditoria(ids['so a integracao agiu'], 3, 'integracao');
    await empresa('parou ha 61 dias');
    await acaoNaAuditoria(ids['parou ha 61 dias'], DIAS_DE_INATIVIDADE + 1);
    await venda(ids['parou ha 61 dias'], 90);

    // QUEM ELA NÃO PEGA
    await empresa('pessoa agiu ha 59 dias');
    await acaoNaAuditoria(ids['pessoa agiu ha 59 dias'], DIAS_DE_INATIVIDADE - 1);
    await integracao(ids['pessoa agiu ha 59 dias'], 'ifood', true);
    await empresa('colaborador agiu');
    await acaoNaAuditoria(ids['colaborador agiu'], 5, 'colaborador');
    await empresa('servidor batendo');
    await batida(ids['servidor batendo'], 1);
    await empresa('aparelho com sinal');
    await aparelho(ids['aparelho com sinal'], 2);
    await empresa('vendeu');
    await venda(ids.vendeu, 30);
    await empresa('paga', { assinatura: 'active' }); // sem sinal nenhum, mas paga
    await empresa('em atraso', { assinatura: 'past_due' });
    await empresa('nova', { criadaHa: 10 }); // ainda não teve 2 meses para usar
    await empresa('a regem', { distribuidor: true });
    await empresa('religada pela distribuicao');
    await acaoDaDistribuicao(ids['religada pela distribuicao'], 'liberou_licenca', 5);
    await empresa('ja bloqueada', { status: 'bloqueado' });
    await integracao(ids['ja bloqueada'], 'ifood', true); // bloqueada à mão pelo console: a rotina não mexe
    await empresa('apagada', { apagada: true });
  });

  afterAll(async () => {
    if (antes.flag === undefined) delete process.env.DESLIGAR_INATIVAS;
    else process.env.DESLIGAR_INATIVAS = antes.flag;
    if (antes.edge === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = antes.edge;
    for (const id of todas()) {
      await q(`delete from distribuicao_auditoria where alvo = $1`, [id]).catch(() => undefined);
      for (const t of ['edge_status', 'equipamento', 'comanda', 'integracao']) await q(`delete from ${t} where tenant_id = $1`, [id]).catch(() => undefined);
      // A `audit_log` é append-only no banco (mig 023): a empresa de teste que tem linha lá fica; as outras saem.
      await q(`delete from empresa where id = $1`, [id]).catch(() => undefined);
    }
    await pool.end();
  });

  const INATIVAS = ['parada', 'parou ha 61 dias', 'so a integracao agiu'];

  it('só lendo: lista as inativas, com o último sinal de cada uma, e não muda nada', async () => {
    const lista = await proc.inativas(DIAS_DE_INATIVIDADE, todas());
    expect(nomes(lista)).toEqual(INATIVAS);
    const porNome = Object.fromEntries(lista.map((e) => [Object.keys(ids).find((n) => ids[n] === e.id), e]));
    expect(porNome.parada.ultimoSinal).toBeNull(); // nunca houve sinal
    const dias = (Date.now() - Date.parse(porNome['parou ha 61 dias'].ultimoSinal as string)) / 86_400_000;
    expect(Math.round(dias)).toBe(DIAS_DE_INATIVIDADE + 1); // o sinal mais novo (a ação de 61 dias, não a venda de 90)
    const s = await situacao();
    expect(Object.entries(s).filter(([n, st]) => st !== 'ativo' && n !== 'ja bloqueada')).toEqual([]);
    expect(await ligadas(ids.parada)).toEqual(['cardapio_web', 'ifood']);
  });

  it('sem empresa na restrição não pega nenhuma (lista vazia não é "todas")', async () => {
    expect(await proc.inativas(DIAS_DE_INATIVIDADE, [])).toEqual([]);
    expect(await proc.desligar(DIAS_DE_INATIVIDADE, [])).toEqual([]);
  });

  it('desliga a loja e as integrações das inativas, registra o porquê e não toca nas outras', async () => {
    const feitas = await proc.desligar(DIAS_DE_INATIVIDADE, todas());
    expect(nomes(feitas)).toEqual(INATIVAS);
    expect(feitas.find((e) => e.id === ids.parada)?.integracoes).toEqual(['cardapio_web', 'ifood']);
    expect(feitas.find((e) => e.id === ids['parou ha 61 dias'])?.integracoes).toEqual([]);

    const s = await situacao();
    for (const n of Object.keys(ids)) expect([n, s[n]]).toEqual([n, INATIVAS.includes(n) || n === 'ja bloqueada' ? 'bloqueado' : 'ativo']);

    // As integrações da desligada: nenhuma ligada; a credencial e a configuração ficam (para religar sem reconectar).
    expect(await ligadas(ids.parada)).toEqual([]);
    const guardado = await q(`select canal, token, config from integracao where tenant_id = $1 order by canal`, [ids.parada]);
    expect(guardado).toHaveLength(3);
    for (const g of guardado) expect([g.token, g.config]).toEqual(['credencial-de-teste', { guardado: 'sim' }]);
    // As das outras seguem ligadas — inclusive a da empresa bloqueada à mão, que não é assunto da rotina.
    expect(await ligadas(ids['pessoa agiu ha 59 dias'])).toEqual(['ifood']);
    expect(await ligadas(ids['ja bloqueada'])).toEqual(['ifood']);

    // O registro na auditoria da distribuição: um por empresa, com os dias, o último sinal e o que estava ligado.
    const r = await registros(ids.parada);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ usuario_nome: 'Regem (rotina)', perfil: 'sistema' });
    const { integracaoIds, ...resto } = r[0].detalhe;
    expect(resto).toEqual({ dias: DIAS_DE_INATIVIDADE, ultimoSinal: null, integracoes: ['cardapio_web', 'ifood'] });
    // Os ids exatos das que foram desligadas (o "Liberar" religa por eles) — a que já estava desligada não entra.
    const idsLigadasAntes = (await q(`select id from integracao where tenant_id = $1 and canal in ('cardapio_web', 'ifood') order by id`, [ids.parada])).map((l) => l.id);
    expect([...integracaoIds].sort()).toEqual(idsLigadasAntes);
    expect(await registros(ids['pessoa agiu ha 59 dias'])).toHaveLength(0);
    expect(await registros(ids['ja bloqueada'])).toHaveLength(0);
  });

  it('rodar de novo não repete: nada a desligar e nenhum registro novo', async () => {
    expect(await proc.desligar(DIAS_DE_INATIVIDADE, todas())).toEqual([]);
    expect(await registros(ids.parada)).toHaveLength(1);
    expect(await proc.inativas(DIAS_DE_INATIVIDADE, todas())).toEqual([]);
  });

  it('a empresa que o console libera não é desligada de novo no dia seguinte', async () => {
    // O "Liberar" do console: volta a `ativo` e fica o registro da distribuição (o que a rotina lê como sinal).
    await q(`update empresa set status = 'ativo' where id = $1`, [ids.parada]);
    await acaoDaDistribuicao(ids.parada, 'liberou_licenca', 0);
    expect(await proc.inativas(DIAS_DE_INATIVIDADE, todas())).toEqual([]);
    expect(await proc.desligar(DIAS_DE_INATIVIDADE, todas())).toEqual([]);
    expect((await situacao()).parada).toBe('ativo');
    // O registro do próprio desligamento NÃO vale como sinal: sem o "Liberar", a que voltasse a `ativo` seria pega.
    await q(`update empresa set status = 'ativo' where id = $1`, [ids['so a integracao agiu']]);
    expect(nomes(await proc.inativas(DIAS_DE_INATIVIDADE, todas()))).toEqual(['so a integracao agiu']);
  });

  describe('a rotina diária', () => {
    let desligar: jest.SpyInstance;
    beforeEach(() => {
      desligar = jest.spyOn(proc, 'desligar').mockResolvedValue([]);
    });
    afterEach(() => {
      desligar.mockRestore();
      delete process.env.DESLIGAR_INATIVAS;
      delete process.env.EDGE_MODE;
    });

    it('nasce desligada: sem a variável não lê nem grava', async () => {
      expect(InatividadeProcessor.ligada()).toBe(false);
      await proc.tick();
      expect(desligar).not.toHaveBeenCalled();
    });

    it('com a variável, na nuvem, desliga pela regra dos 60 dias', async () => {
      process.env.DESLIGAR_INATIVAS = '1';
      expect(InatividadeProcessor.ligada()).toBe(true);
      await proc.tick();
      expect(desligar).toHaveBeenCalledTimes(1);
      expect(desligar.mock.calls[0]).toEqual([]); // sem restrição e com o prazo padrão
      expect(DIAS_DE_INATIVIDADE).toBe(60);
    });

    it('no servidor da loja não roda, nem com a variável', async () => {
      process.env.DESLIGAR_INATIVAS = '1';
      process.env.EDGE_MODE = 'true';
      expect(InatividadeProcessor.ligada()).toBe(false);
      await proc.tick();
      expect(desligar).not.toHaveBeenCalled();
    });

    it('a falha da gravação fica no log e não derruba a rotina', async () => {
      process.env.DESLIGAR_INATIVAS = '1';
      desligar.mockRejectedValueOnce(new Error('banco fora'));
      const erro = jest.spyOn((proc as any).logger, 'error').mockImplementation(() => undefined);
      await expect(proc.tick()).resolves.toBeUndefined();
      expect(erro).toHaveBeenCalledWith(expect.stringContaining('banco fora'));
      erro.mockRestore();
    });
  });

  // O "Revogar" e o "Liberar/Renovar" da aba Licenças do console (ERR-501, decisão do dono de 16/11/2026): o bloqueio
  // sozinho não parava as rotinas dos canais. O Revogar desliga as integrações e guarda quais; o Liberar religa essas.
  describe('o Revogar e o Liberar/Renovar do console', () => {
    const dist = () => new DistribuicaoService(db, {} as any, {} as any);
    const autor = { sub: randomUUID(), nome: 'Diretoria de teste', perfil: 'diretoria' };
    const integracoesDe = async (T: string) =>
      Object.fromEntries((await q(`select canal, ativo from integracao where tenant_id = $1`, [T])).map((l) => [l.canal, l.ativo]));
    const registrosDe = (T: string) =>
      q(`select acao, usuario_id, usuario_nome, perfil, detalhe from distribuicao_auditoria where alvo = $1 order by criado_em`, [T]);

    it('o Revogar bloqueia a empresa, desliga as integrações ligadas dela e registra quais (e quem)', async () => {
      const T = await empresa('revogada', { criadaHa: 5 });
      await integracao(T, 'ifood', true);
      await integracao(T, 'cardapio_web', true);
      await integracao(T, 'anotaai', false); // a loja já tinha desligado: não entra na lista
      expect(await dist().revogarLicenca(T, autor)).toEqual({ ok: true, integracoesDesligadas: ['cardapio_web', 'ifood'] });
      expect((await situacao()).revogada).toBe('bloqueado');
      expect(await integracoesDe(T)).toEqual({ ifood: false, cardapio_web: false, anotaai: false });
      // A credencial e a configuração ficam: religar não pede a conexão de novo.
      for (const g of await q(`select token, config from integracao where tenant_id = $1`, [T]))
        expect([g.token, g.config]).toEqual(['credencial-de-teste', { guardado: 'sim' }]);
      // As das outras empresas não mudam.
      expect(await ligadas(ids['pessoa agiu ha 59 dias'])).toEqual(['ifood']);
      const regs = await registrosDe(T);
      expect(regs).toHaveLength(1);
      expect(regs[0]).toMatchObject({ acao: 'revogou_licenca', usuario_id: autor.sub, usuario_nome: 'Diretoria de teste', perfil: 'diretoria' });
      expect(regs[0].detalhe.integracoes).toEqual(['cardapio_web', 'ifood']);
      const idsDesligados = (await q(`select id from integracao where tenant_id = $1 and canal <> 'anotaai' order by id`, [T])).map((l) => l.id);
      expect([...regs[0].detalhe.integracaoIds].sort()).toEqual(idsDesligados);
    });

    it('revogar de novo não perde o que religar: o Liberar religa as do primeiro Revogar, e só elas', async () => {
      const T = ids.revogada;
      expect(await dist().revogarLicenca(T, autor)).toEqual({ ok: true, integracoesDesligadas: [] }); // já estava tudo desligado
      expect(await dist().liberarLicenca(T, 30, autor)).toEqual({ ok: true, integracoesReligadas: ['cardapio_web', 'ifood'] });
      expect((await situacao()).revogada).toBe('ativo');
      expect(await integracoesDe(T)).toEqual({ ifood: true, cardapio_web: true, anotaai: false }); // a da loja segue desligada
      const regs = await registrosDe(T);
      expect(regs.map((l) => l.acao)).toEqual(['revogou_licenca', 'revogou_licenca', 'liberou_licenca']);
      expect(regs[2].detalhe).toEqual({ dias: 30, integracoesReligadas: ['cardapio_web', 'ifood'] });
      const [{ dias }] = await q(`select round(extract(epoch from (trial_ate - now())) / 86400) as dias from empresa where id = $1`, [T]);
      expect(Number(dias)).toBe(30);
    });

    it('um Liberar depois do outro (só renovar o prazo) não religa o que a loja desligou no meio', async () => {
      const T = ids.revogada;
      await q(`update integracao set ativo = false where tenant_id = $1 and canal = 'ifood'`, [T]); // a loja desligou o iFood
      expect(await dist().liberarLicenca(T, 10, autor)).toEqual({ ok: true, integracoesReligadas: [] });
      expect((await integracoesDe(T)).ifood).toBe(false);
      expect((await integracoesDe(T)).cardapio_web).toBe(true);
    });

    it('o Liberar religa o que a rotina de inatividade desligou, e a rotina não a desliga de novo', async () => {
      const T = await empresa('desligada pela rotina');
      await integracao(T, 'ifood', true);
      expect(nomes(await proc.desligar(DIAS_DE_INATIVIDADE, [T]))).toEqual(['desligada pela rotina']);
      expect((await integracoesDe(T)).ifood).toBe(false);
      expect(await dist().liberarLicenca(T, 30, autor)).toEqual({ ok: true, integracoesReligadas: ['ifood'] });
      expect((await situacao())['desligada pela rotina']).toBe('ativo');
      expect((await integracoesDe(T)).ifood).toBe(true);
      expect(await proc.inativas(DIAS_DE_INATIVIDADE, [T])).toEqual([]); // o Liberar vale como sinal da distribuição
    });

    it('empresa que não existe ou identificador inválido: recusa com o motivo e não grava nada', async () => {
      const inexistente = randomUUID();
      for (const id of [inexistente, 'nao-e-um-uuid', '']) {
        await expect(dist().revogarLicenca(id, autor)).rejects.toThrow('Empresa não encontrada.');
        await expect(dist().liberarLicenca(id, 30, autor)).rejects.toThrow('Empresa não encontrada.');
      }
      expect(await registrosDe(inexistente)).toHaveLength(0);
    });
  });
});
