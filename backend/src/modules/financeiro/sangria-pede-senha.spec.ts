import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { CATALOGO_PERMISSOES, perfilPadrao } from '../../auth/permissoes';
import { FinanceiroService } from './financeiro.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A SANGRIA PEDE SENHA quando o presidente liga a chave no perfil (decisão do dono, 23/10/2026), no servidor da loja e
// contra o Postgres:
//  • com a chave, só sai com a senha de quem libera (presidente, gerente ou supervisão); o comprovante e a auditoria dizem
//    quem liberou; a chave é lida do perfil ATUAL (ligar ou desligar vale na próxima sangria, sem novo login);
//  • sem a chave, como sempre (gestor, ou o caixa livre); o presidente nunca é travado;
//  • o comprovante do suprimento traz só valor, horário e quem fez; a resposta diz se o papel saiu.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('sangria-pede-senha.spec: sem TEST_PG_URL — PULADO');

describe('a chave "sangria pede senha" no catálogo de permissões', () => {
  it('existe no catálogo (é o interruptor em Acessos & perfis) e nasce desligada em todo nível, inclusive o presidente', () => {
    expect(CATALOGO_PERMISSOES.some((c) => c.chave === 'sangria_pede_senha' && c.tipo === 'bool')).toBe(true);
    for (const nivel of ['presidente', 'gerente', 'supervisao', 'execucao']) expect(perfilPadrao(nivel).permissoes.sangria_pede_senha).toBe(false);
  });
});

