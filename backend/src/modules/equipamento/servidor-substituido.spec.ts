import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { EquipamentoService } from './equipamento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// SERVIDOR DA LOJA SUBSTITUÍDO SAI SOZINHO (decisão do dono, 25/09/2026) — contra o Postgres real.
//
// A loja troca de máquina (ou reinstala) e o `servidor_local` antigo ficava com o token ativo para
// sempre — o piloto chegou a 6. O job diário revoga quem está há 10 dias sem sinal de vida E tem
// substituto vivo na mesma loja (ou na rede). Nunca a credencial do GoGeM; nunca o único servidor
// de uma loja parada.
//
// O job roda aqui LIMITADO às empresas do teste: ele varre todas, e no CI as specs dividem o banco
// em paralelo — revogaria o `servidor_local` das outras (LIC-084).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('servidor-substituido.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('servidor da loja substituído: revogado depois de 10 dias sem sinal', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const auditorias: any[] = [];
  const svc = new EquipamentoService(db, { registrar: async (a: any) => void auditorias.push(a) } as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;

  beforeAll(() => {
    delete process.env.EDGE_MODE; // o job é da NUVEM
  });
  afterAll(async () => {
    if (edgeOriginal !== undefined) process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) {
      await pool.query('delete from edge_status where tenant_id = any($1::uuid[])', [empresas]);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    }
    await pool.end();
  }, 120_000);
  beforeEach(() => {
    auditorias.length = 0;
  });

  async function empresa(nome: string) {
    const t = (await q(`insert into empresa (nome) values ($1) returning id`, [nome]))[0].id as string;
    empresas.push(t);
    return t;
  }
  const loja = async (t: string, nome: string) =>
    (await q(`insert into unidade (tenant_id, nome) values ($1,$2) returning id`, [t, nome]))[0].id as string;

  /** Um servidor_local: `push`/`status` = dias atrás do último sinal (null = nunca); `criado` = dias atrás. */
  async function servidor(
    t: string,
    u: string | null,
    nome: string,
    o: { criado: number; push?: number | null; status?: number | null; integrador?: string },
  ) {
    const [e] = await q(
      `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo, integrador, created_at, last_push_ts)
       values ($1,$2,$3,'servidor_local',$4,true,$5, now() - make_interval(days => $6::int),
               case when $7::int is null then null else now() - make_interval(days => $7::int) end)
       returning id`,
      [t, u, nome, randomBytes(24).toString('hex'), o.integrador ?? null, o.criado, o.push ?? null],
    );
    if (o.status != null)
      await q(
        `insert into edge_status (equipamento_id, tenant_id, unidade_id, recebido_em)
         values ($1,$2,$3, now() - make_interval(days => $4::int))`,
        [e.id, t, u, o.status],
      );
    return e.id as string;
  }
  const ativo = async (id: string) => (await q(`select ativo, revogado_em from equipamento where id = $1`, [id]))[0];

  it('o piloto: os antigos saem; o servidor vivo, o GoGeM, a instalação nova e a loja fechada ficam', async () => {
    const t = await empresa('Piloto substituído');
    const u = await loja(t, 'Mister Burguer Steakhouse');
    const fechada = await loja(t, 'Loja fechada para reforma');
    const s = {
      lojaTeste: await servidor(t, u, 'Servidor loja teste', { criado: 75, push: 0, status: 0 }),
      rodrigo: await servidor(t, u, 'Rodrigo server', { criado: 55, push: 22 }),
      rede: await servidor(t, null, 'Mister Burguer ', { criado: 46, push: 24 }),
      sobra1: await servidor(t, u, 'Mister Burguer Steakhouse', { criado: 46 }),
      sobra2: await servidor(t, u, 'Servidor mister', { criado: 48 }),
      gogem: await servidor(t, u, 'Mister Burguer Steakhouse', { criado: 55, integrador: 'gogem' }),
      novinha: await servidor(t, u, 'Instalação de anteontem', { criado: 2 }),
      fechada: await servidor(t, fechada, 'Servidor da loja fechada', { criado: 90, push: 30 }),
    };

    const r = await svc.revogarServidoresSubstituidos(10, [t]);

    expect(r).toEqual({ revogados: 4 });
    for (const id of [s.rodrigo, s.rede, s.sobra1, s.sobra2]) {
      const e = await ativo(id);
      expect(e.ativo).toBe(false);
      expect(e.revogado_em).not.toBeNull();
    }
    for (const id of [s.lojaTeste, s.gogem, s.novinha, s.fechada]) expect((await ativo(id)).ativo).toBe(true);
    // Na auditoria, como automática, com o motivo e quem substituiu.
    expect(auditorias).toHaveLength(4);
    for (const a of auditorias)
      expect(a).toMatchObject({
        tenantId: t,
        acao: 'revogou_equipamento',
        origem: 'automatico',
        detalhe: { substituto: s.lojaTeste, motivo: expect.stringContaining('10 dias sem sinal') },
      });

    // De novo: nada a fazer.
    expect(await svc.revogarServidoresSubstituidos(10, [t])).toEqual({ revogados: 0 });
  });

  it('o relatório de status é sinal de vida: quem só manda status não sai, e vale como substituto', async () => {
    const t = await empresa('Só status');
    const soStatus = await servidor(t, null, 'Manda status, não sincroniza', { criado: 40, status: 1 });
    const velho = await servidor(t, null, 'Máquina velha', { criado: 60, push: 15 });

    expect(await svc.revogarServidoresSubstituidos(10, [t])).toEqual({ revogados: 1 });
    expect((await ativo(soStatus)).ativo).toBe(true);
    expect((await ativo(velho)).ativo).toBe(false);
  });

  it('loja parada com UM servidor só: ele fica — sem substituto, revogar deixaria a loja sem sync na volta', async () => {
    const t = await empresa('Loja parada');
    const u = await loja(t, 'Loja em férias');
    const unico = await servidor(t, u, 'Servidor da loja', { criado: 120, push: 40, status: 40 });

    expect(await svc.revogarServidoresSubstituidos(10, [t])).toEqual({ revogados: 0 });
    expect((await ativo(unico)).ativo).toBe(true);
  });

  it('a instalação nova que ainda não deu sinal NÃO derruba a antiga (pode não ter terminado)', async () => {
    const t = await empresa('Instalação em andamento');
    const antiga = await servidor(t, null, 'Máquina antiga', { criado: 90, push: 20 });
    const nova = await servidor(t, null, 'Máquina nova', { criado: 1 });

    expect(await svc.revogarServidoresSubstituidos(10, [t])).toEqual({ revogados: 0 });
    expect((await ativo(antiga)).ativo).toBe(true);

    // A nova sincronizou: agora ela é o substituto, e a antiga sai.
    await q(`update equipamento set last_push_ts = now() where id = $1`, [nova]);
    expect(await svc.revogarServidoresSubstituidos(10, [t])).toEqual({ revogados: 1 });
    expect((await ativo(antiga)).ativo).toBe(false);
  });

  it('no servidor da loja o job não roda (lá o servidor_local nem existe)', async () => {
    const t = await empresa('Job no servidor da loja');
    await servidor(t, null, 'Viva', { criado: 30, push: 0 });
    const velha = await servidor(t, null, 'Velha', { criado: 90, push: 30 });

    process.env.EDGE_MODE = 'true';
    try {
      expect(await svc.revogarServidoresSubstituidos(10, [t])).toEqual({ revogados: 0 });
    } finally {
      delete process.env.EDGE_MODE;
    }
    expect((await ativo(velha)).ativo).toBe(true);
  });
});
