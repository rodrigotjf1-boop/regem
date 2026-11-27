import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { Food99Service } from '../integracoes/food99/food99.service';
import { Pedido99Service } from './pedido-99.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO DE CANCELAMENTO E DE REEMBOLSO DO CLIENTE DA 99 NA CENTRAL (Onda 1, PR 3), contra o Postgres real e pelo
// caminho de verdade do aviso (`processarWebhook`, com a integração semeada). A 99 é de mentira: o que importa é o CORPO
// que sairia — `agree` booleano e os motivos da lista (ERR-344: antes saía `agree_type`, campo que não existe).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pedido-99-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const LOJA = `loja-${randomUUID().slice(0, 8)}`;
const aviso = (tipo: 'orderCancelApply' | 'orderRefundApply', applyId: string, pedido = '1152921654762996500') =>
  tipo === 'orderCancelApply'
    ? `{"app_shop_id":"${LOJA}","type":"orderCancelApply","data":{"order_id":${pedido},"apply_reason":"do not want","apply_id":${applyId},"reason_list":[{"reason":"preparing"},{"reason":"prepared"}]}}`
    : `{"app_shop_id":"${LOJA}","type":"orderRefundApply","data":{"order_id":${pedido},"apply_reason":"faltou o refrigerante","images":["https://img.99.exemplo/1.jpg"],"apply_id":${applyId},"base_reason_list":[{"base_reason_id":"430005","base_reason":"User misunderstands"},{"base_reason_id":"430008","base_reason":"Other"}]}}`;

