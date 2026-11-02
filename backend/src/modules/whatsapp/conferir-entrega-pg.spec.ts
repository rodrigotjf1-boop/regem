import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ConferirEntregaProcessor } from './conferir-entrega.processor';
import { OPCOES_DA_CONFERENCIA, TEXTO_DEPOIS_DA_RESPOSTA, portaoDaConferencia, textoDaPergunta } from './conferir-entrega';
import { WhatsappProvedorService } from './whatsapp-provedor.service';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "CHEGOU TUDO CERTO?" DEPOIS DA ENTREGA (B1; mig 352), contra o Postgres real: quem recebe, a janela de 24 h, UMA
// pergunta por pedido, as três respostas (agradece; caso normal; caso urgente) e o ajuste. As tabelas do robô são só da
// nuvem: o teste aplica as migrations (o banco do CI é o de uma loja).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('conferir-entrega-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(90_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const NO_PEDIDO = '21987654321'; // o pedido guarda sem o 55
const NA_CONVERSA = '5521987654321'; // a conversa, com

descrever('"chegou tudo certo?" (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const enviados: any[] = [];
  let falhar = false;
  const cloud: any = {
    enviarOpcoes: async (t: string, para: string, texto: string, opcoes: any[]) => {
      if (falhar) throw new Error('a Meta recusou');
      enviados.push({ t, para, texto, opcoes });
    },
  };
  const rotina = new ConferirEntregaProcessor(db, cloud);
  const avisos: any[] = [];
  const emitir = (ev: string, p: any) => void avisos.push({ ev, p });
  const auditados: any[] = [];
  const ajustes = new WhatsappProvedorService(db, { registrar: async (a: any) => void auditados.push(a) } as any, {} as any, {} as any);
  const empresas: string[] = [];

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

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    await repetirNaCorridaDeCatalogo(() => pool.query(readFileSync(MIG('215_whatsapp_mensagem.sql'), 'utf8')));
    for (const m of ['342_robo_pausa_e_config.sql', '344_robo_carrinho.sql', '347_aviso_de_atraso.sql', '349_lembrete_do_carrinho.sql', '352_conferir_entrega.sql'])
      await aplicar(m);
  });
  beforeEach(() => {
    enviados.length = 0;
    avisos.length = 0;
    falhar = false;
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['pedido_envio', 'atendimento_chamado', 'robo_pausa', 'robo_config', 'whatsapp_mensagem', 'pedido_externo', 'cardapio_config'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  /** A loja: API oficial (ou não), com a pergunta ligada (ou não). */
  async function loja(o: { provedor?: string; conferir?: boolean } = {}) {
    const t = (await q(`insert into empresa (nome) values ('teste chegou tudo certo') returning id`))[0].id as string;
    empresas.push(t);
    await q(`insert into cardapio_config (tenant_id, token, ativo, robo_ativo, provedor, wa_cloud_phone_id) values ($1,$2,true,true,$3,$4)`, [
      t,
      `tk-${randomUUID()}`,
      o.provedor ?? 'cloud',
      (o.provedor ?? 'cloud') === 'cloud' ? `pn-${randomUUID().slice(0, 8)}` : null,
    ]);
    await q(`insert into robo_config (tenant_id, conferir_entrega) values ($1,$2)`, [t, o.conferir ?? true]);
    return t;
  }
  /** O pedido concluído há `min` minutos. */
  async function pedido(t: string, o: { min?: number; canal?: string; tipo?: string; status?: string; telefone?: string } = {}) {
    return (
      await q(
        `insert into pedido_externo (tenant_id, canal, external_id, numero, tipo, status, cliente_nome, cliente_telefone, total, concluido_em)
         values ($1,$2,$3,(floor(random()*90000)+10000)::int,$4,$5,'Renata Lima',$6,50, now() - make_interval(mins => $7)) returning id, numero`,
        [t, o.canal ?? 'cardapio', `e2e-${randomUUID()}`, o.tipo ?? 'entrega', o.status ?? 'concluido', o.telefone ?? NO_PEDIDO, o.min ?? 30],
      )
    )[0] as { id: string; numero: number };
  }
  /** O cliente escreveu à loja há `horas` horas (a janela da Meta). */
  const escreveu = (t: string, horas = 1) =>
    q(`insert into whatsapp_mensagem (tenant_id, telefone, direcao, tipo, texto, criado_em) values ($1,$2,'entrada','text','oi', now() - make_interval(hours => $3))`, [
      t,
      NA_CONVERSA,
      horas,
    ]);
  const envios = (pedidoId: string) => q(`select acao, resultado, motivo from pedido_envio where pedido_id = $1 order by criado_em`, [pedidoId]);
  const meus = (t: string) => enviados.filter((e) => e.t === t);

  it('quem pode receber: entrega dos canais da loja, concluída há 20 min a 3 h, loja da API oficial com a pergunta ligada', async () => {
    const t = await loja();
    const ok = await pedido(t);
    const ifood = await pedido(t, { canal: 'ifood' });
    const n99 = await pedido(t, { canal: '99food' });
    const retirada = await pedido(t, { tipo: 'retirada' });
    const cedo = await pedido(t, { min: 10 });
    const tarde = await pedido(t, { min: 200 });
    const aCaminho = await pedido(t, { status: 'despachado' });
    const qr = await loja({ provedor: 'evolution' });
    const daQr = await pedido(qr);
    const desligada = await loja({ conferir: false });
    const daDesligada = await pedido(desligada);
    const ids = (await rotina.candidatos()).map((c) => c.id);
    expect(ids).toContain(ok.id);
    for (const fora of [ifood, n99, retirada, cedo, tarde, aCaminho, daQr, daDesligada]) expect(ids).not.toContain(fora.id);
  });

  it('pergunta UMA vez, pelo número da conversa (com 55), com os 3 botões — só com a janela de 24 h aberta', async () => {
    const t = await loja();
    const p = await pedido(t);
    await rotina.perguntar();
    expect(meus(t)).toEqual([]); // o cliente não escreveu nas últimas 24 h: não pergunta (e tenta na volta seguinte)
    expect(await envios(p.id)).toEqual([]);
    await escreveu(t, 30); // há 30 h: ainda fora
    await rotina.perguntar();
    expect(meus(t)).toEqual([]);
    await escreveu(t, 2);
    await rotina.perguntar();
    expect(meus(t)).toEqual([{ t, para: NA_CONVERSA, texto: textoDaPergunta('Renata Lima', String(p.numero)), opcoes: OPCOES_DA_CONFERENCIA }]);
    expect(await envios(p.id)).toEqual([{ acao: 'conferir_entrega', resultado: 'enviado', motivo: null }]);
    await rotina.perguntar();
    expect(meus(t)).toHaveLength(1); // a volta seguinte não repete
  });

  it('duas rotinas com a mesma lista (duas réplicas da API): a pergunta sai UMA vez (índice da mig 352)', async () => {
    const t = await loja();
    await pedido(t);
    await escreveu(t);
    const lista = await rotina.candidatos(); // as duas leram antes de qualquer uma gravar
    await rotina.perguntar();
    const corrida = new ConferirEntregaProcessor(db, cloud);
    (corrida as any).candidatos = async () => lista;
    await corrida.perguntar();
    expect(meus(t)).toHaveLength(1);
  });

  it('com alguém da equipe na conversa (caso aberto), não pergunta', async () => {
    const t = await loja();
    await pedido(t);
    await escreveu(t);
    await q(`insert into atendimento_chamado (tenant_id, tipo, telefone, status) values ($1,'humano',$2,'aberto')`, [t, NA_CONVERSA]);
    await rotina.perguntar();
    expect(meus(t)).toEqual([]);
  });

  it('a Meta recusou: fica "falhou" e não pergunta de novo', async () => {
    const t = await loja();
    const p = await pedido(t);
    await escreveu(t);
    falhar = true;
    await rotina.perguntar();
    expect(await envios(p.id)).toEqual([{ acao: 'conferir_entrega', resultado: 'falhou', motivo: 'a Meta recusou' }]);
    falhar = false;
    await rotina.perguntar();
    expect(meus(t)).toEqual([]);
  });

  it('"Não chegou" (botão): caso URGENTE ligado ao pedido, com o resumo; a resposta é gravada uma vez só', async () => {
    const t = await loja();
    const p = await pedido(t);
    await escreveu(t);
    await rotina.perguntar();
    const r = await portaoDaConferencia(db, emitir, { tenantId: t, telefone: NA_CONVERSA, nome: 'Renata', texto: 'Não chegou', opcaoId: 'conferir_nao_chegou' });
    expect(r).toMatchObject({ tratou: true, responder: TEXTO_DEPOIS_DA_RESPOSTA.nao_chegou, pedidoId: p.id, resposta: 'nao_chegou' });
    const [caso] = await q(`select tipo, prioridade, pedido_id, detalhe from atendimento_chamado where tenant_id = $1`, [t]);
    expect(caso).toMatchObject({ tipo: 'erro', prioridade: 'urgente', pedido_id: p.id });
    expect(caso.detalhe.robo.motivo).toBe(`Pedido #${p.numero} não chegou (o pedido está como concluído)`);
    expect(avisos.map((a) => a.ev)).toContain('atendimento.novo');
    expect((await envios(p.id)).map((e) => [e.acao, e.motivo])).toEqual([
      ['conferir_entrega', null],
      ['conferir_entrega_resposta', 'nao_chegou'],
    ]);
    // a mensagem seguinte do cliente não é mais a resposta: vai ao robô (o caso aberto cala o robô)
    expect(await portaoDaConferencia(db, emitir, { tenantId: t, telefone: NA_CONVERSA, texto: 'Não chegou' })).toMatchObject({ tratou: false });
  });

  it('"Tudo certo" (por escrito): só agradece, sem caso; "Tive um problema": caso normal', async () => {
    const t = await loja();
    const p1 = await pedido(t);
    await escreveu(t);
    await rotina.perguntar();
    expect(await portaoDaConferencia(db, emitir, { tenantId: t, telefone: NO_PEDIDO, texto: 'tudo certo!' })).toMatchObject({
      tratou: true,
      responder: TEXTO_DEPOIS_DA_RESPOSTA.ok,
      pedidoId: p1.id,
    });
    expect(await q(`select 1 from atendimento_chamado where tenant_id = $1`, [t])).toEqual([]);

    const t2 = await loja();
    await pedido(t2);
    await escreveu(t2);
    await rotina.perguntar();
    expect(await portaoDaConferencia(db, emitir, { tenantId: t2, telefone: NA_CONVERSA, texto: 'Tive um problema' })).toMatchObject({
      tratou: true,
      resposta: 'problema',
    });
    const [caso] = await q(`select prioridade from atendimento_chamado where tenant_id = $1`, [t2]);
    expect(caso.prioridade).toBe('normal');
  });

  it('não é a resposta: texto longo, cliente sem pergunta, ou pergunta de mais de 6 h', async () => {
    const t = await loja();
    const p = await pedido(t);
    await escreveu(t);
    await rotina.perguntar();
    expect(await portaoDaConferencia(db, emitir, { tenantId: t, telefone: NA_CONVERSA, texto: 'chegou frio e faltou a coca, quero o dinheiro de volta' })).toMatchObject({ tratou: false });
    expect(await portaoDaConferencia(db, emitir, { tenantId: t, telefone: '5521911112222', texto: 'não chegou' })).toMatchObject({ tratou: false });
    await q(`update pedido_envio set criado_em = now() - interval '7 hours' where pedido_id = $1`, [p.id]);
    expect(await portaoDaConferencia(db, emitir, { tenantId: t, telefone: NA_CONVERSA, texto: 'não chegou' })).toMatchObject({ tratou: false });
  });

  it('o ajuste: nasce desligado; liga e desliga só com verdadeiro/falso (V15), o resto fica (V16), e vai à auditoria', async () => {
    const t = (await q(`insert into empresa (nome) values ('teste ajuste conferir') returning id`))[0].id as string;
    empresas.push(t);
    const ator: any = { tenantId: t, colaboradorId: null, categoria: 'gerente' };
    expect((await ajustes.roboConfig(t)).conferirEntrega).toBe(false);
    await expect(ajustes.salvarRoboConfig(ator, { conferirEntrega: 'sim' })).rejects.toThrow();
    const r = await ajustes.salvarRoboConfig(ator, { conferirEntrega: true });
    expect(r).toMatchObject({ conferirEntrega: true, lembreteCarrinho: false, avisoAtraso: false });
    expect(auditados.map((a) => a.acao)).toContain('conferir_entrega_ligado');
    await ajustes.salvarRoboConfig(ator, { lembreteCarrinho: true });
    expect((await ajustes.roboConfig(t)).conferirEntrega).toBe(true); // o ausente mantém
  });
});
