import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CANCELAMENTO PENDENTE de um pedido num canal (iFood, 99): a "blindagem do cancel" põe o pedido em
// `integracao.config.pendingCancels[orderId]` quando o canal não aceitou o cancelamento, e o poller reenvia.
//
// Cada operação grava no banco SÓ a entrada daquele pedido (V82, ERR-345, ERR-474): a cópia da config em memória apagava
// o que outro escritor gravou no meio — outra chave (o ajuste da tela, a saúde da integração) ou o pendente de OUTRO
// pedido cancelado ao mesmo tempo, que então nunca era reenviado (cancelado no Regem, não no canal). A tentativa soma no
// banco; o retorno é o `pendingCancels` como ficou, para atualizar a cópia de quem chamou.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];

/** Só os campos com valor: o que veio vazio mantém o que o pendente já tinha (o motivo do primeiro pedido, por exemplo). */
function comValor(dados: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== undefined && v !== null));
}

/**
 * Marca o cancelamento pendente de UM pedido (ou soma uma tentativa ao que já existe), mesclando no banco só a entrada
 * dele. `dados` = o que acompanha o pedido (o motivo); o que vier vazio mantém o anterior. Devolve o `pendingCancels`.
 */
export async function marcarCancelPendente(db: any, integracaoId: string, orderId: string, dados: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const pedido = String(orderId);
  const [l] = linhas(
    await db.execute(sql`
      update integracao
         set config = jsonb_set(
               coalesce(config, '{}'::jsonb), '{pendingCancels}',
               coalesce(config -> 'pendingCancels', '{}'::jsonb) || jsonb_build_object(
                 ${pedido}::text,
                 coalesce(config -> 'pendingCancels' -> ${pedido}::text, '{}'::jsonb)
                   || ${JSON.stringify(comValor(dados))}::jsonb
                   || jsonb_build_object('attempts', coalesce((config -> 'pendingCancels' -> ${pedido}::text ->> 'attempts')::int, 0) + 1)))
       where id = ${integracaoId}::uuid
      returning config -> 'pendingCancels' as pend`),
  );
  return (l?.pend as Record<string, any>) ?? {};
}

/** Tira UM pedido dos pendentes (o canal aceitou, ou desistiu-se dele). Sem a entrada, nada muda. Devolve o `pendingCancels`. */
export async function tirarCancelPendente(db: any, integracaoId: string, orderId: string): Promise<Record<string, any> | null> {
  const pedido = String(orderId);
  const [l] = linhas(
    await db.execute(sql`
      update integracao
         set config = jsonb_set(config, '{pendingCancels}', (config -> 'pendingCancels') - ${pedido}::text)
       where id = ${integracaoId}::uuid and jsonb_exists(coalesce(config -> 'pendingCancels', '{}'::jsonb), ${pedido}::text)
      returning config -> 'pendingCancels' as pend`),
  );
  return l ? ((l.pend as Record<string, any>) ?? {}) : null;
}
