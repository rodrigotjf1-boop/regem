import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ProducaoPedidoService } from './producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A Rota da cozinha (auditoria do KDS de 11/11/2026, onda 2 — mig 410): a leitura (a salva ou a ordem pelo "vai para", só os
// KDS de preparo e de despacho da loja, as TVs) e o salvar (a ordem e os nomes na linha da loja + o "vai para" que mudou,
// numa transação, com a conferência antes de gravar, auditado).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('kds-rota-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

descrever('Rota da cozinha (Postgres)', () => {
  let pool: Pool;
  let svc: ProducaoPedidoService;
  const auditado: any[] = [];
  const emitidos: { nome: string; dado: any }[] = [];
  const T = randomUUID();
  const T2 = randomUUID(); // empresa com duas lojas
  const [U, U2, V1, V2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const [CHAPA, MONT, DESP, ENTREGA, DE_U2, TV] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const ATOR = { id: randomUUID(), perfil: 'gerente' };
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const proximo = async (id: string) => (await q(`select proximo_kds_id as p from equipamento where id = $1`, [id]))[0].p;
  // A rota guardada da loja: na linha da EMPRESA, a chave da loja.
  const guardada = async (t: string, loja: string) =>
    (await q(`select rota -> $2::text as r from kds_cor_config where tenant_id = $1 and unidade_id is null`, [t, loja]))[0]?.r ?? null;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new ProducaoPedidoService(
      drizzle(pool, { schema }) as any,
      { registrar: async (a: any) => void auditado.push(a) } as any,
      { emit: (nome: string, dado: any) => emitidos.push({ nome, dado }) } as any,
    );
    await q(`insert into empresa (id, nome) values ($1,'teste rota'), ($2,'duas lojas')`, [T, T2]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$3,'Loja'), ($2,$3,'Outra loja'), ($4,$6,'A'), ($5,$6,'B')`, [U, U2, T, V1, V2, T2]);
    const eq = (id: string, loja: string, nome: string, tipo: string, escopo: string, prox: string | null = null) =>
      q(`insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, escopo, ativo, proximo_kds_id) values ($1,$2,$3,$4,$5,$6,$7,true,$8)`, [
        id, T, loja, nome, 'tok-' + id, tipo, escopo, prox,
      ]);
    await eq(DESP, U, 'Despacho', 'kds', 'despacho');
    await eq(MONT, U, 'Montagem', 'kds', 'producao', DESP);
    await eq(CHAPA, U, 'Chapa', 'kds', 'producao', MONT);
    await eq(ENTREGA, U, 'Balcão de entrega', 'kds', 'entrega');
    await eq(DE_U2, U2, 'Chapa da outra loja', 'kds', 'producao');
    await eq(TV, U, 'TV do balcão', 'tela_senhas', 'producao');
  });

  afterAll(async () => {
    if (!pool) return;
    for (const t of ['kds_cor_config', 'produto_destino_producao', 'produto', 'equipamento', 'unidade'])
      await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [[T, T2]]).catch(() => undefined);
    await q(`delete from empresa where id = any($1::uuid[])`, [[T, T2]]).catch(() => undefined);
    await pool.end();
  });

  it('sem rota salva, a ordem pelo "vai para"; a tela de entrega e o KDS de outra loja ficam de fora; as TVs vêm junto', async () => {
    const r = await svc.rotaDaCozinha(T, U);
    expect(r.etapas).toEqual([
      { nome: '', kds: [CHAPA] },
      { nome: '', kds: [MONT] },
      { nome: '', kds: [DESP] },
    ]);
    expect(r.kds.map((k: any) => k.nome).sort()).toEqual(['Chapa', 'Despacho', 'Montagem']);
    expect(r.tvs).toEqual([{ id: TV, nome: 'TV do balcão' }]);
    expect(r).toMatchObject({ loja: U, editavel: true, motivo: null });
  });

  it('salvar grava a ordem, os nomes e o "vai para" que mudou, numa transação; audita; a leitura volta igual', async () => {
    const etapas = [
      { nome: 'Chapa', kds: [CHAPA] },
      { nome: 'Montagem', kds: [MONT] },
      { nome: 'Saída', kds: [DESP] },
    ];
    const r = await svc.salvarRotaDaCozinha(T, ATOR, U, { etapas, vai: { [CHAPA]: DESP, [MONT]: DESP } });
    expect(r.etapas).toEqual(etapas);
    expect(await proximo(CHAPA)).toBe(DESP);
    expect(await proximo(MONT)).toBe(DESP);
    expect(await guardada(T, U)).toEqual(etapas);
    // Nenhuma linha DA LOJA foi criada: ela venceria as cores da empresa inteira.
    expect(await q(`select 1 from kds_cor_config where tenant_id = $1 and unidade_id is not null`, [T])).toEqual([]);
    expect(auditado.at(-1)).toMatchObject({
      tenantId: T,
      unidadeId: U,
      acao: 'configurou_rota_kds',
      atorId: ATOR.id,
      detalhe: {
        etapas: [{ nome: 'Chapa', kds: ['Chapa'] }, { nome: 'Montagem', kds: ['Montagem'] }, { nome: 'Saída', kds: ['Despacho'] }],
        mudou: [{ kds: 'Chapa', antes: 'Montagem', depois: 'Despacho' }],
      },
    });
    expect(emitidos.some((e) => e.nome === 'kds.telas.mudou')).toBe(true);
    // Paralelo: Chapa e Montagem na mesma etapa, os dois mandando para o Despacho.
    const paralelo = [{ nome: 'Preparo', kds: [CHAPA, MONT] }, { nome: '', kds: [DESP] }];
    expect((await svc.salvarRotaDaCozinha(T, ATOR, U, { etapas: paralelo, vai: { [CHAPA]: DESP, [MONT]: DESP } })).etapas).toEqual(paralelo);
  });

  it('recusa sem gravar nada: despacho no meio, "vai para" para trás, KDS de outra loja ou de entrega', async () => {
    const antes = await guardada(T, U);
    const nAud = auditado.length;
    await expect(
      svc.salvarRotaDaCozinha(T, ATOR, U, { etapas: [{ nome: '', kds: [DESP] }, { nome: '', kds: [CHAPA] }], vai: {} }),
    ).rejects.toThrow(/só pode ficar na última etapa/);
    await expect(
      svc.salvarRotaDaCozinha(T, ATOR, U, { etapas: [{ nome: '', kds: [CHAPA] }, { nome: '', kds: [MONT] }], vai: { [MONT]: CHAPA } }),
    ).rejects.toThrow(/etapa depois da dele/);
    await expect(svc.salvarRotaDaCozinha(T, ATOR, U, { etapas: [{ nome: '', kds: [DE_U2] }], vai: {} })).rejects.toThrow(/não é desta loja/);
    await expect(svc.salvarRotaDaCozinha(T, ATOR, U, { etapas: [{ nome: '', kds: [ENTREGA] }], vai: {} })).rejects.toThrow(/não é desta loja/);
    expect(await guardada(T, U)).toEqual(antes);
    expect(await proximo(CHAPA)).toBe(DESP);
    expect(auditado.length).toBe(nAud);
  });

  it('as cores que a empresa ajustou continuam valendo na loja; a rota de outra loja não apaga a primeira', async () => {
    // A empresa ajustou as cores (linha sem loja): verde até 7, amarelo até 12, sem a etapa "Entregue".
    await q(`update kds_cor_config set verde_ate_min = 7, amarelo_ate_min = 12, usa_entregue = false where tenant_id = $1 and unidade_id is null`, [T]);
    const primeira = await guardada(T, U);
    expect(primeira).not.toBeNull();
    // Salvar a rota da OUTRA loja (só um KDS dela) guarda a chave dela, sem mexer na da primeira.
    await svc.salvarRotaDaCozinha(T, ATOR, U2, { etapas: [{ nome: 'Única', kds: [DE_U2] }], vai: {} });
    expect(await guardada(T, U2)).toEqual([{ nome: 'Única', kds: [DE_U2] }]);
    expect(await guardada(T, U)).toEqual(primeira);
    // As cores da loja seguem as da empresa (nenhuma linha da loja com o padrão por cima).
    expect(await svc.getCores(T, U)).toEqual({ verdeAteMin: 7, amareloAteMin: 12, usaPreparo: true, usaEntregue: false });
    expect(await svc.getCores(T, U2)).toEqual({ verdeAteMin: 7, amareloAteMin: 12, usaPreparo: true, usaEntregue: false });
  });

  it('"Por onde o pedido passa?": o roteamento de verdade — estações, desligado pulado, papel na padrão, modo comum', async () => {
    const IMP = randomUUID();
    await q(
      `insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, escopo, ativo, faz_producao, padrao) values ($1,$2,$3,'Impressora da cozinha',$4,'impressora','producao',true,true,true)`,
      [IMP, T, U, 'tok-' + IMP],
    );
    const prod = async (nome: string, vai = true) =>
      (await q(`insert into produto (tenant_id, nome, vai_para_producao) values ($1,$2,$3) returning id`, [T, nome, vai]))[0].id as string;
    const [XB, BAT, SOB, BEB] = [await prod('X-Burger'), await prod('Batata frita'), await prod('Sundae'), await prod('Água', false)];
    const marca = (p: string, k: string) => q(`insert into produto_destino_producao (tenant_id, produto_id, equipamento_id) values ($1,$2,$3)`, [T, p, k]);
    await marca(XB, CHAPA);
    await marca(BAT, CHAPA);
    await marca(BAT, MONT);

    // A rota diz o modo, a padrão e o produto que sai em dois KDS.
    const r = await svc.rotaDaCozinha(T, U);
    expect(r).toMatchObject({ estacoes: true, padrao: { id: IMP, nome: 'Impressora da cozinha' } });
    expect(r.duplicados).toEqual([{ produto: 'Batata frita', kds: expect.arrayContaining([CHAPA, MONT]) }]);

    // Estações: o X-Burger vai à Chapa e segue o "vai para" (Chapa → Despacho, salvo no teste anterior); o KDS tira o papel.
    expect(await svc.simularRotaDoProduto(T, U, XB)).toEqual({
      produto: { id: XB, nome: 'X-Burger' }, vaiParaProducao: true, estacoes: true,
      caminhos: [{ inicio: CHAPA, passos: [CHAPA, DESP] }], impressoras: [],
    });
    // A Montagem desligada no meio (Chapa → Montagem → Despacho) é pulada.
    await q(`update equipamento set proximo_kds_id = $2 where id = $1`, [CHAPA, MONT]);
    await q(`update equipamento set ativo = false where id = $1`, [MONT]);
    expect((await svc.simularRotaDoProduto(T, U, XB)).caminhos).toEqual([{ inicio: CHAPA, passos: [CHAPA, DESP] }]);
    await q(`update equipamento set ativo = true where id = $1`, [MONT]);
    await q(`update equipamento set proximo_kds_id = $2 where id = $1`, [CHAPA, DESP]);
    // Nenhum KDS marcou o Sundae: sai em papel, na padrão; a Água não vai para a produção.
    expect(await svc.simularRotaDoProduto(T, U, SOB)).toMatchObject({ caminhos: [], impressoras: [{ id: IMP, nome: 'Impressora da cozinha', padrao: true }] });
    expect(await svc.simularRotaDoProduto(T, U, BEB)).toMatchObject({ vaiParaProducao: false, caminhos: [] });

    // Modo comum (nenhum KDS marcou nada): o pedido começa nos KDS ligados que ninguém alimenta (Chapa e Montagem → Despacho).
    await q(`delete from produto_destino_producao where tenant_id = $1`, [T]);
    const comum = await svc.simularRotaDoProduto(T, U, XB);
    expect(comum.estacoes).toBe(false);
    expect([...comum.caminhos].sort((a, b) => a.inicio.localeCompare(b.inicio))).toEqual(
      [{ inicio: CHAPA, passos: [CHAPA, DESP] }, { inicio: MONT, passos: [MONT, DESP] }].sort((a, b) => a.inicio.localeCompare(b.inicio)),
    );
    expect((await svc.rotaDaCozinha(T, U)).duplicados).toEqual([]);
    // Quem recebe de outro KDS não é começo: Chapa → Montagem → Despacho começa só na Chapa.
    await q(`update equipamento set proximo_kds_id = $2 where id = $1`, [CHAPA, MONT]);
    expect((await svc.simularRotaDoProduto(T, U, XB)).caminhos).toEqual([{ inicio: CHAPA, passos: [CHAPA, MONT, DESP] }]);
    await q(`update equipamento set proximo_kds_id = $2 where id = $1`, [CHAPA, DESP]);

    // Produto que não é desta empresa, ou id torto: recusa.
    await expect(svc.simularRotaDoProduto(T2, V1, XB)).rejects.toThrow(/Produto não encontrado/);
    await expect(svc.simularRotaDoProduto(T, U, 'x')).rejects.toThrow(/Escolha um produto/);
  });

  it('empresa com várias lojas e nenhuma escolhida: pede para escolher a loja', async () => {
    await expect(svc.rotaDaCozinha(T2, null)).rejects.toThrow(/Escolha a loja/);
    await expect(svc.salvarRotaDaCozinha(T2, ATOR, null, { etapas: [], vai: {} })).rejects.toThrow(/Escolha a loja/);
    // Com a loja escolhida, a rota (vazia) aparece.
    expect((await svc.rotaDaCozinha(T2, V1)).etapas).toEqual([]);
  });
});
