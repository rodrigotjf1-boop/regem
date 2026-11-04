import { sql, SQL } from 'drizzle-orm';
import { sqlFormasDaChave } from '../../common/telefone-chave';

/**
 * A CONVERSA ABERTA na API oficial: o cliente escreveu à loja nas últimas 24 h (a janela da Meta — fora dela só sai modelo
 * aprovado). Um `lateral` para a consulta das rotinas que mandam texto livre depois da entrega ("Chegou tudo certo?",
 * "Pedir avaliação"): uma linha com `para` (o número da conversa como a Meta o manda — com o 55) ou nenhuma linha.
 *
 * `tenant` e `chave` são colunas JÁ calculadas da linha de fora (numa CTE `materialized` — LIC-113): cada forma do número
 * (`sqlFormasDaChave`) é achada por igualdade no índice `whatsapp_mensagem (tenant_id, telefone, criado_em desc)`.
 *
 * POR QUE NA CONSULTA, e não depois dela (ERR-360): com a janela conferida DEPOIS do `limit`, o pedido de quem não escreveu
 * à loja não era marcado, voltava na frente a cada volta e, com 50 deles (todas as lojas juntas), os pedidos mais novos
 * nunca chegavam à vez.
 */
export function sqlConversaNaJanela(tenant: SQL, chave: SQL): SQL {
  return sql`lateral (
      select wm.telefone as para from whatsapp_mensagem wm
       where wm.tenant_id = ${tenant} and wm.direcao = 'entrada'
         and wm.telefone = any(${sqlFormasDaChave(chave)})
         and wm.criado_em > now() - interval '24 hours'
       order by wm.criado_em desc
       limit 1)`;
}
