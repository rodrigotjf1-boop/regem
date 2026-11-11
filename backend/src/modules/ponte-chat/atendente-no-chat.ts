import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { ehServidorLocal } from '../../common/modo';
import { chaveDoChat, ehChaveDoChat, idDaChaveDoChat } from '../../common/conversa-do-robo';
import { uuidDeChave } from '../../common/id-deterministico';
import { type CanalDaPonte, type PonteCandidata, VIVA_POR_MS, ehCanalDaPonte, quemResponde } from './lideranca';
import { type MensagemDoCliente, type RoboNoCaso, casosDoChat, chaveDaConversa, chaveDoMapa, chaveSql } from './casos-do-chat';
import { NOME_DO_MOTIVO_DA_TRAVA, travaDaPlataforma, primeiroNome } from './texto-do-chat';
import {
  CHAMEI_A_EQUIPE,
  FALAS_DO_ATENDENTE_POR_HORA,
  type PedidoDoRobo,
  type PedidoParaOAtendente,
  chamarPeloLimite,
  decidir,
  ehChateado,
  fraseForaDoHorarioNoChat,
  intencaoDoCliente,
  modoDaLinha,
} from './robo-do-chat';
import { modoEntrega } from '../entregador/modo-entrega';
import {
  type SituacaoDaEquipe,
  chaveDaLoja,
  lerRecado,
  recadoAtivo,
  recadoAtivoSql,
  respostaDoRecado,
  situacoesPorLoja,
} from '../atendimento/horario-da-equipe';
import { responsavelNaEsperaSql } from '../cardapio/assuntos-do-atendente';
import { posicaoNaFila } from '../atendimento/abrir-chamado';
import { type ResumoDoRobo, resumoDoRobo } from '../atendimento/resumo-do-robo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ATENDENTE VIRTUAL NO CHAT DO iFOOD E DA 99 (F5 do atendente virtual, mig 383 — protótipo
// `mockups/regem-central-atendimento.html`). Com "Robô responde no chat" ligado e "Quem responde" = "Atendente virtual"
// (`robo_config.chat_robo_modo = 'atendente'`), a fala do cliente vai ao robô com IA do n8n (o mesmo do WhatsApp e do Direct)
// com a chave `chat:<id da PRIMEIRA fala do cliente da conversa>` (`common/conversa-do-robo.ts`) — nada muda no n8n. A chave
// é a mesma em toda a conversa (como a do Direct, `ig:<cliente>`, e a do teste, `teste:<id>`): a memória do agente no n8n é
// pela conversa (o `de`) — com uma chave nova a cada fala, ele esqueceria a pergunta que acabou de fazer ("Sim, quero
// ajuda" ficaria sem sentido). A fala que ele responde vai em `mensagemId`. Uma regra só, fora dos serviços (como
// `atendimento/teste-do-atendente.ts`): a ponte (a entrada e a rotina), o WhatsApp (a resposta do robô e as ferramentas de
// pedido) e o cardápio (o "chamar atendente" e as consultas) importam daqui sem ciclo de módulo. Só banco e funções puras.
//
//  • A ENTRADA (`PonteChatService.receber`) decide cada conversa (`robo-do-chat.ts` › `decidirNoChat`) e, quando é do
//    atendente, monta a mensagem (`mensagemDoChatParaORobo`) e marca a fala como entregue (`robo_entregue_em`) ANTES de
//    entregar — a entrega que falha desfaz a marca e cai no robô por regras; o processo que morre no meio deixa a marca e a
//    rotina abre o caso (V88).
//  • A RESPOSTA (`publico/bot/responder` com `chat:`): resolvida pela linha da fala; caso aberto com alguém = quieta (salvo UMA
//    vez o "já chamei" que o próprio "chamar atendente" liberou — V83); ninguém envia pelo canal = caso (V88); 8 falas do
//    atendente na hora = caso; a TRAVA DA PLATAFORMA (`texto-do-chat.ts`) — barrada, vai a resposta por regras daquela
//    conversa ou o caso. O que sai entra na fila de saída como autor 'robo' com `robo_ia = true`.
//  • O "CHAMAR ATENDENTE" (`publico/cardapio/:token/atendimento` com `chat:`): o caso de chat da conversa pelo MESMO
//    caminho dos casos do chat (`casosDoChat`), com o resumo do robô e o recado da abertura fora do horário (F1).
//  • A ROTINA "o atendente virtual não respondeu" (cada minuto, só nuvem): marca com mais de 2 min → caso (V84, V42, V3).

export type Emitir = (evento: string, dados: any) => unknown;
type Log = { log?: (m: string) => void; warn: (m: string) => void };

/** Mais que isto sem a resposta do atendente, a conversa vira caso. */
export const SEM_RESPOSTA_DO_ATENDENTE_MS = 2 * 60_000;
/** A marca mais velha que isto não espera mais nada (a rotina só apaga). */
export const JANELA_DA_MARCA_MIN = 30;
/** Quantas marcas a rotina trata por rodada. */
export const MARCAS_POR_RODADA = 100;

const linhas = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const nomeDaPlataforma = (canal: string) => (canal === 'ifood' ? 'do iFood' : 'da 99');

// ───────────────────────── quem envia pelo canal (a regra do `pegar`) ─────────────────────────

/**
 * Quem responde pelo canal na loja: as pontes da MESMA loja (ou sem loja, ambas), ativas, não revogadas, com sinal há no
 * máximo 2 min — e a regra única de `quemResponde`. (Mora aqui para a resposta do robô e o "chamar atendente" usarem a
 * mesma regra que a fila de saída; `PonteChatService.quemRespondePeloCanal` chama esta.)
 */
