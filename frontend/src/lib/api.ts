// Base da API. Nuvem: NEXT_PUBLIC_API_URL (fixado no build). Edge
// (NEXT_PUBLIC_EDGE=1): cada loja tem IP proprio, entao a API fica no MESMO host
// que serviu o app (o que o cliente digitou: localhost / IP / regem.local), na
// porta do edge (default 3002). Resolve em runtime, no navegador.
function apiBase(): string {
  if (process.env.NEXT_PUBLIC_EDGE === '1' && typeof window !== 'undefined') {
    const porta = process.env.NEXT_PUBLIC_EDGE_API_PORT || '3002';
    return `${window.location.protocol}//${window.location.hostname}:${porta}/api/v1`;
  }
  return process.env.NEXT_PUBLIC_API_URL || 'https://api.dmsregem.com/api/v1';
}

// Ping leve do servidor (status online/offline nos apps clientes). Público, sem
// auth e sem redirecionar — só diz se o servidor respondeu.
export async function pingServidor(): Promise<boolean> {
  try {
    const r = await fetch(`${apiBase()}/ping`, { cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}

const TOKEN_KEY = 'regen_token';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}
// persist=true (padrão): localStorage (sobrevive a fechar o navegador).
// persist=false: sessionStorage (cai ao fechar a aba) — "Manter conectado" off.
export function setToken(t: string, persist = true) {
  if (persist) {
    localStorage.setItem(TOKEN_KEY, t);
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, t);
    localStorage.removeItem(TOKEN_KEY);
  }
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

// Unidade selecionada no seletor global (preferência de visão, não dado de negócio).
// null / 'todas' = ver a rede inteira. O servidor reconfere o RBAC (execução é travada
// na própria unidade e ignora isto). Notifica a UI via evento para o dropdown reagir.
const UNIDADE_KEY = 'regen_unidade_atual';
export function getUnidadeAtual(): string | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(UNIDADE_KEY);
  return v && v !== 'todas' ? v : null;
}
export function setUnidadeAtual(id: string | null) {
  if (typeof window === 'undefined') return;
  if (id) localStorage.setItem(UNIDADE_KEY, id);
  else localStorage.removeItem(UNIDADE_KEY);
  window.dispatchEvent(new Event('regem:unidade'));
}

// Terminal de PDV pareado NESTE PC (identidade da máquina, não dado de negócio).
// Guarda { id, nome } no localStorage; o `req()` envia o id no header X-Terminal-Id.
const TERMINAL_KEY = 'regem_terminal';
function lerTerminal(): { id: string; nome: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(TERMINAL_KEY) || 'null');
  } catch {
    return null;
  }
}
export function getTerminalAtual(): string | null {
  return lerTerminal()?.id ?? null;
}
export function getTerminalNome(): string | null {
  return lerTerminal()?.nome ?? null;
}
export function setTerminalAtual(id: string, nome: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TERMINAL_KEY, JSON.stringify({ id, nome }));
  window.dispatchEvent(new Event('regem:terminal'));
}
export function clearTerminal() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TERMINAL_KEY);
  window.dispatchEvent(new Event('regem:terminal'));
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

/* eslint-disable @typescript-eslint/no-explicit-any */
// Permissões do perfil de acesso (claim `perm` do JWT). Gates de UI apenas — a
// trava real é no servidor. Ausente (token antigo) = objeto vazio.
export function getPermissoes(): any {
  const t = getToken();
  if (!t) return {};
  try {
    const payload = JSON.parse(atob(t.split('.')[1] ?? ''));
    return payload.perm ?? {};
  } catch {
    return {};
  }
}

// Atalho: o perfil pode ver valores financeiros (R$)?
export function podeVerFinanceiro(): boolean {
  return !!getPermissoes()?.ver_financeiro;
}

// Unidade FIXA do usuário (claim `uni` do JWT): execução/gerente de loja ficam
// travados nela e não veem o seletor. Presidente/C&O = null (escolhe a unidade).
export function getUnidadeFixa(): string | null {
  const t = getToken();
  if (!t) return null;
  try {
    return JSON.parse(atob(t.split('.')[1] ?? '')).uni ?? null;
  } catch {
    return null;
  }
}

// Atalho: permissão de ação por módulo (ex.: podePerm('estoque','criar')).
export function podePerm(modulo: string, acao?: string): boolean {
  const p = getPermissoes()?.[modulo];
  if (acao) return !!p?.[acao];
  return !!p;
}

