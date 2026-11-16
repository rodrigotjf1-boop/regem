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
    frase:
      'Pedidos confirmados e cancelados, com itens, canal, cupom usado e de qual anúncio ou link o cliente veio; e as entregas ' +
      'somadas por bairro, sem dado do cliente.',
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
  // mig 398 (Liame, Z12): só QUAIS contas a Central atende — o id e o @. Nenhuma mensagem, nenhum cliente, nenhum acesso.
  'atendimento.canais.ler': {
    rotulo: 'Canais da Central de atendimento',
    frase:
      'Quais contas do Instagram e páginas do Facebook a Central de atendimento do Regem atende: o código de cada uma e o ' +
      '@ do Instagram. Sem mensagens e sem dados de cliente.',
    naFrase: 'os canais da Central de atendimento',
    curta: 'os canais da Central',
  },
  // Orzuni (F6 do hub, 13/11/2026): as duas leituras do cardápio. A do catálogo é a frase que o parceiro já lê
  // (`FRASES_DO_PARCEIRO`, aprovada em 10/10/2026); a do iFood é só de produto da DMS (mig 374).
  'catalogo.ler': {
    rotulo: 'Produtos e adicionais',
    frase: 'Os produtos da loja, com categoria, variações, setor de produção, tempo de preparo e os adicionais de cada um. Sem preço.',
    naFrase: 'os produtos e adicionais',
    curta: 'os produtos',
  },
  'catalogo.ifood.ler': {
    rotulo: 'Preço do iFood',
    frase: 'O preço de cada produto e de cada adicional no iFood, e se o produto está no cardápio do iFood. Nenhum outro preço.',
    naFrase: 'o preço do iFood',
    curta: 'o preço do iFood',
  },
  // RegeMBoard (F6 do hub, mig 429; protótipo `clique-regemboard.html`): só leitura, sem preço.
  'catalogo.disponibilidade.ler': {
    rotulo: 'O que está esgotado agora',
    frase: 'Se cada produto e cada adicional está à venda agora nesta loja: esgotado, pausado ou fora do cardápio. Sem preço.',
    naFrase: 'o que está esgotado agora',
    curta: 'o que está esgotado',
  },
  // Farol (F6 do hub, 15/11/2026): as fichas e a fila da cozinha, com as frases que o parceiro já lê
  // (`FRASES_DO_PARCEIRO`, aprovadas em 10/10/2026). Nenhuma leva preço, custo ou cliente.
  'fichas.ler': { rotulo: 'Fichas técnicas', frase: 'Os ingredientes de cada ficha, com quantidade e unidade. Sem custo.', naFrase: 'as fichas técnicas', curta: 'as fichas' },
  'producao.ler': {
    rotulo: 'Pedidos em produção',
    frase: 'O que está na fila da cozinha: produto, quantidade, adicionais, observação e horários. Sem o cliente e sem valores.',
    naFrase: 'os pedidos em produção',
    curta: 'a fila da cozinha',
  },
  // RegemCast (F6 do hub, 15/11/2026): a lista de clientes da EMPRESA e as vendas da 99. São só de produto da DMS (nenhum
  // parceiro as recebe: `ESCOPOS_DO_PARCEIRO`), por isso as frases nascem aqui.
  'clientes.ler': {
    rotulo: 'Clientes',
    frase:
      'O nome, o telefone, os canais, o bairro e se o cliente aceitou ou recusou mensagens. Nunca o cliente que só pediu ' +
      'por aplicativo de entrega.',
    naFrase: 'a lista de clientes',
    curta: 'os clientes',
    noAssunto: 'a lista de clientes',
  },
  'vendas.99food.ler': {
    rotulo: 'Vendas da 99Food',
    frase: 'Os pedidos que chegaram pela 99Food, com o telefone que a 99 informa.',
    naFrase: 'as vendas da 99Food',
    curta: 'as vendas da 99',
  },
  // GoGeM (F6 do hub, 15/11/2026): o totem lê o cardápio, pausa no canal dele e LANÇA a venda — a primeira escrita de
  // venda pelo clique. Cada frase diz o que a rota faz: `GET /sync/catalogo`, `POST /sync/produtos/pausa` (pelo acesso de
  // integração, só o canal do totem), `POST /vendas/externa-pdv`, `/externa-pdv/falha` e `POST /delivery/totem-dinheiro`.
  'totem.catalogo.ler': {
    rotulo: 'Cardápio do totem',
    frase: 'Os produtos da loja, com preço de venda, categoria, foto, descrição e os adicionais de cada um.',
    naFrase: 'o cardápio do totem',
    curta: 'o cardápio',
  },
  'totem.produtos.pausar': {
    rotulo: 'Pausar produtos no totem',
    frase: 'Pausar e despausar um produto só no canal do totem. Os outros canais ficam como estão.',
    naFrase: 'pausar produtos no totem',
    curta: 'pausar no totem',
  },
  'totem.vendas.lancar': {
    rotulo: 'Lançar a venda do totem',
    frase:
      'Registrar no Regem a venda feita no totem, paga ou a pagar em dinheiro no caixa, que entra na loja como as outras ' +
      'vendas; e avisar quando o pagamento no totem falhou.',
    naFrase: 'lançar a venda do totem',
    curta: 'lançar a venda',
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
  /** O que ele lê, no título da página ("O Orzuni quer ler o cardápio da sua loja"). Ausente: "as vendas" (o Liame). */
  oQueLe?: string;
  /** A frase do "só lê" na abertura, quando a do Liame ("não muda pedido, preço nem cardápio") confunde. */
  soLe?: string;
  /**
   * Os endereços de volta de quem SÓ usa o clique (o Orzuni): o padrão é o de produção dele, e a variável troca a lista
   * inteira (teste, desenvolvimento). Quem tem a página de 01/10 (`AUTORIZACAO_LOJA`) segue com os endereços de lá.
   */
  voltas?: { env: string; padrao: readonly string[] };
  /**
   * A ligação é da EMPRESA INTEIRA (o RegemCast: os clientes são da empresa, mig 302): a página não pede para marcar
   * lojas (todas entram, e as que forem abertas depois também), e a troca entrega UMA ligação, sem loja.
   */
  empresaInteira?: boolean;
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

/**
 * Os aplicativos que usam a autorização por clique: o Liame (F3-1), o Orzuni (F6, 13/11/2026), o Farol (F6, 15/11/2026;
 * a página de 01/10 dele segue valendo até o fim da F6), o RegemCast (F6, 15/11/2026; a empresa inteira) e o GoGeM
 * (F6, 15/11/2026; o totem, que lança venda). Estar aqui não
 * liga nada: o aplicativo só pede com o client_id dele em `DMS_ID_APLICATIVOS` (a distribuição configura).
 */
export const APLICATIVOS_DO_CLIQUE: Record<string, AplicativoDoClique> = {
  liame: {
    nome: 'Liame',
    faz: 'mede quais anúncios viraram pedido no caixa',
    inicio: 'https://app.agencialiame.com',
    necessarias: ['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler', 'atendimento.canais.ler'],
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
      'atendimento.canais.ler': 'Para o Liame não responder o Direct nem o Messenger que a Central do Regem já atende.',
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
  // Orzuni (plano "Clique Orzuni → Regem" do hub): as MESMAS duas leituras que a chave `rgm_it_` dele já dava (mig 374),
  // nenhuma opcional. O preço e a pausa que mudam no Regem vão pelo outro sentido (o Regem chamando o Orzuni).
  orzuni: {
    nome: 'Orzuni',
    faz: 'monta no iFood os produtos que estão no Regem e ainda faltam lá',
    inicio: 'https://app.orzuni.com',
    oQueLe: 'o cardápio',
    soLe: 'Ele só lê o que estiver listado aqui; não muda pedido, preço nem cardápio no Regem.',
    voltas: { env: 'INTEGRACAO_ORZUNI_REDIRECT_URIS', padrao: ['https://app.orzuni.com/importar/volta'] },
    necessarias: ['catalogo.ler', 'catalogo.ifood.ler'],
    opcionais: [],
    dadoPessoal: [],
    financeiras: [],
    motivos: {
      'catalogo.ler': 'Para saber quais produtos e adicionais a loja tem e criar no iFood os que ainda faltam.',
      'catalogo.ifood.ler': 'Para criar cada produto no iFood com o preço que você definiu para o iFood no Regem.',
    },
    semElas: {},
    naoPode: [
      { rotulo: 'Mudar pedido, preço ou cardápio no Regem', frase: 'Esta ligação só lê: não tem nenhuma rota que mude algo no Regem.' },
      { rotulo: 'Ver os outros preços', frase: 'Preço do balcão, custo, margem e CMV ficam no Regem.' },
      { rotulo: 'Ver vendas e clientes', frase: 'Pedidos, caixa e clientes não fazem parte.' },
      { rotulo: 'Ver o resto da operação', frase: 'Fichas técnicas, estoque, equipe e ponto não fazem parte.' },
      { rotulo: 'Entrar no seu Regem', frase: 'O Orzuni não recebe a sua senha nem a sua sessão.' },
    ],
    naoPodeNoEmail: 'Ele só lê o cardápio e o preço do iFood: não pode mudar nada no Regem, nem ver vendas, clientes, custo ou os outros preços.',
  },
  // Farol (plano "Clique Farol → Regem" do hub, 15/11/2026): as MESMAS três leituras que a página de 01/10 dava (mig
  // 315), todas necessárias, nenhuma opcional (decisão do dono de 10/10: nenhuma leva preço, custo ou cliente). A volta
  // é a da página de 01/10 (`AUTORIZACAO_LOJA.farol`, o console do Farol), por isso não há `voltas` aqui.
  farol: {
    nome: 'Farol',
    faz: 'audita a operação da cozinha pela câmera e confere cada montagem com a ficha técnica',
    inicio: 'https://app.monitorfarol.com.br',
    oQueLe: 'o cardápio, as fichas técnicas e a fila da cozinha',
    soLe: 'Ele só lê o que estiver listado aqui; não muda pedido, preço, cardápio nem ficha no Regem.',
    necessarias: ['catalogo.ler', 'fichas.ler', 'producao.ler'],
    opcionais: [],
    dadoPessoal: [],
    financeiras: [],
    motivos: {
      'catalogo.ler': 'Para saber quais produtos a loja tem e reconhecer cada um na câmera.',
      'fichas.ler': 'Para conferir cada montagem com os ingredientes da ficha técnica.',
      'producao.ler': 'Para saber o que a cozinha está montando agora e comparar com o que a câmera vê.',
    },
    semElas: {},
    naoPode: [
      { rotulo: 'Mudar pedido, preço, cardápio ou ficha', frase: 'Esta ligação só lê: não tem nenhuma rota que mude algo no Regem.' },
      { rotulo: 'Ver preço, custo e margem', frase: 'O cardápio vai sem preço, a ficha vai sem custo e a fila vai sem valores.' },
      { rotulo: 'Ver vendas e clientes', frase: 'Caixa, pagamentos e quem fez o pedido não fazem parte.' },
      { rotulo: 'Ver o resto da operação', frase: 'Estoque, equipe, escala e ponto não fazem parte.' },
      { rotulo: 'Entrar no seu Regem', frase: 'O Farol não recebe a sua senha nem a sua sessão.' },
    ],
    naoPodeNoEmail: 'Ele só lê o cardápio, as fichas e a fila da cozinha: não pode mudar nada no Regem, nem ver vendas, clientes, preço ou custo.',
  },
  // RegemCast (plano "Clique RegemCast → Regem" do hub, 15/11/2026; protótipo `prototipos/clique-empresa-inteira.html`):
  // o primeiro que lê a EMPRESA inteira, com as MESMAS leituras da chave `rgm_it_` dele (mig 302). Os dados de cliente
  // são necessários (sem eles a mensagem não chega); a 99 é opcional e desligada, e o RegemCast só a pede quando o dono
  // autorizou a 99 lá (regra de 30/09/2026).
  regemcast: {
    nome: 'RegemCast',
    faz: 'monta as campanhas de WhatsApp com quem já comprou de você',
    inicio: 'https://cast.dmsregem.com',
    oQueLe: 'os clientes e as compras',
    soLe: 'Ele só lê o que estiver listado aqui; não muda pedido, preço nem cadastro no Regem.',
    voltas: { env: 'INTEGRACAO_REGEMCAST_REDIRECT_URIS', padrao: ['https://cast.dmsregem.com/integracoes/regem/volta'] },
    empresaInteira: true,
    necessarias: ['pedidos.ler', 'clientes.ler', 'clientes.telefone.ler'],
    opcionais: ['vendas.99food.ler'],
    dadoPessoal: ['clientes.ler', 'clientes.telefone.ler', 'vendas.99food.ler'],
    financeiras: [],
    motivos: {
      'pedidos.ler': 'Para saber quem comprou, o quê e quando, e montar os públicos: quem não volta há 30 dias, quem pede todo fim de semana.',
      'clientes.ler': 'Para mandar a campanha só a quem aceitou receber, e respeitar na hora quem recusou.',
      'clientes.telefone.ler': 'Para ligar cada compra ao cliente certo e não mandar a mesma mensagem duas vezes.',
      'vendas.99food.ler': 'Você autorizou a 99 no RegemCast, em Integrações › 99. Sem essa autorização lá, a 99 nem aparece aqui.',
    },
    semElas: {
      'vendas.99food.ler': 'Desligado: as campanhas não contam os pedidos da 99. O resto funciona.',
    },
    naoPode: [
      { rotulo: 'Mudar pedido, preço ou cadastro no Regem', frase: 'Esta ligação só lê: não tem nenhuma rota que mude algo no Regem.' },
      { rotulo: 'Ver custo, caixa e pagamentos', frase: 'Custo, margem, caixa e formas de pagamento ficam no Regem.' },
      { rotulo: 'Ver o resto da operação', frase: 'Estoque, fichas, equipe, escala e ponto não fazem parte.' },
      { rotulo: 'Entrar no seu Regem', frase: 'O RegemCast não recebe a sua senha nem a sua sessão.' },
    ],
    naoPodeNoEmail: 'Ele só lê os clientes e as compras: não pode mudar nada no Regem, nem ver custo, caixa, pagamentos ou o resto da operação.',
  },
  // GoGeM (plano "Clique GoGeM → Regem" do hub, 15/11/2026; protótipo `prototipos/clique-gogem.html`): o totem de
  // autoatendimento, loja por loja, com as MESMAS três permissões do token `rgm_it_` dele (mig 323), todas necessárias —
  // sem lançar a venda o totem não vende; sem pausar, vende o que acabou (G-1, G-2). A primeira escrita de venda pelo
  // clique: o título e as frases dizem isso (G-3).
  gogem: {
    nome: 'GoGeM',
    faz: 'é o totem de autoatendimento: mostra o cardápio do Regem e lança no Regem a venda feita nele',
    inicio: 'https://app.gogem.com.br',
    oQueLe: 'o cardápio e lançar as vendas do totem',
    soLe: 'Ele não muda preço nem venda já lançada no Regem; no cardápio, só pausa um produto no canal do totem.',
    voltas: { env: 'INTEGRACAO_GOGEM_REDIRECT_URIS', padrao: ['https://app.gogem.com.br/integracoes/regem/volta'] },
    necessarias: ['totem.catalogo.ler', 'totem.produtos.pausar', 'totem.vendas.lancar'],
    opcionais: [],
    dadoPessoal: [],
    financeiras: [],
    motivos: {
      'totem.catalogo.ler': 'Para mostrar no totem o cardápio e o preço que você define no Regem.',
      'totem.produtos.pausar': 'Para o totem não vender o que acabou.',
      'totem.vendas.lancar': 'Para a venda feita no totem entrar no Regem como as outras, sem ninguém digitar de novo.',
    },
    semElas: {},
    naoPode: [
      { rotulo: 'Mudar preço ou cardápio no Regem', frase: 'Ele lê o cardápio; a única mudança é pausar um produto no canal do totem.' },
      { rotulo: 'Cancelar ou mudar uma venda', frase: 'O cancelamento é feito no Regem, que avisa o totem.' },
      { rotulo: 'Ver clientes e as outras vendas', frase: 'Ele só lança a venda do totem; pedidos de outros canais e clientes não fazem parte.' },
      { rotulo: 'Entrar no seu Regem', frase: 'O GoGeM não recebe a sua senha nem a sua sessão.' },
    ],
    naoPodeNoEmail:
      'Ele lê o cardápio, pausa produtos no canal do totem e lança a venda do totem: não pode mudar preço, cancelar ou mudar ' +
      'venda, nem ver clientes e as outras vendas.',
  },
  // RegeMBoard (F6 do hub, plano "Clique RegeMBoard → Regem", R-1 a R-9; protótipo `clique-regemboard.html`): o menu nas
  // TVs da loja mostra "Esgotado" no que acabou no Regem. Loja por loja (R-4), só leitura, sem preço (R-1).
  regemboard: {
    nome: 'RegeMBoard',
    faz: 'mostra o cardápio nas TVs da loja. Com isto, o produto que acabou no Regem aparece como esgotado na TV',
    inicio: 'https://app.regemboard.com',
    oQueLe: 'o cardápio e o que está esgotado',
    soLe: 'Ele só lê: não muda nada no Regem.',
    voltas: { env: 'INTEGRACAO_REGEMBOARD_REDIRECT_URIS', padrao: ['https://app.regemboard.com/integracoes/regem/volta'] },
    necessarias: ['catalogo.ler', 'catalogo.disponibilidade.ler'],
    opcionais: [],
    dadoPessoal: [],
    financeiras: [],
    motivos: {
      'catalogo.ler': 'Para o dono escolher, no RegeMBoard, qual produto da TV é qual do Regem.',
      'catalogo.disponibilidade.ler': 'Para a TV mostrar “Esgotado” no que acabou, sem ninguém mexer no painel.',
    },
    semElas: {},
    naoPode: [
      { rotulo: 'Mudar qualquer coisa no Regem', frase: 'Nem preço, nem cardápio, nem pausa: ele só lê.' },
      { rotulo: 'Ver vendas, clientes ou valores', frase: 'Nada de pedidos, de preço ou de quem comprou.' },
      { rotulo: 'Entrar no seu Regem', frase: 'O RegeMBoard não recebe a sua senha nem a sua sessão.' },
    ],
    naoPodeNoEmail: 'Ele só lê o cardápio e o que está esgotado: não pode mudar nada no Regem, nem ver vendas, clientes ou valores.',
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

  return {
    redirectUri,
    necessarias: naOrdemDoCatalogo(pedidas.filter((p) => app.necessarias.includes(p as EscopoIntegracao))),
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
export const CORRIDA_DA_TROCA_DA_EMPRESA = 'Outra autorização desta empresa terminou agora mesmo. Peça a autorização de novo.';

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
