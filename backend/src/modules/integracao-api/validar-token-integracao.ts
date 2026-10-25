import { Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { LIMITE_INTEGRACAO_POR_MINUTO } from '../../common/integracao-limite';
import { POLITICA_LIGACAO, resumoChave, situacaoChave, type AplicativoAprovado } from '../../dms/integracao-dms';
import type { EscopoIntegracao } from './escopos';
import type { IntegracaoCtxData } from './integracao-token.guard';
import { motivoDaRecusaDaLigacao, permissoesDaLigacao } from './ligacao.regras';
import { clienteDoParceiro, ehClienteDeParceiro, LIMITE_PARCEIRO_EMPRESA_POR_MINUTO, permissoesDoParceiro } from './parceiros.regras';
import { hashTokenIntegracao } from './token-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A VALIDAÇÃO do token de integração e o "último uso", fora do `IntegracaoTokenService` (14/10/2026).
//
// O serviço vive no `IntegracaoApiModule`, que é SÓ NUVEM (`edge-manifest.ts`): o servidor da loja nem o
// sobe. As cinco rotas do totem (GoGeM, mig 323) moram em módulos que rodam na loja (venda, delivery,
// produto) e também aceitam o token de integração — o guard delas (`credencial-totem.guard.ts`) usa estas
// funções sem importar o módulo da nuvem. O serviço usa as mesmas: uma regra só.
//
// A LIGAÇÃO do Hub DMS (F3, mig 329) é outra forma de apresentar o MESMO token: a validação dela lê o token
// junto, com as mesmas colunas e o mesmo motivo de recusa — revogar o token corta a ligação na chamada seguinte.

const log = new Logger('IntegracaoToken');
/** Intervalo mínimo entre duas gravações do "último uso" do mesmo token. */
const USO_INTERVALO_MS = 60_000;
/** Última gravação do uso por token, no processo (compartilhado pelo serviço e pelo guard do totem). */
const usoGravado = new Map<string, number>();

/**
 * O que decide se o token vale e monta o contexto — a mesma lista nas duas vias (o `rgm_it_` e a ligação). Token de
 * LOJA: a loja tem de existir, ser da empresa e estar viva (senão, "loja apagada"). Token da EMPRESA (sem loja — só o
 * RegemCast, mig 302): vale a empresa inteira. Pede `t` (o token), `u` (a loja) e `e` (a empresa) na consulta.
 */
const COLUNAS_DO_TOKEN = sql`
           t.tenant_id, t.unidade_id, t.cliente, t.escopos, t.autorizado_por,
           t.revogado_em is not null as revogado,
           (t.expira_em is not null and t.expira_em <= now()) as vencido,
           (t.unidade_id is not null and (u.id is null or u.deleted_at is not null)) as loja_apagada,
           e.deleted_at is not null as empresa_apagada,
           (select count(*)::int from unidade u2
             where u2.tenant_id = t.tenant_id and u2.deleted_at is null) as lojas`;

// ───────────────────────────── o limite de chamadas no banco (Hub DMS, F3-8; mig 333) ─────────────────────────────
//
// A contagem por minuto vai NA MESMA instrução da validação (CTE de escrita): uma ida ao banco só, como antes. Conta só
// o acesso que o banco aceita (não revogado, não vencido, loja e empresa vivas; pela ligação, também a ligação não
// revogada), pelo id do token — as duas vias somam. Sem a tabela (42P01: migration não aplicada), a validação roda sem
// contar e o guard cai no contador em memória (`common/integracao-limite.ts`), com aviso no log: o limite nunca derruba
// a chamada.

/** O que a contagem no banco devolve: passou do limite na janela, e quanto falta para ela virar. */
export type LimiteContado = { ok: boolean; retryAfterSeg: number };

/**
 * O que a validação diz a mais da ligação de um aplicativo de PARCEIRO (F4, parte F): se ela está suspensa (90 dias sem
 * uso, Padrão §3) e a contagem do teto da empresa (o aplicativo em todas as lojas dela), quando contou no banco.
 */
export type DoParceiro = { suspensa: boolean; limiteEmpresa?: LimiteContado };

/** A chave da contagem do teto da empresa de um aplicativo de parceiro (a mesma no banco e na memória). */
export const chaveDoLimiteDaEmpresa = (cliente: string, tenantId: string) => `emp:${cliente}:${tenantId}`;

/** Até quando a tabela do limite é dada como ausente (não tenta de novo a cada chamada) e a última limpeza. */
let semTabelaDoLimiteAte = 0;
let limpezaDoLimiteEm = 0;
const AVISO_SEM_TABELA_MS = 5 * 60_000;
const LIMPEZA_DO_LIMITE_MS = 60 * 60_000;

const codigoPg = (e: any): string | undefined => e?.code ?? e?.cause?.code;

/** O incremento da janela de um minuto de uma linha do limite (a mesma regra para os dois contadores). */
const JANELA_DO_LIMITE = sql`
      on conflict (chave) do update
         set inicio = case when lim.inicio <= now() - interval '1 minute' then now() else lim.inicio end,
             chamadas = case when lim.inicio <= now() - interval '1 minute' then 1 else lim.chamadas + 1 end
      returning lim.chamadas,
                greatest(1, ceil(extract(epoch from (lim.inicio + interval '1 minute' - now()))))::int as resta`;

/**
 * A seleção do acesso (`achado`) com a contagem do minuto, quando `valido` (condição sobre `achado`), numa linha só.
 *
 * `empresa` (só a ligação de um aplicativo de parceiro APROVADO, decidido antes da consulta): o segundo contador, o teto
 * da empresa, chave `emp:<cliente>:<empresa>`. Ele lê o primeiro (`cross join conta`): só conta a chamada que passou no
 * limite da própria ligação e na condição `empresa` (a ligação é do parceiro aprovado e não está parada há 90 dias). A
 * chamada recusada não gasta a cota das outras lojas do parceiro; e a dependência fixa a ordem das travas (a linha da
 * ligação antes da da empresa).
 */
function comContagem(selecao: SQL, valido: SQL, empresa: SQL | null): SQL {
  const contaDaEmpresa = empresa
    ? sql`,
    conta_empresa as (
      insert into integracao_limite as lim (chave, inicio, chamadas)
      select 'emp:' || achado.cliente || ':' || achado.tenant_id::text, now(), 1
        from achado cross join conta
       where ${valido} and conta.chamadas <= ${LIMITE_INTEGRACAO_POR_MINUTO} and ${empresa}
      ${JANELA_DO_LIMITE}
    )`
    : sql``;
  return sql`
    with achado as (${selecao}),
    conta as (
      insert into integracao_limite as lim (chave, inicio, chamadas)
      select achado.id::text, now(), 1 from achado where ${valido}
      ${JANELA_DO_LIMITE}
    )${contaDaEmpresa}
    select achado.*, conta.chamadas as limite_chamadas, conta.resta as limite_resta
           ${empresa ? sql`, conta_empresa.chamadas as limite_empresa_chamadas, conta_empresa.resta as limite_empresa_resta` : sql``}
      from achado left join conta on true ${empresa ? sql`left join conta_empresa on true` : sql``}`;
}

const TOKEN_VALE = sql`not achado.revogado and not achado.vencido and not achado.loja_apagada and not achado.empresa_apagada`;
const LIGACAO_VALE = sql`${TOKEN_VALE} and not achado.ligacao_revogada`;

/**
 * Linha de acesso parado há mais de um dia sai (no máximo uma vez por hora por processo). Nunca rejeita (V3). A limpeza
 * pula a linha que uma chamada travou (`skip locked`): ela nunca espera, e a chamada que trava duas linhas (a da ligação
 * e a da empresa) não entra num ciclo de espera com ela.
 */
function limparLimitesVelhos(db: any): void {
  const agora = Date.now();
  if (agora - limpezaDoLimiteEm < LIMPEZA_DO_LIMITE_MS) return;
  limpezaDoLimiteEm = agora;
  db.execute(sql`
      delete from integracao_limite
       where chave in (select chave from integracao_limite where inicio < now() - interval '1 day' for update skip locked)`)
    .catch((e: any) => {
      if (codigoPg(e) !== '42P01') log.warn(`limpeza do limite de chamadas não rodou: ${e?.message ?? e}`);
    });
}

/**
 * Roda a seleção do acesso; com `contar`, já contando a chamada no banco (e, sem a tabela, sem contar). `empresa`: a
 * condição do teto da empresa (só a ligação de parceiro aprovado; ver `comContagem`).
 */
async function acharAcesso(db: any, selecao: SQL, valido: SQL, contar: boolean, empresa: SQL | null = null): Promise<any | undefined> {
  if (contar && Date.now() >= semTabelaDoLimiteAte) {
    try {
      const r: any = await db.execute(comContagem(selecao, valido, empresa));
      limparLimitesVelhos(db);
      return (r.rows ?? r)[0];
    } catch (e: any) {
      if (codigoPg(e) !== '42P01') throw e;
      semTabelaDoLimiteAte = Date.now() + AVISO_SEM_TABELA_MS;
      log.warn('limite de chamadas na memória: a tabela integracao_limite (mig 333) não existe neste banco');
    }
  }
  const r: any = await db.execute(selecao);
  return (r.rows ?? r)[0];
}

/** A contagem que veio do banco, ou nada (não contou: a tabela falta ou não se pediu). */
function limiteDaLinha(t: any): { limite?: LimiteContado } {
  if (t?.limite_chamadas === null || t?.limite_chamadas === undefined) return {};
  return {
    limite: {
      ok: Number(t.limite_chamadas) <= LIMITE_INTEGRACAO_POR_MINUTO,
      retryAfterSeg: Math.max(1, Number(t.limite_resta) || 1),
    },
  };
}

/** A contagem do teto da empresa (só a do aplicativo de parceiro), ou nada. */
function limiteDaEmpresaDaLinha(t: any): LimiteContado | undefined {
  if (t?.limite_empresa_chamadas === null || t?.limite_empresa_chamadas === undefined) return undefined;
  return {
    ok: Number(t.limite_empresa_chamadas) <= LIMITE_PARCEIRO_EMPRESA_POR_MINUTO,
    retryAfterSeg: Math.max(1, Number(t.limite_empresa_resta) || 1),
  };
}

/** Por que o token não vale (`null` = vale). */
function motivoDoToken(t: any): string | null {
  return t.revogado ? 'revogado' : t.vencido ? 'vencido' : t.loja_apagada ? 'loja apagada' : t.empresa_apagada ? 'empresa apagada' : null;
}

/** O contexto da chamada a partir da linha do token. */
function contextoDoToken(t: any): IntegracaoCtxData {
  return {
    tokenId: t.id,
    tenantId: t.tenant_id,
    unidadeId: t.unidade_id ?? null,
    abrangencia: t.unidade_id ? 'loja' : 'empresa',
    lojaUnica: Number(t.lojas) === 1,
    escopos: (t.escopos ?? []) as EscopoIntegracao[],
    cliente: t.cliente,
    autorizadoPor: t.autorizado_por,
    prefixo: t.prefixo,
  };
}

/**
 * O token (já com o formato conferido) vale? Busca pelo hash, com a loja e a empresa: a loja tem de ser
 * DA empresa do token e as duas vivas. `null` = recusa (o motivo vai para o log só quando o token
 * existe — revogado, vencido, loja apagada —, nunca o token).
 */
export async function validarTokenIntegracao(
  db: any,
  token: string,
  o: { contar?: boolean } = {},
): Promise<(IntegracaoCtxData & { limite?: LimiteContado }) | null> {
  const selecao = sql`
    select t.id, t.prefixo, ${COLUNAS_DO_TOKEN}
      from integracao_token_loja t
      left join unidade u on u.id = t.unidade_id and u.tenant_id = t.tenant_id
      join empresa e on e.id = t.tenant_id
     where t.token_hash = ${hashTokenIntegracao(token)}
     limit 1`;
  const t = await acharAcesso(db, selecao, TOKEN_VALE, !!o.contar);
  if (!t) return null;
  // O acesso de um aplicativo de parceiro só vale pela via do DMS ID (F4, parte F; decisões F4-3): com o teto da classe,
  // a lista do hub e a suspensão. Pelo `rgm_it_` (e pelo guard do totem, que usa esta função), nunca.
  const motivo = motivoDoToken(t) ?? (ehClienteDeParceiro(t.cliente) ? 'acesso de aplicativo de parceiro só vale pela ligação' : null);
  if (motivo) {
    log.warn(`token ${t.prefixo}… (${t.cliente}) recusado: ${motivo}`);
    return null;
  }
  return { ...contextoDoToken(t), ...limiteDaLinha(t) };
}

/**
 * A ligação (segredo já com a forma conferida, `ligacaoDoCabecalho`) vale para o aplicativo do token do DMS ID? Busca
 * pelo resumo, com o token de onde ela veio (o mesmo id, da mesma empresa), a loja e a empresa. `null` = recusa — a
 * mesma para todo motivo (ligação desconhecida, revogada, de outro aplicativo, aplicativo fora da lista, token revogado,
 * vencido, loja ou empresa apagada); o motivo vai para o log só quando a ligação existe, com o prefixo, nunca o
 * segredo. As permissões do contexto são as que a loja autorizou E o token do DMS ID também tem.
 *
 * O aplicativo de PARCEIRO (F4, parte F), só com `o.parceiro` (quem chama devolve o aprovado que vale, ou nulo — a chave
 * `PARCEIROS_LIGADOS`, o hub e a parada lida ficam com ele): decide-se antes se o aplicativo é da DMS
 * (`DMS_ID_APLICATIVOS`), e o da DMS nunca vira parceiro. Para o parceiro, a ligação tem de ser do `cliente` dele; as
 * permissões são as de sempre E as do teto da classe na etapa (`permissoesDoParceiro`); vai junto se a ligação está
 * suspensa (90 dias) e a contagem do teto da empresa; e ele lê só as vendas confirmadas depois que o acesso nasceu.
 */
export async function validarLigacaoIntegracao(
  db: any,
  segredo: string,
  doToken: { aplicativo: string; permissoes: readonly string[] },
  aplicativos: Readonly<Record<string, string>>,
  o: { contar?: boolean; parceiro?: (clientId: string) => AplicativoAprovado | null } = {},
): Promise<(IntegracaoCtxData & { limite?: LimiteContado; parceiro?: DoParceiro }) | null> {
  // Quem é decide-se ANTES da consulta: o da DMS nunca vira parceiro; o parceiro aprovado tem o `cliente` dele — e só a
  // ligação dele, não parada há 90 dias, conta no teto da empresa (a chamada que vai ser recusada não gasta a cota).
  const daDms = Object.values(aplicativos).includes(doToken.aplicativo);
  const aprovado = !daDms && o.parceiro ? o.parceiro(doToken.aplicativo) : null;
  const clienteDoAprovado = aprovado ? clienteDoParceiro(doToken.aplicativo) : null;
  // A janela de leitura do parceiro: a da autorização contínua (`ler_desde`, mig 340, gravada na troca do clique) ou a
  // criação do acesso. A coluna só é lida para o parceiro aprovado: os produtos da DMS não dependem dela.
  const inicioDaJanela = clienteDoAprovado ? sql`coalesce(t.ler_desde, t.criado_em)` : sql`t.criado_em`;
  const selecao = sql`
    select l.id, l.prefixo, l.aplicativo, l.revogado_em is not null as ligacao_revogada,
           l.criado_em as ligacao_criada_em, l.ultimo_uso_em as ligacao_ultimo_uso_em,
           coalesce(l.ultimo_uso_em, l.criado_em) <= now() - make_interval(days => ${POLITICA_LIGACAO.suspensaoParadaDias}) as sem_uso,
           to_char((${inicioDaJanela}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as acesso_criado_em,
           ${COLUNAS_DO_TOKEN}
      from integracao_ligacao l
      join integracao_token_loja t on t.id = l.id and t.tenant_id = l.tenant_id
      left join unidade u on u.id = t.unidade_id and u.tenant_id = t.tenant_id
      join empresa e on e.id = t.tenant_id
     where l.segredo_hash = ${resumoChave(segredo)}
     limit 1`;
  const contaNaEmpresa = clienteDoAprovado
    ? sql`achado.cliente = ${clienteDoAprovado} and achado.aplicativo = ${doToken.aplicativo} and not achado.sem_uso`
    : null;
  const l = await acharAcesso(db, selecao, LIGACAO_VALE, !!o.contar, contaNaEmpresa);
  const motivo = motivoDaRecusaDaLigacao(
    l ? { aplicativo: l.aplicativo, cliente: l.cliente, revogada: l.ligacao_revogada, motivoDoToken: motivoDoToken(l) } : null,
    doToken.aplicativo,
    aplicativos,
    clienteDoAprovado ? { cliente: clienteDoAprovado } : null,
  );
  if (motivo) {
    if (l) log.warn(`ligação ${l.prefixo}… (${l.cliente}) recusada: ${motivo}`);
    return null;
  }
  const escopos = permissoesDaLigacao(l.escopos ?? [], doToken.permissoes);
  if (!aprovado) {
    return { ...contextoDoToken(l), escopos, via: 'ligacao', aplicativo: doToken.aplicativo, ...limiteDaLinha(l) };
  }
  const doTeto = permissoesDoParceiro(aprovado);
  const suspensa =
    situacaoChave(
      { criadaEm: new Date(l.ligacao_criada_em), ultimoUsoEm: l.ligacao_ultimo_uso_em ? new Date(l.ligacao_ultimo_uso_em) : null, venceEm: null, revogadaEm: null },
      new Date(),
      POLITICA_LIGACAO.suspensaoParadaDias,
    ).situacao === 'suspensa';
  return {
    ...contextoDoToken(l),
    escopos: escopos.filter((e) => doTeto.includes(e)),
    via: 'ligacao',
    aplicativo: doToken.aplicativo,
    lerVendasDesde: l.acesso_criado_em as string,
    ...limiteDaLinha(l),
    parceiro: { suspensa, limiteEmpresa: limiteDaEmpresaDaLinha(l) },
  };
}

/** Grava o último uso (no máximo 1×/min por token). Nunca rejeita (V3): não derruba a chamada. */
export function marcarUsoTokenIntegracao(db: any, tokenId: string, ip: string | null): void {
  const agora = Date.now();
  if (agora - (usoGravado.get(tokenId) ?? 0) < USO_INTERVALO_MS) return;
  usoGravado.set(tokenId, agora);
  if (usoGravado.size > 50_000) usoGravado.clear();
  db.execute(sql`
      update integracao_token_loja set ultimo_uso_em = now(), ultimo_ip = ${ip ? String(ip).slice(0, 64) : null}
       where id = ${tokenId}`)
    .catch((e: any) => log.warn(`último uso do token ${tokenId.slice(0, 8)} não gravado: ${e?.message ?? e}`));
}

/**
 * O último uso pela ligação (no máximo 1×/min): na ligação e no token de onde ela veio — "Aplicativos conectados" lê o
 * token, e o acesso continua em uso pela via nova. Nunca rejeita (V3).
 */
export function marcarUsoLigacaoIntegracao(db: any, ligacaoId: string, ip: string | null): void {
  const chave = `ligacao:${ligacaoId}`;
  const agora = Date.now();
  if (agora - (usoGravado.get(chave) ?? 0) < USO_INTERVALO_MS) return;
  usoGravado.set(chave, agora);
  if (usoGravado.size > 50_000) usoGravado.clear();
  db.execute(sql`
      with ligacao as (update integracao_ligacao set ultimo_uso_em = now() where id = ${ligacaoId})
      update integracao_token_loja set ultimo_uso_em = now(), ultimo_ip = ${ip ? String(ip).slice(0, 64) : null}
       where id = ${ligacaoId}`)
    .catch((e: any) => log.warn(`último uso da ligação ${ligacaoId.slice(0, 8)} não gravado: ${e?.message ?? e}`));
}