descrever('sangria que pede a senha de quem libera (Postgres real)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditado: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditado.push(e) } as any;
  const producao = new ProducaoPedidoService(db, auditoria, { emit: () => true } as any);
  const fin = new FinanceiroService(db, auditoria, producao);
  const edgeAntes = process.env.EDGE_MODE;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const um = async (s: string, p: any[] = []) => (await q(s, p))[0].id as string;
  const semNbsp = (s: string) => String(s).replace(/ /g, ' ');

  beforeAll(() => {
    process.env.EDGE_MODE = 'true';
  });
  afterAll(async () => {
    if (edgeAntes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeAntes;
    if (empresas.length) {
      for (const t of ['impressao_job', 'lancamento_caixa', 'caixa_sessao', 'entitlement', 'delivery_config', 'colaborador', 'perfil_acesso', 'funcao', 'equipamento', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);
  beforeEach(() => {
    auditado.length = 0;
  });

  async function loja() {
    const t = await um(`insert into empresa (nome) values ('teste sangria pede senha') returning id`);
    empresas.push(t);
    const u = await um(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]);
    const imp = await um(
      `insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo, conexao, host, porta, faz_cupom)
       values ($1,$2,'impressora','Caixa balcão',$3,true,'rede','10.0.0.30',9100,true) returning id`,
      [t, u, 'tok-' + randomUUID()],
    );
    const pdv = await um(
      `insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo, impressora_padrao_id)
       values ($1,$2,'pdv','PDV 1',$3,true,$4) returning id`,
      [t, u, 'tok-' + randomUUID(), imp],
    );
    const perfil = await um(
      `insert into perfil_acesso (tenant_id, nome, nivel, login_web, permissoes) values ($1,'Caixa com senha','execucao',true,$2::jsonb) returning id`,
      [t, JSON.stringify({ pdv: true, sangria_pede_senha: true })],
    );
    const pessoa = async (nome: string, categoria: string, senha: string, perfilId: string | null = null) => {
      const f = await um(`insert into funcao (tenant_id, nome, categoria) values ($1,$2,$3) returning id`, [t, `Função ${nome}`, categoria]);
      return um(
        `insert into colaborador (tenant_id, nome, funcao_id, senha_hash, perfil_acesso_id) values ($1,$2,$3,$4,$5) returning id`,
        [t, nome, f, await bcrypt.hash(senha, 4), perfilId],
      );
    };
    const ana = await pessoa('Ana', 'execucao', 'ana-123', perfil); // a operadora do caixa, com a chave ligada
    await pessoa('Sara', 'supervisao', 'sara-123');
    const presidente = await pessoa('Paulo', 'presidente', 'paulo-123');
    await q(`insert into caixa_sessao (tenant_id, unidade_id, terminal_id, origem, status, valor_abertura, aberta_por_id, turno_numero) values ($1,$2,$3,'pdv','aberta',100,$4,1)`, [
      t, u, pdv, ana,
    ]);
    return { t, u, imp, pdv, perfil, ana, presidente };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const sangria = (l: Loja, ator: string, perfil: string, extra: any = {}) =>
    fin.movimentarCaixa(l.t, ator, perfil, { tipo: 'sangria', valor: 50, descricao: 'cofre', terminalId: l.pdv, ...extra }) as Promise<any>;
  const comprovantes = async (l: Loja) =>
    (await q(`select conteudo from impressao_job where tenant_id = $1 and via = 'caixa' order by criado_em, id`, [l.t])).map((j: any) =>
      semNbsp(j.conteudo).split('\n'),
    );
  const sangrias = async (l: Loja) => Number((await q(`select count(*)::int as n from lancamento_caixa where tenant_id = $1 and categoria = 'sangria'`, [l.t]))[0].n);

  it('com a chave ligada: sem senha, ou com a de quem não libera, nada sai; com a da supervisão, sai — e o papel diz quem liberou', async () => {
    const l = await loja();
    await expect(sangria(l, l.ana, 'execucao')).rejects.toThrow('Informe a senha de autorização.');
    await expect(sangria(l, l.ana, 'execucao', { senhaAutorizacao: 'ana-123' })).rejects.toThrow(/Senha de gestor inválida/);
    expect(await sangrias(l)).toBe(0);

    const r = await sangria(l, l.ana, 'execucao', { senhaAutorizacao: 'sara-123' });
    expect(r).toMatchObject({ ok: true, comprovante: { enfileirados: 1, aviso: null } });
    expect(await sangrias(l)).toBe(1);
    const [papel] = await comprovantes(l);
    expect(papel).toEqual(expect.arrayContaining(['@CB SANGRIA', '@B Valor: R$ 50,00', 'Motivo: cofre', 'Operador: Ana', '@B Autorizado por: Sara']));
    expect(auditado).toEqual([
      expect.objectContaining({ acao: 'sangria', atorId: l.ana, detalhe: expect.objectContaining({ valor: 50, autorizadoPor: 'Sara' }) }),
    ]);
  });

  it('a chave é lida do perfil ATUAL; sem ela, como sempre (caixa livre ou gestor) e sem "Autorizado por"', async () => {
    const l = await loja();
    // Desligada no editor = gravada como `false` (não some do perfil): tem de valer como desligada.
    await q(`update perfil_acesso set permissoes = $2::jsonb where id = $1`, [l.perfil, JSON.stringify({ pdv: true, sangria_pede_senha: false })]);
    // Sem a chave e sem o caixa livre: a atendente não faz sangria (como antes).
    await expect(sangria(l, l.ana, 'execucao')).rejects.toThrow(/requer autorização de um gerente/);
    await q(`insert into entitlement (tenant_id, modulo, ativo) values ($1,'pdv_caixa_livre',true)`, [l.t]);
    expect((await sangria(l, l.ana, 'execucao')).ok).toBe(true);
    expect((await comprovantes(l))[0].join('\n')).not.toContain('Autorizado por');
    // Ligar a chave de novo vale já na próxima sangria, mesmo com o caixa livre.
    await q(`update perfil_acesso set permissoes = $2::jsonb where id = $1`, [l.perfil, JSON.stringify({ pdv: true, sangria_pede_senha: true })]);
    await expect(sangria(l, l.ana, 'execucao')).rejects.toThrow('Informe a senha de autorização.');
  });

  it('o presidente nunca é travado pela chave; o suprimento não pede senha e o papel traz só valor, horário e quem fez', async () => {
    const l = await loja();
    await q(`update colaborador set perfil_acesso_id = $2 where id = $1`, [l.presidente, l.perfil]); // mesmo com a chave no perfil
    expect((await sangria(l, l.presidente, 'presidente')).ok).toBe(true);

    await q(`insert into entitlement (tenant_id, modulo, ativo) values ($1,'pdv_caixa_livre',true)`, [l.t]);
    await q(`delete from impressao_job where tenant_id = $1`, [l.t]);
    const r: any = await fin.movimentarCaixa(l.t, l.ana, 'execucao', { tipo: 'suprimento', valor: 20, descricao: 'troco', terminalId: l.pdv });
    expect(r.comprovante.enfileirados).toBe(1);
    const [papel] = await comprovantes(l);
    expect(papel).toEqual(expect.arrayContaining(['@CB SUPRIMENTO', '@B Valor: R$ 20,00', 'Operador: Ana']));
    expect(papel.some((s: string) => /^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}$/.test(s))).toBe(true); // horário, no fuso da loja
    expect(papel.join('\n')).not.toMatch(/Motivo|Terminal|Turno|Autorizado/);
  });

  it('o papel que não sai não desfaz a sangria, e a resposta avisa', async () => {
    const l = await loja();
    await q(`update equipamento set ativo = false where tenant_id = $1 and tipo = 'impressora'`, [l.t]);
    const r = await sangria(l, l.ana, 'execucao', { senhaAutorizacao: 'sara-123' });
    expect(r.ok).toBe(true);
    expect(r.comprovante.enfileirados).toBe(0);
    expect(r.comprovante.aviso).toBeTruthy();
    expect(await sangrias(l)).toBe(1);
  });
});
