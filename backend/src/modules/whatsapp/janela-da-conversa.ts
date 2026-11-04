import { sql, SQL } from 'drizzle-orm';
import { sqlFormasDaChave } from '../../common/telefone-chave';

/**
 * A CONVERSA ABERTA na API oficial: o cliente escreveu à loja nas últimas 24 h (a janela da Meta — fora dela só sai modelo
 * aprovado). Um `lateral` para a consulta das rotinas que mandam texto livre depois da entrega ("Chegou tudo certo?",
 * "Pedir avaliação"): uma linha com `para` (o número da conversa como a Meta o manda — com o 55) ou nenhuma linha.
 *
 * `tenant` e `chave` são colunas JÁ calculadas da linha de fora (numa CTE `materialized` — LIC-113). Cada forma do número
 * (`sqlFormasDaChave`) vira UMA LINHA (`unnest`) e é achada por IGUALDADE no índice `whatsapp_mensagem (tenant_id,
 * telefone, criado_em desc)` — empresa, telefone e data na condição do índice, em qualquer versão do Postgres. Nada de
 * `telefone = any(formas)`: só a partir do Postgres 17 isso entra na condição do índice; no 16 (o do CI) vira filtro e lê
 * as mensagens da empresa INTEIRA a cada pedido (ERR-361).
 *
 * POR QUE NA CONSULTA, e não depois dela (ERR-360): com a janela conferida DEPOIS do `limit`, o pedido de quem não escreveu
 * à loja não era marcado, voltava na frente a cada volta e, com 50 deles (todas as lojas juntas), os pedidos mais novos
 * nunca chegavam à vez.
 */
export function sqlConversaNaJanela(tenant: SQL, chave: SQL): SQL {
  // Uma busca por forma (no máximo 4), cada uma a mais nova pela ordem do próprio índice (`limit 1`); fica a mais nova.
  return sql`lateral (
      select m.telefone as para
        from unnest(${sqlFormasDaChave(chave)}) as f(forma)
        cross join lateral (
          select wm.telefone, wm.criado_em from whatsapp_mensagem wm
           where wm.tenant_id = ${tenant} and wm.telefone = f.forma
             and wm.criado_em > now() - interval '24 hours' and wm.direcao = 'entrada'
           order by wm.criado_em desc
           limit 1
        ) m
       order by m.criado_em desc
       limit 1)`;
}