export async function quemRespondePeloCanalNoBanco(db: any, tenantId: string, unidadeId: string | null, canal: CanalDaPonte): Promise<string | null> {
  const r = linhas(
    await db.execute(sql`
      select cp.equipamento_id as id, cp.papel,
             extract(epoch from (now() - cp.visto_em)) * 1000 as idade_ms,
             extract(epoch from (now() - e.created_at)) * 1000 as cadastro_ms,
             -- pausada no PC (mig 368) não responde: a vez passa para a reserva
             coalesce((cp.plataformas -> ${canal} ->> 'logado')::boolean, false) and cp.pausada_em is null as logada
        from chat_ponte cp
        join equipamento e on e.id = cp.equipamento_id
       where cp.tenant_id = ${tenantId}::uuid
         and e.tipo = 'ponte_chat' and e.ativo and e.revogado_em is null
         and cp.unidade_id is not distinct from ${unidadeId}::uuid
         and cp.visto_em > now() - make_interval(secs => ${VIVA_POR_MS / 1000})`),
  );
  const agora = Date.now();
  const candidatas: PonteCandidata[] = r.map((x) => ({
    id: x.id,
    papel: x.papel,
    vistoEm: agora - Number(x.idade_ms),
    logada: x.logada === true,
    criadaEm: agora - Number(x.cadastro_ms),
  }));
  return quemResponde(candidatas, agora);
}

/**
 * Algum PC ENVIA pelo canal para a loja da conversa? A mesma regra do `pegar`: a ponte que responde pela loja, ou uma ponte
 * sem loja (pega de todas). Sem ele, o que o robô dissesse ficaria na fila e cairia em 30 min (ERR-382).
 */
export async function alguemEnviaPeloCanal(db: any, tenantId: string, unidadeId: string | null, canal: CanalDaPonte): Promise<boolean> {
  if (await quemRespondePeloCanalNoBanco(db, tenantId, unidadeId, canal)) return true;
  return unidadeId !== null && !!(await quemRespondePeloCanalNoBanco(db, tenantId, null, canal));
}

/** SQL: o caso `a` cala o robô no chat — aberto, de chat, sem ser o RECADO da abertura (mig 379) nem o do responsável (mig 381). */
export const casoQueCalaSql = (a: string): SQL =>
  sql`(${sql.raw(a)}.tipo = 'chat' and ${sql.raw(a)}.status = 'aberto' and not ${recadoAtivoSql(a)} and not ${responsavelNaEsperaSql(a)})`;

/** O padrão da pausa do robô quando a loja fala (o mesmo do WhatsApp — `robo-pausa.ts` › PAUSA_PADRAO_MINUTOS). */
export const MIN_CONVERSA_DA_LOJA_PADRAO = 60;
const textoNormal = (col: string) => sql.raw(`regexp_replace(btrim(${col}), '\\s+', ' ', 'g')`);

/**
 * SQL: A LOJA ESTÁ CONVERSANDO com o cliente nesta conversa (10/11/2026, pedido 1948 do iFood: a loja escreveu pelo
 * Gestor "entregador no local…", o cliente respondeu em 4 falas e o atendente virtual respondeu às 4, depois de a loja já
 * ter dito "ok avisei ao entregador"). Uma pessoa da loja escreveu ao cliente PELA PLATAFORMA — no Gestor do iFood ou no
 * app da 99 (a ponte lê como `entrada` de autor 'loja') — dentro da pausa da loja (`robo_config.pausa_minutos`, a MESMA do
 * WhatsApp; 0 ou sem linha = 60 min). O ECO do que o próprio Regem mandou (a ponte relê a mensagem enviada como "da loja"
 * até a confirmação apagá-la) NÃO conta: entrada de autor 'loja' com o mesmo texto de uma saída da conversa — senão o robô
 * se calaria sozinho depois de cada resposta (o ERR-332, no WhatsApp).
 * A equipe pelo REGEM (`saida` de autor 'equipe') responde por um caso, e o caso aberto já cala o robô; resolvido, o robô
 * volta (09/11) — por isso ela não conta aqui, senão o cliente que escreve depois do caso resolvido ficaria sem robô e sem
 * caso. Só na FILA (`equipeDoRegem`) ela conta: a resposta do robô criada antes dela ficou velha. O entregador pelo app
 * também grava 'equipe' e tem a regra dele (`entregadorFalou`): nunca conta.
 * `desde`: só a fala da loja depois deste instante (a resposta do robô na fila ficou velha).
 */
export function lojaFalouSql(o: { tenantId: string; canal: SQL; chave: SQL; desde?: SQL; equipeDoRegem?: boolean }): SQL {
  return sql`exists (
    select 1 from chat_plataforma_msg lf
     where lf.tenant_id = ${o.tenantId}::uuid and lf.canal = ${o.canal} and ${chaveSql('lf')} = ${o.chave}
       and lf.criado_em > now() - make_interval(mins => coalesce(
             (select nullif(rcp.pausa_minutos, 0) from robo_config rcp where rcp.tenant_id = ${o.tenantId}::uuid),
             ${MIN_CONVERSA_DA_LOJA_PADRAO}))
       ${o.desde ? sql`and lf.criado_em > ${o.desde}` : sql``}
       and ((lf.direcao = 'entrada' and lf.autor = 'loja'
             and not exists (
               select 1 from chat_plataforma_msg eco
                where eco.tenant_id = lf.tenant_id and eco.canal = lf.canal and eco.direcao = 'saida'
                  and ${chaveSql('eco')} = ${o.chave}
                  and eco.criado_em > lf.criado_em - interval '30 minutes'
                  and ${textoNormal('eco.texto')} = ${textoNormal('lf.texto')}))
         ${
           o.equipeDoRegem
             ? sql`or (lf.direcao = 'saida' and lf.autor = 'equipe'
                       and not exists (select 1 from pedido_externo lpe
                                        where lpe.tenant_id = lf.tenant_id and lpe.id = lf.pedido_id and lpe.entregador_id = lf.autor_id))`
             : sql``
         }))`;
}

// ───────────────────────── o atendente pode rodar? ─────────────────────────

/** O robô com IA pode rodar NESTA instalação: só na nuvem, com o endereço do fluxo único do robô e a senha dele. */
export function atendenteDisponivel(): boolean {
  return !ehServidorLocal() && !!String(process.env.N8N_ROBO_WEBHOOK_URL ?? '').trim() && !!String(process.env.BOT_RESOLVER_SECRET ?? '').trim();
}

/** O cardápio que o atendente consulta na conversa (o token dá a loja, o menu, a taxa e as instruções). */
export type CardapioDoChat = {
  id: string;
  token: string;
  aberto: boolean | null;
  nomePublico: string | null;
  unidadeId: string | null;
  roboSaudacao: string | null;
  roboAusencia: string | null;
  roboPrompt: string | null;
  roboMensagens: any;
};

