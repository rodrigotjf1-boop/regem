import { sql } from 'drizzle-orm';
import type { ResumoDoRobo } from '../atendimento/resumo-do-robo';
import { STATUS_DO_PEDIDO_ENCERRADO, type SituacaoDaEquipe, chaveDaLoja } from '../atendimento/horario-da-equipe';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CHAT DO iFOOD E DA 99 NA FILA DO ATENDIMENTO (ponte do chat, Etapa 2 — protótipo `mockups/regem-central-atendimento.html`
// v3: "a mensagem do cliente no chat do iFood ou da 99 … vira caso", cada um com a sua identificação: o nome do cliente e
// o número do pedido). Regra única, chamada na entrada das mensagens (`PonteChatService.receber`), na MESMA transação em
// que elas são gravadas — a mensagem e o caso entram juntos ou nada entra (a ponte reenvia).
//
// • Um caso ABERTO por conversa (= o pedido na plataforma): a mensagem nova soma no caso aberto (a última fala vira o
//   texto do caso) e, se ele estava "aguardando o cliente", volta para a fila — com o mesmo responsável, como no WhatsApp.
// • Sem caso aberto, abre um caso "Mensagem no chat". Caso RESOLVIDO não reabre: a mensagem nova abre OUTRO (como o robô do
//   WhatsApp faz) — o sincronismo protege o "resolvido" nos dois sentidos (V60), reabrir divergiria a loja da nuvem.
// • Agradecimento curto sem caso aberto ("obrigada!", "ok", "👍" — o que o cliente responde ao "saiu para entrega") não
//   abre caso: fica na conversa do pedido, que aparece inteira no próximo caso dele.
// • Concorrência: duas pontes leem o mesmo chat e mandam ao mesmo tempo — a linha da empresa em `robo_config` é travada
//   na transação (existe: a ponte só grava ligada), então só uma decide se abre ou soma (V24: transação + trava por
//   empresa, sem índice único numa tabela que sincroniza).

/** As palavras de um agradecimento/confirmação curto — sem acento, letra repetida juntada ("obrigadaaa" → "obrigada"). */
const PALAVRAS_DE_AGRADECIMENTO = new Set([
  'ok', 'okay', 'oks', 'obrigado', 'obrigada', 'obrigados', 'obrigadas', 'obg', 'brigado', 'brigada', 'valeu', 'vlw',
  'blz', 'beleza', 'muito', 'mt', 'mto', 'show', 'perfeito', 'otimo', 'top', 'tranquilo', 'joia', 'combinado', 'certo',
  'ta', 'bom', 'agradeco', 'grato', 'grata', 'gratidao',
]);
const juntarRepetidas = (p: string) => p.replace(/(.)\1+/g, '$1');

/** Agradecimento ou confirmação curta, sem pergunta ("Obrigada!", "ok, valeu", "👍🙏"). Pergunta ou pedido não é. */
export function ehSoAgradecimento(texto: string | null | undefined): boolean {
  const original = String(texto ?? '').trim();
  if (!original || original.length > 40 || original.includes('?')) return false;
  const t = original
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim();
  // Só figurinha/emoji ("👍", "🙏❤️"): agradecimento.
  if (!t) return /\p{Extended_Pictographic}/u.test(original);
  return t.split(' ').every((p) => PALAVRAS_DE_AGRADECIMENTO.has(juntarRepetidas(p)));
}

/**
 * A CHAVE da conversa: o pedido na plataforma (no iFood, o 1º id do canal = `pedido_externo.external_id`); sem ele, o
 * pedido do Regem; sem os dois, o número exibido. Sem nada disso não há como juntar as mensagens — não abre caso.
 */
export function chaveDaConversa(m: { pedidoExterno?: string | null; pedidoId?: string | null; pedidoNumero?: string | null }): string | null {
  if (m.pedidoExterno) return `ext:${m.pedidoExterno}`;
  if (m.pedidoId) return `id:${m.pedidoId}`;
  if (m.pedidoNumero) return `num:${m.pedidoNumero}`;
  return null;
}

/**
 * A MESMA chave de `chaveDaConversa`, em SQL, sobre uma linha de `chat_plataforma_msg` (o apelido `alias`): o pedido na
 * plataforma, senão o do Regem, senão o número; sem nada, null. "Conversas agora" e "Assumir a conversa" acham a conversa
 * por ela (um teste com o Postgres compara as duas).
 */
export const chaveSql = (alias: string) =>
  sql.raw(
    `(case when ${alias}.pedido_externo is not null then 'ext:' || ${alias}.pedido_externo
           when ${alias}.pedido_id is not null then 'id:' || ${alias}.pedido_id::text
           when ${alias}.pedido_numero is not null then 'num:' || ${alias}.pedido_numero end)`,
  );

export type MensagemDoCliente = {
  /** O id da fala em `chat_plataforma_msg` (o atendente virtual usa o da última fala na chave `chat:` — F5, mig 383). */
  id?: string;
  canal: string;
  pedidoId: string | null;
  pedidoExterno: string | null;
  pedidoNumero: string | null;
  cliente: string | null;
  unidadeId: string | null;
  texto: string;
  criadoEm: string | Date;
};

/**
 * Uma conversa do lote: a última fala dela e se TODAS as falas do lote são só agradecimento. `textos` = as falas do lote, na
 * ordem, e `ultima_id` = o id da última (o atendente virtual recebe as falas juntas, com a chave da última — F5).
 */
type Conversa = {
  canal: string;
  chave: string;
  pedido_id: string | null;
  pedido_externo: string | null;
  pedido_numero: string | null;
  cliente: string | null;
  unidade_id: string | null;
  texto: string;
  em: string;
  so_agradecimento: boolean;
  textos: string[];
  ultima_id: string | null;
};

export function conversasDoLote(msgs: MensagemDoCliente[]): Conversa[] {
  const porChave = new Map<string, Conversa>();
  const ordenadas = [...msgs].sort((a, b) => new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime());
  for (const m of ordenadas) {
    const chave = chaveDaConversa(m);
    if (!chave) continue;
    const k = `${m.canal}|${chave}`;
    const antes = porChave.get(k);
    porChave.set(k, {
      canal: m.canal,
      chave,
      pedido_id: m.pedidoId ?? antes?.pedido_id ?? null,
      pedido_externo: m.pedidoExterno ?? antes?.pedido_externo ?? null,
      pedido_numero: m.pedidoNumero ?? antes?.pedido_numero ?? null,
      cliente: m.cliente ?? antes?.cliente ?? null,
      unidade_id: m.unidadeId ?? antes?.unidade_id ?? null,
      texto: String(m.texto ?? '').slice(0, 1000),
      em: new Date(m.criadoEm).toISOString(),
      so_agradecimento: (antes ? antes.so_agradecimento : true) && ehSoAgradecimento(m.texto),
      textos: [...(antes?.textos ?? []), String(m.texto ?? '').slice(0, 1000)],
      ultima_id: m.id ?? null,
    });
  }
  return [...porChave.values()];
}

/**
 * O que o robô (Etapa 3) manda no caso que ELE chama: o resumo para a equipe e se o cliente está chateado (urgente). `id` =
 * o id do caso novo, quando quem chama precisa dele fixo (a rotina "o atendente não respondeu" usa o da chave — V42).
 */
export type RoboNoCaso = { resumo: ResumoDoRobo | null; urgente: boolean; id?: string };
/** A chave de uma conversa num mapa: canal + chave do pedido. */
export const chaveDoMapa = (c: { canal: string; chave: string }) => `${c.canal}|${c.chave}`;

/**
 * Abre ou soma os casos das mensagens NOVAS do cliente (as que acabaram de entrar), set-based, dentro da transação de
 * quem chama (`tx`). Devolve os casos abertos agora (`novos`, as linhas — a tela recebe "atendimento.novo") e os que
 * mudaram (`somados` — "atendimento.mudou"); quem chama avisa a tela DEPOIS do commit. `robo`: o caso novo que o robô
 * chamou nasce com o resumo dele e, cliente chateado, urgente.
 * HORÁRIO DA EQUIPE (mig 379): `equipe` = a situação da equipe por loja (`situacoesPorLoja`, lida por quem chama). Fora
 * do horário da loja da conversa, o caso NOVO nasce como RECADO para a abertura (`detalhe.recado`) — salvo o do pedido
 * ainda em andamento (a equipe ainda trabalha nele: vai para a fila na hora). Somar não muda a marca.
 * ATENDENTE VIRTUAL (F5, mig 383): `opcoes.sempreAbre` = abre mesmo quando as falas são só agradecimento (quem chama já
 * decidiu que é da equipe: o "chamar atendente", a trava da plataforma, a rotina "não respondeu"); `robo.id` = o id do caso
 * novo (o mesmo id não abre dois — `on conflict`).
 */
export async function casosDoChat(
  tx: any,
  tenantId: string,
  msgs: MensagemDoCliente[],
  robo?: Map<string, RoboNoCaso>,
  equipe?: Map<string, SituacaoDaEquipe>,
  opcoes: { sempreAbre?: boolean } = {},
): Promise<{ novos: any[]; somados: string[] }> {
  const agora = new Date();
  const conversas = conversasDoLote(msgs).map(({ textos: _textos, ultima_id: _ultima, ...c }) => {
    const r = robo?.get(chaveDoMapa(c));
    const s = equipe?.get(chaveDaLoja(c.unidade_id));
    const recadoAte = s && !s.atendendo && s.voltaEm ? s.voltaEm.toISOString() : null;
    return {
      ...c,
      so_agradecimento: opcoes.sempreAbre ? false : c.so_agradecimento,
      id: r?.id ?? null,
      robo: r ? r.resumo : null,
      urgente: r?.urgente === true,
      recado_ate: recadoAte,
      recado_em: recadoAte ? agora.toISOString() : null,
    };
  });
  if (!conversas.length) return { novos: [], somados: [] };
  // A trava da empresa: duas pontes (ou duas réplicas) no mesmo instante — uma decide, a outra espera e já vê o caso.
  await tx.execute(sql`select 1 from robo_config where tenant_id = ${tenantId}::uuid for update`);
  const r = await tx.execute(sql`
    with g as (
      select * from jsonb_to_recordset(${JSON.stringify(conversas)}::jsonb)
        as x(canal text, chave text, pedido_id uuid, pedido_externo text, pedido_numero text, cliente text, unidade_id uuid,
             texto text, em timestamptz, so_agradecimento boolean, id uuid, robo jsonb, urgente boolean, recado_ate text, recado_em text)
    ), abertos as (
      select distinct on (c.canal, c.detalhe #>> '{chat,chave}') c.id, c.canal, c.detalhe #>> '{chat,chave}' as chave,
             c.aguardando_desde is not null as aguardava
        from atendimento_chamado c
        join g on g.canal = c.canal and g.chave = c.detalhe #>> '{chat,chave}'
       where c.tenant_id = ${tenantId}::uuid and c.tipo = 'chat' and c.status = 'aberto'
       order by c.canal, c.detalhe #>> '{chat,chave}', c.criado_em desc
    ), somados as (
      update atendimento_chamado c
         set mensagem = g.texto,
             aguardando_desde = null,
             cliente = coalesce(c.cliente, g.cliente),
             pedido_id = coalesce(c.pedido_id, g.pedido_id),
             detalhe = coalesce(c.detalhe, '{}'::jsonb)
                       || jsonb_build_object('chat', coalesce(c.detalhe -> 'chat', '{}'::jsonb) || jsonb_build_object('ultimaEm', g.em))
        from abertos a
        join g on g.canal = a.canal and g.chave = a.chave
       where c.id = a.id
      returning c.id, a.aguardava
    ), novos as (
      insert into atendimento_chamado (id, tenant_id, unidade_id, tipo, cliente, pedido_numero, pedido_id, mensagem, prioridade, canal, detalhe)
      select coalesce(g.id, gen_random_uuid()), ${tenantId}::uuid, g.unidade_id, 'chat', g.cliente, g.pedido_numero, g.pedido_id, g.texto,
             case when g.urgente then 'urgente' else 'normal' end, g.canal,
             jsonb_build_object('chat', jsonb_build_object('chave', g.chave, 'pedidoExterno', g.pedido_externo,
                                                           'pedidoNumero', g.pedido_numero, 'ultimaEm', g.em))
               || case when g.robo is null then '{}'::jsonb else jsonb_build_object('robo', g.robo || jsonb_build_object('em', now())) end
               -- fora do horário da equipe e sem pedido em andamento: recado para a abertura (mig 379)
               || case when g.recado_ate is not null
                        and not exists (select 1 from pedido_externo pe
                                         where pe.tenant_id = ${tenantId}::uuid and pe.id = g.pedido_id
                                           and pe.status not in (${sql.join(STATUS_DO_PEDIDO_ENCERRADO.map((s) => sql`${s}`), sql`, `)}))
                       then jsonb_build_object('recado', jsonb_build_object('ate', g.recado_ate, 'em', g.recado_em))
                       else '{}'::jsonb end
        from g
       where not g.so_agradecimento
         and not exists (select 1 from abertos a where a.canal = g.canal and a.chave = g.chave)
      on conflict (id) do nothing
      returning *
    )
    select 'novo' as o, to_jsonb(n.*) as linha, n.id from novos n
    union all
    select 'somou', null, s.id from somados s`);
  const linhas: any[] = (r?.rows ?? r) as any[];
  return {
    novos: linhas.filter((l) => l.o === 'novo').map((l) => l.linha),
    somados: linhas.filter((l) => l.o === 'somou').map((l) => l.id),
  };
}
