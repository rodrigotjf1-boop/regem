import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { ProducaoPedidoService } from './producao-pedido.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { gravarOuEncaminharImpressao } from '../../common/impressao-destino';
import { DeliveryService } from '../delivery/delivery.service';
import { Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ROTEAMENTO DA IMPRESSÃO POR LOJA — contra um banco com TODAS as migrations (o CI monta um
// como numa instalação nova do servidor local). Sem TEST_PG_URL, pula avisando.
//
// Por que existe: numa empresa com duas lojas, o destino de um produto da rede levava a venda da
// loja B para o forno da loja A, e um produto com destino nos dois fornos imprimia nas DUAS
// lojas a cada venda (reproduzido: 2 de 5 casos certos). Setor é por loja, mas o produto aponta
// UM setor — o de uma das lojas. A DANFE saía em todas as impressoras de cupom da empresa.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('roteamento-loja.spec: sem TEST_PG_URL — testes de roteamento contra o Postgres PULADOS');

const T = randomUUID();
const A = randomUUID();
const B = randomUUID();
const COZ_A = randomUUID();
const COZ_B = randomUUID();
const BAR_A = randomUUID(); // setor só da loja A (sem equivalente na B)
const FORNO_A = randomUUID();
const FORNO_B = randomUUID();
const PADRAO_B = randomUUID();
const CUPOM_A = randomUUID();
const CUPOM_B = randomUUID();
const SOB_A = randomUUID(); // setor Sobremesa da loja A, atendido por impressora DA REDE
const SOB_REDE = randomUUID(); // impressora sem loja (rede) que faz produção

// Ganchos com banco (criar schema, aplicar migrations, limpar com os gatilhos do sync) passam dos
// 5 s padrão quando todos os arquivos de teste compilam e rodam juntos (CI com cache frio).
jest.setTimeout(60_000);

descrever('roteamento da impressão por loja (Postgres com todas as migrations)', () => {
  let pool: Pool;
  let svc: ProducaoPedidoService;
  let fiscal: FiscalService;
  let db: any;
  const antes = process.env.EDGE_MODE;
  const q = (s: string, p: any[] = []) => pool.query(s, p);

  const produto = async (nome: string, setor: string | null, destinos: string[] = []) => {
    const id = randomUUID();
    await q(`insert into produto (id, tenant_id, nome, vai_para_producao, setor_producao_id) values ($1,$2,$3,true,$4)`, [id, T, nome, setor]);
    for (const d of destinos)
      await q(`insert into produto_destino_producao (tenant_id, produto_id, equipamento_id) values ($1,$2,$3)`, [T, id, d]);
    const [p] = await db.select().from(schema.produto).where(eq(schema.produto.id, id));
    return p;
  };
  const vender = async (loja: string, p: any) => {
    const cmd = (await q(`insert into comanda (tenant_id, unidade_id, status) values ($1,$2,'fechada') returning id`, [T, loja])).rows[0].id;
    await db.transaction((tx: any) =>
      svc.criarPedidos(tx, { tenantId: T, unidadeId: loja, comandaId: cmd, origem: 'balcao' }, [
        { produto: p, descricao: p.nome, quantidade: 1, opcaoIds: [] } as any,
      ]));
    const r = await q(`select e.nome from impressao_job j join equipamento e on e.id=j.equipamento_id
                        where j.comanda_id=$1 order by 1`, [cmd]);
    return r.rows.map((x) => x.nome);
  };

  beforeAll(async () => {
    process.env.EDGE_MODE = 'true'; // caminho do servidor local (edgeAtivo = false)
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    svc = new ProducaoPedidoService(db, { registrar: async () => {} } as any, { emit: () => {} } as any);
    fiscal = new FiscalService(db, { registrar: async () => {} } as any);
    // Tabelas só-nuvem que o caminho "loja com servidor local" usa (o banco do CI é montado como
    // servidor local): edge_heartbeat (consultada por edgeAtivo) e edge_comando (+ mig 269).
    await q(`create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(),
             tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`);
    const MIG = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
    await q(readFileSync(join(MIG, '124_edge_release_comando.sql'), 'utf8'));
    await q(readFileSync(join(MIG, '269_impressora_status_codepage_comando_destino.sql'), 'utf8'));
    await q(`insert into empresa (id, nome) values ($1,'teste roteamento')`, [T]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$3,'Loja A'),($2,$3,'Loja B')`, [A, B, T]);
    await q(`insert into setor (id, tenant_id, unidade_id, nome) values
             ($1,$4,$5,'Cozinha'), ($2,$4,$6,'  cozinha '), ($3,$4,$5,'Bar'), ($7,$4,$5,'Sobremesa')`,
      [COZ_A, COZ_B, BAR_A, T, A, B, SOB_A]);
    const imp = (id: string, nome: string, uni: string, o: { setores?: string[]; padrao?: boolean; cupom?: boolean; prod?: boolean }) =>
      q(`insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, conexao, host,
                                  faz_producao, faz_cupom, setores_atendidos, padrao, ativo)
         values ($1,$2,$3,$4,$5,'impressora','rede','10.0.0.9',$6,$7,$8::jsonb,$9,true)`,
        [id, T, uni, nome, 'tok-' + id, o.prod ?? true, !!o.cupom, JSON.stringify(o.setores ?? []), !!o.padrao]);
    await imp(FORNO_A, 'Forno A', A, { setores: [COZ_A] });
    await imp(FORNO_B, 'Forno B', B, { setores: [COZ_B] });
    await imp(PADRAO_B, 'Padrao B', B, { padrao: true });
    await imp(CUPOM_A, 'Cupom A', A, { cupom: true, prod: false });
    await imp(CUPOM_B, 'Cupom B', B, { cupom: true, prod: false });
    // Impressora DA REDE (sem loja), faz produção e atende a Sobremesa da loja A.
    await q(`insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, conexao, host, faz_producao, setores_atendidos, ativo)
             values ($1,$2,null,'Sobremesa Rede',$3,'impressora','rede','10.0.0.7',true,$4::jsonb,true)`,
      [SOB_REDE, T, 'tok-' + SOB_REDE, JSON.stringify([SOB_A])]);
  });

  afterAll(async () => {
    if (antes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = antes;
    if (!pool) return;
    await q(`delete from edge_comando where tenant_id=$1`, [T]);
    await q(`delete from edge_status where tenant_id=$1`, [T]);
    for (const t of ['impressao_job', 'producao_pedido_item', 'producao_pedido', 'comanda', 'produto_destino_producao',
      'setor_destino_producao', 'produto', 'equipamento', 'setor', 'unidade'])
      await q(`delete from ${t} where tenant_id=$1`, [T]);
    await q(`delete from empresa where id=$1`, [T]);
    await pool.end();
  });

  it('destino do produto na loja A: a venda da loja B sai no forno DA LOJA B', async () => {
    const pizza = await produto('Pizza', COZ_A, [FORNO_A]);
    expect(await vender(B, pizza)).toEqual(['Forno B']);
    expect(await vender(A, pizza)).toEqual(['Forno A']);
  });

  it('destino nos dois fornos: cada venda sai só no forno da própria loja', async () => {
    const p = await produto('Pizza meia', null, [FORNO_A, FORNO_B]);
    expect(await vender(A, p)).toEqual(['Forno A']);
    expect(await vender(B, p)).toEqual(['Forno B']);
  });

  it('setor da outra loja vira o setor de MESMO NOME desta loja (maiúsculas/espaços não importam)', async () => {
    const p = await produto('Calzone', COZ_A);
    expect(await vender(B, p)).toEqual(['Forno B']);
  });

  it('setor sem equivalente nesta loja: cai na impressora padrão (não some)', async () => {
    const p = await produto('Chopp', BAR_A);
    expect(await vender(B, p)).toEqual(['Padrao B']);
  });

  it('setor DESTA loja sem impressora continua sem via (decisão da loja: só KDS)', async () => {
    const p = await produto('Drink', BAR_A);
    expect(await vender(A, p)).toEqual([]);
  });

  it('sem setor e sem destino: impressora padrão da loja', async () => {
    const p = await produto('Suco', null);
    expect(await vender(B, p)).toEqual(['Padrao B']);
  });

  it('impressora DA REDE (sem loja) recebe a via de produção da venda da loja (era ignorada)', async () => {
    const p = await produto('Pudim', SOB_A);
    expect(await vender(A, p)).toEqual(['Sobremesa Rede']);
  });

  it('avisos de roteamento respondem (era 500: unidade não tem coluna ativo)', async () => {
    const r = await svc.avisosRoteamento(T, B);
    expect(r.map((x: any) => x.produto)).toEqual(expect.arrayContaining(['Chopp']));
  });

  it('DANFE: sai na impressora do cupom da venda; sem cupom, numa de cupom DA LOJA — uma só', async () => {
    const nota = (comandaId: string | null, unidadeId: string) => ({
      serie: 1, numero: 1, ambiente: '2', valorTotal: 10, chave: 'x', protocolo: null, qrcode: '',
      unidadeId, comandaId,
    });
    const itens: any[] = [{ quantidade: 1, descricao: 'Pizza', precoUnitario: 10 }];
    // venda da loja B cujo cupom saiu no "Cupom B"
    const cmd = (await q(`insert into comanda (tenant_id, unidade_id, status) values ($1,$2,'fechada') returning id`, [T, B])).rows[0].id;
    await q(`insert into impressao_job (tenant_id, unidade_id, equipamento_id, comanda_id, via, conteudo, status)
             values ($1,$2,$3,$4,'cliente','cupom','impresso')`, [T, B, CUPOM_B, cmd]);
    await (fiscal as any).imprimirDanfe(T, nota(cmd, B), itens);
    await (fiscal as any).imprimirDanfe(T, nota(null, A), itens);
    const r = await q(`select e.nome from impressao_job j join equipamento e on e.id=j.equipamento_id
                        where j.tenant_id=$1 and j.via='fiscal' order by j.criado_em`, [T]);
    expect(r.rows.map((x) => x.nome)).toEqual(['Cupom B', 'Cupom A']);
  });

  describe('loja com servidor local ativo — o que é criado NA NUVEM', () => {
    const SRV_B = randomUUID();
    beforeAll(async () => {
      delete process.env.EDGE_MODE; // caminho da NUVEM
      await q(`insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, conexao, ativo)
               values ($1,$2,$3,'Servidor B',$4,'servidor_local','rede',true)`, [SRV_B, T, B, 'tok-' + SRV_B]);
      await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, recebido_em) values ($1,$2,$3,now())`, [SRV_B, T, B]);
    });
    afterAll(() => {
      process.env.EDGE_MODE = 'true';
    });

    it('etiqueta/ordem/etapa do KDS: vai por COMANDO para o servidor da loja (não para a fila da nuvem)', async () => {
      const onde = await gravarOuEncaminharImpressao(db, {
        tenantId: T, unidadeId: B, equipamentoId: FORNO_B, via: 'etiqueta', conteudo: 'ETIQUETA X',
      });
      expect(onde).toBe('servidor_local');
      const c = await q(`select comando, equipamento_id, dados from edge_comando where tenant_id=$1`, [T]);
      expect(c.rows).toEqual([
        { comando: 'imprimir', equipamento_id: SRV_B, dados: expect.objectContaining({ equipamentoId: FORNO_B, via: 'etiqueta', conteudo: 'ETIQUETA X' }) },
      ]);
      const j = await q(`select 1 from impressao_job where tenant_id=$1 and conteudo='ETIQUETA X'`, [T]);
      expect(j.rowCount).toBe(0);
    });

    it('loja SEM servidor local ativo: grava na fila da nuvem (agente dos caixas)', async () => {
      const onde = await gravarOuEncaminharImpressao(db, {
        tenantId: T, unidadeId: A, equipamentoId: FORNO_A, via: 'etiqueta', conteudo: 'ETIQUETA A',
      });
      expect(onde).toBe('local');
      expect((await q(`select 1 from impressao_job where tenant_id=$1 and conteudo='ETIQUETA A'`, [T])).rowCount).toBe(1);
    });

    it('venda feita na nuvem: cria o pedido de produção, mas NÃO grava vias (o servidor local gera as dele)', async () => {
      const p = await produto('Lasanha', null, [FORNO_B]);
      expect(await vender(B, p)).toEqual([]);
      const r = await q(`select count(*)::int n from producao_pedido pp join comanda c on c.id = pp.comanda_id
                          where c.tenant_id=$1 and c.unidade_id=$2`, [T, B]);
      expect(r.rows[0].n).toBeGreaterThan(0);
    });
  });

  describe('aviso de status do delivery', () => {
    const dsvc: any = Object.create(DeliveryService.prototype);
    beforeAll(() => {
      dsvc.db = db;
      dsvc.logger = new Logger('teste');
      dsvc.avisosRecentes = new Map();
    });

    it('nunca rejeita — um erro no envio não derruba a API (era: processo encerrado)', async () => {
      dsvc.enviarAvisoStatus = async () => {
        throw Object.assign(new Error('relação "whatsapp_mensagem" não existe'), { code: '42P01' });
      };
      const antes = process.env.EDGE_MODE;
      for (const modo of ['true', 'false']) {
        process.env.EDGE_MODE = modo;
        await expect(dsvc.dispararWebhook(T, { id: randomUUID(), canal: 'cardapio', status: 'pronto' })).resolves.toBeUndefined();
      }
      process.env.EDGE_MODE = antes;
    });

    it('a nuvem só aceita aviso de pedido que conhece (409) e não repete o mesmo aviso', async () => {
      let enviados = 0;
      dsvc.enviarAvisoStatus = async () => { enviados++; };
      await expect(dsvc.avisoVindoDaLoja(T, { pedidoId: randomUUID(), status: 'pronto' })).rejects.toThrow(/ainda não chegou/);
      const pid = randomUUID();
      await q(`insert into pedido_externo (id, tenant_id, unidade_id, canal, status) values ($1,$2,$3,'cardapio','confirmado')`, [pid, T, A]);
      await dsvc.avisoVindoDaLoja(T, { pedidoId: pid, status: 'pronto', evento: 'status' });
      await dsvc.avisoVindoDaLoja(T, { pedidoId: pid, status: 'pronto', evento: 'status' }); // reenvio
      await dsvc.avisoVindoDaLoja(T, { pedidoId: pid, status: 'despachado', evento: 'status' });
      expect(enviados).toBe(2);
      await q(`delete from pedido_externo where id=$1`, [pid]);
    });
  });
});
