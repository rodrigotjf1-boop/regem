import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { EntregadorService } from '../entregador/entregador.service';
import { AvisosDoChatService, POR_VOLTA } from './avisos-do-chat.service';
import { AjustesDaPonteService } from './ajustes-da-ponte.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A PONTE DO CHAT, parte A2, contra o Postgres real: os avisos automáticos no chat do iFood e da 99 ("saiu" e "obrigado"
// pela rotina da nuvem; "chegando" pela cerca de 70 m do entregador), os ajustes da ponte (o texto com a trava do
// contato, o papel dos PCs) e a faixa da tela Atendimento. As tabelas são só da nuvem: o teste aplica as migrations.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('avisos-do-chat-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('ponte do chat — avisos, ajustes e faixa (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  const avisos = new AvisosDoChatService(db); // sem a previsão: o "saiu" sai sem a hora
  const comHora = new AvisosDoChatService(db, { horaPrevistaDoPedido: async () => '20h15' } as any);
  const ajustes = new AjustesDaPonteService(db, auditoria);
  const T = randomUUID();
  let lojaA: string;
  let lojaB: string;
  let gerente: string;
  let user: any;

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
  const tem = async (t: string) => (await q(`select to_regclass(current_schema() || '.' || $1) is not null as ok`, [t]))[0].ok;
  type Ped = { canal?: string; tipo?: string; status?: string; minDespacho?: number | null; minConcluido?: number | null; nome?: string; raw?: any; unidade?: string };
  async function pedido(o: Ped = {}) {
    return (
      await q(
        `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, numero, tipo, status, cliente_nome, total, raw,
                                     despachado_em, concluido_em, criado_em)
         values ($1,$2,$3,$4,$5,(floor(random()*90000)+10000)::int,$6,$7,$8,50,$9,
                 case when $10::int is null then null else now() - make_interval(mins => $10::int) end,
                 case when $11::int is null then null else now() - make_interval(mins => $11::int) end,
                 now() - interval '40 minutes')
         returning id`,
        [T, o.unidade ?? lojaA, o.canal ?? 'ifood', `ext-${randomUUID()}`, String(1000 + Math.floor(Math.random() * 8999)), o.tipo ?? 'entrega',
          o.status ?? 'despachado', o.nome ?? 'MARIA S.', o.raw ? JSON.stringify(o.raw) : null, o.minDespacho === undefined ? 2 : o.minDespacho, o.minConcluido ?? null],
      )
    )[0].id as string;
  }
  const avisosDe = async (pedidoId: string) =>
    q(`select motivo, texto, estado, direcao, autor, canal from chat_plataforma_msg where pedido_id = $1 order by motivo`, [pedidoId]);
  const ponte = async (unidade: string, nome: string, o: { ifood?: boolean; n99?: boolean; minAtras?: number } = {}) => {
    const [{ id }] = await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token) values ($1,$2,'ponte_chat',$3,$4) returning id`, [T, unidade, nome, `tok-${randomUUID()}`]);
    if (o.minAtras !== undefined)
      await q(
        `insert into chat_ponte (equipamento_id, tenant_id, unidade_id, plataformas, maquina, visto_em) values ($1,$2,$3,$4,$5, now() - make_interval(mins => $6::int))`,
        [id, T, unidade, JSON.stringify({ ifood: { logado: !!o.ifood }, '99food': { logado: !!o.n99 } }), nome.toUpperCase(), o.minAtras],
      );
    return id as string;
  };

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    for (const m of ['342_robo_pausa_e_config.sql', '366_ponte_do_chat.sql', '367_chat_ordem_e_indices.sql', '368_ponte_pausada.sql']) await aplicar(m);
    if (!(await tem('entregador_chegada'))) await aplicar('201_entregador_chegada.sql');
    await q(`insert into empresa (id, nome) values ($1, 'teste avisos do chat')`, [T]);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: lojaB }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja B') returning id`, [T]);
    [{ id: gerente }] = await q(`insert into colaborador (tenant_id, nome, unidade_id, status) values ($1, 'Ana', $2, 'ativo') returning id`, [T, lojaA]);
    user = { tenantId: T, colaboradorId: gerente, categoria: 'gerente' };
  });
  beforeEach(async () => {
    delete process.env.EDGE_MODE;
    auditados.length = 0;
    await q(`delete from chat_plataforma_msg where tenant_id = $1`, [T]);
    await q(`delete from chat_ponte where tenant_id = $1`, [T]);
    await q(`delete from entregador_chegada where tenant_id = $1`, [T]);
    await q(`delete from pedido_externo where tenant_id = $1`, [T]);
    await q(`delete from equipamento where tenant_id = $1`, [T]);
    await q(`delete from integracao where tenant_id = $1`, [T]);
    await q(`delete from robo_config where tenant_id = $1`, [T]);
    await q(`insert into robo_config (tenant_id, chat_ponte_ligada) values ($1, true)`, [T]);
  });
  afterAll(async () => {
    for (const t of ['chat_plataforma_msg', 'chat_ponte', 'entregador_chegada', 'robo_config', 'pedido_externo', 'equipamento', 'integracao', 'colaborador', 'unidade'])
      await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });

  it('"saiu": só iFood e 99 de entrega, despachados há pouco; uma vez só; sem previsão, sem a frase da hora', async () => {
    const ifood = await pedido({ canal: 'ifood', minDespacho: 2 });
    const n99 = await pedido({ canal: '99food', minDespacho: 5, nome: 'joão pedro' });
    const velho = await pedido({ canal: 'ifood', minDespacho: 20 }); // saiu há 20 min: ligar a ponte não dispara o passado
    const cardapio = await pedido({ canal: 'cardapio', minDespacho: 2 });
    const retirada = await pedido({ canal: 'ifood', tipo: 'retirada', status: 'pronto', minDespacho: null });
    const naCozinha = await pedido({ canal: 'ifood', status: 'confirmado', minDespacho: null });
    // o entregador é da plataforma: quem avisa que saiu é o iFood / a 99 (a regra da fila do entregador)
    const doIfood = await pedido({ canal: 'ifood', minDespacho: 2, raw: { delivery: { deliveredBy: 'IFOOD' } } });
    const da99 = await pedido({ canal: '99food', minDespacho: 2, raw: { delivery_type: 1 } });
    const lojaPela99 = await pedido({ canal: '99food', minDespacho: 2, raw: { delivery_type: 2 } });
    const lojaPeloIfood = await pedido({ canal: 'ifood', minDespacho: 2, raw: { delivery: { deliveredBy: 'MERCHANT' } } });
    await avisos.enfileirarDaVolta();
    expect(await avisosDe(ifood)).toEqual([{ motivo: 'saiu', texto: 'Seu pedido saiu para entrega!', estado: 'pendente', direcao: 'saida', autor: 'aviso', canal: 'ifood' }]);
    expect((await avisosDe(n99)).map((a) => a.canal)).toEqual(['99food']);
    expect((await avisosDe(lojaPela99)).map((a) => a.motivo)).toEqual(['saiu']);
    expect((await avisosDe(lojaPeloIfood)).map((a) => a.motivo)).toEqual(['saiu']);
    for (const p of [velho, cardapio, retirada, naCozinha, doIfood, da99]) expect(await avisosDe(p)).toEqual([]);
    // a volta seguinte (e uma 2ª réplica) não mandam de novo
    await Promise.all([avisos.enfileirarDaVolta(), avisos.enfileirarDaVolta()]);
    expect(await avisosDe(ifood)).toHaveLength(1);
    expect(await avisosDe(n99)).toHaveLength(1);
  });

  it('"saiu" com a previsão do rastreio e o texto da loja ({nome} e {hora})', async () => {
    const a = await pedido({ minDespacho: 1 });
    await comHora.enfileirarDaVolta();
    expect((await avisosDe(a))[0].texto).toBe('Seu pedido saiu para entrega! Chega por volta das 20h15.');
    await q(`update robo_config set chat_aviso_saiu_texto = 'Oi {nome}! Saiu. Chega {hora}.' where tenant_id = $1`, [T]);
    const b = await pedido({ minDespacho: 1, nome: 'CARLA M.' });
    await comHora.enfileirarDaVolta();
    expect((await avisosDe(b))[0].texto).toBe('Oi Carla! Saiu. Chega 20h15.');
  });

  it('ponte desligada, ou o aviso desligado: nada entra; "obrigado" só ligado (nasce desligado)', async () => {
    const p = await pedido({ minDespacho: 1 });
    const fim = await pedido({ status: 'concluido', minDespacho: 15, minConcluido: 5 });
    const fimVelho = await pedido({ status: 'concluido', minDespacho: 200, minConcluido: 120 }); // concluído há 2 h
    await q(`update robo_config set chat_ponte_ligada = false where tenant_id = $1`, [T]);
    await avisos.enfileirarDaVolta();
    expect(await avisosDe(p)).toEqual([]);
    await q(`update robo_config set chat_ponte_ligada = true, chat_aviso_saiu = false where tenant_id = $1`, [T]);
    await avisos.enfileirarDaVolta();
    expect(await avisosDe(p)).toEqual([]);
    expect(await avisosDe(fim)).toEqual([]); // obrigado nasce desligado
    await q(`update robo_config set chat_aviso_obrigado = true where tenant_id = $1`, [T]);
    await avisos.enfileirarDaVolta();
    expect(await avisosDe(fim)).toEqual([expect.objectContaining({ motivo: 'obrigado', texto: 'Obrigado pelo pedido, Maria! Bom apetite.' })]);
    expect(await avisosDe(fimVelho)).toEqual([]); // ligar o "obrigado" não agradece o que foi entregue há horas
  });

  it(`a lista não trava (LIC-527): pedidos que não podem receber (${POR_VOLTA + 10} do cardápio e ${POR_VOLTA + 10} que já receberam), mais antigos, não tomam a vez`, async () => {
    // todos mais antigos que o pedido do iFood que pode receber; os que já receberam o "saiu" seriam barrados pelo índice
    // único na gravação — mas, sem o "já recebeu" no where, tomariam a volta inteira e o novo nunca entraria
    const lote = async (canal: string, base: number) => {
      const valores: string[] = [];
      const params: any[] = [T, lojaA];
      for (let i = 0; i < POR_VOLTA + 10; i++) {
        params.push(`ext-${canal}-${i}-${randomUUID()}`);
        valores.push(`($1,$2,'${canal}',$${params.length},'1',${base + i},'entrega','despachado','X',10, now() - interval '2 minutes', now() - interval '3 hours')`);
      }
      return (
        await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, numero, tipo, status, cliente_nome, total, despachado_em, criado_em)
           values ${valores.join(',')} returning id`,
          params,
        )
      ).map((x: any) => x.id as string);
    };
    await lote('cardapio', 500000);
    const jaReceberam = await lote('ifood', 600000);
    await q(
      `insert into chat_plataforma_msg (tenant_id, unidade_id, canal, pedido_id, direcao, autor, motivo, texto, estado)
       select $1, $2, 'ifood', x, 'saida', 'aviso', 'saiu', 'Seu pedido saiu para entrega!', 'enviada' from unnest($3::uuid[]) as x`,
      [T, lojaA, jaReceberam],
    );
    const novo = await pedido({ minDespacho: 1 });
    await avisos.enfileirarDaVolta();
    expect((await avisosDe(novo)).map((a) => a.motivo)).toEqual(['saiu']);
  });

  it('"chegando" pela cerca: entra uma vez; fora do caminho ou desligado diz por quê; o entregador manda pelo chat', async () => {
    const p = await pedido({ minDespacho: 3 });
    expect(await avisos.enfileirarChegando(T, p)).toBe('enfileirado');
    expect(await avisos.enfileirarChegando(T, p)).toBe('ja_enfileirado');
    expect((await avisosDe(p)).find((a) => a.motivo === 'chegando')).toMatchObject({ texto: 'Maria, o entregador está chegando! Já pode ir até a porta.', estado: 'pendente' });
    const pronto = await pedido({ status: 'pronto', minDespacho: null });
    expect(await avisos.enfileirarChegando(T, pronto)).toBe('fora');
    const card = await pedido({ canal: 'cardapio' });
    expect(await avisos.enfileirarChegando(T, card)).toBe('fora');
    // entregador da plataforma: o "chegando" é dela
    const doIfood = await pedido({ minDespacho: 3, raw: { delivery: { deliveredBy: 'IFOOD' } } });
    expect(await avisos.enfileirarChegando(T, doIfood)).toBe('fora');
    await q(`update robo_config set chat_aviso_chegando = false where tenant_id = $1`, [T]);
    const outro = await pedido({ minDespacho: 3 });
    expect(await avisos.enfileirarChegando(T, outro)).toBe('desligado');
    // O app do entregador (a cerca e o botão "estou chegando") manda pelo chat da plataforma — não pelo WhatsApp.
    await q(`update robo_config set chat_aviso_chegando = true where tenant_id = $1`, [T]);
    const ent = new EntregadorService(db, {} as any, {} as any, undefined, avisos);
    const pelaCerca = await pedido({ minDespacho: 3 });
    // O iFood não manda o telefone do cliente: manda o 0800 da central dele (o cliente se identifica pelo localizador).
    expect(await (ent as any).dispararChegada(user, { id: pelaCerca, canal: 'ifood', clienteTelefone: '0800 705 0505' })).toEqual({ ok: true });
    expect((await avisosDe(pelaCerca)).map((a) => a.motivo)).toEqual(['chegando']);
    // o botão "estou chegando" do app: pedido do iFood sem telefone também avisa (o chat não precisa do telefone)
    const entregador = { ...user, funcaoNome: 'Entregador' };
    const semTelefone = await pedido({ minDespacho: 3 });
    await q(`update pedido_externo set entregador_id = $2, cliente_telefone = null where id = $1`, [semTelefone, gerente]);
    expect(await ent.avisarChegando(entregador, semTelefone)).toEqual({ ok: true });
    expect((await avisosDe(semTelefone)).map((a) => a.motivo)).toEqual(['chegando']);
    await q(`update robo_config set chat_ponte_ligada = false where tenant_id = $1`, [T]);
    const r = await (ent as any).dispararChegada(user, { id: await pedido({ minDespacho: 3 }), canal: '99food' });
    expect(r).toEqual({ ok: false, motivo: expect.stringContaining('aviso no chat da plataforma está desligado') });
  });

  it('a posição que o iFood mandou vira o destino do entregador (sem geocodificar) e fica guardada', async () => {
    const p = await pedido({ raw: { delivery: { deliveryAddress: { coordinates: { latitude: -22.9068, longitude: -43.1729 } } } } });
    const ent = new EntregadorService(db, {} as any, {} as any);
    const [row] = await q(`select * from pedido_externo where id = $1`, [p]);
    expect(await (ent as any).coordDoPedido(T, row)).toEqual({ lat: -22.9068, lng: -43.1729 });
    const [c] = await q(`select lat::float as lat, lng::float as lng from entregador_chegada where pedido_id = $1`, [p]);
    expect(c).toEqual({ lat: -22.9068, lng: -43.1729 });
  });

  it('ajustes: padrões sem linha; grava só o que veio; texto com contato é recusado; vazio volta ao padrão', async () => {
    await q(`delete from robo_config where tenant_id = $1`, [T]);
    const a0 = await ajustes.ajustes(T, lojaA);
    expect(a0).toMatchObject({
      ligada: false,
      onde: 'auto',
      avisos: { saiu: { ligado: true, texto: null }, chegando: { ligado: true, texto: null }, obrigado: { ligado: false, texto: null } },
      pontes: [],
    });
    await ajustes.salvar(user, lojaA, { ligada: true });
    // outro escritor mexeu no texto no meio: ligar a ponte não regrava o texto (V82)
    await q(`update robo_config set chat_aviso_saiu_texto = 'Texto da outra tela' where tenant_id = $1`, [T]);
    await ajustes.salvar(user, lojaA, { avisos: { obrigado: { ligado: true } } });
    const [rc] = await q(`select chat_ponte_ligada, chat_aviso_saiu_texto, chat_aviso_obrigado from robo_config where tenant_id = $1`, [T]);
    expect(rc).toEqual({ chat_ponte_ligada: true, chat_aviso_saiu_texto: 'Texto da outra tela', chat_aviso_obrigado: true });
    await expect(ajustes.salvar(user, lojaA, { avisos: { saiu: { texto: 'Pede no whats (21) 99999-1234' } } })).rejects.toThrow(
      'O iFood e a 99 proíbem telefone, WhatsApp, Instagram ou link no chat: tire isso do aviso "saiu para entrega".',
    );
    await expect(ajustes.salvar(user, lojaA, { avisos: { chegando: { texto: 'x'.repeat(301) } } })).rejects.toThrow('no máximo 300 letras');
    await expect(ajustes.salvar(user, lojaA, { ligada: 'sim' })).rejects.toThrow('Informe "ligada" (true ou false).');
    const a1 = await ajustes.salvar(user, lojaA, { avisos: { saiu: { texto: '   ' } } });
    expect(a1.avisos.saiu.texto).toBeNull();
    expect(auditados.map((x) => x.acao)).toEqual(['ponte_do_chat_ajustada', 'ponte_do_chat_ajustada', 'ponte_do_chat_ajustada']);
  });

  it('ajustes: "o robô responde no chat" (Etapa 3) nasce desligado, liga e desliga só com booleano e vai para a auditoria', async () => {
    await q(`delete from robo_config where tenant_id = $1`, [T]);
    expect((await ajustes.ajustes(T, lojaA)).roboResponde).toBe(false);
    const ligado = await ajustes.salvar(user, lojaA, { roboResponde: true });
    expect(ligado.roboResponde).toBe(true);
    expect((await q(`select chat_robo_responde, chat_ponte_ligada from robo_config where tenant_id = $1`, [T]))[0]).toEqual({
      chat_robo_responde: true,
      chat_ponte_ligada: false, // ligar o robô não liga a ponte (só o que veio — V16)
    });
    expect(auditados).toEqual([expect.objectContaining({ acao: 'ponte_do_chat_ajustada', detalhe: { chat_robo_responde: true } })]);
    await expect(ajustes.salvar(user, lojaA, { roboResponde: 'sim' })).rejects.toThrow('Informe "roboResponde" (true ou false).');
    expect((await ajustes.salvar(user, lojaA, { roboResponde: false })).roboResponde).toBe(false);
  });

  it('onde a ponte roda: escolher a principal e a reserva da loja (a que ainda não deu sinal também); de outra loja, não', async () => {
    const delivery = await ponte(lojaA, 'Ponte do delivery', { ifood: true, minAtras: 0 });
    const servidor = await ponte(lojaA, 'Ponte do servidor'); // pareada, sem sinal ainda
    const daB = await ponte(lojaB, 'Ponte da loja B', { ifood: true, minAtras: 0 });
    const r = await ajustes.salvar(user, lojaA, { onde: 'escolher', principalId: servidor, reservaId: delivery });
    expect(r).toMatchObject({ onde: 'escolher', principalId: servidor, reservaId: delivery });
    expect(r.pontes.map((p: any) => p.id)).toEqual([delivery, servidor]);
    const papeis = await q(`select equipamento_id, papel from chat_ponte where tenant_id = $1 order by papel`, [T]);
    expect(papeis).toEqual(
      expect.arrayContaining([
        { equipamento_id: servidor, papel: 'principal' },
        { equipamento_id: delivery, papel: 'reserva' },
        { equipamento_id: daB, papel: 'auto' },
      ]),
    );
    await expect(ajustes.salvar(user, lojaA, { onde: 'escolher', principalId: daB })).rejects.toThrow('Este PC não é uma ponte desta loja.');
    await expect(ajustes.salvar(user, lojaA, { onde: 'escolher', principalId: delivery, reservaId: delivery })).rejects.toThrow('PCs diferentes');

    // Presidente em "todas as lojas" (ou empresa de loja única): a lista traz as pontes de todas; escolher a principal da
    // loja B regrava SÓ as pontes da loja B — a escolha da loja A fica.
    const presidente = { ...user, categoria: 'presidente' };
    await ajustes.salvar(presidente, null, { onde: 'escolher', principalId: daB, reservaId: null });
    expect(await q(`select equipamento_id, papel from chat_ponte where tenant_id = $1 order by papel, equipamento_id`, [T])).toEqual(
      expect.arrayContaining([
        { equipamento_id: servidor, papel: 'principal' },
        { equipamento_id: delivery, papel: 'reserva' },
        { equipamento_id: daB, papel: 'principal' },
      ]),
    );
    await expect(ajustes.salvar(presidente, null, { onde: 'escolher', principalId: delivery, reservaId: daB })).rejects.toThrow(
      'A principal e a reserva têm de ser PCs da mesma loja.',
    );

    const auto = await ajustes.salvar(user, lojaA, { onde: 'auto' });
    expect(auto).toMatchObject({ onde: 'auto', principalId: null, reservaId: null });
    // "Escolher os PCs" sem a principal não volta calado para "Automático": o servidor pede a principal.
    await expect(ajustes.salvar(user, lojaA, { onde: 'escolher' })).rejects.toThrow('Escolha o PC principal da ponte.');
    await expect(ajustes.salvar(user, lojaA, { onde: 'escolher', reservaId: delivery })).rejects.toThrow('Escolha o PC principal da ponte.');
    // recusado o papel, nada fica meio salvo: o "desligar" que veio junto não é gravado
    const ligada = async () => (await q(`select chat_ponte_ligada from robo_config where tenant_id = $1`, [T]))[0].chat_ponte_ligada;
    await expect(ajustes.salvar(user, lojaA, { ligada: false, onde: 'escolher' })).rejects.toThrow('Escolha o PC principal da ponte.');
    expect(await ligada()).toBe(true);
    // a conferência sozinha (o controlador chama antes de gravar qualquer grupo) recusa o mesmo e não grava nada
    await expect(ajustes.conferir(user, lojaA, { onde: 'escolher' })).rejects.toThrow('Escolha o PC principal da ponte.');
    await expect(ajustes.conferir(user, lojaA, { avisos: { saiu: { texto: 'Siga no insta @loja' } } })).rejects.toThrow('proíbem');
    await expect(ajustes.conferir(user, lojaA, { ligada: false, onde: 'escolher', principalId: servidor })).resolves.toBeUndefined();
    expect(await ligada()).toBe(true);
    expect(await q(`select count(*)::int as n from chat_ponte where tenant_id = $1 and papel = 'principal' and equipamento_id = $2`, [T, servidor])).toEqual([{ n: 0 }]);
  });

  it('a faixa: desligada não mostra nada; por canal conectado, quem responde agora e as reservas', async () => {
    await q(`update robo_config set chat_ponte_ligada = false where tenant_id = $1`, [T]);
    expect(await ajustes.situacao(T, lojaA)).toEqual({ ligada: false });
    await q(`update robo_config set chat_ponte_ligada = true where tenant_id = $1`, [T]);
    await q(`insert into integracao (tenant_id, canal, ativo, config) values ($1, 'ifood', true, '{}'::jsonb)`, [T]);
    expect(await ajustes.situacao(T, lojaA)).toMatchObject({ ligada: true, pontes: 0, canais: { ifood: { responde: null, reservas: [] } } });
    await ponte(lojaA, 'Ponte do delivery', { ifood: true, minAtras: 0 });
    await ponte(lojaA, 'Ponte do servidor', { ifood: true, minAtras: 1 });
    await ponte(lojaA, 'Ponte parada', { ifood: true, minAtras: 30 }); // sem sinal há 30 min
    const s = await ajustes.situacao(T, lojaA);
    // a "Ponte parada" (30 min sem sinal) não conta como reserva
    expect(s).toMatchObject({ ligada: true, pontes: 3, canais: { ifood: { responde: { nome: 'Ponte do delivery', maquina: 'PONTE DO DELIVERY' }, reservas: ['Ponte do servidor'] } } });
    expect(Object.keys((s as any).canais)).toEqual(['ifood']); // a 99 não está conectada: não aparece
    expect((s as any).pausadas).toEqual([]);
    // pausada no PC (mig 368): sai de quem responde e das reservas; a faixa diz onde está pausada (só as com sinal)
    await q(`update chat_ponte set pausada_em = now() where tenant_id = $1 and maquina in ('PONTE DO DELIVERY', 'PONTE PARADA')`, [T]);
    const p = await ajustes.situacao(T, lojaA);
    expect(p).toMatchObject({ canais: { ifood: { responde: { nome: 'Ponte do servidor' }, reservas: [] } }, pausadas: ['Ponte do delivery'] });
    await q(`update chat_ponte set pausada_em = now() where tenant_id = $1 and maquina = 'PONTE DO SERVIDOR'`, [T]);
    expect(await ajustes.situacao(T, lojaA)).toMatchObject({ canais: { ifood: { responde: null, reservas: [] } }, pausadas: ['Ponte do delivery', 'Ponte do servidor'] });
    // os ajustes também dizem desde quando cada uma está pausada
    const a = await ajustes.ajustes(T, lojaA);
    expect(a.pontes.find((x: any) => x.nome === 'Ponte do servidor')?.pausadaEm).toBeTruthy();
    expect(a.pontes.find((x: any) => x.nome === 'Ponte do delivery')?.pausadaEm).toBeTruthy();
    // a 99 "só lendo" (4a): a ponte lê o chat da 99, mas não envia — não responde nem é reserva; a faixa diz quem lê
    await q(`update chat_ponte set pausada_em = null where tenant_id = $1`, [T]);
    await q(`insert into integracao (tenant_id, canal, ativo, config) values ($1, '99food', true, '{}'::jsonb)`, [T]);
    await q(`update chat_ponte set plataformas = jsonb_set(plataformas, '{99food}', '{"logado": false, "lendo": true}') where tenant_id = $1 and maquina in ('PONTE DO DELIVERY', 'PONTE PARADA')`, [T]);
    const l = await ajustes.situacao(T, lojaA);
    expect((l as any).canais['99food']).toEqual({ responde: null, reservas: [], lendo: ['Ponte do delivery'] }); // a parada (sem sinal) não lê
    expect((l as any).canais.ifood).toMatchObject({ responde: { nome: 'Ponte do delivery' }, lendo: [] });
    // pausada também não lê
    await q(`update chat_ponte set pausada_em = now() where tenant_id = $1 and maquina = 'PONTE DO DELIVERY'`, [T]);
    expect(((await ajustes.situacao(T, lojaA)) as any).canais['99food'].lendo).toEqual([]);
  });
});
