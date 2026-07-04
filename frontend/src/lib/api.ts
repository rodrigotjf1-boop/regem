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

// Sessão expirada/inválida: limpa o token e manda pro login com aviso amigável.
function sessaoExpirou() {
  clearToken();
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/entrar')) {
    window.location.href = '/entrar?expirada=1';
  }
}

async function req(path: string, options: RequestInit = {}) {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    // Erro de REDE (offline, DNS, CORS) — distinto de erro de API.
    throw new Error('Sem conexão com o servidor. Verifique a internet.');
  }
  if (res.status === 401) {
    sessaoExpirou();
    throw new Error('Sessão expirada. Entre novamente.');
  }
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
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: form,
    });
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique a internet.');
  }
  if (res.status === 401) {
    sessaoExpirou();
    throw new Error('Sessão expirada. Entre novamente.');
  }
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
  ficha: (id: string) => req(`/fichas/${id}`),
  estoqueItens: () => req('/estoque/itens'),
  vendaBalcao: (body: Record<string, unknown>) =>
    req('/vendas/balcao', { method: 'POST', body: JSON.stringify(body) }),
  produtoComplementos: (produtoId: string) =>
    req(`/produtos/${produtoId}/complementos`),
  criarGrupoComplemento: (produtoId: string, body: Record<string, unknown>) =>
    req(`/produtos/${produtoId}/complementos/grupos`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  criarOpcaoComplemento: (grupoId: string, body: Record<string, unknown>) =>
    req(`/produtos/complementos/grupos/${grupoId}/opcoes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removerGrupoComplemento: (grupoId: string) =>
    req(`/produtos/complementos/grupos/${grupoId}`, { method: 'DELETE' }),
  removerOpcaoComplemento: (opcaoId: string) =>
    req(`/produtos/complementos/opcoes/${opcaoId}`, { method: 'DELETE' }),
  vendasConfig: () => req('/vendas/config'),
  setCancelamentoLivre: (ativo: boolean) =>
    req('/vendas/config/cancelamento-livre', {
      method: 'POST',
      body: JSON.stringify({ ativo }),
    }),
  vendasCupons: () => req('/vendas/cupons'),
  vendasCupom: (id: string) => req(`/vendas/cupons/${id}`),
  cancelarVenda: (id: string, body: Record<string, unknown>) =>
    req(`/vendas/comandas/${id}/cancelar`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  comandas: () => req('/vendas/comandas'),
  comanda: (id: string) => req(`/vendas/comandas/${id}`),
  abrirComanda: (body: Record<string, unknown>) =>
    req('/vendas/comandas', { method: 'POST', body: JSON.stringify(body) }),
  addComandaItem: (id: string, body: Record<string, unknown>) =>
    req(`/vendas/comandas/${id}/itens`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removerComandaItem: (itemId: string) =>
    req(`/vendas/comandas/itens/${itemId}`, { method: 'DELETE' }),
  fecharComanda: (id: string, body: Record<string, unknown>) =>
    req(`/vendas/comandas/${id}/fechar`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
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
  caixaAberta: () => req('/financeiro/caixa'),
  abrirCaixa: (body: Record<string, unknown>) =>
    req('/financeiro/caixa/abrir', { method: 'POST', body: JSON.stringify(body) }),
  movimentarCaixa: (body: Record<string, unknown>) =>
    req('/financeiro/caixa/movimentar', { method: 'POST', body: JSON.stringify(body) }),
  fecharCaixa: (body: Record<string, unknown>) =>
    req('/financeiro/caixa/fechar', { method: 'POST', body: JSON.stringify(body) }),
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
  estoqueValidades: () => req('/estoque/validades'),
  estoqueCmv: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/estoque/cmv${q ? `?${q}` : ''}`);
  },
  gerarSnapshotEstoque: () =>
    req('/estoque/snapshot', { method: 'POST', body: '{}' }),
  estoqueAlertas: () => req('/estoque/alertas'),
  resolverAlertaEstoque: (id: string) =>
    req(`/estoque/alertas/${id}/resolver`, { method: 'POST', body: '{}' }),
  muralFeed: () => req('/mural'),
  publicarComunicado: (body: Record<string, unknown>) =>
    req('/mural', { method: 'POST', body: JSON.stringify(body) }),
  confirmarLeituraMural: (id: string) =>
    req(`/mural/${id}/leitura`, { method: 'POST', body: '{}' }),
  climaAtual: () => req('/mural/clima'),
  criarPesquisaClima: (body: Record<string, unknown>) =>
    req('/mural/clima', { method: 'POST', body: JSON.stringify(body) }),
  responderClima: (id: string, body: Record<string, unknown>) =>
    req(`/mural/clima/${id}/responder`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  botRegras: () => req('/bot/regras'),
  botMetricas: () => req('/bot/metricas'),
  criarBotRegra: (body: Record<string, unknown>) =>
    req('/bot/regras', { method: 'POST', body: JSON.stringify(body) }),
  atualizarBotRegra: (id: string, body: Record<string, unknown>) =>
    req(`/bot/regras/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removerBotRegra: (id: string) =>
    req(`/bot/regras/${id}`, { method: 'DELETE' }),
  botPerguntar: (pergunta: string) =>
    req('/bot/perguntar', { method: 'POST', body: JSON.stringify({ pergunta }) }),
  onboardingRamosDetalhes: () => req('/onboarding/ramos-detalhes'),
  onboardingBlueprint: (ramo: string) =>
    req(`/onboarding/blueprint?ramo=${encodeURIComponent(ramo)}`),
  aplicarWizard: (body: Record<string, unknown>) =>
    req('/onboarding/wizard', { method: 'POST', body: JSON.stringify(body) }),
  getPrefs: () => req('/colaborador/me/prefs'),
  patchPrefs: (body: Record<string, unknown>) =>
    req('/colaborador/me/prefs', { method: 'PATCH', body: JSON.stringify(body) }),
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
