import { BadRequestException } from '@nestjs/common';

// Escopos do token de integração por loja (contrato Regem → Liame v1, `docs/integracoes/regem.md`
// do Liame; contrato Regem → RegemCast em `docs/integracao-regemcast.md`; contrato Regem → Farol em
// `docs/integracao-farol.md`). Cada rota confere o seu; o que o token não tem volta 403. A lista é
// a MESMA do `check` das tabelas (migs 295, 302, 303 e 315): escopo fora dela nem chega a ser gravado.
export const ESCOPOS_INTEGRACAO = [
  'pedidos.ler',
  'clientes.telefone.ler',
  'custos.ler',
  'clientes.anonimizacao.ler',
  'cupons.ler',
  'cupons.uso.ler',
  'cupons.criar',
  // RegemCast (mig 302): a lista de clientes e a exceção da 99 (autorização do dono no RegemCast).
  'clientes.ler',
  'vendas.99food.ler',
  // Farol (mig 315): o catálogo, as fichas e a fila de produção — lidos NA HORA, sem preço nem custo.
  'catalogo.ler',
  'fichas.ler',
  'producao.ler',
] as const;

export type EscopoIntegracao = (typeof ESCOPOS_INTEGRACAO)[number];

/**
 * Escopos de LEITURA NA HORA (Farol, mig 315): o que eles liberam sai direto das tabelas, sem
 * versão nem cursor. O token que só tem estes NÃO liga o carimbador das vendas — a carga de 91
 * dias, a fila de mudanças, a reconciliação diária: para isso a empresa não está "conectada".
 */
export const ESCOPOS_SEM_CARIMBO: readonly EscopoIntegracao[] = ['catalogo.ler', 'fichas.ler', 'producao.ler'];

/** Os escopos cuja leitura depende do carimbador (todos os outros). */
export const ESCOPOS_COM_CARIMBO: readonly EscopoIntegracao[] = ESCOPOS_INTEGRACAO.filter(
  (e) => !ESCOPOS_SEM_CARIMBO.includes(e),
);

/** O que cada escopo libera, em pt-BR (tela do console). */
export const ROTULO_ESCOPO: Record<EscopoIntegracao, string> = {
  'pedidos.ler': 'Vendas confirmadas e canceladas, itens, canal e cupom usado',
  'clientes.telefone.ler': 'Id e telefone do cliente no pedido (nunca de marketplace)',
  'custos.ler': 'Custo por item (só se quem autorizou vê valores em R$)',
  'clientes.anonimizacao.ler': 'Avisos de cliente que pediu para ser esquecido',
  'cupons.ler': 'Cupons da loja, com regra e validade',
  'cupons.uso.ler': 'Usos de cupom (sem dado do cliente)',
  'cupons.criar': 'Criar e desativar cupom (só pelo Action Service do Liame)',
  'clientes.ler': 'Clientes da empresa: nome, telefone, canais, bairro, opt-out e aceite (nunca só de marketplace)',
  'vendas.99food.ler': 'Vendas e clientes da 99Food (só com a autorização do dono)',
  'catalogo.ler': 'Produtos, variações, combos e adicionais da loja (sem preço)',
  'fichas.ler': 'Fichas técnicas e ingredientes (sem custo)',
  'producao.ler': 'Pedidos na fila de produção (sem o cliente e sem valores)',
};

/**
 * Clientes de integração conhecidos (o console emite só para eles). `abrangencia`: `loja` = o
 * token é de UMA loja (Liame); `empresa` = da empresa inteira, todas as lojas (RegemCast — a
 * trava no banco, mig 302, só aceita token sem loja para ele). `escopos` = os que o console pode
 * dar a esse cliente. `cargaDias` = a janela da carga inicial quando o cliente não manda
 * `confirmados_desde` (o RegemCast lê 3 anos; o Liame segue com a carga de 91 dias da 296).
 */
export const CLIENTES_INTEGRACAO: Record<
  string,
  { rotulo: string; abrangencia: 'loja' | 'empresa'; escopos: readonly EscopoIntegracao[]; cargaDias: number | null }
> = {
  liame: {
    rotulo: 'Liame',
    abrangencia: 'loja',
    escopos: ['pedidos.ler', 'clientes.telefone.ler', 'custos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler', 'cupons.criar'],
    cargaDias: null,
  },
  regemcast: {
    rotulo: 'RegemCast',
    abrangencia: 'empresa',
    escopos: ['pedidos.ler', 'clientes.telefone.ler', 'clientes.ler', 'vendas.99food.ler'],
    cargaDias: 1096,
  },
  // Farol (mig 315): um token por loja, só com leitura na hora — nada de vendas, clientes ou custo.
  farol: {
    rotulo: 'Farol',
    abrangencia: 'loja',
    escopos: ['catalogo.ler', 'fichas.ler', 'producao.ler'],
    cargaDias: null,
  },
};

export function ehClienteIntegracao(v: unknown): v is string {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CLIENTES_INTEGRACAO, v);
}

