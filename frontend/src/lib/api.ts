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

// Upload multipart: NÃO define Content-Type (o browser injeta o boundary).
async function uploadFile(path: string, file: File) {
  const token = getToken();
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as any);
    throw new Error(body.message || `Erro ${res.status}`);
  }
  return res.json() as Promise<{ url: string; path: string }>;
}

export const api = {
  get: (path: string) => req(path),
  upload: (file: File) => uploadFile('/midia/upload', file),
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
  escalaSemana: (inicio: string) => req(`/escala/semana?inicio=${inicio}`),
  dashboard: (data: string) => req(`/dashboard?data=${data}`),
  dashboardTimeline: (data: string) => req(`/dashboard/timeline?data=${data}`),
  setores: () => req('/setores'),
  produtos: () => req('/produtos'),
  produto: (id: string) => req(`/produtos/${id}`),
  criarProduto: (body: Record<string, unknown>) =>
    req('/produtos', { method: 'POST', body: JSON.stringify(body) }),
  atualizarProduto: (id: string, body: Record<string, unknown>) =>
    req(`/produtos/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removerProduto: (id: string) =>
    req(`/produtos/${id}`, { method: 'DELETE' }),
  produtoCategorias: () => req('/produtos/categorias'),
  criarCategoriaProduto: (body: Record<string, unknown>) =>
    req('/produtos/categorias', { method: 'POST', body: JSON.stringify(body) }),
  fichasLista: () => req('/fichas'),
  vendaBalcao: (body: Record<string, unknown>) =>
    req('/vendas/balcao', { method: 'POST', body: JSON.stringify(body) }),
  janelasPico: (unidadeId?: string) =>
    req(`/janelas-pico${unidadeId ? `?unidadeId=${unidadeId}` : ''}`),
  fornecedores: () => req('/fornecedores'),
  fornecedorPendencias: () => req('/fornecedores/pendencias'),
  marcarPonto: (body: Record<string, unknown>) =>
    req('/ponto/marcar', { method: 'POST', body: JSON.stringify(body) }),
  pontoDia: (data?: string, colaboradorId?: string) => {
    const p = new URLSearchParams();
    if (data) p.set('data', data);
    if (colaboradorId) p.set('colaboradorId', colaboradorId);
    const q = p.toString();
    return req(`/ponto/dia${q ? `?${q}` : ''}`);
  },
  pontoEspelho: (colaboradorId: string, inicio: string, fim: string) =>
    req(
      `/ponto/espelho?colaboradorId=${colaboradorId}&inicio=${inicio}&fim=${fim}`,
    ),
  pontoPessoas: (data?: string) =>
    req(`/ponto/pessoas${data ? `?data=${data}` : ''}`),
  incluirMarcacaoPonto: (body: Record<string, unknown>) =>
    req('/ponto/marcacao-manual', { method: 'POST', body: JSON.stringify(body) }),
  criarAjustePonto: (body: Record<string, unknown>) =>
    req('/ponto/ajuste', { method: 'POST', body: JSON.stringify(body) }),
  financeiroTitulos: (tipo?: string, status?: string) => {
    const p = new URLSearchParams();
    if (tipo) p.set('tipo', tipo);
    if (status) p.set('status', status);
    const q = p.toString();
    return req(`/financeiro/titulos${q ? `?${q}` : ''}`);
  },
  financeiroResumo: () => req('/financeiro/resumo'),
  financeiroFluxo: (dias?: number) =>
    req(`/financeiro/fluxo${dias ? `?dias=${dias}` : ''}`),
  financeiroDre: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/financeiro/dre${q ? `?${q}` : ''}`);
  },
  criarTitulo: (body: Record<string, unknown>) =>
    req('/financeiro/titulos', { method: 'POST', body: JSON.stringify(body) }),
  pagarTitulo: (id: string, body: Record<string, unknown>) =>
    req(`/financeiro/titulos/${id}/pagar`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  estornarTitulo: (id: string) =>
    req(`/financeiro/titulos/${id}/estornar`, { method: 'POST' }),
  estoqueInteligencia: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/estoque/inteligencia${q ? `?${q}` : ''}`);
  },
  equipamentos: () => req('/equipamento'),
  criarEquipamento: (body: Record<string, unknown>) =>
    req('/equipamento', { method: 'POST', body: JSON.stringify(body) }),
  revogarEquipamento: (id: string) =>
    req(`/equipamento/${id}/revogar`, { method: 'PATCH' }),
  recebimentos: () => req('/recebimentos'),
  recebimento: (id: string) => req(`/recebimentos/${id}`),
  criarRecebimento: (body: Record<string, unknown>) =>
    req('/recebimentos', { method: 'POST', body: JSON.stringify(body) }),
  confirmarRecebimento: (id: string) =>
    req(`/recebimentos/${id}/confirmar`, { method: 'POST' }),
  lotes: () => req('/lotes'),
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