// Rota inicial por perfil: só presidente/gerente têm dashboard (RBAC do
// backend); os demais caem no Meu Dia (acessível a todos os autenticados).
export function rotaInicial(cat?: string | null): string {
  return cat === 'presidente' || cat === 'gerente' ? '/painel' : '/meu-dia';
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
    res = await fetch(`${apiBase()}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(getUnidadeAtual() ? { 'X-Unidade-Id': getUnidadeAtual() as string } : {}),
        ...(getTerminalAtual() ? { 'X-Terminal-Id': getTerminalAtual() as string } : {}),
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

// Chamada PÚBLICA (sem login, sem redirecionar em 401) — cardápio por QR.
async function pub(path: string, options: RequestInit = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as any);
    throw new Error(body.message || `Erro ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// ===== Console da DISTRIBUIÇÃO (realm de auth SEPARADO das lojas) =====
const DIST_TOKEN_KEY = 'regem_dist_token';
export function getDistToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(DIST_TOKEN_KEY);
}
export function setDistToken(t: string) {
  if (typeof window !== 'undefined') localStorage.setItem(DIST_TOKEN_KEY, t);
}
export function clearDistToken() {
  if (typeof window !== 'undefined') localStorage.removeItem(DIST_TOKEN_KEY);
}
export function getDistPerfil(): string | null {
  const t = getDistToken();
  if (!t) return null;
  try {
    return JSON.parse(atob(t.split('.')[1] ?? '')).perfil ?? null;
  } catch {
    return null;
  }
}
async function distReq(path: string, options: RequestInit = {}) {
  const token = getDistToken();
  const res = await fetch(`${apiBase()}${path}`, {
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
export const distApi = {
  login: (email: string, senha: string) =>
    distReq('/distribuicao/login', { method: 'POST', body: JSON.stringify({ email, senha }) }),
  me: () => distReq('/distribuicao/me'),
  usuarios: () => distReq('/distribuicao/usuarios'),
  criarUsuario: (dto: any) =>
    distReq('/distribuicao/usuarios', { method: 'POST', body: JSON.stringify(dto) }),
  auditoria: () => distReq('/distribuicao/auditoria'),
  frota: () => distReq('/distribuicao/frota'),
  telemetria: () => distReq('/distribuicao/telemetria'),
  resolverTelemetria: (id: string) =>
    distReq(`/distribuicao/telemetria/${id}/resolver`, { method: 'POST', body: '{}' }),
  licencas: () => distReq('/distribuicao/licencas'),
  revogarLicenca: (tenantId: string) =>
    distReq(`/distribuicao/licencas/${tenantId}/revogar`, { method: 'POST', body: '{}' }),
  liberarLicenca: (tenantId: string, dias = 30) =>
    distReq(`/distribuicao/licencas/${tenantId}/liberar`, { method: 'POST', body: JSON.stringify({ dias }) }),
  mudarPlano: (tenantId: string, plano: string) =>
    distReq(`/distribuicao/licencas/${tenantId}/plano`, { method: 'POST', body: JSON.stringify({ plano }) }),
  rollbackRemoto: (tenantId: string) =>
    distReq(`/distribuicao/licencas/${tenantId}/rollback`, { method: 'POST', body: '{}' }),
  releases: () => distReq('/distribuicao/releases'),
  publicarRelease: (dto: any) =>
    distReq('/distribuicao/releases', { method: 'POST', body: JSON.stringify(dto) }),
};

// Upload multipart: NÃO define Content-Type (o browser injeta o boundary).
async function uploadFile(path: string, file: File) {
  const token = getToken();
  const form = new FormData();
  form.append('file', file);
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
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
  escalaPeriodo: (de: string, ate: string) =>
    req(`/escala/periodo?de=${de}&ate=${ate}`),
  contagemListas: () => req('/contagem/listas'),
  criarContagemLista: (body: Record<string, unknown>) =>
    req('/contagem/listas', { method: 'POST', body: JSON.stringify(body) }),
  removerContagemLista: (id: string) =>
    req(`/contagem/listas/${id}`, { method: 'DELETE' }),
  iniciarContagem: (listaId: string) =>
    req(`/contagem/listas/${listaId}/iniciar`, { method: 'POST', body: '{}' }),
  salvarContagem: (execId: string, body: Record<string, unknown>) =>
    req(`/contagem/execucoes/${execId}/salvar`, { method: 'POST', body: JSON.stringify(body) }),
  comprasListas: () => req('/compras/listas'),
  comprasSugestao: () => req('/compras/sugestao'),
  criarCompraLista: (body: Record<string, unknown>) =>
    req('/compras/listas', { method: 'POST', body: JSON.stringify(body) }),
  removerCompraLista: (id: string) =>
    req(`/compras/listas/${id}`, { method: 'DELETE' }),
  receberCompra: (id: string) =>
    req(`/compras/listas/${id}/receber`, { method: 'POST', body: '{}' }),
  diasEspeciais: (de?: string, ate?: string) => {
    const p = new URLSearchParams();
    if (de) p.set('de', de);
    if (ate) p.set('ate', ate);
    const q = p.toString();
    return req(`/dias-especiais${q ? `?${q}` : ''}`);
  },
  criarDiaEspecial: (body: Record<string, unknown>) =>
    req('/dias-especiais', { method: 'POST', body: JSON.stringify(body) }),
  removerDiaEspecial: (id: string) =>
    req(`/dias-especiais/${id}`, { method: 'DELETE' }),
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
  atualizarCategoriaProduto: (id: string, body: Record<string, unknown>) =>
    req(`/produtos/categorias/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  excluirCategoriaProduto: (id: string) =>
    req(`/produtos/categorias/${id}`, { method: 'DELETE' }),
  reordenarCategoriasProduto: (ids: string[]) =>
    req('/produtos/categorias/reordenar', { method: 'POST', body: JSON.stringify({ ids }) }),
  // Opções reutilizáveis do catálogo (Fase 2)
  opcoesCatalogo: () => req('/produtos/opcoes'),
  criarOpcaoCatalogo: (body: Record<string, unknown>) =>
    req('/produtos/opcoes', { method: 'POST', body: JSON.stringify(body) }),
  atualizarOpcaoCatalogo: (id: string, body: Record<string, unknown>) =>
    req(`/produtos/opcoes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  excluirOpcaoCatalogo: (id: string) =>
    req(`/produtos/opcoes/${id}`, { method: 'DELETE' }),
  // Complementos reutilizáveis do catálogo (Fase 3)
  complementosCatalogo: () => req('/produtos/complementos-catalogo'),
  criarComplementoCatalogo: (body: Record<string, unknown>) =>
    req('/produtos/complementos-catalogo', { method: 'POST', body: JSON.stringify(body) }),
  atualizarComplementoCatalogo: (id: string, body: Record<string, unknown>) =>
    req(`/produtos/complementos-catalogo/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  excluirComplementoCatalogo: (id: string) =>
    req(`/produtos/complementos-catalogo/${id}`, { method: 'DELETE' }),
  // Produto ↔ complementos reutilizáveis (Fase 4 — materializa no motor)
  // Ordem de produção (mig 130).
  ordensProducao: (q = '') => req('/ordens-producao' + (q ? `?${q}` : '')),
  criarOrdemProducao: (body: Record<string, unknown>) =>
    req('/ordens-producao', { method: 'POST', body: JSON.stringify(body) }),
  liberarOrdem: (id: string) => req(`/ordens-producao/${id}/liberar`, { method: 'POST', body: '{}' }),
  iniciarOrdem: (id: string) => req(`/ordens-producao/${id}/iniciar`, { method: 'POST', body: '{}' }),
  concluirOrdem: (id: string, body: Record<string, unknown>) =>
    req(`/ordens-producao/${id}/concluir`, { method: 'POST', body: JSON.stringify(body) }),
  cancelarOrdem: (id: string, motivo?: string) =>
    req(`/ordens-producao/${id}/cancelar`, { method: 'POST', body: JSON.stringify({ motivo }) }),
  ordemRecorrencia: (body: Record<string, unknown>) =>
    req('/ordens-producao/recorrencia', { method: 'POST', body: JSON.stringify(body) }),
  ordensRelatorio: (de: string, ate: string) =>
    req(`/ordens-producao/relatorio?de=${de}&ate=${ate}`),
  // Direcionamento do catálogo em massa (produto → KDS/impressora).
  direcionamento: () => req('/produtos/direcionamento'),
  setDirecionamento: (produtoIds: string[], equipamentoIds: string[], modo: 'substituir' | 'adicionar') =>
    req('/produtos/direcionamento', {
      method: 'PUT',
      body: JSON.stringify({ produtoIds, equipamentoIds, modo }),
    }),
  // KDS: impressão guiada por etapa (mig 129).
  setImpressaoEtapa: (id: string, body: { imprimeAoAvancar: boolean; imprimeNoStatus: string; impressoraDestinoId: string | null }) =>
    req(`/equipamento/${id}/impressao-etapa`, { method: 'PATCH', body: JSON.stringify(body) }),
  // Destinos próprios (KDS/impressora) de opção e etapa — mig 127. Vazio = herda do produto.
  opcaoDestinos: (id: string) => req(`/produtos/opcoes/${id}/destinos`),
  setOpcaoDestinos: (id: string, equipamentoIds: string[]) =>
    req(`/produtos/opcoes/${id}/destinos`, { method: 'PUT', body: JSON.stringify({ equipamentoIds }) }),
  complementoDestinos: (id: string) => req(`/produtos/complementos-catalogo/${id}/destinos`),
  setComplementoDestinos: (id: string, equipamentoIds: string[]) =>
    req(`/produtos/complementos-catalogo/${id}/destinos`, {
      method: 'PUT',
      body: JSON.stringify({ equipamentoIds }),
    }),
  produtoEtapas: (id: string) => req(`/produtos/${id}/complementos-catalogo`),
  setProdutoEtapas: (id: string, ids: string[]) =>
    req(`/produtos/${id}/complementos-catalogo`, { method: 'PUT', body: JSON.stringify({ ids }) }),
  fichasLista: () => req('/fichas'),
  ficha: (id: string) => req(`/fichas/${id}`),
  // Fiscal (Fase G)
  fiscalConfig: (unidadeId?: string) =>
    req(`/fiscal/config${unidadeId ? `?unidadeId=${unidadeId}` : ''}`),
  setFiscalConfig: (body: Record<string, unknown>) =>
    req('/fiscal/config', { method: 'PUT', body: JSON.stringify(body) }),
  emitirNfce: (comandaId: string) =>
    req(`/fiscal/comandas/${comandaId}/emitir`, { method: 'POST', body: '{}' }),
  notasFiscais: () => req('/fiscal/notas'),
  notaFiscal: (id: string) => req(`/fiscal/notas/${id}`),
  cancelarNota: (id: string, justificativa: string) =>
    req(`/fiscal/notas/${id}/cancelar`, {
      method: 'POST',
      body: JSON.stringify({ justificativa }),
    }),
  estoqueItens: () => req('/estoque/itens'),
  atualizarItem: (id: string, body: Record<string, unknown>) =>
    req(`/estoque/itens/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  estoqueCategorias: () => req('/estoque/categorias-item'),
  criarEstoqueCategoria: (body: Record<string, unknown>) =>
    req('/estoque/categorias-item', { method: 'POST', body: JSON.stringify(body) }),
  removerEstoqueCategoria: (id: string) =>
    req(`/estoque/categorias-item/${id}`, { method: 'DELETE' }),
  // Produção (Fase F1)
  producaoFila: (setorId?: string, unidadeId?: string, canal?: string) => {
    const p = new URLSearchParams();
    if (setorId) p.set('setorId', setorId);
    if (unidadeId) p.set('unidadeId', unidadeId);
    if (canal) p.set('canal', canal);
    const q = p.toString();
    return req(`/producao/fila${q ? `?${q}` : ''}`);
  },
  producaoAvancar: (id: string, escopo?: string) =>
    req(`/producao/pedidos/${id}/avancar`, {
      method: 'POST',
      body: JSON.stringify({ escopo }),
    }),
  senhaConfig: (unidadeId?: string) =>
    req(`/producao/senha/config${unidadeId ? `?unidadeId=${unidadeId}` : ''}`),
  setSenhaPeriodo: (periodo: string, unidadeId?: string) =>
    req('/producao/senha/config', {
      method: 'PUT',
      body: JSON.stringify({ periodo, unidadeId }),
    }),
  producaoPedidos: (unidadeId?: string) =>
    req(`/producao/pedidos${unidadeId ? `?unidadeId=${unidadeId}` : ''}`),
  cancelarPedidoProducao: (id: string, motivo?: string) =>
    req(`/producao/pedidos/${id}/cancelar`, {
      method: 'POST',
      body: JSON.stringify({ motivo }),
    }),
  destinosProduto: (id: string) => req(`/producao/produtos/${id}/destinos`),
  setDestinosProduto: (id: string, equipamentoIds: string[]) =>
    req(`/producao/produtos/${id}/destinos`, {
      method: 'PUT',
      body: JSON.stringify({ equipamentoIds }),
    }),
  destinosSetor: (id: string) => req(`/producao/setores/${id}/destinos`),
  setDestinosSetor: (id: string, equipamentoIds: string[]) =>
    req(`/producao/setores/${id}/destinos`, {
      method: 'PUT',
      body: JSON.stringify({ equipamentoIds }),
    }),
  kdsCores: (unidadeId?: string) =>
    req(`/producao/cores${unidadeId ? `?unidadeId=${unidadeId}` : ''}`),
  setKdsCores: (body: Record<string, unknown>) =>
    req('/producao/cores', { method: 'PUT', body: JSON.stringify(body) }),
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
  produtoFaixas: (id: string) => req(`/produtos/${id}/faixas`),
  setProdutoFaixas: (id: string, faixas: unknown[]) =>
    req(`/produtos/${id}/faixas`, { method: 'PUT', body: JSON.stringify({ faixas }) }),
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
  buscarCupomSenha: (senha: string | number) =>
    req(`/vendas/cupons/busca?senha=${encodeURIComponent(String(senha))}`),
  reimprimirCupom: (id: string) =>
    req(`/vendas/cupons/${id}/reimprimir`, { method: 'POST', body: '{}' }),
  cancelarVenda: (id: string, body: Record<string, unknown>) =>
    req(`/vendas/comandas/${id}/cancelar`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  // Mesas (Fase F2)
  mesas: (unidadeId?: string) =>
    req(`/vendas/mesas${unidadeId ? `?unidadeId=${unidadeId}` : ''}`),
  abrirMesa: (body: Record<string, unknown>) =>
    req('/vendas/mesas', { method: 'POST', body: JSON.stringify(body) }),
  mesa: (id: string) => req(`/vendas/mesas/${id}`),
  abrirComandaNaMesa: (id: string, body: Record<string, unknown>) =>
    req(`/vendas/mesas/${id}/comandas`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  fecharMesa: (id: string, body: Record<string, unknown>) =>
    req(`/vendas/mesas/${id}/fechar`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  // Delivery (Fase H)
  deliveryPedidos: () => req('/delivery/pedidos'),
  aceitarDelivery: (id: string) =>
    req(`/delivery/pedidos/${id}/aceitar`, { method: 'POST', body: '{}' }),
  avancarDelivery: (id: string, body?: Record<string, unknown>) =>
    req(`/delivery/pedidos/${id}/avancar`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),
  // `reaproveitado` (mig 128): insumo já baixado voltou ao estoque (true) ou virou perda (false).
  cancelarDelivery: (id: string, motivo?: string, senha?: string, reaproveitado?: boolean) =>
    req(`/delivery/pedidos/${id}/cancelar`, {
      method: 'POST',
      body: JSON.stringify({ motivo, senha, reaproveitado }),
    }),
  retornarDelivery: (id: string) =>
    req(`/delivery/pedidos/${id}/retornar`, { method: 'POST', body: '{}' }),
  alterarDelivery: (id: string, body: Record<string, unknown>) =>
    req(`/delivery/pedidos/${id}/alterar`, { method: 'POST', body: JSON.stringify(body) }),
  reimprimirDelivery: (id: string) =>
    req(`/delivery/pedidos/${id}/reimprimir`, { method: 'POST', body: '{}' }),
  itensDelivery: (id: string) => req(`/delivery/pedidos/${id}/itens`),
  entregadoresDelivery: () => req('/delivery/entregadores'),
  bairrosDelivery: () => req('/delivery/bairros'),
  deliveryMapaCalor: (dias: number) => req(`/delivery/mapa-calor?dias=${dias}`),
  // Atualização do servidor local (só no edge; gestão)
  edgeAtualizacaoStatus: () => req('/edge/atualizacao/status'),
  edgeVerificarAtualizacao: () => req('/edge/atualizacao/verificar', { method: 'POST', body: '{}' }),
  edgeAplicarAtualizacao: () => req('/edge/atualizacao/aplicar', { method: 'POST', body: '{}' }),
  edgeReverterAtualizacao: () => req('/edge/atualizacao/reverter', { method: 'POST', body: '{}' }),
  edgeInstalador: () => req('/edge/instalador'),
  edgeRestaurarStatus: () => req('/edge/restaurar/status'),
  edgeRestaurar: () => req('/edge/restaurar', { method: 'POST', body: '{}' }),
  atendimentos: () => req('/atendimento'),
  resolverAtendimento: (id: string) =>
    req(`/atendimento/${id}/resolver`, { method: 'POST', body: '{}' }),
  decidirCancelamento: (id: string, body: { aceita: boolean; senha?: string; motivo?: string }) =>
    req(`/atendimento/${id}/cancelamento`, { method: 'POST', body: JSON.stringify(body) }),
  integracoesDelivery: () => req('/delivery/integracoes'),
  salvarIntegracao: (body: Record<string, unknown>) =>
    req('/delivery/integracoes', { method: 'PUT', body: JSON.stringify(body) }),
  // Cardápio Web (API Aberta) — modo chave X-API-KEY.
  cardapioWebStatus: () => req('/integracoes/cardapio-web/status'),
  cardapioWebSalvarChave: (body: Record<string, unknown>) =>
    req('/integracoes/cardapio-web/chave', { method: 'POST', body: JSON.stringify(body) }),
  cardapioWebPuxar: () => req('/integracoes/cardapio-web/puxar', { method: 'POST', body: '{}' }),
  cardapioWebImportarCatalogo: () =>
    req('/integracoes/cardapio-web/importar-catalogo', { method: 'POST', body: '{}' }),
  // 99Food / DiDi Food — app_id + app_secret + app_shop_id (webhook).
  food99Status: () => req('/integracoes/99food/status'),
  food99Token: () => req('/integracoes/99food/token'),
  food99CardapioTeste: () => req('/integracoes/99food/cardapio-teste', { method: 'POST', body: '{}' }),
  food99SalvarCredenciais: (body: Record<string, unknown>) =>
    req('/integracoes/99food/credenciais', { method: 'POST', body: JSON.stringify(body) }),
  food99Puxar: (orderId: string) =>
    req('/integracoes/99food/puxar', { method: 'POST', body: JSON.stringify({ orderId }) }),
  // Revenda / frota (edge appliance)
  revendas: () => req('/revenda'),
  criarRevenda: (nome: string) => req('/revenda', { method: 'POST', body: JSON.stringify({ nome }) }),
  emitirTokenAtivacao: (body: Record<string, unknown>) =>
    req('/revenda/token', { method: 'POST', body: JSON.stringify(body) }),
  frotaEdge: () => req('/revenda/frota'),
  ativacaoModulos: (id: string, body: Record<string, unknown>) =>
    req(`/ativacao/${id}/modulos`, { method: 'POST', body: JSON.stringify(body) }),
  ativacaoAcao: (id: string, acao: 'suspender' | 'reativar' | 'revogar' | 'rebind') =>
    req(`/ativacao/${id}/${acao}`, { method: 'POST', body: '{}' }),
  // WhatsApp da loja (Evolution)
  whatsappConectar: () => req('/whatsapp/conectar', { method: 'POST', body: '{}' }),
  whatsappStatus: () => req('/whatsapp/status'),
  whatsappDesconectar: () => req('/whatsapp/desconectar', { method: 'DELETE' }),
  criarPedidoDelivery: (body: Record<string, unknown>) =>
    req('/delivery/pedidos', { method: 'POST', body: JSON.stringify(body) }),
  nfDelivery: (id: string) =>
    req(`/delivery/pedidos/${id}/nf`, { method: 'POST', body: '{}' }),
  pausarDelivery: (minutos: number, motivo?: string) =>
    req('/delivery/pausar', { method: 'POST', body: JSON.stringify({ minutos, motivo }) }),
  despausarDelivery: () =>
    req('/delivery/despausar', { method: 'POST', body: '{}' }),
  // Status da licença/trial da conta (para o aviso e o paywall).
  licencaStatus: () => req('/licenca/status'),
  // Catálogo de planos (página de assinatura).
  planos: () => req('/planos'),
  // Checkout de assinatura (Stripe) → devolve { url } da página de pagamento.
  assinaturaCheckout: (body: Record<string, unknown>) =>
    req('/assinatura/checkout', { method: 'POST', body: JSON.stringify(body) }),
  deliveryConfig: () => req('/delivery/config'),
  setDeliveryConfig: (body: Record<string, unknown>) =>
    req('/delivery/config', { method: 'PUT', body: JSON.stringify(body) }),
  // TEF (Fase I)
  tefConfig: () => req('/tef/config'),
  setTefConfig: (body: Record<string, unknown>) =>
    req('/tef/config', { method: 'PUT', body: JSON.stringify(body) }),
  tefCriar: (body: Record<string, unknown>) =>
    req('/tef/pagamentos', { method: 'POST', body: JSON.stringify(body) }),
  tefGet: (id: string) => req(`/tef/pagamentos/${id}`),
  tefListar: () => req('/tef/pagamentos'),
  tefCancelar: (id: string) =>
    req(`/tef/pagamentos/${id}/cancelar`, { method: 'POST', body: '{}' }),
  tefVincular: (id: string, comandaId: string) =>
    req(`/tef/pagamentos/${id}/vincular`, {
      method: 'POST',
      body: JSON.stringify({ comandaId }),
    }),
  tefSimular: (id: string, status?: string) =>
    req(`/tef/pagamentos/${id}/simular`, {
      method: 'POST',
      body: JSON.stringify({ status: status ?? 'aprovado' }),
    }),
  // Cardápio digital (Fase J)
  cardapioConfig: () => req('/cardapio/config'),
  setCardapioConfig: (body: Record<string, unknown>) =>
    req('/cardapio/config', { method: 'PUT', body: JSON.stringify(body) }),
  produtoPermiteNegativo: (id: string, ativo: boolean) =>
    req(`/produtos/${id}/permite-negativo`, { method: 'POST', body: JSON.stringify({ ativo }) }),
  autoPausaCardapio: () => req('/cardapio/auto-pausa'),
  setAutoPausaCardapio: (ativo: boolean) =>
    req('/cardapio/auto-pausa', { method: 'POST', body: JSON.stringify({ ativo }) }),
  // Relatórios de venda (Fase K)
  relatorioVendas: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/relatorios/vendas${q ? `?${q}` : ''}`);
  },
  relatorioProdutos: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/relatorios/produtos${q ? `?${q}` : ''}`);
  },
  relatorioAtendentes: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/relatorios/atendentes${q ? `?${q}` : ''}`);
  },
  relatorioOperacoesCaixa: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/relatorios/operacoes-caixa${q ? `?${q}` : ''}`);
  },
  relatorioBalcao: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/relatorios/balcao${q ? `?${q}` : ''}`);
  },
  relatorioDelivery: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/relatorios/delivery${q ? `?${q}` : ''}`);
  },
  relatorioRanking: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/relatorios/ranking-produtos${q ? `?${q}` : ''}`);
  },
  relatorioTurnos: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/relatorios/turnos${q ? `?${q}` : ''}`);
  },
  relatorioTurnoDetalhe: (id: string) => req(`/relatorios/turnos/${id}`),
  relatorioFaturamento: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/relatorios/faturamento${q ? `?${q}` : ''}`);
  },
  relatorioFaturamentoDelivery: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/relatorios/faturamento-delivery${q ? `?${q}` : ''}`);
  },
  relatorioProducao: (inicio?: string, fim?: string, agrupamento?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    if (agrupamento) p.set('agrupamento', agrupamento);
    const q = p.toString();
    return req(`/relatorios/producao${q ? `?${q}` : ''}`);
  },
  cardapioMenu: (token: string) => pub(`/publico/cardapio/${token}`),
  cardapioPedido: (token: string, body: Record<string, unknown>) =>
    pub(`/publico/cardapio/${token}/pedido`, { method: 'POST', body: JSON.stringify(body) }),
  cardapioCupomValidar: (token: string, codigo: string, subtotal: number, telefone?: string) =>
    pub(`/publico/cardapio/${token}/cupom`, { method: 'POST', body: JSON.stringify({ codigo, subtotal, telefone }) }),
  cardapioCuponsDisponiveis: (token: string, telefone: string, subtotal: number) =>
    pub(`/publico/cardapio/${token}/cupons-disponiveis?telefone=${encodeURIComponent(telefone)}&subtotal=${subtotal}`),
  cardapioFidelidadeResgatar: (token: string, resgateId: string, telefone: string) =>
    pub(`/publico/cardapio/${token}/fidelidade/resgatar`, { method: 'POST', body: JSON.stringify({ resgateId, telefone }) }),
  cardapioFidelidadePremios: (token: string, telefone: string) =>
    pub(`/publico/cardapio/${token}/fidelidade/premios?telefone=${encodeURIComponent(telefone)}`),
  cardapioUltimoPedido: (token: string, telefone: string) =>
    pub(`/publico/cardapio/${token}/ultimo-pedido?telefone=${encodeURIComponent(telefone)}`),
  cardapioStatus: (token: string, id: string, ref?: string) =>
    pub(`/publico/cardapio/${token}/pedido/${id}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`),
  cardapioPagar: (token: string, id: string) =>
    pub(`/publico/cardapio/${token}/pedido/${id}/pagar`, { method: 'POST', body: '{}' }),
  cardapioPontos: (token: string, telefone: string) =>
    pub(`/publico/cardapio/${token}/pontos?telefone=${encodeURIComponent(telefone)}`),
  cardapioPromos: (token: string) => pub(`/publico/cardapio/${token}/promos`),
  cardapioPecaTambem: (token: string, produtos: string[]) =>
    pub(`/publico/cardapio/${token}/peca-tambem?produtos=${encodeURIComponent(produtos.join(','))}`),
  buscarClienteTelefone: (telefone: string) =>
    req(`/clientes/buscar?telefone=${encodeURIComponent(telefone)}`),
  // Cliente do cardápio (link mágico assinado).
  clienteIdentificar: (token: string, body: Record<string, unknown>) =>
    pub(`/publico/cardapio/${token}/cliente/identificar`, { method: 'POST', body: JSON.stringify(body) }),
  cardapioResolverLink: (token: string, slug: string) =>
    pub(`/publico/cardapio/${token}/cliente/link/${encodeURIComponent(slug)}`),
  clienteOtpEnviar: (token: string, telefone: string) =>
    pub(`/publico/cardapio/${token}/cliente/otp/enviar`, { method: 'POST', body: JSON.stringify({ telefone }) }),
  clienteOtpConfirmar: (token: string, body: Record<string, unknown>) =>
    pub(`/publico/cardapio/${token}/cliente/otp/confirmar`, { method: 'POST', body: JSON.stringify(body) }),
  clientePerfil: (token: string, clienteToken: string) =>
    pub(`/publico/cardapio/${token}/cliente?clienteToken=${encodeURIComponent(clienteToken)}`),
  clienteAddEndereco: (token: string, body: Record<string, unknown>) =>
    pub(`/publico/cardapio/${token}/cliente/endereco`, { method: 'POST', body: JSON.stringify(body) }),
  clienteRemEndereco: (token: string, id: string, clienteToken: string) =>
    pub(`/publico/cardapio/${token}/cliente/endereco/${id}?clienteToken=${encodeURIComponent(clienteToken)}`, { method: 'DELETE' }),
  clientePrincipalEndereco: (token: string, id: string, clienteToken: string) =>
    pub(`/publico/cardapio/${token}/cliente/endereco/${id}/principal`, { method: 'POST', body: JSON.stringify({ clienteToken }) }),
  clienteEsquecer: (token: string, clienteToken: string) =>
    pub(`/publico/cardapio/${token}/cliente/esquecer`, { method: 'POST', body: JSON.stringify({ clienteToken }) }),
  clientePedirDeNovo: (token: string, pedidoId: string, clienteToken: string) =>
    pub(`/publico/cardapio/${token}/cliente/pedir-de-novo/${pedidoId}`, { method: 'POST', body: JSON.stringify({ clienteToken }) }),
  clienteSolicitarCancelamento: (token: string, pedidoId: string, clienteToken: string) =>
    pub(`/publico/cardapio/${token}/cliente/pedido/${pedidoId}/solicitar-cancelamento`, { method: 'POST', body: JSON.stringify({ clienteToken }) }),
  clienteSolicitarAlteracao: (token: string, pedidoId: string, clienteToken: string, alvo: string, detalhe?: string) =>
    pub(`/publico/cardapio/${token}/cliente/pedido/${pedidoId}/solicitar-alteracao`, { method: 'POST', body: JSON.stringify({ clienteToken, alvo, detalhe }) }),
  cardapioBairros: () => req('/cardapio/bairros'),
  setCardapioBairros: (bairros: unknown[]) =>
    req('/cardapio/bairros', { method: 'PUT', body: JSON.stringify({ bairros }) }),
  cardapioBanners: () => req('/cardapio/banners'),
  setCardapioBanners: (banners: unknown[]) =>
    req('/cardapio/banners', { method: 'PUT', body: JSON.stringify({ banners }) }),
  cardapioCupons: () => req('/cardapio/cupons'),
  criarCupom: (body: Record<string, unknown>) =>
    req('/cardapio/cupons', { method: 'POST', body: JSON.stringify(body) }),
  removerCupom: (id: string) => req(`/cardapio/cupons/${id}`, { method: 'DELETE' }),
  // Fidelidade (gestão)
  fidelidadePlanos: () => req('/fidelidade/planos'),
  salvarFidelidadePlano: (body: Record<string, unknown>) =>
    req('/fidelidade/planos', { method: 'POST', body: JSON.stringify(body) }),
  removerFidelidadePlano: (id: string) => req(`/fidelidade/planos/${id}`, { method: 'DELETE' }),
  finalizarFidelidadePlano: (id: string) =>
    req(`/fidelidade/planos/${id}/finalizar`, { method: 'POST', body: '{}' }),
  fidelidadeParticipantes: (id: string, telefone = '') =>
    req(`/fidelidade/planos/${id}/participantes?telefone=${encodeURIComponent(telefone)}`),
  ajustarFidelidadePontos: (id: string, body: Record<string, unknown>) =>
    req(`/fidelidade/planos/${id}/pontos`, { method: 'PUT', body: JSON.stringify(body) }),
  fidelidadeRelatorio: (periodo = 'dia') =>
    req(`/fidelidade/relatorio?periodo=${encodeURIComponent(periodo)}`),
  fidelidadeRelatorioPeriodo: (inicio = '', fim = '', telefone = '') =>
    req(`/fidelidade/relatorio/periodo?inicio=${inicio}&fim=${fim}&telefone=${encodeURIComponent(telefone)}`),
  // Cashback (gestão)
  cashbackPlanos: () => req('/cashback/planos'),
  salvarCashbackPlano: (body: Record<string, unknown>) =>
    req('/cashback/planos', { method: 'POST', body: JSON.stringify(body) }),
  removerCashbackPlano: (id: string) => req(`/cashback/planos/${id}`, { method: 'DELETE' }),
  finalizarCashbackPlano: (id: string) =>
    req(`/cashback/planos/${id}/finalizar`, { method: 'POST', body: '{}' }),
  cashbackRelatorio: (inicio = '', fim = '', telefone = '') =>
    req(`/cashback/relatorio?inicio=${inicio}&fim=${fim}&telefone=${encodeURIComponent(telefone)}`),
  // Cashback (público, cardápio)
  cardapioCashback: (token: string, telefone: string) =>
    pub(`/publico/cardapio/${token}/cashback?telefone=${encodeURIComponent(telefone)}`),
  cardapioCashbackResgatar: (token: string, telefone: string, produtoId: string) =>
    pub(`/publico/cardapio/${token}/cashback/resgatar`, { method: 'POST', body: JSON.stringify({ telefone, produtoId }) }),
  comandas: () => req('/vendas/comandas'),
  comanda: (id: string) => req(`/vendas/comandas/${id}`),
  abrirComanda: (body: Record<string, unknown>) =>
    req('/vendas/comandas', { method: 'POST', body: JSON.stringify(body) }),
  addComandaItem: (id: string, body: Record<string, unknown>) =>
    req(`/vendas/comandas/${id}/itens`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removerComandaItem: (itemId: string, justificativa: string) =>
    req(`/vendas/comandas/itens/${itemId}`, { method: 'DELETE', body: JSON.stringify({ justificativa }) }),
  excluirMesa: (id: string) => req(`/vendas/mesas/${id}`, { method: 'DELETE' }),
  remocoesItens: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/vendas/remocoes${q ? `?${q}` : ''}`);
  },
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
  caixaAberta: (origem?: string) =>
    req(`/financeiro/caixa${origem ? `?origem=${origem}` : ''}`),
  formasPagamento: () => req('/financeiro/formas-pagamento'),
  criarFormaPagamento: (body: Record<string, unknown>) =>
    req('/financeiro/formas-pagamento', { method: 'POST', body: JSON.stringify(body) }),
  atualizarFormaPagamento: (id: string, body: Record<string, unknown>) =>
    req(`/financeiro/formas-pagamento/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removerFormaPagamento: (id: string) =>
    req(`/financeiro/formas-pagamento/${id}`, { method: 'DELETE' }),
  ativarFormaPagamento: (id: string, ativo: boolean) =>
    req(`/financeiro/formas-pagamento/${id}/ativa`, { method: 'POST', body: JSON.stringify({ ativo }) }),
  caixaConfig: () => req('/financeiro/caixa/config'),
  setCaixaLivre: (ativo: boolean) =>
    req('/financeiro/caixa/config/livre', {
      method: 'POST',
      body: JSON.stringify({ ativo }),
    }),
  reimprimir: (id: string) =>
    req(`/impressao/${id}/reimprimir`, { method: 'POST', body: '{}' }),
  impressaoFila: () => req('/impressao/fila'),
  impressoraTeste: (id: string) =>
    req(`/impressao/impressoras/${id}/teste`, { method: 'POST', body: '{}' }),
  abrirCaixa: (body: Record<string, unknown>) =>
    req('/financeiro/caixa/abrir', { method: 'POST', body: JSON.stringify(body) }),
  movimentarCaixa: (body: Record<string, unknown>) =>
    req('/financeiro/caixa/movimentar', { method: 'POST', body: JSON.stringify(body) }),
  fecharCaixa: (body: Record<string, unknown>) =>
    req('/financeiro/caixa/fechar', { method: 'POST', body: JSON.stringify(body) }),
  fechamentosCaixa: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/financeiro/caixa/fechamentos${q ? `?${q}` : ''}`);
  },
  financeiroDre: (inicio?: string, fim?: string) => {
    const p = new URLSearchParams();
    if (inicio) p.set('inicio', inicio);
    if (fim) p.set('fim', fim);
    const q = p.toString();
    return req(`/financeiro/dre${q ? `?${q}` : ''}`);
  },
  criarTitulo: (body: Record<string, unknown>) =>
    req('/financeiro/titulos', { method: 'POST', body: JSON.stringify(body) }),
  atualizarTitulo: (id: string, body: Record<string, unknown>) =>
    req(`/financeiro/titulos/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  excluirTitulo: (id: string) =>
    req(`/financeiro/titulos/${id}`, { method: 'DELETE' }),
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
  muralModelos: () => req('/mural/modelos'),
  confirmarLeituraMural: (id: string) =>
    req(`/mural/${id}/leitura`, { method: 'POST', body: '{}' }),
  fixarComunicado: (id: string) =>
    req(`/mural/${id}/fixar`, { method: 'PATCH', body: '{}' }),
  excluirComunicado: (id: string) =>
    req(`/mural/${id}`, { method: 'DELETE' }),
  climaAtual: () => req('/mural/clima'),
  criarPesquisaClima: (body: Record<string, unknown>) =>
    req('/mural/clima', { method: 'POST', body: JSON.stringify(body) }),
  responderClima: (id: string, body: Record<string, unknown>) =>
    req(`/mural/clima/${id}/responder`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  encerrarClima: (id: string) =>
    req(`/mural/clima/${id}/encerrar`, { method: 'POST', body: '{}' }),
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
  impressoras: () => req('/equipamento/impressoras'),
  salvarImpressora: (body: Record<string, unknown>) =>
    req('/equipamento/impressoras', { method: 'PUT', body: JSON.stringify(body) }),
  removerImpressora: (id: string) =>
    req(`/equipamento/impressoras/${id}`, { method: 'DELETE' }),
  equipamentos: () => req('/equipamento'),
  criarEquipamento: (body: Record<string, unknown>) =>
    req('/equipamento', { method: 'POST', body: JSON.stringify(body) }),
  parearTerminal: (token: string) =>
    req('/equipamento/parear', { method: 'POST', body: JSON.stringify({ token }) }),
  setTerminalImpressora: (id: string, impressoraId: string | null) =>
    req(`/equipamento/${id}/impressora`, {
      method: 'PATCH',
      body: JSON.stringify({ impressoraId }),
    }),
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
  definirSenhaColaborador: (id: string, body: { email?: string; senha: string }) =>
    req(`/colaboradores/${id}/senha`, { method: 'POST', body: JSON.stringify(body) }),
  unidades: () => req('/unidades'),
  criarUnidade: (body: { nome: string; tipo?: string; endereco?: string }) =>
    req('/unidades', { method: 'POST', body: JSON.stringify(body) }),
  atualizarUnidade: (id: string, body: { nome: string; tipo?: string; endereco?: string }) =>
    req(`/unidades/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removerUnidade: (id: string) => req(`/unidades/${id}`, { method: 'DELETE' }),
  criarAlocacao: (body: Record<string, unknown>) =>
    req('/escala', { method: 'POST', body: JSON.stringify(body) }),
  alterarAlocacao: (id: string, body: Record<string, unknown>) =>
    req(`/escala/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removerAlocacao: (id: string) =>
    req(`/escala/${id}`, { method: 'DELETE' }),
  gerarEscala: (body: Record<string, unknown>) =>
    req('/escala/gerar', { method: 'POST', body: JSON.stringify(body) }),
  editarHorarioAlocacao: (id: string, body: Record<string, unknown>) =>
    req(`/escala/${id}/horario`, { method: 'PATCH', body: JSON.stringify(body) }),
  marcarPresenca: (id: string, body: Record<string, unknown>) =>
    req(`/escala/${id}/presenca`, { method: 'PATCH', body: JSON.stringify(body) }),
  faltasEscala: (de?: string, ate?: string) => {
    const p = new URLSearchParams();
    if (de) p.set('de', de);
    if (ate) p.set('ate', ate);
    const q = p.toString();
    return req(`/escala/faltas${q ? `?${q}` : ''}`);
  },
  criarTarefaDef: (body: Record<string, unknown>) =>
    req('/tarefas', { method: 'POST', body: JSON.stringify(body) }),
  instanciarTarefa: (body: Record<string, unknown>) =>
    req('/tarefas-instancias/instanciar', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  concluirTarefa: (id: string, estado: string, motivo?: string, fotos?: string[]) =>
    req(`/tarefas-instancias/${id}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ estado, motivo, fotos }),
    }),
  // Escalados de uma função (+setor) numa data, para escolher o responsável.
  tarefaResponsaveis: (data: string, funcaoId: string, setorId?: string) => {
    const p = new URLSearchParams({ data, funcaoId });
    if (setorId) p.set('setorId', setorId);
    return req(`/tarefas-instancias/responsaveis?${p.toString()}`);
  },
  editarTarefa: (id: string, body: Record<string, unknown>) =>
    req(`/tarefas-instancias/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  excluirTarefa: (id: string, motivo: string) =>
    req(`/tarefas-instancias/${id}`, { method: 'DELETE', body: JSON.stringify({ motivo }) }),
  politicaFotoTarefa: () => req('/tarefas-instancias/politica-foto'),
  setPoliticaFotoTarefa: (body: { conclusao?: boolean; parcial?: boolean }) =>
    req('/tarefas-instancias/politica-foto', { method: 'POST', body: JSON.stringify(body) }),
};