/** Um escopo que o presidente liga ou desliga na página de autorização. */
export type EscopoOpcional = {
  escopo: EscopoIntegracao;
  /** Nome do campo no corpo de `POST /integracao-autorizacao` (true ou false, obrigatório). */
  campo: string;
  /** Como a chave nasce na página. */
  padrao: boolean;
  /** Só para quem tem "Ver valores em R$" no perfil. */
  financeiro: boolean;
};

/**
 * Autorização PELA LOJA (C1b, mig 303): o que a página "Autorizar o <cliente>" oferece.
 * `sempre` = o que toda autorização leva; `opcionais` = o que o presidente decide. Escopo do
 * cliente que não está aqui (o telefone do cliente, no Liame) NÃO sai por esta página — só pelo
 * console da distribuição. `site` é só o que a página mostra como "você veio de".
 *
 * O segredo do cliente e os endereços de volta vêm do ambiente (a distribuição configura):
 * sem o segredo, a página responde "ainda não disponível" e a troca recusa todo mundo. O
 * endereço padrão é o de produção do cliente; a variável troca a lista inteira (teste, dev).
 */
export const AUTORIZACAO_LOJA: Record<
  string,
  {
    descricao: string;
    site: string;
    sempre: readonly EscopoIntegracao[];
    opcionais: readonly EscopoOpcional[];
    envSegredo: string;
    envRedirect: string;
    redirectPadrao: readonly string[];
  }
> = {
  liame: {
    descricao: 'Marketing e tráfego pago · lê as vendas para medir os anúncios',
    site: 'app.agencialiame.com',
    sempre: ['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler'],
    opcionais: [
      { escopo: 'custos.ler', campo: 'custo', padrao: true, financeiro: true },
      { escopo: 'cupons.criar', campo: 'cupom', padrao: false, financeiro: false },
    ],
    envSegredo: 'INTEGRACAO_LIAME_CLIENT_SECRET',
    envRedirect: 'INTEGRACAO_LIAME_REDIRECT_URIS',
    redirectPadrao: ['https://api.agencialiame.com/v1/oauth/callback'],
  },
  // Farol (decisões do dono, 10/10/2026): a loja autoriza as três leituras de uma vez — não há o
  // que ligar ou desligar, porque nenhuma delas leva preço, custo ou cliente.
  farol: {
    descricao: 'Auditoria da operação por câmera · lê o cardápio, as fichas e a fila da cozinha',
    site: 'app.monitorfarol.com.br',
    sempre: ['catalogo.ler', 'fichas.ler', 'producao.ler'],
    opcionais: [],
    envSegredo: 'INTEGRACAO_FAROL_CLIENT_SECRET',
    envRedirect: 'INTEGRACAO_FAROL_REDIRECT_URIS',
    // O endereço do CONSOLE do Farol (que repassa ao servidor dele), e não o do servidor: a sessão
    // de quem pediu a conexão só existe no console, e é ela que prende a volta a quem começou.
    redirectPadrao: ['https://app.monitorfarol.com.br/api/regem/retorno'],
  },
};

/**
 * AVISOS (webhooks, mig 304): para ONDE cada cliente pode pedir que o Regem mande o aviso de
 * "algo mudou". O endereço que a integração registra (`PUT /integracao/webhook`) tem de ficar
 * DENTRO de um destes: mesma origem e o caminho começando por ele, com um trecho só depois (o id
 * da conexão no cliente). Quem define a lista é a distribuição (o padrão é o endereço de produção
 * do cliente; a variável troca a lista inteira — teste, dev). Cliente sem entrada aqui não
 * registra aviso: o Regem nunca faz chamada para endereço escolhido por quem tem só o token.
 */
export const WEBHOOK_INTEGRACAO: Record<string, { envUrls: string; padrao: readonly string[] }> = {
  liame: {
    envUrls: 'INTEGRACAO_LIAME_WEBHOOK_URLS',
    padrao: ['https://api.agencialiame.com/v1/inbox/regem/'],
  },
};

/** O que cada aplicativo é, para a tela "Aplicativos conectados" (o do Liame vem de cima). */
export const DESCRICAO_CLIENTE: Record<string, string> = {
  liame: AUTORIZACAO_LOJA.liame.descricao,
  regemcast: 'Campanhas de WhatsApp · lê os clientes e as vendas da empresa',
  farol: AUTORIZACAO_LOJA.farol.descricao,
};

export function ehEscopoIntegracao(v: unknown): v is EscopoIntegracao {
  return typeof v === 'string' && (ESCOPOS_INTEGRACAO as readonly string[]).includes(v);
}

/**
 * Lista de escopos vinda de fora (console): ao menos um, todos conhecidos, sem repetição.
 * Desconhecido → 400 listando o que não existe (nunca vira "um escopo padrão").
 */
export function validarEscopos(v: unknown): EscopoIntegracao[] {
  if (!Array.isArray(v) || !v.length) {
    throw new BadRequestException('Escolha ao menos um escopo para o token.');
  }
  const invalidos = v.filter((e) => !ehEscopoIntegracao(e)).map((e) => String(e));
  if (invalidos.length) {
    throw new BadRequestException(`Escopo desconhecido: ${invalidos.join(', ')}.`);
  }
  // Na ordem do contrato, sem repetição.
  return ESCOPOS_INTEGRACAO.filter((e) => v.includes(e));
}
