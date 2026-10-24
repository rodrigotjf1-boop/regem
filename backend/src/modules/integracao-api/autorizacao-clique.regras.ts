import { createHash, randomBytes } from 'crypto';
import { ESCOPOS_INTEGRACAO, type EscopoIntegracao } from './escopos';
import type { FraseDaPermissao } from './parceiros.regras';

// A AUTORIZAÇÃO POR CLIQUE do Regem (Hub DMS, F3, parte C; Padrão DMS §3) — as peças sem banco. O contrato é o da B1
// do RegemCast (os mesmos campos, as mesmas frases para quem programa o aplicativo e o mesmo `iss` na volta), para o
// Liame usar o mesmo código nos dois produtos. O que é do Regem: quem autoriza é o presidente, cada loja marcada ganha
// a própria ligação (F3-4) e a mesma empresa se decide pela raiz do CNPJ (C-3). Decisões do dono de 21/10/2026, todas
// na opção recomendada: o custo nasce desligado (C-1), com mais de uma loja nenhuma vem marcada (C-2), programar já,
// desligado (C-4), e os textos como estão no protótipo (C-5, `prototipos/autorizacao-no-regem.html` do hub).

/** Sobe a cada mudança de uma frase que o presidente lê: a prova guarda a versão do texto que ele viu. */
export const VERSAO_DO_TEXTO = 1;
/**
 * A versão do texto do APLICATIVO DE PARCEIRO (F4, parte F, R1b): outro texto (a empresa conferida, a confirmação
 * sempre, a janela de leitura), com a numeração própria. A prova diz de que classe é (`classe: 'parceiro'`).
 */
export const VERSAO_DO_TEXTO_PARCEIRO = 1;
export const MAX_ERROS_SENHA_AUTORIZACAO = 5;
export const MINUTOS_TRAVA_AUTORIZACAO = 15;
export const VALIDADE_DO_PEDIDO_MS = 10 * 60_000;

// ───────────────────────────── o número do pedido (RFC 9126) ─────────────────────────────

const PREFIXO_DO_PEDIDO = 'urn:ietf:params:oauth:request_uri:rgm_';
const FORMATO_DO_PEDIDO = /^urn:ietf:params:oauth:request_uri:rgm_[A-Za-z0-9_-]{43}$/;

export const hashDoPedido = (numero: string): string => createHash('sha256').update(numero, 'utf8').digest('hex');

export function gerarPedido(): { numero: string; hash: string } {
  const numero = PREFIXO_DO_PEDIDO + randomBytes(32).toString('base64url');
  return { numero, hash: hashDoPedido(numero) };
}

/** Forma conferida SEM ir ao banco: o que não tem a cara de um número de pedido nem é procurado. */
export const formatoDoPedido = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_PEDIDO.test(v);

// ───────────────────────────── o catálogo do clique ─────────────────────────────

/**
 * O catálogo do Regem na tela: o que a permissão libera, sem nome de aplicativo (a mesma frase para todos). `naFrase`:
 * como ela entra numa frase ("agora pede também o telefone do cliente no pedido"); `curta`: no botão ("Liberar o
 * telefone").
 */
export const PERMISSAO_NA_TELA: Partial<
  Record<EscopoIntegracao, { rotulo: string; frase: string; naFrase: string; curta: string; noAssunto?: string }>
