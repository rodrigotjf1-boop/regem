import { io, type Socket } from 'socket.io-client';
import { getToken } from './api';

// Origem do WebSocket = base da API sem o sufixo /api/v1.
const API =
  process.env.NEXT_PUBLIC_API_URL ?? 'https://api.dmsregem.com/api/v1';
export const RT_URL = API.replace(/\/api\/v1\/?$/, '');

// Sem forçar o transporte: o socket.io negocia (long-polling → upgrade p/ WebSocket).
// Importante atrás de proxy (EasyPanel) que possa não ter upgrade de WS configurado.

// Painel/gestor (web): autentica com o JWT da sessão.
export function connectAsGestor(): Socket {
  return io(RT_URL, { auth: { jwt: getToken() } });
}

// Device (KDS / Terminal): autentica com o token do equipamento.
export function connectAsDevice(token: string): Socket {
  return io(RT_URL, { auth: { token } });
}

export type { Socket };
