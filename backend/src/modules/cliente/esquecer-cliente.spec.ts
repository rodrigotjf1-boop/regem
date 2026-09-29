import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { HORAS_PEDIDO_EM_ANDAMENTO, PedidoEmAndamentoError, esquecerCliente } from './esquecer-cliente';
import { SyncService } from '../sync/sync.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "ESQUECER" (LGPD) LIMPA O PEDIDO — A10 da trilha C.
//
// O defeito: o cliente do cardápio pedia para excluir a conta, o cadastro sumia, mas nome,
// telefone(s) e endereço continuavam em cada pedido dele (e no payload cru do canal). Aqui se
// prova, contra o Postgres real: o que sai, o que FICA por obrigação fiscal (a NFC-e e o CPF da
// nota), a trava do pedido em andamento (inclusive na corrida com um pedido que chega junto) e
// o sincronismo — a limpeza desce para o servidor da loja e um envio atrasado da loja não a
// desfaz.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('esquecer-cliente.spec: sem TEST_PG_URL — PULADO');

const CPF = '52998224725'; // CPF de teste (dígitos verificadores válidos)
const XML_NOTA = `<NFe><infNFe><dest><CPF>${CPF}</CPF><xNome>Maria Titular</xNome></dest></infNFe></NFe>`;

