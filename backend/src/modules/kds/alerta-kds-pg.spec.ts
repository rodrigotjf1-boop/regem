import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { uuidDeChave } from '../../common/id-deterministico';
import { AlertaKdsService } from './alerta-kds.service';
import { FarolAlertasService } from './farol-alertas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Os avisos do KDS GUARDADOS e o Farol na cozinha (auditoria do KDS de 11/11/2026, onda 3 — mig 412), contra o Postgres:
//  • todo aviso vira linha e vai às telas com o id dela; o "Ciente" grava quem e quando, uma vez, e avisa as outras telas;
//  • a tela recarregada recupera o urgente sem "Ciente" (12 h, a loja dela, o LADO dela); o histórico; a limpeza de 90 dias;
//  • no servidor da loja, o aviso da nuvem marcado para a loja vai às telas uma vez, quando desce;
//  • o transporte do Farol: só a loja viva e ligada ao Farol (a régua da porta — V75), o reenvio não repete, e o
//    resultado que volta ao Farol, com a busca e a recusa da credencial.
// O banco do CI é de LOJA: as duas tabelas da nuvem que a régua lê (`integracao_token_loja`, `integracao_ligacao`) sobem
// num schema SÓ deste teste, na frente do `public`, com as colunas que a régua usa (conferidas na nuvem).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('alerta-kds-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

const envios: any[] = JSON.parse(readFileSync(join(__dirname, 'transporte-dos-alertas.farol.json'), 'utf8')).envios;