/**
 * O cardápio ATIVO da loja da conversa (o da loja; senão o da empresa, sem loja; senão outro ativo da empresa — o mesmo que
 * as consultas do robô usariam para a loja). null = a empresa não tem cardápio ativo (o atendente não tem o que consultar:
 * vale o robô por regras).
 */
export async function cardapioDoChat(db: any, tenantId: string, unidadeId: string | null): Promise<CardapioDoChat | null> {
  const [c] = linhas(
    await db.execute(sql`
      select id, token, aberto, nome_publico as "nomePublico", unidade_id as "unidadeId", robo_saudacao as "roboSaudacao",
             robo_ausencia as "roboAusencia", robo_prompt as "roboPrompt", robo_mensagens as "roboMensagens"
        from cardapio_config
       where tenant_id = ${tenantId}::uuid and ativo and coalesce(token, '') <> ''
       order by (unidade_id = ${unidadeId}::uuid) desc nulls last, (unidade_id is null) desc, id
       limit 1`),
  );
  return c ? { ...c, id: String(c.id), token: String(c.token) } : null;
}

// ───────────────────────── a conversa da chave `chat:` ─────────────────────────

export type ConversaDaChave = {
  /** A fala do cliente da chave. */
  msgId: string;
  tenantId: string;
  unidadeId: string | null;
  canal: CanalDaPonte;
  pedidoId: string | null;
  pedidoExterno: string | null;
  pedidoNumero: string | null;
  cliente: string | null;
  /** A chave da conversa (`chaveDaConversa`: o pedido na plataforma, o do Regem ou o número). */
  chave: string;
  texto: string;
  criadoEm: string;
};

/**
 * A conversa da chave `chat:<id>`: SÓ pela linha da fala do CLIENTE (entrada) — a empresa, a loja, o canal, o pedido e a
 * chave da conversa vêm dela (qualquer fala da conversa resolve a mesma conversa; o atendente recebe a da primeira, e a
 * rotina usa a fala marcada). Forma inválida, id desconhecido, linha que não é fala de cliente, sem chave de conversa ou
 * banco sem a tabela → null (quem chama recusa). `texto` = o texto DESSA fala (a última do cliente: `ultimaFalaDoCliente`).
 */
export async function conversaDaChave(db: any, chave: unknown): Promise<ConversaDaChave | null> {
  const id = idDaChaveDoChat(chave);
  if (!id) return null;
  let r: any;
  try {
    r = await db.execute(sql`
      select id, tenant_id as "tenantId", unidade_id as "unidadeId", canal, pedido_id as "pedidoId",
             pedido_externo as "pedidoExterno", pedido_numero as "pedidoNumero", cliente_nome as cliente, texto,
             criado_em as "criadoEm"
        from chat_plataforma_msg where id = ${id}::uuid and direcao = 'entrada' and autor = 'cliente'`);
  } catch (e: any) {
    if (e?.code === '42P01' || e?.cause?.code === '42P01') return null;
    throw e;
  }
  const [l] = linhas(r);
  if (!l || !ehCanalDaPonte(l.canal)) return null;
  const k = chaveDaConversa(l);
  if (!k) return null;
  return {
    msgId: String(l.id),
    tenantId: String(l.tenantId),
    unidadeId: l.unidadeId ? String(l.unidadeId) : null,
    canal: l.canal,
    pedidoId: l.pedidoId ? String(l.pedidoId) : null,
    pedidoExterno: l.pedidoExterno ?? null,
    pedidoNumero: l.pedidoNumero ?? null,
    cliente: l.cliente ?? null,
    chave: k,
    texto: String(l.texto ?? ''),
    criadoEm: new Date(l.criadoEm).toISOString(),
  };
}

/** A conversa de uma fala dura no máximo isto (o pedido da plataforma é achado nos últimos 2 dias — `receber`). */
const JANELA_DA_CONVERSA = sql`interval '2 days'`;

/** SQL: as falas do cliente da conversa `c` (o apelido `m` de `chat_plataforma_msg`), na janela da conversa. */
const falasDoClienteSql = (c: { tenantId: string; canal: string; chave: string }) =>
  sql`m.tenant_id = ${c.tenantId}::uuid and m.canal = ${c.canal} and m.direcao = 'entrada' and m.autor = 'cliente'
      and m.criado_em > now() - ${JANELA_DA_CONVERSA} and ${chaveSql('m')} = ${c.chave}`;

/** O texto da ÚLTIMA fala do cliente na conversa (o caso mostra a fala de agora, não a da chave). */
export async function ultimaFalaDoCliente(db: any, c: ConversaDaChave): Promise<string> {
  const [l] = linhas(await db.execute(sql`select m.texto from chat_plataforma_msg m where ${falasDoClienteSql(c)} order by m.criado_em desc, m.id desc limit 1`));
  return String(l?.texto ?? c.texto);
}

/** A conversa como uma fala do cliente para os casos do chat (`casosDoChat`). */
const comoMensagem = (c: ConversaDaChave, texto?: string): MensagemDoCliente => ({
  id: c.msgId,
  canal: c.canal,
  pedidoId: c.pedidoId,
  pedidoExterno: c.pedidoExterno,
  pedidoNumero: c.pedidoNumero,
  cliente: c.cliente,
  unidadeId: c.unidadeId,
  texto: texto ?? c.texto,
  criadoEm: c.criadoEm,
});

/** A conversa como item da fila de saída (os mesmos campos do pedido e do cliente da conversa). */
const naFila = (c: ConversaDaChave, texto: string, roboIa = false) => ({
  canal: c.canal,
  pedido_id: c.pedidoId,
  pedido_externo: c.pedidoExterno,
  pedido_numero: c.pedidoNumero,
  cliente: c.cliente,
  unidade_id: c.unidadeId,
  texto,
  robo_ia: roboIa,
});

// ───────────────────────── a mensagem ao robô (pura) ─────────────────────────

