// AVISO AO GOGEM — venda do totem cancelada NO REGEM → o GoGeM estorna o cartão/PIX.
//
// Com a integração GoGeM ativa, o cancelamento de uma venda do totem é feito no Regem (decisão do
// dono, 25/09/2026) — mas quem devolve o dinheiro é o GoGeM, o único com as credenciais do Mercado
// Pago. Até aqui o Regem desfazia a venda e nunca avisava: o cliente ficava sem o dinheiro.
//
// O contrato do lado do GoGeM (PR #136 dele):
//   POST {GOGEM_CLOUD_URL}/sync/regem/pedido-cancelado     X-Sync-Token: <token da integração>
//   { idempotencyKey, regemComandaId?, motivo? }            (limites do DTO: 120 / 120 / 500)
//   200 → { status:'cancelado', pedidoId, estorno:{ feito, meio, valorCentavos, refundId?, mensagem } }
//
// Duas sutilezas que decidem se o aviso está ENTREGUE ou tem de sair de novo:
//  • `feito:false` com meio `dinheiro`/`desconhecido` = nada eletrônico a estornar → entregue (o
//    dinheiro devolve-se no balcão);
//  • `feito:false` com meio ELETRÔNICO = o Mercado Pago falhou naquela hora. O GoGeM responde 200,
//    marca o pedido cancelado e, quando o aviso chega de novo, TENTA O ESTORNO DE NOVO (o
//    `X-Idempotency-Key` do refund impede estorno em dobro) → para nós é "reenviar", não "entregue".
//
// O TOKEN (ERR-108): o GoGeM aceita UM por empresa — o do equipamento que ELE marcou ao chamar a
// nuvem com `X-Integrador: gogem` (mig 290, `credencial-gogem.ts`). Só a NUVEM fala com o GoGeM:
// o servidor da loja nunca tem esse token (credencial de integração é da distribuição) e repassa o
// aviso para a nuvem (`POST /gogem/avisos/pedido-cancelado`, com o token de sync dele), que envia.
import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

const log = new Logger('AvisoGoGeM');

export const DESTINO_GOGEM = 'gogem';
export const TIPO_PEDIDO_CANCELADO = 'pedido_cancelado';
export const CAMINHO_PEDIDO_CANCELADO = '/sync/regem/pedido-cancelado';
export const GOGEM_NUVEM_PADRAO = 'https://api.gogem.com.br/api/v1';

/** Meios sem nada eletrônico a estornar (resposta do GoGeM). */
const SEM_ESTORNO_ELETRONICO = new Set(['dinheiro', 'desconhecido']);

/** Recuo entre tentativas, em minutos, pelo número de tentativas já feitas. */
const RECUO_MINUTOS = [1, 2, 5, 10, 30, 60, 120, 240, 480, 720];
/** Token recusado (401/403): não é para insistir — de novo só daqui a 6 h (ou quando alguém arrumar). */
export const RECUO_INTEGRACAO_MINUTOS = 360;
/** Passado isto sem entrega, o aviso sai da fila com alerta: o estorno vira manual. */
export const DESISTIR_DEPOIS_DE_DIAS = 7;

export function recuoMinutos(tentativas: number): number {
  const i = Math.max(0, Math.min(RECUO_MINUTOS.length - 1, Number(tentativas || 0) - 1));
  return RECUO_MINUTOS[i];
}

/** Teto do `Retry-After` que aceitamos — valor absurdo não pode parar a fila por semanas. */
const RETRY_AFTER_MAX_S = 24 * 3600;

/**
 * `Retry-After` da resposta, em segundos: número (`120`) ou data HTTP. `null` = ausente ou
 * ilegível. A API do GoGeM limita 120 requisições por minuto por IP, e na nuvem os avisos de
 * todas as lojas saem do mesmo IP — o 429 diz quanto esperar, e é isso que se espera.
 */
