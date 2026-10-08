import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { hojeISO } from './data';
import { ContagemService } from '../modules/contagem/contagem.service';
import { DesperdicioService } from '../modules/desperdicio/desperdicio.service';
import { RecebimentoService } from '../modules/recebimento/recebimento.service';
import { VistoriaService } from '../modules/vistoria/vistoria.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// DATA DE REGISTRO — quem grava sem informar a data recebe o HOJE da operação (hojeISO), nunca
// o `current_date` do banco. O banco da nuvem roda em UTC: das 21h à meia-noite de Brasília o
// "hoje" dele já é amanhã, e a vistoria de fechamento, a contagem da noite e a perda do fim do
// turno saíam com a data do dia seguinte (e sumiam do filtro "até hoje"). Os dois testes que
// pegaram isso só falhavam nessas três horas — por isso aqui o banco é posto num fuso em que o
// dia dele é SEMPRE outro, a qualquer hora em que o teste rode.

// Tabelas cuja coluna de data tem `default current_date` no banco (schema.ts).
const DATA_PELO_BANCO: Record<string, { tabela: string; coluna: string }> = {
  desperdicio: { tabela: 'desperdicio', coluna: 'data' },
  vistoria: { tabela: 'vistoria', coluna: 'data' },
  contagemExecucao: { tabela: 'contagem_execucao', coluna: 'data' },
  ocorrencia: { tabela: 'ocorrencia', coluna: 'data' },
  movimentoEstoque: { tabela: 'movimento_estoque', coluna: 'data' },
  lancamentoCaixa: { tabela: 'lancamento_caixa', coluna: 'data' },
  recebimento: { tabela: 'recebimento', coluna: 'data' },
  lote: { tabela: 'lote', coluna: 'entrada' },
};

// Trecho do parêntese que abre em `ini` até o que o fecha.
function ateFechar(texto: string, ini: number): string {
  let nivel = 0;
  for (let i = ini; i < texto.length; i++) {
    if (texto[i] === '(') nivel++;
    else if (texto[i] === ')' && --nivel === 0) return texto.slice(ini + 1, i);
  }
  return texto.slice(ini + 1);
}