/**
 * A fala do chat no formato que o robô (n8n) recebe — o MESMO das outras vias (`MsgNormalizada` da API oficial e da
 * Evolution; `instagram.service.ts` › `mensagemParaORobo` no Direct): a chave `chat:<id da primeira fala do cliente>` em
 * `instancia` e em `de` (a mesma em toda a conversa), a fala que ele responde em `mensagemId`, sem `phoneNumberId` (o n8n
 * acha a loja pela instância). `provedor` = 'instagram', o mesmo tipo de via do Direct: só texto —
 * no chat da plataforma não há áudio. `pedido` = o que o robô por regras já sabe dizer do pedido da conversa (ele responde
 * o "cadê meu pedido" sem ferramenta); `plataforma` = 'ifood' | '99food' (o n8n que não conhece o campo ignora). `conversa`
 * vai NULA de propósito (ver `conversa-do-robo.ts`).
 */
export function mensagemDoChatParaORobo(o: {
  tenantId: string;
  /** A fala que dá a chave da conversa (a primeira do cliente). */
  chaveId: string;
  /** A fala que o atendente responde (a última do lote). */
  mensagemId: string;
  canal: CanalDaPonte;
  cliente: string | null;
  texto: string;
  em: string | Date;
  cardapio: CardapioDoChat;
  pedido: PedidoParaOAtendente | null;
}) {
  const chave = chaveDoChat(o.chaveId);
  const c = o.cardapio;
  return {
    provedor: 'instagram' as const,
    tenantId: o.tenantId,
    cardapioToken: c.token,
    phoneNumberId: null,
    instancia: chave,
    jid: null,
    loja: { nome: c.nomePublico ?? null, aberto: c.aberto !== false },
    de: chave,
    nome: primeiroNome(o.cliente) || null,
    tipo: 'text' as const,
    texto: o.texto,
    mensagemId: o.mensagemId,
    timestamp: Math.floor(new Date(o.em).getTime() / 1000),
    midiaId: null,
    opcaoId: null,
    roboSaudacao: c.roboSaudacao ?? null,
    roboAusencia: c.roboAusencia ?? null,
    roboPrompt: c.roboPrompt ?? null,
    roboMensagens: Array.isArray(c.roboMensagens) ? c.roboMensagens : [],
    conversa: null,
    plataforma: o.canal,
    pedido: o.pedido,
  };
}

/** A linha de `pedido_externo` como o robô por regras lê (`PedidoDoRobo`). */
export function pedidoDaLinha(l: any, canal: CanalDaPonte, cliente: string | null): PedidoDoRobo | null {
  if (!l) return null;
  return {
    status: String(l.status ?? ''),
    despachadoEm: l.despachadoEm ?? null,
    modo: modoEntrega({ tipo: l.tipo, canal: l.canal, raw: l.raw }),
    cliente: l.cliente ?? cliente,
    canal,
  };
}

// ───────────────────────── a fila de saída e as marcas ─────────────────────────

export type ItemDaFila = {
  canal: string;
  pedido_id: string | null;
  pedido_externo: string | null;
  pedido_numero: string | null;
  cliente: string | null;
  unidade_id: string | null;
  texto: string;
  /** A fala do atendente virtual (mig 383) — a tela oferece "Corrigir" só nela. */
  robo_ia?: boolean;
};

/**
 * O que o robô diz entra na fila de saída (a ponte que responde pelo canal digita) — uma gravação para o lote todo, na
 * ordem da lista (cada linha com a sua hora — ERR-379). `robo_ia` só entra na gravação quando algum item é do atendente
 * virtual: o robô por regras grava como sempre gravou (num banco sem a 383 também).
 */
export async function enfileirarNoChat(tx: any, tenantId: string, itens: ItemDaFila[]): Promise<void> {
  if (!itens.length) return;
  const comIa = itens.some((i) => i.robo_ia === true);
  await tx.execute(sql`
    insert into chat_plataforma_msg
      (tenant_id, unidade_id, canal, pedido_id, pedido_externo, pedido_numero, cliente_nome, direcao, autor, texto, estado${comIa ? sql`, robo_ia` : sql``})
    select ${tenantId}::uuid, x.unidade_id, x.canal, x.pedido_id, x.pedido_externo, x.pedido_numero, x.cliente,
           'saida', 'robo', x.texto, 'pendente'${comIa ? sql`, coalesce(x.robo_ia, false)` : sql``}
      from jsonb_to_recordset(${JSON.stringify(itens)}::jsonb)
        as x(canal text, pedido_id uuid, pedido_externo text, pedido_numero text, cliente text, unidade_id uuid, texto text, robo_ia boolean)`);
}

/** As falas do cliente da conversa deixam de esperar o atendente (a resposta veio, ou a conversa foi para a equipe). */
async function limparMarcas(tx: any, c: { tenantId: string; canal: string; chave: string }): Promise<void> {
  await tx.execute(sql`
    update chat_plataforma_msg m set robo_entregue_em = null
     where m.robo_entregue_em is not null and m.tenant_id = ${c.tenantId}::uuid and m.canal = ${c.canal}
       and ${chaveSql('m')} = ${c.chave}`);
}

