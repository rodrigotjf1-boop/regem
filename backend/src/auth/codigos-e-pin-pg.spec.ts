import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { AuditoriaService } from '../modules/auditoria/auditoria.service';
import { enviarCodigoVerificacao } from '../common/mailer';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../common/corrida-de-catalogo';
import { juntarNaGravacao } from '../common/juntar-na-gravacao';
import { AuthService } from './auth.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// SEGUNDA RODADA DA AVALIAÇÃO DE SEGURANÇA (16/11/2026, B-02): os contadores de tentativa liam, comparavam e só depois
// gravavam. Em paralelo, todos liam o mesmo número e passavam juntos do teto: dez palpites num código de cinco, três
// reenvios dentro do mesmo minuto, doze PINs comparados antes de a primeira falha contar. Cada teste abaixo dispara os
// pedidos AO MESMO TEMPO, com o serviço e o Postgres de verdade, e falha no código anterior.

jest.mock('../common/mailer', () => ({ enviarCodigoVerificacao: jest.fn(async () => undefined) }));
const enviados = enviarCodigoVerificacao as jest.Mock;

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
// A limpeza apaga cada empresa de teste em cascata (umas 160 tabelas filhas): com o banco ocupado, passa dos 5 s padrão.
jest.setTimeout(60_000);
if (!URL_PG) console.warn('codigos-e-pin-pg.spec: sem TEST_PG_URL — PULADO');

const frases = (rs: PromiseSettledResult<unknown>[]) => rs.map((r) => (r.status === 'fulfilled' ? 'ok' : String((r.reason as Error)?.message)));
const quantas = (lista: string[], frase: string | RegExp) => lista.filter((f) => (typeof frase === 'string' ? f === frase : frase.test(f))).length;

