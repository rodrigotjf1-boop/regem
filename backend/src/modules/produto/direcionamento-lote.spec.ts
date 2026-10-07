import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ProdutoService } from './produto.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// DIRECIONAMENTO EM LOTE — contra o Postgres real (TEST_PG_URL).
//
// "Direcionar marcados" manda N produtos e M destinos num pedido só. O serviço fazia um laço
// (apagar, ler e inserir por produto, sem transação): centenas de idas ao banco e, com uma falha no
// meio, produtos sem destino nenhum. Também aceitava qualquer id — o destino de outra empresa
// entrava na tabela. Agora: uma transação, número fixo de consultas, e só o que é da empresa.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('direcionamento-lote.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('direcionamento do catálogo em lote', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const auditados: any[] = [];
  const svc = new ProdutoService(db, { registrar: async (e: any) => void auditados.push(e) } as any, undefined as any, undefined as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  afterAll(async () => {
    if (empresas.length) {
      await pool.query('delete from produto_destino_producao where tenant_id = any($1::uuid[])', [empresas]);
      await pool.query('delete from produto where tenant_id = any($1::uuid[])', [empresas]);
      await pool.query('delete from equipamento where tenant_id = any($1::uuid[])', [empresas]);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    }
    await pool.end();
  }, 120_000);

  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste direcionamento em lote') returning id`))[0].id as string;
    empresas.push(t);
    return t;
  }
  const produto = async (t: string, nome: string) => (await q(`insert into produto (tenant_id, nome) values ($1, $2) returning id`, [t, nome]))[0].id as string;
  const equip = async (t: string, tipo: string, nome: string) =>
    (await q(`insert into equipamento (tenant_id, tipo, nome, token) values ($1, $2, $3, $4) returning id`, [t, tipo, nome, `tok-${randomUUID()}`]))[0].id as string;
  /** Os destinos gravados de cada produto, em ordem. */
  const destinos = async (t: string) => {
    const linhas = await q(`select produto_id, equipamento_id, tenant_id from produto_destino_producao where tenant_id = $1 order by produto_id, equipamento_id`, [t]);
    const mapa: Record<string, string[]> = {};
    for (const l of linhas) (mapa[l.produto_id] ??= []).push(l.equipamento_id);
    for (const k of Object.keys(mapa)) mapa[k].sort();
    return mapa;
  };
  async function cenario() {
    const t = await empresa();
    const [p1, p2, p3] = [await produto(t, 'Produto um'), await produto(t, 'Produto dois'), await produto(t, 'Produto três')];
    const [kds, imp, imp2] = [await equip(t, 'kds', 'KDS de teste'), await equip(t, 'impressora', 'Impressora de teste'), await equip(t, 'impressora', 'Impressora dois')];
    return { t, p1, p2, p3, kds, imp, imp2 };
  }
  const ordenado = (...ids: string[]) => [...ids].sort();

  it('substituir: os produtos marcados ficam SÓ com os destinos marcados; os outros produtos não mudam', async () => {
    const c = await cenario();
    await svc.setDirecionamentoLote(c.t, [c.p1, c.p2, c.p3], [c.imp2], 'substituir');
    const r = await svc.setDirecionamentoLote(c.t, [c.p1, c.p2], [c.kds, c.imp], 'substituir');
    expect(r).toEqual({ ok: true, produtos: 2, destinos: 2 });
    expect(await destinos(c.t)).toEqual({ [c.p1]: ordenado(c.kds, c.imp), [c.p2]: ordenado(c.kds, c.imp), [c.p3]: [c.imp2] });
  });

  it('substituir não regrava o destino que continua (a linha mantém o id e a data)', async () => {
    const c = await cenario();
    await svc.setDirecionamentoLote(c.t, [c.p1], [c.kds, c.imp], 'substituir');
    const antes = await q(`select id, created_at from produto_destino_producao where produto_id = $1 and equipamento_id = $2`, [c.p1, c.kds]);
    await svc.setDirecionamentoLote(c.t, [c.p1], [c.kds, c.imp2], 'substituir');
    expect(await q(`select id, created_at from produto_destino_producao where produto_id = $1 and equipamento_id = $2`, [c.p1, c.kds])).toEqual(antes);
    expect(await destinos(c.t)).toEqual({ [c.p1]: ordenado(c.kds, c.imp2) });
  });

  it('adicionar: soma aos destinos atuais, sem duplicar o que já existe', async () => {
    const c = await cenario();
    await svc.setDirecionamentoLote(c.t, [c.p1], [c.kds], 'substituir');
    await svc.setDirecionamentoLote(c.t, [c.p1, c.p2], [c.kds, c.imp], 'adicionar');
    await svc.setDirecionamentoLote(c.t, [c.p1, c.p2], [c.kds, c.imp], 'adicionar'); // repetir não duplica nem falha
    expect(await destinos(c.t)).toEqual({ [c.p1]: ordenado(c.kds, c.imp), [c.p2]: ordenado(c.kds, c.imp) });
  });

  it('sem destino marcado: substituir limpa (o produto volta ao padrão do setor); adicionar não mexe', async () => {
    const c = await cenario();
    await svc.setDirecionamentoLote(c.t, [c.p1, c.p2], [c.kds], 'substituir');
    await svc.setDirecionamentoLote(c.t, [c.p1], [], 'adicionar');
    expect(await destinos(c.t)).toEqual({ [c.p1]: [c.kds], [c.p2]: [c.kds] });
    await svc.setDirecionamentoLote(c.t, [c.p1], [], 'substituir');
    expect(await destinos(c.t)).toEqual({ [c.p2]: [c.kds] });
  });

  it('destino de outra empresa (ou que não é KDS/impressora) é recusado e NADA muda', async () => {
    const c = await cenario();
    const outra = await cenario();
    const pdv = await equip(c.t, 'pdv', 'Terminal de teste');
    await svc.setDirecionamentoLote(c.t, [c.p1], [c.kds], 'substituir');
    for (const ruim of [outra.kds, pdv, randomUUID()]) {
      await expect(svc.setDirecionamentoLote(c.t, [c.p1], [c.imp, ruim], 'substituir')).rejects.toThrow('Destino não encontrado');
    }
    await expect(svc.setDirecionamentoLote(c.t, [c.p1], ['não é um id'], 'substituir')).rejects.toThrow('Produto ou destino inválido');
    await expect(svc.setDirecionamentoLote(c.t, [], [c.kds], 'substituir')).rejects.toThrow('Selecione ao menos um produto');
    expect(await destinos(c.t)).toEqual({ [c.p1]: [c.kds] });
    expect(await destinos(outra.t)).toEqual({});
  });

  it('produto de outra empresa no meio da lista é ignorado: não ganha destino nem perde os dele', async () => {
    const c = await cenario();
    const outra = await cenario();
    await svc.setDirecionamentoLote(outra.t, [outra.p1], [outra.kds], 'substituir');
    const r = await svc.setDirecionamentoLote(c.t, [c.p1, outra.p1], [c.kds], 'substituir');
    expect(r.produtos).toBe(1);
    expect(await destinos(c.t)).toEqual({ [c.p1]: [c.kds] });
    expect(await destinos(outra.t)).toEqual({ [outra.p1]: [outra.kds] });
    expect(await q(`select 1 from produto_destino_producao where produto_id = $1 and tenant_id = $2`, [outra.p1, c.t])).toEqual([]);
  });

  it('o número de consultas NÃO cresce com a quantidade de produtos', async () => {
    const c = await cenario();
    const muitos = [c.p1, c.p2, c.p3];
    for (let i = 0; i < 40; i++) muitos.push(await produto(c.t, `Produto em massa ${i}`));
    // Toda consulta — a solta do pool e as de dentro da transação — passa pelo `query` do cliente.
    const contar = async (ids: string[]) => {
      const espia = jest.spyOn(Client.prototype, 'query');
      try {
        await svc.setDirecionamentoLote(c.t, ids, [c.kds, c.imp], 'substituir');
        return espia.mock.calls.length;
      } finally {
        espia.mockRestore();
      }
    };
    const com1 = await contar([c.p1]);
    const com43 = await contar(muitos);
    expect(com43).toBe(com1);
    expect(com1).toBeLessThanOrEqual(6); // destinos + begin + apagar + contar + inserir + commit
    expect(Object.keys(await destinos(c.t))).toHaveLength(43);
  });

  it('registra na auditoria quem direcionou, quantos produtos e para onde', async () => {
    const c = await cenario();
    auditados.length = 0;
    await svc.setDirecionamentoLote(c.t, [c.p1, c.p2], [c.kds], 'adicionar', { id: null, perfil: 'gerente' });
    expect(auditados).toHaveLength(1);
    expect(auditados[0]).toMatchObject({ tenantId: c.t, atorPerfil: 'gerente', acao: 'direcionou_produtos', detalhe: { produtos: 2, modo: 'adicionar', destinos: ['KDS de teste'] } });
  });
});