descrever('pedidos do cliente da 99 na central (Postgres)', () => {
  let pool: Pool;
  let db: any;
  const avisos: any[] = [];
  const auditoria: any[] = [];
  const enviados: Array<{ caminho: string; corpo: string }> = [];
  let errnoDa99 = 0;
  const T = randomUUID();
  let gerente: string;
  let food99: Food99Service;
  let svc: Pedido99Service;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const casos = () => q(`select * from atendimento_chamado where tenant_id = $1 order by criado_em`, [T]);
  const usuario = () => ({ tenantId: T, colaboradorId: gerente, categoria: 'execucao' }) as any;
  const sign = process.env.FOOD99_REQUIRE_SIGN;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    process.env.FOOD99_REQUIRE_SIGN = 'false'; // o teste não assina o aviso (a assinatura tem os seus testes)
    const eventos: any = { emit: (ev: string, p: any) => avisos.push({ ev, p }) };
    food99 = new Food99Service(db, {} as any, eventos);
    (food99 as any).authToken = async () => 'tk';
    (food99 as any).postJson = async (caminho: string, _tk: string, campos: string[]) => {
      enviados.push({ caminho, corpo: `{${campos.join(',')}}` });
      return { errno: errnoDa99, errmsg: errnoDa99 ? 'recusado' : 'ok' };
    };
    svc = new Pedido99Service(db, food99, eventos, { registrar: async (e: any) => void auditoria.push(e) } as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste pedido 99')`, [T]);
    await q(
      `insert into integracao (tenant_id, canal, ativo, merchant_id, client_id, client_secret, config) values ($1,'99food',true,$2,'app','segredo','{}')`,
      [T, LOJA],
    );
    const funcao = async (cat: string) => (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,$2,$3) returning id`, [T, `F ${cat}`, cat]))[0].id;
    [{ id: gerente }] = await q(`insert into colaborador (tenant_id, nome, funcao_id, senha_hash) values ($1,'Ana gerente',$2,$3) returning id`, [
      T,
      await funcao('gerente'),
      await bcrypt.hash('senha-gerente', 4),
    ]);
    await q(`insert into colaborador (tenant_id, nome, funcao_id, senha_hash) values ($1,'Sara supervisora',$2,$3)`, [T, await funcao('supervisao'), await bcrypt.hash('senha-supervisao', 4)]);
  });
  afterAll(async () => {
    if (sign === undefined) delete process.env.FOOD99_REQUIRE_SIGN;
    else process.env.FOOD99_REQUIRE_SIGN = sign;
    if (!pool) return;
    for (const t of ['atendimento_chamado', 'integracao', 'colaborador', 'funcao']) await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    avisos.length = 0;
    auditoria.length = 0;
    enviados.length = 0;
    errnoDa99 = 0;
    delete process.env.EDGE_MODE;
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
    await q(`update integracao set config = '{}' where tenant_id = $1`, [T]);
  });

  it('cancelamento com o ajuste padrão: vira caso (5 min), NADA vai à 99 — e a 99 reenviando não abre outro', async () => {
    expect(await food99.processarWebhook(aviso('orderCancelApply', '1001'))).toEqual({ errno: 0, errmsg: 'ok' });
    expect(await food99.processarWebhook(aviso('orderCancelApply', '1001'))).toEqual({ errno: 0, errmsg: 'ok' });
    const cs = await casos();
    expect(cs.length).toBe(1);
    expect(cs[0]).toMatchObject({ tipo: 'cancelamento_99', canal: '99food', externo_id: '1001', status: 'aberto', mensagem: 'do not want' });
    const minutos = (new Date(cs[0].prazo_em).getTime() - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(4.5);
    expect(minutos).toBeLessThanOrEqual(5);
    expect(cs[0].detalhe.pedido99).toMatchObject({ pedidoExterno: '1152921654762996500', motivosDeRecusa: ['preparing', 'prepared'] });
    expect(enviados).toEqual([]);
    expect(avisos.filter((a) => a.ev === 'atendimento.novo').length).toBe(1);
  });

  it('cancelamento com o ajuste DESLIGADO: o Regem aceita na hora — com `agree: true` (ERR-344) — e o caso nasce resolvido', async () => {
    await q(`update integracao set config = $2::jsonb where tenant_id = $1`, [T, JSON.stringify({ atendimento99: { decidirCancelamento: false } })]);
    await food99.processarWebhook(aviso('orderCancelApply', '1002'));
    await food99.processarWebhook(aviso('orderCancelApply', '1002')); // reenvio: não responde de novo
    expect(enviados).toEqual([{ caminho: '/v1/order/apply/cancel', corpo: '{"order_id":1152921654762996500,"apply_id":1002,"agree":true}' }]);
    const [c] = await casos();
    expect(c).toMatchObject({ status: 'resolvido', decisao: 'aceito_automatico', prazo_em: null });
  });

  it('reembolso: vira caso com as fotos e o prazo do ajuste (4 h)', async () => {
    await food99.processarWebhook(aviso('orderRefundApply', '2001'));
    const [c] = await casos();
    expect(c).toMatchObject({ tipo: 'reembolso_99', externo_id: '2001', status: 'aberto' });
    expect(c.detalhe.pedido99).toMatchObject({ fotos: ['https://img.99.exemplo/1.jpg'], motivosDoReembolso: [{ id: '430005' }, { id: '430008' }] });
    const horas = (new Date(c.prazo_em).getTime() - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(3.9);
    expect(horas).toBeLessThanOrEqual(4);
  });

  it('responder: recusar o cancelamento com o motivo da lista (gerente) — `agree: false` e `reason`', async () => {
    await food99.processarWebhook(aviso('orderCancelApply', '1003'));
    const [c] = await casos();
    const r = await svc.responder(usuario(), c.id, { aceita: false, motivo: 'preparing', senha: 'senha-gerente' });
    expect(r.resposta).toMatchObject({ acao: 'recusar', motivo: 'preparing', por: 'Ana gerente' });
    expect(enviados).toEqual([{ caminho: '/v1/order/apply/cancel', corpo: '{"order_id":1152921654762996500,"apply_id":1003,"agree":false,"reason":"preparing"}' }]);
    expect((await casos())[0]).toMatchObject({ status: 'resolvido', decisao: 'recusado', resolvido_por_id: gerente });
    expect(auditoria[0]).toMatchObject({ acao: 'respondeu_pedido_99', detalhe: { tipo: 'cancelamento', acao: 'recusar' } });
    await expect(svc.responder(usuario(), c.id, { aceita: true, senha: 'senha-gerente' })).rejects.toThrow('Este pedido da 99 já foi respondido.');
  });

  it('responder: recusar o reembolso leva base_reason_id, base_reason e custom_reason; supervisão não responde', async () => {
    await food99.processarWebhook(aviso('orderRefundApply', '2002'));
    const [c] = await casos();
    await expect(svc.responder(usuario(), c.id, { aceita: false, motivoId: '430005', senha: 'senha-supervisao' })).rejects.toThrow('Senha de gestor inválida.');
    await svc.responder(usuario(), c.id, { aceita: false, motivoId: '430005', explicacao: 'conferido na sacola', senha: 'senha-gerente' });
    expect(enviados).toEqual([
      {
        caminho: '/v1/order/apply/refund',
        corpo: '{"order_id":1152921654762996500,"apply_id":2002,"agree":false,"base_reason_id":"430005","base_reason":"User misunderstands","custom_reason":"conferido na sacola"}',
      },
    ]);
  });

  it('cancelamento depois dos 5 min: não responde (a 99 já recusou sozinha) e nada vai à 99', async () => {
    await food99.processarWebhook(aviso('orderCancelApply', '1007'));
    await q(`update atendimento_chamado set prazo_em = now() - interval '1 second' where tenant_id = $1`, [T]);
    const [c] = await casos();
    await expect(svc.responder(usuario(), c.id, { aceita: true, senha: 'senha-gerente' })).rejects.toThrow('O prazo da 99 acabou');
    expect(enviados).toEqual([]);
  });

  it('a 99 recusa a resposta: a tela ouve o motivo e o caso segue aberto', async () => {
    await food99.processarWebhook(aviso('orderCancelApply', '1004'));
    const [c] = await casos();
    errnoDa99 = 10002;
    await expect(svc.responder(usuario(), c.id, { aceita: true, senha: 'senha-gerente' })).rejects.toThrow('A 99 não aceitou a resposta: recusado');
    expect((await casos())[0].status).toBe('aberto');
  });

  it('a rotina: cancelamento vencido fecha como "recusado pela 99"; reembolso vencido o Regem recusa com o motivo do ajuste', async () => {
    await food99.processarWebhook(aviso('orderCancelApply', '1005'));
    await food99.processarWebhook(aviso('orderRefundApply', '2003'));
    await q(`update atendimento_chamado set prazo_em = now() - interval '1 minute' where tenant_id = $1`, [T]);
    expect(await svc.fecharCancelamentosVencidos()).toBeGreaterThanOrEqual(1);
    await svc.fecharReembolsosSemMotivoVencidos(); // COM a lista, quem decide é o Regem: este não fecha o reembolso
    expect((await casos())[1].status).toBe('aberto');
    expect(await svc.recusarReembolsosVencidos()).toBeGreaterThanOrEqual(1);
    const [cancel, reemb] = await casos();
    expect(cancel).toMatchObject({ status: 'resolvido', decisao: 'recusado_pela_99' });
    expect(reemb).toMatchObject({ status: 'resolvido', decisao: 'recusado_automatico' });
    expect(reemb.detalhe.resposta).toMatchObject({ acao: 'recusar', motivoId: '430008', automatico: true });
    expect(enviados).toEqual([
      {
        caminho: '/v1/order/apply/refund',
        corpo: '{"order_id":1152921654762996500,"apply_id":2003,"agree":false,"base_reason_id":"430008","base_reason":"Other","custom_reason":"Pedido conferido na saída"}',
      },
    ]);
  });

  it('a rotina: a 99 recusou a recusa automática → anota o que ela disse e espera 10 min (antes: a cada minuto, para sempre — ERR-638)', async () => {
    await food99.processarWebhook(aviso('orderRefundApply', '2004'));
    await q(`update atendimento_chamado set prazo_em = now() - interval '1 minute' where tenant_id = $1`, [T]);
    errnoDa99 = 1;
    await svc.recusarReembolsosVencidos();
    let [c] = await casos();
    expect(c.status).toBe('aberto');
    expect(c.detalhe.recusaAutomatica).toBeUndefined();
    expect(c.detalhe.recusaFalhou).toMatchObject({ errno: 1, errmsg: 'recusado', vezes: 1 });
    const minutos = (new Date(c.detalhe.recusaFalhou.deNovoEm).getTime() - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(9.5);
    expect(minutos).toBeLessThanOrEqual(10);
    // no minuto seguinte NÃO chama a 99 de novo
    errnoDa99 = 0;
    expect(await svc.recusarReembolsosVencidos()).toBe(0);
    expect(enviados.length).toBe(1);
    // passados os 10 min, tenta e resolve
    await q(`update atendimento_chamado set detalhe = jsonb_set(detalhe, '{recusaFalhou,deNovoEm}', to_jsonb(now() - interval '1 second')) where tenant_id = $1`, [T]);
    await svc.recusarReembolsosVencidos();
    [c] = await casos();
    expect(c.decisao).toBe('recusado_automatico');
    expect(enviados.length).toBe(2);
  });

  it('a rotina: passadas as 24 h da 99 sem resposta, o caso fecha como "encerrado na 99" e NADA vai à 99 (ERR-638)', async () => {
    await food99.processarWebhook(aviso('orderRefundApply', '2010'));
    await food99.processarWebhook(aviso('orderRefundApply', '2011'));
    await food99.processarWebhook(aviso('orderRefundApply', '2012'));
    // os três com o pedido da 99 de 25 h atrás; o 2011 com a marca de "recusando" de agora (a chamada em curso segura);
    // o 2012 com a marca de 15 min atrás (a API reiniciou no meio da chamada: não segura)
    await q(`update atendimento_chamado set criado_em = now() - interval '25 hours', prazo_em = now() - interval '21 hours' where tenant_id = $1`, [T]);
    await q(`update atendimento_chamado set detalhe = detalhe || jsonb_build_object('recusaAutomatica', jsonb_build_object('em', now())) where tenant_id = $1 and externo_id = '2011'`, [T]);
    await q(
      `update atendimento_chamado set detalhe = detalhe || jsonb_build_object('recusaAutomatica', jsonb_build_object('em', now() - interval '15 minutes')) where tenant_id = $1 and externo_id = '2012'`,
      [T],
    );
    expect(await svc.recusarReembolsosVencidos()).toBe(0); // fora da janela: não chama a 99
    expect(await svc.fecharReembolsosForaDaJanela()).toBe(2);
    const porId = Object.fromEntries((await casos()).map((c: any) => [c.externo_id, c]));
    expect(porId['2010']).toMatchObject({ status: 'resolvido', decisao: 'encerrado_na_99', prazo_em: null });
    expect(porId['2010'].detalhe.encerramento).toMatchObject({ status: 'ENCERRADO_NA_99' });
    expect(porId['2012']).toMatchObject({ status: 'resolvido', decisao: 'encerrado_na_99' });
    expect(porId['2012'].detalhe.recusaAutomatica).toBeUndefined();
    expect(porId['2011'].status).toBe('aberto');
    expect(enviados).toEqual([]);
    expect(avisos.filter((a) => a.p?.motivo === 'encerrado_na_99').length).toBe(2);
    // dentro das 24 h, nada fecha por aqui
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
    await food99.processarWebhook(aviso('orderRefundApply', '2013'));
    await q(`update atendimento_chamado set criado_em = now() - interval '23 hours', prazo_em = now() - interval '19 hours' where tenant_id = $1`, [T]);
    expect(await svc.fecharReembolsosForaDaJanela()).toBe(0);
  });

  it('"Já respondi pelo app da 99": fecha sem enviar nada à 99, com a decisão dita, na auditoria; uma vez só; supervisão não (ERR-638)', async () => {
    await food99.processarWebhook(aviso('orderRefundApply', '2020'));
    const [c] = await casos();
    // a recusa automática que a 99 não aceitou não impede
    await q(`update atendimento_chamado set detalhe = detalhe || '{"recusaFalhou":{"errno":1,"vezes":3}}'::jsonb where id = $1`, [c.id]);
    await expect(svc.responder(usuario(), c.id, { peloApp: true, aceita: true, senha: 'senha-supervisao' })).rejects.toThrow('Senha de gestor inválida.');
    await expect(svc.responder(usuario(), c.id, { peloApp: 'sim', aceita: true, senha: 'senha-gerente' })).rejects.toThrow('Informe "peloApp" (true ou false).');
    const r = await svc.responder(usuario(), c.id, { peloApp: true, aceita: true, senha: 'senha-gerente' });
    expect(r.resposta).toMatchObject({ acao: 'aceitar', via: 'app_99', por: 'Ana gerente' });
    expect(enviados).toEqual([]);
    const [depois] = await casos();
    expect(depois).toMatchObject({ status: 'resolvido', decisao: 'aceito', resolvido_por_id: gerente, prazo_em: null });
    expect(auditoria[0]).toMatchObject({ acao: 'respondeu_pedido_99', detalhe: { tipo: 'reembolso', acao: 'aceitar', via: 'app_99' } });
    await expect(svc.responder(usuario(), c.id, { peloApp: true, aceita: false, senha: 'senha-gerente' })).rejects.toThrow('Este pedido da 99 já foi respondido.');
  });

  it('"Já respondi pelo app da 99": a marca de "recusando" de agora segura (409); a marca velha não', async () => {
    await food99.processarWebhook(aviso('orderRefundApply', '2021'));
    const [c] = await casos();
    await q(`update atendimento_chamado set detalhe = detalhe || jsonb_build_object('recusaAutomatica', jsonb_build_object('em', now())) where id = $1`, [c.id]);
    await expect(svc.responder(usuario(), c.id, { peloApp: true, aceita: false, senha: 'senha-gerente' })).rejects.toThrow('O Regem já está recusando');
    await q(`update atendimento_chamado set detalhe = detalhe || jsonb_build_object('recusaAutomatica', jsonb_build_object('em', now() - interval '15 minutes')) where id = $1`, [c.id]);
    await svc.responder(usuario(), c.id, { peloApp: true, aceita: false, senha: 'senha-gerente' });
    const [depois] = await casos();
    expect(depois).toMatchObject({ status: 'resolvido', decisao: 'recusado' });
    expect(depois.detalhe.recusaAutomatica).toBeUndefined();
    expect(enviados).toEqual([]);
  });

  it('a 99 recusa a resposta da pessoa: o que ela disse fica no caso e a mensagem aponta "Já respondi pelo app da 99"', async () => {
    await food99.processarWebhook(aviso('orderRefundApply', '2022'));
    const [c] = await casos();
    errnoDa99 = 10002;
    await expect(svc.responder(usuario(), c.id, { aceita: true, senha: 'senha-gerente' })).rejects.toThrow(
      'A 99 não aceitou a resposta: recusado. Tente de novo ou, se a loja já respondeu pelo app 99Food Parceiros, use "Já respondi pelo app da 99".',
    );
    const [depois] = await casos();
    expect(depois.status).toBe('aberto');
    expect(depois.detalhe.respostaRecusadaPela99).toMatchObject({ errno: 10002, errmsg: 'recusado' });
  });

  it('a rotina: reembolso SEM a lista de motivos não trava o caso — fica para uma pessoa, que ainda aceita', async () => {
    const semLista = `{"app_shop_id":"${LOJA}","type":"orderRefundApply","data":{"order_id":1152921654762996500,"apply_reason":"faltou","apply_id":2005}}`;
    await food99.processarWebhook(semLista);
    await q(`update atendimento_chamado set prazo_em = now() - interval '1 minute' where tenant_id = $1`, [T]);
    await svc.recusarReembolsosVencidos();
    await svc.recusarReembolsosVencidos(); // no minuto seguinte não tenta de novo
    let [c] = await casos();
    expect(c.status).toBe('aberto');
    expect(c.detalhe).toMatchObject({ semMotivoParaRecusar: true });
    expect(c.detalhe.recusaAutomatica).toBeUndefined();
    expect(enviados).toEqual([]);
    // o prazo passa a ser o da 99: 24 h depois do pedido (quando ela reembolsa sozinha)
    expect(Math.abs(new Date(c.prazo_em).getTime() - new Date(c.criado_em).getTime() - 24 * 3_600_000)).toBeLessThan(2_000);
    expect(await svc.fecharReembolsosSemMotivoVencidos()).toBe(0);
    await svc.responder(usuario(), c.id, { aceita: true, senha: 'senha-gerente' });
    [c] = await casos();
    expect(c).toMatchObject({ status: 'resolvido', decisao: 'aceito' });
    expect(enviados[0].corpo).toBe('{"order_id":1152921654762996500,"apply_id":2005,"agree":true}');
  });

  it('a rotina: reembolso sem a lista e sem resposta nas 24 h da 99 fecha como "reembolsado pela 99"', async () => {
    await food99.processarWebhook(`{"app_shop_id":"${LOJA}","type":"orderRefundApply","data":{"order_id":1,"apply_reason":"x","apply_id":2006}}`);
    await q(`update atendimento_chamado set prazo_em = now() - interval '1 minute' where tenant_id = $1`, [T]);
    await svc.recusarReembolsosVencidos();
    await q(`update atendimento_chamado set prazo_em = now() - interval '1 minute' where tenant_id = $1`, [T]); // passaram as 24 h
    expect(await svc.fecharReembolsosSemMotivoVencidos()).toBeGreaterThanOrEqual(1);
    const [c] = await casos();
    expect(c).toMatchObject({ status: 'resolvido', decisao: 'reembolsado_pela_99', prazo_em: null });
    expect(c.detalhe.encerramento).toMatchObject({ status: 'REEMBOLSADO_PELA_99' });
    expect(enviados).toEqual([]);
  });

  it('o token renovado (e o cancelamento pendente) com a cópia ANTIGA em memória não apagam o ajuste salvo — mescla por chave', async () => {
    const igAntigo = await food99.integracaoDoTenant(T); // carregada antes do ajuste, como num ciclo do poller
    await svc.salvarAjustes({ tenantId: T, colaboradorId: gerente, categoria: 'gerente' } as any, { ajuste99: { reembolsoRecusarEmHoras: 12 } });
    await (food99 as any).persistToken(igAntigo, 'tk-novo', Date.now() + 3_600_000);
    await (food99 as any).marcarCancelPendente(igAntigo, '123', 1010);
    const [ig] = await q(`select token, config from integracao where tenant_id = $1`, [T]);
    expect(ig.token).toBe('tk-novo');
    expect(ig.config.atendimento99).toMatchObject({ reembolsoRecusarEmHoras: 12 });
    expect(ig.config.pendingCancels['123']).toMatchObject({ reasonId: 1010, attempts: 1 });
    expect(ig.config.lastAuthErrno).toBeNull();
  });

  it('dois cancelamentos pendentes de cópias diferentes (dois pedidos ao mesmo tempo): os dois ficam (ERR-474)', async () => {
    const igA = await food99.integracaoDoTenant(T);
    const igB = await food99.integracaoDoTenant(T); // carregada antes de o primeiro gravar, como na chamada simultânea
    await (food99 as any).marcarCancelPendente(igA, 'ped-a', 1010, 'cliente desistiu');
    await (food99 as any).marcarCancelPendente(igB, 'ped-b', 1010);
    const [ig] = await q(`select config from integracao where tenant_id = $1`, [T]);
    expect(ig.config.pendingCancels['ped-a']).toMatchObject({ reasonId: 1010, reason: 'cliente desistiu', attempts: 1 });
    expect(ig.config.pendingCancels['ped-b']).toMatchObject({ reasonId: 1010, attempts: 1 });
    // Tirar um pela cópia velha não apaga o outro.
    await (food99 as any).limparCancelPendente(igA, 'ped-a');
    const [depois] = await q(`select config from integracao where tenant_id = $1`, [T]);
    expect(depois.config.pendingCancels['ped-b']).toMatchObject({ reasonId: 1010 });
    expect(depois.config.pendingCancels['ped-a']).toBeUndefined();
  });

  it('ajustes: o que veio muda, o resto fica (V16); fora do permitido recusa; fica na auditoria', async () => {
    const r = await svc.salvarAjustes({ tenantId: T, colaboradorId: gerente, categoria: 'gerente' } as any, { ajuste99: { reembolsoRecusarEmHoras: 8 } });
    expect(r.ajuste99).toMatchObject({ decidirCancelamento: true, reembolsoRecusarEmHoras: 8, reembolsoMotivo: 'Other' });
    await expect(svc.salvarAjustes({ tenantId: T } as any, { ajuste99: { reembolsoRecusarEmHoras: 30 } })).rejects.toThrow('Escolha 1, 2, 4, 8, 12, 20 horas.');
    await expect(svc.salvarAjustes({ tenantId: T } as any, { ajuste99: { decidirCancelamento: 'sim' } })).rejects.toThrow('Informe "decidirCancelamento" (true ou false).');
    expect(auditoria[0]).toMatchObject({ acao: 'ajustou_atendimento_99' });
    expect((await svc.ajustes(T)).ajuste99).toMatchObject({ reembolsoRecusarEmHoras: 8 });
  });

  it('no APP (mig 353): o PIN de quem está nele responde ao pedido da 99 — gerente sim, supervisão não', async () => {
    const [{ id: sara }] = await q(`select id from colaborador where tenant_id = $1 and nome = 'Sara supervisora'`, [T]);
    await q(`update colaborador set pin_hash = $2 where id = $1`, [gerente, await bcrypt.hash('2468', 4)]);
    await q(`update colaborador set pin_hash = $2 where id = $1`, [sara, await bcrypt.hash('1357', 4)]);
    const noApp = (quem: string) => ({ tenantId: T, colaboradorId: quem, categoria: 'execucao', aparelhoId: '00000000-0000-4000-8000-000000000353' }) as any;
    await food99.processarWebhook(aviso('orderCancelApply', '1007'));
    const [c] = await casos();
    await expect(svc.responder(noApp(sara), c.id, { aceita: false, motivo: 'preparing', pin: '1357' })).rejects.toThrow('Só gerente e presidente respondem. Chame o gerente.');
    await expect(svc.responder(noApp(gerente), c.id, { aceita: false, motivo: 'preparing', pin: '0000' })).rejects.toThrow('PIN inválido.');
    expect(enviados).toEqual([]);
    const r = await svc.responder(noApp(gerente), c.id, { aceita: false, motivo: 'preparing', pin: '2468' });
    expect(r.resposta).toMatchObject({ acao: 'recusar', motivo: 'preparing', por: 'Ana gerente' });
    expect((await casos())[0]).toMatchObject({ status: 'resolvido', decisao: 'recusado', resolvido_por_id: gerente });
  });

  it('no SERVIDOR DA LOJA, pelo PIN: conferido aqui, e o PIN não vai à nuvem', async () => {
    await q(`update colaborador set pin_hash = $2 where id = $1`, [gerente, await bcrypt.hash('2468', 4)]);
    await food99.processarWebhook(aviso('orderCancelApply', '1008'));
    const [c] = await casos();
    process.env.EDGE_MODE = 'true';
    const antes = { api: process.env.CLOUD_API, tok: process.env.SYNC_TOKEN };
    process.env.CLOUD_API = 'https://nuvem.teste/api/v1';
    process.env.SYNC_TOKEN = 'tok';
    const pedidos: any[] = [];
    const fetchAntes = global.fetch;
    global.fetch = (async (url: any, init: any) => {
      pedidos.push({ url: String(url), corpo: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, resposta: { acao: 'aceitar', por: 'Ana gerente' } }), { status: 200 });
    }) as any;
    try {
      await svc.responder({ tenantId: T, colaboradorId: gerente, categoria: 'gerente' } as any, c.id, { aceita: true, pin: '2468' });
    } finally {
      global.fetch = fetchAntes;
      process.env.CLOUD_API = antes.api;
      process.env.SYNC_TOKEN = antes.tok;
      delete process.env.EDGE_MODE;
    }
    expect(pedidos[0].corpo).toMatchObject({ chamadoId: c.id, aceita: true, liberadorId: gerente });
    expect(pedidos[0].corpo.pin).toBeUndefined();
    expect(enviados).toEqual([]);
  });

  it('no SERVIDOR DA LOJA: a senha é conferida aqui e a resposta vai à nuvem, sem a senha no corpo', async () => {
    await food99.processarWebhook(aviso('orderCancelApply', '1006'));
    const [c] = await casos();
    process.env.EDGE_MODE = 'true';
    const antes = { api: process.env.CLOUD_API, tok: process.env.SYNC_TOKEN };
    process.env.CLOUD_API = 'https://nuvem.teste/api/v1';
    process.env.SYNC_TOKEN = 'tok';
    const pedidos: any[] = [];
    const fetchAntes = global.fetch;
    global.fetch = (async (url: any, init: any) => {
      pedidos.push({ url: String(url), corpo: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, resposta: { acao: 'aceitar', por: 'Ana gerente' } }), { status: 200 });
    }) as any;
    try {
      await svc.responder(usuario(), c.id, { aceita: true, senha: 'senha-gerente' });
    } finally {
      global.fetch = fetchAntes;
      process.env.CLOUD_API = antes.api;
      process.env.SYNC_TOKEN = antes.tok;
      delete process.env.EDGE_MODE;
    }
    expect(pedidos[0].url).toBe('https://nuvem.teste/api/v1/atendimento/pedido99-da-loja');
    expect(pedidos[0].corpo).toMatchObject({ chamadoId: c.id, aceita: true, liberadorId: gerente });
    expect(pedidos[0].corpo.senha).toBeUndefined();
    expect(enviados).toEqual([]);
  });

  it('"Já respondi pelo app da 99" no SERVIDOR DA LOJA: vai à nuvem com o peloApp, e a nuvem fecha sem chamar a 99', async () => {
    await food99.processarWebhook(aviso('orderRefundApply', '2030'));
    const [c] = await casos();
    process.env.EDGE_MODE = 'true';
    const antes = { api: process.env.CLOUD_API, tok: process.env.SYNC_TOKEN };
    process.env.CLOUD_API = 'https://nuvem.teste/api/v1';
    process.env.SYNC_TOKEN = 'tok';
    const pedidos: any[] = [];
    const fetchAntes = global.fetch;
    global.fetch = (async (url: any, init: any) => {
      pedidos.push({ url: String(url), corpo: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, resposta: { acao: 'recusar', via: 'app_99', por: 'Ana gerente' } }), { status: 200 });
    }) as any;
    try {
      await svc.responder(usuario(), c.id, { peloApp: true, aceita: false, senha: 'senha-gerente' });
    } finally {
      global.fetch = fetchAntes;
      process.env.CLOUD_API = antes.api;
      process.env.SYNC_TOKEN = antes.tok;
      delete process.env.EDGE_MODE;
    }
    expect(pedidos[0].corpo).toMatchObject({ chamadoId: c.id, peloApp: true, aceita: false, liberadorId: gerente });
    expect(pedidos[0].corpo.senha).toBeUndefined();
    // e a nuvem, recebendo da loja, fecha sem chamar a 99
    await q(`update atendimento_chamado set status = 'aberto', detalhe = detalhe - 'resposta' where id = $1`, [c.id]);
    await svc.responderVindoDaLoja(T, { ...pedidos[0].corpo });
    expect((await casos())[0]).toMatchObject({ status: 'resolvido', decisao: 'recusado' });
    expect(enviados).toEqual([]);
  });
});