export function lerRetryAfter(valor: string | null | undefined, agoraMs = Date.now()): number | null {
  const v = String(valor ?? '').trim();
  if (!v) return null;
  let s: number;
  if (/^\d+$/.test(v)) s = Number(v);
  else {
    const t = Date.parse(v);
    if (!Number.isFinite(t)) return null;
    s = Math.ceil((t - agoraMs) / 1000);
  }
  return Math.min(Math.max(0, s), RETRY_AFTER_MAX_S);
}

/** Corta no limite do DTO sem partir um caractere em dois (emoji é um par de UTF-16). */
function cortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const alto = texto.charCodeAt(max - 1);
  return texto.slice(0, alto >= 0xd800 && alto <= 0xdbff ? max - 1 : max);
}

export type CorpoCancelamentoGogem = {
  idempotencyKey: string;
  regemComandaId?: string;
  motivo: string;
};

/** O corpo do POST, dentro dos limites do DTO do GoGeM — campo a mais ou longo demais é 400 lá. */
export function corpoCancelamento(d: {
  idempotencyKey: string;
  regemComandaId?: string | null;
  motivo?: string | null;
}): CorpoCancelamentoGogem {
  const motivo = String(d.motivo ?? '').trim() || 'Cancelado no Regem';
  return {
    idempotencyKey: cortar(String(d.idempotencyKey), 120),
    ...(d.regemComandaId ? { regemComandaId: cortar(String(d.regemComandaId), 120) } : {}),
    motivo: cortar(motivo, 500),
  };
}

/**
 * A comanda é uma venda do TOTEM? Não há coluna de origem na `comanda`; o marcador é a assinatura
 * do `venderTotem`, o único lugar que cria venda FECHADA com a chave de idempotência do aparelho
 * e SEM operador. O PDV offline (`vendaBalcao`) também grava a chave, mas sempre com o operador
 * logado (`aberta_por_id`); a falha de pagamento do totem nasce com status `falha` e não se cancela.
 * Quem criar outro caminho de venda com chave e sem operador precisa rever isto (V30).
 */
export function ehVendaDoTotem(c: {
  idempotencyKey?: string | null;
  abertaPorId?: string | null;
}): boolean {
  return !!String(c?.idempotencyKey ?? '').trim() && !c?.abertaPorId;
}

export type SituacaoEstornoGogem =
  | 'solicitado'
  | 'sem_estorno_eletronico'
  | 'pendente'
  | 'integracao_recusou'
  | 'recusado';

/** O que o operador vê logo depois de cancelar. */
export type EstornoGogem = { situacao: SituacaoEstornoGogem; mensagem: string };

export type EstornoRespondido = {
  feito: boolean;
  meio: string;
  valorCentavos: number;
  refundId?: string;
  mensagem: string;
};

export type DesfechoAviso = {
  /** Estado em que o aviso fica na fila. */
  status: 'entregue' | 'pendente' | 'aguardando_integracao' | 'recusado';
  paraOperador: EstornoGogem;
  estorno: EstornoRespondido | null;
};

