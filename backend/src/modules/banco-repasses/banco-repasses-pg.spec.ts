import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CanActivate, ExecutionContext, ForbiddenException, INestApplication, Injectable, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { RolesGuard } from '../../auth/roles.guard';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { CLOUD_ONLY_MODULES } from '../../edge-manifest';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { BancoRepassesController } from './banco-repasses.controller';
import { BancoRepassesService } from './banco-repasses.service';
import { ClassificarLancamentoDto } from './dto/classificar-lancamento.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// BANCO E REPASSES (R1, mig 499) contra o Postgres real: importar SGML e XML, repetir, sobrepor, dois envios ao mesmo tempo,
// os casos do protótipo, classificar, lembrar, o gerente recusado e a outra empresa que não vê. As tabelas sobem num schema SÓ
// DESTE TESTE (LIC-088, ERR-451). Dados inventados.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('banco-repasses-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = join(__dirname, '../../../../database/migrations/499_banco_e_repasses.sql');

const NOME_CRU = 'FULANO DE TAL';
const CPF_CRU = '123.456.789-00';
const CONTA_CRUA = '98765-4';

type L = { d: string; v: string; f?: string; m: string };
const sgml = (linhas: L[], o: { conta?: string; banco?: string; de?: string; ate?: string; saldo?: string; asof?: string } = {}) =>
  Buffer.from(
    `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>${o.banco ?? '0341'}<BRANCHID>1234<ACCTID>${o.conta ?? CONTA_CRUA}<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>${o.de ?? '20261101'}[-3:BRT]<DTEND>${o.ate ?? '20261110'}235959[-3:BRT]
${linhas.map((l) => `<STMTTRN><TRNTYPE>OTHER<DTPOSTED>${l.d}120000[-3:BRT]<TRNAMT>${l.v}<FITID>${l.f ?? ''}<MEMO>${l.m}</STMTTRN>`).join('\n')}
</BANKTRANLIST><LEDGERBAL><BALAMT>${o.saldo ?? '1000,00'}<DTASOF>${o.asof ?? o.ate ?? '20261110'}</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`,
    'latin1',
  );
const xml = (linhas: L[], conta = CONTA_CRUA) =>
  Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="211"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF>
