// A autorização por clique (Hub DMS, F3, parte C): o que o servidor manda à página. A tela vem MONTADA de lá
// (`autorizacao-clique.tela.ts` do backend), com os textos que o dono aprovou em 21/10/2026: a página só desenha.

export type PermissaoNaTela = {
  id: string;
  rotulo: string;
  frase: string;
  /** Por que o aplicativo pede. */
  motivo: string;
  /** Como entra numa frase ("o telefone do cliente"). */
  naFrase: string;
  /** Opcional: chave que nasce desligada. Necessária: sem chave. */
  opcional: boolean;
  dadoPessoal: boolean;
  /** O que acontece com a opcional desligada. */
  semEla: string | null;
  /** Falso: a chave fica travada desligada (o custo, sem "Ver valores em R$"). */
  disponivel: boolean;
  /** O texto no lugar da frase, com a chave travada. */
  trava: string | null;
};

export type LojaNaTela = {
  id: string;
  nome: string;
  tipo: 'Matriz' | 'Filial';
  conectadaDesde: string | null;
  jaLiberado: string[];
  marcada: boolean;
  nota: string | null;
};

export type TelaDaAutorizacao = {
  versao: number;
  modo: 'nova' | 'mais';
  aplicativo: { cliente: string; nome: string; selo: string; empresa: string; cnpj: string | null; detalhes: string; inicio: string };
  titulo: string;
  abertura: string;
  contaQuePede: { nome: string; cnpj: string | null; email: string; marca: string | null; outraEmpresa: boolean };
  empresa: { nome: string; cnpj: string | null };
  ajudaLojas: string | null;
  lojas: LojaNaTela[];
  necessarias: PermissaoNaTela[];
  opcionais: PermissaoNaTela[];
  dadosDosClientes: PermissaoNaTela[];
  novas: PermissaoNaTela[];
  jaLiberado: { desde: string; permissoes: { id: string; rotulo: string }[] } | null;
  naoPode: { rotulo: string; frase: string }[];
  confirmacao: { titulo: string; texto: string; rotulo: string } | null;
  nota: string;
  rodape: string;
  botoes: { autorizar: string; cancelar: string };
  /** Só o aplicativo de parceiro (Hub DMS, F4 parte F). */
  classe?: 'parceiro';
  /** Só o parceiro em teste: até quantas lojas ele lê (somando as empresas) e quantas esta empresa ainda pode marcar. */
  lojasDoTeste?: { maximo: number; vagas: number } | null;
  /** Só o parceiro: o resumo do texto mostrado, que a página devolve ao autorizar. */
  resumo?: string;
};

export type AppResumo = { cliente: string; nome: string; inicio: string };
export type Pessoa = { nome: string | null; nivel: string };

export type SituacaoDaTela =
  | { situacao: 'indisponivel' }
  | { situacao: 'invalido'; aplicativo: AppResumo | null }
  | { situacao: 'pausado'; aplicativo: AppResumo }
  | { situacao: 'nao_presidente'; aplicativo: AppResumo; pessoa: Pessoa }
  | { situacao: 'travada'; aplicativo: AppResumo; pessoa: Pessoa; minutos: number }
  /** O aplicativo de parceiro em teste já chegou ao limite de lojas, e esta empresa não tem nenhuma com ele. */
  | { situacao: 'limite'; aplicativo: AppResumo; pessoa: Pessoa; maximo: number; frase: string }
  | { situacao: 'escolha'; aplicativo: AppResumo; pessoa: Pessoa; tela: TelaDaAutorizacao };

/** O `cliente` de um aplicativo de parceiro (`parceiro_` + 24 hex): a página não tem textos próprios para ele. */
export const ehParceiro = (cliente: string | null | undefined): boolean => /^parceiro_[0-9a-f]{24}$/.test(cliente ?? '');

/** A prova (o texto guardado): a tela que o presidente viu, com a decisão dele. */
export type TextoGuardado = Omit<TelaDaAutorizacao, 'opcionais' | 'dadosDosClientes' | 'novas'> & {
  opcionais: (PermissaoNaTela & { ligada: boolean })[];
  dadosDosClientes: (PermissaoNaTela & { ligada: boolean })[];
  novas: (PermissaoNaTela & { ligada: boolean })[];
  confirmouOutraEmpresa: boolean | null;
};

/** "o custo dos itens e o telefone do cliente". */
export function listaNaFrase(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/**
 * Aberto dentro de outro aplicativo (Instagram, Facebook ou a visão web do Android): a volta ao aplicativo que pediu
 * pode não funcionar. Só o que dá para reconhecer com segurança; o resto segue como navegador.
 */
export function dentroDeOutroAplicativo(ua: string): boolean {
  return /\b(FBAN|FBAV|FB_IAB|Instagram)\b/.test(ua) || /; wv\)/.test(ua);
}
