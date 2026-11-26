import { somarDias } from '../../common/data';
import { diaMesDoRelatorio, nomeDoDia, RelatorioDevido, TipoDeRelatorio } from './mister-relatorios.regras';

// OS MODELOS DE MENSAGEM DO MISTER NA META (parte 2 dos avisos e dos relatórios). Regras puras: o texto de cada
// modelo, o pedido de aprovação, a mensagem que usa o modelo, os parâmetros e o botão.
//
//  • Fora da janela de 24 horas da Meta, a mensagem livre não chega. Só chega um MODELO aprovado por ela. O Mister tem
//    dois: o aviso e o "resumo pronto". Os dois são de UTILIDADE (custam uma fração dos de marketing) e têm um botão de
//    resposta rápida.
//  • O botão leva um código (`mister:aviso:<id>` ou `mister:resumo:<id>`). O toque volta pelo webhook com esse código, e
//    a mensagem da pessoa abre a janela. Aí o Mister manda o texto inteiro: o aviso com o que fazer, ou o resumo, que só
//    é feito nessa hora. Nada se gasta com IA antes de a pessoa pedir.
//  • O texto, o idioma e a categoria moram AQUI, e o servidor pede a aprovação com eles (console da distribuição › aba
//    "Mister" › "Modelos de mensagem"). Assim o número de parâmetros que a Meta aprovou é sempre o que o envio manda: um
//    modelo digitado à mão no painel da Meta pode ter `{{n}}` a mais ou a menos e ser recusado no envio.
//  • Mudar o texto de um modelo aprovado pede um nome novo (`_v2`): a Meta não troca o texto de um modelo em uso.

export const IDIOMA_DOS_MODELOS = 'pt_BR';

export interface ModeloDoMister {
  nome: string;
  /** Para que serve, como o console mostra. */
  finalidade: string;
  /** O corpo, com {{1}} e {{2}}. */
  corpo: string;
  /** Os valores de exemplo que a Meta exige no pedido (um por parâmetro, na ordem). */
  exemplo: [string, string];
  /** O texto do botão de resposta rápida (até 25 caracteres). */
  botao: string;
}

export const MODELO_DO_AVISO: ModeloDoMister = {
  nome: 'mister_aviso',
  finalidade: 'Avisos fora das 24 horas',
  corpo: 'Aviso do Mister para {{1}}: {{2}}. Toque no botão para ver o que fazer.',
  exemplo: ['Burger da Praça', 'a impressora da cozinha está parada'],
  botao: 'Ver o que fazer',
};

export const MODELO_DO_RESUMO: ModeloDoMister = {
  nome: 'mister_resumo_pronto',
  finalidade: 'Resumos fora das 24 horas',
  corpo: 'Seu {{1}} está pronto ({{2}}). Toque no botão para receber.',
  exemplo: ['resumo do dia', 'Burger da Praça'],
  botao: 'Ver resumo',
};

export const MODELOS_DO_MISTER: readonly ModeloDoMister[] = [MODELO_DO_AVISO, MODELO_DO_RESUMO];

/** O corpo do pedido de aprovação (`POST /{waba}/message_templates`), no formato da documentação da Meta. */
export function pedidoDeAprovacao(m: ModeloDoMister) {
  return {
    name: m.nome,
    language: IDIOMA_DOS_MODELOS,
    category: 'UTILITY',
    components: [
      // No corpo, o exemplo é uma lista DENTRO de outra lista (no cabeçalho é uma lista simples).
      { type: 'BODY', text: m.corpo, example: { body_text: [[...m.exemplo]] } },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: m.botao }] },
    ],
  };
}

/** Teto de cada parâmetro: a mensagem inteira do modelo cabe com folga no limite de 1.024 caracteres do corpo. */
export const PARAMETRO_MAX = 120;

/**
 * Um parâmetro como a Meta aceita: sem quebra de linha, sem tabulação e sem mais de quatro espaços seguidos (ela recusa a
 * mensagem). Sem o ponto final, porque o corpo já põe a pontuação. Vazio vira "—": parâmetro vazio também é recusado.
 */
export function parametro(texto: unknown): string {
  const limpo = String(texto ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[.!;:,\s]+$/, '');
  if (!limpo) return '—';
  return limpo.length <= PARAMETRO_MAX ? limpo : `${limpo.slice(0, PARAMETRO_MAX - 1).trimEnd()}…`;
}

/**
 * Os dois parâmetros do aviso: para quem (a loja) e o quê. O título dos avisos é "<loja> · <o quê>". O que não tem loja
 * no título (a chave de IA parada) vai com o nome da empresa.
 */
