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
const ME_KEY = 'regem_me';

// Edge (LAN/HTTP): sessão por Bearer/localStorage. Nuvem: cookie httpOnly.
function ehEdge(): boolean {
  return process.env.NEXT_PUBLIC_EDGE === '1';
}

// JWT real (edge/Bearer e fallback). null no modo cookie (o token vive no cookie
// httpOnly, ilegível por JS). Usado p/ decodificar, montar o Bearer e o socket.
export function getJwt(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}
// Presença de sessão ("estou logado?") — JWT real OU sessão por cookie (identidade
// guardada em regem_me). Mantém os 53 gates `if (!getToken())` valendo nos dois modos.
export function getToken(): string | null {
  return getJwt() ?? (lerMe() ? 'cookie' : null);
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
  if (typeof window !== 'undefined') localStorage.removeItem(ME_KEY);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Identidade guardada do /auth/me (modo cookie) — SÓ para gates de UI; NÃO é
// credencial (o token vive no cookie httpOnly). O servidor sempre reconfere o RBAC.
function lerMe(): any {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(ME_KEY) || 'null');
  } catch {
    return null;
  }
}
function guardarMe(me: any) {
  if (typeof window !== 'undefined') localStorage.setItem(ME_KEY, JSON.stringify(me));
}
// Payload de identidade: do JWT (Bearer/edge) OU do /auth/me guardado (nuvem/cookie).
function lerPayload(): any {
  const t = getJwt();
  if (t) {
    try {
      return JSON.parse(atob(t.split('.')[1] ?? ''));
    } catch {
      return null;
    }
  }
  return lerMe();
}

// Estabelece a sessão após login/register. Ponto único de costura da migração
// para cookie httpOnly.
//
// Edge: guarda o token (Bearer/localStorage), como sempre.
// Nuvem: SONDA /auth/me sem Bearer — se o cookie httpOnly funciona, NÃO guarda o
// token (fica só no cookie → XSS não rouba a sessão) e memoriza a identidade p/ os
// gates de UI. Se o cookie falhar (config), cai no Bearer — AUTO-PROTEGIDO, sem
// risco de lockout: só entra em cookie-only quando o cookie comprovadamente vai.
export async function estabelecerSessao(token: string, persist = true): Promise<void> {
  if (ehEdge()) {
    setToken(token, persist);
    return;
  }
  try {
    const r = await fetch(`${apiBase()}/auth/me`, { credentials: 'include', cache: 'no-store' });
    if (r.ok) {
      clearToken(); // token só no cookie httpOnly
      guardarMe(await r.json());
      return;
    }
  } catch {
    /* cai no fallback Bearer */
  }
  setToken(token, persist);
}

