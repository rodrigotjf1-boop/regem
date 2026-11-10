import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { hojeISO } from '../../common/data';
import { ModuloService } from '../modulo/modulo.service';
import { VagasService } from './vagas.service';
import { fichaValida } from './vagas-exemplo-spec';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Vagas e candidatos (F1, mig 389) contra Postgres de verdade: a página (nasce desligada), a ficha pública, o reenvio pelo
// mesmo WhatsApp, as recusas, o isolamento por empresa e loja, o histórico, "Apagar dados" (LGPD) e o expurgo. A 389 é
// @cloud-only: o banco do CI (de loja) não a tem — a spec aplica com a trava da empresa (ERR-329, ERR-377).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('vagas-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(90_000);
const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('vagas · página, ficha e base (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let svc: VagasService;
  const auditoria: any[] = [];
  const T = randomUUID();
  const T2 = randomUUID();
  let lojaA = '';
  let lojaB = '';
  let lojaC = '';
  let codigo = '';
  const sufixo = randomUUID().slice(0, 6);
  const NOME_LOJA = `Burger Teste ${sufixo}`;
  const gerente = (tenantId = T) => ({ tenantId, colaboradorId: randomUUID(), categoria: 'gerente', nome: 'Ana Gerente' }) as any;

  const q = async (texto: string, params: unknown[] = []) => (await pool.query(texto, params)).rows as any[];
  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        const r: any = await c.query(comTravaDaEmpresa(readFileSync(MIG(arq), 'utf8')));
        await c.query('commit');
        return r;
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });
  const contar = async (tab: string, id: string) => Number((await q(`select count(*)::int as n from ${tab} where candidato_id = $1`, [id]))[0].n);

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM (V44)
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    await aplicar('389_vagas_e_candidatos.sql');
    const registrar = { registrar: async (e: any) => void auditoria.push(e) } as any;
    svc = new VagasService(db, registrar, new ModuloService(db, registrar));
    await q(`insert into empresa (id, nome) values ($1, 'teste vagas'), ($2, 'outra empresa das vagas')`, [T, T2]);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: lojaB }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja B') returning id`, [T]);
    [{ id: lojaC }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja C') returning id`, [T2]);
    await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico, logo_ref, documento)
       values ($1, $2, $3, true, $4, 'https://exemplo.test/logo.png', '11.222.333/0001-00')`,
      [T, lojaA, `tok-vagas-${randomUUID()}`, NOME_LOJA],
    );
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico) values ($1, $2, $3, true, $4)`, [
      T2, lojaC, `tok-vagas-${randomUUID()}`, NOME_LOJA,
    ]);
  });
  afterAll(async () => {
    if (!pool) return;
    for (const t of [T, T2]) {
      for (const tab of ['candidato', 'vaga_qr', 'vaga_pagina', 'modulo_ativacao', 'cardapio_config', 'unidade'])
        await q(`delete from ${tab} where tenant_id = $1`, [t]).catch(() => {});
      await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await pool.end();
  });
  beforeEach(() => {
    auditoria.length = 0;
  });

  it('a 389 é idempotente e a conferência vem toda ok', async () => {
    const r: any = await aplicar('389_vagas_e_candidatos.sql');
    const conferencia = (Array.isArray(r) ? r[r.length - 1] : r).rows;
    expect(conferencia.length).toBeGreaterThanOrEqual(6);
    expect(conferencia.filter((l: any) => l.ok !== true)).toEqual([]);
  });

  it('a página nasce desligada: o público não acha; salvar cria o código e os QR iniciais', async () => {
    const p0 = await svc.pagina(T, lojaA);
    expect([p0.criada, p0.codigo, p0.pagina.ligada]).toEqual([false, null, false]);
    expect(p0.loja.nome).toBe(NOME_LOJA);
    await expect(svc.pagina(T, null)).rejects.toThrow(BadRequestException); // presidente na rede: escolher a loja

    const funcoes = p0.pagina.funcoes.map((f: any) =>
      f.codigo === 'gerencia' ? { ...f, aberta: false } : { ...f, salario: f.salario || 'R$ 1.900,00' },
    );
    const p1 = await svc.salvarPagina(gerente(), lojaA, { funcoes, beneficios: ['Vale-refeição: R$ 150,00'] });
    codigo = p1.codigo!;
    expect(codigo.startsWith('burger-teste')).toBe(true);
    expect(auditoria.map((a) => a.acao)).toEqual(['vagas.pagina.criada']);
    await expect(svc.paginaPublica(codigo)).rejects.toThrow(NotFoundException); // ainda desligada

    await svc.salvarPagina(gerente(), lojaA, { ligada: true });
    const pub: any = await svc.paginaPublica(codigo);
    expect(pub.loja).toEqual({ nome: NOME_LOJA, logoRef: 'https://exemplo.test/logo.png', logoEmoji: null });
    expect(pub.pagina.funcoes.map((f: any) => f.codigo)).toEqual(['chapeiro', 'auxiliar', 'atendimento', 'supervisao']);
    expect(pub.pagina.funcoes[0]).toEqual({ codigo: 'chapeiro', nome: 'Chapeiro(a)', salario: 'R$ 1.900,00', lideranca: false });
    expect(pub.termos.guarda).toContain(NOME_LOJA);
    // Nada além do que a loja publica: nem o documento da loja, nem ajustes internos.
    expect(JSON.stringify(pub)).not.toContain('11.222.333');
    expect(JSON.stringify(pub)).not.toContain('"aberta"');

    const qrs = await svc.qrs(T, lojaA);
    expect(qrs.map((x: any) => x.codigo)).toEqual(['instagram', 'anuncios', 'salao']);
  });

  it('o mesmo nome de loja em outra empresa ganha outro endereço — e a empresa de loja única salva sem escolher a loja', async () => {
    // Empresa de UMA loja: o UnidadeUnicaInterceptor zera a loja em uso (null) — a página é a da única loja (V86).
    const p = await svc.salvarPagina(gerente(T2), null, { ligada: true });
    expect(p.codigo).not.toBe(codigo);
    expect(p.codigo!.startsWith('burger-teste')).toBe(true);
    expect((await q(`select unidade_id from vaga_pagina where tenant_id = $1`, [T2])).map((x) => x.unidade_id)).toEqual([lojaC]);
    expect((await svc.qrs(T2, null)).map((x: any) => x.codigo)).toEqual(['instagram', 'anuncios', 'salao']);
    // Loja de OUTRA empresa ou id inválido: 404, nunca erro de chave no banco (500).
    await expect(svc.pagina(T, lojaC)).rejects.toThrow(NotFoundException);
    await expect(svc.salvarPagina(gerente(T), lojaC, { ligada: true })).rejects.toThrow(NotFoundException);
    await expect(svc.pagina(T, 'nao-e-um-id')).rejects.toThrow(NotFoundException);
  });

  let idMaria = '';
  it('recebe a ficha: grava experiências, cursos e histórico, e responde só o protocolo', async () => {
    const r = await svc.receberFicha(codigo, { ...fichaValida(), origem: 'salao' });
    expect(Object.keys(r).sort()).toEqual(['protocolo', 'reenvio']);
    expect(r.reenvio).toBe(false);
    expect(r.protocolo).toMatch(/^[A-Z2-9]{6}$/);

    const lista = await svc.lista(T, lojaA);
    expect(lista).toHaveLength(1);
    const l = lista[0];
    idMaria = l.id;
    expect([l.telefone, l.experiencias, l.temCarteira, l.jaLiderou, l.valorIda, l.valorVolta, l.origem, l.origemNome]).toEqual([
      '2133330000', 1, true, true, 4.7, 18, 'salao', 'Salão',
    ]);
    expect(l.funcoes).toEqual(['chapeiro', 'supervisao']);
    expect(l.meios).toEqual(['publico', 'uber']);

    const f: any = await svc.ficha(T, lojaA, idMaria);
    expect(f.nascimento).toBe('2000-05-10');
    expect(f.experiencias.map((x: any) => x.tipo).sort()).toEqual(['lideranca', 'trabalho']);
    expect(f.cursos).toEqual([{ nome: 'Barista', onde: 'SENAC', situacao: 'fazendo' }]);
    expect(f.historico.map((h: any) => h.tipo)).toEqual(['recebida']);
    expect(f.comunicacao.aceitaEm).toBeNull();
    const [{ esperado }] = await q(`select (($1::date + interval '12 months')::date)::text as esperado`, [hojeISO()]);
    expect(f.expurgoEm).toBe(esperado);
    expect((await svc.qrs(T, lojaA)).find((x: any) => x.codigo === 'salao')?.fichas).toBe(1);
  });

  it('o reenvio com o mesmo WhatsApp (com o 55) atualiza a MESMA ficha e troca as experiências', async () => {
    const antes = (await svc.ficha(T, lojaA, idMaria)) as any;
    const r = await svc.receberFicha(codigo, fichaValida({
      whatsapp: '+55 21 3333-0000',
      exps: [
        { empresa: 'A', funcao: 'Chapeiro', tempo: '2a', vinculo: 'carteira', atual: true },
        { empresa: 'B', funcao: 'Atendente', tempo: 'ate6m', vinculo: 'informal' },
      ],
      comunicacao: true,
    }));
    expect(r).toEqual({ protocolo: antes.protocolo, reenvio: true });
    const f: any = await svc.ficha(T, lojaA, idMaria);
    expect(f.experiencias.filter((x: any) => x.tipo === 'trabalho').map((x: any) => x.empresa)).toEqual(['A', 'B']);
    expect(f.historico.map((h: any) => h.tipo)).toEqual(['recebida', 'reenviada', 'comunicacao']);
    expect(f.comunicacao.aceitaEm).not.toBeNull();
    expect(f.origem).toBe('salao'); // o reenvio sem marca não apaga de onde veio

    await svc.receberFicha(codigo, fichaValida({ comunicacao: false }));
    const g: any = await svc.ficha(T, lojaA, idMaria);
    expect(g.comunicacao.canceladaEm).not.toBeNull();
    expect(g.historico.filter((h: any) => h.tipo === 'comunicacao').map((h: any) => h.texto)).toEqual([
      'Autorizou receber mensagens e e-mails',
      'Cancelou o recebimento de mensagens e e-mails',
    ]);
    expect(await svc.lista(T, lojaA)).toHaveLength(1);
  });

  it('recusa abaixo da idade e sem consentimento; o campo-isca responde e não grava', async () => {
    await expect(svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0101', nascimento: '2012-01-01' }))).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0102', consentimento: false }))).rejects.toThrow(
      BadRequestException,
    );
    const isca = await svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0103', site: 'http://spam' }));
    expect(isca.protocolo).toMatch(/^[A-Z2-9]{6}$/);
    expect(await svc.lista(T, lojaA)).toHaveLength(1);
    await expect(svc.receberFicha('nao-existe', fichaValida())).rejects.toThrow(NotFoundException);
  });

  it('com o módulo desligado na loja, a página pública some', async () => {
    await q(`insert into modulo_ativacao (tenant_id, unidade_id, modulo, ativo) values ($1, $2, 'vagas', false)`, [T, lojaA]);
    try {
      await expect(svc.paginaPublica(codigo)).rejects.toThrow(NotFoundException);
      await expect(svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0104' }))).rejects.toThrow(NotFoundException);
    } finally {
      await q(`delete from modulo_ativacao where tenant_id = $1 and modulo = 'vagas'`, [T]);
    }
    await expect(svc.paginaPublica(codigo)).resolves.toBeTruthy();
  });

  it('cada loja só vê as próprias fichas; o presidente na rede vê todas as da empresa', async () => {
    expect((await svc.lista(T2, null)).map((l: any) => l.id)).not.toContain(idMaria);
    await expect(svc.ficha(T, lojaB, idMaria)).rejects.toThrow(NotFoundException);
    await expect(svc.ficha(T2, null, idMaria)).rejects.toThrow(NotFoundException);
    await expect(svc.mudarSituacao(gerente(T2), null, idMaria, { situacao: 'analise' })).rejects.toThrow(NotFoundException);
    const rede = await svc.lista(T, null);
    expect(rede.map((l: any) => l.id)).toContain(idMaria);
    expect(rede.find((l: any) => l.id === idMaria)?.loja).toBe('Loja A');
  });

  it('situação, anotação e entrevista entram no histórico; a situação vai à auditoria', async () => {
    await svc.mudarSituacao(gerente(), lojaA, idMaria, { situacao: 'analise' });
    await svc.mudarSituacao(gerente(), lojaA, idMaria, { situacao: 'analise' }); // a mesma: nada novo
    await expect(svc.mudarSituacao(gerente(), lojaA, idMaria, { situacao: 'demitido' })).rejects.toThrow(BadRequestException);
    expect(auditoria.map((a) => [a.acao, a.detalhe])).toEqual([['candidato.situacao', { de: 'novo', para: 'analise' }]]);
    await svc.anotar(gerente(), lojaA, idMaria, { texto: 'Comunicativa, já usou chapa a gás.' });
    await svc.marcarEntrevista(gerente(), lojaA, idMaria, { quando: '2026-11-14T18:00:00.000Z' });
    const f: any = await svc.ficha(T, lojaA, idMaria);
    expect(f.situacao).toBe('entrevista');
    expect(new Date(f.entrevistaEm).toISOString()).toBe('2026-11-14T18:00:00.000Z');
    const ultimos = f.historico.slice(-4).map((h: any) => [h.tipo, h.de, h.para, h.autorNome]);
    expect(ultimos).toEqual([
      ['situacao', 'novo', 'analise', 'Ana Gerente'],
      ['anotacao', null, null, 'Ana Gerente'],
      ['situacao', 'analise', 'entrevista', 'Ana Gerente'],
      ['entrevista', null, '2026-11-14T18:00:00.000Z', 'Ana Gerente'],
    ]);
  });

  it('"Apagar dados" leva a ficha e tudo dela; a auditoria não guarda nome nem telefone', async () => {
    await svc.apagar(gerente(), lojaA, idMaria);
    expect(await q(`select id from candidato where id = $1`, [idMaria])).toEqual([]);
    for (const tab of ['candidato_experiencia', 'candidato_curso', 'candidato_evento']) expect(await contar(tab, idMaria)).toBe(0);
    expect(auditoria.map((a) => a.acao)).toEqual(['candidato.apagar']);
    const registro = JSON.stringify(auditoria[0]);
    expect(registro).not.toContain('Maria');
    expect(registro).not.toContain('33330000');
    await expect(svc.ficha(T, lojaA, idMaria)).rejects.toThrow(NotFoundException);
  });

  it('o expurgo apaga só o vencido e não contratado, e só das empresas pedidas', async () => {
    const nova = async (tel: string, cod = codigo) => {
      await svc.receberFicha(cod, fichaValida({ whatsapp: tel }));
      const [l] = await q(`select id from candidato where telefone = $1 order by criado_em desc limit 1`, [tel.replace(/\D/g, '')]);
      return l.id as string;
    };
    const vencida = await nova('(21) 3333-0201');
    const contratada = await nova('(21) 3333-0202');
    const emDia = await nova('(21) 3333-0203');
    const [{ codigo: codigoC }] = await q(`select codigo from vaga_pagina where tenant_id = $1`, [T2]);
    const outraEmpresa = await nova('(21) 3333-0204', codigoC);
    await q(`update candidato set expurgo_em = '2020-01-01' where id = any($1::uuid[])`, [[vencida, contratada, outraEmpresa]]);
    await q(`update candidato set situacao = 'contratado' where id = $1`, [contratada]);

    const r = await svc.expurgar({ tenantIds: [T] });
    expect(r.apagadas).toBe(1);
    const sobrou = (await q(`select id from candidato where id = any($1::uuid[])`, [[vencida, contratada, emDia, outraEmpresa]])).map((l) => l.id);
    expect(sobrou.sort()).toEqual([contratada, emDia, outraEmpresa].sort());
    expect(auditoria.map((a) => [a.tenantId, a.acao, a.detalhe.apagadas])).toEqual([[T, 'candidato.expurgo', 1]]);
    expect((await svc.expurgar({ tenantIds: [T] })).apagadas).toBe(0); // idempotente
  });
});