export function parametrosDoAviso(titulo: string, empresa: string): [string, string] {
  const i = titulo.indexOf(' · ');
  if (i > 0) return [parametro(titulo.slice(0, i)), parametro(titulo.slice(i + 3))];
  return [parametro(empresa), parametro(titulo)];
}

/** Os dois parâmetros do "resumo pronto": qual resumo e de qual empresa. */
export function parametrosDoResumo(tipo: TipoDeRelatorio, d: RelatorioDevido, empresa: string): [string, string] {
  const qual =
    tipo === 'resumo_dia'
      ? `resumo de ${nomeDoDia(d.referencia)}, ${diaMesDoRelatorio(d.referencia)}`
      : tipo === 'fichas_novas'
        ? `resumo das fichas novas de candidatos de ${diaMesDoRelatorio(d.referencia)}`
        : tipo === 'boletim_ramo'
          ? `boletim do ramo de ${diaMesDoRelatorio(d.referencia)}`
          : tipo === 'vespera'
            ? `aviso de ${nomeDoDia(somarDias(d.referencia, 1))}, ${diaMesDoRelatorio(somarDias(d.referencia, 1))}`
            : tipo === 'ideias_semana'
              ? `resumo com as ideias da semana de ${diaMesDoRelatorio(d.referencia)} a ${diaMesDoRelatorio(d.ate)}`
              : `resumo da semana de ${diaMesDoRelatorio(d.referencia)} a ${diaMesDoRelatorio(d.ate)}`;
  return [parametro(qual), parametro(empresa)];
}

// ───────────────────────────── o botão ─────────────────────────────

/** `vigia` (versão 4, M4d, mig 452): o lembrete ou a mudança do "fica de olho" que saiu fora das 24 horas. */
export type ToqueNoModelo = { tipo: 'aviso' | 'resumo' | 'vigia' | 'regra' | 'pedido'; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** O código que vai no botão do modelo e volta no toque. */
export const codigoDoBotao = (t: ToqueNoModelo): string => `mister:${t.tipo}:${t.id}`;

/** O toque num botão de modelo do Mister — ou null (outro botão, código malformado, id que não é uuid). */
export function toqueNoModelo(codigo: unknown): ToqueNoModelo | null {
  // `regra` (versão 6, M6e, mig 472): o aviso de uma regra da pessoa que saiu fora das 24 horas.
  // `pedido` (versão 10, C6b): o pedido do gerente ao presidente que saiu fora das 24 horas (o id é o da proposta).
  const m = /^mister:(aviso|resumo|vigia|regra|pedido):(.+)$/.exec(String(codigo ?? '').trim());
  if (!m) return null;
  const id = m[2].toLowerCase();
  return UUID.test(id) ? { tipo: m[1] as ToqueNoModelo['tipo'], id } : null;
}

/** A mensagem que usa o modelo (`POST /{phone}/messages`): os parâmetros do corpo e o código do botão. */
export function mensagemDoModelo(m: ModeloDoMister, para: string, parametros: [string, string], toque: ToqueNoModelo) {
  return {
    messaging_product: 'whatsapp',
    to: para,
    type: 'template',
    template: {
      name: m.nome,
      language: { code: IDIOMA_DOS_MODELOS },
      components: [
        { type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: parametro(t) })) },
        { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: codigoDoBotao(toque) }] },
      ],
    },
  };
}

// ───────────────────────────── a situação na Meta ─────────────────────────────

export type SituacaoDoModelo = 'nao_pedido' | 'em_analise' | 'aprovado' | 'recusado' | 'pausado' | 'desativado' | 'outra';

/** O status que a Meta devolve, na situação que o console mostra. */
export function situacaoDoModelo(status: unknown): SituacaoDoModelo {
  switch (String(status ?? '').toUpperCase()) {
    case '':
      return 'nao_pedido';
    case 'APPROVED':
      return 'aprovado';
    case 'PENDING':
    case 'IN_APPEAL':
      return 'em_analise';
    case 'REJECTED':
      return 'recusado';
    case 'PAUSED':
      return 'pausado';
    case 'DISABLED':
      return 'desativado';
    default:
      return 'outra';
  }
}

/**
 * O código da Meta que diz "este modelo não pode ser usado agora": não existe no idioma (132001), parâmetros que não
 * batem (132000), pausado (132015) ou desativado (132016). O aviso fica anotado com `modelo_nao_aprovado`.
 */
export const ehRecusaDoModelo = (codigo: unknown): boolean => [132000, 132001, 132015, 132016].includes(Number(codigo));
