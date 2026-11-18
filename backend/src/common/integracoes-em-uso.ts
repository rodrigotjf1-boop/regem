// O QUE O REGEM USA DE CADA INTEGRAÇÃO — o inventário da vigilância de dependências (F3, parte 2 do
// docs/plano-mister.md; protótipo mockups/regem-dependencias-e-qualidade.html, coluna "Usamos").
//
// É dado da DISTRIBUIÇÃO, no código. O teste `integracoes-em-uso.spec.ts` lê o código e acusa:
//  • versão da Graph API da Meta escrita no código que não é a deste inventário (ou fora dos arquivos listados);
//  • modelo de IA usado no código que não está aqui ou não tem preço na tabela do "IA e uso";
//  • endereço de API listado aqui que o código não usa mais (inventário velho).
// Assim, mudar uma versão passa por aqui — e a tela de Dependências (parte 2) mostra o que está em uso de verdade.
//
// Situação em 14/11/2026: o WhatsApp (e o número do Mister) estão na Graph API v25.0; o Instagram e o Messenger, na v27.0.
// Funciona — cada produto da Meta aceita a versão dele —, mas alinhar o WhatsApp pede testar o envio e os webhooks com a
// Meta antes (fica como tarefa da vigilância).

export type TipoDeIntegracao = 'mensagens' | 'marketplaces' | 'pagamentos' | 'fiscal' | 'ia' | 'plataforma';

export interface IntegracaoEmUso {
  id: string;
  nome: string;
  tipo: TipoDeIntegracao;
  /** O que o Regem usa dela, em palavras de quem opera. */
  usamos: string;
  /** Versão da API presa no código (Graph API da Meta). */
  versao?: string;
  /** Os arquivos (a partir de `backend/src`) onde a versão está escrita. */
  arquivosDaVersao?: string[];
  /** Os modelos usados (Anthropic). */
  modelos?: string[];
  /** O endereço base que o código chama — o teste confere que ele ainda aparece no código. */
  base?: string;
}

export const INTEGRACOES_EM_USO: IntegracaoEmUso[] = [
  {
    id: 'meta-whatsapp',
    nome: 'WhatsApp · API oficial da Meta',
    tipo: 'mensagens',
    usamos: 'mensagens, modelos de mensagem, webhooks, o número do Mister e o gasto da conta (pricing_analytics e template_analytics)',
    versao: 'v25.0',
    arquivosDaVersao: ['modules/whatsapp/whatsapp-cloud.service.ts', 'modules/mister/mister-numero.service.ts', 'modules/whatsapp/whatsapp-gasto.service.ts'],
  },
  {
    id: 'meta-instagram',
    nome: 'Instagram · Graph API',
    tipo: 'mensagens',
    usamos: 'Direct, comentários e marcações da conta da loja',
    versao: 'v27.0',
    arquivosDaVersao: ['modules/instagram/instagram.ts'],
  },
  {
    id: 'meta-messenger',
    nome: 'Messenger · Graph API',
    tipo: 'mensagens',
    usamos: 'mensagens da página da loja',
    versao: 'v27.0',
    arquivosDaVersao: ['modules/messenger/messenger.ts'],
  },
  {
    id: 'anthropic',
    nome: 'Anthropic · modelos de IA',
    tipo: 'ia',
    usamos: 'o Mister, o robô de atendimento, o copiloto, as marcações do Instagram e a leitura da foto que o cliente manda',
    modelos: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
  },
  {
    id: 'ifood',
    nome: 'iFood · API do parceiro',
    tipo: 'marketplaces',
    usamos: 'pedidos, eventos (confirmar, despachar, cancelar), chat e evidências',
    base: 'https://merchant-api.ifood.com.br',
  },
  {
    id: 'mercadopago',
    nome: 'Mercado Pago · Pix',
    tipo: 'pagamentos',
    usamos: 'cobrança Pix, aviso de pagamento e estorno',
    base: 'https://api.mercadopago.com',
  },
  {
    id: 'pagbank',
    nome: 'PagBank · Pix',
    tipo: 'pagamentos',
    usamos: 'cobrança Pix e estorno',
    base: 'https://api.pagseguro.com',
  },
];

/** A versão da Graph API presa no código, como o teste a acha: `graph.facebook.com/v25.0` ou `VERSAO_PADRAO = 'v27.0'`. */
export const VERSAO_DA_GRAPH_NO_CODIGO = /graph\.(?:facebook|instagram)\.com\/(v\d+\.\d+)|VERSAO_PADRAO\s*=\s*'(v\d+\.\d+)'/g;

/** Um modelo da Anthropic escrito no código. */
export const MODELO_NO_CODIGO = /'(claude-[a-z]+-\d+-\d+)'/g;
