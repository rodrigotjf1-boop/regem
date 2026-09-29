// O ENTREGADOR NA 99 — regras puras (sem banco nem rede), cobertas por `entregador-99.spec.ts`.
//
//  • LOGÍSTICA DA 99 (delivery_type=1): a 99 escolhe o entregador e avisa a loja pelo webhook
//    `deliveryStatus` — `lerDeliveryStatus` tira do corpo cru o status, o nome, o telefone e a
//    previsão de chegada na loja (o corpo tem ids de 64 bits: nada de JSON.parse no todo).
//  • ENTREGA DA LOJA pela 99 (delivery_type=2): o Regem avisa "saiu para entrega"
//    (`selfdelivery/dispatch`) — `dadosDoEntregador` monta o `courier_info` e `limitesDaEntrega`
//    o `limit_time` que a 99 exige (e que o rastreio reenvia a cada posição).
//
// Doc oficial (cópia lida em 29/09/2026): Self Delivery Order Dispatched, Update Courier Track,
// Logistics Webhooks.

export type LogisticaNoCanal = {
  status: number;
  entregadorNome: string | null;
  entregadorTelefone: string | null;
  chegadaLojaPrevista: Date | null;
  eventoEm: Date | null;
};

/** O que cada `delivery_status` da 99 quer dizer para quem está na loja. */
export const STATUS_ENTREGA_99: Record<number, string> = {
  120: 'a caminho da loja',
  130: 'chegou na loja',
  140: 'saiu com o pedido',
  150: 'chegou no cliente',
  160: 'entregou',
  170: 'entrega cancelada',
  180: 'entregador trocado',
  190: 'entrega interrompida',
};

// "timestamp" de 10 dígitos (segundos) → Date; 0/vazio/absurdo → null.
function deUnix(v: unknown): Date | null {
  const n = Number(String(v ?? '').trim());
  if (!Number.isFinite(n) || n < 1_000_000_000 || n > 99_999_999_999) return null;
  return new Date(n * 1000);
}

// Campo string do corpo cru, com escapes do JSON resolvidos ("João" → "João").
function textoDoCorpo(raw: string, campo: string): string | null {
  const m = new RegExp(`"${campo}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(raw);
  if (!m) return null;
  try {
    const s = String(JSON.parse(`"${m[1]}"`)).trim();
    return s || null;
  } catch {
    return m[1].trim() || null;
  }
}

function numeroDoCorpo(raw: string, campo: string): string | null {
  const m = new RegExp(`"${campo}"\\s*:\\s*"?(\\d+)"?`).exec(raw);
  return m ? m[1] : null;
}

/** Lê o webhook `deliveryStatus` da 99. null = não é um status de entrega reconhecível. */
export function lerDeliveryStatus(raw: string): LogisticaNoCanal | null {
  const status = Number(numeroDoCorpo(raw, 'delivery_status'));
  if (!Number.isInteger(status) || status < 100 || status > 999) return null;
  return {
    status,
    entregadorNome: textoDoCorpo(raw, 'rider_name'),
    entregadorTelefone: textoDoCorpo(raw, 'rider_phone'),
    chegadaLojaPrevista: deUnix(numeroDoCorpo(raw, 'rider_to_B_ETA')),
    // o `timestamp` do topo do evento (a data do corpo não traz outro)
    eventoEm: deUnix(numeroDoCorpo(raw, 'timestamp')),
  };
}

/** Telefone brasileiro para a 99: código do país à parte, só os dígitos do número. */
export function telefone99(tel: unknown): { codigo: string; numero: string } | null {
  let d = String(tel ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  return d.length >= 10 && d.length <= 11 ? { codigo: '+55', numero: d } : null;
}

export type Entregador99 = {
  courier_name: string;
  courier_first_name: string;
  courier_last_name: string;
  courier_phone_code: string;
  courier_phone: string;
};

/**
 * `courier_info` do "saiu para entrega". O telefone é obrigatório na 99: vai o do ENTREGADOR só
 * quando ele deixou compartilhar o contato no app (a mesma escolha do aviso "estou chegando");
 * senão o da LOJA, para o cliente ter com quem falar. Sem nenhum dos dois, não há como avisar (null).
 */
export function dadosDoEntregador(p: {
  nome: string | null | undefined;
  telefoneEntregador: string | null | undefined;
  compartilhaContato: boolean;
  telefoneLoja: string | null | undefined;
}): { dados: Entregador99; telefoneDe: 'entregador' | 'loja' } | null {
  const doEntregador = p.compartilhaContato ? telefone99(p.telefoneEntregador) : null;
  const tel = doEntregador ?? telefone99(p.telefoneLoja);
  if (!tel) return null;
  const nome = String(p.nome ?? '').replace(/\s+/g, ' ').trim() || 'Entregador';
  const [primeiro, ...resto] = nome.split(' ');
  return {
    dados: {
      courier_name: nome,
      courier_first_name: primeiro,
      courier_last_name: resto.join(' ') || primeiro,
      courier_phone_code: tel.codigo,
      courier_phone: tel.numero,
    },
    telefoneDe: doEntregador ? 'entregador' : 'loja',
  };
}

/**
 * `limit_time` da 99: `pickup_time` = quando o entregador saiu com o pedido; `delivery_time` = a
 * previsão de entrega — a que a 99 calculou (`expected_arrived_eta`) se ainda estiver à frente,
 * senão 30 min depois da saída; nunca no passado (no mínimo 10 min a partir de agora).
 */
export function limitesDaEntrega(
  despachadoEm: Date,
  previstaPela99: unknown,
  agora = new Date(),
): { coleta: Date; entrega: Date } {
  const coleta = new Date(Math.min(despachadoEm.getTime(), agora.getTime()));
  const minimo = agora.getTime() + 10 * 60_000;
  const da99 = deUnix(previstaPela99);
  const entrega =
    da99 && da99.getTime() >= minimo ? da99 : new Date(Math.max(coleta.getTime() + 30 * 60_000, minimo));
  return { coleta, entrega };
}

export const unix = (d: Date) => Math.floor(d.getTime() / 1000);
