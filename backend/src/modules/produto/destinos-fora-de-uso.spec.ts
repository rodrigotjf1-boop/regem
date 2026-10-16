import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ProdutoService } from './produto.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// DESTINO DE PRODUÇÃO SÓ PARA KDS OU IMPRESSORA EM USO — contra o Postgres real (TEST_PG_URL).
//
// Pedido do dono (16/10/2026): equipamento revogado não pode poluir as configurações. As 5 rotas que
// gravam destino (setor, produto, opção, complemento e o direcionamento em massa) passam pela mesma
// conferência (`common/destino-producao.ts`). Antes: a opção e o complemento aceitavam QUALQUER id
// (PDV, servidor da loja, revogado, de outra empresa); setor e produto aceitavam o revogado e
// apagavam os destinos ANTES de conferir — uma recusa deixava o produto sem destino nenhum.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('destinos-fora-de-uso.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('destino de produção: só KDS ou impressora desta empresa e em uso', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const produtos = new ProdutoService(db, auditoria, undefined as any, undefined as any);
  const producao = new ProducaoPedidoService(db, auditoria, { emit: () => true } as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['produto_destino_producao', 'setor_destino_producao', 'opcao_destino_producao', 'complemento_destino_producao', 'opcao', 'complemento', 'produto', 'setor', 'equipamento', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => undefined);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => undefined);
    }
    await pool.end();
  }, 120_000);

  const equip = async (t: string, tipo: string, nome: string, ativo = true) =>
    (await q(`insert into equipamento (tenant_id, tipo, nome, token, ativo) values ($1, $2, $3, $4, $5) returning id`, [t, tipo, nome, `tok-${randomUUID()}`, ativo]))[0].id as string;
  async function cenario() {
    const t = (await q(`insert into empresa (nome) values ('teste destinos fora de uso') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja') returning id`, [t]))[0].id as string;
    const outra = (await q(`insert into empresa (nome) values ('outra empresa') returning id`))[0].id as string;
    empresas.push(outra);
    return {
      t,
      kds: await equip(t, 'kds', 'KDS Cozinha'),
      imp: await equip(t, 'impressora', 'Impressora Cozinha'),
      revogada: await equip(t, 'impressora', 'Impressora velha', false),
      pdv: await equip(t, 'pdv', 'Caixa 1'),
      servidor: await equip(t, 'servidor_local', 'Servidor antigo', false),
      deOutra: await equip(outra, 'kds', 'KDS de outra empresa'),
      produto: (await q(`insert into produto (tenant_id, nome) values ($1, 'X-burger') returning id`, [t]))[0].id as string,
      setor: (await q(`insert into setor (tenant_id, unidade_id, nome) values ($1, $2, 'Chapa') returning id`, [t, u]))[0].id as string,
      opcao: (await q(`insert into opcao (tenant_id, nome) values ($1, 'Bacon extra') returning id`, [t]))[0].id as string,
      complemento: (await q(`insert into complemento (tenant_id, nome) values ($1, 'Adicionais') returning id`, [t]))[0].id as string,
    };
  }
  const gravados = async (tabela: string, coluna: string, id: string) =>
    (await q(`select equipamento_id from ${tabela} where ${coluna} = $1 order by equipamento_id`, [id])).map((r) => r.equipamento_id);
  const ordem = (...ids: string[]) => [...ids].sort();

  it('opção: aceita KDS e impressora em uso (sem repetir); recusa PDV, servidor da loja, de outra empresa e fora de uso', async () => {
    const c = await cenario();
    await produtos.setOpcaoDestinos(c.t, c.opcao, [c.kds, c.imp, c.kds]);
    expect(await gravados('opcao_destino_producao', 'opcao_id', c.opcao)).toEqual(ordem(c.kds, c.imp));
    for (const ruim of [c.pdv, c.servidor, c.deOutra]) {
      await expect(produtos.setOpcaoDestinos(c.t, c.opcao, [c.kds, ruim])).rejects.toThrow('Destino não encontrado');
    }
    await expect(produtos.setOpcaoDestinos(c.t, c.opcao, [c.revogada])).rejects.toThrow('O destino "Impressora velha" está fora de uso (revogado ou desligado): desmarque-o para salvar.');
    await expect(produtos.setOpcaoDestinos(c.t, c.opcao, ['nao-e-id'])).rejects.toThrow('Destino inválido');
    // A recusa não apagou o que estava gravado.
    expect(await gravados('opcao_destino_producao', 'opcao_id', c.opcao)).toEqual(ordem(c.kds, c.imp));
    // Vazio = herda do produto.
    await produtos.setOpcaoDestinos(c.t, c.opcao, []);
    expect(await gravados('opcao_destino_producao', 'opcao_id', c.opcao)).toEqual([]);
  });

  it('complemento: a mesma conferência', async () => {
    const c = await cenario();
    await produtos.setComplementoDestinos(c.t, c.complemento, [c.imp]);
    await expect(produtos.setComplementoDestinos(c.t, c.complemento, [c.pdv])).rejects.toThrow('Destino não encontrado');
    await expect(produtos.setComplementoDestinos(c.t, c.complemento, [c.imp, c.revogada])).rejects.toThrow('fora de uso');
    expect(await gravados('complemento_destino_producao', 'complemento_id', c.complemento)).toEqual([c.imp]);
  });

  it('produto e setor: recusam o fora de uso pelo nome, e a recusa NÃO apaga os destinos atuais', async () => {
    const c = await cenario();
    await producao.setDestinosProduto(c.t, c.produto, [c.kds, c.imp]);
    await expect(producao.setDestinosProduto(c.t, c.produto, [c.kds, c.revogada])).rejects.toThrow('"Impressora velha" está fora de uso');
    expect(await gravados('produto_destino_producao', 'produto_id', c.produto)).toEqual(ordem(c.kds, c.imp));
    await expect(producao.setDestinosProduto(c.t, c.produto, [c.deOutra])).rejects.toThrow('Destino não encontrado');
    expect(await gravados('produto_destino_producao', 'produto_id', c.produto)).toEqual(ordem(c.kds, c.imp));

    await producao.setDestinosSetor(c.t, c.setor, [c.imp]);
    await expect(producao.setDestinosSetor(c.t, c.setor, [c.pdv])).rejects.toThrow('Destino não encontrado');
    await expect(producao.setDestinosSetor(c.t, c.setor, [c.revogada, c.servidor])).rejects.toThrow('Destino não encontrado');
    expect(await gravados('setor_destino_producao', 'setor_id', c.setor)).toEqual([c.imp]);
    // Repetido na lista grava uma vez.
    await producao.setDestinosSetor(c.t, c.setor, [c.kds, c.kds]);
    expect(await gravados('setor_destino_producao', 'setor_id', c.setor)).toEqual([c.kds]);
  });

  it('direcionamento em massa: recusa o fora de uso pelo nome, sem mexer nos produtos', async () => {
    const c = await cenario();
    await produtos.setDirecionamentoLote(c.t, [c.produto], [c.kds], 'substituir');
    await expect(produtos.setDirecionamentoLote(c.t, [c.produto], [c.imp, c.revogada], 'substituir')).rejects.toThrow('fora de uso');
    expect(await gravados('produto_destino_producao', 'produto_id', c.produto)).toEqual([c.kds]);
  });
});
