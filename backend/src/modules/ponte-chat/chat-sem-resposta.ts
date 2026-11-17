import { sql } from 'drizzle-orm';
import { VIVA_POR_MS } from './lideranca';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CHAT DO iFOOD SEM NINGUÉM RESPONDENDO (16/11/2026).
//
// Na loja, em 16/11, o Gestor do iFood dentro da ponte do chat caiu para a tela de login às 18:37 (a renovação do acesso
// ficou sem resposta) e ficou assim mais de duas horas: os avisos "saiu" pararam na fila, o cliente escreveu no chat e não
// teve resposta — e ninguém foi avisado (a ponte só dizia "iFood sem login" no ícone perto do relógio, e a nuvem só na
// faixa da tela de Atendimento). Esta leitura acha a loja nessa situação, para o aviso do Mister ("iFood ou 99
// desconectado") levar ao gerente e à tela da loja o que fazer.
//
// A regra de "quem responde" é a MESMA da fila (`quemRespondePeloCanalNoBanco`, V88): a ponte com sinal nos últimos 2 min,
// logada no canal e sem pausa neste PC. Aqui é a pergunta ao contrário, para todas as lojas de uma vez (uma consulta).

/** Pedido do iFood mais velho que isto não conta como "em andamento": é pendência antiga do turno. */
export const PEDIDO_DO_CHAT_JANELA_H = 6;

export type MotivoDoChatSemResposta = 'sem_login' | 'sem_sinal';

export interface ChatSemResposta {
  tenantId: string;
  /** A loja da ponte (null = a ponte sem loja, que atende a empresa inteira). */
  unidadeId: string | null;
  loja: string;
  /** sem_login = a ponte dá sinal, mas o iFood dela está sem login; sem_sinal = nenhuma ponte da loja dá sinal. */
  motivo: MotivoDoChatSemResposta;
  /** O nome do PC da ponte, como está em Configurações › Equipamentos, e o nome dele no Windows. */
  ponte: string;
  maquina: string | null;
  /** Os pedidos do iFood em andamento (novo, aceito, pronto ou a caminho) das últimas 6 horas. */
  pedidos: number;
}

const linhas = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

/**
 * As lojas com a ponte do chat LIGADA nos ajustes em que NINGUÉM responde pelo chat do iFood agora.
 *  • só conta a ponte pareada e não revogada; a ponte PAUSADA no PC fica de fora (a pausa é uma decisão de quem está lá) —
 *    a loja só com pontes pausadas não aparece;
 *  • com alguma ponte respondendo (sinal recente e iFood logado), a loja não aparece;
 *  • o PC citado é o que dá sinal sem login (é nele que se resolve); sem nenhum dando sinal, o que deu sinal por último.
 * Quem chama decide o que fazer com `pedidos` (o aviso só ABRE com pedido em andamento). Tabelas só da nuvem (mig 366):
 * no banco sem elas, a consulta falha com 42P01 — quem chama trata.
 */
export async function chatsDoIfoodSemResposta(db: any, soEmpresas?: string[]): Promise<ChatSemResposta[]> {
  const so = soEmpresas?.length ? sql`and cp.tenant_id in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;
  const r = linhas(
    await db.execute(sql`
      with pontes as (
        select cp.tenant_id, cp.unidade_id, e.nome, cp.maquina, cp.visto_em,
               coalesce(cp.visto_em > now() - make_interval(secs => ${VIVA_POR_MS / 1000}), false) as viva,
               coalesce((cp.plataformas -> 'ifood' ->> 'logado')::boolean, false) as logada
          from chat_ponte cp
          join equipamento e on e.id = cp.equipamento_id and e.tipo = 'ponte_chat' and e.ativo and e.revogado_em is null
          join robo_config rc on rc.tenant_id = cp.tenant_id and rc.chat_ponte_ligada
          join empresa emp on emp.id = cp.tenant_id and emp.deleted_at is null
         where cp.pausada_em is null ${so}
      ), lojas as (
        select tenant_id, unidade_id, bool_or(viva and logada) as responde, bool_or(viva and not logada) as sem_login
          from pontes
         group by tenant_id, unidade_id
      )
      select l.tenant_id::text as "tenantId", l.unidade_id::text as "unidadeId", coalesce(u.nome, emp.nome) as loja,
             case when l.sem_login then 'sem_login' else 'sem_sinal' end as motivo,
             p.nome as ponte, p.maquina,
             (select count(*)::int from pedido_externo pe
               where pe.tenant_id = l.tenant_id and pe.canal = 'ifood'
                 and pe.status in ('novo', 'confirmado', 'pronto', 'despachado')
                 and (l.unidade_id is null or pe.unidade_id = l.unidade_id or pe.unidade_id is null)
                 and pe.criado_em > now() - make_interval(hours => ${PEDIDO_DO_CHAT_JANELA_H})) as pedidos
        from lojas l
        join empresa emp on emp.id = l.tenant_id
        left join unidade u on u.id = l.unidade_id and u.tenant_id = l.tenant_id
        join lateral (
          select p2.nome, p2.maquina from pontes p2
           where p2.tenant_id = l.tenant_id and p2.unidade_id is not distinct from l.unidade_id
           order by (p2.viva and not p2.logada) desc, p2.visto_em desc nulls last
           limit 1) p on true
       where not l.responde
       order by l.tenant_id, l.unidade_id`),
  );
  return r.map((x) => ({
    tenantId: String(x.tenantId),
    unidadeId: x.unidadeId ? String(x.unidadeId) : null,
    loja: String(x.loja ?? ''),
    motivo: x.motivo === 'sem_login' ? 'sem_login' : 'sem_sinal',
    ponte: String(x.ponte ?? ''),
    maquina: x.maquina ? String(x.maquina) : null,
    pedidos: Number(x.pedidos) || 0,
  }));
}
