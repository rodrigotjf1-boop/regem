import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DeliveryService } from './delivery.service';
import { AvisoDeAtrasoProcessor } from './aviso-de-atraso.processor';
import { WhatsappProvedorService } from '../whatsapp/whatsapp-provedor.service';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O AVISO AUTOMÁTICO DE ATRASO contra o Postgres real (Bloco 5 do plano do robô; mig 347): quem entra (a loja que
// ligou, no WhatsApp oficial; o pedido do cardápio próprio, em andamento, além do tempo prometido + tolerância), uma vez
// só por pedido — também com duas rotinas ao mesmo tempo —, e o salvar do ajuste (o ausente mantém; só true/false). As
// tabelas são só da nuvem (215, 342, 347 e os modelos): o teste aplica os arquivos (o banco do CI é o de uma loja).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('aviso-de-atraso-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const daTabelaDeModelos = (arq: string) =>
  readFileSync(MIG(arq), 'utf8')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => /whatsapp_template/.test(s) && !/alter table campanha/i.test(s));

descrever('aviso automático de atraso (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const saidas: any[] = [];
  const oficial = {
    enviarTexto: async (_t: string, para: string, texto: string) => void saidas.push({ como: 'texto', para, texto }),
    enviarLink: async (_t: string, para: string, corpo: string) => void saidas.push({ como: 'link', para, texto: corpo }),
    enviarTemplate: async (_t: string, para: string, nome: string, _i: string, params: string[]) => void saidas.push({ como: 'modelo', para, nome, params }),
  } as any;
  // Os opcionais do construtor na ordem: openDelivery, cardapioWeb, ifood, food99, anotaai, gogemAviso, auditoria, oficial.
  const delivery: any = new (DeliveryService as any)(db, {}, {}, {}, {}, { emit: () => true }, { flashPedidos: () => undefined },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, oficial);
  const rotina = new AvisoDeAtrasoProcessor(db, delivery);
  const auditados: any[] = [];
  const ajustes = new WhatsappProvedorService(db, { registrar: async (a: any) => void auditados.push(a) } as any, {} as any, {} as any);
  const empresas: string[] = [];

  /** Uma migration numa transação só — de novo quando o DDL corre com o de outra spec no mesmo banco (ERR-194). */
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
    for (const s of [...daTabelaDeModelos('227_whatsapp_template.sql'), ...daTabelaDeModelos('236_whatsapp_template_evento.sql')])
      await repetirNaCorridaDeCatalogo(() => pool.query(s));
    for (const m of ['342_robo_pausa_e_config.sql', '347_aviso_de_atraso.sql', '347_aviso_de_atraso.sql']) await aplicar(m);
  });
  beforeEach(() => {
    saidas.length = 0;
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['pedido_aviso_atraso', 'pedido_envio', 'pedido_notificacao', 'pedido_externo', 'whatsapp_mensagem', 'whatsapp_template', 'robo_config', 'cardapio_config'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  /** Uma loja: o WhatsApp da loja, o tempo prometido (entrega 40, retirada 20) e o aviso (ligado com 10 min ou não). */
  async function loja(provedor: 'cloud' | 'evolution', aviso: boolean, tel = '5521987654321') {
    const t = (await q(`insert into empresa (nome) values ('teste aviso de atraso') returning id`))[0].id as string;
    empresas.push(t);
    await q(
      `insert into cardapio_config (tenant_id, token, ativo, provedor, wa_cloud_phone_id, tempo_entrega_min, tempo_retirada_min)
       values ($1,$2,true,$3,$4,40,20)`,
      [t, `tk-${randomUUID()}`, provedor, `ph-${randomUUID().slice(0, 12)}`],
    );
    await q(`insert into robo_config (tenant_id, aviso_atraso, aviso_atraso_tolerancia_min) values ($1,$2,10)`, [t, aviso]);
    await q(`insert into whatsapp_mensagem (tenant_id, telefone, direcao, texto, criado_em) values ($1,$2,'entrada','oi', now() - interval '1 hour')`, [t, tel]);
    return t;
  }
  /** Um pedido que entrou `min` minutos atrás. */
  const pedido = async (t: string, min: number, extra: { tipo?: string; status?: string; canal?: string; agendado?: boolean; display?: string } = {}) =>
    (
      await q(
        `insert into pedido_externo (tenant_id, canal, display_id, cliente_nome, cliente_telefone, tipo, itens, total, status, criado_em, agendamento)
         values ($1,$2,$3,'Rodrigo Teste','21987654321',$4,'[]'::jsonb,30,$5, now() - make_interval(mins => $6), $7) returning id`,
        [t, extra.canal ?? 'cardapio', extra.display ?? String(min), extra.tipo ?? 'entrega', extra.status ?? 'confirmado', min, extra.agendado ? new Date(Date.now() + 3600_000) : null],
      )
    )[0].id as string;

  it('avisa UMA vez o pedido que passou do prometido + tolerância; o resto não entra', async () => {
    const t = await loja('cloud', true);
    const atrasado = await pedido(t, 55, { display: '55' }); // entrega: 40 + 10 = 50 → atrasado
    await pedido(t, 45); // entrega, ainda no prazo
    const retirada = await pedido(t, 35, { tipo: 'retirada', display: 'R35' }); // retirada: 20 + 10 = 30 → atrasada
    await pedido(t, 40, { tipo: 'retirada', status: 'pronto' }); // pronta: o cliente já foi avisado
    await pedido(t, 90, { status: 'concluido' }); // já entregue
    await pedido(t, 90, { canal: 'ifood' }); // o iFood avisa pelo app dele
    await pedido(t, 90, { agendado: true }); // agendado
    await pedido(t, 60 * 7); // de 7 horas atrás: fora da varredura
    const desligada = await loja('cloud', false);
    await pedido(desligada, 90);
    const qr = await loja('evolution', true);
    await pedido(qr, 90);

    const ids = (await rotina.pedidosAtrasados()).filter((p) => empresas.includes(p.tenantId)).map((p) => p.id);
    expect(ids.sort()).toEqual([atrasado, retirada].sort());
    expect(await rotina.avisarAtrasados()).toBeGreaterThanOrEqual(2);
    const nossos = saidas.filter((s) => s.para === '5521987654321');
    expect(nossos.map((s) => s.texto).sort()).toEqual(
      [
        '*Pedido atrasando*\nSeu pedido #55 está levando mais tempo que o previsto. Pedimos desculpas — já estamos correndo para concluir. 🙏',
        '*Pedido atrasando*\nSeu pedido #R35 está levando mais tempo que o previsto. Pedimos desculpas — já estamos correndo para concluir. 🙏',
      ].sort(),
    );
    // A segunda volta não avisa de novo.
    saidas.length = 0;
    await rotina.avisarAtrasados();
    expect(saidas.filter((s) => s.para === '5521987654321')).toEqual([]);
    expect(await q(`select count(*)::int as n from pedido_aviso_atraso where tenant_id = $1`, [t])).toEqual([{ n: 2 }]);
  });

  it('duas rotinas ao mesmo tempo (duas réplicas da API): o cliente recebe o aviso uma vez só', async () => {
    const t = await loja('cloud', true, '5521976543210');
    await q(`update pedido_externo set status = 'concluido' where tenant_id = any($1::uuid[])`, [empresas]); // só o novo conta
    await q(
      `insert into pedido_externo (tenant_id, canal, display_id, cliente_nome, cliente_telefone, tipo, itens, total, status, criado_em)
       values ($1,'cardapio','77','Ana','21976543210','entrega','[]'::jsonb,30,'despachado', now() - interval '80 minutes')`,
      [t],
    );
    const outra = new AvisoDeAtrasoProcessor(db, delivery);
    await Promise.all([rotina.avisarAtrasados(), outra.avisarAtrasados()]);
    expect(saidas.filter((s) => s.para === '5521976543210')).toHaveLength(1);
  });

  it('salvar o ajuste: nasce desligado; o que não vem fica como estava; só true/false e as tolerâncias da lista', async () => {
    const t = (await q(`insert into empresa (nome) values ('teste ajuste do atraso') returning id`))[0].id as string;
    empresas.push(t);
    const ator: any = { tenantId: t, colaboradorId: randomUUID(), categoria: 'gerente' };
    expect(await ajustes.roboConfig(t)).toMatchObject({ pausaMinutos: 60, avisoAtraso: false, avisoAtrasoToleranciaMin: 10, opcoesToleranciaAtraso: [0, 5, 10, 15, 20, 30] });
    expect(await ajustes.salvarRoboConfig(ator, { pausaMinutos: 30 })).toMatchObject({ pausaMinutos: 30, avisoAtraso: false });
    expect(await ajustes.salvarRoboConfig(ator, { avisoAtraso: true })).toMatchObject({ pausaMinutos: 30, avisoAtraso: true, avisoAtrasoToleranciaMin: 10 });
    expect(await ajustes.salvarRoboConfig(ator, { avisoAtrasoToleranciaMin: 15 })).toMatchObject({ pausaMinutos: 30, avisoAtraso: true, avisoAtrasoToleranciaMin: 15 });
    await expect(ajustes.salvarRoboConfig(ator, { avisoAtraso: 'sim' })).rejects.toThrow('avisoAtraso');
    await expect(ajustes.salvarRoboConfig(ator, { avisoAtrasoToleranciaMin: 7 })).rejects.toThrow('avisoAtrasoToleranciaMin');
    await expect(ajustes.salvarRoboConfig(ator, {})).rejects.toThrow('Nada para salvar');
    expect(auditados.filter((a) => a.tenantId === t).map((a) => a.acao)).toEqual(['robo_pausa_alterada', 'aviso_atraso_ligado', 'aviso_atraso_tolerancia_alterada']);
  });
});