> = {
  'pedidos.ler': {
    rotulo: 'Pedidos',
    frase: 'Pedidos confirmados e cancelados, com itens, canal, cupom usado e de qual anúncio ou link o cliente veio.',
    naFrase: 'os pedidos',
    curta: 'os pedidos',
  },
  'clientes.anonimizacao.ler': {
    rotulo: 'Aviso de cliente anonimizado',
    frase: 'Quando um cliente pede para ser esquecido no Regem, o aplicativo recebe o aviso para apagar o que tiver dele.',
    naFrase: 'o aviso de cliente anonimizado',
    curta: 'o aviso',
  },
  'cupons.ler': { rotulo: 'Cupons', frase: 'Os cupons da loja, com regra e validade.', naFrase: 'os cupons', curta: 'os cupons' },
  'cupons.uso.ler': {
    rotulo: 'Usos dos cupons',
    frase: 'Em qual pedido cada cupom foi usado, quando e com que valor.',
    naFrase: 'os usos dos cupons',
    curta: 'os usos dos cupons',
  },
  'custos.ler': {
    rotulo: 'Custo dos itens',
    frase: 'O custo de cada item vendido, pela ficha técnica.',
    naFrase: 'o custo dos itens',
    curta: 'o custo',
  },
  'cupons.criar': {
    rotulo: 'Criar cupom de campanha',
    frase: 'Criar cupons de campanha na loja e desativar os que ele mesmo criou. Os cupons que a loja criou ficam como estão.',
    naFrase: 'criar cupom de campanha',
    curta: 'criar cupom',
  },
  'clientes.telefone.ler': {
    rotulo: 'Telefone do cliente no pedido',
    frase:
      'O telefone de quem fez o pedido, um código do cliente no Regem e se é o primeiro pedido dele na loja. Sem nome, ' +
      'e-mail e endereço, e nunca de pedido de aplicativo de entrega.',
    naFrase: 'o telefone do cliente no pedido',
    curta: 'o telefone',
    noAssunto: 'o telefone do cliente',
  },
};

/** Como a permissão entra no assunto do e-mail ("O Liame passou a receber o telefone do cliente na Brasa Centro"). */
export const noAssuntoDe = (id: EscopoIntegracao): string => {
  const c = PERMISSAO_NA_TELA[id];
  return c?.noAssunto ?? c?.naFrase ?? id;
};

export type AplicativoDoClique = {
  nome: string;
  /** O que ele faz com as vendas, na abertura da tela ("O Liame mede quais anúncios viraram pedido no caixa."). */
  faz: string;
  /** O início dele: para onde "Voltar ao Liame" leva quando o pedido não vale (nunca um endereço do link). */
  inicio: string;
  necessarias: readonly EscopoIntegracao[];
  opcionais: readonly EscopoIntegracao[];
  /** Dado pessoal: num bloco próprio da tela, desligado (F3-7). */
  dadoPessoal: readonly EscopoIntegracao[];
  /** Só se libera com "Ver valores em R$" no perfil de quem autoriza. */
  financeiras: readonly EscopoIntegracao[];
  /** Por que o aplicativo pede (o motivo que ele declara; até a F4, guardado aqui). */
  motivos: Partial<Record<EscopoIntegracao, string>>;
  /** O que acontece com a opcional desligada. */
  semElas: Partial<Record<EscopoIntegracao, string>>;
  /** "O que o aplicativo não pode": só o que o servidor do Regem garante. */
  naoPode: readonly { rotulo: string; frase: string }[];
  /** O mesmo, numa frase, no e-mail aos presidentes. */
  naoPodeNoEmail: string;
  /**
   * Só o APLICATIVO DE PARCEIRO (F4, parte F, R1b): a empresa conferida pela DMS, o "para que serve" nas palavras dele,
   * as frases próprias de permissão (`FRASES_DO_PARCEIRO`) e as lojas que ele pode ter. Ausente nos produtos da DMS.
   */
  parceiro?: {
    empresa: { razaoSocial: string; cnpj: string };
    paraQueServe: string;
    frases: Partial<Record<EscopoIntegracao, FraseDaPermissao>>;
    lojas: number | null;
  };
};

/** A frase da permissão para este aplicativo: a própria do parceiro, quando tem; senão a do catálogo do clique. */
export const fraseDe = (app: Pick<AplicativoDoClique, 'parceiro'>, id: EscopoIntegracao): FraseDaPermissao | undefined =>
  app.parceiro?.frases[id] ?? PERMISSAO_NA_TELA[id];

