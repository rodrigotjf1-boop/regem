import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// QUEM ENTREGA O PEDIDO — regra ÚNICA do backend. Antes só o app (e o painel) sabiam, lendo o
// `raw` cada um do seu jeito; o backend não sabia, e um pedido de marketplace que o app não
// reconhecesse caía no código aleatório do Regem (que o cliente do iFood/99 nunca recebeu) e o
// entregador ficava travado.
//
//  • retirada          — o cliente busca; não passa pelo entregador.
//  • propria_loja      — cardápio/PDV/outros canais: entregador da loja, código de 4 dígitos do
//                        Regem (conferível offline pelo hash).
//  • propria_canal     — iFood (deliveredBy=MERCHANT) / 99 (delivery_type=2): entregador da loja,
//                        código que o CLIENTE recebe do iFood/99, conferido na API do canal.
//  • logistica_canal   — iFood (deliveredBy=IFOOD) / 99 (delivery_type=1): o entregador é da
//                        plataforma; a loja não despacha e o canal conclui sozinho.
//
// iFood/99 sem o campo no `raw` (pedido antigo, payload incompleto) contam como entrega própria:
// se o pedido está na mão do entregador da loja, é a loja que entrega — e o canal confere o código.
export type ModoEntrega = 'retirada' | 'propria_loja' | 'propria_canal' | 'logistica_canal';

export const CANAIS_COM_CODIGO = ['ifood', '99food'] as const;
export type CanalComCodigo = (typeof CANAIS_COM_CODIGO)[number];

export function ehCanalComCodigo(canal: unknown): canal is CanalComCodigo {
  return (CANAIS_COM_CODIGO as readonly string[]).includes(String(canal ?? ''));
}

function rawObj(raw: any): any {
  if (raw && typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw ?? null;
}

export function modoEntrega(p: { tipo?: unknown; canal?: unknown; raw?: unknown }): ModoEntrega {
  if (String(p.tipo ?? '') === 'retirada') return 'retirada';
  const canal = String(p.canal ?? '');
  if (!ehCanalComCodigo(canal)) return 'propria_loja';
  const raw = rawObj(p.raw);
  if (canal === 'ifood') {
    const por = String(raw?.delivery?.deliveredBy ?? '').toUpperCase();
    return por === 'IFOOD' ? 'logistica_canal' : 'propria_canal';
  }
  // 99: delivery_type 1 = entrega da 99 · 2 = entrega da loja · 0 = retirada (fulfillment_mode 1 idem).
  const tipo99 = raw?.delivery_type;
  if (Number(raw?.fulfillment_mode) === 1 || (tipo99 != null && Number(tipo99) === 0)) return 'retirada';
  return tipo99 != null && Number(tipo99) === 1 ? 'logistica_canal' : 'propria_canal';
}

export const nomeDoCanal = (canal: unknown) => (String(canal) === 'ifood' ? 'iFood' : '99');

/**
 * Plano B da 99 para a entrega própria: a página da 99 onde o entregador digita o LOCALIZADOR
 * (vem no pedido) junto com o código que o cliente dá. Serve quando a conferência pelo Regem
 * falha. Só existe no pedido da 99 de entrega da loja.
 */
export function entrega99(raw: unknown): { localizador: string | null; pagina: string | null } {
  const r = rawObj(raw);
  const end = r?.receive_address ?? {};
  const localizador = String(end?.locator ?? '').trim() || null;
  const pagina = String(end?.handover_page_url ?? '').trim();
  return { localizador, pagina: /^https:\/\//i.test(pagina) ? pagina : null };
}

/**
 * A CONFERÊNCIA SEM INTERNET do código da 99 (o dono, 10/11/2026): hoje o código de entrega da 99 são os 4 ÚLTIMOS
 * NÚMEROS DO TELEFONE do cliente (visto na operação — a doc da 99 só diz "o código que o cliente informa"). Antes, sem
 * sinal, o app guardava QUALQUER código e só a 99 conferia quando o sinal voltava: com o código errado, o entregador já
 * tinha ido embora e só o atendimento finalizava. Agora o app confere no aparelho por um resumo (sha256) desses 4
 * dígitos: o que bate fica guardado e vai à 99 quando o sinal volta; o que não bate é recusado na hora. Com internet,
 * quem decide é sempre a 99 — se ela mudar a regra, o código novo ainda passa online (sem sinal, aí, o app pede para
 * tentar com sinal: o erro fica do lado seguro). Sem telefone utilizável (vazio, mascarado "000****1406", curto): null —
 * só online, como o iFood. O app do entregador já mostra o telefone do cliente da 99: o resumo não expõe nada novo.
 */
export function codigoOffline99(p: { canal?: unknown; clienteTelefone?: unknown; raw?: unknown }): { hash: string } | null {
  if (String(p.canal ?? '') !== '99food') return null;
  const end = rawObj(p.raw)?.receive_address ?? {};
  const bruto = end?.phone != null && String(end.phone).trim() ? String(end.phone) : String(p.clienteTelefone ?? '');
  if (bruto.includes('*')) return null;
  const digitos = bruto.replace(/\D/g, '');
  if (digitos.length < 8) return null;
  return { hash: createHash('sha256').update(digitos.slice(-4)).digest('hex') };
}

/**
 * Filtro SQL da fila do entregador: tira o pedido que a PLATAFORMA entrega (iFood com
 * deliveredBy=IFOOD, 99 com delivery_type=1). Constante do código, sem entrada do usuário.
 * Mesma regra de `modoEntrega` (coberto por `modo-entrega.spec.ts` contra o Postgres).
 */
export const SEM_LOGISTICA_DO_CANAL = sql`not (
  (canal = 'ifood' and upper(coalesce(raw->'delivery'->>'deliveredBy', '')) = 'IFOOD')
  or (canal = '99food' and coalesce(raw->>'delivery_type', '') = '1'))`;
