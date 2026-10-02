import { AppError } from './errors/app-error';
import { anotarFalha, anotarResposta, observando } from './chamadas-externas';

// Timeout padrão das chamadas a serviços EXTERNOS (marketplaces, WhatsApp, n8n…). O fetch do Node
// não tem timeout → sem isto uma origem pendurada trava o request/poller (o ciclo é serial).
// Normaliza timeout/rede para AppError (EXTERNAL_SERVICE_TIMEOUT / EXTERNAL_SERVICE_ERROR): quem
// faz `.catch(() => null)` continua valendo; quem propaga ganha código + mensagem segura.
// NÃO lança em HTTP não-2xx — devolve a Response (o chamador segue tratando `res.ok`).
//
// Com uma observação aberta (`observarChamadasExternas`, usada para registrar o envio do status
// do pedido ao canal), a chamada é ANOTADA — a chamada em si é a mesma, e fora de uma observação
// nada muda.
export const FETCH_EXTERNO_TIMEOUT_MS = 10000;

export async function fetchExterno(
  url: string,
  opts: RequestInit = {},
  timeoutMs: number = FETCH_EXTERNO_TIMEOUT_MS,
): Promise<Response> {
  const anotar = observando();
  const inicio = anotar ? Date.now() : 0;
  try {
    const res = await fetch(url, { ...opts, signal: opts.signal ?? AbortSignal.timeout(timeoutMs) });
    if (anotar) anotarResposta(opts.method, url, res, Date.now() - inicio);
    return res;
  } catch (e) {
    const nome = (e as { name?: string } | null)?.name;
    const esgotou = nome === 'TimeoutError' || nome === 'AbortError';
    if (anotar) anotarFalha(opts.method, url, esgotou ? 'timeout' : 'rede', Date.now() - inicio);
    if (esgotou) {
      throw AppError.externalTimeout('O serviço externo demorou a responder.');
    }
    throw AppError.external('Falha de rede ao falar com o serviço externo.', e);
  }
}
