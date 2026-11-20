import { sql } from 'drizzle-orm';
import { ESCOLHAS, Pedido, TEXTO_DA_ESCOLHA, VERSAO_DOS_TEXTOS } from './escolhas-do-cliente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A GRAVAÇÃO E A LEITURA das escolhas e do que o cliente conta (F1c do plano do perfil do cliente). `db` pode ser uma
// transação. Quem chama já conferiu a posse (o `clienteToken` do cardápio — V79).

/** Grava o pedido já conferido (`lerPedidoDePrivacidade`). Chame dentro de uma transação. */
export async function gravarPrivacidade(tx: any, c: { tenantId: string; id: string }, p: Pedido): Promise<void> {
  for (const e of p.escolhas) {
    // Só inclusão, e só quando muda: o histórico prova o que foi mostrado e quando (LGPD art. 8º §2º).
    await tx.execute(sql`
      insert into cliente_escolha (tenant_id, cliente_id, escolha, valor, origem, texto)
      select ${c.tenantId}::uuid, ${c.id}::uuid, ${e.escolha}, ${e.valor}, ${p.origem},
             ${`${TEXTO_DA_ESCOLHA[e.escolha]} (textos de ${VERSAO_DOS_TEXTOS})`}
       where coalesce((select x.valor from cliente_escolha x where x.cliente_id = ${c.id}::uuid and x.escolha = ${e.escolha}
                        order by x.em desc limit 1), not ${e.valor}::boolean) <> ${e.valor}::boolean`);
  }
  for (const d of p.declarado) {
    if (d.valor === null) {
      await tx.execute(sql`delete from cliente_declarado
                            where cliente_id = ${c.id}::uuid and tenant_id = ${c.tenantId}::uuid and chave = ${d.chave}`);
    } else {
      await tx.execute(sql`
        insert into cliente_declarado (tenant_id, cliente_id, chave, valor, origem)
        values (${c.tenantId}::uuid, ${c.id}::uuid, ${d.chave}, ${JSON.stringify(d.valor)}::jsonb, ${p.origem})
        on conflict (cliente_id, chave) do update set valor = excluded.valor, origem = excluded.origem, atualizado_em = clock_timestamp()`);
    }
  }
  // Desligou "Recomendações personalizadas" ou pediu "não analisar": os cliques ligados a ele voltam a ser anônimos na
  // hora (contam só nos números da loja — F4b, mig 466).
  if (p.escolhas.some((e) => (e.escolha === 'recomendacoes' && !e.valor) || (e.escolha === 'nao_analisar' && e.valor))) {
    await tx.execute(sql`update cardapio_interacao set cliente_id = null where cliente_id = ${c.id}::uuid and tenant_id = ${c.tenantId}::uuid`);
  }
  // "Não quero ser analisado": o perfil calculado sai na hora (a rotina também não o recalcula mais).
  if (p.escolhas.some((e) => e.escolha === 'nao_analisar' && e.valor)) {
    await tx.execute(sql`delete from cliente_perfil where cliente_id = ${c.id}::uuid and tenant_id = ${c.tenantId}::uuid`);
    // O que move o cliente (mig 463) sai junto, na hora.
    await tx.execute(sql`delete from cliente_evento_sensibilidade where cliente_id = ${c.id}::uuid and tenant_id = ${c.tenantId}::uuid`);
  }
}

/** O estado atual: a última de cada escolha (o que nunca foi clicado = `false`) e o que o cliente contou. */
export async function lerPrivacidade(db: any, tenantId: string, clienteId: string) {
  const r: any = await db.execute(sql`
    select distinct on (escolha) escolha, valor from cliente_escolha
     where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid order by escolha, em desc`);
  const d: any = await db.execute(sql`
    select chave, valor from cliente_declarado where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid`);
  const m: any = await db.execute(sql`
    select exists (select 1 from modulo_ativacao where tenant_id = ${tenantId}::uuid and modulo = 'perfil_cliente' and ativo) as ativo`);
  const escolhas: Record<string, boolean> = Object.fromEntries(ESCOLHAS.map((k) => [k, false]));
  const linhas: any[] = r.rows ?? r;
  for (const e of linhas) escolhas[e.escolha] = !!e.valor;
  return {
    // O módulo "Perfil do cliente" ligado na empresa: sem ele, o cardápio não mostra a seção (as escolhas valem igual).
    ativo: !!(m.rows ?? m)[0]?.ativo,
    // Já respondeu alguma vez (marcando ou não — "Continuar sem marcar" grava o "não"): a entrada não pergunta de novo.
    jaRespondeu: linhas.length > 0,
    escolhas,
    declarado: Object.fromEntries((d.rows ?? d).map((x: any) => [x.chave, x.valor])),
    textos: TEXTO_DA_ESCOLHA,
    versaoDosTextos: VERSAO_DOS_TEXTOS,
  };
}
