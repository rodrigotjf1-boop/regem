import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A FILA DE IMPRESSÃO CONTRA UM POSTGRES DE VERDADE.
//
// Por que existe: a 1.29.0 saiu com a consulta de reserva do servidor local QUEBRADA — o
// `order by c.criado_em` lia uma coluna que o `returning` do CTE não devolvia, o Postgres
// recusava a consulta em todo ciclo e, nas lojas com servidor local, nada da fila saía no
// papel. Erro dentro de SQL em string só aparece rodando no banco; nenhum teste rodava.
//
// Roda com TEST_PG_URL (o CI sobe um Postgres). Sem a variável, pula — avisando.
// O esquema vem das MIGRATIONS REAIS da fila (não de uma cópia), num schema descartável:
// coluna renomeada/esquecida numa migration quebra aqui.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('impressao-fila.spec: sem TEST_PG_URL — testes da fila contra o Postgres PULADOS');

const RAIZ = join(__dirname, '..', '..', '..');
const MIGRATIONS = [
  '036_impressao.sql',
  '055_impressora_vias.sql',
  '092_impressora_escpos.sql',
  '100_terminal_impressora.sql',
  '120_impressora_local_usb.sql',
  '167_impressao_papel_multiplo.sql',
  '168_impressao_vias_etiqueta.sql',
  '177_impressao_edge_materializa.sql',
  '179_impressora_papel_etiqueta.sql',
  '180_impressora_linguagem_etiqueta.sql',
  '221_impressao_claim_lease.sql',
  '267_impressao_agente_maquina_fila.sql',
  '268_impressao_aviso_reimpressao.sql',
  '269_impressora_status_codepage_comando_destino.sql',
];

// edge/impressao-fila.mjs é ESM puro (só constantes); o jest roda em CommonJS. Avalia o
// arquivo como texto — é exatamente o SQL que o daemon usa.
function carregarSqlDoEdge(): Record<string, string> {
  const fonte = readFileSync(join(RAIZ, 'edge', 'impressao-fila.mjs'), 'utf8');
  const nomes = [...fonte.matchAll(/^export const (\w+)/gm)].map((m) => m[1]);
  const corpo = fonte.replace(/^export const /gm, 'const ') + `\nreturn { ${nomes.join(', ')} };`;
  return new Function(corpo)();
}

const T = randomUUID();
const LOJA_A = randomUUID();
const LOJA_B = randomUUID();
const IMP_A = randomUUID(); // rede, loja A
const IMP_B = randomUUID(); // rede, loja B
const USB_1 = randomUUID(); // USB presa à máquina CAIXA-1
const USB_LIVRE = randomUUID(); // USB ainda sem máquina aprendida

// Ganchos com banco (criar schema, aplicar migrations, limpar com os gatilhos do sync) passam dos
// 5 s padrão quando todos os arquivos de teste compilam e rodam juntos (CI com cache frio).
jest.setTimeout(60_000);

