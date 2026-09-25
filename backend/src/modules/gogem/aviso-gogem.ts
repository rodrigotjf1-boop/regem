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
    idempotencyKey: String(d.idempotencyKey).slice(0, 120),
    ...(d.regemComandaId ? { regemComandaId: String(d.regemComandaId).slice(0, 120) } : {}),
    motivo: motivo.slice(0, 500),
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