/** Os aplicativos que usam a autorização por clique. Só o Liame (F3-1): o Farol segue na página de 01/10 até a F6. */
export const APLICATIVOS_DO_CLIQUE: Record<string, AplicativoDoClique> = {
  liame: {
    nome: 'Liame',
    faz: 'mede quais anúncios viraram pedido no caixa',
    inicio: 'https://app.agencialiame.com',
    necessarias: ['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler'],
    opcionais: ['custos.ler', 'cupons.criar', 'clientes.telefone.ler'],
    dadoPessoal: ['clientes.telefone.ler'],
    financeiras: ['custos.ler'],
    motivos: {
      'pedidos.ler': 'Para saber qual anúncio ou link trouxe cada venda.',
      'clientes.anonimizacao.ler': 'Para apagar do Liame quem pediu para ser esquecido no Regem.',
      'cupons.ler': 'Para saber quais cupons de campanha estão valendo.',
      'cupons.uso.ler': 'Para contar as vendas que cada cupom de campanha trouxe.',
      'custos.ler': 'Para mostrar a margem de cada campanha, e não só a receita.',
      'cupons.criar': 'Para criar o cupom de uma campanha que alguém da sua empresa aprovou no Liame, sem digitar de novo no Regem.',
      'clientes.telefone.ler': 'Para ligar a conversa do WhatsApp aberta por um anúncio ao pedido que veio dela.',
    },
    semElas: {
      'custos.ler': 'Desligado: a margem fica desconhecida, nunca zero. O resto funciona.',
      'cupons.criar': 'Desligado: o Liame não cria cupom na loja. O resto funciona.',
      'clientes.telefone.ler': 'Desligado: o Liame não liga a conversa ao pedido. O resto funciona.',
    },
    naoPode: [
      { rotulo: 'Mudar pedido, preço ou cardápio', frase: 'A integração não tem nenhuma rota que mude a venda ou o cardápio.' },
      { rotulo: 'Mexer nos cupons da loja', frase: 'Com a permissão ligada, ele só desativa os cupons que ele mesmo criou.' },
      { rotulo: 'Ver quem é o cliente', frase: 'Nome, e-mail e endereço ficam no Regem. O telefone só vai com a permissão própria, acima.' },
      { rotulo: 'Ver o resto da operação', frase: 'Equipe, escala, ponto, estoque e caixa não fazem parte.' },
      { rotulo: 'Entrar no seu Regem', frase: 'O Liame não recebe a sua senha nem a sua sessão.' },
    ],
    naoPodeNoEmail: 'Ele não pode mudar pedido, preço nem cardápio, nem ver nome, e-mail e endereço dos clientes.',
  },
};

/** O texto da chave do custo travada (sem "Ver valores em R$"). */
export const CUSTO_TRAVADO =
  'Seu perfil não tem “Ver valores em R$”. Para liberar o custo, um presidente com essa permissão autoriza. Sem o custo, ' +
  'o Liame mostra a receita, mas a margem fica desconhecida.';

/** Na ordem do catálogo do Regem. */
export const naOrdemDoCatalogo = (lista: Iterable<string>): EscopoIntegracao[] => {
  const tem = new Set(lista);
  return ESCOPOS_INTEGRACAO.filter((e) => tem.has(e));
};

// ───────────────────────────── o pedido do aplicativo ─────────────────────────────

export type CorpoDoPedido = Record<string, unknown>;

export type ContaQuePede = { nome: string; cnpj: string | null; email: string; marca: string | null };

export type PedidoConferido = {
  redirectUri: string;
  necessarias: EscopoIntegracao[];
  opcionais: EscopoIntegracao[];
  state: string;
  desafio: string;
  contaQuePede: ContaQuePede;
};

const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Confere o pedido que o aplicativo empurra (com o token do DMS ID). Devolve o que gravar, ou a frase do primeiro campo
 * errado — para quem programa o aplicativo, não para o presidente, que nunca vê esta resposta. As frases são as do
 * RegemCast: o mesmo cliente fala com os dois.
 */
