// Tipos + helpers do cardápio digital público (store /c/[token]).

import { apagarOrigem } from './origem-clique';

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

// Dados do cliente lembrados no APARELHO DELE (sem login) — prefill do checkout.
// LGPD: é o próprio dado do cliente, no dispositivo dele, opt-in (só grava quando ele
// fecha um pedido), sob o mesmo origin do cardápio e apagável a qualquer momento
// (ver `limparCliente`, chamado ao "Sair"/"Excluir conta"). Fica em localStorage por
// ser conveniência local — NÃO é a fila de mutação offline (essa mora no edge, em
// IndexedDB); os pedidos em si vivem no servidor, nunca aqui.
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

// A caixinha "Receber promoções…" do checkout aparece UMA vez por aparelho: respondida (marcada ou
// não), não volta. Não é dado pessoal — só lembra que a pergunta já foi feita aqui; a resposta em si
// fica no servidor. Para o cliente identificado, o servidor também diz se ele já respondeu.
const chavePromo = (token: string) => `regem_loja_promocoes_${token}`;
export function promocoesRespondida(token: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(chavePromo(token)) === '1';
  } catch {
    return false;
  }
}
export function marcarPromocoesRespondida(token: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(chavePromo(token), '1');
  } catch {
    /* privado/quota — a pergunta volta no próximo pedido; o servidor não duplica */
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

// LGPD (direito ao esquecimento local): apaga do aparelho o PII de prefill E o token
// do cliente. Chamado ao "Sair" e ao "Excluir conta" para não deixar nome/telefone/
// endereço no dispositivo depois que o cliente se desconecta.
export function limparCliente(token: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(chave(token));
    localStorage.removeItem(chaveTok(token));
  } catch {
    /* ignora */
  }
  apagarOrigem(token); // de onde ele veio (link de anúncio), guardado só nesta aba
}