descrever('avisos do KDS guardados e o Farol (Postgres)', () => {
  const ESQ = 'spec_alerta_kds_' + randomUUID().replace(/-/g, '').slice(0, 10);
  let pool: Pool;
  let svc: AlertaKdsService;
  let farol: FarolAlertasService;
  const emitidos: { nome: string; dado: any }[] = [];
  const [T, T2] = [randomUUID(), randomUUID()];
  const [U1, U2, U3, U_APAGADA] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const mostrados = () => emitidos.filter((e) => e.nome === 'kds.alerta.mostrar');
  const limpar = () => {
    emitidos.length = 0;
  };
  const edge = (ligado: boolean) => {
    if (ligado) process.env.EDGE_MODE = 'true';
    else delete process.env.EDGE_MODE;
  };
  const envioPara = (base: any, loja: string, id = randomUUID()) => ({
    ...base,
    id,
    alerta: { ...base.alerta, loja: { ...base.alerta.loja, regem_loja_id: loja } },
  });

  beforeAll(async () => {
    edge(false);
    const admin = new Pool({ connectionString: URL_PG });
    await admin.query(`create schema ${ESQ}`);
    await admin.query(`create table ${ESQ}.integracao_token_loja (id uuid primary key, tenant_id uuid not null, unidade_id uuid,
                         cliente text not null, revogado_em timestamptz, expira_em timestamptz)`);
    await admin.query(`create table ${ESQ}.integracao_ligacao (id uuid primary key, tenant_id uuid, revogado_em timestamptz)`);
    await admin.end();
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${ESQ},public` });
    const db = drizzle(pool, { schema }) as any;
    svc = new AlertaKdsService(db, { emit: (nome: string, dado: any) => emitidos.push({ nome, dado }) } as any);
    farol = new FarolAlertasService(db, svc);
    await q(`insert into empresa (id, nome) values ($1,'teste avisos'), ($2,'outra empresa')`, [T, T2]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$3,'Loja 1'), ($2,$3,'Loja 2'), ($4,$5,'Da outra')`, [U1, U2, T, U3, T2]);
    await q(`insert into unidade (id, tenant_id, nome, deleted_at) values ($1,$2,'Fechada', now())`, [U_APAGADA, T]);
  });

  afterAll(async () => {
    edge(false);
    if (!pool) return;
    await q(`delete from alerta_kds where tenant_id = any($1::uuid[])`, [[T, T2]]).catch(() => undefined);
    await q(`delete from unidade where tenant_id = any($1::uuid[])`, [[T, T2]]).catch(() => undefined);
    await q(`delete from empresa where id = any($1::uuid[])`, [[T, T2]]).catch(() => undefined);
    await q(`drop schema ${ESQ} cascade`).catch(() => undefined);
    await pool.end();
  });

  beforeEach(() => {
    limpar();
    edge(false);
  });

  it('todo aviso vira linha e vai às telas com o id dela; o repetido do Farol não aparece de novo', async () => {
    await svc.aoAvisoDoSistema({ tenantId: T, unidadeId: U1, titulo: 'Ponto de pedido: Pão', detalhe: 'Abaixo do mínimo', prioridade: 'media', tipo: 'estoque' });
    const [m] = mostrados();
    expect(m.dado).toMatchObject({ tenantId: T, unidadeId: U1, titulo: 'Ponto de pedido: Pão', prioridade: 'alta', tipo: 'estoque', origem: 'Estoque', fica: false });
    const [linha] = await q(`select * from alerta_kds where id = $1`, [m.dado.id]);
    expect(linha).toMatchObject({ tenant_id: T, unidade_id: U1, tipo: 'estoque', lado: 'nuvem', entregar_na_loja: false, ciente_em: null });

    limpar();
    const id = randomUUID();
    const a = await svc.guardarEMostrar({ tenantId: T, unidadeId: U1, id, titulo: 'X', naLoja: true }, { soNovo: true });
    const b = await svc.guardarEMostrar({ tenantId: T, unidadeId: U1, id, titulo: 'X', naLoja: true }, { soNovo: true });
    expect([a.situacao, b.situacao]).toEqual(['novo', 'repetido']);
    expect(mostrados()).toHaveLength(1);
    expect((await q(`select entregar_na_loja from alerta_kds where id = $1`, [id]))[0].entregar_na_loja).toBe(true);
  });

  it('"Ciente": grava quem e quando uma vez, avisa as outras telas; o segundo toque responde quem deu primeiro', async () => {
    const { aviso } = await svc.guardarEMostrar({ tenantId: T, unidadeId: U1, titulo: 'Trocar o óleo', fica: true, prioridade: 'danger' });
    limpar();
    const KDS = randomUUID();
    const r1 = await svc.ciente(T, aviso.id, { id: randomUUID(), nome: 'Ana Souza' }, KDS);
    expect(r1).toMatchObject({ ok: true, por: 'Ana Souza', jaEstava: false });
    expect(emitidos).toEqual([{ nome: 'kds.alerta.ciente', dado: { tenantId: T, unidadeId: U1, id: aviso.id, por: 'Ana Souza' } }]);
    const r2 = await svc.ciente(T, aviso.id, { id: randomUUID(), nome: 'Bruno Lima' });
    expect(r2).toMatchObject({ ok: true, por: 'Ana Souza', jaEstava: true });
    expect(emitidos).toHaveLength(1);
    const [l] = await q(`select ciente_por_nome, ciente_kds_id from alerta_kds where id = $1`, [aviso.id]);
    expect(l).toEqual({ ciente_por_nome: 'Ana Souza', ciente_kds_id: KDS });
    await expect(svc.ciente(T2, aviso.id, { nome: 'Outra empresa' })).rejects.toThrow('Aviso não encontrado.');
    await expect(svc.ciente(T, 'nao-e-id', { nome: 'X' })).rejects.toThrow('Aviso não encontrado.');
  });

  it('a tela recarregada recupera o urgente sem "Ciente": 12 h, a loja dela (e a empresa inteira), o lado dela', async () => {
    const id = async (o: any) => (await svc.guardarEMostrar({ tenantId: T, titulo: 'p', ...o })).aviso.id;
    const fica = await id({ unidadeId: U1, fica: true, titulo: 'fica U1' });
    const daEmpresa = await id({ unidadeId: null, fica: true, titulo: 'fica empresa' });
    await id({ unidadeId: U1, fica: false, titulo: 'corre' });
    await id({ unidadeId: U2, fica: true, titulo: 'fica U2' });
    const velho = await id({ unidadeId: U1, fica: true, titulo: 'velho' });
    await q(`update alerta_kds set criado_em = now() - interval '13 hours' where id = $1`, [velho]);
    const visto = await id({ unidadeId: U1, fica: true, titulo: 'visto' });
    await svc.ciente(T, visto, { nome: 'Ana' });
    const titulos = (await svc.pendentes(T, U1)).map((a) => a.titulo);
    expect(titulos).toEqual(expect.arrayContaining(['fica U1', 'fica empresa']));
    expect(titulos).not.toEqual(expect.arrayContaining(['corre']));
    expect(titulos.filter((t) => ['fica U2', 'velho', 'visto', 'corre'].includes(t))).toEqual([]);
    expect((await svc.pendentes(T, U1)).find((a) => a.id === fica)).toMatchObject({ fica: true, tipo: 'loja' });
    expect(daEmpresa).toBeTruthy();

    // No servidor da loja: o que nasceu na nuvem não é desta tela, menos o marcado para a loja.
    const doLado = await id({ unidadeId: U1, fica: true, titulo: 'da nuvem, para a loja', naLoja: true });
    edge(true);
    const naLoja = await id({ unidadeId: U1, fica: true, titulo: 'nasceu na loja' });
    const naLojaTitulos = (await svc.pendentes(T, U1)).map((a) => a.titulo);
    expect(naLojaTitulos).toEqual(expect.arrayContaining(['da nuvem, para a loja', 'nasceu na loja']));
    expect(naLojaTitulos).not.toContain('fica U1');
    edge(false);
    // e na nuvem, o que nasceu na loja não é desta tela
    expect((await svc.pendentes(T, U1)).map((a) => a.id)).not.toContain(naLoja);
    expect(doLado).toBeTruthy();
  });

  it('o histórico: o que foi às telas, com o "Ciente"; as horas ficam entre 1 e os 90 dias', async () => {
    const { aviso } = await svc.guardarEMostrar({ tenantId: T, unidadeId: U2, titulo: 'Contagem: câmara fria', tipo: 'gestao', fica: true });
    await svc.ciente(T, aviso.id, { nome: 'Bruno Lima' });
    const h = await svc.historico(T, U2);
    expect(h.horas).toBe(24);
    expect(h.avisos.find((a: any) => a.id === aviso.id)).toMatchObject({ tipo: 'gestao', origem: 'Gestão', ciente: { por: 'Bruno Lima' } });
    expect((await svc.historico(T, U2, '0')).horas).toBe(24);
    expect((await svc.historico(T, U2, 99999)).horas).toBe(90 * 24);
  });

  it('servidor da loja: o aviso da nuvem marcado para a loja vai às telas UMA vez, quando desce (até 3 min)', async () => {
    const novo = randomUUID();
    const velho = randomUUID();
    const semMarca = randomUUID();
    const visto = randomUUID();
    const linha = (id: string, extra = '') =>
      q(`insert into alerta_kds (id, tenant_id, unidade_id, tipo, titulo, lado, entregar_na_loja ${extra ? ', ' + extra.split('=')[0] : ''})
         values ($1, $2, $3, 'farol', 'Farol — teste', 'nuvem', $4 ${extra ? ', ' + extra.split('=')[1] : ''})`, [id, T, U1, id !== semMarca]);
    await linha(novo);
    await linha(velho, `criado_em=now() - interval '5 minutes'`);
    await linha(semMarca);
    await linha(visto, `ciente_em=now()`);
    await svc.mostrarOsQueDesceram(); // na nuvem não roda
    expect(mostrados()).toHaveLength(0);
    edge(true);
    await svc.mostrarOsQueDesceram();
    const primeira = mostrados().map((m) => m.dado.id);
    expect(primeira).toContain(novo);
    expect(primeira.filter((id) => [velho, semMarca, visto].includes(id))).toEqual([]);
    expect(mostrados().find((m) => m.dado.id === novo)!.dado).toMatchObject({ tenantId: T, unidadeId: U1, tipo: 'farol' });
    await svc.mostrarOsQueDesceram(); // a segunda volta não repete nada
    expect(mostrados()).toHaveLength(primeira.length);
  });

  it('guardados por 90 dias', async () => {
    const [a, b] = [randomUUID(), randomUUID()];
    await q(`insert into alerta_kds (id, tenant_id, titulo, criado_em) values ($1,$3,'velho', now() - interval '91 days'), ($2,$3,'fica', now() - interval '89 days')`, [a, b, T]);
    await svc.limpar();
    expect((await q(`select id from alerta_kds where id = any($1::uuid[])`, [[a, b]])).map((r) => r.id)).toEqual([b]);
  });

  describe('o transporte do Farol', () => {
    const base = envios.find((e) => e.motivo === 'evento');
    const TOKEN = randomUUID();

    it('só a loja VIVA e LIGADA ao Farol recebe (a régua da porta); o reenvio não repete na tela', async () => {
      const e1 = envioPara(base, U1);
      expect(await farol.entregar(e1)).toEqual({ entregue: false, erro: 'esta loja do Regem não existe mais ou não está ligada ao Farol' });
      // a ligação do Farol com a loja 1 (como a autorização da loja grava)
      await q(`insert into integracao_token_loja (id, tenant_id, unidade_id, cliente) values ($1,$2,$3,'farol')`, [TOKEN, T, U1]);
      limpar();
      expect(await farol.entregar(e1)).toEqual({ entregue: true });
      const id = uuidDeChave('farol-envio:', e1.id);
      const [l] = await q(`select * from alerta_kds where id = $1`, [id]);
      expect(l).toMatchObject({ tenant_id: T, unidade_id: U1, tipo: 'farol', prioridade: 'danger', fica: true, lado: 'nuvem', entregar_na_loja: true, ref: `farol:${e1.id}` });
      expect(l.titulo).toBe('Farol — Touca na cozinha (Chapa › Bancada)');
      expect(mostrados()).toHaveLength(1);
      // o Farol manda de novo (o resultado se perdeu): entregue, sem aparecer outra vez
      expect(await farol.entregar(e1)).toEqual({ entregue: true });
      expect(mostrados()).toHaveLength(1);
      // a loja 2 da mesma empresa não está ligada (a ligação é da loja 1); a loja de outra empresa, nem a fechada
      for (const loja of [U2, U3, U_APAGADA]) expect(await farol.entregar(envioPara(base, loja))).toMatchObject({ entregue: false });
      // a ligação da EMPRESA (sem loja) vale para todas as lojas vivas dela
      const daEmpresa = randomUUID();
      await q(`insert into integracao_token_loja (id, tenant_id, unidade_id, cliente) values ($1,$2,null,'farol')`, [daEmpresa, T]);
      expect(await farol.entregar(envioPara(base, U2))).toEqual({ entregue: true });
      expect(await farol.entregar(envioPara(base, U_APAGADA))).toMatchObject({ entregue: false });
      await q(`delete from integracao_token_loja where id = $1`, [daEmpresa]);
      // revogada, vencida, de outro cliente, ou a ligação (Hub DMS) revogada: não entra
      await q(`update integracao_token_loja set revogado_em = now() where id = $1`, [TOKEN]);
      expect(await farol.entregar(envioPara(base, U1))).toMatchObject({ entregue: false });
      await q(`update integracao_token_loja set revogado_em = null, expira_em = now() - interval '1 minute' where id = $1`, [TOKEN]);
      expect(await farol.entregar(envioPara(base, U1))).toMatchObject({ entregue: false });
      await q(`update integracao_token_loja set expira_em = null, cliente = 'liame' where id = $1`, [TOKEN]);
      expect(await farol.entregar(envioPara(base, U1))).toMatchObject({ entregue: false });
      await q(`update integracao_token_loja set cliente = 'farol' where id = $1`, [TOKEN]);
      await q(`insert into integracao_ligacao (id, tenant_id, revogado_em) values ($1,$2, now())`, [TOKEN, T]);
      expect(await farol.entregar(envioPara(base, U1))).toMatchObject({ entregue: false });
      await q(`delete from integracao_ligacao where id = $1`, [TOKEN]);
      expect(await farol.entregar(envioPara(base, U1))).toEqual({ entregue: true });
      // sem o alerta montado (Farol antigo): o motivo volta ao Farol
      expect(await farol.entregar({ ...envioPara(base, U1), alerta: undefined })).toMatchObject({ entregue: false, erro: expect.stringMatching(/sem o alerta/) });
    });

    it('uma volta: busca os envios de KDS, guarda e devolve o resultado de cada um; a credencial recusada espera', async () => {
      const antes = { url: process.env.FAROL_ALERTAS_URL, token: process.env.FAROL_ALERTAS_TOKEN };
      const chamadas: { url: string; corpo: any; auth: string | null }[] = [];
      const lote = [envioPara(base, U1), envioPara(envios[0], U1), envioPara(base, U3)];
      let status = 200;
      const espiao = jest.spyOn(global, 'fetch').mockImplementation(async (url: any, init: any) => {
        chamadas.push({ url: String(url), corpo: JSON.parse(init?.body ?? '{}'), auth: init?.headers?.Authorization ?? null });
        if (status !== 200) return new Response('{}', { status });
        if (String(url).endsWith('/reivindicar')) return new Response(JSON.stringify({ envios: lote }), { status: 200 });
        return new Response('{"ok":true}', { status: 200 });
      });
      try {
        delete process.env.FAROL_ALERTAS_URL;
        expect(await farol.umaVolta()).toBeNull(); // desligado: nem chama
        expect(chamadas).toHaveLength(0);
        process.env.FAROL_ALERTAS_URL = 'https://farol.teste/';
        process.env.FAROL_ALERTAS_TOKEN = 'fart_teste';
        expect(await farol.umaVolta()).toEqual({ levados: 3, entregues: 2, recusados: 1 });
        expect(chamadas[0]).toEqual({ url: 'https://farol.teste/v1/envios/reivindicar', corpo: { limite: 20, tipos: ['kds'] }, auth: 'Bearer fart_teste' });
        expect(chamadas.slice(1).map((c) => [c.url.replace('https://farol.teste/v1/envios/', ''), c.corpo])).toEqual([
          [`${lote[0].id}/resultado`, { entregue: true }],
          [`${lote[1].id}/resultado`, { entregue: true }],
          [`${lote[2].id}/resultado`, { entregue: false, erro: 'esta loja do Regem não existe mais ou não está ligada ao Farol' }],
        ]);
        // a credencial recusada: nada é levado, e o tick espera antes de tentar de novo
        status = 401;
        chamadas.length = 0;
        expect(await farol.umaVolta()).toBeNull();
        await farol.tick();
        expect(chamadas).toHaveLength(1);
      } finally {
        espiao.mockRestore();
        if (antes.url === undefined) delete process.env.FAROL_ALERTAS_URL;
        else process.env.FAROL_ALERTAS_URL = antes.url;
        if (antes.token === undefined) delete process.env.FAROL_ALERTAS_TOKEN;
        else process.env.FAROL_ALERTAS_TOKEN = antes.token;
      }
    });
  });
});
