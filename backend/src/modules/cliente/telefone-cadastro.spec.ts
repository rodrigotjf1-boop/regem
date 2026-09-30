import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ClienteService } from './cliente.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CARDÁPIO NÃO DUPLICA O CLIENTE PELO 55 (ERR-135), contra o Postgres real.
//
// A entrada de pedidos guarda o telefone sem o 55; o cardápio e o login por código gravavam como
// o cliente digitou — "+55 21 9…" virava um SEGUNDO cadastro. Agora os dois guardam sem o 55 e
// acham também o cadastro que o cardápio gravou COM o 55 antes da correção (sem criar um terceiro).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('telefone-cadastro.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('cardápio e login por código: telefone como o cadastro guarda (ERR-135)', () => {
  let pool: Pool;
  let svc: ClienteService;
  const T = randomUUID();
  const TOKEN = `teste-tel-${randomUUID()}`;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const doTelefone = async (tel: string) =>
    q(`select id, telefone, nome from cliente where tenant_id = $1 and telefone = $2`, [T, tel]);

  const segredoAntes = process.env.CLIENTE_TOKEN_SECRET;
  beforeAll(async () => {
    // O login assina o token do cliente: segredo só deste teste quando o ambiente não tem um.
    if (!process.env.JWT_SECRET && !segredoAntes) process.env.CLIENTE_TOKEN_SECRET = `teste-${randomUUID()}`;
    pool = new Pool({ connectionString: URL_PG });
    svc = new ClienteService(drizzle(pool, { schema }) as any, {} as any, { registrar: async () => {} } as any);
    await q(`insert into empresa (id, nome) values ($1,'teste telefone do cadastro')`, [T]);
    await q(`insert into cardapio_config (tenant_id, token, ativo) values ($1,$2,true)`, [T, TOKEN]);
  });
  afterAll(async () => {
    if (segredoAntes === undefined) delete process.env.CLIENTE_TOKEN_SECRET;
    if (!pool) return;
    await q(`delete from cliente_otp where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from cliente where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from cardapio_config where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });

  it('"+55 (21) 9…" e "21 9…" são o MESMO cadastro, guardado sem o 55', async () => {
    const a = await (svc as any).acharOuCriarCliente(T, '+55 (21) 98888-1111', 'Ana');
    const b = await (svc as any).acharOuCriarCliente(T, '21988881111');
    expect(b.id).toBe(a.id);
    expect(a.telefone).toBe('21988881111');
    expect(await doTelefone('5521988881111')).toHaveLength(0);
  });

  it('acha o cadastro gravado COM o 55 antes da correção — não cria um terceiro', async () => {
    const [antigo] = await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Bruno','5521977772222') returning id`, [T]);
    const c = await (svc as any).acharOuCriarCliente(T, '(21) 97777-2222');
    expect(c.id).toBe(antigo.id);
    expect(await doTelefone('21977772222')).toHaveLength(0);
  });

  it('com as duas formas no banco, fica com a de hoje (sem o 55)', async () => {
    await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Carla antiga','5521966663333')`, [T]);
    const [novo] = await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Carla','21966663333') returning id`, [T]);
    const c = await (svc as any).acharOuCriarCliente(T, '+5521966663333');
    expect(c.id).toBe(novo.id);
  });

  it('DDD 55 (RS) não perde o DDD: "55 9…" de 11 dígitos é número local', async () => {
    const c = await (svc as any).acharOuCriarCliente(T, '55999998888', 'Gaúcha');
    expect(c.telefone).toBe('55999998888');
  });

  it('login por código: o envio e a confirmação usam o mesmo número, e o cadastro nasce sem o 55', async () => {
    await svc.enviarOtp(TOKEN, '+55 21 95555-4444');
    const [otp] = await q(`select telefone from cliente_otp where tenant_id = $1`, [T]);
    expect(otp.telefone).toBe('21955554444');
    // O código real vai por WhatsApp; aqui o teste troca o hash por um código conhecido.
    await q(`update cliente_otp set codigo_hash = $2 where tenant_id = $1`, [
      T,
      createHash('sha256').update('123456').digest('hex'),
    ]);
    await svc.confirmarOtp(TOKEN, { telefone: '5521955554444', codigo: '123456', nome: 'Eva' });
    const eva = await doTelefone('21955554444');
    expect(eva).toHaveLength(1);
    expect(eva[0].nome).toBe('Eva');
    expect(await doTelefone('5521955554444')).toHaveLength(0);
  });
});