// Logout: na nuvem, pede ao servidor para apagar o cookie httpOnly (o JS não
// consegue). Sempre limpa o estado local. Idempotente.
export async function sair(): Promise<void> {
  if (!ehEdge()) {
    try {
      await fetch(`${apiBase()}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch {
      /* sem rede: limpa local mesmo assim */
    }
  }
  clearToken();
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

// Workspace desta LOJA neste PC (Fase 2): qual empresa/unidade este computador
// atende. Identidade da máquina, não dado de negócio — por isso localStorage.
// Com ele a tela de entrada deixa de ser "o login de todas as empresas do
// Regem" e passa a ser a da loja, com login por apelido para quem não tem e-mail.
export type Workspace = {
  tenantId: string;
  nome: string;
  logo?: string | null;
  unidadeId?: string | null;
  unidadeNome?: string | null;
  modulos?: string[];
};
const WORKSPACE_KEY = 'regem_workspace';
export function getWorkspace(): Workspace | null {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null');
  } catch {
    return null;
  }
}
export function setWorkspace(w: Workspace | null) {
  if (typeof window === 'undefined') return;
  if (w) localStorage.setItem(WORKSPACE_KEY, JSON.stringify(w));
  else localStorage.removeItem(WORKSPACE_KEY);
  window.dispatchEvent(new Event('regem:workspace'));
}

// Terminal de PDV pareado NESTE PC (identidade da máquina, não dado de negócio).
// Guarda { id, nome, segredo } no localStorage; o `req()` manda id + segredo nos
// headers. O id diz QUEM é o PC, o segredo PROVA — sem ele qualquer usuário
// logado trocaria o id no navegador e assumiria o caixa de outro terminal.
const TERMINAL_KEY = 'regem_terminal';
function lerTerminal(): { id: string; nome: string; segredo?: string } | null {
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
export function getTerminalSegredo(): string | null {
  return lerTerminal()?.segredo ?? null;
}
export function setTerminalAtual(id: string, nome: string, segredo?: string) {
  if (typeof window === 'undefined') return;
  // Preserva o segredo já pareado quando a chamada só atualiza id/nome.
  const atual = lerTerminal();
  const seg = segredo ?? (atual?.id === id ? atual?.segredo : undefined);
  localStorage.setItem(TERMINAL_KEY, JSON.stringify({ id, nome, segredo: seg }));
  window.dispatchEvent(new Event('regem:terminal'));
}
export function clearTerminal() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TERMINAL_KEY);
  window.dispatchEvent(new Event('regem:terminal'));
}

// Categoria da hierarquia (gates de UI). Do JWT (edge) ou do /auth/me (cookie).
export function getCategoria(): string | null {
  return lerPayload()?.cat ?? null;
}

// Nome do responsável logado (menu inferior).
export function getNome(): string | null {
  return lerPayload()?.nome ?? null;
}

// Rótulo da função do responsável (ex.: "Gerente").
export function getFuncaoNome(): string | null {
  return lerPayload()?.func ?? null;
}

// Permissões do perfil de acesso (`perm`). Gates de UI apenas — a trava real é no
// servidor. Ausente (token antigo / sem sessão) = objeto vazio.
export function getPermissoes(): any {
  return lerPayload()?.perm ?? {};
}

// Atalho: o perfil pode ver valores financeiros (R$)?
export function podeVerFinanceiro(): boolean {
  return !!getPermissoes()?.ver_financeiro;
}

// Unidade FIXA do usuário (`uni`): execução/gerente de loja ficam travados nela e
// não veem o seletor. Presidente/C&O = null (escolhe a unidade).
export function getUnidadeFixa(): string | null {
  return lerPayload()?.uni ?? null;
}

// Atalho: permissão de ação por módulo (ex.: podePerm('estoque','criar')).
export function podePerm(modulo: string, acao?: string): boolean {
  const p = getPermissoes()?.[modulo];
  if (acao) return !!p?.[acao];
  return !!p;
}

// Ordem das telas = ordem do menu (NAV em app-shell/shell.tsx). Cada rota tem a
// permissão que a libera. Mantido em sincronia com o menu à mão — é a lista de
// "aterrissagem": a rota inicial de quem não é gestor é a PRIMEIRA daqui que o
// perfil pode ver. (Omite /loja por ser só-presidente — presidente já vai pro
// painel — e os itens só de submenu de configuração, que não são aterrissagem.)
const ROTAS_MENU: { href: string; perm: string }[] = [
  { href: '/painel', perm: 'dashboard' },
  { href: '/pdv', perm: 'pdv' },
  { href: '/pdv/retirada', perm: 'pedidos' },
  { href: '/mesas', perm: 'mesas' },
  { href: '/cupons', perm: 'cupons' },
  { href: '/delivery', perm: 'delivery' },
  { href: '/pedidos', perm: 'pedidos' },
  { href: '/meu-dia', perm: 'meu_dia' },
  { href: '/ordens-producao', perm: 'producao_kds' },
  { href: '/kds/alertas', perm: 'producao_kds' },
  { href: '/manutencao', perm: 'manutencao' },
  { href: '/escala', perm: 'escalas' },
  { href: '/operacao', perm: 'estoque' },
  { href: '/docs', perm: 'checklist' },
  { href: '/mural', perm: 'mural' },
  { href: '/formas-pagamento', perm: 'formas_pagamento' },
  { href: '/cadastros', perm: 'cadastros' },
  { href: '/pessoas', perm: 'ponto_gerencial' },
  { href: '/unidades', perm: 'unidades' },
  { href: '/caixa/fechamentos', perm: 'turnos' },
  { href: '/relatorios', perm: 'relatorios_vendas' },
  { href: '/auditoria', perm: 'auditoria' },
  { href: '/diretoria', perm: 'visao_co' },
];

// Permissão visível? Chaves CRUD (estoque/escalas/ponto) guardam objeto — vale o
// `.ver`; chaves bool valem o próprio valor.
function permVisivel(perm: string, perms: any): boolean {
  const v = perms?.[perm];
  return v && typeof v === 'object' ? !!v.ver : !!v;
}

// Rota inicial por perfil: presidente/gerente têm dashboard; os demais caem na
// PRIMEIRA opção do menu que o perfil pode ver (ex.: atendente de execução → PDV).
// Antes ia sempre pra /meu-dia, que execução nem tem permissão — dava tela de
// erro (403 ao carregar as tarefas). Fallback final: /meu-dia.
export function rotaInicial(cat?: string | null): string {
  if (cat === 'presidente' || cat === 'gerente') return '/painel';
  const perms = getPermissoes();
  return ROTAS_MENU.find((r) => permVisivel(r.perm, perms))?.href ?? '/meu-dia';
}

// Sessão expirada/inválida: limpa o token e manda pro login com aviso amigável.
function sessaoExpirou() {
  clearToken();
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/entrar')) {
    window.location.href = '/entrar?expirada=1';
  }
}

async function req(path: string, options: RequestInit = {}) {
  const token = getJwt(); // Bearer só quando há JWT real; no modo cookie vai o cookie
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      ...options,
      // Nuvem: manda o cookie httpOnly (a sessão vive nele quando não há Bearer).
      // Edge: CORS '*' NÃO aceita credenciais → same-origin, sessão via Bearer.
      credentials: ehEdge() ? 'same-origin' : 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(getUnidadeAtual() ? { 'X-Unidade-Id': getUnidadeAtual() as string } : {}),
        ...(getTerminalAtual() ? { 'X-Terminal-Id': getTerminalAtual() as string } : {}),
        ...(getTerminalSegredo() ? { 'X-Terminal-Secret': getTerminalSegredo() as string } : {}),
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
  login: (email: string, senha: string, codigo?: string) =>
    distReq('/distribuicao/login', { method: 'POST', body: JSON.stringify({ email, senha, codigo }) }),
  // MFA (F9.5)
  mfaIniciar: () => distReq('/distribuicao/mfa/iniciar', { method: 'POST', body: '{}' }),
  mfaConfirmar: (codigo: string) =>
    distReq('/distribuicao/mfa/confirmar', { method: 'POST', body: JSON.stringify({ codigo }) }),
  me: () => distReq('/distribuicao/me'),
  usuarios: () => distReq('/distribuicao/usuarios'),
  criarUsuario: (dto: any) =>
    distReq('/distribuicao/usuarios', { method: 'POST', body: JSON.stringify(dto) }),
  auditoria: () => distReq('/distribuicao/auditoria'),
  frota: () => distReq('/distribuicao/frota'),
  // F9 — inicia/encerra acesso de suporte a uma loja (retorna o token de suporte).
  suporteIniciar: (tenantId: string, motivo?: string) =>
    distReq('/distribuicao/suporte/iniciar', { method: 'POST', body: JSON.stringify({ tenantId, motivo }) }),
  suporteEncerrar: (sessaoId: string) =>
    distReq('/distribuicao/suporte/encerrar', { method: 'POST', body: JSON.stringify({ sessaoId }) }),
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
  // Pedidos de integração (loja pede token → distribuição conecta no portal do canal)
  pedidosIntegracao: () => distReq('/distribuicao/pedidos-integracao'),
  resolverPedidoIntegracao: (
    id: string,
    acao: 'conectado' | 'recusado' | 'removido',
    dados?: { merchantId?: string },
  ) =>
    distReq(`/distribuicao/pedidos-integracao/${id}/resolver`, {
      method: 'POST',
      body: JSON.stringify({ acao, ...(dados ?? {}) }),
    }),
};

// Upload multipart: NÃO define Content-Type (o browser injeta o boundary).
async function uploadFile(path: string, file: File) {
  const token = getJwt();
  const form = new FormData();
  form.append('file', file);
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      credentials: ehEdge() ? 'same-origin' : 'include',
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
  // Workspace da empresa: pelo e-mail da loja, devolve nome, unidades e os
  // módulos do plano. É o passo anterior ao login (não exige sessão).
  workspace: (email: string) =>
    req(`/publico/workspace?email=${encodeURIComponent(email)}`),
  // Edge: a empresa/unidade já são fixas na instalação — abre direto no login.
  workspaceLocal: () => req('/publico/workspace/local'),
  // Aceita e-mail (gestão) ou usuário/apelido (quem não tem e-mail). O backend
  // decide pelo formato; `tenantId` escopa o apelido no workspace da empresa.
  login: (identificador: string, senha: string, tenantId?: string) =>
    req('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identificador, senha, ...(tenantId ? { tenantId } : {}) }),
    }),
  pinLogin: (unidadeId: string, pin: string) =>
    req('/auth/pin', {
      method: 'POST',
      body: JSON.stringify({ unidadeId, pin }),
    }),
  // Passo 1: valida e dispara o código por e-mail (não cria conta ainda).
  register: (body: {
    empresaNome: string;
    nome: string;
    email: string;
    usuario: string;
    senha: string;
    cnpj?: string;
    endereco?: string;
  }) => req('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  // Passo 2: confirma o código de 6 dígitos → cria a conta e retorna a sessão.
  verificarCadastro: (email: string, codigo: string) =>
    req('/auth/verificar-cadastro', { method: 'POST', body: JSON.stringify({ email, codigo }) }),
  reenviarCodigoCadastro: (email: string) =>
    req('/auth/reenviar-codigo', { method: 'POST', body: JSON.stringify({ email }) }),
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
  duplicarProduto: (id: string) =>
    req(`/produtos/${id}/duplicar`, { method: 'POST' }),
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
  excluirOpcoesMassa: (ids: string[]) =>
    req('/produtos/opcoes/massa/excluir', { method: 'POST', body: JSON.stringify({ ids }) }),
  precoCustoOpcoesMassa: (ids: string[], precoCusto: number) =>
    req('/produtos/opcoes/massa/preco', { method: 'PATCH', body: JSON.stringify({ ids, precoCusto }) }),
  // Complementos reutilizáveis do catálogo (Fase 3)
  complementosCatalogo: () => req('/produtos/complementos-catalogo'),
  // Sobe complementos importados (motor) para o catálogo reutilizável, dedup idêntico.
  sincronizarComplementosCatalogo: () =>
    req('/produtos/complementos-catalogo/sincronizar', { method: 'POST' }),
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
  producaoFila: (setorId?: string, unidadeId?: string, canal?: string, equipamentoId?: string) => {
    const p = new URLSearchParams();
    if (setorId) p.set('setorId', setorId);
    if (unidadeId) p.set('unidadeId', unidadeId);
    if (canal) p.set('canal', canal);
    if (equipamentoId) p.set('equipamentoId', equipamentoId);
    const q = p.toString();
    return req(`/producao/fila${q ? `?${q}` : ''}`);
  },
  producaoAvancar: (id: string, escopo?: string, equipamentoId?: string) =>
    req(`/producao/pedidos/${id}/avancar`, {
      method: 'POST',
      body: JSON.stringify({ escopo, equipamentoId }),
    }),
  // Limpa a fila do KDS num só request (o servidor avança todos) — evita o 429.
  producaoLimparFila: (body: { canal?: string; setorId?: string; equipamentoId?: string }) =>
    req('/producao/fila/limpar', { method: 'POST', body: JSON.stringify(body) }),
  // Fase E — roteamento: define o próximo KDS da cadeia (ao avançar o card migra).
  setProximoKds: (id: string, proximoKdsId: string | null) =>
    req(`/equipamento/${id}/proximo-kds`, { method: 'PATCH', body: JSON.stringify({ proximoKdsId }) }),
  // Motor de alertas do KDS (Fase B) — cadastro + disparo manual.
  kdsAlertas: () => req('/kds/alertas'),
  kdsAlertaCriar: (body: Record<string, unknown>) =>
    req('/kds/alertas', { method: 'POST', body: JSON.stringify(body) }),
  kdsAlertaAtualizar: (id: string, body: Record<string, unknown>) =>
    req(`/kds/alertas/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  kdsAlertaRemover: (id: string) => req(`/kds/alertas/${id}`, { method: 'DELETE' }),
  kdsAlertaDisparar: (body: Record<string, unknown>) =>
    req('/kds/alertas/disparar', { method: 'POST', body: JSON.stringify(body) }),
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
  // Atacado (mig 185): preview do split imediato/encomenda por item.
  previewAtacado: (itens: { produtoId: string; quantidade: number }[]) =>
    req('/vendas/atacado/preview', { method: 'POST', body: JSON.stringify({ itens }) }),
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
  reimprimirCupom: (id: string, equipamentoId?: string | null) =>
    req(`/vendas/cupons/${id}/reimprimir`, { method: 'POST', body: JSON.stringify({ equipamentoId: equipamentoId ?? null }) }),
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
  // "Voltar pedido" (coluna Finalizado) — exige senha de gestor.
  voltarDelivery: (id: string, senha: string) =>
    req(`/delivery/pedidos/${id}/voltar`, { method: 'POST', body: JSON.stringify({ senha }) }),
  // Etiquetas de validade (Fase 5, mig 136) — rota /etiquetas-validade (a /etiquetas
  // é o rótulo de escala, outro módulo).
  etiquetaTemplate: () => req('/etiquetas-validade/template'),
  salvarEtiquetaTemplate: (body: Record<string, unknown>) =>
    req('/etiquetas-validade/template', { method: 'PUT', body: JSON.stringify(body) }),
  etiquetaFontes: () => req('/etiquetas-validade/fontes'),
  etiquetasValidade: () => req('/etiquetas-validade'),
  criarEtiqueta: (body: Record<string, unknown>) =>
    req('/etiquetas-validade', { method: 'POST', body: JSON.stringify(body) }),
  lerEtiqueta: (codigo: string) =>
    req('/etiquetas-validade/ler', { method: 'POST', body: JSON.stringify({ codigo }) }),
  buscarEtiqueta: (codigo: string) =>
    req('/etiquetas-validade/buscar', { method: 'POST', body: JSON.stringify({ codigo }) }),
  abrirEtiqueta: (id: string) => req(`/etiquetas-validade/${id}/abrir`, { method: 'POST', body: '{}' }),
  finalizarEtiqueta: (id: string) => req(`/etiquetas-validade/${id}/finalizar`, { method: 'POST', body: '{}' }),
  perdaEtiqueta: (id: string) => req(`/etiquetas-validade/${id}/perda`, { method: 'POST', body: '{}' }),
  // Desligamento + contador (Fase 4, mig 135)
  contadores: () => req('/contadores'),
  salvarContador: (body: Record<string, unknown>) =>
    req('/contadores', { method: 'PUT', body: JSON.stringify(body) }),
  removerContador: (id: string) => req(`/contadores/${id}`, { method: 'DELETE' }),
  desligarColaborador: (id: string, body: Record<string, unknown>) =>
    req(`/colaboradores/${id}/desligar`, { method: 'POST', body: JSON.stringify(body) }),
  // Pedidos de manutenção (Fase 3, mig 134)
  manutencaoLista: () => req('/manutencao'),
  manutencaoCriar: (body: Record<string, unknown>) =>
    req('/manutencao', { method: 'POST', body: JSON.stringify(body) }),
  manutencaoDelegar: (id: string, responsavelId: string) =>
    req(`/manutencao/${id}/delegar`, { method: 'POST', body: JSON.stringify({ responsavelId }) }),
  manutencaoStatus: (id: string, status: string, motivo?: string) =>
    req(`/manutencao/${id}/status`, { method: 'POST', body: JSON.stringify({ status, motivo }) }),
  manutencaoDecisao15d: (id: string, decisao: string) =>
    req(`/manutencao/${id}/decisao-15d`, { method: 'POST', body: JSON.stringify({ decisao }) }),
  manutencaoExcluir: (id: string, motivo: string) =>
    req(`/manutencao/${id}/excluir`, { method: 'POST', body: JSON.stringify({ motivo }) }),
  // Hub Retirada / Encomendas (Fase 1, mig 132)
  retiradaPedidos: () => req('/delivery/retirada'),
  // Encomendas agrupadas por data (mig 186). data opcional (YYYY-MM-DD) filtra uma data.
  encomendasPorData: (data?: string) =>
    req(`/delivery/encomendas${data ? `?data=${encodeURIComponent(data)}` : ''}`),
  entregarBalcao: (id: string, forma?: string) =>
    req(`/delivery/pedidos/${id}/entregar`, {
      method: 'POST',
      body: JSON.stringify({ forma }),
    }),
  avisarProntoDelivery: (id: string) =>
    req(`/delivery/pedidos/${id}/avisar-pronto`, { method: 'POST', body: '{}' }),
  alterarDelivery: (id: string, body: Record<string, unknown>) =>
    req(`/delivery/pedidos/${id}/alterar`, { method: 'POST', body: JSON.stringify(body) }),
  reimprimirDelivery: (id: string, equipamentoId?: string | null) =>
    req(`/delivery/pedidos/${id}/reimprimir`, { method: 'POST', body: JSON.stringify({ equipamentoId: equipamentoId ?? null }) }),
  despacharDelivery: (id: string, body?: Record<string, unknown>) =>
    req(`/delivery/pedidos/${id}/despachar`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  finalizarDelivery: (id: string, body?: { forma?: string; valorRecebido?: number }) =>
    req(`/delivery/pedidos/${id}/finalizar`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  // Confirma a entrega por código (entrega própria 99food/iFood) → valida no canal e conclui.
  confirmarCodigoDelivery: (id: string, codigo: string) =>
    req(`/delivery/pedidos/${id}/confirmar-codigo`, { method: 'POST', body: JSON.stringify({ codigo }) }),
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
  // Testa a conexão do gateway de PIX (mercadopago). token opcional: se
  // vazio, o servidor usa o token salvo.
  testarGatewayPix: (canal: string, token?: string) =>
    req(`/delivery/integracoes/${canal}/testar-pix`, { method: 'POST', body: JSON.stringify({ token: token || undefined }) }),
  // Gateway de PIX primário (o outro é fallback)
  getPixPrioritario: () => req('/delivery/pix-prioritario'),
  setPixPrioritario: (gateway: string) =>
    req('/delivery/pix-prioritario', { method: 'PATCH', body: JSON.stringify({ gateway }) }),
  // Cardápio Web (API Aberta) — modo chave X-API-KEY.
  cardapioWebStatus: () => req('/integracoes/cardapio-web/status'),
  cardapioWebSalvarChave: (body: Record<string, unknown>) =>
    req('/integracoes/cardapio-web/chave', { method: 'POST', body: JSON.stringify(body) }),
  cardapioWebPuxar: () => req('/integracoes/cardapio-web/puxar', { method: 'POST', body: '{}' }),
  cardapioWebImportarCatalogo: () =>
    req('/integracoes/cardapio-web/importar-catalogo', { method: 'POST', body: '{}' }),
  cardapioWebExportarCatalogo: () =>
    req('/integracoes/cardapio-web/exportar-catalogo', { method: 'POST', body: '{}' }),
  cardapioWebExportarTeste: () =>
    req('/integracoes/cardapio-web/exportar-teste', { method: 'POST', body: '{}' }),
  // 99Food / DiDi Food — produção: app_id/app_secret são GLOBAIS (env do servidor);
  // o lojista só autoriza a loja pelo link (getUrl) e confirma o vínculo.
  food99Status: () => req('/integracoes/99food/status'),
  food99Conectar: () => req('/integracoes/99food/conectar', { method: 'POST', body: '{}' }),
  food99Vincular: (appShopId?: string) =>
    req('/integracoes/99food/vincular', { method: 'POST', body: JSON.stringify({ appShopId: appShopId ?? '' }) }),
  food99RecusarBind: () => req('/integracoes/99food/recusar-bind', { method: 'POST', body: '{}' }),
  food99LojasAutorizadas: () => req('/integracoes/99food/lojas-autorizadas'),
  food99Token: () => req('/integracoes/99food/token'),
  food99CardapioTeste: () => req('/integracoes/99food/cardapio-teste', { method: 'POST', body: '{}' }),
  food99ExportarCatalogo: () => req('/integracoes/99food/exportar-catalogo', { method: 'POST', body: '{}' }),
  food99SalvarCredenciais: (body: Record<string, unknown>) =>
    req('/integracoes/99food/credenciais', { method: 'POST', body: JSON.stringify(body) }),
  food99Puxar: (orderId: string) =>
    req('/integracoes/99food/puxar', { method: 'POST', body: JSON.stringify({ orderId }) }),
  // Liga o recebimento de cancelamento/reembolso do cliente (shop/apply/set).
  food99AplicarSet: (body?: { cancel?: boolean; refund?: boolean }) =>
    req('/integracoes/99food/apply-set', { method: 'POST', body: JSON.stringify(body ?? {}) }),
  // Confirma a entrega self-delivery pelo código do cliente (verifyDeliveryCode → 600).
  food99VerificarEntrega: (orderId: string, codigo: string) =>
    req('/integracoes/99food/verificar-entrega', { method: 'POST', body: JSON.stringify({ orderId, codigo }) }),
  // Anota Aí — token da loja + ID da loja (polling, sem webhook público).
  ifoodSolicitar: () => req('/integracoes/ifood/solicitar', { method: 'POST', body: '{}' }),
  ifoodDesativar: () => req('/integracoes/ifood/desativar', { method: 'POST', body: '{}' }),
  ifoodStatus: () => req('/integracoes/ifood/status'),
  anotaaiStatus: () => req('/integracoes/anotaai/status'),
  anotaaiSalvarCredenciais: (body: Record<string, unknown>) =>
    req('/integracoes/anotaai/credenciais', { method: 'POST', body: JSON.stringify(body) }),
  anotaaiPuxar: () => req('/integracoes/anotaai/puxar', { method: 'POST', body: '{}' }),
  anotaaiImportarCatalogo: () => req('/integracoes/anotaai/importar-catalogo', { method: 'POST', body: '{}' }),
  // Telemetria do frontend (erro no navegador) — público; e envio de log sob demanda.
  telemetriaCliente: (body: Record<string, unknown>) =>
    req('/edge/telemetria-cliente', { method: 'POST', body: JSON.stringify(body) }),
  edgeEnviarLogs: () => req('/edge/enviar-logs', { method: 'POST', body: '{}' }),
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
  whatsappVincular: (instancia: string) =>
    req('/whatsapp/vincular', { method: 'POST', body: JSON.stringify({ instancia }) }),
  whatsappDiagnostico: () => req('/whatsapp/diagnostico'),
  // Inbox (sobre a instância Evolution do robô)
  whatsappConversas: () => req('/whatsapp/conversas'),
  whatsappMensagens: (jids: string) => req(`/whatsapp/mensagens?jids=${encodeURIComponent(jids)}`),
  whatsappEnviar: (jid: string, texto: string) =>
    req('/whatsapp/enviar', { method: 'POST', body: JSON.stringify({ jid, texto }) }),
  whatsappPausarConversa: (numero: string, pausar: boolean) =>
    req('/whatsapp/pausar-conversa', { method: 'POST', body: JSON.stringify({ numero, pausar }) }),
  // Mídia de uma mensagem sob demanda (miniatura no inbox). Devolve um data URL.
  whatsappMidia: (id: string, jid: string, fromMe: boolean) =>
    req(`/whatsapp/midia?id=${encodeURIComponent(id)}&jid=${encodeURIComponent(jid)}&fromMe=${fromMe ? 'true' : 'false'}`),
  // Cardápio em PDF pelo WhatsApp: lista os ativos (para escolher se >1) e envia.
  whatsappCardapios: () => req('/whatsapp/cardapios'),
  whatsappEnviarCardapio: (numero: string, cardapioId?: string) =>
    req('/whatsapp/enviar-cardapio', { method: 'POST', body: JSON.stringify({ numero, cardapioId }) }),
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
  // Perfis de cupom efetivos (padrão + override) — Fase 1 do construtor de cupons.
  // Salvar = setDeliveryConfig({ cupomPerfis: { caixa: { campos: [...] }, ... } }).
  cupomPerfis: () => req('/delivery/cupom-perfis'),
  // QR do entregador (Fase 4) — PÚBLICO (sem login), só pelo token do QR.
  despachoInfo: (token: string) => req(`/publico/despacho/${token}`),
  despachoConfirmar: (token: string, body: { entregadorId?: string; entregadorNome?: string }) =>
    req(`/publico/despacho/${token}`, { method: 'POST', body: JSON.stringify(body) }),
  imprimirCupomEntregador: (id: string) =>
    req(`/delivery/pedidos/${id}/cupom-entregador`, { method: 'POST', body: '{}' }),
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
  // Regras de sinal da encomenda por faixa de quantidade (mig 187).
  regrasSinalEncomenda: () => req('/cardapio/encomenda/regras-sinal'),
  setRegrasSinalEncomenda: (regras: unknown[]) =>
    req('/cardapio/encomenda/regras-sinal', { method: 'PUT', body: JSON.stringify({ regras }) }),
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
  // Ações de PII do cliente: identificadas pelo TOKEN do cliente (não por telefone).
  cardapioFidelidadeResgatar: (token: string, resgateId: string, clienteToken?: string) =>
    pub(`/publico/cardapio/${token}/fidelidade/resgatar`, { method: 'POST', body: JSON.stringify({ resgateId, clienteToken }) }),
  cardapioFidelidadePremios: (token: string, clienteToken?: string) =>
    pub(`/publico/cardapio/${token}/fidelidade/premios${clienteToken ? `?ct=${encodeURIComponent(clienteToken)}` : ''}`),
  cardapioUltimoPedido: (token: string, clienteToken?: string) =>
    pub(`/publico/cardapio/${token}/ultimo-pedido${clienteToken ? `?ct=${encodeURIComponent(clienteToken)}` : ''}`),
  cardapioStatus: (token: string, id: string, ref?: string) =>
    pub(`/publico/cardapio/${token}/pedido/${id}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`),
  cardapioPagar: (token: string, id: string) =>
    pub(`/publico/cardapio/${token}/pedido/${id}/pagar`, { method: 'POST', body: '{}' }),
  cardapioVerificarPagamento: (token: string, id: string) =>
    pub(`/publico/cardapio/${token}/pedido/${id}/verificar-pagamento`, { method: 'POST', body: '{}' }),
  // Cliente cancela a própria encomenda (estorno do sinal dentro do prazo). mig 188/S3.
  cardapioCancelarEncomenda: (token: string, id: string, clienteToken?: string, ref?: string) =>
    pub(`/publico/cardapio/${token}/pedido/${id}/cancelar`, { method: 'POST', body: JSON.stringify({ clienteToken, ref }) }),
  // Recorrências de encomenda do cliente (listar + pausar/retomar/cancelar). mig 190/S5.
  cardapioRecorrencias: (token: string, ct: string) =>
    pub(`/publico/cardapio/${token}/recorrencias?ct=${encodeURIComponent(ct)}`),
  cardapioAlterarRecorrencia: (token: string, id: string, acao: 'pausar' | 'retomar' | 'cancelar', clienteToken: string) =>
    pub(`/publico/cardapio/${token}/recorrencias/${id}/${acao}`, { method: 'POST', body: JSON.stringify({ clienteToken }) }),
  cardapioPontos: (token: string, clienteToken?: string) =>
    pub(`/publico/cardapio/${token}/pontos${clienteToken ? `?ct=${encodeURIComponent(clienteToken)}` : ''}`),
  cardapioPromos: (token: string) => pub(`/publico/cardapio/${token}/promos`),
  cardapioPecaTambem: (token: string, produtos: string[]) =>
    pub(`/publico/cardapio/${token}/peca-tambem?produtos=${encodeURIComponent(produtos.join(','))}`),
  // Beacon anônimo do funil do cardápio (F4) — best-effort.
  cardapioEvento: (token: string, sessao: string, tipo: string, meta?: unknown) =>
    pub(`/publico/cardapio/${token}/evento`, {
      method: 'POST',
      body: JSON.stringify({ sessao, tipo, meta }),
    }),
  buscarClienteTelefone: (telefone: string) =>
    req(`/clientes/buscar?telefone=${encodeURIComponent(telefone)}`),
  // CRM / segmentação (F3) — base do lojista, uso interno.
  crmResumo: () => req('/clientes/crm/resumo'),
  crmClientes: (params: { segmento?: string; busca?: string; limite?: number; offset?: number }) =>
    req(
      `/clientes/crm?${new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v != null && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString()}`,
    ),
  crmHistorico: (id: string) => req(`/clientes/crm/${encodeURIComponent(id)}/historico`),
  // Campanhas de WhatsApp por segmento (F5) — só nuvem, só gestão.
  crmCampanhaPrevia: (segmento: string) =>
    req(`/campanhas/previa?segmento=${encodeURIComponent(segmento)}`),
  crmCampanhas: () => req('/campanhas'),
  crmCampanhaCriar: (body: {
    segmento: string;
    mensagem: string;
    intervaloSeg?: number;
    tetoDia?: number | null;
    instanciaTipo?: string;
  }) => req('/campanhas', { method: 'POST', body: JSON.stringify(body) }),
  crmOptOut: (clienteId: string, optOut: boolean) =>
    req('/campanhas/opt-out', { method: 'POST', body: JSON.stringify({ clienteId, optOut }) }),
  crmFunil: (dias = 30) => req(`/clientes/funil?dias=${dias}`),
  // Número de marketing (F5b) — 2º WhatsApp p/ campanhas.
  whatsappMarketingStatus: () => req('/whatsapp/marketing/status'),
  whatsappMarketingConectar: () => req('/whatsapp/marketing/conectar', { method: 'POST' }),
  whatsappMarketingDesconectar: () => req('/whatsapp/marketing/desconectar', { method: 'DELETE' }),
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
  // Cashback (público, cardápio) — identificado pelo TOKEN do cliente.
  cardapioCashback: (token: string, clienteToken?: string) =>
    pub(`/publico/cardapio/${token}/cashback${clienteToken ? `?ct=${encodeURIComponent(clienteToken)}` : ''}`),
  cardapioCashbackResgatar: (token: string, clienteToken: string | undefined, produtoId: string) =>
    pub(`/publico/cardapio/${token}/cashback/resgatar`, { method: 'POST', body: JSON.stringify({ clienteToken, produtoId }) }),
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
  // Fechamento mensal de ponto / espelho (Épico #2)
  pontoFechamentos: () => req('/ponto/fechamentos'),
  gerarFechamentoPonto: (competencia?: string) =>
    req('/ponto/fechamentos/gerar', {
      method: 'POST',
      body: JSON.stringify(competencia ? { competencia } : {}),
    }),
  // Baixa o PDF consolidado do espelho (com auth) e devolve um object URL p/ abrir.
  pontoEspelhoPdfUrl: async (competencia: string): Promise<string> => {
    const token = getJwt();
    const res = await fetch(
      `${apiBase()}/ponto/fechamentos/${competencia}/pdf`,
      {
        credentials: ehEdge() ? 'same-origin' : 'include',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(getUnidadeAtual()
            ? { 'X-Unidade-Id': getUnidadeAtual() as string }
            : {}),
        },
      },
    );
    if (!res.ok) throw new Error(`Erro ${res.status} ao gerar o PDF`);
    return URL.createObjectURL(await res.blob());
  },
  enviarEspelhoPonto: (
    competencia: string,
    resp?: { nome?: string; telefone?: string; contadorId?: string },
  ) =>
    req(`/ponto/fechamentos/${competencia}/enviar`, {
      method: 'POST',
      body: JSON.stringify(resp ?? {}),
    }),
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
  // Empresa do token (própria) + config do presidente (janela de espelho do edge).
  empresaMinha: () => req('/empresas'),
  atualizarConfigEmpresa: (body: { mirrorDias: number }) =>
    req('/empresas/config', { method: 'PATCH', body: JSON.stringify(body) }),
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
  reimprimir: (id: string, equipamentoId?: string | null) =>
    req(`/impressao/${id}/reimprimir`, { method: 'POST', body: JSON.stringify({ equipamentoId: equipamentoId ?? null }) }),
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
  // P3: recomputa o esperado do ledger imutável e compara com o gravado (verificador).
  reconciliarCaixa: (id: string) =>
    req(`/financeiro/caixa/${id}/reconciliar`, { method: 'POST', body: '{}' }),
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
  // Papel múltiplo (mig 167): liga/desliga cupom/produção sem clobber.
  setPapeisImpressora: (id: string, body: { fazCupom?: boolean; fazProducao?: boolean }) =>
    req(`/equipamento/${id}/papeis`, { method: 'PATCH', body: JSON.stringify(body) }),
  removerImpressora: (id: string) =>
    req(`/equipamento/impressoras/${id}`, { method: 'DELETE' }),
  equipamentos: () => req('/equipamento'),
  // F10 — loja tem edge ativo? (config de impressão fica somente-leitura na nuvem)
  edgeAtivo: () => req('/equipamento/edge-ativo'),
  criarEquipamento: (body: Record<string, unknown>) =>
    req('/equipamento', { method: 'POST', body: JSON.stringify(body) }),
  // F9 — acesso de suporte (presidente vê/revoga)
  suporteEstado: () => req('/suporte/estado'),
  suporteSessoes: () => req('/suporte/sessoes'),
  suporteBloquear: (bloquear: boolean) =>
    req('/suporte/bloquear', { method: 'PATCH', body: JSON.stringify({ bloquear }) }),
  parearTerminal: (token: string) =>
    req('/equipamento/parear', { method: 'POST', body: JSON.stringify({ token }) }),
  // Módulos ativos para MIM (plano contratado ∩ liga/desliga do presidente).
  // O menu usa isto para não oferecer o que a loja não tem.
  modulosMeus: () => req('/modulos/meus'),
  // Acerto de contas do sub-PDV de salão (mig 143): a fila do caixa responsável.
  acertos: () => req('/vendas/acertos'),
  baixarAcerto: (id: string, body?: { recebidoCentavos?: number; observacao?: string }) =>
    req(`/vendas/acertos/${id}/baixar`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  // Pareamento por código (mig 142): o gestor gera, o PC troca por um segredo.
  gerarCodigoTerminal: (id: string) =>
    req(`/equipamento/${id}/codigo`, { method: 'POST' }),
  // "Trocar máquina" (DR): reseta o binding e gera um código novo p/ a máquina nova.
  trocarMaquinaTerminal: (id: string) =>
    req(`/equipamento/${id}/trocar-maquina`, { method: 'POST' }),
  parearPorCodigo: (codigo: string) =>
    req('/publico/terminal/parear', { method: 'POST', body: JSON.stringify({ codigo }) }),
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