/** As falas `ids` passam a esperar o atendente (a marca da rotina "não respondeu"). Uma gravação. */
export async function marcarEntregues(tx: any, tenantId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await tx.execute(sql`
    update chat_plataforma_msg set robo_entregue_em = now()
     where tenant_id = ${tenantId}::uuid and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
}

/** A marca das falas `ids` sai (a entrega ao robô falhou: a conversa segue o robô por regras). */
export async function desmarcarEntregues(tx: any, tenantId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await tx.execute(sql`
    update chat_plataforma_msg set robo_entregue_em = null
     where tenant_id = ${tenantId}::uuid and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
}

// ───────────────────────── abrir (ou somar) o caso da conversa ─────────────────────────

/**
 * O caso de chat da conversa pelo MESMO caminho dos casos do chat (`casosDoChat`, na transação e com a trava da empresa):
 * abre com o resumo (e urgente) ou soma ao aberto; fora do horário da equipe, o caso novo nasce recado para a abertura.
 * `sempreAbre`: abre mesmo se a última fala for um agradecimento (quem chama decidiu que é da equipe). `id` = o id do caso
 * novo (a rotina passa o da chave — V42).
 */
async function casoDaConversa(
  tx: any,
  c: ConversaDaChave,
  robo: RoboNoCaso & { id?: string },
  equipe: Map<string, SituacaoDaEquipe> | undefined,
  fala?: string,
): Promise<{ novos: any[]; somados: string[] }> {
  return casosDoChat(tx, c.tenantId, [comoMensagem(c, fala)], new Map([[chaveDoMapa({ canal: c.canal, chave: c.chave }), robo]]), equipe, { sempreAbre: true });
}

/** O "já chamei a equipe" do caso novo — fora do horário, a frase de fora do horário pela trava da plataforma. */
const fraseDoChamado = (caso: any, equipe: Map<string, SituacaoDaEquipe> | undefined): string =>
  caso?.detalhe?.recado ? fraseForaDoHorarioNoChat(equipe?.get(chaveDaLoja(caso.unidade_id)), caso.detalhe.recado) : CHAMEI_A_EQUIPE;

// ───────────────────────── a RESPOSTA do atendente (publico/bot/responder com `chat:`) ─────────────────────────

export type RespostaNoChat = {
  ok: true;
  enviado: boolean;
  motivo?: string;
  enviados?: string[];
  /** Barrada pela trava: o que foi no lugar ('resposta_por_regras', 'ja_chamei_a_equipe' ou 'caso'). */
  noLugar?: string;
};

/**
 * A resposta do atendente virtual no chat da plataforma. `chaves` = a instância e o `para` que o robô mandou (as que são
 * `chat:` têm de ser a MESMA fala); `texto` = o que ele escreveu, já com as opções numeradas (`opcoesNoChat`). Tudo na
 * trava da empresa (a mesma da entrada), lendo ANTES o que decide (V83). Ver o topo do arquivo.
 */
export async function responderNoChatDaPlataforma(db: any, emitir: Emitir | undefined, chaves: unknown[], texto: string, log: Log): Promise<RespostaNoChat> {
  const ids = chaves.filter(ehChaveDoChat).map(idDaChaveDoChat);
  if (!ids.length || ids.some((id) => !id) || new Set(ids).size !== 1) throw new BadRequestException('Conversa do chat inválida.');
  const c = await conversaDaChave(db, chaveDoChat(ids[0] as string));
  if (!c) throw new NotFoundException('Conversa do chat não encontrada.');
  const plataforma = nomeDaPlataforma(c.canal);
  // Lidos fora da transação (uma leitura que falhe não a derruba): quem envia pelo canal e a situação da equipe da loja.
  const [envia, equipe] = await Promise.all([alguemEnviaPeloCanal(db, c.tenantId, c.unidadeId, c.canal), situacoesPorLoja(db, c.tenantId, [c.unidadeId])]);
  const trava = travaDaPlataforma(texto);
  const r = await db.transaction(async (tx: any): Promise<{ resposta: Omit<RespostaNoChat, 'ok'>; novos: any[]; somados: string[] }> => {
    const nada = { novos: [] as any[], somados: [] as string[] };
    const [cfg] = linhas(
      await tx.execute(sql`
        select chat_ponte_ligada as ligada, chat_robo_responde as responde, to_jsonb(rc) ->> 'chat_robo_modo' as modo
          from robo_config rc where rc.tenant_id = ${c.tenantId}::uuid for update`),
    );
    // Desligado depois da entrega: nada sai (a marca fica — a rotina abre o caso se a ponte segue ligada).
    if (cfg?.ligada !== true) return { resposta: { enviado: false, motivo: 'ponte_desligada' }, ...nada };
    if (cfg?.responde !== true || modoDaLinha(cfg?.modo) !== 'atendente') return { resposta: { enviado: false, motivo: 'atendente_desligado' }, ...nada };
    const [l] = linhas(
      await tx.execute(sql`
        select (select row_to_json(x) from (
                  select a.id, (a.detalhe #>> '{chat,avisoLiberado}') = 'true' as "avisoLiberado"
                    from atendimento_chamado a
                   where a.tenant_id = ${c.tenantId}::uuid and a.canal = ${c.canal} and a.detalhe #>> '{chat,chave}' = ${c.chave}
                     and ${casoQueCalaSql('a')}
                   order by a.criado_em desc limit 1) x) as caso,
               (select count(*)::int from chat_plataforma_msg m
                 where m.tenant_id = ${c.tenantId}::uuid and m.canal = ${c.canal} and m.direcao = 'saida' and m.autor = 'robo'
                   and m.robo_ia and m.criado_em > now() - interval '1 hour' and ${chaveSql('m')} = ${c.chave}) as falas,
               (select count(*)::int from chat_plataforma_msg m
                 where m.tenant_id = ${c.tenantId}::uuid and m.canal = ${c.canal} and m.direcao = 'saida' and m.autor = 'robo'
                   and m.texto <> ${CHAMEI_A_EQUIPE} and m.criado_em > now() - interval '1 hour' and ${chaveSql('m')} = ${c.chave}) as "respostasNaHora",
               (select m.texto from chat_plataforma_msg m where ${falasDoClienteSql(c)} order by m.criado_em desc, m.id desc limit 1) as fala,
               (select row_to_json(p) from (
                  select pe.status, pe.despachado_em as "despachadoEm", pe.cliente_nome as cliente, pe.tipo, pe.canal, pe.raw
                    from pedido_externo pe where pe.tenant_id = ${c.tenantId}::uuid and pe.id = ${c.pedidoId}::uuid) p) as pedido,
               -- uma pessoa da loja está conversando pela plataforma (Gestor do iFood, app da 99) — 10/11/2026, pedido 1948
               ${lojaFalouSql({ tenantId: c.tenantId, canal: sql`${c.canal}`, chave: sql`${c.chave}` })} as "lojaFalou"`),
    );
    const fala = String(l?.fala ?? c.texto);
    // A LOJA ESTÁ CONVERSANDO com o cliente (escreveu pelo Gestor, pelo app da 99 ou pelo Regem, dentro da pausa da loja):
    // a resposta do atendente virtual não sai — ela foi pensada sem o que a loja disse.
    if (l?.lojaFalou === true && !l?.caso) {
      await limparMarcas(tx, c);
      return { resposta: { enviado: false, motivo: 'a_loja_esta_conversando' }, ...nada };
    }
    // CASO ABERTO COM A EQUIPE: quieto — salvo UMA vez o "já chamei" que o "chamar atendente" liberou (lido antes de abrir, V83).
    let liberado = false;
    if (l?.caso) {
      const usado = l.caso.avisoLiberado
        ? linhas(
            await tx.execute(sql`
              update atendimento_chamado
                 set detalhe = detalhe || jsonb_build_object('chat', (detalhe -> 'chat') || jsonb_build_object('avisoLiberado', false))
               where id = ${l.caso.id}::uuid and status = 'aberto' and (detalhe #>> '{chat,avisoLiberado}') = 'true'
              returning id`),
          )
        : [];
      if (!usado.length) {
        await limparMarcas(tx, c);
        return { resposta: { enviado: false, motivo: 'conversa_com_a_equipe' }, ...nada };
      }
      liberado = true;
    }
    // NINGUÉM ENVIA pelo canal agora: a resposta ficaria na fila e cairia em 30 min — vira caso (V88), sem "já chamei".
    if (!envia) {
      await limparMarcas(tx, c);
      if (liberado) return { resposta: { enviado: false, motivo: 'ninguem_envia' }, ...nada };
      const chateado = ehChateado(fala);
      const casos = await casoDaConversa(
        tx,
        c,
        {
          urgente: chateado,
          resumo: {
            motivo: 'O atendente virtual respondeu, mas nenhum PC da ponte envia pelo chat agora',
            quer: fala.replace(/\s+/g, ' ').trim().slice(0, 300) || null,
            jaFez: `Não respondeu: nenhum PC da ponte envia pelo chat ${plataforma} agora`,
            humor: chateado ? 'chateado' : null,
          },
        },
        equipe,
        fala,
      );
      return { resposta: { enviado: false, motivo: 'ninguem_envia', noLugar: 'caso' }, ...casos };
    }
    // O LIMITE de falas do atendente por pedido na hora: a equipe, como a 3ª pergunta do robô por regras.
    if (!liberado && Number(l?.falas ?? 0) >= FALAS_DO_ATENDENTE_POR_HORA) {
      const d = chamarPeloLimite(fala);
      const casos = await casoDaConversa(tx, c, { resumo: d.resumo, urgente: d.urgente }, equipe, fala);
      await enfileirarNoChat(tx, c.tenantId, casos.novos.map((n) => naFila(c, fraseDoChamado(n, equipe))));
      await limparMarcas(tx, c);
      return { resposta: { enviado: false, motivo: 'limite_por_hora', noLugar: casos.novos.length ? 'ja_chamei_a_equipe' : 'caso' }, ...casos };
    }
    // A TRAVA DA PLATAFORMA: nada do texto do atendente sai — vai a resposta por regras da conversa, ou o caso.
    if (!trava.ok) {
      log.warn(`atendente virtual no chat ${c.canal}: resposta barrada pela trava da plataforma (${NOME_DO_MOTIVO_DA_TRAVA[trava.motivo]}) empresa=${c.tenantId}`);
      await limparMarcas(tx, c);
      if (liberado) {
        // o caso já está aberto (ele mesmo chamou): no lugar, o "já chamei a equipe"
        await enfileirarNoChat(tx, c.tenantId, [naFila(c, CHAMEI_A_EQUIPE)]);
        return { resposta: { enviado: false, motivo: 'barrada_pela_plataforma', noLugar: 'ja_chamei_a_equipe' }, ...nada };
      }
      const pedido = pedidoDaLinha(l?.pedido, c.canal, c.cliente);
      const d = decidir({
        intencao: intencaoDoCliente(fala),
        casoAberto: false,
        respostasNaHora: Number(l?.respostasNaHora ?? 0),
        pedido,
        horaPrevista: null,
        fala,
        canal: c.canal,
        envia: true,
      });
      if (d.acao === 'responder') {
        await enfileirarNoChat(tx, c.tenantId, [naFila(c, d.texto)]);
        return { resposta: { enviado: false, motivo: 'barrada_pela_plataforma', noLugar: 'resposta_por_regras' }, ...nada };
      }
      if (d.acao !== 'chamar_equipe') return { resposta: { enviado: false, motivo: 'barrada_pela_plataforma' }, ...nada };
      const resumo: ResumoDoRobo = { ...d.resumo, motivo: 'O atendente virtual escreveu algo que a plataforma proíbe (telefone, WhatsApp, Instagram, e-mail ou link)' };
      const casos = await casoDaConversa(tx, c, { resumo, urgente: d.urgente }, equipe, fala);
      await enfileirarNoChat(tx, c.tenantId, casos.novos.map((n) => naFila(c, fraseDoChamado(n, equipe))));
      return { resposta: { enviado: false, motivo: 'barrada_pela_plataforma', noLugar: casos.novos.length ? 'ja_chamei_a_equipe' : 'caso' }, ...casos };
    }
    if (trava.cortado) log.warn(`atendente virtual no chat ${c.canal}: a resposta passou de ${trava.partes.length} mensagens de 300 letras — o resto ficou de fora (empresa ${c.tenantId})`);
    await enfileirarNoChat(tx, c.tenantId, trava.partes.map((p) => naFila(c, p, true)));
    await limparMarcas(tx, c);
    return { resposta: { enviado: true, enviados: trava.partes.map(() => 'texto') }, ...nada };
  });
  for (const chamado of r.novos) emitir?.('atendimento.novo', { tenantId: c.tenantId, chamado });
  for (const id of r.somados) emitir?.('atendimento.mudou', { tenantId: c.tenantId, id, motivo: 'atendente_virtual_no_chat' });
  return { ok: true, ...r.resposta };
}

// ───────────────────────── o "CHAMAR ATENDENTE" com `chat:` ─────────────────────────

/**
 * O "chamar atendente" do robô na conversa do chat (`telefone: chat:<id>` — a conversa tem de ser da empresa do token do
 * cardápio). Abre ou soma o caso de chat DESSA conversa pelo mesmo caminho dos casos do chat, com o resumo do robô (Motivo /
 * Quer / Já fiz), urgente se ele disser (somar só SOBE a prioridade) e o recado da abertura fora do horário (F1). Lê ANTES
 * se a conversa já estava com a equipe (V83): se não estava, libera UMA resposta do robô (o "já chamei a equipe" que ele
 * escreve em seguida — o caso aberto cala o robô). Não envia nada sozinho. Os assuntos que não são pedido (F3) não se aplicam
 * no chat da plataforma: o tipo vira o caso comum. Devolve a forma do chamado do robô (com `paraOCliente` fora do horário,
 * já pela trava da plataforma).
 */
export async function chamarAtendenteNoChat(db: any, emitir: Emitir | undefined, tenantIdDoCardapio: string, dto: any) {
  const c = await conversaDaChave(db, dto?.telefone);
  if (!c || c.tenantId !== tenantIdDoCardapio) throw new UnauthorizedException('Conversa do chat inválida.');
  const urgente = dto?.prioridade === 'urgente' || dto?.urgente === true || dto?.urgente === 'true';
  const resumo = resumoDoRobo(dto, urgente);
  // Lidos fora da transação: a situação da equipe da loja e a fala de agora do cliente (o texto do caso).
  const [equipe, fala] = await Promise.all([situacoesPorLoja(db, c.tenantId, [c.unidadeId]), ultimaFalaDoCliente(db, c)]);
  const r = await db.transaction(async (tx: any) => {
    await tx.execute(sql`select 1 from robo_config where tenant_id = ${c.tenantId}::uuid for update`);
    // V83: a leitura de ANTES de abrir decide o "já chamei" — com a conversa já com a equipe, o robô não fala por cima.
    const [antes] = linhas(
      await tx.execute(sql`
        select exists (select 1 from atendimento_chamado a
                        where a.tenant_id = ${c.tenantId}::uuid and a.canal = ${c.canal} and a.detalhe #>> '{chat,chave}' = ${c.chave}
                          and ${casoQueCalaSql('a')}) as "comAEquipe"`),
    );
    const liberar = antes?.comAEquipe !== true;
    const casos = await casoDaConversa(tx, c, { resumo, urgente }, equipe, fala);
    const id: string | undefined = casos.novos[0]?.id ?? casos.somados[0];
    if (!id) throw new NotFoundException('Conversa do chat inválida.');
    const marca = { avisoLiberado: liberar, abertoPeloRobo: true };
    // Somar: o resumo novo vai junto e a prioridade só SOBE (nunca desce) — mesclado no banco (V82).
    const [{ prioridadeAntes, ...linha }] = linhas(
      await tx.execute(sql`
        with antes as (select prioridade from atendimento_chamado where id = ${id}::uuid)
        update atendimento_chamado
           set prioridade = case when ${urgente}::boolean then 'urgente' else prioridade end,
               detalhe = coalesce(detalhe, '{}'::jsonb)
                         || ${JSON.stringify(resumo && casos.somados.length ? { robo: { ...resumo, em: new Date().toISOString() } } : {})}::jsonb
                         || jsonb_build_object('chat', coalesce(detalhe -> 'chat', '{}'::jsonb) || ${JSON.stringify(marca)}::jsonb)
         where id = ${id}::uuid and tenant_id = ${c.tenantId}::uuid
        returning *, (select prioridade from antes) as "prioridadeAntes"`),
    );
    const novo = casos.novos.length > 0;
    return { linha, novo, subiu: !novo && prioridadeAntes !== 'urgente' && linha.prioridade === 'urgente' };
  });
  const caso = r.linha;
  // O caso novo — ou o que SUBIU para urgente — toca na tela de novo (como no Direct); somar sem subir só avisa que mudou.
  if (r.novo || r.subiu) emitir?.('atendimento.novo', { tenantId: c.tenantId, chamado: caso });
  else emitir?.('atendimento.mudou', { tenantId: c.tenantId, id: caso.id, motivo: 'robo_somou' });
  const recado = recadoAtivo(caso?.detalhe) ? lerRecado(caso?.detalhe) : null;
  if (recado) {
    const s = equipe.get(chaveDaLoja(c.unidadeId));
    return {
      ok: true,
      id: caso.id,
      prioridade: caso.prioridade,
      comAlguem: false,
      ...respostaDoRecado(recado, s?.textoFora ?? null),
      paraOCliente: fraseForaDoHorarioNoChat(s, recado),
    };
  }
  const pos = await posicaoNaFila(db, c.tenantId, caso.id);
  const [cfg] = linhas(await db.execute(sql`select dizer_posicao as "dizer" from robo_config where tenant_id = ${c.tenantId}::uuid`));
  return { ok: true, id: caso.id, prioridade: caso.prioridade, posicao: cfg?.dizer === false ? null : pos.posicao, comAlguem: pos.comAlguem };
}

// ───────────────────────── as FERRAMENTAS de pedido com `chat:` ─────────────────────────

/**
 * O pedido DA conversa para as ferramentas de pedido do robô (`publico/bot/pedidos` e `pedido-status` com `chat:` na
 * instância ou no telefone) — nunca por dígitos de telefone. As chaves `chat:` que vierem têm de ser a MESMA fala. Sem pedido
 * ligado (ou chave que não resolve) → null.
 */
export async function pedidoDaConversaDoChat(db: any, chaves: unknown[]) {
  const ids = chaves.filter(ehChaveDoChat).map(idDaChaveDoChat);
  if (!ids.length || ids.some((id) => !id) || new Set(ids).size !== 1) return null;
  const c = await conversaDaChave(db, chaveDoChat(ids[0] as string));
  if (!c?.pedidoId) return null;
  const [p] = linhas(
    await db.execute(sql`
      select pe.numero, pe.display_id as "displayId", pe.status, pe.status_pagamento as "statusPagamento", pe.tipo, pe.total,
             pe.entregador_nome as "entregadorNome", pe.criado_em as "criadoEm", pe.despachado_em as "despachadoEm",
             pe.cliente_nome as cliente, pe.canal, pe.raw
        from pedido_externo pe where pe.tenant_id = ${c.tenantId}::uuid and pe.id = ${c.pedidoId}::uuid`),
  );
  if (!p) return null;
  return { conversa: c, linha: p, doRobo: pedidoDaLinha(p, c.canal, c.cliente) as PedidoDoRobo };
}

// ───────────────────────── a rotina "o atendente virtual não respondeu" (V88) ─────────────────────────

/**
 * SQL: a marca `m` ainda espera o atendente — nas últimas 30 min, com a ponte ligada, sem caso de chat aberto na conversa
 * (com alguém, na fila ou recado: a conversa já está com a equipe) e sem resposta depois dela (do robô, da equipe, ou da loja
 * escrevendo no Gestor). Uma regra só: a limpeza apaga as marcas que NÃO esperam; a rotina pega as que esperam (V84).
 */
const marcaQueEspera = (m: string): SQL => {
  const a = sql.raw(m);
  return sql`(${a}.robo_entregue_em > now() - make_interval(mins => ${JANELA_DA_MARCA_MIN}::int)
    and exists (select 1 from robo_config rc where rc.tenant_id = ${a}.tenant_id and rc.chat_ponte_ligada)
    and not exists (select 1 from atendimento_chamado c
                     where c.tenant_id = ${a}.tenant_id and c.tipo = 'chat' and c.status = 'aberto' and c.canal = ${a}.canal
                       and c.detalhe #>> '{chat,chave}' = ${chaveSql(m)})
    and not exists (select 1 from chat_plataforma_msg r
                     where r.tenant_id = ${a}.tenant_id and r.canal = ${a}.canal and r.criado_em > ${a}.criado_em
                       and ((r.direcao = 'saida' and r.autor in ('robo', 'equipe')) or (r.direcao = 'entrada' and r.autor = 'loja'))
                       and ${chaveSql('r')} = ${chaveSql(m)}))`;
};

/**
 * O ATENDENTE VIRTUAL NÃO RESPONDEU (V88), a cada minuto, só na nuvem: a fala do cliente entregue ao atendente há mais de
 * 2 min, sem resposta e sem caso, vira caso (resumo "o atendente virtual não respondeu") e o cliente recebe "já chamei a
 * equipe" quando algum PC envia pelo canal. Primeiro a limpeza (set-based) tira da frente as marcas que não esperam mais
 * nada; a leitura pega só as que esperam (o índice parcial da 383 guarda só as marcas vivas — V84). Cada uma na trava da
 * empresa, conferida de novo; o id do caso vem da fala (`uuidDeChave` — duas rodadas ou duas réplicas = um caso, V42); a
 * marca sai em todo caso. Nunca rejeita (V3): a falha de uma não derruba as outras; o motivo vai para o log.
 */
export async function semRespostaDoAtendente(db: any, emitir: Emitir | undefined, log: Log): Promise<number> {
  if (ehServidorLocal()) return 0;
  let candidatas: any[];
  try {
    await db.execute(sql`
      update chat_plataforma_msg m set robo_entregue_em = null
       where m.robo_entregue_em is not null and not ${marcaQueEspera('m')}`);
    candidatas = linhas(
      await db.execute(sql`
        select m.id from chat_plataforma_msg m
         where m.robo_entregue_em is not null
           and m.robo_entregue_em < now() - make_interval(secs => ${SEM_RESPOSTA_DO_ATENDENTE_MS / 1000}::int)
           and ${marcaQueEspera('m')}
         order by m.robo_entregue_em
         limit ${MARCAS_POR_RODADA}`),
    );
  } catch (e: any) {
    // Banco sem a 383 (a coluna da marca): nada a fazer — não enche o log a cada minuto.
    const code = e?.code ?? e?.cause?.code;
    if (code === '42703' || code === '42P01') return 0;
    log.warn(`atendente virtual no chat: a rotina "não respondeu" falhou — ${e?.message ?? e}`);
    return 0;
  }
  let abertos = 0;
  for (const { id } of candidatas) {
    try {
      const c = await conversaDaChave(db, chaveDoChat(String(id)));
      if (!c) continue;
      const [envia, equipe] = await Promise.all([alguemEnviaPeloCanal(db, c.tenantId, c.unidadeId, c.canal), situacoesPorLoja(db, c.tenantId, [c.unidadeId])]);
      const r = await db.transaction(async (tx: any) => {
        await tx.execute(sql`select 1 from robo_config where tenant_id = ${c.tenantId}::uuid for update`);
        const [ainda] = linhas(
          await tx.execute(sql`
            select 1 as ok from chat_plataforma_msg m
             where m.id = ${c.msgId}::uuid and m.robo_entregue_em is not null
               and m.robo_entregue_em < now() - make_interval(secs => ${SEM_RESPOSTA_DO_ATENDENTE_MS / 1000}::int)
               and ${marcaQueEspera('m')}`),
        );
        if (!ainda) {
          await desmarcarEntregues(tx, c.tenantId, [c.msgId]);
          return { novos: [] as any[], somados: [] as string[] };
        }
        const chateado = ehChateado(c.texto);
        const casos = await casoDaConversa(
          tx,
          c,
          {
            id: uuidDeChave('chat-atendente-sem-resposta', c.tenantId, c.msgId),
            urgente: chateado,
            resumo: {
              motivo: 'O atendente virtual não respondeu',
              quer: c.texto.replace(/\s+/g, ' ').trim().slice(0, 300) || null,
              jaFez: envia ? 'Avisou o cliente no chat que chamou a equipe da loja' : `Não respondeu: nenhum PC da ponte envia pelo chat ${nomeDaPlataforma(c.canal)} agora`,
              humor: chateado ? 'chateado' : null,
            },
          },
          equipe,
        );
        if (envia) await enfileirarNoChat(tx, c.tenantId, casos.novos.map((n) => naFila(c, fraseDoChamado(n, equipe))));
        await limparMarcas(tx, c);
        return casos;
      });
      for (const chamado of r.novos) {
        abertos++;
        log.log?.(`atendente virtual no chat sem resposta virou caso (empresa ${c.tenantId}).`);
        emitir?.('atendimento.novo', { tenantId: c.tenantId, chamado });
      }
      for (const sid of r.somados) emitir?.('atendimento.mudou', { tenantId: c.tenantId, id: sid, motivo: 'atendente_virtual_sem_resposta' });
    } catch (e: any) {
      log.warn(`atendente virtual no chat sem resposta (fala ${id}): ${e?.message ?? e}`);
    }
  }
  return abertos;
}
