import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ProdutoService } from '../produto/produto.service';
import { empresaTemAlergenos, lerAlergenosDoCardapio } from './alergenos-do-cardapio';
import { CardapioService } from './cardapio.service';
import { procurarNoCardapio } from './robo-busca';
import { CashbackService } from '../cashback/cashback.service';
import { FidelidadeService } from '../fidelidade/fidelidade.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS ALÉRGENOS DO CARDÁPIO (mig 454, D2) contra Postgres (TEST_PG_URL): a árvore da ficha técnica (sub-receita, insumo
// "feito na loja" sem marcação descendo pela ficha dele, embalagem fora), o produto de revenda, o combo, o ajuste à mão, a
// empresa sem marcação (mapa vazio) e a conferência/A6 do serviço do produto — as colunas conferidas no banco real (V6).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('alergenos-do-cardapio-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const conferido = (contem: string[] = [], extra: Record<string, unknown> = {}) => ({ conferido: true, contem, podeConter: [], gluten: null, lactose: null, ...extra });

descrever('alérgenos do cardápio (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const um = async (s: string, p: any[] = []) => (await q(s, p))[0].id as string;

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['produto_combo_item', 'produto', 'ficha_ingrediente', 'ficha_tecnica', 'item_estoque', 'cardapio_config'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  async function montar() {
    const t = await um(`insert into empresa (nome) values ('teste alergenos') returning id`);
    empresas.push(t);
    const item = (nome: string, alergenos: unknown, fichaId: string | null = null) =>
      um(`insert into item_estoque (tenant_id, nome, alergenos, ficha_id) values ($1,$2,$3::jsonb,$4) returning id`, [
        t, nome, alergenos == null ? null : JSON.stringify(alergenos), fichaId,
      ]);
    const ficha = (nome: string) => um(`insert into ficha_tecnica (tenant_id, nome) values ($1,$2) returning id`, [t, nome]);
    const linha = (fichaId: string, nome: string, o: { item?: string; sub?: string; delivery?: boolean } = {}) =>
      q(
        `insert into ficha_ingrediente (tenant_id, ficha_id, item_id, sub_ficha_id, insumo_nome, somente_delivery) values ($1,$2,$3,$4,$5,$6)`,
        [t, fichaId, o.item ?? null, o.sub ?? null, nome, o.delivery === true],
      );
    const prod = (nome: string, o: { ficha?: string; item?: string; tipo?: string; ajuste?: unknown; selos?: string[] } = {}) =>
      um(
        `insert into produto (tenant_id, nome, ficha_id, item_id, tipo, alergenos_ajuste, selos) values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) returning id`,
        [t, nome, o.ficha ?? null, o.item ?? null, o.tipo ?? 'simples', o.ajuste == null ? null : JSON.stringify(o.ajuste), JSON.stringify(o.selos ?? [])],
      );

    const pao = await item('Pão brioche', conferido(['Trigo', 'Leite', 'Ovos']));
    const carne = await item('Carne 150 g', conferido());
    const batata = await item('Batata palito', null); // ninguém conferiu
    const caixa = await item('Caixa do delivery', null); // embalagem: não entra
    const ovo = await item('Ovo', conferido(['Ovos']));
    const coca = await item('Coca lata', conferido([], { gluten: 'nao', lactose: 'nao' }));
    // A maionese da casa é uma sub-receita (ovo); o molho é um insumo "feito na loja" sem marcação (desce pela ficha dele).
    const fMaionese = await ficha('Maionese da casa');
    await linha(fMaionese, 'Ovo', { item: ovo });
    const fMolho = await ficha('Molho especial');
    await linha(fMolho, 'Ovo', { item: ovo });
    const molho = await item('Molho especial (feito na loja)', null, fMolho);

    const fLanche = await ficha('Número 07');
    await linha(fLanche, 'Pão brioche', { item: pao });
    await linha(fLanche, 'Carne 150 g', { item: carne });
    await linha(fLanche, 'Maionese da casa', { sub: fMaionese });
    await linha(fLanche, 'Molho', { item: molho });
    await linha(fLanche, 'Caixa', { item: caixa, delivery: true });
    const fPorcao = await ficha('Batata frita');
    await linha(fPorcao, 'Batata palito', { item: batata });

    const lanche = await prod('Número 07', { ficha: fLanche, ajuste: { conferido: false, contem: [], podeConter: ['Amendoim'], gluten: null, lactose: null } });
    const porcao = await prod('Batata frita', { ficha: fPorcao });
    const refri = await prod('Coca lata', { item: coca });
    const combo = await prod('Trio 07', { tipo: 'combo' });
    await q(`insert into produto_combo_item (tenant_id, combo_produto_id, componente_produto_id) values ($1,$2,$3),($1,$2,$4)`, [t, combo, lanche, refri]);
    const comboComBatata = await prod('Trio com batata', { tipo: 'combo' });
    await q(`insert into produto_combo_item (tenant_id, combo_produto_id, componente_produto_id) values ($1,$2,$3),($1,$2,$4)`, [t, comboComBatata, lanche, porcao]);
    const sorvete = await prod('Sorvete', { ajuste: conferido(['Leite']) });
    const semNada = await prod('Milk-shake');
    return { t, lanche, porcao, refri, combo, comboComBatata, sorvete, semNada, pao };
  }

  it('a empresa sem nenhuma marcação recebe o mapa vazio (o cardápio fica como é hoje)', async () => {
    const t = await um(`insert into empresa (nome) values ('teste alergenos vazia') returning id`);
    empresas.push(t);
    await q(`insert into produto (tenant_id, nome) values ($1,'X')`, [t]);
    expect(await empresaTemAlergenos(db, t)).toBe(false);
    expect((await lerAlergenosDoCardapio(db, t)).size).toBe(0);
    // "sempre" (a conferência) lê mesmo assim: o produto aparece não informado.
    const sempre = await lerAlergenosDoCardapio(db, t, { sempre: true });
    expect([...sempre.values()][0]?.situacao).toBe('nao_informado');
  });

  it('a ficha, a sub-receita, o insumo feito na loja, a revenda, o combo e o ajuste', async () => {
    const m = await montar();
    expect(await empresaTemAlergenos(db, m.t)).toBe(true);
    const a = await lerAlergenosDoCardapio(db, m.t);

    const lanche = a.get(m.lanche)!;
    expect(lanche.situacao).toBe('informado');
    expect(lanche.origem).toBe('ficha');
    expect(lanche.contem).toEqual(['Trigo', 'Ovos', 'Leite']);
    expect(lanche.podeConter).toEqual(['Amendoim']); // o ajuste somou
    expect(lanche.gluten).toBe('sim');
    expect(lanche.lactose).toBe('sim');
    // A embalagem (só delivery) não entra; a sub-receita e o molho feito na loja descem até o ovo.
    expect(lanche.folhas.map((f) => f.nome).sort()).toEqual(['Carne 150 g', 'Ovo', 'Ovo', 'Pão brioche']);

    const porcao = a.get(m.porcao)!;
    expect(porcao.situacao).toBe('nao_informado');
    expect(porcao.faltaConferir).toEqual(['Batata palito']);

    const refri = a.get(m.refri)!;
    expect(refri).toMatchObject({ situacao: 'informado', contem: [], gluten: 'nao', lactose: 'nao' });

    // O combo herda dos produtos que leva; com um não conferido, não informado no que não se sabe.
    expect(a.get(m.combo)).toMatchObject({ situacao: 'informado', contem: ['Trigo', 'Ovos', 'Leite'], podeConter: ['Amendoim'] });
    expect(a.get(m.comboComBatata)).toMatchObject({ situacao: 'parcial', contem: ['Trigo', 'Ovos', 'Leite'], faltaConferir: ['Batata palito'] });

    expect(a.get(m.sorvete)).toMatchObject({ situacao: 'informado', origem: 'mao', contem: ['Leite'], lactose: 'sim', gluten: 'nao' });
    expect(a.get(m.semNada)).toMatchObject({ situacao: 'nao_informado', origem: 'nenhuma' });

    // Só alguns produtos: o combo pedido sozinho traz os componentes junto (mesma resposta).
    const so = await lerAlergenosDoCardapio(db, m.t, { produtoIds: [m.combo] });
    expect(so.get(m.combo)).toMatchObject({ situacao: 'informado', contem: ['Trigo', 'Ovos', 'Leite'] });
  });

  it('mudar o insumo muda todos os produtos que o usam (A1)', async () => {
    const m = await montar();
    await q(`update item_estoque set alergenos = $2::jsonb where id = $1`, [m.pao, JSON.stringify(conferido(['Trigo', 'Ovos'], { lactose: 'nao' }))]);
    const a = await lerAlergenosDoCardapio(db, m.t);
    expect(a.get(m.lanche)!.contem).toEqual(['Trigo', 'Ovos']);
    expect(a.get(m.lanche)!.lactose).toBe('nao');
    expect(a.get(m.combo)!.contem).toEqual(['Trigo', 'Ovos']);
  });

  it('o cardápio online (A4, A6, A9) e a busca do robô: só o informado mostra; a frase da loja; o selo contraditório some', async () => {
    const m = await montar();
    const cardapio = new CardapioService(db, {} as any, {} as any, {} as any, new FidelidadeService(db), new CashbackService(db), { emit: () => true } as any, {} as any, { registrar: async () => undefined } as any);
    const token = `tk-${randomUUID()}`;
    await q(`insert into cardapio_config (tenant_id, token, ativo, modo) values ($1,$2,true,'retirada')`, [m.t, token]);
    await q(`update produto set selos = '["S/ lactose", "Artesanal"]'::jsonb where id = $1`, [m.lanche]);
    // A frase vazia é recusada; a gravada sai com os espaços juntados.
    await expect(cardapio.setConfig(m.t, null, { alergenosCautela: '   ' })).rejects.toThrow('não pode ficar vazia');
    await cardapio.setConfig(m.t, null, { alergenosCautela: '  Cozinha  com leite e trigo. ' });
    const menu: any = await cardapio.menu(token);
    const porNome = (n: string) => menu.produtos.find((p: any) => p.nome === n);
    expect(porNome('Número 07').alergenos).toEqual({ contem: ['Trigo (glúten)', 'Ovos', 'Leite'], podeConter: ['Amendoim'], gluten: 'sim', lactose: 'sim' });
    expect(porNome('Número 07').selos).toEqual(['Artesanal']); // o "S/ lactose" contradiz: some
    expect(porNome('Batata frita').alergenos).toBeNull(); // não informado: a página fica como é hoje
    expect(menu.loja.fraseDeCautela).toBe('Cozinha com leite e trigo.');

    const dados = await cardapio.dadosDaBuscaDoRobo(token);
    const busca: any = procurarNoCardapio(menu, 'numero 07', dados);
    const lanche = busca.levam.find((p: any) => p.nome === 'Número 07');
    expect(lanche.alergenos).toBe('contém trigo (glúten), ovos e leite; pode conter amendoim; não contém os outros alérgenos da lista; contém glúten; contém lactose');
    expect(busca.fraseDeCautela).toBe('Cozinha com leite e trigo.');
    const batata: any = procurarNoCardapio(menu, 'batata', dados);
    expect(batata.levam.find((p: any) => p.nome === 'Batata frita').alergenos).toBe('não informado pela loja');
  });

  it('a conferência do serviço do produto e a recusa do selo que contradiz (A6)', async () => {
    const m = await montar();
    const svc = new ProdutoService(db, { registrar: async () => undefined } as any, {} as any, {} as any);
    const conf = await svc.alergenosDoCardapio(m.t, null);
    const lanche = conf.produtos.find((p: any) => p.id === m.lanche)!;
    expect(lanche).toMatchObject({ situacao: 'informado', temFicha: true, seloContradiz: null });
    expect(conf.produtos.find((p: any) => p.id === m.refri)).toMatchObject({ revenda: true });
    expect(conf.fraseDeCautela).toBeNull();

    await expect((svc as any).conferirSelosComAlergenos(m.t, m.lanche, ['S/ lactose'])).rejects.toThrow('S/ lactose');
    await expect((svc as any).conferirSelosComAlergenos(m.t, m.refri, ['S/ glúten', 'S/ lactose'])).resolves.toBeUndefined();
    // O ajuste que soma leite ao refri (só para o teste) passa a recusar o "S/ lactose".
    await expect(
      (svc as any).conferirSelosComAlergenos(m.t, m.refri, ['S/ lactose'], { conferido: false, contem: ['Leite'], podeConter: [], gluten: null, lactose: null }),
    ).rejects.toThrow('S/ lactose');
  });
});
