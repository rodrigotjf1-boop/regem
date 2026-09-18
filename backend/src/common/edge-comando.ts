import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// COMANDOS REMOTOS COM DESTINO (mig 269).
//
// `edge_comando` era por EMPRESA: numa rede com duas lojas, cada uma com o seu servidor local, o
// primeiro servidor que buscava executava e confirmava — o outro nunca recebia. Valia para o
// "testar impressora" (a loja B clicava e quem testava era a loja A) e para o ROLLBACK da
// distribuição (só um servidor voltava de versão).
//
// Agora o comando vira UMA LINHA POR SERVIDOR LOCAL de destino:
//  • `unidadeId` informado → os servidores daquela loja (e os sem loja definida);
//  • sem `unidadeId`        → todos os servidores ativos da empresa.
// Sem nenhum servidor cadastrado, grava a linha sem destino (comportamento antigo).
// `dados` leva conteúdo (ex.: o texto da DANFE). Banco sem a mig 269 → linha antiga, sem dados.
export async function enfileirarComandoEdge(
  db: any,
  tenantId: string,
  comando: string,
  opts: { unidadeId?: string | null; dados?: any; solicitadoPor?: string | null } = {},
): Promise<number> {
  const uni = opts.unidadeId ?? null;
  const dados = opts.dados != null ? JSON.stringify(opts.dados) : null;
  try {
    const r: any = await db.execute(sql`
      insert into edge_comando (tenant_id, comando, solicitado_por, equipamento_id, unidade_id, dados)
      select ${tenantId}, ${comando}, ${opts.solicitadoPor ?? null}, e.id, e.unidade_id, ${dados}::jsonb
        from equipamento e
       where e.tenant_id = ${tenantId} and e.tipo = 'servidor_local' and e.ativo
         and (${uni}::uuid is null or e.unidade_id = ${uni}::uuid or e.unidade_id is null)
      returning id`);
    const n = (r.rows ?? r).length;
    if (n) return n;
    await db.execute(sql`
      insert into edge_comando (tenant_id, comando, solicitado_por, unidade_id, dados)
      values (${tenantId}, ${comando}, ${opts.solicitadoPor ?? null}, ${uni}, ${dados}::jsonb)`);
    return 1;
  } catch (e: any) {
    if (e?.code !== '42703') throw e; // só "coluna não existe" (nuvem ainda sem a mig 269)
    await db.execute(sql`
      insert into edge_comando (tenant_id, comando, solicitado_por)
      values (${tenantId}, ${comando}, ${opts.solicitadoPor ?? null})`);
    return 1;
  }
}

// Comandos pendentes PARA ESTE servidor local: os endereçados a ele + os sem destino (antigos).
export async function comandosDoServidor(db: any, tenantId: string, equipamentoId?: string | null) {
  try {
    const r: any = await db.execute(sql`
      select id, comando, dados from edge_comando
       where tenant_id = ${tenantId} and status = 'pendente'
         and (equipamento_id is null or equipamento_id = ${equipamentoId ?? null}::uuid)
       order by criado_em asc limit 10`);
    return r.rows ?? r;
  } catch (e: any) {
    if (e?.code !== '42703') throw e;
    const r: any = await db.execute(sql`
      select id, comando from edge_comando
       where tenant_id = ${tenantId} and status = 'pendente'
       order by criado_em asc limit 10`);
    return r.rows ?? r;
  }
}
