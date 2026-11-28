import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { TarefaInstanciaService } from './tarefa-instancia.service';
import { ChecklistService } from '../checklist/checklist.service';
import { PontoService } from '../ponto/ponto.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-650 (rodada 7 de segurança, bloco C — as tarefas que o Mister faz pelo mapa valem também pela tela). Contra o Postgres
// real: o registro que já foi concluído, aprovado ou enviado fica como foi.
//  • MIS-C-06: excluir a tarefa do dia — só a da loja de quem exclui; a que tem a conclusão registrada fica (o motivo da
//    exclusão escrevia por cima do motivo da não conclusão);
//  • MIS-C-07: os itens do checklist mudam só antes da aprovação; o vigente (com o POP) não muda;
//  • MIS-C-09: o fechamento do ponto enviado ao contador não é recalculado por cima (o reenvio, sim: manda o espelho de agora).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('registros-que-ficam-pg.spec: sem TEST_PG_URL — PULADO');

descrever('o registro concluído, aprovado ou enviado fica como foi (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const T = randomUUID();
  let lojaA: string;
  let lojaB: string;

  beforeAll(async () => {
    await q(`insert into empresa (id, nome) values ($1, 'teste registros que ficam')`, [T]);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: lojaB }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja B') returning id`, [T]);
  });
  afterAll(async () => {
    await q(`delete from ponto_fechamento where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from pop where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from checklist_item where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from checklist where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from tarefa_instancia where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from unidade where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from empresa where id = $1`, [T]).catch(() => undefined);
    await pool.end();
  });

  it('MIS-C-06: a tarefa do dia de outra loja não se exclui; a concluída fica com o motivo dela', async () => {
    const svc = new TarefaInstanciaService(db);
    const tarefa = async (unidadeId: string) => (await q(`insert into tarefa_instancia (tenant_id, unidade_id, data) values ($1, $2, '2026-11-28') returning id`, [T, unidadeId]))[0].id as string;
    const daB = await tarefa(lojaB);
    // O gerente da loja A não exclui a tarefa da B ("não encontrada"); ela continua.
    await expect(svc.excluir(T, daB, 'não precisa', 'gerente', lojaA)).rejects.toThrow('Tarefa não encontrada');
    expect((await q(`select deleted_at from tarefa_instancia where id = $1`, [daB]))[0].deleted_at).toBeNull();
    // Na própria loja (e o presidente na rede), exclui.
    expect(await svc.excluir(T, daB, 'não precisa', 'gerente', lojaB)).toEqual({ ok: true });
    // A tarefa marcada "não feita": o motivo dela fica, e ela não some das listas.
    const naoFeita = await tarefa(lojaA);
    await q(`update tarefa_instancia set estado = 'nao_feita', motivo = 'faltou gás', concluido_em = now() where id = $1`, [naoFeita]);
    await expect(svc.excluir(T, naoFeita, 'apagar a prova', 'presidente', null)).rejects.toThrow('conclusão registrada');
    expect((await q(`select motivo, deleted_at from tarefa_instancia where id = $1`, [naoFeita]))[0]).toEqual({ motivo: 'faltou gás', deleted_at: null });
  });

  it('MIS-C-07: os itens mudam no rascunho; o checklist vigente (com o POP) não ganha nem perde item', async () => {
    const svc = new ChecklistService(db);
    const [{ id: cl }] = await q(`insert into checklist (tenant_id, unidade_id, nome) values ($1, $2, 'Abertura do salão') returning id`, [T, lojaA]);
    const item = await svc.addItem(T, cl, { descricao: 'Ligar o ar' } as any);
    expect(item).toMatchObject({ checklistId: cl, descricao: 'Ligar o ar' });
    const outro = await svc.addItem(T, cl, { descricao: 'Abrir o caixa' } as any);
    expect(await svc.removeItem(T, outro.id)).toEqual({ ok: true });
    // Aprovado: vira vigente e o POP guarda a versão com 1 item.
    const pub = await svc.publicar(T, cl, null as any);
    expect((pub.pop?.conteudoSnapshot as any)?.itens?.length).toBe(1);
    await expect(svc.addItem(T, cl, { descricao: 'Item novo sem aprovação' } as any)).rejects.toThrow('já foi aprovado');
    await expect(svc.removeItem(T, item.id)).rejects.toThrow('já foi aprovado');
    expect((await q(`select descricao from checklist_item where checklist_id = $1`, [cl])).map((r) => r.descricao)).toEqual(['Ligar o ar']);
  });

  it('MIS-C-09: o fechamento enviado ao contador fica como foi enviado; o reenvio recalcula com o espelho de agora', async () => {
    const svc = new PontoService(db, null as any, null as any, null as any, null as any, null as any);
    await q(
      `insert into ponto_fechamento (tenant_id, competencia, status, total_colaboradores, total_pendencias, pendencias, enviado_em)
       values ($1, '2026-10-01', 'enviado', 7, 3, '[{"dias":[1,2,3]}]'::jsonb, now())`,
      [T],
    );
    // Gerar de novo (pela tela, pela rotina do mês ou pelo Mister): devolve o enviado, sem mexer nos números.
    const r = await svc.gerarFechamento(T, '2026-10');
    expect(r).toMatchObject({ status: 'enviado', totalColaboradores: 7, totalPendencias: 3, jaEnviado: true });
    expect((await q(`select status, total_colaboradores, total_pendencias from ponto_fechamento where tenant_id = $1`, [T]))[0]).toEqual({ status: 'enviado', total_colaboradores: 7, total_pendencias: 3 });
    // O reenvio ao contador manda o espelho calculado agora (ninguém escalado nesta empresa de teste): os números acompanham.
    const re = await svc.gerarFechamento(T, '2026-10', { reenvio: true });
    expect(re).toMatchObject({ status: 'enviado', totalColaboradores: 0, totalPendencias: 0 });
    // O mês ainda não enviado é calculado normalmente.
    expect(await svc.gerarFechamento(T, '2026-09')).toMatchObject({ status: 'ok', totalColaboradores: 0 });
  });
});