/** Os INSERT de `texto` que deixam a data de registro para o banco decidir. */
function insertsSemData(texto: string): string[] {
  const achados: string[] = [];
  const linhaDe = (pos: number) => texto.slice(0, pos).split('\n').length;
  for (const [nomeTs, { tabela, coluna }] of Object.entries(DATA_PELO_BANCO)) {
    // 1) Drizzle: .insert(tabela).values( … )
    const drizzleRe = new RegExp(`\\.insert\\(${nomeTs}\\)\\s*\\.values\\(`, 'g');
    for (let m = drizzleRe.exec(texto); m; m = drizzleRe.exec(texto)) {
      let corpo = ateFechar(texto, m.index + m[0].length - 1);
      // `.values(linhas)`: o objeto foi montado antes — vale o trecho desde a definição.
      const variavel = /^\s*([A-Za-z_]\w*)\s*$/.exec(corpo)?.[1];
      if (variavel) {
        const def = texto.lastIndexOf(`const ${variavel} `, m.index);
        if (def >= 0) corpo = texto.slice(def, m.index);
      }
      const onde = `${tabela} (linha ${linhaDe(m.index)})`;
      const chave = new RegExp(`(^|[\\s{,])${coluna}\\s*[:,}]`, 'm');
      if (!chave.test(corpo)) achados.push(`${onde}: não informa \`${coluna}\``);
      else if (new RegExp(`\\b${coluna}\\s*:[^,\\n]*\\?\\?\\s*undefined`).test(corpo))
        achados.push(`${onde}: \`${coluna}\` cai em undefined`);
      else if (new RegExp(`\\b${coluna}\\s*:\\s*dto\\.${coluna}\\s*[,}\\n]`).test(corpo))
        achados.push(`${onde}: \`${coluna}\` opcional do pedido, sem reserva`);
    }
    // 2) SQL escrito à mão: insert into tabela ( colunas )
    const sqlRe = new RegExp(`insert\\s+into\\s+${tabela}\\s*\\(([^)]*)\\)`, 'gi');
    for (let m = sqlRe.exec(texto); m; m = sqlRe.exec(texto)) {
      const colunas = m[1].split(',').map((c) => c.trim().replace(/"/g, ''));
      if (!colunas.includes(coluna)) achados.push(`${tabela} (linha ${linhaDe(m.index)}): SQL não informa \`${coluna}\``);
    }
  }
  return achados;
}

describe('data de registro — nenhum INSERT deixa a data para o `current_date` do banco', () => {
  const raiz = join(__dirname, '..');
  const fontes = (dir: string, fora: string[] = []): string[] => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) fontes(p, fora);
      else if (nome.endsWith('.ts') && !nome.endsWith('.spec.ts') && !nome.endsWith('.d.ts')) fora.push(p);
    }
    return fora;
  };

  it('todo insert nessas tabelas informa a data (hojeISO quando o pedido não traz)', () => {
    const fora: string[] = [];
    for (const arq of fontes(raiz))
      for (const a of insertsSemData(readFileSync(arq, 'utf8'))) fora.push(`${relative(raiz, arq).replace(/\\/g, '/')} · ${a}`);
    expect(fora).toEqual([]);
  });

  it('a varredura enxerga as quatro formas do erro (e não acusa quem informa)', () => {
    // Meta-teste: sem isto, uma varredura quebrada passaria calada.
    expect(insertsSemData(`await this.db.insert(vistoria).values({ tenantId, tipo: dto.tipo }).returning();`)).toHaveLength(1);
    expect(insertsSemData(`await tx.insert(recebimento).values({\n  tenantId,\n  data: dto.data ?? undefined,\n});`)).toHaveLength(1);
    expect(insertsSemData(`await tx.insert(desperdicio).values({\n  tenantId,\n  data: dto.data,\n});`)).toHaveLength(1);
    expect(insertsSemData('await db.execute(sql`insert into lancamento_caixa (tenant_id, tipo, valor) values (1, 2, 3)`);')).toHaveLength(1);
    expect(insertsSemData(`const linhas = itens.map((i) => ({ tenantId, itemId: i.id }));\nawait tx.insert(movimentoEstoque).values(linhas);`)).toHaveLength(1);

    expect(insertsSemData(`await this.db.insert(vistoria).values({ tenantId, data: dto.data ?? hojeISO() }).returning();`)).toEqual([]);
    expect(insertsSemData(`const linhas = itens.map((i) => ({ tenantId, data: hojeISO() }));\nawait tx.insert(movimentoEstoque).values(linhas);`)).toEqual([]);
    expect(insertsSemData(`await tx.insert(lote).values({ tenantId, entrada: rec.data });`)).toEqual([]);
    expect(insertsSemData('await db.execute(sql`insert into lancamento_caixa (tenant_id, valor, data) values (1, 2, ${hojeISO()})`);')).toEqual([]);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
jest.setTimeout(60_000);

descrever('data de registro — banco num dia diferente do da operação (Postgres real)', () => {
  // Um dos dois está SEMPRE num dia diferente do de Brasília: o primeiro vive 17 h à frente
  // (outro dia das 7h em diante), o segundo 9 h atrás (outro dia até as 9h).
  const diaEm = (fuso: string) => new Date().toLocaleDateString('en-CA', { timeZone: fuso });
  const FUSO_DO_BANCO = ['Pacific/Kiritimati', 'Etc/GMT+12'].find((f) => diaEm(f) !== hojeISO())!;

  const empresas: string[] = [];
  let pool: Pool;
  let db: any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const dataDe = async (tabela: string, t: string) =>
    (await q(`select data::text as data from ${tabela} where tenant_id = $1 order by created_at desc limit 1`, [t]))[0]?.data;

  async function empresa() {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `Fuso teste ${id.slice(0, 6)}`]);
    empresas.push(id);
    return id;
  }

  beforeAll(async () => {
    // O fuso vai nas opções da conexão: vale para TODAS as conexões do pool, inclusive as que
    // as transações dos serviços abrem.
    pool = new Pool({ connectionString: URL_PG, options: `-c timezone=${FUSO_DO_BANCO}` });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    for (const id of empresas) {
      for (const tabela of [
        'contagem_item', 'contagem_execucao', 'contagem_lista_item', 'contagem_lista',
        'desperdicio', 'vistoria', 'recebimento', 'item_estoque', 'colaborador',
      ]) {
        await q(`delete from ${tabela} where tenant_id = $1`, [id]);
      }
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool.end();
  });

  it('a premissa: o "hoje" do banco não é o da operação', async () => {
    const [{ banco }] = await q(`select current_date::text as banco`);
    expect(banco).not.toBe(hojeISO());
  });

  it('vistoria sem data sai com o dia da operação; com data, vale a informada', async () => {
    const t = await empresa();
    const s = new VistoriaService(db);
    await s.create(t, { tipo: 'fechamento', observacao: 'Fechamento de teste' } as any);
    expect(await dataDe('vistoria', t)).toBe(hojeISO());

    const outra = await empresa();
    await s.create(outra, { tipo: 'padrao', data: '2026-01-15' } as any);
    expect(await dataDe('vistoria', outra)).toBe('2026-01-15');
  });

  it('desperdício sem data sai com o dia da operação', async () => {
    const t = await empresa();
    await new DesperdicioService(db).create(t, { descricao: 'Perda de teste' } as any);
    expect(await dataDe('desperdicio', t)).toBe(hojeISO());
  });

  it('contagem aberta agora sai com o dia da operação', async () => {
    const t = await empresa();
    const [{ id: ana }] = await q(`insert into colaborador (tenant_id, nome) values ($1, 'Ana de teste') returning id`, [t]);
    const [{ id: item }] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Arroz de teste', 'kg') returning id`, [t]);
    const s = new (ContagemService as any)(db, { emit: jest.fn() }, { registrar: jest.fn().mockResolvedValue(undefined) }) as ContagemService;
    const lista: any = await s.createLista(t, { nome: 'Lista de teste', recorrencia: 'avulsa', itemIds: [item] } as any);
    await s.iniciarExecucao(t, lista.id, ana);
    expect(await dataDe('contagem_execucao', t)).toBe(hojeISO());
  });

  it('recebimento sem data sai com o dia da operação', async () => {
    const t = await empresa();
    const s = new (RecebimentoService as any)(db, { registrar: jest.fn().mockResolvedValue(undefined) }, { emit: jest.fn() }) as RecebimentoService;
    await s.create(t, { notaRef: 'NF de teste' } as any);
    expect(await dataDe('recebimento', t)).toBe(hojeISO());
  });
});
