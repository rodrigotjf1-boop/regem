import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EquipamentoService, USO_GRAVAR_A_CADA_MS } from './equipamento.service';
import { PresencaService } from './presenca.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONEXÃO PC ↔ SERVIDOR, parte 1 — a lista de Equipamentos com a PRESENÇA de cada PC, contra o Postgres.
// 18/10/2026: o terminal "Pdv delivery" aparecia como "nunca usado" (o último uso só marca operação de
// caixa) e o dono o revogou com o PC ligado. Agora:
//  • no servidor da loja, a lista leva a presença da memória (o app aberto avisa a cada 30 s; a
//    estação, na batida) — com o IP do PC e o endereço que ele usa (regem.local ou um IP);
//  • na nuvem, a presença vem do resumo que o servidor manda na saúde da batida (só batida recente);
//  • o "último uso" é regravado no máximo a cada 5 min (antes: a cada requisição do caixa).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('presenca-lista.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('Equipamentos: quem está conectado agora (Postgres real)', () => {
  let pool: Pool;
  let db: any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const LOJA = randomUUID();
  const modoAntes = process.env.EDGE_MODE;
  const auditoria = { registrar: async () => undefined } as any;

  const equip = async (tipo: string, nome: string, extra: Record<string, any> = {}) => {
    const cols = { id: randomUUID(), tenant_id: T, unidade_id: LOJA, tipo, nome, token: 'tok-' + randomUUID(), ...extra };
    const nomes = Object.keys(cols);
    await q(`insert into equipamento (${nomes.join(',')}) values (${nomes.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(cols));
    return cols.id as string;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    await q(`insert into empresa (id, nome) values ($1, 'teste presença')`, [T]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1, $2, 'Loja')`, [LOJA, T]);
  });
  afterAll(async () => {
    if (modoAntes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = modoAntes;
    if (!pool) return;
    await q('delete from edge_status where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from unidade where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it('servidor da loja: o terminal com o app aberto e a estação aparecem conectados, com o IP e o endereço', async () => {
    process.env.EDGE_MODE = 'true';
    const presenca = new PresencaService(db);
    const svc = new EquipamentoService(db, auditoria, presenca);
    const pdv = await equip('pdv', 'Pdv delivery');
    const parado = await equip('pdv', 'PDV1');
    const est = await equip('estacao_impressao', 'estacao delivery');
    const imp = await equip('impressora', 'Caixa delivery', { estacao_id: est, papel: 'cupom' });
    presenca.notar({ id: pdv, tenantId: T, tipo: 'pdv', ip: '192.168.0.23', endereco: 'regem.local', maquina: null, versao: null });
    presenca.notar({ id: est, tenantId: T, tipo: 'estacao_impressao', ip: '192.168.0.23', endereco: 'regem.local', maquina: 'CX-DELIVERY', versao: '1.30.4' });
    const lista = await svc.listar(T);
    const de = (id: string) => lista.find((e: any) => e.id === id);
    expect(de(pdv).presenca).toMatchObject({ ip: '192.168.0.23', endereco: 'regem.local', maquina: null });
    expect(Date.now() - Date.parse(de(pdv).presenca.vistoEm)).toBeLessThan(5_000);
    expect(de(est).presenca).toMatchObject({ ip: '192.168.0.23', endereco: 'regem.local', maquina: 'CX-DELIVERY', versao: '1.30.4' });
    expect(de(parado).presenca).toBeNull(); // nunca avisou: sem presença (a tela diz "sem sinal agora")
    expect('presenca' in de(imp)).toBe(false); // impressora não tem presença própria: é a da estação dela
    await q('delete from equipamento where tenant_id = $1', [T]);
  });

  it('nuvem: a presença vem da saúde da batida do servidor — só a de batida recente e só PC na janela', async () => {
    process.env.EDGE_MODE = 'false';
    const svc = new EquipamentoService(db, auditoria); // na nuvem não há presença em memória
    const srv = await equip('servidor_local', 'Servidor loja teste');
    const pdv = await equip('pdv', 'Pdv delivery');
    const est = await equip('estacao_impressao', 'estacao delivery');
    const agora = Date.now();
    const saude = {
      presenca: {
        em: new Date(agora).toISOString(),
        pcs: [
          { id: pdv, tipo: 'pdv', ip: '192.168.0.23', endereco: 'regem.local', vistoEm: new Date(agora - 20_000).toISOString() },
          { id: est, tipo: 'estacao_impressao', ip: '192.168.0.23', endereco: 'regem.local', maquina: 'CX-DELIVERY', vistoEm: new Date(agora - 20 * 60_000).toISOString() },
        ],
      },
    };
    await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, estado, saude, recebido_em) values ($1,$2,$3,'1.30.6','sync_ok',$4::jsonb, now())`, [srv, T, LOJA, JSON.stringify(saude)]);
    let lista = await svc.listar(T);
    const de = (id: string) => lista.find((e: any) => e.id === id);
    expect(de(pdv).presenca).toMatchObject({ ip: '192.168.0.23', endereco: 'regem.local' });
    expect(de(est).presenca).toBeNull(); // visto há 20 min: fora da janela de 10 min
    // Batida velha (servidor sem sinal há 30 min): a presença dela não vale mais.
    await q(`update edge_status set recebido_em = now() - interval '30 minutes' where equipamento_id = $1`, [srv]);
    lista = await svc.listar(T);
    expect(de(pdv).presenca).toBeNull();
    await q('delete from edge_status where tenant_id = $1', [T]);
    await q('delete from equipamento where tenant_id = $1', [T]);
  });

  it('o "último uso" do terminal é regravado no máximo a cada 5 min', async () => {
    process.env.EDGE_MODE = 'true';
    const svc = new EquipamentoService(db, auditoria);
    const segredo = 'segredo-do-pc';
    const hash = createHash('sha256').update(segredo).digest('hex');
    const id = await equip('pdv', 'PDV1', { segredo_hash: hash, ultimo_uso_em: null });
    const usado = async () => {
      const v = (await q('select ultimo_uso_em from equipamento where id = $1', [id]))[0].ultimo_uso_em;
      return v ? new Date(v) : null; // o driver pode devolver texto ou data, conforme o parser de tipos ativo
    };
    expect(await svc.validarSegredo(T, id, segredo)).toBeTruthy();
    const primeiro = await usado();
    expect(primeiro).not.toBeNull(); // nunca usado: grava
    await q(`update equipamento set ultimo_uso_em = now() - interval '1 minute' where id = $1`, [id]);
    const recente = await usado();
    expect(await svc.validarSegredo(T, id, segredo)).toBeTruthy();
    expect((await usado())?.getTime()).toBe(recente?.getTime()); // há 1 min: não regrava
    await q(`update equipamento set ultimo_uso_em = now() - make_interval(secs => $2) where id = $1`, [id, USO_GRAVAR_A_CADA_MS / 1000 + 60]);
    expect(await svc.validarSegredo(T, id, segredo)).toBeTruthy();
    expect(Date.now() - (await usado())!.getTime()).toBeLessThan(10_000); // passou de 5 min: regrava
    expect(await svc.validarSegredo(T, id, 'errado')).toBeNull(); // segredo errado continua recusado
    await q('delete from equipamento where tenant_id = $1', [T]);
  });
});
