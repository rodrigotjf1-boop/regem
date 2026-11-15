import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DependenciasService, RespostaDaFonte } from './dependencias.service';
import { HTML_DA_META, MD_COM_O_HAIKU_DEPRECADO, MD_DA_ANTHROPIC } from './dependencias-amostras.teste-spec';
import { FONTES_VIGIADAS } from './dependencias-fontes';
import { comTravaDaEmpresa } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A vigilância das dependências (F3, parte 2; mig 423) contra o Postgres de verdade. A busca é trocada por amostras das
// páginas oficiais (nada de rede no teste). A 423 é uma tabela isolada (sem FK, sem gatilho): esta spec a aplica sozinha
// sem segurar trava de tabela quente (ERR-451 é sobre a cadeia com DDL em `produto`).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('dependencias-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

class DependenciasDeTeste extends DependenciasService {
  respostas: Record<string, RespostaDaFonte> = {};
  buscadas: string[] = [];
  protected async buscar(url: string): Promise<RespostaDaFonte> {
    this.buscadas.push(url);
    return this.respostas[url] ?? null;
  }
}

descrever('a vigilância das dependências (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const svc = new DependenciasDeTeste(db);
  const META = FONTES_VIGIADAS.find((f) => f.id === 'meta-graph-versoes')!;
  const ANTH = FONTES_VIGIADAS.find((f) => f.id === 'anthropic-modelos')!;
  const ids = FONTES_VIGIADAS.map((f) => f.id);
  const limpar = () => pool.query('delete from dependencia_leitura where fonte = any($1::text[])', [ids]);
  const item = async (id: string) => (await svc.lista()).itens.find((i: any) => i.id === id)!;

  beforeAll(async () => {
    // No banco dividido do CI, a migration trava a `empresa` primeiro (ERR-377, V9) — mesmo sendo uma tabela isolada.
    await pool.query(comTravaDaEmpresa(readFileSync(join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '423_dependencia_leitura.sql'), 'utf8')));
    await limpar();
  });
  afterAll(async () => {
    await limpar();
    await pool.end();
  });

  it('nunca lida: as integrações com fonte aparecem como "nunca lida"; as sem fonte, "manual"; o IBPT vem do banco', async () => {
    const l = await svc.lista();
    expect(l.semMigration).toBe(false);
    expect(l.itens.find((i: any) => i.id === 'meta-whatsapp')).toMatchObject({ situacao: 'nunca_lida', fonte: { id: META.id } });
    expect(l.itens.find((i: any) => i.id === 'ifood')).toMatchObject({ situacao: 'manual', fonte: null });
    expect(l.itens.find((i: any) => i.id === 'ibpt')).toMatchObject({ nome: 'IBPT · tabela por estado', fonte: null });
  });

  it('lê, guarda só a tabela, acha a validade e a situação dos modelos; a mudança vira "a conferir" com o antes e o depois', async () => {
    svc.respostas = { [META.url]: { status: 200, texto: `<nav>menu</nav>${HTML_DA_META}` }, [ANTH.url]: { status: 200, texto: MD_DA_ANTHROPIC } };
    const r1 = await svc.vigiar();
    expect(r1).toEqual([
      { fonte: META.id, leu: true, mudou: false, falha: null },
      { fonte: ANTH.id, leu: true, mudou: false, falha: null },
    ]);
    expect(await item('meta-whatsapp')).toMatchObject({ situacao: 'em_dia', achados: [expect.objectContaining({ usamos: 'v25.0', data: '2028-07-29' })], mudanca: null });
    // A v27.0 não está na tabela da Meta (ela atrasa): "a conferir", nunca "retirada".
    expect(await item('meta-instagram')).toMatchObject({ situacao: 'a_conferir' });
    expect(await item('anthropic')).toMatchObject({ situacao: 'em_dia', mudanca: null });
    const [g] = (await pool.query(`select trecho, hash from dependencia_leitura where fonte = $1`, [META.id])).rows;
    expect(g.trecho).not.toContain('menu');
    expect(g.trecho).toContain('v25.0 | 2026-02-18 | 2028-07-29');

    // O mesmo conteúdo com outro visual: não muda.
    svc.respostas[META.url] = { status: 200, texto: `<nav class="nova">outro menu</nav>${HTML_DA_META}<footer>x</footer>` };
    // A Anthropic deprecou o Haiku 5.5: muda, e o modelo em uso fica "vencendo".
    svc.respostas[ANTH.url] = { status: 200, texto: MD_COM_O_HAIKU_DEPRECADO };
    const r2 = await svc.vigiar();
    expect(r2.map((x) => [x.fonte, x.mudou])).toEqual([
      [META.id, false],
      [ANTH.id, true],
    ]);
    const a = await item('anthropic');
    expect(a.situacao).toBe('vencida');
    expect(a.mudanca).toMatchObject({ saiu: [expect.stringContaining('claude-haiku-5-5 | Active')], entrou: [expect.stringContaining('claude-haiku-5-5 | Deprecated')] });
    expect(a.achados.find((x: any) => x.usamos === 'claude-haiku-5-5')).toMatchObject({ situacao: 'vencendo', data: '2027-05-01' });
    expect(a.decisao).toBeNull();

    // Conferida: a decisão fica, com quem e a nota; a leitura seguinte igual não a apaga.
    await svc.decidir(ANTH.id, 'conferida', 'Trocar o modelo no PR da semana.', 'Rodrigo');
    await svc.vigiar();
    expect((await item('anthropic')).decisao).toMatchObject({ decisao: 'conferida', por: 'Rodrigo', nota: 'Trocar o modelo no PR da semana.' });
    // Uma mudança NOVA zera a decisão (alguém precisa olhar de novo).
    svc.respostas[ANTH.url] = { status: 200, texto: MD_DA_ANTHROPIC };
    await svc.vigiar();
    expect((await item('anthropic')).decisao).toBeNull();
    expect((await item('anthropic')).situacao).toBe('a_conferir');
  });

  it('fonte que não responde, recusa ou vem sem a tabela: "não verificada desde" a última leitura certa — os achados ficam', async () => {
    const antes = await item('meta-whatsapp');
    svc.respostas = { [META.url]: null, [ANTH.url]: { status: 403, texto: 'Forbidden' } };
    const r = await svc.vigiar();
    expect(r).toEqual([
      { fonte: META.id, leu: false, mudou: false, falha: 'a fonte não respondeu' },
      { fonte: ANTH.id, leu: false, mudou: false, falha: 'a fonte respondeu 403' },
    ]);
    const m = await item('meta-whatsapp');
    expect(m).toMatchObject({ situacao: 'nao_verificada', falha: 'a fonte não respondeu', conferidaEm: antes.conferidaEm });
    expect(m.achados).toEqual(antes.achados);
    expect((await item('anthropic')).falha).toBe('a fonte respondeu 403');
    svc.respostas = { [META.url]: { status: 200, texto: '<html>página nova sem a tabela</html>' }, [ANTH.url]: { status: 200, texto: MD_DA_ANTHROPIC } };
    await svc.vigiar();
    expect(await item('meta-whatsapp')).toMatchObject({ situacao: 'nao_verificada', falha: 'a tabela não veio na página (o formato mudou?)' });
    expect((await item('anthropic')).falha).toBeNull();
  });

  it('a decisão: fonte desconhecida, decisão torta e "não se aplica" sem dizer por quê são recusadas', async () => {
    await expect(svc.decidir('outra', 'conferida', '', 'R')).rejects.toThrow('Fonte desconhecida');
    await expect(svc.decidir(ANTH.id, 'apagar', '', 'R')).rejects.toThrow('Decisão inválida');
    await expect(svc.decidir(ANTH.id, 'nao_se_aplica', '  ', 'R')).rejects.toThrow('por que não se aplica');
    await limpar();
    await expect(svc.decidir(ANTH.id, 'conferida', '', 'R')).rejects.toThrow('ainda não foi lida');
  });

  it('a busca vai só às URLs do código', async () => {
    expect(new Set(svc.buscadas)).toEqual(new Set([META.url, ANTH.url]));
  });
});