descrever('códigos e PIN: o teto vale com pedidos em paralelo (Postgres real)', () => {
  let pool: Pool;
  let db: any;
  let auth: AuthService;
  const jwt = new JwtService({ secret: 'segredo-de-teste', signOptions: { expiresIn: '12h' } });
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const emails: string[] = [];
  const empresas: string[] = [];

  /** Um CNPJ de teste com os dígitos verificadores certos, diferente a cada chamada. */
  function cnpjDeTeste(): string {
    const base = String(Math.floor(Math.random() * 1e8)).padStart(8, '0') + '0001';
    const dv = (txt: string) => {
      let soma = 0;
      let pos = txt.length - 7;
      for (const ch of txt) {
        soma += Number(ch) * pos--;
        if (pos < 2) pos = 9;
      }
      const r = soma % 11;
      return r < 2 ? 0 : 11 - r;
    };
    const d1 = dv(base);
    return `${base}${d1}${dv(base + String(d1))}`;
  }

  /** Um cadastro esperando o código (como o `registrarInicio` deixa), com o código conhecido. */
  async function pendente(codigo: string, o: { reenviadoHaSeg?: number } = {}) {
    const email = `rodada2-${randomUUID().slice(0, 8)}@exemplo.invalid`;
    const cnpj = cnpjDeTeste();
    emails.push(email);
    const payload = { empresaNome: 'Empresa de teste da rodada 2', cnpj, nome: 'Pessoa de teste', email, usuario: `u${randomUUID().slice(0, 8)}`, senhaHash: await bcrypt.hash('senha-de-teste', 4), endereco: null };
    await q(
      `insert into cadastro_pendente (email, cnpj, codigo_hash, payload, expira_em, reenviado_em)
       values ($1, $2, $3, $4, now() + interval '15 minutes', now() - make_interval(secs => $5))`,
      [email, cnpj, await bcrypt.hash(codigo, 4), JSON.stringify(payload), o.reenviadoHaSeg ?? 600],
    );
    return { email, cnpj };
  }

  async function loja() {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [t, `PIN teste ${t.slice(0, 6)}`]);
    empresas.push(t);
    const [{ id: unidade }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja de teste') returning id`, [t]);
    const [{ id: funcao }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'atendente de teste', 'execucao') returning id`, [t]);
    await q(`insert into colaborador (tenant_id, nome, funcao_id, unidade_id, pin_hash) values ($1, 'Pessoa de teste', $2, $3, $4)`, [t, funcao, unidade, await bcrypt.hash('4321', 4)]);
    return { t, unidade };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, max: 20 });
    db = drizzle(pool, { schema });
    auth = new (AuthService as any)(db, jwt, new AuditoriaService(db)) as AuthService;
    // O cadastro pendente é tabela só da nuvem (mig 193) e o banco do CI é o de uma loja: o teste aplica a migration
    // (idempotente), com a trava da empresa na frente como toda spec que aplica migration no banco dividido (ERR-377).
    await repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(comTravaDaEmpresa(readFileSync(join(__dirname, '../../../database/migrations/193_cadastro_pendente.sql'), 'utf8')));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });
  });
  beforeEach(() => enviados.mockClear());
  afterAll(async () => {
    await q(`delete from cadastro_pendente where email = any($1)`, [emails]);
    const criadas = await q(`select tenant_id from colaborador where email = any($1)`, [emails]);
    // limpeza do que der: o registro de auditoria é só de acréscimo (a falha de PIN gravada aqui fica, como nas outras specs)
    for (const id of [...empresas, ...criadas.map((c: any) => c.tenant_id)]) {
      for (const tabela of ['colaborador', 'perfil_acesso', 'funcao', 'unidade']) await q(`delete from ${tabela} where tenant_id = $1`, [id]).catch(() => {});
      await q(`delete from empresa where id = $1`, [id]).catch(() => {});
    }
    await pool.end();
  });

  it('código do cadastro: dez palpites errados ao mesmo tempo — só cinco são comparados', async () => {
    const { email } = await pendente('123456');
    // as dez gravações do contador saem JUNTAS (sem isto, em fila, o contador antigo passava por sorte)
    const desfazer = juntarNaGravacao(pool, 'cadastro_pendente', 10);
    const comparar = jest.spyOn(bcrypt, 'compare');
    let r: string[];
    try {
      r = frases(await Promise.allSettled(Array.from({ length: 10 }, (_, i) => auth.verificarCadastro(email, `00000${i}`))));
      expect(comparar).toHaveBeenCalledTimes(5);
    } finally {
      comparar.mockRestore();
      desfazer();
    }
    expect(quantas(r, 'Código incorreto.')).toBe(5);
    // os outros cinco saem SEM comparar: o primeiro deles descarta o cadastro ("muitas tentativas") e quem chega depois
    // do descarte já não o encontra
    expect(quantas(r, 'Muitas tentativas. Refaça o cadastro.')).toBeGreaterThanOrEqual(1);
    expect(quantas(r, 'Muitas tentativas. Refaça o cadastro.') + quantas(r, 'Cadastro não encontrado. Refaça o cadastro.')).toBe(5);
    // o código certo já não serve: o cadastro pendente foi descartado
    await expect(auth.verificarCadastro(email, '123456')).rejects.toThrow('Cadastro não encontrado. Refaça o cadastro.');
  });

  it('código do cadastro: em sequência, a sexta tentativa descarta o cadastro (o comportamento de sempre)', async () => {
    const { email } = await pendente('654321');
    for (let i = 0; i < 5; i++) await expect(auth.verificarCadastro(email, '000000')).rejects.toThrow('Código incorreto.');
    await expect(auth.verificarCadastro(email, '654321')).rejects.toThrow('Muitas tentativas. Refaça o cadastro.');
    expect(await q(`select 1 from cadastro_pendente where email = $1`, [email])).toHaveLength(0);
  });

  it('código do cadastro: o código certo duas vezes ao mesmo tempo cria UMA conta', async () => {
    const { email, cnpj } = await pendente('777777');
    const r = await Promise.allSettled([auth.verificarCadastro(email, '777777'), auth.verificarCadastro(email, '777777')]);
    const certas = r.filter((x) => x.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const recusadas = r.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect(certas).toHaveLength(1);
    expect(certas[0].value.access_token).toBeTruthy();
    expect(recusadas).toHaveLength(1);
    expect(recusadas[0].reason).toBeInstanceOf(ConflictException);
    expect(await q(`select 1 from empresa where cnpj = $1`, [cnpj])).toHaveLength(1);
    expect(await q(`select 1 from colaborador where email = $1`, [email])).toHaveLength(1);
    expect(await q(`select 1 from cadastro_pendente where email = $1`, [email])).toHaveLength(0);
  });

  it('reenvio: três ao mesmo tempo mandam UM código; os outros esperam o minuto', async () => {
    const { email } = await pendente('111111', { reenviadoHaSeg: 120 });
    await q(`update cadastro_pendente set tentativas = 4 where email = $1`, [email]);
    const r = frases(await Promise.allSettled([auth.reenviarCodigo(email), auth.reenviarCodigo(email), auth.reenviarCodigo(email)]));
    expect(quantas(r, 'ok')).toBe(1);
    expect(quantas(r, 'Aguarde um minuto para reenviar o código.')).toBe(2);
    expect(enviados).toHaveBeenCalledTimes(1);
    // o código que foi no e-mail é o que ficou gravado (e as tentativas voltaram a zero uma vez só)
    const [linha] = await q(`select codigo_hash, tentativas from cadastro_pendente where email = $1`, [email]);
    expect(linha.tentativas).toBe(0);
    expect(await bcrypt.compare(enviados.mock.calls[0][2], linha.codigo_hash)).toBe(true);
    // logo em seguida, outro reenvio espera
    await expect(auth.reenviarCodigo(email)).rejects.toThrow('Aguarde um minuto para reenviar o código.');
  });

  it('reenvio: no máximo seis códigos por hora para o mesmo e-mail; o recusado não troca o código', async () => {
    const { email } = await pendente('222222');
    const voltarUmMinuto = () => q(`update cadastro_pendente set reenviado_em = now() - interval '2 minutes' where email = $1`, [email]);
    for (let i = 0; i < 6; i++) {
      await voltarUmMinuto();
      await expect(auth.reenviarCodigo(email)).resolves.toEqual({ ok: true });
    }
    await voltarUmMinuto();
    const [antes] = await q(`select codigo_hash from cadastro_pendente where email = $1`, [email]);
    const erro: any = await auth.reenviarCodigo(email).catch((e) => e);
    expect(erro).toBeInstanceOf(HttpException);
    expect(erro.getStatus()).toBe(429);
    expect(erro.message).toBe('Muitos códigos pedidos para este e-mail. Tente de novo em uma hora.');
    expect(enviados).toHaveBeenCalledTimes(6);
    const [depois] = await q(`select codigo_hash from cadastro_pendente where email = $1`, [email]);
    expect(depois.codigo_hash).toBe(antes.codigo_hash);
    // quem não tem cadastro pendente segue sem saber de nada
    await expect(auth.reenviarCodigo('ninguem@exemplo.invalid')).resolves.toEqual({ ok: true });
  });

  it('PIN: sessenta errados em duas rajadas — só dez são comparados; depois, nem o PIN certo entra por 5 minutos', async () => {
    const { t, unidade } = await loja();
    const rajada = () => Promise.allSettled(Array.from({ length: 30 }, (_, i) => auth.pinLogin({ unidadeId: unidade, pin: `9${String(i).padStart(3, '0')}` } as any)));
    const r = [...frases(await rajada()), ...frases(await rajada())];
    const falhas = await q(`select count(*)::int as n from audit_log where tenant_id = $1 and acao = 'pin_falhou'`, [t]);
    expect(falhas[0].n).toBe(10);
    expect(quantas(r, 'PIN inválido')).toBe(10);
    expect(quantas(r, 'ok')).toBe(0);
    // o resto foi recusado sem comparar: fila cheia (429) ou a trava dos 5 minutos
    expect(quantas(r, 'Muitas tentativas de PIN ao mesmo tempo. Tente de novo.')).toBeGreaterThan(0);
    expect(quantas(r, /^Muitas tentativas de PIN\. Tente novamente em 5 minutos\.$/)).toBeGreaterThan(0);
    expect(r).toHaveLength(60);
    await expect(auth.pinLogin({ unidadeId: unidade, pin: '4321' } as any)).rejects.toThrow('Muitas tentativas de PIN. Tente novamente em 5 minutos.');
  });

  it('PIN: uma loja em fila não segura a outra, e o PIN certo entra normalmente', async () => {
    const a = await loja();
    const b = await loja();
    const r = await Promise.all([
      auth.pinLogin({ unidadeId: a.unidade, pin: '4321' } as any),
      auth.pinLogin({ unidadeId: b.unidade, pin: '4321' } as any),
      auth.pinLogin({ unidadeId: a.unidade, pin: '4321' } as any),
    ]);
    for (const x of r as any[]) expect(x.access_token).toBeTruthy();
  });

  it('login por senha: o e-mail que não existe também compara uma senha (o tempo não diz se a conta existe)', async () => {
    const comparar = jest.spyOn(bcrypt, 'compare');
    try {
      await expect(auth.login({ identificador: `nao-existe-${randomUUID().slice(0, 8)}@exemplo.invalid`, senha: 'qualquer' } as any)).rejects.toThrow('Credenciais inválidas');
      expect(comparar).toHaveBeenCalledTimes(1);
    } finally {
      comparar.mockRestore();
    }
  });
});
