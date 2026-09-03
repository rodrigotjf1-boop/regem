// Erro classificado de gateway de pagamento. `ambiguo` = a cobrança PODE ter sido criada
// (timeout / erro de rede / 5xx) — nesse caso NÃO se deve recriar em outro gateway (geraria 2ª
// PIX). Só falha DEFINITIVA (4xx do provedor: token/config/validação → nada foi criado) é segura
// para cair no gateway seguinte. Estende Error → quem só faz `catch (e)` continua valendo.
export class GatewayError extends Error {
  readonly status?: number;
  readonly ambiguo: boolean;
  constructor(message: string, opts: { status?: number; ambiguo: boolean; cause?: unknown }) {
    super(message);
    this.name = 'GatewayError';
    this.status = opts.status;
    this.ambiguo = opts.ambiguo;
    // `cause` como propriedade (o Error nativo desta lib TS não aceita o 2º arg de options).
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

// Classifica uma falha de chamada financeira. Com status HTTP: 5xx/408/429 = ambíguo (pode ter
// criado); demais 4xx = definitivo. Sem status (fetch lançou = rede/timeout/abort) = ambíguo.
export function classificarFalhaGateway(e: unknown, status?: number): GatewayError {
  const msg = e instanceof Error ? e.message : String(e ?? 'falha no gateway');
  if (status != null) {
    const ambiguo = status >= 500 || status === 408 || status === 429;
    return new GatewayError(msg, { status, ambiguo, cause: e });
  }
  return new GatewayError(msg || 'falha de rede no gateway', { ambiguo: true, cause: e });
}

// Timeouts das chamadas financeiras (Node fetch não tem timeout por padrão → chamada pendurada
// travava request/poller). Criação é mais lenta que consulta.
export const FIN_TIMEOUT_CRIAR_MS = 15000;
export const FIN_TIMEOUT_CONSULTA_MS = 8000;