descrever('esquecer o cliente apaga os dados pessoais dos pedidos dele', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const empresas: string[] = [];

  afterAll(async () => {
    for (const t of empresas) await pool.query('delete from empresa where id = $1', [t]);
    await pool.end();
  }, 60000);

  async function empresa(nome: string) {
    const e = await pool.query(`insert into empresa (nome) values ($1) returning id`, [nome]);
    empresas.push(e.rows[0].id);
    const u = await pool.query(`insert into unidade (tenant_id, nome) values ($1, 'Loja') returning id`, [
      e.rows[0].id,
    ]);
    return { tenant: e.rows[0].id as string, loja: u.rows[0].id as string };
  }

  async function novoCliente(tenant: string, telefone: string, nome: string) {
    const c = await pool.query(
      `insert into cliente (tenant_id, telefone, nome, cpf) values ($1, $2, $3, $4) returning id`,
      [tenant, telefone, nome, CPF],
    );
    return c.rows[0].id as string;
  }

  // Pedido com TODOS os dados pessoais que o banco guarda no pedido.
  async function pedido(
    tenant: string,
    loja: string,
    clienteId: string | null,
    status: string,
    criadoHa: string,
    extra: { agendamentoEm?: string; comandaId?: string; telefone?: string; nome?: string } = {},
  ) {
    const r = await pool.query(
      `insert into pedido_externo
         (tenant_id, unidade_id, canal, status, total, valor_bruto, cliente_id, cliente_nome,
          cliente_telefone, cliente_telefone2, endereco, endereco_rua, endereco_numero,
          endereco_referencia, endereco_bairro, endereco_cidade, endereco_municipio_ibge,
          endereco_uf, endereco_cep, documento_cliente, raw, comanda_id, criado_em, agendamento,
          updated_at)
       values ($1, $2, 'cardapio', $3, 42.5, 42.5, $4, $10::text, $5, '21977776666',
               'Rua das Flores, 10 - Tijuca', 'Rua das Flores', '10', 'apto 101', 'Tijuca',
               'Rio de Janeiro', 3304557, 'RJ', '20511000', $6,
               jsonb_build_object('cliente', $10::text, 'clienteTelefone', $5::text,
                                  'endereco', 'Rua das Flores, 10', 'total', 42.5),
               $7, now() - $8::interval, $9::timestamptz, now() - $8::interval)
       returning id`,
      [
        tenant, loja, status, clienteId, extra.telefone ?? '21988887777', CPF,
        extra.comandaId ?? null, criadoHa, extra.agendamentoEm ?? null, extra.nome ?? 'Maria Titular',
      ],
    );
    return r.rows[0].id as string;
  }

  const linha = async (id: string) =>
    (await pool.query('select * from pedido_externo where id = $1', [id])).rows[0];

  const PESSOAIS = [
    'cliente_nome', 'cliente_telefone', 'cliente_telefone2', 'endereco', 'endereco_rua',
    'endereco_numero', 'endereco_referencia', 'endereco_bairro', 'endereco_cidade',
    'endereco_municipio_ibge', 'endereco_uf', 'endereco_cep', 'raw', 'cliente_id',
  ];

  it('tira nome, telefones, endereço e o payload do canal; a NFC-e e o CPF da nota ficam', async () => {
    const { tenant, loja } = await empresa('Teste esquecer');
    const x = await novoCliente(tenant, '21988887777', 'Maria Titular');
    await pool.query(
      `insert into cliente_endereco (tenant_id, cliente_id, logradouro, numero, bairro)
       values ($1, $2, 'Rua das Flores', '10', 'Tijuca')`,
      [tenant, x],
    );
    const cmd = await pool.query(
      `insert into comanda (tenant_id, unidade_id, status, total, cliente, cpf, fechada_em)
       values ($1, $2, 'fechada', 42.5, 'Maria Titular', $3, now() - interval '200 days') returning id`,
      [tenant, loja, CPF],
    );
    await pool.query(
      `insert into nota_fiscal (tenant_id, unidade_id, comanda_id, serie, numero, status, xml, valor_total)
       values ($1, $2, $3, 1, 77, 'autorizada', $4, 42.5)`,
      [tenant, loja, cmd.rows[0].id, XML_NOTA],
    );
    const antigo = await pedido(tenant, loja, x, 'concluido', '200 days', { comandaId: cmd.rows[0].id });
    const cancelado = await pedido(tenant, loja, x, 'cancelado', '2 hours');
    // Aberto há 3 dias: pendência esquecida no quadro, não "em andamento" — não segura nada.
    const esquecidoNoQuadro = await pedido(tenant, loja, x, 'despachado', '3 days');
    // Outro cliente da mesma loja e o mesmo telefone em OUTRA empresa: intocados.
    const y = await novoCliente(tenant, '21955554444', 'Outra Pessoa');
    const deY = await pedido(tenant, loja, y, 'concluido', '1 day', {
      telefone: '21955554444',
      nome: 'Outra Pessoa',
    });
    const outra = await empresa('Outra empresa');
    const xOutra = await novoCliente(outra.tenant, '21988887777', 'Maria Titular');
    const daOutra = await pedido(outra.tenant, outra.loja, xOutra, 'concluido', '1 day');
    const antes = await linha(antigo);

    const r = await esquecerCliente(db, tenant, x);
    expect(r).toEqual({ pedidosAnonimizados: 3, clienteApagado: true });

    for (const id of [antigo, cancelado, esquecidoNoQuadro]) {
      const p = await linha(id);
      for (const c of PESSOAIS) expect({ [c]: p[c] }).toEqual({ [c]: null });
      // O que é da venda e o que a lei manda guardar continua.
      expect(p.documento_cliente).toBe(CPF);
      expect(Number(p.total)).toBe(42.5);
      expect(Number(p.valor_bruto)).toBe(42.5);
    }
    expect((await linha(antigo)).status).toBe('concluido');
    // Carimbo novo: é por ele que a linha limpa desce de novo e vence a cópia da loja.
    expect(new Date((await linha(antigo)).updated_at).getTime()).toBeGreaterThan(
      new Date(antes.updated_at).getTime(),
    );
    // O documento fiscal não é tocado.
    const nota = await pool.query('select xml, status from nota_fiscal where comanda_id = $1', [cmd.rows[0].id]);
    expect(nota.rows[0]).toEqual({ xml: XML_NOTA, status: 'autorizada' });
    // Cadastro e endereços salvos saem; a exclusão fica registrada para descer à loja.
    expect((await pool.query('select 1 from cliente where id = $1', [x])).rowCount).toBe(0);
    expect((await pool.query('select 1 from cliente_endereco where cliente_id = $1', [x])).rowCount).toBe(0);
    const exc = await pool.query(
      `select 1 from sync_exclusao where tenant_id = $1 and tabela = 'cliente' and registro_id = $2`,
      [tenant, x],
    );
    expect(exc.rowCount).toBe(1);
    // Ninguém mais foi tocado.
    expect((await linha(deY)).cliente_nome).toBe('Outra Pessoa');
    expect((await linha(deY)).cliente_telefone).toBe('21955554444');
    expect((await linha(deY)).cliente_id).toBe(y);
    expect((await linha(daOutra)).cliente_telefone).toBe('21988887777');
    expect((await linha(daOutra)).cliente_id).toBe(xOutra);

    // Repetir não quebra (a pessoa clicou duas vezes).
    expect(await esquecerCliente(db, tenant, x)).toEqual({ pedidosAnonimizados: 0, clienteApagado: false });
  }, 60000);

  it('pedido em andamento segura a exclusão e nada muda (entrega de hoje e encomenda agendada)', async () => {
    const { tenant, loja } = await empresa('Teste esquecer andamento');
    const z = await novoCliente(tenant, '21933332222', 'Cliente Z');
    const velho = await pedido(tenant, loja, z, 'concluido', '10 days', {
      telefone: '21933332222',
      nome: 'Cliente Z',
    });
    const hoje = await pedido(tenant, loja, z, 'confirmado', '20 minutes', {
      telefone: '21933332222',
      nome: 'Cliente Z',
    });

    await expect(esquecerCliente(db, tenant, z)).rejects.toBeInstanceOf(PedidoEmAndamentoError);
    // Tudo desfeito: nem o pedido antigo foi anonimizado, nem o cadastro saiu.
    expect((await linha(velho)).cliente_nome).toBe('Cliente Z');
    expect((await linha(velho)).cliente_id).toBe(z);
    expect((await pool.query('select 1 from cliente where id = $1', [z])).rowCount).toBe(1);

    // Entregue: agora pode.
    await pool.query(`update pedido_externo set status = 'concluido' where id = $1`, [hoje]);
    expect((await esquecerCliente(db, tenant, z)).pedidosAnonimizados).toBe(2);

    // Encomenda feita há 5 dias para depois de amanhã: está em andamento.
    const e = await novoCliente(tenant, '21922221111', 'Cliente Encomenda');
    await pedido(tenant, loja, e, 'confirmado', '5 days', {
      telefone: '21922221111',
      agendamentoEm: new Date(Date.now() + 2 * 86400000).toISOString(),
    });
    await expect(esquecerCliente(db, tenant, e)).rejects.toBeInstanceOf(PedidoEmAndamentoError);
    expect(HORAS_PEDIDO_EM_ANDAMENTO).toBe(24);
  }, 60000);

  it('corrida: pedido novo que chega JUNTO com a exclusão não é anonimizado nem fica órfão', async () => {
    const { tenant, loja } = await empresa('Teste esquecer corrida');
    const w = await novoCliente(tenant, '21911110000', 'Cliente W');
    await pedido(tenant, loja, w, 'concluido', '10 days', { telefone: '21911110000' });
    // O ingest ligando um pedido novo a W numa transação ainda aberta (invisível até o commit).
    const outra = await pool.connect();
    try {
      await outra.query('begin');
      await outra.query(
        `insert into pedido_externo (tenant_id, unidade_id, canal, status, cliente_id, cliente_nome, cliente_telefone)
         values ($1, $2, 'cardapio', 'novo', $3, 'Cliente W', '21911110000')`,
        [tenant, loja, w],
      );
      const exclusao = esquecerCliente(db, tenant, w); // espera a trava do cadastro
      await new Promise((r) => setTimeout(r, 300));
      await outra.query('commit');
      await expect(exclusao).rejects.toBeInstanceOf(PedidoEmAndamentoError);
    } finally {
      outra.release();
    }
    const vivo = await pool.query(
      `select cliente_nome from pedido_externo where tenant_id = $1 and status = 'novo'`,
      [tenant],
    );
    expect(vivo.rows[0].cliente_nome).toBe('Cliente W'); // a loja ainda consegue entregar
    expect((await pool.query('select 1 from cliente where id = $1', [w])).rowCount).toBe(1);
  }, 60000);

  describe('servidor da loja (sincronismo)', () => {
    it('a linha limpa DESCE no pull — inclusive o pedido de 200 dias, fora da janela de criação', async () => {
      const { tenant, loja } = await empresa('Teste esquecer pull');
      const x = await novoCliente(tenant, '21988880000', 'Titular Pull');
      const antigo = await pedido(tenant, loja, x, 'concluido', '200 days', { telefone: '21988880000' });
      const copiaDaLoja = await linha(antigo);
      // A loja já tinha sincronizado até aqui.
      const cursor = (await pool.query(`select (now() - interval '1 minute')::text as t`)).rows[0].t;
      await esquecerCliente(db, tenant, x);

      const sync = new SyncService(db);
      const r: any = await sync.pull(tenant, cursor, {
        pedido_externo: `${cursor}|00000000-0000-0000-0000-000000000000`,
        sync_exclusao: `${cursor}|00000000-0000-0000-0000-000000000000`,
      });
      const desceu = (r.tabelas.pedido_externo ?? []).find((p: any) => p.id === antigo);
      expect(desceu).toBeTruthy();
      expect(desceu.cliente_nome).toBeNull();
      expect(desceu.cliente_telefone).toBeNull();
      expect(desceu.raw).toBeNull();
      // "A mais nova vence" na loja: o carimbo da nuvem é mais novo que a cópia dela.
      expect(new Date(desceu.updated_at).getTime()).toBeGreaterThan(
        new Date(copiaDaLoja.updated_at).getTime(),
      );
      // E a exclusão do cadastro desce junto (a loja apaga a cópia dela).
      expect(
        (r.tabelas.sync_exclusao ?? []).some((e: any) => e.tabela === 'cliente' && e.registro_id === x),
      ).toBe(true);
    }, 60000);

    it('envio atrasado da loja, com a cópia antiga e MAIS NOVA, não desfaz a limpeza', async () => {
      const { tenant, loja } = await empresa('Teste esquecer push');
      const x = await novoCliente(tenant, '21977770000', 'Titular Push');
      const antigo = await pedido(tenant, loja, x, 'concluido', '30 days', { telefone: '21977770000' });
      // A loja guarda a cópia de antes (com os dados) e a EDITA depois da exclusão na nuvem
      // (ex.: "voltar pedido" antes do próximo pull) — pela "mais nova vence", ela ganharia.
      const pedidoDaLoja = JSON.parse(JSON.stringify(await linha(antigo)));
      const clienteDaLoja = JSON.parse(
        JSON.stringify((await pool.query('select * from cliente where id = $1', [x])).rows[0]),
      );
      await esquecerCliente(db, tenant, x);
      const depois = new Date(Date.now() + 60000).toISOString();
      pedidoDaLoja.updated_at = depois;
      clienteDaLoja.atualizado_em = depois;

      const sync = new SyncService(db);
      const r: any = await sync.push(
        { tenantId: tenant, unidadeId: loja, equipamentoId: randomUUID(), token: 'teste' },
        [
          { tabela: 'cliente', linhas: [clienteDaLoja] },
          { tabela: 'pedido_externo', linhas: [pedidoDaLoja] },
        ] as any,
        {},
      );
      // O cadastro não volta ("exclusão vence") e o pedido é recusado pela chave estrangeira.
      expect(r.resultado.cliente).toEqual({ aplicadas: 0, ignoradas: 1 });
      expect(r.resultado.pedido_externo).toEqual({ aplicadas: 0, ignoradas: 1 });
      const p = await linha(antigo);
      for (const c of PESSOAIS) expect({ [c]: p[c] }).toEqual({ [c]: null });
      expect((await pool.query('select 1 from cliente where id = $1', [x])).rowCount).toBe(0);
    }, 60000);
  });
});