export function conferirPedido(
  corpo: CorpoDoPedido,
  app: AplicativoDoClique,
  clientIdDoToken: string,
  enderecosDeVolta: readonly string[],
): PedidoConferido | { erro: string } {
  if (corpo.response_type !== 'code') return { erro: 'response_type precisa ser "code".' };
  if (corpo.client_id !== undefined && corpo.client_id !== clientIdDoToken) {
    return { erro: 'client_id não é o do token do DMS ID que fez o pedido.' };
  }

  const redirectUri = texto(corpo.redirect_uri);
  if (!enderecosDeVolta.includes(redirectUri)) return { erro: 'redirect_uri não é um endereço de volta cadastrado para este aplicativo.' };

  const pedidas = texto(corpo.scope).split(/\s+/).filter(Boolean);
  if (!pedidas.length) return { erro: 'scope precisa trazer ao menos uma permissão.' };
  if (new Set(pedidas).size !== pedidas.length) return { erro: 'scope tem permissão repetida.' };
  const podem: readonly string[] = [...app.necessarias, ...app.opcionais];
  const fora = pedidas.find((p) => !podem.includes(p));
  if (fora) return { erro: `A permissão "${fora}" não pode ser pedida por este aplicativo na autorização por clique.` };

  const state = typeof corpo.state === 'string' ? corpo.state : '';
  if (!/^[\x21-\x7e]{16,200}$/.test(state)) return { erro: 'state precisa ter de 16 a 200 caracteres visíveis.' };
  if (corpo.code_challenge_method !== 'S256') return { erro: 'code_challenge_method precisa ser "S256".' };
  const desafio = typeof corpo.code_challenge === 'string' ? corpo.code_challenge : '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(desafio)) return { erro: 'code_challenge precisa ser o SHA-256 do verificador, em base64url (43 caracteres).' };

  const nome = texto(corpo.conta_nome);
  if (nome.length < 1 || nome.length > 120) return { erro: 'conta_nome precisa ter de 1 a 120 caracteres.' };
  const cnpjBruto = texto(corpo.conta_cnpj);
  const cnpj = cnpjBruto ? cnpjBruto.replace(/[.\-/\s]/g, '') : '';
  if (cnpj && !/^\d{14}$/.test(cnpj)) return { erro: 'conta_cnpj precisa ter 14 dígitos (ou ficar vazio).' };
  const email = texto(corpo.conta_email).toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { erro: 'conta_email precisa ser um e-mail.' };
  const marca = texto(corpo.conta_marca);
  if (marca.length > 120) return { erro: 'conta_marca pode ter até 120 caracteres.' };

  const necessarias = naOrdemDoCatalogo(pedidas.filter((p) => app.necessarias.includes(p as EscopoIntegracao)));
  // Sem nenhuma necessária, a autorização com as opcionais desligadas não daria permissão nenhuma (e o acesso não
  // nasce sem escopo: o `check` da tabela recusaria só na troca).
  if (!necessarias.length) return { erro: 'scope precisa trazer ao menos uma permissão necessária deste aplicativo.' };

  return {
    redirectUri,
    necessarias,
    opcionais: naOrdemDoCatalogo(pedidas.filter((p) => app.opcionais.includes(p as EscopoIntegracao))),
    state,
    desafio,
    contaQuePede: { nome, cnpj: cnpj || null, email, marca: marca || null },
  };
}

// ───────────────────────────── a mesma empresa (C-3) ─────────────────────────────

const soDigitos = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '');

/** A raiz do CNPJ: os 8 primeiros números, iguais na matriz e nas filiais. Vazio sem CNPJ completo. */
export function raizDoCnpj(cnpj: string | null | undefined): string {
  const d = soDigitos(cnpj);
  return d.length === 14 ? d.slice(0, 8) : '';
}

/**
 * A conta que pede é de outra empresa? Pela raiz do CNPJ (decisão C-3): matriz e filiais são a mesma empresa. Sem CNPJ
 * (de quem pede ou da empresa no Regem) conta como outra (Padrão §3).
 */
export function ehOutraEmpresa(cnpjQuePede: string | null, cnpjDaEmpresa: string | null): boolean {
  const a = raizDoCnpj(cnpjQuePede);
  const b = raizDoCnpj(cnpjDaEmpresa);
  return !a || !b || a !== b;
}

