import { AppError } from './errors/app-error';

// Timeout padrão das chamadas a serviços EXTERNOS (marketplaces, WhatsApp, n8n…). O fetch do Node
// não tem timeout → sem isto uma origem pendurada trava o request/poller (o ciclo é serial).
// Normaliza timeout/rede para AppError (EXTERNAL_SERVICE_TIMEOUT / EXTERNAL_SERVICE_ERROR): quem
// faz `.catch(() => null)` continua valendo; quem propaga ganha código + mensagem segura.
// NÃO lança em HTTP não-2xx — devolve a Response (o chamador segue tratando `res.ok`).
export const FETCH_EXTERNO_TIMEOUT_MS = 10000;

export async function fetchExterno(
  url: string,
  opts: RequestInit = {},
  timeoutMs: number = FETCH_EXTERNO_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...opts, signal: opts.signal ?? AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const nome = (e as { name?: string } | null)?.name;
    if (nome === 'TimeoutError' || nome === 'AbortError') {
      throw AppError.externalTimeout('O serviço externo demorou a responder.');
    }
    throw AppError.external('Falha de rede ao falar com o serviço externo.', e);
  }
}
