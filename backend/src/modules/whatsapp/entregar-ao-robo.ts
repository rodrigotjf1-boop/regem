import { Logger } from '@nestjs/common';
import { CABECALHO_ASSINATURA_REGEM, assinarParaORobo } from '../../common/segredo-robo';

/* eslint-disable @typescript-eslint/no-explicit-any */

const log = new Logger('RoboEntrega');

/**
 * Para onde vai a mensagem do cliente, já com as travas aplicadas. Um fluxo só no n8n para as duas vias
 * (`N8N_ROBO_WEBHOOK_URL`, Fase 3 do robô); a API oficial cai no endereço antigo (`N8N_BOT_CLOUD_WEBHOOK_URL`) enquanto
 * o fluxo novo não existir. A Evolution só passa pelo Regem com `EVOLUTION_PELO_REGEM` — aí exige o endereço novo.
 */
export function enderecoDoRobo(provedor: 'cloud' | 'evolution'): string {
  const novo = (process.env.N8N_ROBO_WEBHOOK_URL ?? '').trim();
  if (novo) return novo;
  return provedor === 'cloud' ? (process.env.N8N_BOT_CLOUD_WEBHOOK_URL ?? '').trim() : '';
}

/**
 * Entrega a mensagem normalizada ao robô (n8n), ASSINADA (`x-regem-assinatura: sha256=<hmac do corpo>` com a senha do
 * robô — o fluxo confere e recusa o que não veio do Regem), com 10 s de limite. Nunca lança: o webhook da Meta/Evolution
 * tem de receber 200. Devolve se entregou (para o teste e o log).
 */
export async function entregarAoRobo(msg: any, buscar: typeof fetch = fetch): Promise<boolean> {
  const url = enderecoDoRobo(msg?.provedor === 'evolution' ? 'evolution' : 'cloud');
  if (!url) {
    log.debug(`sem endereço do robô (${msg?.provedor}) — mensagem não entregue.`);
    return false;
  }
  const corpo = JSON.stringify(msg);
  try {
    const res = await buscar(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [CABECALHO_ASSINATURA_REGEM]: assinarParaORobo(corpo) },
      body: corpo,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.warn(`o robô (n8n) respondeu ${res.status} ao receber a mensagem (${msg?.provedor}).`);
      return false;
    }
    return true;
  } catch (e: any) {
    log.warn(`falha ao entregar ao robô (n8n): ${e?.cause?.code ?? e?.name ?? e?.message ?? e}`);
    return false;
  }
}
