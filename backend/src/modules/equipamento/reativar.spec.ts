import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EquipamentoService } from './equipamento.service';
import { SyncService } from '../sync/sync.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-236 — 14/10/2026: o dono revogou o servidor da loja e o terminal em uso com um clique cada; a
// lista mostrava os dois como parados ("nunca conectou") e só voltaram por SQL. Aqui:
//  • a lista leva o sinal real: `ultimoUsoEm` do PDV (sobe do servidor da loja) e a saúde do servidor
//    da loja (`edge_status`);
//  • "Reativar" (até 30 dias): servidor da loja volta com a mesma chave (recusa se a loja já tem
//    outro dando sinal); PDV/salão/estação voltam com código novo; os demais com `pareado_em = agora`;
//  • a volta passa pela regra que protege a revogação nos DOIS sentidos (ERR-235). Postgres real.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('reativar.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const RAIZ = join(__dirname, '..', '..', '..');
const minutos = (m: number) => new Date(Date.now() + m * 60_000);

descrever('reativar equipamento e o sinal real na lista (ERR-236)', () => {
  let pool: Pool;
  let svc: EquipamentoService;
  const auditados: any[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const LOJA = randomUUID();
  const modoAntes = process.env.EDGE_MODE;

  const equip = async (tipo: string, nome: string, extra: Record<string, any> = {}) => {
    const cols = { id: randomUUID(), tenant_id: T, unidade_id: LOJA, tipo, nome, token: 'tok-' + randomUUID(), ...extra };
    const nomes = Object.keys(cols);
    await q(`insert into equipamento (${nomes.join(',')}) values (${nomes.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(cols));
    return cols.id as string;
  };
  const revogado = (dias = 1) => ({ ativo: false, revogado_em: minutos(-dias * 1440), segredo_hash: null });
  const ler = async (id: string) =>
    (await q('select ativo, revogado_em, pareado_em, pareamento_codigo, token, segredo_hash from equipamento where id = $1', [id]))[0];

  beforeAll(async () => {
    process.env.EDGE_MODE = 'false'; // nuvem: é lá que o dono revoga e reativa
    pool = new Pool({ connectionString: URL_PG });
    svc = new EquipamentoService(drizzle(pool, { schema }) as any, { registrar: async (e: any) => void auditados.push(e) } as any);
    await q(`create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(),
             ativacao_id uuid, tenant_id uuid, unidade_id uuid, versao text, estado text, ultimo_sync timestamptz,
             disco_livre_mb integer, clientes integer, fingerprint text, saude jsonb, erro text,
             recebido_em timestamptz not null default now())`);
    await q(`insert into empresa (id, nome) values ($1, 'teste reativar')`, [T]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1, $2, 'Loja')`, [LOJA, T]);
  });
  afterAll(async () => {
    if (modoAntes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = modoAntes;
    if (!pool) return;
    await q('delete from edge_status where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from sync_push_lock where equipamento_id in (select id from equipamento where tenant_id = $1)', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from unidade where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  describe('a lista leva o sinal real', () => {
    it('PDV: `ultimoUsoEm` e `revogadoEm` no formato público', async () => {
      const usado = minutos(-5);
      const id = await equip('pdv', 'PDV1', { ultimo_uso_em: usado });
      const e: any = ((await svc.listar(T)) as any[]).find((x) => x.id === id);
      expect(new Date(e.ultimoUsoEm).getTime()).toBe(usado.getTime());
      expect(e.revogadoEm).toBeNull();
    });

    it('servidor da loja: a saúde que ele mandou (`servidor.vistoEm`); sem saúde, `null`', async () => {
      const vivo = await equip('servidor_local', 'Servidor loja teste');
      const mudo = await equip('servidor_local', 'Servidor antigo');
      await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, estado, recebido_em) values ($1,$2,$3,'1.30.3','ok', now())`, [vivo, T, LOJA]);
      const lista: any[] = await svc.listar(T);
      expect(lista.find((x) => x.id === vivo).servidor).toMatchObject({ versao: '1.30.3', estado: 'ok' });
      expect(Date.now() - new Date(lista.find((x) => x.id === vivo).servidor.vistoEm).getTime()).toBeLessThan(60_000);
      expect(lista.find((x) => x.id === mudo).servidor).toBeNull();
      await q('delete from edge_status where equipamento_id = $1', [vivo]);
      await q('update equipamento set ativo = false, revogado_em = now() where id in ($1, $2)', [vivo, mudo]);
    });
  });

  describe('reativar', () => {
    it('PDV: volta ativo com código novo (o segredo foi apagado na revogação) e audita', async () => {
      const id = await equip('pdv', 'PDV1', revogado(1));
      const r: any = await svc.reativar(T, id, randomUUID(), 'presidente');
      expect(r).toMatchObject({ ativo: true, revogadoEm: null });
      expect(r.codigo).toMatch(/^\d{6}$/);
      expect(new Date(r.expiraEm).getTime()).toBeGreaterThan(Date.now());
      const linha = await ler(id);
      expect(linha).toMatchObject({ ativo: true, revogado_em: null, pareamento_codigo: r.codigo, segredo_hash: null });
      expect(auditados.at(-1)).toMatchObject({ acao: 'reativou_equipamento', entidadeId: id });
      await expect(svc.reativar(T, id, randomUUID(), 'presidente')).rejects.toThrow('já está em uso');
    });

    it('impressora: volta sem código, com `pareado_em` agora (depois da revogação)', async () => {
      const id = await equip('impressora', 'Cozinha', { ...revogado(2), pareado_em: minutos(-30 * 1440) });
      const r: any = await svc.reativar(T, id, randomUUID(), 'gerente');
      expect(r.codigo).toBeNull();
      const linha = await ler(id);
      expect(linha.ativo).toBe(true);
      expect(Date.now() - new Date(linha.pareado_em).getTime()).toBeLessThan(60_000);
    });

    it('servidor da loja: volta com a MESMA chave; recusa se a loja já tem outro dando sinal', async () => {
      const novo = await equip('servidor_local', 'Servidor novo');
      const antigo = await equip('servidor_local', 'Servidor revogado', revogado(1));
      const token = (await ler(antigo)).token;
      await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, recebido_em) values ($1,$2,$3, now())`, [novo, T, LOJA]);
      await expect(svc.reativar(T, antigo, randomUUID(), 'presidente')).rejects.toThrow('A loja já tem outro servidor da loja em uso ("Servidor novo")');
      expect((await ler(antigo)).ativo).toBe(false);
      // O outro parou de dar sinal há mais de 10 min: reativa.
      await q(`update edge_status set recebido_em = now() - interval '30 minutes' where equipamento_id = $1`, [novo]);
      const r: any = await svc.reativar(T, antigo, randomUUID(), 'presidente');
      expect(r.codigo).toBeNull();
      const linha = await ler(antigo);
      expect(linha).toMatchObject({ ativo: true, revogado_em: null, token, pareado_em: null });
      // A chave volta a valer no sincronismo.
      expect((await svc.validarToken(token))?.id).toBe(antigo);
    });

    it('revogado há mais de 30 dias: recusa — cadastre de novo', async () => {
      const id = await equip('kds', 'KDS velho', revogado(31));
      await expect(svc.reativar(T, id, randomUUID(), 'presidente')).rejects.toThrow('Revogado há mais de 30 dias');
    });

    it('com servidor da loja ativo, impressora/KDS/estação se reativam nele (a nuvem recusa)', async () => {
      const srv = await equip('servidor_local', 'Servidor ativo');
      await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, recebido_em) values ($1,$2,$3, now())`, [srv, T, LOJA]);
      try {
        const id = await equip('kds', 'KDS da loja', revogado(1));
        await expect(svc.reativar(T, id, randomUUID(), 'presidente')).rejects.toThrow(/servidor local/);
        // O PDV não é configuração de impressão: reativa na nuvem (o código desce para a loja).
        const pdv = await equip('pdv', 'Caixa 2', revogado(1));
        expect((await svc.reativar(T, pdv, randomUUID(), 'presidente') as any).codigo).toMatch(/^\d{6}$/);
      } finally {
        await q('delete from edge_status where equipamento_id = $1', [srv]);
      }
    });
  });

  // A volta tem de passar pela regra que protege a revogação (ERR-235) nos DOIS sentidos.
  describe('a reativação passa pela regra da revogação absorvente', () => {
    function condicaoDoDaemon(): (tabela: string, cols: Set<string>) => string {
      const fonte = readFileSync(join(RAIZ, 'edge', 'sync-daemon.mjs'), 'utf8').replace(/\r\n/g, '\n');
      const i = fonte.indexOf('function condicaoSobrescrever(');
      const trecho = fonte.slice(i, fonte.indexOf('\n}\n', i) + 3);
      const qq = fonte.match(/^const q = .*$/m)?.[0];
      const terminais = fonte.match(/^const ESTADOS_TERMINAIS = .*$/m)?.[0];
      return new Function(`${qq}\n${terminais}\n${trecho}\nreturn condicaoSobrescrever;`)();
    }

    it('nuvem → loja: o PDV (código) e a impressora (`pareado_em`) reativados descem sobre a cópia revogada da loja', async () => {
      const esquema = `teste_reativar_${Date.now()}`;
      const loja = new Pool({ connectionString: URL_PG, options: `-c search_path=${esquema}` });
      const colunas = ['id', 'nome', 'ativo', 'revogado_em', 'pareado_em', 'pareamento_codigo', 'updated_at'];
      try {
        await loja.query(`create schema ${esquema}`);
        await loja.query(`create table equipamento (id uuid primary key, nome text, ativo boolean, revogado_em timestamptz,
                          pareado_em timestamptz, pareamento_codigo text, updated_at timestamptz)`);
        const condicao = condicaoDoDaemon()('equipamento', new Set(colunas));
        const aplicar = (l: any) =>
          loja.query(
            `insert into equipamento (${colunas.join(',')}) values ($1,$2,$3,$4,$5,$6,$7)
             on conflict (id) do update set ${colunas.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(',')}${condicao}`,
            colunas.map((c) => l[c] ?? null),
          );
        for (const [tipo, nome] of [['pdv', 'PDV1'], ['impressora', 'Delivery']]) {
          const id = await equip(tipo, nome, { ...revogado(1), pareado_em: minutos(-30 * 1440) });
          const daNuvemAntes = (await q(`select ${colunas.join(',')} from equipamento where id = $1`, [id]))[0];
          await aplicar(daNuvemAntes); // a loja tem a cópia revogada
          await svc.reativar(T, id, randomUUID(), 'presidente');
          const daNuvem = (await q(`select ${colunas.join(',')} from equipamento where id = $1`, [id]))[0];
          await aplicar(daNuvem); // o pull seguinte
          const naLoja = (await loja.query('select ativo, revogado_em from equipamento where id = $1', [id])).rows[0];
          expect({ tipo, ...naLoja }).toEqual({ tipo, ativo: true, revogado_em: null });
        }
      } finally {
        await loja.query(`drop schema if exists ${esquema} cascade`).catch(() => undefined);
        await loja.end();
      }
    });

    it('loja → nuvem: a impressora reativada NO SERVIDOR DA LOJA sobe e vale na nuvem', async () => {
      const servidor = await equip('servidor_local', 'Servidor que envia');
      const imp = await equip('impressora', 'Bar', { ...revogado(1), pareado_em: minutos(-30 * 1440) });
      const sync = new SyncService(drizzle(pool, { schema }) as any);
      // O que a loja manda depois de reativar lá: ativa, sem revogação, `pareado_em` agora, mais nova.
      const linha = { ...(await q(`select * from equipamento where id = $1`, [imp]))[0], ativo: true, revogado_em: null, pareado_em: new Date(), updated_at: new Date().toISOString() };
      delete linha.tenant_id;
      await sync.push({ tenantId: T, unidadeId: LOJA, equipamentoId: servidor, token: 'tok' } as any, [{ tabela: 'equipamento', linhas: [linha] } as any]);
      expect(await ler(imp)).toMatchObject({ ativo: true, revogado_em: null });
    });
  });
});
