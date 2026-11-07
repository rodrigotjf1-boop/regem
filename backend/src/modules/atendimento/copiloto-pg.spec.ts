import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { CopilotoService } from './copiloto.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O COPILOTO (mig 376), contra o Postgres real, com o modelo de mentira (nada vai à Anthropic): disponível só com a chave
// da distribuição; desligado na empresa recusa; a sugestão leva o pedido de verdade e a conversa sem o telefone; o caso de
// outra loja não abre; até 20 por caso (duas abas não passam do limite); a sugestão com link no chat do iFood não vale;
// a auditoria anota sem a conversa; salvar grava só a coluna dele (V82).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('copiloto-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);
const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

class CopilotoDeMentira extends CopilotoService {
  pedidos: Array<{ system: string; conteudo: string }> = [];
  resposta = '"Carlos, o João saiu às 19:31 e chega já já."';
  protected async chamarModelo(system: string, conteudo: string): Promise<string> {
    this.pedidos.push({ system, conteudo });
    return this.resposta;
  }
}

descrever('copiloto do atendimento (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let T: string;
  let lojaA: string;
  let lojaB: string;
  let svc: CopilotoDeMentira;
  const auditados: any[] = [];
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const chaveAntes = process.env.ANTHROPIC_API_KEY;
  const desligadoAntes = process.env.COPILOTO_DESLIGADO;
  const gerente = (loja: string | null = null) => ({ tenantId: T, colaboradorId: randomUUID(), categoria: 'gerente', unidadeId: loja }) as any;
  const tela = { mensagens: [{ de: 'cliente', texto: 'Cadê meu lanche? liga (21) 98765-4321' }], prontas: ['Pedimos desculpas pela demora.'] };
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
  const novoCaso = async (o: { unidade?: string | null; canal?: string; pedido?: string | null } = {}) =>
    (
      await q(
        `insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, pedido_id, detalhe)
         values ($1, $2, 'humano', $3, 'Carlos Alberto', $4, $5::jsonb) returning id`,
        [T, o.unidade === undefined ? lojaA : o.unidade, o.canal ?? 'whatsapp', o.pedido ?? null, JSON.stringify({ robo: { motivo: 'Atraso', quer: 'Saber quando chega' } })],
      )
    )[0].id as string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    for (const m of ['342_robo_pausa_e_config.sql', '376_copiloto_atendimento.sql']) await aplicar(m);
    [{ id: T }] = await q(`insert into empresa (nome) values ('teste copiloto') returning id`);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: lojaB }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja B') returning id`, [T]);
    await q(`insert into cardapio_config (tenant_id, token, ativo, nome_publico) values ($1, $2, true, 'Burger da Praça')`, [T, `tok-${randomUUID()}`]);
    svc = new CopilotoDeMentira(db, { registrar: async (e: any) => void auditados.push(e) } as any);
  });
  afterAll(async () => {
    process.env.ANTHROPIC_API_KEY = chaveAntes;
    process.env.COPILOTO_DESLIGADO = desligadoAntes;
    if (chaveAntes === undefined) delete process.env.ANTHROPIC_API_KEY;
    if (desligadoAntes === undefined) delete process.env.COPILOTO_DESLIGADO;
    if (!pool) return;
    for (const tab of ['atendimento_chamado', 'pedido_externo', 'robo_config', 'cardapio_config', 'unidade'])
      await q(`delete from ${tab} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
    delete process.env.COPILOTO_DESLIGADO;
    delete process.env.EDGE_MODE;
    auditados.length = 0;
    svc.pedidos.length = 0;
    svc.resposta = '"Carlos, o João saiu às 19:31 e chega já já."';
  });

  it('disponível só com a chave da distribuição; desligado na empresa (o padrão) recusa', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await svc.estado(T)).toEqual({ ligado: false, disponivel: false });
    const c = await novoCaso();
    await expect(svc.sugerir(gerente(lojaA), c, tela)).rejects.toThrow('O copiloto não está disponível agora.');
    process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
    process.env.COPILOTO_DESLIGADO = '1';
    expect(svc.disponivel()).toBe(false);
    delete process.env.COPILOTO_DESLIGADO;
    await expect(svc.sugerir(gerente(lojaA), c, tela)).rejects.toThrow('O copiloto está desligado nesta empresa');
    expect(svc.pedidos).toEqual([]);
  });

  it('ligado: a sugestão vem limpa, com o pedido de verdade e a conversa sem o telefone; a auditoria anota sem a conversa', async () => {
    await svc.salvar(gerente(), true);
    expect(await svc.estado(T)).toEqual({ ligado: true, disponivel: true });
    const [{ id: pedido }] = await q(
      `insert into pedido_externo (tenant_id, canal, external_id, display_id, tipo, itens, total, status, cliente_nome, despachado_em, entregador_nome, entregador_telefone)
       values ($1, 'whatsapp', $2, '1180', 'entrega', '[{"nome":"X-tudo","quantidade":1}]', 57.8, 'despachado', 'Carlos Alberto', now(), 'João Pereira', '21999990000') returning id`,
      [T, `ext-${randomUUID()}`],
    );
    const c = await novoCaso({ pedido });
    const r = await svc.sugerir(gerente(lojaA), c, tela);
    expect(r).toEqual({ texto: 'Carlos, o João saiu às 19:31 e chega já já.', restantes: 19 });
    const { system, conteudo } = svc.pedidos[0];
    expect(system).toContain('Burger da Praça');
    expect(conteudo).toContain('Pedido 1180:');
    expect(conteudo).toContain('em rota de entrega');
    expect(conteudo).toContain('com João.');
    expect(conteudo).toContain('Motivo: Atraso');
    expect(conteudo).toContain('liga [número]');
    expect(conteudo).not.toMatch(/98765|21999990000|Alberto/);
    expect(auditados.map((a) => a.acao)).toEqual(['copiloto_ligado', 'pediu_sugestao_copiloto']);
    expect(auditados[1]).toMatchObject({ acao: 'pediu_sugestao_copiloto', entidadeId: c, detalhe: { modelo: 'claude-haiku-5-5', veio: true, vez: 1 } });
    expect(JSON.stringify(auditados)).not.toContain('lanche');
  });

  it('o caso de outra loja não abre para o gerente; o presidente vê', async () => {
    const c = await novoCaso({ unidade: lojaB });
    await expect(svc.sugerir(gerente(lojaA), c, tela)).rejects.toThrow('Caso não encontrado.');
    const r = await svc.sugerir({ ...gerente(lojaA), categoria: 'presidente' }, c, tela);
    expect(r.texto).toContain('Carlos');
    await expect(svc.sugerir(gerente(lojaA), randomUUID(), tela)).rejects.toThrow('Caso não encontrado.');
  });

  it('até 20 por caso — duas abas ao mesmo tempo não passam do limite', async () => {
    const c = await novoCaso();
    await q(`update atendimento_chamado set detalhe = detalhe || '{"copiloto":{"vezes":18}}'::jsonb where id = $1`, [c]);
    const vezes = await Promise.allSettled([svc.sugerir(gerente(lojaA), c, tela), svc.sugerir(gerente(lojaA), c, tela), svc.sugerir(gerente(lojaA), c, tela)]);
    expect(vezes.filter((v) => v.status === 'fulfilled')).toHaveLength(2);
    expect((vezes.find((v) => v.status === 'rejected') as any).reason.message).toBe('Este caso já pediu 20 sugestões. Escreva a resposta.');
    expect((await q(`select (detalhe -> 'copiloto' ->> 'vezes')::int as n from atendimento_chamado where id = $1`, [c]))[0].n).toBe(20);
  });

  it('no chat do iFood, a sugestão com telefone ou link não vale (o envio barraria); a regra da plataforma vai ao modelo', async () => {
    const c = await novoCaso({ canal: 'ifood' });
    svc.resposta = 'Me chama no WhatsApp (21) 98765-4321';
    await expect(svc.sugerir(gerente(lojaA), c, tela)).rejects.toThrow('O copiloto não trouxe uma sugestão que dê para usar.');
    expect(svc.pedidos[0].system).toContain('nunca escreva telefone, WhatsApp, Instagram, e-mail nem link');
    expect(auditados[0].detalhe.veio).toBe(false);
  });

  it('salvar grava só a coluna dele (V82) e anota; sem mudança, nada', async () => {
    await q(`update robo_config set pausa_minutos = 45 where tenant_id = $1`, [T]);
    await svc.salvar(gerente(), false);
    expect((await q(`select copiloto_ligado, pausa_minutos from robo_config where tenant_id = $1`, [T]))[0]).toEqual({ copiloto_ligado: false, pausa_minutos: 45 });
    expect(auditados.map((a) => a.acao)).toEqual(['copiloto_desligado']);
    await svc.salvar(gerente(), false);
    expect(auditados).toHaveLength(1);
  });

  it('a tela sem mensagem do cliente: recusa antes de gastar uma vez', async () => {
    const c = await novoCaso();
    await svc.salvar(gerente(), true);
    await expect(svc.sugerir(gerente(lojaA), c, { mensagens: [{ de: 'loja', texto: 'Oi' }], prontas: [] })).rejects.toThrow('Ainda não há mensagem do cliente');
    expect((await q(`select detalhe -> 'copiloto' as c from atendimento_chamado where id = $1`, [c]))[0].c).toBeNull();
  });
});
