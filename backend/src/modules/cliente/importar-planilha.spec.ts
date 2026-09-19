import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ClienteService } from './cliente.service';
import { nomeUtil, parseCsvClientes, segmentoPeloArquivo } from './importar-planilha';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Importação da base de clientes exportada da Anota Aí (CSV). Dados FICTÍCIOS no mesmo
// formato das três exportações (potenciais / ativos / inativos, set/2026).
const CAB = 'Nome do Cliente,Número Telefone,Número Whatsapp,Quantidade de Pedidos,Dias de Inatividade';

describe('leitura do CSV de clientes da Anota Aí', () => {
  it('acha as colunas pelo título (qualquer ordem, com BOM, com ; e aspas)', () => {
    const csv = '\uFEFF"Número Whatsapp";"Nome do Cliente";"Número Telefone";"Quantidade de Pedidos"\n' +
      '"5521900000001";"Silva, Ana";"21900000001";"12"\n';
    const { linhas } = parseCsvClientes(csv);
    expect(linhas).toEqual([
      { nome: 'Silva, Ana', telefoneRaw: '21900000001', whatsappRaw: '5521900000001', pedidos: 12, diasInatividade: null },
    ]);
  });

  it('aba sem "Dias de Inatividade" (potenciais) também lê', () => {
    const { linhas } = parseCsvClientes('Nome do Cliente,Número Telefone,Número Whatsapp,Quantidade de Pedidos\nZé,21900000002,,0\n');
    expect(linhas[0]).toMatchObject({ nome: 'Zé', telefoneRaw: '21900000002', pedidos: 0, diasInatividade: null });
  });

  it('sem coluna de telefone → erro claro', () => {
    expect(() => parseCsvClientes('Nome,Email\nA,a@b.c\n')).toThrow(/coluna de telefone/);
  });

  it('nome que não é nome vira vazio', () => {
    expect(['cliente', 'Cliente ', '.', '', '■', '😀', '12', 'Th', 'Lê', 'Maria Eduarda'].map(nomeUtil))
      .toEqual(['', '', '', '', '', '', '', 'Th', 'Lê', 'Maria Eduarda']);
  });

  it('segmento pelo nome do arquivo da Anota Aí', () => {
    expect(segmentoPeloArquivo('Clientes inativos - consulta gerada em 19_09_2026.csv')).toBe('inativo');
    expect(segmentoPeloArquivo('Clientes ativos - consulta gerada em 19_09_2026.csv')).toBe('ativo');
    expect(segmentoPeloArquivo('Clientes em potencial - consulta.csv')).toBe('potencial');
    expect(segmentoPeloArquivo('lista.csv')).toBeNull();
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('importar-planilha.spec: sem TEST_PG_URL — parte com Postgres PULADA');

jest.setTimeout(60_000);

descrever('importação da Anota Aí contra o Postgres (não sobrescreve quem já existe)', () => {
  let pool: Pool;
  let svc: ClienteService;
  const T = randomUUID();
  const user: any = { tenantId: T, colaboradorId: null, categoria: 'presidente' };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new ClienteService(drizzle(pool, { schema }) as any, {} as any, { registrar: async () => {} } as any);
    await pool.query(`insert into empresa (id, nome) values ($1,'teste import anota')`, [T]);
    // Já estava no Regem (veio de pedido integrado): nome e histórico próprios.
    await pool.query(
      `insert into cliente (tenant_id, nome, telefone, total_pedidos, ultimo_pedido_em) values ($1,'Nome do Regem','21911110001', 7, now())`,
      [T],
    );
  });
  afterAll(async () => {
    if (!pool) return;
    await pool.query(`delete from cliente where tenant_id = $1`, [T]);
    await pool.query(`delete from empresa where id = $1`, [T]);
    await pool.end();
  });

  const csvAtivos = [
    CAB,
    'Outro Nome,21911110001,5521911110001,128,0', // já existe no Regem → intocado
    'Julia,21911110002,5521911110002,67,0',
    'cliente,21911110003,,3,0', // nome genérico → sem nome
    'Lucas,75983708443,557583708443,1,0', // WhatsApp SEM o 9 → vale o telefone
    'Sem Numero,,,2,0', // inválido
    'Julia repetida,21911110002,5521911110002,67,0', // repetido no arquivo
  ].join('\n');

  it('prévia: novos × já existem, WhatsApp sem o 9 ignorado, nome genérico sem nome', async () => {
    const p: any = await svc.previewPlanilha(T, Buffer.from(csvAtivos, 'utf8'), {
      nomeArquivo: 'Clientes ativos - consulta gerada em 19_09_2026.csv',
    });
    expect(p).toMatchObject({ fonte: 'anotaai', segmento: 'ativo', total: 6, validos: 4, invalidos: 1, novos: 3, jaExistem: 1, semNome: 1 });
    expect(p.contatos.find((c: any) => c.telefone === '75983708443')).toBeTruthy();
    expect(p.contatos.find((c: any) => c.telefone === '7583708443')).toBeUndefined();
  });

  it('PDF e .xls antigo são recusados com a instrução (Excel .xlsx ou CSV)', async () => {
    await expect(svc.previewPlanilha(T, Buffer.from('%PDF-1.7'), { nomeArquivo: 'Clientes.pdf' }))
      .rejects.toThrow(/\.xlsx\) ou CSV/);
    await expect(svc.previewPlanilha(T, Buffer.from('xx'), { nomeArquivo: 'Clientes.xls' }))
      .rejects.toThrow(/\.xlsx\) ou CSV/);
  });

  it('gravar: só os novos, com a procedência; o existente fica como estava', async () => {
    const p: any = await svc.previewPlanilha(T, Buffer.from(csvAtivos, 'utf8'), {
      nomeArquivo: 'Clientes ativos - consulta.csv',
    });
    const r = await svc.importarContatos(user, p.contatos.filter((c: any) => c.novo), true, { fonte: 'anotaai', segmento: 'ativo' });
    expect(r).toMatchObject({ inseridos: 3, duplicados: 0 });

    const existente = (await pool.query(`select nome, total_pedidos, importacao from cliente where tenant_id=$1 and telefone='21911110001'`, [T])).rows;
    expect(existente).toEqual([{ nome: 'Nome do Regem', total_pedidos: 7, importacao: null }]);

    const julia = (await pool.query(`select nome, importacao, origem, consentimento_lgpd from cliente where tenant_id=$1 and telefone='21911110002'`, [T])).rows[0];
    expect(julia).toMatchObject({ nome: 'Julia', origem: 'importado', consentimento_lgpd: true });
    expect(julia.importacao).toMatchObject({ fonte: 'anotaai', segmento: 'ativo', pedidos: 67, diasInatividade: 0 });
    const semNome = (await pool.query(`select nome from cliente where tenant_id=$1 and telefone='21911110003'`, [T])).rows[0];
    expect(semNome.nome).toBeNull();
  });

  it('segunda lista (inativos) com o mesmo número não troca o segmento de quem já entrou', async () => {
    const csvInativos = [CAB, 'Julia,21911110002,5521911110002,67,45', 'Novo Inativo,21911110009,,4,90'].join('\n');
    const p: any = await svc.previewPlanilha(T, Buffer.from(csvInativos, 'utf8'), { nomeArquivo: 'Clientes inativos - consulta.csv' });
    expect(p).toMatchObject({ segmento: 'inativo', novos: 1, jaExistem: 1 });
    await svc.importarContatos(user, p.contatos.filter((c: any) => c.novo), true, { fonte: 'anotaai', segmento: 'inativo' });
    const seg = (await pool.query(`select telefone, importacao->>'segmento' s from cliente where tenant_id=$1 and importacao is not null order by telefone`, [T])).rows;
    expect(seg).toEqual([
      { telefone: '21911110002', s: 'ativo' },
      { telefone: '21911110003', s: 'ativo' },
      { telefone: '21911110009', s: 'inativo' },
      { telefone: '75983708443', s: 'ativo' },
    ]);
  });

  it('públicos novos no CRM (resumo e lista)', async () => {
    const r: any = await svc.crmResumo(T);
    expect(r).toMatchObject({ importados: 4, anotaai_ativo: 3, anotaai_inativo: 1, anotaai_potencial: 0 });
    const lista: any = await svc.crmClientes(T, { segmento: 'anotaai_inativo' } as any);
    const itens = Array.isArray(lista) ? lista : lista?.itens ?? lista?.clientes ?? lista?.rows ?? [];
    expect(itens.map((c: any) => c.telefone)).toEqual(['21911110009']);
  });
});
