import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { hojeISO } from '../../common/data';
import { ModuloService } from '../modulo/modulo.service';
import { ColaboradorService } from '../colaborador/colaborador.service';
import { VagasService } from './vagas.service';
import { MisterRelatoriosService } from '../mister/mister-relatorios.service';
import { fichaValida } from './vagas-exemplo-spec';
import { baseDoApp, paginaParaORobo } from './pagina-para-o-robo';

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
    await aplicar('397_candidato_distancia.sql'); // F2: o serviço grava as colunas da distância (ERR-273: toda spec que monta a 389)
    await aplicar('427_candidato_confirmacao.sql'); // F3b: as colunas da confirmação da ficha (ERR-273)
    const registrar = { registrar: async (e: any) => void auditoria.push(e) } as any;
    svc = new VagasService(db, registrar, new ModuloService(db, registrar), new ColaboradorService(db, registrar));
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

  // F3: no assunto "vaga" em "Explica as vagas e manda o link", o robô explica a página da loja e manda o link — a mesma
  // régua da página pública (ligada e com o módulo ligado). Sem página, null: o robô deixa o recado.
  it('F3: a página que o robô explica — a ligada da loja, com o resumo e o link; desligada, sem módulo ou ambígua = null', async () => {
    const modulos = new ModuloService(db, { registrar: async () => {} } as any);
    const ligado = (t: string, u: string) => modulos.ativo(t, u, 'vagas');
    const p = await paginaParaORobo(db, T, lojaA, ligado);
    expect(p?.url).toBe(`${baseDoApp()}/v/${codigo}`);
    expect(p?.resumo).toContain('Funções abertas: Chapeiro(a) (R$ 1.900,00)');
    expect(p?.resumo).not.toContain('Gerência'); // fechada na página
    expect(p?.resumo).toContain('Benefícios: Vale-refeição: R$ 150,00.');
    // O cardápio da empresa inteira: a única página ligada da empresa. A loja B não tem página.
    expect((await paginaParaORobo(db, T, null, ligado))?.url).toBe(p?.url);
    expect(await paginaParaORobo(db, T, lojaB, ligado)).toBeNull();
    // A outra empresa tem a página dela (lojaC): nunca a desta.
    expect((await paginaParaORobo(db, T2, null, ligado))?.url).not.toBe(p?.url);
    // Módulo desligado na loja.
    await q(`insert into modulo_ativacao (tenant_id, unidade_id, modulo, ativo) values ($1, $2, 'vagas', false)`, [T, lojaA]);
    try {
      expect(await paginaParaORobo(db, T, lojaA, ligado)).toBeNull();
    } finally {
      await q(`delete from modulo_ativacao where tenant_id = $1 and modulo = 'vagas'`, [T]);
    }
    // Duas páginas ligadas na empresa e o cardápio da empresa inteira: o robô não escolhe a loja.
    await svc.salvarPagina(gerente(), lojaB, { ligada: true });
    try {
      expect(await paginaParaORobo(db, T, null, ligado)).toBeNull();
      expect((await paginaParaORobo(db, T, lojaA, ligado))?.url).toBe(p?.url);
    } finally {
      await q(`delete from vaga_qr where tenant_id = $1 and unidade_id = $2`, [T, lojaB]);
      await q(`delete from vaga_pagina where tenant_id = $1 and unidade_id = $2`, [T, lojaB]);
    }
    // Desligada: null; ligada de novo, volta.
    await svc.salvarPagina(gerente(), lojaA, { ligada: false });
    try {
      expect(await paginaParaORobo(db, T, lojaA, ligado)).toBeNull();
    } finally {
      await svc.salvarPagina(gerente(), lojaA, { ligada: true });
    }
    expect((await paginaParaORobo(db, T, lojaA, ligado))?.url).toBe(p?.url);
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

  // F4: Contratar cria o colaborador com o que a ficha tem, pelo MESMO cadastro de Cadastros › Colaboradores.
  it('F4: Contratar cria o colaborador e liga a ficha — com "Cadastros", uma vez só; a recusa do cadastro devolve a situação', async () => {
    const funcoes: string[] = [];
    const fichas: string[] = [];
    const colaboradores: string[] = [];
    const comCadastros = () => ({ ...gerente(), permissoes: { candidatos: true, cadastros: true } }) as any;
    try {
      const [{ id: chapeiro }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Chapeiro', 'execucao') returning id`, [T]);
      const [{ id: gerencia }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Supervisor de cozinha', 'gerente') returning id`, [T]);
      funcoes.push(chapeiro, gerencia);
      const r = await svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0150', nome: 'Joana Contratada Teste' }));
      const [{ id }] = await q(`select id from candidato where tenant_id = $1 and protocolo = $2`, [T, r.protocolo]);
      fichas.push(id);

      // "Contratado" pela situação comum: não — é o Contratar que cria o colaborador.
      await expect(svc.mudarSituacao(gerente(), lojaA, id, { situacao: 'contratado' })).rejects.toThrow('use "Contratar"');
      // Gerente sem "Cadastros": recusa, e a ficha fica como estava.
      await expect(svc.contratar(gerente(), lojaA, id)).rejects.toThrow(ForbiddenException);
      expect((await q(`select situacao from candidato where id = $1`, [id]))[0].situacao).toBe('novo');

      auditoria.length = 0;
      const c = await svc.contratar(comCadastros(), lojaA, id);
      colaboradores.push(c.colaboradorId);
      // A ficha de exemplo: Chapeiro e Supervisão, "tanto faz" na 12x36 → CLT na 12x36, com a função Chapeiro da loja.
      expect(c).toMatchObject({ ok: true, funcao: 'Chapeiro(a)', funcaoAchada: true, vinculo: 'clt', jornadaTipo: '12x36' });
      const [col] = await q(`select nome, vinculo, jornada_tipo, unidade_id from colaborador where id = $1`, [c.colaboradorId]);
      expect(col).toEqual({ nome: 'Joana Contratada Teste', vinculo: 'clt', jornada_tipo: '12x36', unidade_id: lojaA });
      expect((await q(`select funcao_id from colaborador_funcao where colaborador_id = $1`, [c.colaboradorId])).map((x) => x.funcao_id)).toEqual([chapeiro]);
      expect((await q(`select situacao, colaborador_id from candidato where id = $1`, [id]))[0]).toEqual({ situacao: 'contratado', colaborador_id: c.colaboradorId });
      expect(auditoria.map((a) => a.acao)).toContain('candidato.contratado');
      const f: any = await svc.ficha(T, lojaA, id);
      expect(f.historico.at(-1)).toMatchObject({ tipo: 'situacao', de: 'novo', para: 'contratado' });
      // Uma vez só: a segunda vez recusa e não cria outro colaborador.
      await expect(svc.contratar(comCadastros(), lojaA, id)).rejects.toThrow(ConflictException);
      expect((await q(`select count(*)::int as n from colaborador where tenant_id = $1 and nome = 'Joana Contratada Teste'`, [T]))[0].n).toBe(1);

      // A recusa do cadastro (gerente não cadastra gerente): a ficha volta à situação de antes e nenhum colaborador nasce.
      const r2 = await svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0151', nome: 'Paulo Gerente Teste', funcoes: ['supervisao'], tipo: 'fixa', escala: '5x2' }));
      const [{ id: id2 }] = await q(`select id from candidato where tenant_id = $1 and protocolo = $2`, [T, r2.protocolo]);
      fichas.push(id2);
      await svc.mudarSituacao(gerente(), lojaA, id2, { situacao: 'aprovado' });
      await expect(svc.contratar(comCadastros(), lojaA, id2)).rejects.toThrow(ForbiddenException);
      expect((await q(`select situacao, colaborador_id from candidato where id = $1`, [id2]))[0]).toEqual({ situacao: 'aprovado', colaborador_id: null });
      expect((await q(`select count(*)::int as n from colaborador where tenant_id = $1 and nome = 'Paulo Gerente Teste'`, [T]))[0].n).toBe(0);
    } finally {
      for (const c of colaboradores) {
        await q(`delete from colaborador_funcao where colaborador_id = $1`, [c]).catch(() => {});
        await q(`delete from colaborador where id = $1`, [c]).catch(() => {});
      }
      for (const id of fichas) await q(`delete from candidato where id = $1`, [id]).catch(() => {});
      for (const id of funcoes) await q(`delete from funcao where id = $1`, [id]).catch(() => {});
    }
  });

  // F5b: a condução dos aprovados (protótipo aprovado em 15/11/2026): o valor que informaram × os dias da escala.
  it('F5b: a condução soma os aprovados e os contratados nos últimos 30 dias da loja; sem valor ou escala a definir, fora da soma', async () => {
    const fichas: string[] = [];
    const colaboradores: string[] = [];
    const nova = async (extra: Record<string, any>) => {
      const r = await svc.receberFicha(codigo, fichaValida(extra));
      const [{ id }] = await q(`select id from candidato where tenant_id = $1 and protocolo = $2`, [T, r.protocolo]);
      fichas.push(id);
      return id as string;
    };
    const contratadoHa = async (id: string, dias: number, colaborador: string | null = null) => {
      await q(`update candidato set situacao = 'contratado', colaborador_id = $2 where id = $1`, [id, colaborador]);
      await q(
        `insert into candidato_evento (candidato_id, tenant_id, tipo, de, para, texto, criado_em)
         values ($1, $2, 'situacao', 'aprovado', 'contratado', 'Contratado', now() - make_interval(days => $3::int))`,
        [id, T, dias],
      );
    };
    try {
      // 12x36 (a ficha de exemplo: R$ 4,70 + R$ 18,00 = R$ 22,70 por dia) → 15 dias = R$ 340,50.
      const doze = await nova({ whatsapp: '(21) 3333-0160', nome: 'Ana Doze Teste' });
      // Horista de sexta, sábado e domingo, R$ 5 + R$ 5 → 3 × 4,3 = 12,9 dias = R$ 129,00.
      const horista = await nova({ whatsapp: '(21) 3333-0161', nome: 'Bruno Horista Teste', tipo: 'horista', dias: ['sex', 'sab', 'dom'], valor_ida: '5,00', valor_volta: '5,00' });
      // Vaga fixa "12x36 ou 5x2": a escala ainda é a definir — aparece, fora da soma.
      const tanto = await nova({ whatsapp: '(21) 3333-0162', nome: 'Carla Tanto Teste', tipo: 'fixa', escala: 'tanto' });
      // A pé, sem valor informado — aparece, fora da soma.
      const ape = await nova({ whatsapp: '(21) 3333-0163', nome: 'Davi Ape Teste', meio: ['pe'], conducoes: null, uber_motivo: '', valor_ida: '', valor_volta: '' });
      for (const id of [doze, horista, tanto, ape]) await svc.mudarSituacao(gerente(), lojaA, id, { situacao: 'aprovado' });
      // Contratado há 10 dias, com o colaborador na 5x2 (a jornada combinada vale sobre a escala da ficha): 22 dias.
      const [{ id: col }] = await q(`insert into colaborador (tenant_id, nome, jornada_tipo, unidade_id) values ($1, 'Eva Contratada Teste', '5x2', $2) returning id`, [T, lojaA]);
      colaboradores.push(col);
      const contratado = await nova({ whatsapp: '(21) 3333-0164', nome: 'Eva Contratada Teste' });
      await contratadoHa(contratado, 10, col);
      // Contratado há 40 dias e ficha nova: não entram.
      const antigo = await nova({ whatsapp: '(21) 3333-0165', nome: 'Fabio Antigo Teste' });
      await contratadoHa(antigo, 40);
      const novo = await nova({ whatsapp: '(21) 3333-0166', nome: 'Gil Novo Teste' });

      const r: any = await svc.conducao(T, lojaA);
      const ids = r.pessoas.map((p: any) => p.id);
      expect(ids).toEqual(expect.arrayContaining([doze, horista, tanto, ape, contratado]));
      expect(ids).not.toContain(antigo);
      expect(ids).not.toContain(novo);
      const de = (id: string) => r.pessoas.find((p: any) => p.id === id);
      expect(de(doze)).toMatchObject({ porDia: 22.7, diasNoMes: 15, porMes: 340.5, escala: '12x36', motivo: null });
      expect(de(horista)).toMatchObject({ porDia: 10, diasNoMes: 12.9, porMes: 129, escala: 'horista', motivo: null });
      expect(de(tanto)).toMatchObject({ porMes: null, motivo: 'escala_a_definir' });
      expect(de(ape)).toMatchObject({ porDia: null, porMes: null, motivo: 'sem_valor' });
      expect(de(contratado)).toMatchObject({ situacao: 'contratado', diasNoMes: 22, porMes: 499.4, escala: '5x2' });
      expect(r).toMatchObject({ porMes: 968.9, porDia: 55.4, somadas: 3, foraDaSoma: 2 });
      // Outra loja e outra empresa não veem; o presidente na rede vê as da empresa.
      expect((await svc.conducao(T, lojaB)).pessoas.map((p: any) => p.id)).not.toContain(doze);
      expect((await svc.conducao(T2, null)).pessoas.map((p: any) => p.id)).not.toContain(doze);
      expect((await svc.conducao(T, null)).pessoas.map((p: any) => p.id)).toContain(doze);
    } finally {
      for (const id of fichas) await q(`delete from candidato where id = $1`, [id]).catch(() => {});
      for (const c of colaboradores) await q(`delete from colaborador where id = $1`, [c]).catch(() => {});
    }
  });

  // F4c: o resumo das fichas novas pelo Mister. A leitura (`fichasDaPessoa`) mora no serviço dos relatórios, mas o banco é o
  // das vagas: o teste fica nesta spec, que já aplica a cadeia 389 → 397 → 427 (ERR-451). O escopo do Mister e o módulo de
  // vagas são dublês — o fluxo do relatório (a vez, o convite, o toque) está na spec do Mister.
  it('F4c: as fichas novas da janela, só das lojas que a pessoa vê, com a permissão e o módulo; nome com a inicial, sem telefone', async () => {
    const fichas: string[] = [];
    const paginaAntes = (await q(`select funcoes from vaga_pagina where tenant_id = $1 and unidade_id = $2`, [T, lojaA]))[0].funcoes;
    const nova = async (whatsapp: string, nome: string, recebido: string, extra: Record<string, any> = {}, onde: { tenant?: string; loja?: string } = {}) => {
      const r = await svc.receberFicha(codigo, fichaValida({ whatsapp, nome, ...extra }));
      const [{ id }] = await q(`select id from candidato where tenant_id = $1 and protocolo = $2`, [T, r.protocolo]);
      fichas.push(id);
      await q(
        `update candidato set recebido_em = ($2::timestamp at time zone 'America/Sao_Paulo'), tenant_id = $3, unidade_id = $4 where id = $1`,
        [id, recebido, onde.tenant ?? T, onde.loja ?? lojaA],
      );
      return id as string;
    };
    let escopo: any = null;
    let desligada = '';
    const relatorios = new MisterRelatoriosService(
      db,
      null as any,
      null as any,
      { escopo: async () => escopo } as any,
      null as any,
      undefined,
      { ativo: async (_t: string, loja: string, modulo: string) => modulo === 'vagas' && loja !== desligada } as any,
    );
    const devido = { referencia: '2026-03-11', ate: '2026-03-11', hora: '09:00' };
    const presidente = { nivel: 'presidente', nome: 'Ana Paula', semLoja: false, permissoes: {}, lojas: [{ id: lojaA, nome: 'Loja A' }, { id: lojaB, nome: 'Loja B' }] };
    try {
      const a1 = await nova('(21) 3333-0170', 'Bruno Silva Santos', '2026-03-10 10:00', { funcoes: ['chapeiro'], tipo: 'fixa', escala: '12x36', comeca: 'imediato' });
      await q(`update candidato set distancia_km = 4.2 where id = $1`, [a1]);
      await nova('(21) 3333-0171', 'Larissa Moura', '2026-03-11 08:59', { funcoes: ['auxiliar'], tipo: 'horista', dias: ['sex', 'sab'] });
      await nova('(21) 3333-0172', 'Fora Depois Teste', '2026-03-11 09:00'); // = o fim da janela: fica para o dia seguinte
      await nova('(21) 3333-0173', 'Fora Antes Teste', '2026-03-10 08:59');
      await nova('(21) 3333-0174', 'Kaua Pereira', '2026-03-10 12:00', { funcoes: ['chapeiro'], tipo: 'fixa', escala: '5x2' }, { loja: lojaB });
      await nova('(21) 3333-0175', 'Outra Empresa Teste', '2026-03-10 12:00', {}, { tenant: T2, loja: lojaC });
      // A página da loja A passa a chamar o chapeiro de outro jeito: o nome dela vence o de fábrica (a "auxiliar", que
      // sai da página, fica com o nome de fábrica).
      await q(`update vaga_pagina set funcoes = $3::jsonb where tenant_id = $1 and unidade_id = $2`, [
        T, lojaA, JSON.stringify([{ codigo: 'chapeiro', nome: 'Chapeiro de lanche', salario: '', lideranca: false, aberta: true }]),
      ]);

      // Presidente: as duas lojas, na ordem de chegada, com a loja em cada linha.
      escopo = presidente;
      const r1 = await relatorios.fichasDaPessoa(T, 'c', 't', devido);
      expect(r1?.total).toBe(3);
      const linhas1 = r1!.texto.split('\n');
      expect(linhas1[0]).toBe('Bom dia, Ana! Chegaram *3 fichas novas* nas Páginas de vagas das suas lojas desde ontem às 9h:');
      expect(linhas1.filter((l) => l.startsWith('• '))).toEqual([
        '• Bruno S. — Chapeiro de lanche · 12x36 · 4,2 km · começa já · Loja A',
        '• Kaua P. — Chapeiro(a) · 5x2 · Loja B',
        '• Larissa M. — Auxiliar de cozinha · horista · Loja A',
      ]);
      expect(r1!.texto).toMatch(/Ver as fichas: https?:\/\/\S+\/candidatos$/);
      // Telefone e endereço ficam no Regem.
      expect(r1!.texto).not.toMatch(/3333|0170|Rua|rua /);

      // O módulo de vagas desligado na loja B: só a loja A.
      desligada = lojaB;
      const r2 = await relatorios.fichasDaPessoa(T, 'c', 't', devido);
      expect(r2?.total).toBe(2);
      expect(r2!.texto).toContain('Chegaram *2 fichas novas* na Página de vagas da Loja A desde ontem às 9h:');
      desligada = '';

      // Gerente da loja A: com a permissão Candidatos vê as dela; sem, nada.
      escopo = { ...presidente, nivel: 'gerente', nome: 'Carlos', lojas: [{ id: lojaA, nome: 'Loja A' }], permissoes: { candidatos: true } };
      expect((await relatorios.fichasDaPessoa(T, 'c', 't', devido))?.total).toBe(2);
      escopo = { ...escopo, permissoes: { candidatos: false } };
      expect(await relatorios.fichasDaPessoa(T, 'c', 't', devido)).toBeNull();
      // Sem acesso ao Mister ou sem loja: nada.
      escopo = null;
      expect(await relatorios.fichasDaPessoa(T, 'c', 't', devido)).toBeNull();
      escopo = { ...presidente, semLoja: true };
      expect(await relatorios.fichasDaPessoa(T, 'c', 't', devido)).toBeNull();

      // Dia sem ficha: nada (o resumo não sai).
      escopo = presidente;
      expect(await relatorios.fichasDaPessoa(T, 'c', 't', { referencia: '2026-03-20', ate: '2026-03-20', hora: '09:00' })).toBeNull();
      // Em UTC a janela é a mesma: o horário é o da operação, escrito na consulta (V46).
      const c = await pool.connect();
      try {
        await c.query(`set timezone = 'UTC'`);
        const dbUtc = drizzle(c as any, { schema });
        const emUtc = new MisterRelatoriosService(dbUtc, null as any, null as any, { escopo: async () => presidente } as any, null as any, undefined, { ativo: async () => true } as any);
        expect((await emUtc.fichasDaPessoa(T, 'c', 't', devido))?.total).toBe(3);
      } finally {
        await c.query(`reset timezone`).catch(() => {});
        c.release();
      }
    } finally {
      for (const id of fichas) await q(`delete from candidato where id = $1`, [id]).catch(() => {});
      await q(`update vaga_pagina set funcoes = $3::jsonb where tenant_id = $1 and unidade_id = $2`, [T, lojaA, JSON.stringify(paginaAntes)]);
    }
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

  // ── F2: a distância até a loja (mig 397) — o mapa é o OSRM da VPS; aqui o Nominatim e o OSRM são de mentira ─────────
  describe('F2 · a distância até a loja', () => {
    const PONTO_DA_LOJA = { lat: -22.9, lng: -43.2 };
    const PONTO_DO_CANDIDATO = { lat: -22.95, lng: -43.25 };
    let localizar: jest.SpyInstance;
    let rota: jest.SpyInstance;
    const idDe = async (tel: string) => (await q(`select id from candidato where tenant_id = $1 and telefone = $2`, [T, tel.replace(/\D/g, '')]))[0].id as string;
    // Roda a rotina até não sobrar o que medir agora (cada volta reserva antes de medir).
    const medirTudo = async () => {
      for (let i = 0; i < 6; i++) {
        const r = await svc.medirPendentes(50);
        if (!r.medidas && !r.falhas) return;
      }
    };
    const daLista = async (id: string) => (await svc.lista(T, lojaA)).find((l: any) => l.id === id);

    beforeAll(async () => {
      await q(`update cardapio_config set end_lat = $3, end_lng = $4 where tenant_id = $1 and unidade_id = $2`, [T, lojaA, PONTO_DA_LOJA.lat, PONTO_DA_LOJA.lng]);
      // o que já estava na base (as outras specs desta empresa) sai da frente: medido de mentira
      await q(`update candidato set distancia_em = now() where distancia_em is null`);
    });
    beforeEach(() => {
      localizar = jest.spyOn(svc as any, 'localizar').mockResolvedValue(PONTO_DO_CANDIDATO);
      rota = jest.spyOn(svc as any, 'rotaDeCarro').mockResolvedValue({ metros: 12345, segundos: 1490 });
    });
    afterEach(() => jest.restoreAllMocks());

    it('a 397 é idempotente e a conferência vem toda ok', async () => {
      const r: any = await aplicar('397_candidato_distancia.sql');
      const conferencia = (Array.isArray(r) ? r[r.length - 1] : r).rows;
      expect(conferencia.length).toBe(3);
      expect(conferencia.filter((l: any) => l.ok !== true)).toEqual([]);
    });

    it('mede depois de gravar: a lista e a ficha mostram km e minutos; o mesmo endereço no reenvio mantém, outro zera', async () => {
      await svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0301' }));
      const id = await idDe('(21) 3333-0301');
      expect(await daLista(id)).toMatchObject({ distanciaKm: null, minutosCarro: null, distanciaMedindo: true, distanciaFalha: null });
      expect(localizar).not.toHaveBeenCalled(); // o candidato não espera pela medida

      await medirTudo();
      expect(rota).toHaveBeenCalledWith(PONTO_DO_CANDIDATO, PONTO_DA_LOJA);
      expect(await daLista(id)).toMatchObject({ distanciaKm: 12.3, minutosCarro: 25, distanciaMedindo: false, distanciaFalha: null });
      expect((await svc.ficha(T, lojaA, id)).distancia).toMatchObject({ km: 12.3, minutos: 25, falha: null, medindo: false });
      const [p] = await q(`select lat, lng from candidato where id = $1`, [id]);
      expect([p.lat, p.lng]).toEqual([PONTO_DO_CANDIDATO.lat, PONTO_DO_CANDIDATO.lng]);

      await svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0301' })); // mesmo endereço
      expect((await svc.ficha(T, lojaA, id)).distancia).toMatchObject({ km: 12.3, medindo: false });
      await svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0301', numero: '999' })); // outro endereço
      expect((await svc.ficha(T, lojaA, id)).distancia).toMatchObject({ km: null, minutos: null, medindo: true });
      await medirTudo();
      expect((await svc.ficha(T, lojaA, id)).distancia).toMatchObject({ km: 12.3, medindo: false });
    });

    it('sem o ponto da loja: o motivo aparece, para em 3 tentativas; "Medir de novo" depois do ponto mede na hora', async () => {
      await q(`update cardapio_config set end_lat = null, end_lng = null where tenant_id = $1 and unidade_id = $2`, [T, lojaA]);
      try {
        await svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0302' }));
        const id = await idDe('(21) 3333-0302');
        for (let i = 0; i < 4; i++) {
          await medirTudo();
          await q(`update candidato set distancia_tentada_em = now() - interval '1 hour' where id = $1`, [id]); // passa a espera
        }
        const [t] = await q(`select distancia_tentativas from candidato where id = $1`, [id]);
        expect(t.distancia_tentativas).toBe(3);
        expect(await daLista(id)).toMatchObject({ distanciaKm: null, distanciaFalha: 'sem_ponto_da_loja', distanciaMedindo: false });
        expect(localizar).not.toHaveBeenCalled(); // sem a loja no mapa nem busca o endereço

        await q(`update cardapio_config set end_lat = $3, end_lng = $4 where tenant_id = $1 and unidade_id = $2`, [T, lojaA, PONTO_DA_LOJA.lat, PONTO_DA_LOJA.lng]);
        expect(await svc.medirDeNovo(T, lojaA, id)).toMatchObject({ km: 12.3, minutos: 25, falha: null, medindo: false });
        await expect(svc.medirDeNovo(T2, null, id)).rejects.toThrow(NotFoundException); // outra empresa não mexe
      } finally {
        await q(`update cardapio_config set end_lat = $3, end_lng = $4 where tenant_id = $1 and unidade_id = $2`, [T, lojaA, PONTO_DA_LOJA.lat, PONTO_DA_LOJA.lng]);
      }
    });

    it('endereço que o mapa não acha e mapa fora: cada um com o seu motivo (o ponto achado fica)', async () => {
      localizar.mockResolvedValueOnce(null);
      await svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0303' }));
      await medirTudo();
      expect(await daLista(await idDe('(21) 3333-0303'))).toMatchObject({ distanciaKm: null, distanciaFalha: 'endereco_nao_achado', distanciaMedindo: true });

      rota.mockResolvedValueOnce(null);
      await svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0304' }));
      await medirTudo();
      const id = await idDe('(21) 3333-0304');
      expect(await daLista(id)).toMatchObject({ distanciaKm: null, distanciaFalha: 'mapa_fora' });
      const [p] = await q(`select lat from candidato where id = $1`, [id]);
      expect(p.lat).toBe(PONTO_DO_CANDIDATO.lat);
    });

    it('o candidato muda o endereço enquanto a rotina mede: a medida do endereço velho não grava', async () => {
      await svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0305' }));
      const id = await idDe('(21) 3333-0305');
      localizar.mockImplementationOnce(async () => {
        await svc.receberFicha(codigo, fichaValida({ whatsapp: '(21) 3333-0305', numero: '777' })); // reenvio no meio
        return PONTO_DO_CANDIDATO;
      });
      await svc.medirPendentes(50);
      expect((await svc.ficha(T, lojaA, id)).distancia).toMatchObject({ km: null, falha: null, medindo: true });
      await medirTudo(); // a rotina mede o endereço novo
      const [c] = await q(`select numero, distancia_km::float8 as km from candidato where id = $1`, [id]);
      expect([c.numero, c.km]).toEqual(['777', 12.3]);
    });
  });
});
