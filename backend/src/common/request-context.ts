import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestStore {
  requestId: string;
  tenantId?: string;
  userId?: string;
}

// Contexto por requisição para CORRELAÇÃO de logs — independente do ALS de tenant/RLS
// (db/tenant-context.ts), que só liga com RLS_ENABLED. Preenchido pelo RequestIdMiddleware
// no começo de cada request; o TelemetriaLogger lê daqui para carimbar o requestId.
export const requestContext = new AsyncLocalStorage<RequestStore>();

export const getRequestId = (): string | undefined => requestContext.getStore()?.requestId;
export const getRequestStore = (): RequestStore | undefined => requestContext.getStore();