descrever('fila de impressão (Postgres real)', () => {
  const schema = `teste_impressao_${Date.now()}`;
  let pool: Pool;
  let edge: Record<string, string>;
  let servico: ProducaoPedidoService;

  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const job = async (unidade: string | null, equip: string, conteudo = 'x', atrasoSeg = 0) => {
    const r = await q(
      `insert into impressao_job (tenant_id, unidade_id, equipamento_id, via, conteudo, criado_em)
       values ($1,$2,$3,'cliente',$4, now() - make_interval(secs => $5)) returning id`,
      [T, unidade, equip, conteudo, atrasoSeg],
    );
    return r.rows[0].id as string;
  };
  const status = async (id: string) => (await q(`select status, erro from impressao_job where id=$1`, [id])).rows[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${schema}` });
    await q(`create schema ${schema}`);
    // Base mínima que as migrations da fila pressupõem (vêm de migrations bem anteriores).
    await q(`create table empresa (id uuid primary key)`);
    await q(`create table complemento (id uuid primary key)`);
    await q(`create table equipamento (
      id uuid primary key, tenant_id uuid not null, unidade_id uuid, nome text,
      tipo text not null, papel text, ativo boolean not null default true,
      padrao boolean not null default false, created_at timestamptz not null default now())`); // mig 015
    for (const m of MIGRATIONS) {
      await q(readFileSync(join(RAIZ, '..', 'database', 'migrations', m), 'utf8'));
    }
    await q(`insert into empresa (id) values ($1)`, [T]);
    const imp = (id: string, uni: string | null, extra: string) =>
      q(`insert into equipamento (id, tenant_id, unidade_id, nome, tipo, ${extra.split('=')[0]})
         values ($1,$2,$3,'imp','impressora', $4)`, [id, T, uni, extra.split('=')[1]]);
    await imp(IMP_A, LOJA_A, 'host=10.0.0.1');
    await imp(IMP_B, LOJA_B, 'host=10.0.0.2');
    await q(`insert into equipamento (id, tenant_id, unidade_id, nome, tipo, conexao, dispositivo, agente_maquina)
             values ($1,$2,$3,'usb1','impressora','local','ELGIN i8','CAIXA-1'),
                    ($4,$2,$3,'usb livre','impressora','local','Bematech',null)`,
      [USB_1, T, LOJA_A, USB_LIVRE]);
    edge = carregarSqlDoEdge();
    servico = Object.create(ProducaoPedidoService.prototype);
    (servico as any).db = drizzle(pool);
    (servico as any).agentesVistos = new Map(); // Object.create não roda os inicializadores de campo
  });

  afterAll(async () => {
    if (pool) {
      await q(`drop schema if exists ${schema} cascade`);
      await pool.end();
    }
  });

  beforeEach(() => q(`delete from impressao_job`));

  describe('servidor local (edge/impressao-fila.mjs)', () => {
    it('reserva os jobs em ordem de chegada, com os dados da impressora', async () => {
      const segundo = await job(LOJA_A, IMP_A, 'segundo', 1);
      const primeiro = await job(LOJA_A, IMP_A, 'primeiro', 5);
      const r = await q(edge.SQL_RESERVAR, ['w1', LOJA_A, []]);
      expect(r.rows.map((x) => x.id)).toEqual([primeiro, segundo]);
      expect(r.rows[0]).toMatchObject({ host: '10.0.0.1', conexao: 'rede', vias: 1 });
      expect((await status(primeiro)).status).toBe('enviando');
    });

    it('não pega job de outra loja nem job que aponta para impressora de outra loja', async () => {
      const deB = await job(LOJA_B, IMP_B);
      const redeNaImpDeB = await job(null, IMP_B);
      const meu = await job(null, IMP_A);
      const r = await q(edge.SQL_RESERVAR, ['w1', LOJA_A, []]);
      expect(r.rows.map((x) => x.id)).toEqual([meu]);
      // o da rede na impressora de B é encerrado com motivo (não fica pendente para sempre)
      await q(edge.SQL_OUTRA_LOJA, [LOJA_A]);
      expect(await status(redeNaImpDeB)).toMatchObject({ status: 'erro' });
      expect((await status(redeNaImpDeB)).erro).toMatch(/outra loja/);
      expect((await status(deB)).status).toBe('pendente'); // o da loja B continua para o servidor dela
    });

    it('sem loja definida (1 loja / servidor antigo) pega tudo', async () => {
      await job(LOJA_A, IMP_A);
      await job(LOJA_B, IMP_B);
      const r = await q(edge.SQL_RESERVAR, ['w1', null, []]);
      expect(r.rows).toHaveLength(2);
    });

    it('renovar a reserva só funciona para o dono; impresso e erro gravam', async () => {
      const id = await job(LOJA_A, IMP_A);
      await q(edge.SQL_RESERVAR, ['w1', LOJA_A, []]);
      expect((await q(edge.SQL_RENOVAR, [id, 'outro'])).rowCount).toBe(0);
      expect((await q(edge.SQL_RENOVAR, [id, 'w1'])).rowCount).toBe(1);
      await q(edge.SQL_ERRO, [id, 'timeout', 5]);
      expect((await status(id)).status).toBe('pendente');
      await q(edge.SQL_ERRO_DEFINITIVO, [id, 'sem IP']);
      expect((await status(id)).status).toBe('erro');
      await q(edge.SQL_IMPRESSO, [id]);
      expect((await status(id)).status).toBe('impresso');
    });

    it('avisa (pg_notify) no job novo e na REIMPRESSÃO — não na volta automática com espera', async () => {
      const ouvinte = await pool.connect();
      const avisos: string[] = [];
      ouvinte.on('notification', (n: any) => avisos.push(n.payload));
      await ouvinte.query('LISTEN impressao_nova');
      const espera = () => new Promise((r) => setTimeout(r, 300));
      try {
        const id = await job(LOJA_A, IMP_A);
        await espera();
        // Só os avisos DESTE job: os arquivos de teste rodam em paralelo no mesmo banco e o
        // canal é do banco inteiro (outros testes também criam jobs).
        const deste = () => avisos.filter((a) => a === id);
        expect(deste()).toEqual([id]); // novo
        await q(edge.SQL_RESERVAR, ['w1', LOJA_A, []]);
        await q(edge.SQL_ERRO, [id, 'timeout', 5]); // volta com espera de 30 s: sem aviso
        await espera();
        expect(deste()).toEqual([id]);
        await q(`update impressao_job set status='erro' where id=$1`, [id]);
        await q(`update impressao_job set status='pendente', claim_ate=null, erro=null where id=$1`, [id]); // reimprimir
        await espera();
        expect(deste()).toEqual([id, id]);
      } finally {
        await ouvinte.query('UNLISTEN *');
        ouvinte.release();
      }
    });

    it('impressora ocupada ou fora do ar fica de fora da reserva; as outras seguem', async () => {
      const deA = await job(LOJA_A, IMP_A, 'caixa');
      const usb = await job(LOJA_A, USB_1, 'cozinha');
      const r = await q(edge.SQL_RESERVAR, ['w1', LOJA_A, [IMP_A]]);
      expect(r.rows.map((x) => x.id)).toEqual([usb]);
      expect((await status(deA)).status).toBe('pendente');
    });

    it('devolver volta o job sem gastar tentativa (e só se for deste worker)', async () => {
      const id = await job(LOJA_A, IMP_A);
      await q(edge.SQL_RESERVAR, ['w1', LOJA_A, []]);
      expect((await q(edge.SQL_DEVOLVER, [id, 'outro'])).rowCount).toBe(0);
      expect((await q(edge.SQL_DEVOLVER, [id, 'w1'])).rowCount).toBe(1);
      const r = (await q(`select status, tentativas, claim_ate from impressao_job where id=$1`, [id])).rows[0];
      expect(r).toMatchObject({ status: 'pendente', tentativas: 0, claim_ate: null });
    });

    it('estado da impressora: falhas somam, impressão certa zera; "sem responder" só enquanto falha', async () => {
      await q(`delete from impressora_status`);
      await q(edge.SQL_STATUS, [IMP_A, false, 'sem conexão']);
      await q(edge.SQL_STATUS, [IMP_A, false, 'sem conexão']);
      let r = (await q(`select falhas_seguidas, ultimo_erro from impressora_status where equipamento_id=$1`, [IMP_A])).rows[0];
      expect(r).toMatchObject({ falhas_seguidas: 2, ultimo_erro: 'sem conexão' });
      expect((await q(edge.SQL_SEM_RESPONDER, [LOJA_A])).rows.map((x) => x.id)).toEqual([IMP_A]);
      expect((await q(edge.SQL_SEM_RESPONDER, [LOJA_B])).rows).toHaveLength(0); // é da loja A
      await q(edge.SQL_STATUS, [IMP_A, true, null]);
      r = (await q(`select falhas_seguidas from impressora_status where equipamento_id=$1`, [IMP_A])).rows[0];
      expect(r.falhas_seguidas).toBe(0);
      expect((await q(edge.SQL_SEM_RESPONDER, [LOJA_A])).rows).toHaveLength(0);
    });

    it('DANFE mandada pela nuvem: vai na impressora do cupom da venda, uma vez só', async () => {
      await q(`update equipamento set faz_cupom = (id = $1)`, [IMP_A]);
      const cmd = randomUUID();
      // sem cupom da venda na fila → cai na impressora de cupom da loja
      let alvo = (await q(edge.SQL_DANFE_ALVO, [cmd, LOJA_A])).rows[0].id;
      expect(alvo).toBe(IMP_A);
      // com o cupom da venda impresso na USB → a DANFE vai para ela
      await q(`insert into impressao_job (tenant_id, unidade_id, equipamento_id, comanda_id, via, conteudo, status)
               values ($1,$2,$3,$4,'cliente','cupom','impresso')`, [T, LOJA_A, USB_1, cmd]);
      alvo = (await q(edge.SQL_DANFE_ALVO, [cmd, LOJA_A])).rows[0].id;
      expect(alvo).toBe(USB_1);
      expect((await q(edge.SQL_DANFE_JA_NA_FILA, [cmd])).rowCount).toBe(0);
      await q(edge.SQL_DANFE_INSERIR, [alvo, LOJA_A, cmd, 'DANFE']);
      expect((await q(edge.SQL_DANFE_JA_NA_FILA, [cmd])).rowCount).toBe(1);
      // da loja B sem impressora de cupom própria: não pega a da loja A
      expect((await q(edge.SQL_DANFE_ALVO, [null, LOJA_B])).rows[0].id).toBeNull();
    });

    it('DANFE, etiqueta e teste saem com UMA via; cupom e produção seguem as vias da impressora', async () => {
      await q(`update equipamento set vias = 3 where id = $1`, [IMP_A]);
      for (const via of ['cliente', 'producao', 'fiscal', 'etiqueta', 'teste'])
        await q(`insert into impressao_job (tenant_id, unidade_id, equipamento_id, via, conteudo) values ($1,$2,$3,$4,'x')`, [T, LOJA_A, IMP_A, via]);
      const r = await q(edge.SQL_RESERVAR, ['w1', LOJA_A, []]);
      const vias = Object.fromEntries(r.rows.map((x) => [x.via, x.vias]));
      expect(vias).toEqual({ cliente: 3, producao: 3, fiscal: 1, etiqueta: 1, teste: 1 });
      await q(`update equipamento set vias = 1 where id = $1`, [IMP_A]);
    });

    it('a reserva informa se a impressora está desativada (o worker encerra com erro)', async () => {
      await q(`update equipamento set ativo = false where id = $1`, [IMP_A]);
      await job(LOJA_A, IMP_A);
      const r = await q(edge.SQL_RESERVAR, ['w1', LOJA_A, []]);
      expect(r.rows[0].ativo).toBe(false);
      await q(`update equipamento set ativo = true where id = $1`, [IMP_A]);
    });

    it('comando "imprimir" da nuvem: grava na impressora certa, não repete, ignora impressora inexistente', async () => {
      const args = (eq: string) => [eq, LOJA_A, null, null, 'etiqueta', 'ETIQUETA 123'];
      expect((await q(edge.SQL_JOB_DO_COMANDO, args(IMP_A))).rowCount).toBe(1);
      expect((await q(edge.SQL_JOB_DO_COMANDO, args(IMP_A))).rowCount).toBe(0); // reexecução
      expect((await q(edge.SQL_JOB_DO_COMANDO, args(randomUUID()))).rowCount).toBe(0);
      const r = await q(`select tenant_id, via, status from impressao_job where equipamento_id = $1`, [IMP_A]);
      expect(r.rows).toEqual([{ tenant_id: T, via: 'etiqueta', status: 'pendente' }]);
    });

    it('fila por impressora: quantos esperam e desde quando (saúde do servidor local)', async () => {
      await job(LOJA_A, IMP_A, 'a', 120);
      await job(LOJA_A, IMP_A, 'b', 10);
      await job(LOJA_B, IMP_B, 'c');
      const r = await q(edge.SQL_FILA_POR_IMPRESSORA, [LOJA_A]);
      expect(r.rows.map((x) => [x.id, x.pendentes])).toEqual([[IMP_A, 2]]);
      expect(Date.now() - new Date(r.rows[0].maisAntigoEm).getTime()).toBeGreaterThan(100_000);
    });

    it('dois workers ao mesmo tempo nunca pegam o mesmo job', async () => {
      for (let i = 0; i < 30; i++) await job(LOJA_A, IMP_A, `j${i}`);
      const [a, b] = await Promise.all([
        q(edge.SQL_RESERVAR, ['w1', LOJA_A, []]),
        q(edge.SQL_RESERVAR, ['w2', LOJA_A, []]),
      ]);
      const ids = [...a.rows, ...b.rows].map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('nuvem (ProducaoPedidoService.jobsPendentes)', () => {
    it('lote de no máximo 5, em ordem de chegada', async () => {
      for (let i = 0; i < 8; i++) await job(LOJA_A, IMP_A, `j${i}`, 10 - i);
      const r = await servico.jobsPendentes(T, LOJA_A);
      expect(r).toHaveLength(5);
      expect(r.map((x: any) => x.conteudo)).toEqual(['j0', 'j1', 'j2', 'j3', 'j4']);
    });

    it('USB presa a uma máquina só vai para ela; rede vai para qualquer uma', async () => {
      const usb = await job(LOJA_A, USB_1);
      const rede = await job(LOJA_A, IMP_A);
      const outra = await servico.jobsPendentes(T, LOJA_A, { maquina: 'CAIXA-2', dispositivos: ['ELGIN i8'] });
      expect(outra.map((x: any) => x.id)).toEqual([rede]);
      const dona = await servico.jobsPendentes(T, LOJA_A, { maquina: 'CAIXA-1', dispositivos: ['ELGIN i8'] });
      expect(dona.map((x: any) => x.id)).toEqual([usb]);
    });

    it('USB ainda sem máquina: só para quem tem a impressora instalada', async () => {
      const id = await job(LOJA_A, USB_LIVRE);
      expect(await servico.jobsPendentes(T, LOJA_A, { maquina: 'CAIXA-2', dispositivos: ['Outra'] })).toHaveLength(0);
      expect(await servico.jobsPendentes(T, LOJA_A, { maquina: 'CAIXA-3', dispositivos: [] })).toHaveLength(0);
      const r = await servico.jobsPendentes(T, LOJA_A, { maquina: 'CAIXA-2', dispositivos: ['Bematech'] });
      expect(r.map((x: any) => x.id)).toEqual([id]);
    });

    it('agente antigo (sem se identificar) recebe como antes', async () => {
      await job(LOJA_A, USB_1);
      await job(LOJA_A, USB_LIVRE);
      expect(await servico.jobsPendentes(T, LOJA_A)).toHaveLength(2);
    });

    it('a primeira impressão confirmada fixa a máquina da USB (e não a troca depois)', async () => {
      const id = await job(LOJA_A, USB_LIVRE);
      await servico.jobsPendentes(T, LOJA_A, { maquina: 'CAIXA-2', dispositivos: ['Bematech'] });
      await servico.marcarImpresso(T, id, 'CAIXA-2');
      const dono = async () =>
        (await q(`select agente_maquina from equipamento where id=$1`, [USB_LIVRE])).rows[0].agente_maquina;
      expect(await dono()).toBe('CAIXA-2');
      const id2 = await job(LOJA_A, USB_LIVRE);
      await servico.marcarImpresso(T, id2, 'CAIXA-9');
      expect(await dono()).toBe('CAIXA-2');
      await q(`update equipamento set agente_maquina = null where id=$1`, [USB_LIVRE]);
    });

    it('não fixa a máquina quando outro caixa tem impressora com o mesmo nome', async () => {
      servico.registrarAgente(T, 'CAIXA-1', ['Bematech']);
      servico.registrarAgente(T, 'CAIXA-2', ['Bematech']);
      const id = await job(LOJA_A, USB_LIVRE);
      await servico.marcarImpresso(T, id, 'CAIXA-2');
      const r = await q(`select agente_maquina from equipamento where id=$1`, [USB_LIVRE]);
      expect(r.rows[0].agente_maquina).toBeNull();
    });

    it('agente exclui impressoras ocupadas/fora do ar; devolver não gasta tentativa; estado grava', async () => {
      await q(`delete from impressora_status`);
      const a = await job(LOJA_A, IMP_A, 'a');
      const b = await job(LOJA_A, USB_1, 'b');
      const r = await servico.jobsPendentes(T, LOJA_A, { maquina: 'CAIXA-1', dispositivos: ['ELGIN i8'], excluir: [IMP_A, 'lixo'] });
      expect(r.map((x: any) => x.id)).toEqual([b]);
      expect(r[0]).toHaveProperty('codepage');
      await servico.devolverJob(T, b, 'CAIXA-1'); // quem reservou
      expect(await status(b)).toMatchObject({ status: 'pendente' });
      await servico.jobsPendentes(T, LOJA_A);
      await servico.marcarErro(T, a, 'sem conexão');
      await servico.marcarImpresso(T, b, 'CAIXA-1');
      const est = await servico.estadoImpressoras(T, LOJA_A);
      expect(est.find((x: any) => x.id === IMP_A)).toMatchObject({ semResponder: true, ultimoErro: 'sem conexão' });
      expect(est.find((x: any) => x.id === USB_1)).toMatchObject({ semResponder: false });
      expect(est.find((x: any) => x.id === IMP_B)).toBeUndefined(); // da loja B
    });

    it('nuvem: vias de DANFE = 1 e a reserva devolve se a impressora está ativa', async () => {
      await q(`update equipamento set vias = 2 where id = $1`, [IMP_A]);
      await q(`insert into impressao_job (tenant_id, unidade_id, equipamento_id, via, conteudo) values ($1,$2,$3,'fiscal','x')`, [T, LOJA_A, IMP_A]);
      const [j] = await servico.jobsPendentes(T, LOJA_A);
      expect(j).toMatchObject({ vias: 1, ativo: true });
      await q(`update equipamento set vias = 1 where id = $1`, [IMP_A]);
    });

    it('reimprimir zera as tentativas', async () => {
      const id = await job(LOJA_A, IMP_A);
      await q(`update impressao_job set status='erro', tentativas=5 where id=$1`, [id]);
      (servico as any).db = drizzle(pool);
      const edgeAntes = process.env.EDGE_MODE;
      process.env.EDGE_MODE = 'true'; // reimpressão do próprio servidor local (sem consulta ao edge_status)
      try {
        await servico.reimprimir(T, id);
      } finally {
        if (edgeAntes === undefined) delete process.env.EDGE_MODE;
        else process.env.EDGE_MODE = edgeAntes;
      }
      expect((await q(`select status, tentativas from impressao_job where id=$1`, [id])).rows[0]).toEqual({ status: 'pendente', tentativas: 0 });
    });

    it('devolver só vale para quem reservou', async () => {
      const id = await job(LOJA_A, IMP_A);
      await servico.jobsPendentes(T, LOJA_A, { maquina: 'CAIXA-1', dispositivos: [] });
      await servico.devolverJob(T, id, 'CAIXA-2'); // outro agente: não mexe
      expect((await status(id)).status).toBe('enviando');
      await servico.devolverJob(T, id, 'CAIXA-1');
      expect((await status(id)).status).toBe('pendente');
    });

    it('estado mostra a fila parada da impressora', async () => {
      await job(LOJA_A, IMP_A, 'velho', 600);
      const edgeAntes = process.env.EDGE_MODE;
      process.env.EDGE_MODE = 'true';
      try {
        const est = await servico.estadoImpressoras(T, LOJA_A);
        const a = est.find((x: any) => x.id === IMP_A);
        expect(a.pendentes).toBe(1);
        expect(Date.now() - new Date(a.maisAntigoEm).getTime()).toBeGreaterThan(500_000);
      } finally {
        if (edgeAntes === undefined) delete process.env.EDGE_MODE;
        else process.env.EDGE_MODE = edgeAntes;
      }
    });

    it('erro definitivo não volta para a fila', async () => {
      const id = await job(LOJA_A, IMP_A);
      await servico.marcarErro(T, id, 'impressora de rede sem IP', true);
      expect((await status(id)).status).toBe('erro');
    });
  });
});
