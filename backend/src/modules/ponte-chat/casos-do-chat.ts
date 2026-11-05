import { sql } from 'drizzle-orm';

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

export type MensagemDoCliente = {
  canal: string;
  pedidoId: string | null;
  pedidoExterno: string | null;
  pedidoNumero: string | null;
  cliente: string | null;
  unidadeId: string | null;
  texto: string;
  criadoEm: string | Date;
};

/** Uma conversa do lote: a última fala dela e se TODAS as falas do lote são só agradecimento. */
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
    });
  }
  return [...porChave.values()];
}

/**
 * Abre ou soma os casos das mensagens NOVAS do cliente (as que acabaram de entrar), set-based, dentro da transação de
 * quem chama (`tx`). Devolve os casos abertos agora (`novos`, as linhas — a tela recebe "atendimento.novo") e os que
 * mudaram (`somados` — "atendimento.mudou"); quem chama avisa a tela DEPOIS do commit.
 */
export async function casosDoChat(tx: any, tenantId: string, msgs: MensagemDoCliente[]): Promise<{ novos: any[]; somados: string[] }> {
  const conversas = conversasDoLote(msgs);
  if (!conversas.length) return { novos: [], somados: [] };
  // A trava da empresa: duas pontes (ou duas réplicas) no mesmo instante — uma decide, a outra espera e já vê o caso.
  await tx.execute(sql`select 1 from robo_config where tenant_id = ${tenantId}::uuid for update`);
  const r = await tx.execute(sql`
    with g as (
      select * from jsonb_to_recordset(${JSON.stringify(conversas)}::jsonb)
        as x(canal text, chave text, pedido_id uuid, pedido_externo text, pedido_numero text, cliente text, unidade_id uuid,
             texto text, em timestamptz, so_agradecimento boolean)
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
      insert into atendimento_chamado (tenant_id, unidade_id, tipo, cliente, pedido_numero, pedido_id, mensagem, prioridade, canal, detalhe)
      select ${tenantId}::uuid, g.unidade_id, 'chat', g.cliente, g.pedido_numero, g.pedido_id, g.texto, 'normal', g.canal,
             jsonb_build_object('chat', jsonb_build_object('chave', g.chave, 'pedidoExterno', g.pedido_externo,
                                                           'pedidoNumero', g.pedido_numero, 'ultimaEm', g.em))
        from g
       where not g.so_agradecimento
         and not exists (select 1 from abertos a where a.canal = g.canal and a.chave = g.chave)
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
