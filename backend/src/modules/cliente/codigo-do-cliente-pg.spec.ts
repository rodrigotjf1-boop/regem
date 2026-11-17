import { createHash, randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { HttpException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ClienteService } from './cliente.service';
import { juntarNaGravacao } from '../../common/juntar-na-gravacao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// SEGUNDA RODADA DA AVALIAÇÃO DE SEGURANÇA (16/11/2026).
//
// B-02 — o código do cliente (WhatsApp): a tentativa era lida, comparada e só depois gravada (dez palpites em paralelo
// num código de cinco, o contador terminando em 1), e cada pedido de código apagava o anterior e zerava as tentativas,
// sem intervalo por telefone. Aqui com o serviço e o Postgres de verdade, os pedidos disparados AO MESMO TEMPO.
//
// B-03 — a exportação de clientes: o nome é o cliente quem escreve no cardápio; "=1+1" saía como fórmula no CSV e na
// "planilha" (uma página HTML com extensão .xls).

const sha = (codigo: string) => createHash('sha256').update(codigo).digest('hex');
const frases = (rs: PromiseSettledResult<unknown>[]) => rs.map((r) => (r.status === 'fulfilled' ? 'ok' : String((r.reason as Error)?.message)));
const quantas = (lista: string[], frase: string) => lista.filter((f) => f === frase).length;

/** O texto de um arquivo de dentro do .xlsx (um ZIP): lê o diretório central e descomprime a entrada. */
function arquivoDoXlsx(zip: Buffer, nome: string): string {
  const fim = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = zip.readUInt32LE(fim + 16);
  for (let i = 0; i < zip.readUInt16LE(fim + 10); i++) {
    const tamanhoComprimido = zip.readUInt32LE(p + 20);
    const tamanhoDoNome = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const este = zip.subarray(p + 46, p + 46 + tamanhoDoNome).toString('utf8');
    if (este === nome) {
      const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      return inflateRawSync(zip.subarray(inicio, inicio + tamanhoComprimido)).toString('utf8');
    }
    p += 46 + tamanhoDoNome + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  throw new Error(`o .xlsx não tem ${nome}`);
}

describe('exportação de clientes: o nome não vira fórmula (B-03)', () => {
  const svc = new ClienteService({} as any, {} as any, {} as any) as any;
  const linhas = svc.linhasExport([
    { nome: '=1+1', telefone: '21999990001', total_pedidos: 2, total_gasto: '51.00', ultimo_pedido_em: '2026-11-10T15:00:00Z', canais: ['proprio'] },
    { nome: '@SUM(A1:A9)', telefone: '21999990002', total_pedidos: 0, total_gasto: '0', canais: [] },
    { nome: '+55 da Maria', telefone: '21999990003', total_pedidos: 1, total_gasto: '10', canais: ['ifood', '99food'] },
    { nome: '-João; "o Zé"', telefone: '21999990004', total_pedidos: 1, total_gasto: '10', canais: [] },
    { nome: 'Ana <b>Lima</b> & cia', telefone: '21999990005', total_pedidos: 3, total_gasto: '90.5', canais: [] },
  ]);

  it('CSV: o nome que começa com = + - @ sai com o apóstrofo; o resto, como era', () => {
    const csv: string = svc.gerarCsv(linhas).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const corpo = csv.slice(1).split('\r\n');
    expect(corpo[0]).toBe('Nome;Telefone;Pedidos;Último pedido;Ticket médio;Total gasto;Canais');
    expect(corpo[1].startsWith(`'=1+1;21999990001;2;`)).toBe(true);
    expect(corpo[2].startsWith(`'@SUM(A1:A9);21999990002;0;`)).toBe(true);
    expect(corpo[3].startsWith(`'+55 da Maria;21999990003;1;`)).toBe(true);
    expect(corpo[4].startsWith(`"'-João; ""o Zé""";21999990004;1;`)).toBe(true);
    expect(corpo[5].startsWith('Ana <b>Lima</b> & cia;21999990005;3;')).toBe(true);
    // nenhuma célula começa com um caractere que o Excel ou o LibreOffice tratam como fórmula
    for (const linha of corpo.slice(1).filter(Boolean)) {
      for (const celula of linha.split(';')) expect(celula.replace(/^"/, '')).not.toMatch(/^[=+\-@\t\r]/);
    }
  });

  it('Excel: sai um .xlsx de verdade, com o nome como TEXTO dentro da célula e os números como número', () => {
    const xlsx: Buffer = svc.gerarXlsx(linhas);
    expect(xlsx.subarray(0, 2).toString('latin1')).toBe('PK');
    const folha = arquivoDoXlsx(xlsx, 'xl/worksheets/sheet1.xml');
    // texto: `inlineStr` (o Excel não avalia); fórmula teria a marca <f>
    expect(folha).not.toContain('<f>');
    expect(folha).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">=1+1</t></is></c>');
    expect(folha).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">@SUM(A1:A9)</t></is></c>');
    expect(folha).toContain('<t xml:space="preserve">Ana &lt;b&gt;Lima&lt;/b&gt; &amp; cia</t>');
    // o telefone é texto (não perde zero nem vira notação científica); pedidos, ticket e total são números
    expect(folha).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">21999990001</t></is></c>');
    expect(folha).toContain('<c r="C2"><v>2</v></c>');
    expect(folha).toContain('<c r="E2"><v>25.5</v></c>');
    expect(folha).toContain('<c r="F2"><v>51</v></c>');
  });

  it('a exportação "excel" devolve o arquivo .xlsx (e não mais a página HTML com extensão .xls)', async () => {
    const auditados: any[] = [];
    const s = new ClienteService({} as any, {} as any, { registrar: async (a: any) => auditados.push(a) } as any) as any;
    s.crmClientes = async () => [{ nome: '=1+1', telefone: '21999990001', total_pedidos: 1, total_gasto: '10', canais: [] }];
    const r = await s.exportar({ tenantId: 't', colaboradorId: 'c', categoria: 'presidente' }, { formato: 'excel' });
    expect(r.filename).toMatch(/^clientes-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(r.mime).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const arquivo = Buffer.from(r.base64, 'base64');
    expect(arquivo.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(arquivo.toString('latin1')).not.toContain('<html');
    const csv = await s.exportar({ tenantId: 't', colaboradorId: 'c', categoria: 'presidente' }, { formato: 'csv' });
    expect(Buffer.from(csv.base64, 'base64').toString('utf8')).toContain(`'=1+1;21999990001;1;`);
    expect(auditados.map((a) => a.acao)).toEqual(['clientes.exportar', 'clientes.exportar']);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('codigo-do-cliente-pg.spec: sem TEST_PG_URL — a parte com Postgres foi PULADA');

jest.setTimeout(60_000);

descrever('código do cliente: o teto vale com pedidos em paralelo (B-02, Postgres real)', () => {
  let pool: Pool;
  let svc: ClienteService;
  const T = randomUUID();
  const TOKEN = `teste-codigo-${randomUUID()}`;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const segredoAntes = process.env.CLIENTE_TOKEN_SECRET;
  let seq = 0;
  const telefoneNovo = () => `2197000${String(1000 + seq++)}`;
  /** Um código conhecido já gravado para o telefone (o de verdade vai por WhatsApp). */
  const comCodigo = async (tel: string, codigo: string, o: { haSeg?: number } = {}) =>
    q(
      `insert into cliente_otp (tenant_id, telefone, codigo_hash, expira_em, criado_em)
       values ($1, $2, $3, now() + interval '5 minutes', now() - make_interval(secs => $4))`,
      [T, tel, sha(codigo), o.haSeg ?? 0],
    );
  const otps = (tel: string) => q(`select codigo_hash, tentativas from cliente_otp where tenant_id = $1 and telefone = $2`, [T, tel]);

  beforeAll(async () => {
    if (!process.env.JWT_SECRET && !segredoAntes) process.env.CLIENTE_TOKEN_SECRET = `teste-${randomUUID()}`;
    pool = new Pool({ connectionString: URL_PG, max: 20 });
    // sem webhook configurado: o código é gerado e não é enviado (o serviço só avisa no log)
    svc = new ClienteService(drizzle(pool, { schema }) as any, {} as any, { registrar: async () => {} } as any);
    await q(`insert into empresa (id, nome) values ($1,'teste código do cliente')`, [T]);
    await q(`insert into cardapio_config (tenant_id, token, ativo) values ($1,$2,true)`, [T, TOKEN]);
  });
  afterAll(async () => {
    if (segredoAntes === undefined) delete process.env.CLIENTE_TOKEN_SECRET;
    if (!pool) return;
    for (const tabela of ['cliente_otp', 'cliente_endereco', 'cliente', 'cardapio_config']) await q(`delete from ${tabela} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });

  it('dez palpites errados ao mesmo tempo: só cinco são comparados, e o contador termina em 5', async () => {
    const tel = telefoneNovo();
    await comCodigo(tel, '123456');
    // as dez gravações do contador saem JUNTAS (sem isto, em fila, o contador antigo passava por sorte)
    const desfazer = juntarNaGravacao(pool, 'cliente_otp', 10);
    let r: string[];
    try {
      r = frases(await Promise.allSettled(Array.from({ length: 10 }, (_, i) => svc.confirmarOtp(TOKEN, { telefone: tel, codigo: `90000${i}`, nome: 'Ana' }))));
    } finally {
      desfazer();
    }
    expect(quantas(r, 'Código incorreto.')).toBe(5);
    expect(quantas(r, 'Muitas tentativas. Peça um novo código.')).toBe(5);
    expect((await otps(tel))[0].tentativas).toBe(5);
    // esgotadas as tentativas, nem o código certo entra
    await expect(svc.confirmarOtp(TOKEN, { telefone: tel, codigo: '123456', nome: 'Ana' })).rejects.toThrow('Muitas tentativas. Peça um novo código.');
    expect(await q(`select 1 from cliente where tenant_id = $1 and telefone = $2`, [T, tel])).toHaveLength(0);
  });

  it('o código certo duas vezes ao mesmo tempo cria UM cliente (a tabela não tem índice único por telefone)', async () => {
    const tel = telefoneNovo();
    await comCodigo(tel, '222222');
    const r = await Promise.allSettled([
      svc.confirmarOtp(TOKEN, { telefone: tel, codigo: '222222', nome: 'Bia' }),
      svc.confirmarOtp(TOKEN, { telefone: tel, codigo: '222222', nome: 'Bia' }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(frases(r).filter((f) => f !== 'ok')).toEqual(['Código expirado. Peça um novo.']);
    expect(await q(`select 1 from cliente where tenant_id = $1 and telefone = $2`, [T, tel])).toHaveLength(1);
    expect(await otps(tel)).toHaveLength(0);
  });

  it('código certo sem o nome de quem ainda não tem cadastro: pede o nome e o código segue valendo', async () => {
    const tel = telefoneNovo();
    await comCodigo(tel, '333333');
    await expect(svc.confirmarOtp(TOKEN, { telefone: tel, codigo: '333333' })).rejects.toThrow('Informe seu nome.');
    const r: any = await svc.confirmarOtp(TOKEN, { telefone: tel, codigo: '333333', nome: 'Caio' });
    expect(r.cliente).toMatchObject({ nome: 'Caio', telefone: tel });
    expect(r.clienteToken).toBeTruthy();
  });

  it('código vencido ou que não existe: "expirado", sem contar tentativa', async () => {
    const tel = telefoneNovo();
    await expect(svc.confirmarOtp(TOKEN, { telefone: tel, codigo: '123456', nome: 'Davi' })).rejects.toThrow('Código expirado. Peça um novo.');
    await comCodigo(tel, '444444');
    await q(`update cliente_otp set expira_em = now() - interval '1 second' where tenant_id = $1 and telefone = $2`, [T, tel]);
    await expect(svc.confirmarOtp(TOKEN, { telefone: tel, codigo: '444444', nome: 'Davi' })).rejects.toThrow('Código expirado. Peça um novo.');
    expect((await otps(tel))[0].tentativas).toBe(0);
  });

  it('pedir código de novo dentro do minuto não troca o código nem devolve as tentativas', async () => {
    const tel = telefoneNovo();
    await comCodigo(tel, '555555');
    await q(`update cliente_otp set tentativas = 5 where tenant_id = $1 and telefone = $2`, [T, tel]);
    const r: any = await svc.enviarOtp(TOKEN, tel);
    expect(r).toMatchObject({ ok: true, enviado: true });
    expect(await otps(tel)).toEqual([{ codigo_hash: sha('555555'), tentativas: 5 }]);
    // era o contorno: pedir outro código e ganhar mais cinco palpites
    await expect(svc.confirmarOtp(TOKEN, { telefone: tel, codigo: '555555', nome: 'Eva' })).rejects.toThrow('Muitas tentativas. Peça um novo código.');
  });

  it('depois de um minuto, o pedido gera um código novo; dois pedidos ao mesmo tempo gravam UM código', async () => {
    const tel = telefoneNovo();
    await comCodigo(tel, '666666', { haSeg: 120 });
    const r = await Promise.all([svc.enviarOtp(TOKEN, tel), svc.enviarOtp(TOKEN, tel)]);
    for (const x of r) expect(x.ok).toBe(true);
    const linhas = await otps(tel);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].codigo_hash).not.toBe(sha('666666'));
    expect(linhas[0].tentativas).toBe(0);
  });

  it('no máximo cinco códigos novos por telefone a cada 15 minutos; o recusado não apaga o código que a pessoa tem', async () => {
    const tel = telefoneNovo();
    const envelhecer = () => q(`update cliente_otp set criado_em = now() - interval '2 minutes' where tenant_id = $1 and telefone = $2`, [T, tel]);
    for (let i = 0; i < 5; i++) {
      await envelhecer();
      await expect(svc.enviarOtp(TOKEN, tel)).resolves.toMatchObject({ ok: true });
    }
    await envelhecer();
    const [antes] = await otps(tel);
    const erro: any = await svc.enviarOtp(TOKEN, tel).catch((e) => e);
    expect(erro).toBeInstanceOf(HttpException);
    expect(erro.getStatus()).toBe(429);
    expect(erro.message).toBe('Muitos códigos pedidos para este número. Tente de novo em alguns minutos.');
    expect(await otps(tel)).toEqual([antes]);
    // outro telefone não é afetado
    await expect(svc.enviarOtp(TOKEN, telefoneNovo())).resolves.toMatchObject({ ok: true });
  });
});
