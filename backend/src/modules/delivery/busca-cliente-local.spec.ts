import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// BUSCA DO CLIENTE POR TELEFONE NO SERVIDOR LOCAL (mig 276).
//
// O defeito: a tela "Novo pedido" do Delivery chama a busca por telefone, mas o módulo de
// clientes só existe na NUVEM. No servidor local a rota respondia 404, o front engolia o
// erro em silêncio e o atendente redigitava nome e endereço a cada pedido de um cliente
// conhecido — inclusive com a loja operando normalmente, só sem internet.
//
// Agora a busca vive no módulo do Delivery (que roda nos dois lados) e lê `cliente` e
// `cliente_endereco`, que passaram a sincronizar. Estes testes rodam contra o Postgres
// real porque o que se quer provar é a consulta, não o roteamento.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('busca-cliente-local.spec: sem TEST_PG_URL — PULADO');

descrever('busca de cliente por telefone (servidor local)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  let servico: DeliveryService;
  let tenant = '';
  let clienteId = '';

  beforeAll(async () => {
    const e = await pool.query(`insert into empresa (nome) values ('Teste busca') returning id`);
    tenant = e.rows[0].id;
    const c = await pool.query(
      `insert into cliente (tenant_id, telefone, nome) values ($1,'21999998888','Ana Recorrente') returning id`,
      [tenant],
    );
    clienteId = c.rows[0].id;
    // Dois endereços: o principal tem de vir primeiro.
    await pool.query(
      `insert into cliente_endereco (tenant_id, cliente_id, apelido, logradouro, numero, bairro, principal)
       values ($1,$2,'Trabalho','Rua B','200','Centro',false)`,
      [tenant, clienteId],
    );
    await pool.query(
      `insert into cliente_endereco (tenant_id, cliente_id, apelido, logradouro, numero, bairro, principal)
       values ($1,$2,'Casa','Rua A','100','Tijuca',true)`,
      [tenant, clienteId],
    );
    // O serviço tem muitas dependências; aqui só a consulta importa.
    // Mesma montagem do ingest-concorrencia.spec: o que importa aqui e a consulta.
    servico = new DeliveryService(db as any, {} as any, {} as any, {} as any, {} as any, { emit: () => undefined } as any, { flashPedidos: () => {} } as any);
  });

  afterAll(async () => {
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  it('acha o cliente pelo telefone e traz os endereços salvos', async () => {
    const r: any = await servico.buscarClientePorTelefone(tenant, '(21) 99999-8888');
    expect(r?.cliente?.nome).toBe('Ana Recorrente');
    expect(r.enderecos).toHaveLength(2);
    expect(r.enderecos[0].apelido).toBe('Casa'); // o principal primeiro
  }, 60000);

  it('telefone de outra empresa não aparece (multi-loja)', async () => {
    const outra = await pool.query(`insert into empresa (nome) values ('Outra') returning id`);
    const r = await servico.buscarClientePorTelefone(outra.rows[0].id, '21999998888');
    expect(r).toBeNull();
    await pool.query('delete from empresa where id = $1', [outra.rows[0].id]);
  }, 60000);

  it('telefone curto não consulta o banco (evita varrer a base por engano)', async () => {
    expect(await servico.buscarClientePorTelefone(tenant, '219')).toBeNull();
  });

  it('quem não existe devolve nulo, e não erro', async () => {
    expect(await servico.buscarClientePorTelefone(tenant, randomUUID().slice(0, 11))).toBeNull();
  }, 60000);
});
