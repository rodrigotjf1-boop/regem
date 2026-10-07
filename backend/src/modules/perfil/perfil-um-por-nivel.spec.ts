import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PerfilService } from './perfil.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PERFIL DE ACESSO: UM POR NÍVEL — contra o Postgres real (TEST_PG_URL).
//
// A tabela tem `unique (tenant_id, nivel)` (mig 069) e toda empresa nasce com os quatro perfis-base.
// A tela oferecia "Novo perfil" com a escolha do nível; o serviço inseria e o banco recusava — a
// resposta era um erro 500. O serviço passa a responder o que acontece (400, com o nome do perfil
// que já ocupa o nível) e continua criando quando o nível está livre.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('perfil-um-por-nivel.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('perfil de acesso: um por nível em cada empresa', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const svc = new PerfilService(db, { registrar: async () => undefined } as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const ator = (t: string) => ({ tenantId: t, colaboradorId: null, categoria: 'presidente' }) as any;

  afterAll(async () => {
    if (empresas.length) {
      await pool.query('delete from perfil_acesso where tenant_id = any($1::uuid[])', [empresas]);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    }
    await pool.end();
  }, 120_000);

  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste perfil por nível') returning id`))[0].id as string;
    empresas.push(t);
    return t;
  }
  const niveis = async (t: string) => (await q(`select nivel, nome from perfil_acesso where tenant_id = $1 order by nivel, nome`, [t])).map((r) => `${r.nivel}:${r.nome}`);

  it('o segundo perfil do mesmo nível é recusado com explicação (não com erro 500) e nada é gravado', async () => {
    const t = await empresa();
    await svc.criar(ator(t), { nome: 'Caixa de teste', nivel: 'execucao' });
    await expect(svc.criar(ator(t), { nome: 'Cozinheiro de teste', nivel: 'execucao' })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Já existe o perfil "Caixa de teste" neste nível'),
    });
    expect(await niveis(t)).toEqual(['execucao:Caixa de teste']);
  });

  it('nível livre continua aceitando perfil; outra empresa não interfere; presidente não se cria', async () => {
    const a = await empresa();
    const b = await empresa();
    await svc.criar(ator(a), { nome: 'Caixa de teste', nivel: 'execucao' });
    await svc.criar(ator(a), { nome: 'Supervisor de teste', nivel: 'supervisao' });
    await svc.criar(ator(b), { nome: 'Caixa de teste', nivel: 'execucao' });
    expect(await niveis(a)).toEqual(['execucao:Caixa de teste', 'supervisao:Supervisor de teste']);
    expect(await niveis(b)).toEqual(['execucao:Caixa de teste']);
    await expect(svc.criar(ator(a), { nome: 'Outro dono', nivel: 'presidente' })).rejects.toThrow('presidente/C&O');
    await expect(svc.criar(ator(a), { nome: '  ', nivel: 'gerente' })).rejects.toThrow('Informe o nome do perfil');
  });

  it('depois de remover o perfil de um nível, dá para criar outro nele', async () => {
    const t = await empresa();
    const antigo: any = await svc.criar(ator(t), { nome: 'Supervisor antigo', nivel: 'supervisao' });
    await svc.remover(ator(t), antigo.id);
    await svc.criar(ator(t), { nome: 'Supervisor novo', nivel: 'supervisao' });
    expect(await niveis(t)).toEqual(['supervisao:Supervisor novo']);
  });

  it('dois pedidos ao mesmo tempo para o mesmo nível: um entra, o outro recebe a recusa', async () => {
    const t = await empresa();
    const r = await Promise.allSettled([svc.criar(ator(t), { nome: 'Gerente um', nivel: 'gerente' }), svc.criar(ator(t), { nome: 'Gerente dois', nivel: 'gerente' })]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const recusado = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(recusado.reason).toMatchObject({ status: 400 });
    expect(await niveis(t)).toHaveLength(1);
  });
});