/** "11.222.333/0001-00" (o que não tem 14 dígitos sai como veio, sem os espaços das pontas). */
export function cnpjComMascara(cnpj: string | null | undefined): string | null {
  const d = soDigitos(cnpj);
  if (d.length !== 14) return cnpj ? String(cnpj).trim() || null : null;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// ───────────────────────────── a senha ─────────────────────────────

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** A senha errada (1ª a 4ª): quantas faltam para travar. */
export function fraseDaSenhaErrada(erros: number): string {
  const restam = Math.max(1, MAX_ERROS_SENHA_AUTORIZACAO - erros);
  return `Senha incorreta. Nada foi autorizado. ${restam === 1 ? 'Mais uma senha errada trava' : `Mais ${restam} senhas erradas travam`} a autorização por ${MINUTOS_TRAVA_AUTORIZACAO} minutos.`;
}

/** Os minutos que faltam da trava, arredondados para cima (no mínimo 1). */
export const minutosDaTrava = (travadaAte: Date, agora: number = Date.now()): number =>
  Math.max(1, Math.ceil((travadaAte.getTime() - agora) / 60_000));

export const fraseDaTrava = (minutos: number): string =>
  `A autorização está travada por ${plural(minutos, 'minuto', 'minutos')}: foram cinco senhas erradas seguidas. Nada foi liberado.`;

// ───────────────────────────── as frases das recusas ─────────────────────────────

export const PEDIDO_INVALIDO =
  'Este pedido de autorização não vale: ele já foi usado, venceu (vale 10 minutos) ou chegou incompleto. Volte ao ' +
  'aplicativo e comece de novo.';
export const APLICATIVO_PARADO = 'O aplicativo está parado pela DMS. Nenhuma autorização nova é aceita enquanto durar.';
export const SO_O_PRESIDENTE = 'Só o presidente da empresa autoriza outra ferramenta a ler as vendas.';
export const CLIQUE_DESLIGADO = 'A autorização por clique não está ligada neste ambiente.';
export const APLICATIVO_SEM_CLIQUE = 'Este aplicativo não usa a autorização por clique do Regem.';
export const CODIGO_INVALIDO = 'Código de autorização inválido, vencido ou já usado.';
export const CORRIDA_DA_TROCA = 'Outra autorização desta loja terminou agora mesmo. Peça a autorização de novo.';

// ───────────────────────────── a configuração ─────────────────────────────

export type ConfigClique = { ligada: boolean; empresa: string; cnpj: string; motivo: string | null };

/**
 * A chave e a empresa dona dos aplicativos (a DMS: a tela mostra a razão social e o CNPJ dela). Configuração torta não
 * derruba a API, como a do hub (A2): a autorização por clique fica indisponível, com o motivo no log. A via do DMS ID
 * também tem de estar ligada; quem chama confere.
 */
export function lerConfigClique(env: Record<string, string | undefined> = process.env): ConfigClique {
  const empresa = String(env.AUTORIZACAO_DMS_RAZAO_SOCIAL ?? '').trim();
  const cnpj = soDigitos(env.AUTORIZACAO_DMS_CNPJ);
  if (String(env.AUTORIZACAO_POR_CLIQUE ?? '').trim() !== 'true') return { ligada: false, empresa, cnpj, motivo: null };
  if (empresa.length < 2 || empresa.length > 200) {
    return { ligada: false, empresa, cnpj, motivo: 'AUTORIZACAO_DMS_RAZAO_SOCIAL precisa ter de 2 a 200 caracteres' };
  }
  if (cnpj.length !== 14) return { ligada: false, empresa, cnpj, motivo: 'AUTORIZACAO_DMS_CNPJ precisa ter 14 dígitos' };
  return { ligada: true, empresa, cnpj, motivo: null };
}

/** O `iss` da volta (RFC 9207): a origem da API do Regem (a do recurso do DMS ID), sem caminho. */
export function emissorDoRegem(recurso: string): string {
  return new URL(recurso).origin;
}