<BANKACCTFROM><BANKID>341</BANKID><ACCTID>${conta}</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261101</DTSTART><DTEND>20261110</DTEND>
${linhas.map((l) => `<STMTTRN><TRNTYPE>OTHER</TRNTYPE><DTPOSTED>${l.d}</DTPOSTED><TRNAMT>${l.v}</TRNAMT><FITID>${l.f ?? ''}</FITID><MEMO>${l.m}</MEMO></STMTTRN>`).join('\n')}
</BANKTRANLIST><LEDGERBAL><BALAMT>1000.00</BALAMT><DTASOF>20261110</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`,
    'utf8',
  );

const BASE: L[] = [
  { d: '20261101', v: '1.500,00', f: 'A1', m: `PIX RECEBIDO - ${NOME_CRU} ${CPF_CRU}` },
  { d: '20261102', v: '-250.75', f: 'A2', m: 'TARIFA PACOTE DE SERVICOS' },
  { d: '20261103', v: '800,10', f: 'A3', m: 'TED RECEBIDA IFOOD' },
  { d: '20261105', v: '-99,90', f: 'A4', m: 'DAS SIMPLES NACIONAL' },
  { d: '20261108', v: '20,00', f: 'A5', m: 'CRED STONE' },
  { d: '20261110', v: 'ilegivel', f: 'A6', m: 'LINHA RUIM' },
];

descrever('Banco e repasses (Postgres)', () => {
  const SCHEMA = `teste_banco_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: URL_PG });
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 8 });
  const db = drizzle(pool, { schema }) as any;
  const auditados: any[] = [];
  const auditoria = { registrar: jest.fn(async (e: any) => void auditados.push(e)) } as any;
  const svc = new BancoRepassesService(db, auditoria);
  const q = async (t: string, p: any[] = []) => (await pool.query(t, p)).rows;
  const empresas: string[] = [];

  const novaEmpresa = async (lojas = 1) => {
    const t = randomUUID();
    await admin.query(`insert into empresa (id, nome) values ($1, $2)`, [t, `Teste banco ${t.slice(0, 6)}`]);
    empresas.push(t);
    const ids: string[] = [];
    for (let i = 0; i < lojas; i++) {
      const u = randomUUID();
      await admin.query(`insert into unidade (id, tenant_id, nome) values ($1, $2, $3)`, [u, t, `Loja ${i + 1}`]);
      ids.push(u);
    }
    return { t, lojas: ids, user: { colaboradorId: randomUUID(), tenantId: t, categoria: 'presidente' } as any };
  };
  const linhas = (t: string) => q(`select * from banco_lancamento where tenant_id = $1 order by data, valor_centavos`, [t]);

  beforeAll(async () => {
    delete process.env.EDGE_MODE;
    await admin.query(`create schema ${SCHEMA}`);
    await repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(comTravaDaEmpresa(readFileSync(MIG, 'utf8')));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });
  });

  afterAll(async () => {
    await admin.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    if (empresas.length) {
      await admin.query(`delete from comanda where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await admin.query(`delete from unidade where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await admin.query(`delete from empresa where id = any($1::uuid[])`, [empresas]).catch(() => {});
    }
    await pool.end();
    await admin.end();
  });

  it('a migration: reaplicar não quebra, RLS ligada e sem política', async () => {
    const r: any = await repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        const res = await c.query(comTravaDaEmpresa(readFileSync(MIG, 'utf8')));
        await c.query('commit');
        return res;
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });
    const conf = (Array.isArray(r) ? r[r.length - 1] : r).rows;
    expect(conf).toHaveLength(5);
    for (const x of conf) {
      expect(x.rls).toBe(true);
      expect(Number(x.politicas)).toBe(0);
    }
    const texto = readFileSync(MIG, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/on delete cascade/gi, '');
    expect(texto).not.toMatch(/\b(drop|truncate|delete)\b/i);
    expect(readFileSync(MIG, 'utf8').startsWith('-- @cloud-only')).toBe(true);
  });

  it('SGML de ponta a ponta: conferir não grava; importar grava mascarado, sem o cru', async () => {
    const { t, lojas, user } = await novaEmpresa();
    const arq = sgml(BASE);

    const p: any = await svc.conferir(t, null, arq);
    expect(p).toMatchObject({ caso: 'ok', conta: { banco: '341', final: '7654' }, total: 5, jaEstavam: 0, novos: 5, recusados: 1, saldoFinal: 100000 });
    expect(p.entradasNovas).toBe(232010);
    expect(p.saidasNovas).toBe(35065);
    expect(await q(`select 1 from banco_conta where tenant_id = $1`, [t])).toHaveLength(0);
    expect(await q(`select 1 from banco_empresa where tenant_id = $1`, [t])).toHaveLength(0);
    expect(await linhas(t)).toHaveLength(0);

    const r: any = await svc.importar(user, null, arq);
    expect(r).toMatchObject({ novos: 5, repetidos: 0, recusados: 1 });

    const gravadas = await linhas(t);
    expect(gravadas).toHaveLength(5);
    expect(gravadas.every((x) => x.unidade_id === lojas[0])).toBe(true);
    const pix = gravadas.find((x) => Number(x.valor_centavos) === 150000);
    expect(pix.descricao).toBe('PIX RECEBIDO · F*** T*** · CPF ***.456.***-**');
    expect(pix.situacao).toBe('so_no_banco');
    expect(gravadas.find((x) => Number(x.valor_centavos) === 80010)).toMatchObject({ fonte: 'ifood', situacao: 'a_conferir' });
    expect(gravadas.find((x) => Number(x.valor_centavos) === 2000)).toMatchObject({ fonte: 'maquininha', situacao: 'a_conferir' });
    expect(gravadas.find((x) => Number(x.valor_centavos) === -25075)).toMatchObject({ fonte: 'banco', situacao: 'so_no_banco', descricao: 'TARIFA PACOTE DE SERVICOS' });

    // Nem o nome, nem o documento, nem a conta inteira em NENHUMA coluna das tabelas novas.
    const tudo = JSON.stringify([
      gravadas,
      await q(`select * from banco_conta where tenant_id = $1`, [t]),
      await q(`select * from banco_importacao where tenant_id = $1`, [t]),
    ]);
    for (const proibido of ['FULANO', CPF_CRU, '12345678900', '98765', CONTA_CRUA]) expect(tudo).not.toContain(proibido);
    expect((await q(`select final, banco from banco_conta where tenant_id = $1`, [t]))[0]).toEqual({ final: '7654', banco: '341' });

    // A auditoria: só contagens e período.
    const aud = auditados.find((a) => a.tenantId === t && a.acao === 'banco_importou_extrato');
    expect(aud.detalhe).toEqual({ novos: 5, repetidos: 0, recusados: 1, de: '2026-11-01', ate: '2026-11-10', incompleto: false });
    expect(JSON.stringify(aud)).not.toMatch(/FULANO|123\.456|98765|1500/);
  });

  it('XML de ponta a ponta', async () => {
    const { t, user } = await novaEmpresa();
    const arq = xml([
      { d: '20261102', v: '-1234.56', f: 'X1', m: 'BOLETO DIST ALIMENTOS NORTE LTDA' },
      { d: '20261104', v: '10.50', f: 'X2', m: `PIX RECEBIDO ${NOME_CRU}` },
    ]);
    expect(await svc.conferir(t, null, arq)).toMatchObject({ caso: 'ok', novos: 2, total: 2 });
    await svc.importar(user, null, arq);
    const g = await linhas(t);
    expect(g.map((x) => [String(x.data).slice(0, 10), Number(x.valor_centavos)])).toEqual([['2026-11-02', -123456], ['2026-11-04', 1050]]);
    expect(g[0].descricao).toBe('BOLETO · DIST *** LTDA');
    expect(g[1].descricao).toBe('PIX RECEBIDO · F*** T***');
  });

  it('reimportar o mesmo arquivo não cria nada, nem o registro da importação', async () => {
    const { t, user } = await novaEmpresa();
    const arq = sgml(BASE);
    await svc.importar(user, null, arq);
    const antes = await q(`select count(*)::int n from banco_importacao where tenant_id = $1`, [t]);

    const p: any = await svc.conferir(t, null, arq);
    expect(p).toMatchObject({ caso: 'repetido', novos: 0, jaEstavam: 5 });
    expect(p.jaEntrouEm).toBeTruthy();

    expect(await svc.importar(user, null, arq)).toMatchObject({ novos: 0, repetidos: 5 });
    expect(await linhas(t)).toHaveLength(5);
    expect(await q(`select count(*)::int n from banco_importacao where tenant_id = $1`, [t])).toEqual(antes);
  });

  it('período que se sobrepõe: entra só o que é novo, e a conta do saldo fecha', async () => {
    const { t, user } = await novaEmpresa();
    await svc.importar(user, null, sgml(BASE.slice(0, 5), { saldo: '1970,45', ate: '20261108' }));
    const seguinte = sgml(
      [...BASE.slice(3, 5), { d: '20261112', v: '100,00', f: 'A7', m: 'PIX RECEBIDO CARDAPIO DIGITAL' }, { d: '20261113', v: '-30,45', f: 'A8', m: 'TARIFA AVULSA' }],
      { de: '20261105', ate: '20261113', saldo: '2040,00' },
    );
    const p: any = await svc.conferir(t, null, seguinte);
    expect(p).toMatchObject({ caso: 'ok', total: 4, jaEstavam: 2, novos: 2, saldoAnterior: 197045, saldoFinal: 204000, fecha: true });
    expect(await svc.importar(user, null, seguinte)).toMatchObject({ novos: 2, repetidos: 2 });
    expect(await linhas(t)).toHaveLength(7);
  });

  it('o saldo que não fecha é dito, e nada impede importar', async () => {
    const { t, user } = await novaEmpresa();
    await svc.importar(user, null, sgml(BASE.slice(0, 2), { saldo: '100,00', ate: '20261102' }));
    const p: any = await svc.conferir(t, null, sgml([{ d: '20261105', v: '10,00', f: 'Z1', m: 'PIX RECEBIDO' }], { de: '20261103', ate: '20261105', saldo: '999,00' }));
    expect(p.fecha).toBe(false);
  });

  it('banco que repete o FITID ou manda vazio: reimportar não duplica e os dois Pix iguais continuam dois', async () => {
    const { t, user } = await novaEmpresa();
    const arq = sgml([
      { d: '20261101', v: '10,00', f: 'REPETE', m: 'PIX RECEBIDO A' },
      { d: '20261101', v: '10,00', f: 'REPETE', m: 'PIX RECEBIDO B' },
      { d: '20261102', v: '5,00', m: 'PIX RECEBIDO C' },
      { d: '20261102', v: '5,00', m: 'PIX RECEBIDO C' },
    ]);
    expect(await svc.importar(user, null, arq)).toMatchObject({ novos: 4 });
    expect(await svc.importar(user, null, arq)).toMatchObject({ novos: 0, repetidos: 4 });
    expect(await linhas(t)).toHaveLength(4);
  });

  it('DOIS ENVIOS AO MESMO TEMPO: as transações se cruzam e nada duplica (V98)', async () => {
    const { t, user } = await novaEmpresa();
    // A conta e o sal já existem: nenhuma trava de "primeira vez" põe uma importação atrás da outra antes dos lançamentos.
    await svc.importar(user, null, sgml(BASE.slice(0, 1)));
    const arq = sgml(BASE);
    // Segura as duas depois de gravarem a importação e antes dos lançamentos.
    const original = pool.connect.bind(pool);
    let chegaram = 0;
    let peloPrazo = false;
    let soltar!: () => void;
    const juntas = new Promise<void>((r) => (soltar = r));
    const prazo = setTimeout(() => {
      peloPrazo = true;
      soltar();
    }, 8000);
    (pool as any).connect = async (...a: any[]) => {
      // O `pool.query` interno usa a forma com callback: essa passa direto.
      if (typeof a[0] === 'function') return (original as any)(...a);
      const c: any = await (original as any)();
      if (c.__embrulhado) return c;
      c.__embrulhado = true;
      const q0 = c.query.bind(c);
      c.query = async (...b: any[]) => {
        const texto = typeof b[0] === 'string' ? b[0] : String(b[0]?.text ?? '');
        if (/^\s*insert into banco_lancamento/i.test(texto) && (b[0]?.values ?? b[1] ?? []).includes(t)) {
          if (++chegaram >= 2) soltar();
          await juntas;
        }
        return q0(...b);
      };
      return c;
    };
    let rs: any[];
    try {
      rs = await Promise.all([svc.importar(user, null, arq), svc.importar(user, null, arq)]);
    } finally {
      clearTimeout(prazo);
      (pool as any).connect = original;
    }
    expect(chegaram).toBe(2);
    expect(peloPrazo).toBe(false); // as duas estavam DENTRO da transação ao mesmo tempo: o cruzamento aconteceu de verdade
    expect(rs.map((r) => r.novos).sort()).toEqual([0, 4]);
    expect(await linhas(t)).toHaveLength(5);
    expect(await q(`select 1 from banco_importacao where tenant_id = $1`, [t])).toHaveLength(2); // a primeira e a que trouxe novos
  });

  it('dois primeiros envios ao mesmo tempo: uma conta, um sal, sem duplicar', async () => {
    const { t, user } = await novaEmpresa();
    const arq = sgml(BASE);
    const rs = await Promise.all([svc.importar(user, null, arq), svc.importar(user, null, arq), svc.importar(user, null, arq)]);
    expect(rs.map((r) => r.novos).sort()).toEqual([0, 0, 5]);
    expect(await linhas(t)).toHaveLength(5);
    expect(await q(`select 1 from banco_importacao where tenant_id = $1`, [t])).toHaveLength(1);
    expect(await q(`select 1 from banco_conta where tenant_id = $1`, [t])).toHaveLength(1);
    expect(await q(`select 1 from banco_empresa where tenant_id = $1`, [t])).toHaveLength(1);
  });

  it('arquivo de outra conta: diz o final das duas e não grava', async () => {
    const { t, user } = await novaEmpresa();
    await svc.importar(user, null, sgml(BASE));
    const outro = sgml(BASE, { conta: '55555-7306' });
    expect(await svc.conferir(t, null, outro)).toMatchObject({ caso: 'outra_conta', conta: { final: '7306' }, contaDaLoja: { final: '7654' } });
    await expect(svc.importar(user, null, outro)).rejects.toThrow('Esse arquivo é da conta final 7306, e a loja usa a conta final 7654. Nada foi gravado.');
    expect(await linhas(t)).toHaveLength(5);
    // Mesmo final, outro banco: também é outra conta.
    expect(await svc.conferir(t, null, sgml(BASE, { banco: '237' }))).toMatchObject({ caso: 'outra_conta' });
  });

  it('arquivo que não abre: a frase do protótipo, e não grava', async () => {
    const { t, user } = await novaEmpresa();
    expect(await svc.conferir(t, null, Buffer.from('%PDF-1.7'))).toEqual({ caso: 'nao_abre', motivo: 'Ele veio em PDF, e o Regem lê o extrato em OFX.' });
    await expect(svc.importar(user, null, Buffer.from('%PDF-1.7'))).rejects.toThrow('Não consegui abrir esse arquivo. Ele veio em PDF, e o Regem lê o extrato em OFX. Nada foi gravado.');
    expect(await q(`select 1 from banco_conta where tenant_id = $1`, [t])).toHaveLength(0);
  });

  it('arquivo sem nenhum lançamento aproveitável: não diz "repetido" e não grava', async () => {
    const { t, user } = await novaEmpresa();
    const soSaldo = sgml([{ d: '20261101', v: '500,00', f: 'S1', m: 'SALDO DO DIA' }]);
    expect(await svc.conferir(t, null, soSaldo)).toEqual({ caso: 'nao_abre', motivo: 'Ele não traz nenhum lançamento.' });
    const ilegivel = sgml([{ d: '20261101', v: 'abc', f: 'S2', m: 'PIX' }, { d: '20261102', v: 'xyz', f: 'S3', m: 'PIX' }]);
    expect(await svc.conferir(t, null, ilegivel)).toEqual({ caso: 'nao_abre', motivo: 'As 2 linhas dele têm valor ou data que não dá para ler.' });
    await expect(svc.importar(user, null, soSaldo)).rejects.toThrow('Nada foi gravado');
    expect(await q(`select 1 from banco_conta where tenant_id = $1`, [t])).toHaveLength(0);
  });

  it('período com buraco: só avisa se a loja vendeu nesses dias, e marca o período', async () => {
    const { t, lojas, user } = await novaEmpresa();
    const arq = sgml(
      [
        { d: '20261101', v: '10,00', f: 'B1', m: 'PIX RECEBIDO' },
        { d: '20261108', v: '11,00', f: 'B2', m: 'PIX RECEBIDO' },
        { d: '20261116', v: '12,00', f: 'B3', m: 'PIX RECEBIDO' },
        { d: '20261120', v: '13,00', f: 'B4', m: 'PIX RECEBIDO' },
      ],
      { ate: '20261120' },
    );
    // Sem venda no trecho: a loja estava fechada, não é buraco.
    expect(await svc.conferir(t, null, arq)).toMatchObject({ caso: 'ok', buraco: null });
    // A venda às 22h de Brasília do dia 12 cai no dia 13 em UTC: continua dentro do trecho.
    await admin.query(`insert into comanda (tenant_id, unidade_id, status, total, fechada_em) values ($1, $2, 'fechada', 50, '2026-11-13T01:00:00Z')`, [t, lojas[0]]);
    expect(await svc.conferir(t, null, arq)).toMatchObject({ caso: 'buraco', buraco: { de: '2026-11-09', ate: '2026-11-15' } });
    await svc.importar(user, null, arq);
    const imp = (await q(`select buraco_de::text d, buraco_ate::text a from banco_importacao where tenant_id = $1`, [t]))[0];
    expect(imp).toEqual({ d: '2026-11-09', a: '2026-11-15' });
  });

  it('venda de outra loja não conta para o buraco desta', async () => {
    const { t, lojas, user } = await novaEmpresa(2);
    await admin.query(`insert into comanda (tenant_id, unidade_id, status, total, fechada_em) values ($1, $2, 'fechada', 50, '2026-11-12T15:00:00Z')`, [t, lojas[1]]);
    const arq = sgml(
      [{ d: '20261101', v: '10,00', f: 'C1', m: 'PIX' }, { d: '20261120', v: '10,00', f: 'C2', m: 'PIX' }],
      { ate: '20261120' },
    );
    expect(await svc.conferir(t, lojas[0], arq)).toMatchObject({ caso: 'ok', buraco: null });
    await svc.importar(user, lojas[0], arq);
    // Cada loja tem a própria conta: a outra loja importa outra conta sem conflito, e o filtro separa.
    await svc.importar(user, lojas[1], sgml([{ d: '20261103', v: '7,00', f: 'D1', m: 'PIX' }], { conta: '11111-2222' }));
    expect((await svc.listar(t, lojas[0], {})).total).toBe(2);
    expect((await svc.listar(t, lojas[1], {})).total).toBe(1);
    expect((await svc.listar(t, null, {})).total).toBe(3);
  });

  it('empresa com várias lojas e "todas as lojas": pede para escolher; loja de outra empresa é recusada', async () => {
    const a = await novaEmpresa(2);
    const b = await novaEmpresa();
    await expect(svc.conferir(a.t, null, sgml(BASE))).rejects.toThrow('Escolha a loja');
    await expect(svc.importar(a.user, null, sgml(BASE))).rejects.toThrow('Escolha a loja');
    await expect(svc.importar(a.user, b.lojas[0], sgml(BASE))).rejects.toThrow('não é da sua empresa');
    expect(await linhas(a.t)).toHaveLength(0);
  });

  describe('classificar e lembrar', () => {
    it('classifica, marca "Não é da loja" e volta; ausente mantém; audita sem texto nem valor', async () => {
      const { t, user } = await novaEmpresa();
      await svc.importar(user, null, sgml(BASE));
      const ifood = (await linhas(t)).find((x) => Number(x.valor_centavos) === 80010);

      expect(await svc.classificar(user, null, ifood.id, { tipo: 'venda_ifood' })).toMatchObject({ tipo: 'venda_ifood', situacao: 'a_conferir', lembrado: false });
      expect(await svc.classificar(user, null, ifood.id, { tipo: 'nao_e_da_loja' })).toMatchObject({ situacao: 'nao_e_da_loja' });
      expect(await svc.classificar(user, null, ifood.id, {})).toMatchObject({ tipo: 'nao_e_da_loja', situacao: 'nao_e_da_loja' }); // ausente mantém (V16)
      expect(await svc.classificar(user, null, ifood.id, { tipo: 'outra_entrada' })).toMatchObject({ situacao: 'a_conferir' }); // volta ao que a fonte indica
      expect(await svc.classificar(user, null, ifood.id, { tipo: null })).toMatchObject({ tipo: null, situacao: 'a_conferir' });

      const aud = auditados.filter((a) => a.tenantId === t && a.acao === 'banco_classificou_lancamento');
      expect(aud).toHaveLength(5);
      expect(aud[0].detalhe).toEqual({ de: null, para: 'venda_ifood', lembrar: false });
      expect(JSON.stringify(aud)).not.toMatch(/IFOOD|800/);
    });

    it('"Lembrar para os próximos": o próximo arquivo entra com o tipo; o sentido e o lote contam certo; não guarda texto', async () => {
      const { t, user } = await novaEmpresa();
      await svc.importar(user, null, sgml([{ d: '20261101', v: '-50,00', f: 'L1', m: `PIX ENVIADO ${NOME_CRU} LOTE 1103` }, { d: '20261102', v: '70,00', f: 'L2', m: 'PIX RECEBIDO MARIA' }]));
      const [saida, entrada] = await linhas(t);
      await svc.classificar(user, null, saida.id, { tipo: 'nao_e_da_loja', lembrar: true });
      await svc.classificar(user, null, entrada.id, { tipo: 'pix_cliente', lembrar: true });

      const regras = await q(`select * from banco_regra where tenant_id = $1`, [t]);
      expect(regras).toHaveLength(2);
      expect(JSON.stringify(regras)).not.toMatch(/FULANO|MARIA|PIX/);

      await svc.importar(user, null, sgml([
        { d: '20261105', v: '-80,00', f: 'L3', m: `PIX ENVIADO ${NOME_CRU} LOTE 1106` },
        { d: '20261106', v: '80,00', f: 'L4', m: `PIX ENVIADO ${NOME_CRU} LOTE 1106` }, // o outro sentido não casa
        { d: '20261107', v: '90,00', f: 'L5', m: 'PIX RECEBIDO MARIA' },
        { d: '20261108', v: '5,00', f: 'L6', m: 'PIX RECEBIDO OUTRA PESSOA' },
      ]));
      const g = await linhas(t);
      expect(g.find((x) => Number(x.valor_centavos) === -8000)).toMatchObject({ tipo: 'nao_e_da_loja', situacao: 'nao_e_da_loja' });
      expect(g.find((x) => Number(x.valor_centavos) === 8000)).toMatchObject({ tipo: null, situacao: 'so_no_banco' });
      expect(g.find((x) => Number(x.valor_centavos) === 9000)).toMatchObject({ tipo: 'pix_cliente', situacao: 'so_no_banco' });
      expect(g.find((x) => Number(x.valor_centavos) === 500)).toMatchObject({ tipo: null });
    });

    it('lembrar sem tipo é recusado; o lançamento não muda', async () => {
      const { t, user } = await novaEmpresa();
      await svc.importar(user, null, sgml(BASE.slice(0, 1)));
      const [l] = await linhas(t);
      await expect(svc.classificar(user, null, l.id, { tipo: null, lembrar: true })).rejects.toThrow('Escolha o tipo');
      expect(await q(`select 1 from banco_regra where tenant_id = $1`, [t])).toHaveLength(0);
    });

    it('o DTO: tipo fora da lista e lembrar que não é booleano são recusados; campo estranho é descartado pela API', () => {
      const erros = (o: any) => validateSync(plainToInstance(ClassificarLancamentoDto, o), { whitelist: true });
      expect(erros({ tipo: 'fornecedor', lembrar: true })).toHaveLength(0);
      expect(erros({ tipo: null })).toHaveLength(0);
      expect(erros({})).toHaveLength(0);
      expect(erros({ tipo: 'inventado' })).toHaveLength(1);
      expect(erros({ lembrar: 'sim' })).toHaveLength(1);
    });
  });

  describe('a lista', () => {
    it('os totais, as situações (Casado e Esperado em 0), filtros, busca sem acento e paginação', async () => {
      const { t, user } = await novaEmpresa();
      await svc.importar(user, null, sgml(BASE));
      const r: any = await svc.listar(t, null, {});
      expect(r.total).toBe(5);
      expect(r.contagem).toEqual({ casado: 0, a_conferir: 2, so_no_banco: 3, esperado: 0, nao_e_da_loja: 0 });
      expect(r.totais).toEqual({ entrou: 232010, saiu: 35065, diferenca: 196945, esperado: 0 });
      expect(r.lista[0].data).toBe('2026-11-08'); // mais recente primeiro
      expect(r.fontes.comDado.sort()).toEqual(['banco', 'ifood', 'maquininha']);
      expect(r.fontes.banco.lidoAte).toBe('2026-11-10');
      expect(r.contas).toEqual([expect.objectContaining({ banco: '341', final: '7654' })]);

      const conferir: any = await svc.listar(t, null, { situacao: 'a_conferir' });
      expect(conferir.filtrados).toBe(2);
      expect(conferir.base).toBe(5); // as situações contam sobre os outros filtros
      expect(conferir.totais.entrou).toBe(82010);
      expect((await svc.listar(t, null, { fonte: 'ifood' })).lista).toHaveLength(1);
      expect((await svc.listar(t, null, { de: '2026-11-03', ate: '2026-11-05' })).filtrados).toBe(2);
      expect((await svc.listar(t, null, { busca: 'tarífa' })).filtrados).toBe(1);
      // O filtro está no `where`: a contagem não depende da página (V39).
      const p: any = await svc.listar(t, null, { limite: 2 });
      expect(p.lista).toHaveLength(2);
      expect(p.filtrados).toBe(5);
      expect((await svc.listar(t, null, { limite: 2, deslocamento: 4 })).lista).toHaveLength(1);
      // A busca não aceita curinga como curinga.
      expect((await svc.listar(t, null, { busca: '%' })).filtrados).toBe(0);
    });

    it('a tela abre no mês do último extrato (fevereiro e virada de ano inclusive)', async () => {
      const { t, user } = await novaEmpresa();
      await svc.importar(user, null, sgml([{ d: '20280110', v: '1,00', f: 'P1', m: 'PIX' }, { d: '20280215', v: '2,00', f: 'P2', m: 'PIX' }], { de: '20280110', ate: '20280215' }));
      const r: any = await svc.listar(t, null, { periodo: 'ultimo' });
      expect(r.periodo).toEqual({ de: '2028-02-01', ate: '2028-02-29' });
      expect(r.filtrados).toBe(1);
      expect(r.total).toBe(2);
      const a = await novaEmpresa();
      await svc.importar(a.user, null, sgml([{ d: '20261231', v: '1,00', f: 'P3', m: 'PIX' }], { de: '20261231', ate: '20261231' }));
      expect(((await svc.listar(a.t, null, { periodo: 'ultimo' })) as any).periodo).toEqual({ de: '2026-12-01', ate: '2026-12-31' });
    });

    it('a busca pelo nome do tipo', async () => {
      const { t, user } = await novaEmpresa();
      await svc.importar(user, null, sgml(BASE));
      const l = (await linhas(t)).find((x) => Number(x.valor_centavos) === -9990);
      await svc.classificar(user, null, l.id, { tipo: 'imposto' });
      expect((await svc.listar(t, null, { busca: 'imposto' })).lista.map((x: any) => x.id)).toEqual([l.id]);
    });

    it('filtro inválido é recusado', async () => {
      const { t } = await novaEmpresa();
      for (const f of [{ de: '2026-02-31' }, { ate: 'ontem' }, { situacao: 'x' }, { fonte: 'x' }, { de: '2026-11-10', ate: '2026-11-01' }]) await expect(svc.listar(t, null, f)).rejects.toThrow();
    });

    it('sem extrato: vazio, e o Banco "nunca"', async () => {
      const { t } = await novaEmpresa();
      expect(await svc.listar(t, null, {})).toMatchObject({ total: 0, contas: [], fontes: { banco: { situacao: 'nunca', lidoAte: null }, comDado: [] } });
    });
  });

  // A rota de verdade: o envio do arquivo (multipart), o guarda de papel e o mesmo ValidationPipe da API (V100). Só o login é
  // simulado: o usuário vem de um cabeçalho do teste.
  describe('pela API (HTTP)', () => {
    let app: INestApplication;
    let url = '';
    const como = (u: any) => ({ 'x-teste': JSON.stringify(u) });
    const enviar = (rota: string, arq: Buffer, u: any) => {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(arq)]), 'extrato.ofx');
      return fetch(`${url}/banco-repasses/${rota}`, { method: 'POST', headers: como(u), body: form });
    };
    const patch = (id: string, corpo: any, u: any) =>
      fetch(`${url}/banco-repasses/lancamentos/${id}`, { method: 'PATCH', headers: { ...como(u), 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

    const guardasDeVerdade = Reflect.getMetadata(GUARDS_METADATA, BancoRepassesController);

    beforeAll(async () => {
      @Injectable()
      class LoginDeTeste implements CanActivate {
        canActivate(ctx: ExecutionContext) {
          const r = ctx.switchToHttp().getRequest();
          r.user = JSON.parse(r.headers['x-teste'] ?? '{}');
          return true;
        }
      }
      @Module({ controllers: [BancoRepassesController], providers: [{ provide: BancoRepassesService, useValue: svc }] })
      class ModuloDeTeste {}
      // Troca só o login; o guarda de papel continua o de verdade.
      expect(guardasDeVerdade).toEqual([JwtAuthGuard, RolesGuard]);
      Reflect.defineMetadata(GUARDS_METADATA, [LoginDeTeste, RolesGuard], BancoRepassesController);
      app = await NestFactory.create(ModuloDeTeste, { logger: false });
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
      await app.listen(0, '127.0.0.1');
      url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    });
    afterAll(async () => {
      Reflect.defineMetadata(GUARDS_METADATA, guardasDeVerdade, BancoRepassesController);
      await app?.close();
    });

    it('SGML e XML de ponta a ponta: conferir, importar, listar e classificar', async () => {
      const { t, user } = await novaEmpresa();
      const r1 = await enviar('importar/conferir', sgml(BASE), user);
      expect(r1.status).toBe(201);
      expect(await r1.json()).toMatchObject({ caso: 'ok', novos: 5, recusados: 1 });
      expect(await linhas(t)).toHaveLength(0);

      const r2 = await enviar('importar', sgml(BASE), user);
      expect(await r2.json()).toMatchObject({ novos: 5, repetidos: 0 });
      const r3 = await enviar('importar', xml([{ d: '20261109', v: '-10.00', f: 'X9', m: `PIX ENVIADO ${NOME_CRU}` }]), user);
      expect(await r3.json()).toMatchObject({ novos: 1 });

      const lista: any = await (await fetch(`${url}/banco-repasses?limite=50`, { headers: como(user) })).json();
      expect(lista.total).toBe(6);
      expect(JSON.stringify(lista)).not.toMatch(/FULANO|123\.456\.789|98765/);

      const alvo = lista.lista.find((x: any) => x.valor === -1000);
      expect(alvo.descricao).toBe('PIX ENVIADO · F*** T***');
      const ok = await patch(alvo.id, { tipo: 'retirada_dono', lembrar: true, campoEstranho: 'x' }, user);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ tipo: 'retirada_dono', lembrado: true });
      expect((await patch(alvo.id, { tipo: 'inventado' }, user)).status).toBe(400);
      expect((await patch(alvo.id, { lembrar: 'sim' }, user)).status).toBe(400);
      expect((await patch('nao-e-uuid', { tipo: 'folha' }, user)).status).toBe(400);
    });

    it('sem arquivo e arquivo que não é OFX: recusa clara', async () => {
      const { user } = await novaEmpresa();
      const vazio = await fetch(`${url}/banco-repasses/importar`, { method: 'POST', headers: como(user), body: new FormData() });
      expect(vazio.status).toBe(400);
      expect((await vazio.json()).message).toBe('Escolha o arquivo do extrato.');
      const pdf = await enviar('importar', Buffer.from('%PDF-1.7'), user);
      expect(pdf.status).toBe(400);
      expect((await pdf.json()).message).toContain('Ele veio em PDF');
      const conf = await enviar('importar/conferir', Buffer.from('%PDF-1.7'), user);
      expect(await conf.json()).toMatchObject({ caso: 'nao_abre' });
    });

    it('arquivo de outra conta na gravação: 409 com a frase', async () => {
      const { user } = await novaEmpresa();
      await enviar('importar', sgml(BASE), user);
      const r = await enviar('importar', sgml(BASE, { conta: '55555-7306' }), user);
      expect(r.status).toBe(409);
      expect((await r.json()).message).toContain('conta final 7306');
    });

    it.each(['gerente', 'suporte', 'supervisao', 'execucao'])('%s: 403 em TODA rota, sem nenhum dado na resposta', async (categoria) => {
      const dono = await novaEmpresa();
      await svc.importar(dono.user, null, sgml(BASE));
      const [l] = await linhas(dono.t);
      const outro = { colaboradorId: randomUUID(), tenantId: dono.t, categoria };
      const respostas = [
        await fetch(`${url}/banco-repasses`, { headers: como(outro) }),
        await enviar('importar/conferir', sgml(BASE), outro),
        await enviar('importar', sgml(BASE), outro),
        await patch(l.id, { tipo: 'folha' }, outro),
      ];
      for (const r of respostas) {
        expect(r.status).toBe(403);
        const corpo = await r.text();
        expect(corpo).not.toMatch(/total|contagem|lista|valor|final/);
      }
      expect((await linhas(dono.t)).every((x) => x.tipo === null)).toBe(true);
    });
  });

  describe('quem pode', () => {
    it('OUTRA EMPRESA não lê, não classifica nem enxerga pela loja', async () => {
      const a = await novaEmpresa();
      const b = await novaEmpresa();
      await svc.importar(a.user, null, sgml(BASE));
      const [l] = await linhas(a.t);
      expect(await svc.listar(b.t, null, {})).toMatchObject({ total: 0, lista: [], contas: [] });
      expect(await svc.listar(b.t, a.lojas[0], {})).toMatchObject({ total: 0, lista: [] });
      await expect(svc.classificar(b.user, null, l.id, { tipo: 'folha' })).rejects.toThrow('não encontrado');
      expect((await q(`select tipo from banco_lancamento where id = $1`, [l.id]))[0].tipo).toBeNull();
    });

    it('a outra empresa com o mesmo arquivo tem chaves próprias (o sal é da empresa)', async () => {
      const a = await novaEmpresa();
      const b = await novaEmpresa();
      await svc.importar(a.user, null, sgml(BASE));
      await svc.importar(b.user, null, sgml(BASE));
      const ca = (await linhas(a.t)).map((x) => x.chave).sort();
      const cb = (await linhas(b.t)).map((x) => x.chave).sort();
      expect(ca).toHaveLength(5);
      expect(cb).toHaveLength(5);
      expect(ca.filter((x) => cb.includes(x))).toHaveLength(0);
    });

    const contexto = (categoria: string, handler: any): ExecutionContext =>
      ({ getHandler: () => handler, getClass: () => BancoRepassesController, switchToHttp: () => ({ getRequest: () => ({ user: { categoria, tenantId: 'x' } }) }) }) as any;

    it.each(['listar', 'conferir', 'importar', 'classificar'])('rota "%s": só o presidente passa; gerente, suporte e os demais são recusados', (nome) => {
      const guard = new RolesGuard(new Reflector());
      const h = (BancoRepassesController.prototype as any)[nome];
      expect(guard.canActivate(contexto('presidente', h))).toBe(true);
      for (const c of ['gerente', 'suporte', 'supervisao', 'execucao']) expect(() => guard.canActivate(contexto(c, h))).toThrow(ForbiddenException);
    });

    it('a classe inteira exige presidente, com os guardas, e é só da nuvem', () => {
      expect(Reflect.getMetadata(ROLES_KEY, BancoRepassesController)).toEqual(['presidente']);
      expect(Reflect.getMetadata(CLOUD_ONLY, BancoRepassesController)).toBe(true);
      expect(Reflect.getMetadata(GUARDS_METADATA, BancoRepassesController)).toEqual(expect.arrayContaining([RolesGuard]));
      expect(CLOUD_ONLY_MODULES as readonly string[]).toContain('BancoRepassesModule');
    });
  });
});
