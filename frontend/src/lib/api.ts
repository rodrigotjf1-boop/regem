const BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

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
  login: (email: string, senha: string) =>
    req('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, senha }),
    }),
  tarefasDoDia: (data: string) => req(`/tarefas-instancias?data=${data}`),
  escalaDoDia: (data: string) => req(`/escala?data=${data}`),
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
