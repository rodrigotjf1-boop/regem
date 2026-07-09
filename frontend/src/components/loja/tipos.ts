// Tipos + helpers do cardápio digital público (store /c/[token]).

export const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Acento por ramo (mesmo do mockup regem-loja).
export const TEMA: Record<string, string> = {
  food: '#E2A340',
  varejo: '#2563EB',
  industria: '#E05A2B',
  servicos: '#0E8E7E',
};

export const SELO: Record<string, string> = {
  mais_pedido: '🔥 Mais pedido',
  novo: '✨ Novo',
  veg: '🌱 Veg',
  sem_gluten: '🌾 S/ glúten',
  sem_lactose: '🥛 S/ lactose',
  picante: '🌶️ Picante',
};

export type CartItem = {
  key: string;
  produtoId: string;
  variacaoId?: string;
  complementos: string[];
  nome: string;
  sub: string;
  preco: number;
  obs: string;
  qtd: number;
};

// Dados do cliente lembrados no aparelho (sem login) — prefill do checkout.
export type ClientePrefill = {
  nome?: string;
  telefone?: string;
  telefone2?: string;
  rua?: string;
  numero?: string;
  referencia?: string;
  bairroId?: string;
};

const chave = (token: string) => `regem_loja_cliente_${token}`;

export function carregarCliente(token: string): ClientePrefill {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(chave(token)) || '{}');
  } catch {
    return {};
  }
}

// Token assinado do cliente (link mágico), guardado por cardápio no navegador.
const chaveTok = (token: string) => `regem_loja_clientetoken_${token}`;
export function getClienteToken(token: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(chaveTok(token));
  } catch {
    return null;
  }
}
export function setClienteToken(token: string, clienteToken: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (clienteToken) localStorage.setItem(chaveTok(token), clienteToken);
    else localStorage.removeItem(chaveTok(token));
  } catch {
    /* ignora */
  }
}

export function salvarCliente(token: string, dados: ClientePrefill) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(chave(token), JSON.stringify(dados));
  } catch {
    /* quota/privado — ignora */
  }
}