const reais = (centavos: number) =>
  (Number(centavos || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const MSG_PENDENTE =
  'O estorno do cartão/PIX será pedido ao GoGeM assim que a conexão voltar — o Regem tenta sozinho.';

/**
 * Nenhum equipamento marcado como a credencial do GoGeM nesta empresa (mig 290): não se chuta um
 * `servidor_local` qualquer. O GoGeM se identifica sozinho na próxima chamada dele à nuvem (o
 * cardápio sincroniza a cada poucos minutos) — e aí o aviso sai na hora.
 */
export const MSG_GOGEM_NAO_IDENTIFICADO: EstornoGogem = {
  situacao: 'pendente',
  mensagem:
    'O estorno do cartão/PIX será pedido ao GoGeM assim que ele se identificar para esta empresa ' +
    '(acontece sozinho na próxima sincronização do cardápio) — o Regem tenta sozinho.',
};

/** Servidor da loja sem a ligação com a nuvem (`CLOUD_API`/`SYNC_TOKEN`): o aviso não tem por onde sair. */
export const MSG_LOJA_SEM_NUVEM: EstornoGogem = {
  situacao: 'integracao_recusou',
  mensagem:
    'Este servidor da loja não está ligado à nuvem do Regem — o estorno do cartão/PIX NÃO foi pedido ' +
    'ainda. Avise o suporte; o Regem tenta de novo sozinho.',
};

/** A nuvem do Regem recusou o token de sync do servidor da loja (401/403). */
export const MSG_LOJA_RECUSADA: EstornoGogem = {
  situacao: 'integracao_recusou',
  mensagem:
    'A nuvem do Regem recusou o servidor da loja — o estorno do cartão/PIX NÃO foi pedido ainda. ' +
    'Avise o suporte; o Regem tenta de novo a cada 6 h.',
};

/** Rota da NUVEM do Regem que recebe o aviso do servidor da loja e o envia ao GoGeM. */
export const CAMINHO_REPASSE_DA_LOJA = '/gogem/avisos/pedido-cancelado';

/** O que o servidor da loja manda para a nuvem — a nuvem grava com o MESMO id (idempotência). */
export type RepasseDaLoja = {
  avisoId: string;
  chave: string;
  corpo: CorpoCancelamentoGogem;
  referenciaTipo: string | null;
  referenciaId: string | null;
};

export function corpoRepasse(linha: any): RepasseDaLoja {
  return {
    avisoId: String(linha.id),
    chave: String(linha.chave),
    corpo: linha.corpo as CorpoCancelamentoGogem,
    referenciaTipo: linha.referencia_tipo ?? null,
    referenciaId: linha.referencia_id ?? null,
  };
}

const SITUACOES = new Set<SituacaoEstornoGogem>([
  'solicitado',
  'sem_estorno_eletronico',
  'pendente',
  'integracao_recusou',
  'recusado',
]);

/**
 * A resposta da NUVEM do Regem ao repasse do servidor da loja. Aceito = a nuvem gravou o aviso na
 * fila DELA e segue com ele até o GoGeM confirmar: para a loja, o aviso está ENTREGUE. O que o
 * operador vê é o que a nuvem conseguiu com o GoGeM naquela hora (ou "pendente").
 */
export function lerRespostaDaNuvem(http: number | null, corpo: any): DesfechoAviso {
  const pendente: DesfechoAviso = {
    status: 'pendente',
    estorno: null,
    paraOperador: { situacao: 'pendente', mensagem: MSG_PENDENTE },
  };
  if (http == null) return pendente;
  if (http >= 200 && http < 300) {
    if (corpo?.aceito !== true) return pendente;
    const e = corpo?.estorno;
    const paraOperador: EstornoGogem =
      e && SITUACOES.has(e.situacao) && typeof e.mensagem === 'string'
        ? { situacao: e.situacao, mensagem: e.mensagem.slice(0, 500) }
        : { situacao: 'pendente', mensagem: MSG_PENDENTE };
    return { status: 'entregue', estorno: null, paraOperador };
  }
  if (http === 401 || http === 403)
    return { status: 'aguardando_integracao', estorno: null, paraOperador: MSG_LOJA_RECUSADA };
  // 404: nuvem ainda sem a rota (servidor da loja atualizado antes dela) — passa sozinho.
  if (http === 404 || http === 408 || http === 425 || http === 429 || http >= 500) return pendente;
  const motivo = String(corpo?.message ?? corpo?.mensagem ?? '').slice(0, 200);
  return {
    status: 'recusado',
    estorno: null,
    paraOperador: {
      situacao: 'recusado',
      mensagem:
        `A nuvem do Regem recusou o aviso de estorno (HTTP ${http}${motivo ? `: ${motivo}` : ''}) — ` +
        'faça o estorno do cartão/PIX manualmente e avise o suporte.',
    },
  };
}

/**
 * O GoGeM acabou de se identificar para a empresa (mig 290): os avisos que esperavam por ele — sem
 * token marcado, ou recusados com 401 pelo token errado — voltam para a fila AGORA, sem esperar as
 * 6 h. Devolve quantos voltaram.
 */
export async function soltarAvisosParados(db: any, tenantId: string, destino = DESTINO_GOGEM): Promise<number> {
  const r: any = await db.execute(sql`
    update aviso_integracao
       set status = 'pendente', proxima_tentativa_em = now(), updated_at = now()
     where tenant_id = ${tenantId}::uuid and destino = ${destino} and status = 'aguardando_integracao'
    returning id`);
  return (r.rows ?? r).length;
}

/**
 * O que a resposta do GoGeM quer dizer — para a fila e para o operador. `http` nulo = sem
 * resposta (rede, DNS, tempo esgotado): o aviso pode ou não ter chegado, e reenviar é seguro
 * porque o GoGeM é idempotente pela chave.
 */
export function lerRespostaGogem(http: number | null, corpo: any): DesfechoAviso {
  if (http == null)
    return { status: 'pendente', estorno: null, paraOperador: { situacao: 'pendente', mensagem: MSG_PENDENTE } };

  if (http >= 200 && http < 300) {
    const e = corpo?.estorno;
    if (!e || typeof e !== 'object')
      return {
        status: 'entregue',
        estorno: null,
        paraOperador: {
          situacao: 'sem_estorno_eletronico',
          mensagem: 'O GoGeM confirmou o cancelamento sem dizer se estornou — confira no painel do GoGeM.',
        },
      };
    const estorno: EstornoRespondido = {
      feito: e.feito === true,
      meio: String(e.meio ?? 'desconhecido'),
      valorCentavos: Number(e.valorCentavos) || 0,
      ...(e.refundId ? { refundId: String(e.refundId) } : {}),
      mensagem: String(e.mensagem ?? ''),
    };
    if (estorno.feito)
      return {
        status: 'entregue',
        estorno,
        paraOperador: {
          situacao: 'solicitado',
          mensagem:
            `Estorno de ${reais(estorno.valorCentavos)} solicitado ao Mercado Pago pelo GoGeM ` +
            '(cai na fatura ou na conta do cliente em alguns dias).',
        },
      };
    if (SEM_ESTORNO_ELETRONICO.has(estorno.meio))
      return {
        status: 'entregue',
        estorno,
        paraOperador: {
          situacao: 'sem_estorno_eletronico',
          mensagem:
            'Sem estorno eletrônico — devolva o valor ao cliente no balcão.' +
            (estorno.mensagem ? ` (GoGeM: ${estorno.mensagem})` : ''),
        },
      };
    // Pagamento eletrônico existe e o estorno FALHOU no Mercado Pago: o GoGeM tenta de novo
    // quando o aviso chegar outra vez — então o aviso volta para a fila.
    return {
      status: 'pendente',
      estorno,
      paraOperador: {
        situacao: 'pendente',
        mensagem:
          'O GoGeM não conseguiu estornar agora no Mercado Pago — o Regem pede de novo sozinho.' +
          (estorno.mensagem ? ` (GoGeM: ${estorno.mensagem})` : ''),
      },
    };
  }

  if (http === 401 || http === 403)
    return {
      status: 'aguardando_integracao',
      estorno: null,
      paraOperador: {
        situacao: 'integracao_recusou',
        mensagem:
          'O GoGeM recusou o token da integração — o estorno NÃO foi pedido. Confira a integração com o ' +
          'GoGeM; o Regem tenta de novo a cada 6 h.',
      },
    };

  if (http === 408 || http === 425 || http === 429 || http >= 500)
    return { status: 'pendente', estorno: null, paraOperador: { situacao: 'pendente', mensagem: MSG_PENDENTE } };

  const motivo = String(corpo?.message ?? corpo?.mensagem ?? '').slice(0, 200);
  return {
    status: 'recusado',
    estorno: null,
    paraOperador: {
      situacao: 'recusado',
      mensagem:
        `O GoGeM recusou o pedido de estorno (HTTP ${http}${motivo ? `: ${motivo}` : ''}) — ` +
        'faça o estorno do cartão/PIX manualmente.',
    },
  };
}

/**
 * Grava o aviso de cancelamento de venda do totem — dentro da transação do cancelamento, então
 * cancelamento e aviso existem os dois ou nenhum. Um aviso por venda: o índice único faz o
 * segundo caminho (cupom e hub) devolver o aviso que já existe em vez de pedir o estorno de novo.
 *
 * Roda num SAVEPOINT: se a tabela não existir (mig 289 ainda não aplicada), o cancelamento segue
 * — desfazer a venda não pode travar por causa do aviso — e quem chamou fica sabendo que o estorno
 * NÃO foi pedido, para dizer isso ao operador.
 */
export async function gravarAvisoCancelamentoTotem(
  tx: any,
  d: {
    tenantId: string;
    unidadeId: string | null;
    idempotencyKey: string;
    regemComandaId?: string | null;
    motivo?: string | null;
    referenciaTipo: 'comanda' | 'pedido_externo';
    referenciaId: string;
  },
): Promise<{ id: string | null; erro?: string }> {
  const corpo = corpoCancelamento(d);
  try {
    return await tx.transaction(async (sp: any) => {
      const ins: any = await sp.execute(sql`
        insert into aviso_integracao
          (tenant_id, unidade_id, destino, tipo, chave, corpo, referencia_tipo, referencia_id)
        values (${d.tenantId}::uuid, ${d.unidadeId ?? null}::uuid, ${DESTINO_GOGEM}, ${TIPO_PEDIDO_CANCELADO},
                ${corpo.idempotencyKey}, ${JSON.stringify(corpo)}::jsonb, ${d.referenciaTipo}, ${d.referenciaId}::uuid)
        on conflict (tenant_id, destino, tipo, chave) do nothing
        returning id`);
      const novo = (ins.rows ?? ins)[0]?.id as string | undefined;
      if (novo) return { id: novo };
      const ja: any = await sp.execute(sql`
        select id from aviso_integracao
         where tenant_id = ${d.tenantId}::uuid and destino = ${DESTINO_GOGEM}
           and tipo = ${TIPO_PEDIDO_CANCELADO} and chave = ${corpo.idempotencyKey}
         limit 1`);
      return { id: ((ja.rows ?? ja)[0]?.id as string | undefined) ?? null };
    });
  } catch (e: any) {
    // V11: o motivo real vai para o log — sem ele, o estorno que não foi pedido some calado.
    log.error(
      `aviso de cancelamento ao GoGeM NÃO gravado (venda ${d.referenciaId}, chave ${corpo.idempotencyKey}): ` +
        `${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`,
    );
    return { id: null, erro: String(e?.message ?? e) };
  }
}

/** O operador fica sabendo quando o aviso nem chegou a ser gravado. */
export const MSG_NAO_GRAVADO: EstornoGogem = {
  situacao: 'recusado',
  mensagem:
    'Venda cancelada, mas o pedido de estorno ao GoGeM NÃO foi registrado — faça o estorno do ' +
    'cartão/PIX manualmente e avise o suporte.',
};

/**
 * Depois de o cancelamento ser gravado: manda o aviso na hora (prazo curto) e devolve o que o
 * operador precisa ver. `null` = não era venda do totem (nada a dizer). Sem o serviço de envio
 * (teste, ou módulo sem a integração), o aviso fica na fila e a mensagem diz isso.
 */
export async function resultadoDoAviso(
  aviso: { id: string | null; erro?: string } | null,
  enviarAgora?: (avisoId: string) => Promise<EstornoGogem>,
): Promise<EstornoGogem | null> {
  if (!aviso) return null;
  if (!aviso.id) return MSG_NAO_GRAVADO;
  if (!enviarAgora) return { situacao: 'pendente', mensagem: MSG_PENDENTE };
  return enviarAgora(aviso.id);
}
