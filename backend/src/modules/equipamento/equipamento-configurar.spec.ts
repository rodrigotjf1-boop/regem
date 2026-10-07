import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { EquipamentoService } from './equipamento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "CONFIGURAR" DE QUALQUER EQUIPAMENTO (decisão do dono, 07/10/2026) — contra o Postgres real.
//
// Só a impressora tinha edição; terminal, KDS, ponto e servidor não tinham como trocar o nome, e o
// KDS não trocava de setor nem de escopo depois de cadastrado. `atualizar` muda o nome de qualquer
// um e, por tipo, o que cabe trocar — só o que veio no pedido (V16), só dentro da empresa, e deixa
// na auditoria o que mudou.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('equipamento-configurar.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('configurar equipamento (nome e campos por tipo)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const auditorias: any[] = [];
  const svc = new EquipamentoService(db, { registrar: async (a: any) => void auditorias.push(a) } as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;
  const ATOR = { id: '00000000-0000-4000-8000-0000000000a1', perfil: 'gerente' };

  beforeAll(() => {
    delete process.env.EDGE_MODE;
  });
  afterAll(async () => {
    if (edgeOriginal !== undefined) process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) {
      for (const t of ['equipamento', 'setor', 'unidade']) await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    }
    await pool.end();
  }, 120_000);
  beforeEach(() => {
    auditorias.length = 0;
  });

  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste configurar equipamento') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja de teste') returning id`, [t]))[0].id as string;
    const setor = async (nome: string) => (await q(`insert into setor (tenant_id, unidade_id, nome) values ($1, $2, $3) returning id`, [t, u, nome]))[0].id as string;
    return { t, u, cozinha: await setor('Cozinha de teste'), bar: await setor('Bar de teste') };
  }
  const equip = async (t: string, u: string | null, tipo: string, nome: string, extra: Record<string, unknown> = {}) => {
    const cols = Object.keys(extra);
    const r = await q(
      `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo${cols.map((c) => `, ${c}`).join('')}) values ($1, $2, $3, $4, $5, true${cols.map((_, i) => `, $${i + 6}`).join('')}) returning id`,
      [t, u, nome, tipo, randomBytes(24).toString('hex'), ...Object.values(extra)],
    );
    return r[0].id as string;
  };
  const linha = async (id: string) => (await q(`select nome, tipo, escopo, setor_id, pdv_main_id, unidade_id, token, ativo from equipamento where id = $1`, [id]))[0];

  it('troca o nome de qualquer tipo, sem mexer em mais nada, e audita o que mudou', async () => {
    const c = await empresa();
    for (const tipo of ['pdv', 'terminal_ponto', 'servidor_local', 'kds', 'salao']) {
      const id = await equip(c.t, c.u, tipo, `Antigo ${tipo}`);
      const antes = await linha(id);
      auditorias.length = 0;
      const r: any = await svc.atualizar(c.t, id, { nome: `  Novo ${tipo}  ` }, ATOR);
      expect(r.nome).toBe(`Novo ${tipo}`);
      expect(await linha(id)).toEqual({ ...antes, nome: `Novo ${tipo}` });
      expect(auditorias).toHaveLength(1);
      expect(auditorias[0]).toMatchObject({
        tenantId: c.t, unidadeId: c.u, atorId: ATOR.id, acao: 'editou_equipamento', entidadeTipo: 'equipamento', entidadeId: id,
        detalhe: { nome: `Novo ${tipo}`, tipo, mudou: { nome: { de: `Antigo ${tipo}`, para: `Novo ${tipo}` } } },
      });
    }
  });

  it('pedido sem mudança não grava nem audita; nome vazio é recusado', async () => {
    const c = await empresa();
    const id = await equip(c.t, c.u, 'pdv', 'Caixa de teste');
    await svc.atualizar(c.t, id, { nome: 'Caixa de teste' }, ATOR);
    await svc.atualizar(c.t, id, {}, ATOR);
    expect(auditorias).toHaveLength(0);
    await expect(svc.atualizar(c.t, id, { nome: '   ' }, ATOR)).rejects.toThrow('Informe o nome do equipamento');
    await expect(svc.atualizar(c.t, id, { nome: 'x'.repeat(81) }, ATOR)).rejects.toThrow('no máximo 80');
    expect((await linha(id)).nome).toBe('Caixa de teste');
  });

  it('KDS: troca setor e escopo; setor de outra empresa e escopo desconhecido são recusados', async () => {
    const c = await empresa();
    const outra = await empresa();
    const id = await equip(c.t, c.u, 'kds', 'KDS de teste', { setor_id: c.cozinha });
    await svc.atualizar(c.t, id, { setorId: c.bar, escopo: 'entrega' }, ATOR);
    expect(await linha(id)).toMatchObject({ setor_id: c.bar, escopo: 'entrega', nome: 'KDS de teste' });
    expect(auditorias[0].detalhe.mudou).toEqual({ escopo: { de: 'producao', para: 'entrega' }, setor: { de: 'Cozinha de teste', para: 'Bar de teste' } });
    // tirar o setor
    await svc.atualizar(c.t, id, { setorId: null }, ATOR);
    expect((await linha(id)).setor_id).toBeNull();
    await expect(svc.atualizar(c.t, id, { setorId: outra.cozinha }, ATOR)).rejects.toThrow('Setor não encontrado');
    await expect(svc.atualizar(c.t, id, { setorId: 'não é um id' }, ATOR)).rejects.toThrow('Setor não encontrado');
    await expect(svc.atualizar(c.t, id, { escopo: 'outro' }, ATOR)).rejects.toThrow('Escopo do KDS inválido');
    expect(await linha(id)).toMatchObject({ setor_id: null, escopo: 'entrega' });
  });

  it('campo de outro tipo é ignorado: o PDV não ganha setor nem escopo', async () => {
    const c = await empresa();
    const id = await equip(c.t, c.u, 'pdv', 'Caixa de teste');
    await svc.atualizar(c.t, id, { setorId: c.bar, escopo: 'avisos', pdvMainId: randomUUID(), tipo: 'kds', unidadeId: null, token: 'x', ativo: false }, ATOR);
    expect(await linha(id)).toMatchObject({ tipo: 'pdv', setor_id: null, escopo: 'producao', pdv_main_id: null, unidade_id: c.u, ativo: true });
    expect(auditorias).toHaveLength(0);
  });

  it('sub-PDV do salão: troca o PDV principal só por um PDV ativo da mesma empresa e loja', async () => {
    const c = await empresa();
    const outra = await empresa();
    const outraLoja = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Outra loja de teste') returning id`, [c.t]))[0].id as string;
    const [main1, main2] = [await equip(c.t, c.u, 'pdv', 'Caixa um'), await equip(c.t, c.u, 'pdv', 'Caixa dois')];
    const id = await equip(c.t, c.u, 'salao', 'Salão de teste', { pdv_main_id: main1 });
    await svc.atualizar(c.t, id, { pdvMainId: main2 }, ATOR);
    expect((await linha(id)).pdv_main_id).toBe(main2);
    expect(auditorias[0].detalhe.mudou).toEqual({ pdvPrincipal: { de: 'Caixa um', para: 'Caixa dois' } });

    const revogado = await equip(c.t, c.u, 'pdv', 'Caixa revogado');
    await q(`update equipamento set ativo = false where id = $1`, [revogado]);
    for (const [ruim, erro] of [
      [await equip(outra.t, outra.u, 'pdv', 'Caixa de outra empresa'), 'PDV principal não encontrado'],
      [await equip(c.t, c.u, 'kds', 'Não é PDV'), 'PDV principal não encontrado'],
      [revogado, 'PDV principal não encontrado'],
      [await equip(c.t, outraLoja, 'pdv', 'Caixa de outra loja'), 'O PDV principal é de outra loja'],
      ['', 'Escolha o PDV principal'],
    ] as const) {
      await expect(svc.atualizar(c.t, id, { pdvMainId: ruim }, ATOR)).rejects.toThrow(erro);
    }
    expect((await linha(id)).pdv_main_id).toBe(main2);
  });

  it('equipamento de outra empresa não é encontrado; revogado não é editado', async () => {
    const c = await empresa();
    const outra = await empresa();
    const id = await equip(c.t, c.u, 'pdv', 'Caixa de teste');
    await expect(svc.atualizar(outra.t, id, { nome: 'Indevido' }, ATOR)).rejects.toThrow('Equipamento não encontrado');
    await q(`update equipamento set ativo = false where id = $1`, [id]);
    await expect(svc.atualizar(c.t, id, { nome: 'Depois de revogar' }, ATOR)).rejects.toThrow('Equipamento revogado não é editado');
    expect((await linha(id)).nome).toBe('Caixa de teste');
  });
});
