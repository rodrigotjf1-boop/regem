const BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'https://api.dmsregem.com/api/v1';

const TOKEN_KEY = 'regen_token';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Lê a categoria da hierarquia do payload do JWT (para gates de UI).
export function getCategoria(): string | null {
  const t = getToken();
  if (!t) return null;
  try {
    const payload = JSON.parse(atob(t.split('.')[1] ?? ''));
    return payload.cat ?? null;
  } catch {
    return null;
  }
}

async function req(path: string, options: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as any);
    throw new Error(body.message || `Erro ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  get: (path: string) => req(path),
  post: (path: string, body: Record<string, unknown>) =>
    req(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path: string, body: Record<string, unknown>) =>
    req(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: (path: string) => req(path, { method: 'DELETE' }),
  login: (email: string, senha: string) =>
    req('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, senha }),
    }),
  pinLogin: (unidadeId: string, pin: string) =>
    req('/auth/pin', {
      method: 'POST',
      body: JSON.stringify({ unidadeId, pin }),
    }),
  register: (body: {
    empresaNome: string;
    nome: string;
    email: string;
    senha: string;
  }) => req('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  tarefasDoDia: (data: string) => req(`/tarefas-instancias?data=${data}`),
  escalaDoDia: (data: string) => req(`/escala?data=${data}`),
  dashboard: (data: string) => req(`/dashboard?data=${data}`),
  etiquetas: () => req('/etiquetas'),
  turnos: () => req('/turnos'),
  colaboradores: () => req('/colaboradores'),
  unidades: () => req('/unidades'),
  criarAlocacao: (body: Record<string, unknown>) =>
    req('/escala', { method: 'POST', body: JSON.stringify(body) }),
  criarTarefaDef: (body: Record<string, unknown>) =>
    req('/tarefas', { method: 'POST', body: JSON.stringify(body) }),
  instanciarTarefa: (body: Record<string, unknown>) =>
    req('/tarefas-instancias/instanciar', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  concluirTarefa: (id: string, estado: string, motivo?: string) =>
    req(`/tarefas-instancias/${id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado, motivo }),
    }),
};
