import { createHash } from 'crypto';
import { ErroMcp, lerChave, montarChaveIdempotencia } from '../../dms/integracao-dms';
import { AnaliseDaFoto, TipoDaFoto, limparDescricao } from '../../common/foto-do-cliente';
import { ipPrivadoOuLocal } from '../../common/ssrf-guard';

// O DMS GRAPH NO REGEM (G5a do plano "DMS Graph no Hub"; mig 450) — as regras sem banco.
//
// O atendente virtual manda a foto que o cliente mandou no WhatsApp ao DMS Graph (produto da DMS que analisa imagem pelo
// Gemini) pela porta MCP do Graph (`analisar_arquivo`), com o token do DMS ID do PRÓPRIO aplicativo do Regem (o mesmo do
// Orzuni: `DMS_ID_EMISSOR`, `HUB_APLICATIVO`, `HUB_SEGREDO`; destino = o endereço da porta) e o segredo da ligação da
// EMPRESA no cabeçalho `DMS-Ligacao` (G-3). O JSON de volta vira a MESMA análise que a IA da empresa devolve hoje
// (`common/foto-do-cliente.ts`); a IA da empresa fica de reserva (G-4).
//
// Tudo DESLIGADO por padrão, em duas chaves: `GRAPH_LIGADO` (a distribuição liga no `regem-api` — só o valor exato `true`)
// e a ligação viva da empresa (o presidente liga pelo clique, GR-2). Sem as duas, a foto segue como hoje. No piloto,
// `GRAPH_EMPRESAS` limita a quem o cartão aparece (vazia = todas).

/** A porta MCP do Graph em produção (o recurso no DMS ID é o mesmo endereço — `GRAPH_RECURSO` lá). */
export const ENDERECO_PADRAO = 'https://graph.dmstecnologias.com/mcp';

/** A permissão que o Regem não funciona sem. A porta ainda confere a ligação: vale a menor das duas. */
export const PERMISSAO_DO_GRAPH = 'arquivos.analisar';

/**
 * O que o Regem pode pedir ao Graph (plano "recursos por produto", contrato 1.3.0): a leitura é necessária; as outras são
 * opcionais e a pessoa liga na página do Graph. As frases são as do catálogo do Graph (`permissoes.mjs` lá).
 */
export const RECURSOS_DO_GRAPH = [
  { id: PERMISSAO_DO_GRAPH, nome: 'Ler fotos, PDFs e vídeos', frase: 'Ler as fotos, os PDFs e os vídeos que os seus clientes e a sua equipe mandam, sem guardar o arquivo.', motivo: 'O atendente virtual e o Mister leem o que chega; o Graph não guarda o arquivo.', necessaria: true, pago: false },
  { id: 'audio.ouvir', nome: 'Ouvir áudios', frase: 'Ouvir os áudios que os seus clientes e a sua equipe mandam e passar para texto, sem guardar o áudio.', motivo: 'O Mister entende o áudio que você manda.', necessaria: false, pago: false },
  { id: 'audio.falar', nome: 'Falar', frase: 'Transformar um texto em voz, para responder em áudio.', motivo: 'O Mister responde em áudio quando você pede.', necessaria: false, pago: false },
  { id: 'imagens.editar', nome: 'Editar fotos', frase: 'Editar as fotos que você e a sua equipe mandam (fundo, luz, enquadramento), sem guardar a foto enviada.', motivo: 'Melhorar a foto dos produtos do cardápio.', necessaria: false, pago: true },
  { id: 'imagens.criar', nome: 'Criar imagens', frase: 'Criar imagens a partir de uma descrição.', motivo: 'A arte de um banner a partir de uma descrição.', necessaria: false, pago: true },
] as const;

/** Tudo o que o Regem pode ter: é o que o token do DMS ID pede (na chamada vale a menor entre o token e a ligação). */
export const PERMISSOES_DO_GRAPH: readonly string[] = RECURSOS_DO_GRAPH.map((r) => r.id);
export const OPCIONAIS_DO_GRAPH: readonly string[] = RECURSOS_DO_GRAPH.filter((r) => !r.necessaria).map((r) => r.id);

/** Até este dia, a ligação só com `arquivos.analisar` ainda ouve e fala (GR-11 do Graph, `LEGADO_ATE` lá). */
export const LEGADO_DO_GRAPH_ATE = '2027-03-01';

/**
 * O conjunto que vai no pedido ao Graph, que TROCA as permissões da ligação pelo que veio. Sem ligação viva: tudo o que o
 * Regem pode ter (as opcionais chegam desligadas na página). Com ligação: o que ela já tem mais o que a pessoa pediu agora.
 * Pedir o que não existe ou o que já está liberado é recusado.
 */
export function escopoDoPedido(atuais: readonly string[] | null, pedir: unknown): { escopo: string[] } | { erro: string } {
  const lista = pedir === undefined || pedir === null ? [] : pedir;
  if (!Array.isArray(lista) || lista.some((id) => typeof id !== 'string' || !OPCIONAIS_DO_GRAPH.includes(id))) {
    return { erro: 'Escolha só os recursos que o Regem pode pedir ao DMS Graph.' };
  }
  if (!atuais) return { escopo: [...PERMISSOES_DO_GRAPH] };
  if (lista.some((id) => atuais.includes(id))) return { erro: 'Esse recurso já está liberado. Atualize a tela e confira.' };
  const alvo = new Set<string>([PERMISSAO_DO_GRAPH, ...atuais, ...(lista as string[])]);
  return { escopo: PERMISSOES_DO_GRAPH.filter((id) => alvo.has(id)) };
}

/** A ferramenta da porta (contrato do Graph, G3). */
export const FERRAMENTA = 'analisar_arquivo';
/** A ferramenta que transcreve o áudio (contrato 1.1.0 do Graph; o Mister, versão 5, M5b). */
export const FERRAMENTA_OUVIR = 'ouvir_audio';
/** A ferramenta que transforma o texto em nota de voz (contrato 1.2.0 do Graph; o Mister, versão 5, M5c). */
export const FERRAMENTA_FALAR = 'falar';

/** O que a porta do Graph aceita de imagem (o GIF que a IA da empresa lê não vai ao Graph: segue pela IA). */
export const MIMES_DO_GRAPH = ['image/jpeg', 'image/png', 'image/webp'] as const;

const FORMATO_DO_CODIGO = /^gph_ac_[A-Za-z0-9_-]{43}$/;
const FORMATO_DO_NUMERO = /^urn:ietf:params:oauth:request_uri:gph_[A-Za-z0-9_-]{43}$/;
const ID_DE_APLICATIVO = /^[A-Za-z0-9_-]{4,64}$/;

export const codigoValido = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_CODIGO.test(v);
export const numeroValido = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_NUMERO.test(v);

/** O segredo que a troca devolve: `dms_lg_graph_…`, com os dígitos de conferência do pacote comum. */
export function segredoValido(v: unknown): v is string {
  const l = lerChave(v);
  return !!l && l.tipo === 'lg' && l.produto === 'graph';
}

export type ConfigGraph = {
  /** `GRAPH_LIGADO=true` com a credencial completa: o clique e a leitura pelo Graph valem. Falso: tudo como hoje. */
  ligado: boolean;
  /** A credencial do aplicativo do Regem no DMS ID e o endereço do Graph estão bons. */
  credencialOk: boolean;
  motivo: string | null;
  endereco: string;
  recurso: string;
  /** A origem do Graph: o `iss` que a volta traz (RFC 9207) e a base das rotas do clique. */
  origem: string;
  emissor: string;
  aplicativo: string;
  segredo: string;
};

const semBarra = (v?: string) => (v ?? '').trim().replace(/\/+$/, '');
const LOCAIS = ['localhost', '127.0.0.1'];

/**
 * Lê a configuração do ambiente. Nunca lança: o que falta vira `motivo` (o log diz; a tela só sabe "pronto" ou não).
 * O endereço do Graph é da DISTRIBUIÇÃO (variável do `regem-api`), nunca da loja: só https, terminando em `/mcp`; a
 * máquina local (http) só fora de produção, e em produção nada de nome local nem IP interno escrito no endereço (V68).
 */
export function lerConfigGraph(env: Record<string, string | undefined> = process.env): ConfigGraph {
  const endereco = semBarra(env.GRAPH_MCP_URL) || ENDERECO_PADRAO;
  const producao = env.NODE_ENV === 'production';
  let motivo: string | null = null;
  let origem = '';
  try {
    const u = new URL(endereco);
    const local = LOCAIS.includes(u.hostname);
    const ipInterno = /^[0-9.]+$/.test(u.hostname) || u.hostname.startsWith('[') ? ipPrivadoOuLocal(u.hostname.replace(/^\[|\]$/g, '')) : false;
    if (u.username || u.password || u.search || u.hash) motivo = 'GRAPH_MCP_URL não pode ter usuário, senha, parâmetro nem âncora';
    else if (u.pathname !== '/mcp') motivo = 'GRAPH_MCP_URL precisa terminar em /mcp (o GRAPH_RECURSO do Graph)';
    else if (producao && (local || ipInterno)) motivo = 'GRAPH_MCP_URL aponta para a própria máquina ou para a rede interna';
    else if (u.protocol !== 'https:' && !(local && !producao && u.protocol === 'http:')) motivo = 'GRAPH_MCP_URL precisa ser https';
    origem = u.origin;
  } catch {
    motivo = 'GRAPH_MCP_URL não é um endereço';
  }
  const emissor = semBarra(env.DMS_ID_EMISSOR);
  const aplicativo = (env.HUB_APLICATIVO ?? '').trim();
  const segredo = (env.HUB_SEGREDO ?? '').trim();
  if (!motivo && !emissor) motivo = 'DMS_ID_EMISSOR não configurado';
  if (!motivo && !ID_DE_APLICATIVO.test(aplicativo)) motivo = 'HUB_APLICATIVO precisa ser o client_id do aplicativo do Regem no DMS ID';
  if (!motivo && segredo.length < 16) motivo = 'HUB_SEGREDO falta ou está curto (o segredo do aplicativo do Regem no DMS ID)';
  const credencialOk = motivo === null;
  return {
    ligado: credencialOk && env.GRAPH_LIGADO === 'true',
    credencialOk,
    motivo,
    endereco,
    recurso: endereco,
    origem,
    emissor,
    aplicativo,
    segredo,
  };
}

/** A chave de liga/desliga da distribuição, sozinha (a tela e as rotas dizem "não está ligado" sem ela). */
export const graphLigadoNoAmbiente = (env: Record<string, string | undefined> = process.env): boolean => env.GRAPH_LIGADO === 'true';

/**
 * O PILOTO (G6): `GRAPH_EMPRESAS` = os ids das empresas que veem o DMS Graph, separados por vírgula (ou espaço). Vazia =
 * todas. Um item que não é id não libera ninguém a mais: a lista torta FECHA (só quem está escrito certo entra), nunca
 * abre para todas. Lida na hora (V75), como o `GRAPH_LIGADO`.
 */
export function empresasDoPiloto(env: Record<string, string | undefined> = process.env): Set<string> | null {
  const bruto = String(env.GRAPH_EMPRESAS ?? '').trim();
  if (!bruto) return null;
  return new Set(
    bruto
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** A distribuição ligou o DMS Graph (`GRAPH_LIGADO`) E esta empresa está no piloto (`GRAPH_EMPRESAS`, vazia = todas). */
export function graphLigadoParaEmpresa(tenantId: string, env: Record<string, string | undefined> = process.env): boolean {
  if (!graphLigadoNoAmbiente(env)) return false;
  const lista = empresasDoPiloto(env);
  return lista === null || lista.has(String(tenantId ?? '').toLowerCase());
}

/** O endereço de volta do Regem — o padrão que o Graph aceita (`DMS_ID_VOLTAS` lá). V58: `||`. */
export function voltaDoGraph(env: Record<string, string | undefined> = process.env): string {
  return `${String(env.APP_URL || 'https://app.dmsregem.com').trim().replace(/\/+$/, '')}/integracoes/graph/volta`;
}

/** A página de autorização do Graph quando ele não devolve uma que sirva. */
export const paginaPadraoDoGraph = (cfg: ConfigGraph): string => `${cfg.origem}/autorizar`;

/** A frase da tela para cada volta sem ligação (a página de volta mostra; as telas esperam o protótipo). */
export function fraseDaVolta(motivo: 'access_denied' | 'nao_autorizou_mais' | 'invalid_request_uri' | 'vencido' | 'outra_sessao' | 'emissor' | 'desligado' | 'erro'): string {
  switch (motivo) {
    case 'access_denied':
      return 'Você não autorizou no DMS Graph. Nada mudou: as fotos dos clientes seguem pela IA da empresa. Se quiser ligar, comece de novo.';
    case 'nao_autorizou_mais':
      return 'Você não autorizou no DMS Graph. Nada mudou: o Regem continua com o que já estava liberado.';
    case 'invalid_request_uri':
    case 'vencido':
      return 'O pedido venceu: a página do DMS Graph ficou aberta mais de 10 minutos. Comece de novo; nada foi ligado.';
    case 'outra_sessao':
      return 'Este retorno não é de um pedido aberto por você nesta conta. Por segurança, comece de novo por aqui.';
    case 'emissor':
      return 'A volta não veio do DMS Graph. Nada foi ligado. Comece de novo.';
    case 'desligado':
      return 'O DMS Graph não está ligado no Regem agora. Nada foi ligado.';
    default:
      return 'Não foi possível concluir a ligação com o DMS Graph agora. Tente de novo em alguns minutos; se continuar, avise o suporte.';
  }
}

// ───────────────────────────── a foto ─────────────────────────────

/** O tipo do arquivo que vai ao Graph, ou null (o Graph não aceita: a foto segue pela IA da empresa). `aceitos` = os tipos
 *  daquele uso: o atendente manda só imagem (o padrão); o Mister (M5a) também o PDF que a pessoa manda. */
export function mimeDoGraph(mime: unknown, aceitos: readonly string[] = MIMES_DO_GRAPH): string | null {
  const m = String(mime ?? '').split(';')[0].trim().toLowerCase();
  const normal = m === 'image/jpg' ? 'image/jpeg' : m;
  return aceitos.includes(normal) ? normal : null;
}

/** O começo da chave de idempotência da foto do cliente (o atendente). O Mister usa o dele (M5a). */
export const PREFIXO_DA_CHAVE_DA_FOTO = 'regem-graph-foto';

/**
 * A chave de idempotência da foto (G-5): a MESMA mensagem do WhatsApp dá sempre a mesma chave — a repetição (o mesmo
 * aviso entregue duas vezes, o processo que caiu no meio) recebe do Graph o resultado guardado, sem gastar a franquia de
 * novo. Sem o id da mensagem (não deveria acontecer), a chave sai do resumo dos bytes: a mesma foto do mesmo cliente.
 * `prefixo` separa os usos (a foto do cliente × a foto que a equipe manda ao Mister): nunca dividem o resultado guardado.
 */
export function chaveDaFoto(tenantId: string, mensagemId: unknown, bytes: Buffer, prefixo: string = PREFIXO_DA_CHAVE_DA_FOTO): string {
  const id = typeof mensagemId === 'string' ? mensagemId.trim() : '';
  if (id && id.length <= 200) return montarChaveIdempotencia(prefixo, tenantId, id);
  return montarChaveIdempotencia(prefixo, tenantId, 'bytes', createHash('sha256').update(bytes).digest('hex'));
}

export type Franquia = { mes: string; usados: number; total: number };

/** A franquia que veio na resposta (ou na recusa da franquia esgotada), conferida — ou null. */
export function franquiaDe(v: unknown): Franquia | null {
  if (!v || typeof v !== 'object') return null;
  const f = v as Record<string, unknown>;
  const inteiro = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (typeof f.mes !== 'string' || !/^\d{4}-\d{2}$/.test(f.mes) || !inteiro(f.usados) || !inteiro(f.total)) return null;
  return { mes: f.mes, usados: f.usados as number, total: f.total as number };
}

// A tradução do resultado do Graph para a análise de hoje. O Graph devolve `{ tipoArquivo, resultados: [documentos] }`,
// cada documento com `tipo` (um nome livre, "Captura de tela", "Comprovante de transferência Pix", "Fotografia"),
// `titulo`, `contexto` (o resumo do que a imagem mostra), `secoes` (com `texto`: avisos e observações) e `transcricao`.
// O tipo do Regem sai do nome do tipo e do título (o mais confiável); só sem conclusão, do contexto. A transcrição nunca
// classifica (a tela do Pix diz "envie o comprovante" e não é comprovante) e só entra com as linhas de AVISO de uma tela.
// O Pix decodificado, a linha digitável e os campos nunca passam: só a descrição em texto, sem dado pessoal.

/** Minúsculas e sem acento, para as palavras-chave. */
const normal = (t: unknown): string => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const DE_COMPROVANTE = /\b(comprovante|recibo)\b/;
const DE_PAGAMENTO = /\b(pagamento|pago|paga|pix|transferencia|ted|doc|deposito|cartao|boleto|debito|credito)\b/;
const PAGAMENTO_FEITO = /\b(pix|transferencia|pagamento|deposito)\s+(enviad|realizad|efetuad|aprovad|confirmad|concluid|recebid)/;
const DE_TELA =
  /\b(captura de tela|capturas de tela|print|screenshot|tela|interface|aplicativo|app|site|navegador|carrinho|checkout|mensagem de erro|cardapio (digital|online|virtual))\b/;
const DE_PEDIDO =
  /\b(comida|alimento|alimentos|lanche|lanches|hamburguer|hamburgueres|burger|pizza|batata|batatas|fritas|refrigerante|bebida|bebidas|suco|sanduiche|prato|refeicao|embalagem|embalagens|sacola|marmita|marmitex|pedido|delivery|acai|sobremesa|porcao|salgado|salgados|pastel|esfiha|sushi|frango|carne|pao|queijo|bacon|molho)\b/;
const DE_AVISO =
  /\b(erro|nao foi possivel|nao e possivel|indisponivel|invalid|falha|falhou|tente novamente|atencao|aviso|minimo|fechad|fora da area|nao entregamos|esgotad|obrigatori|recusad|expirad|vencid|pendente)/;

function classificar(texto: string): TipoDaFoto {
  const t = normal(texto);
  if ((DE_COMPROVANTE.test(t) && DE_PAGAMENTO.test(t)) || PAGAMENTO_FEITO.test(t)) return 'comprovante';
  if (DE_TELA.test(t)) return 'tela_do_cardapio';
  if (DE_PEDIDO.test(t)) return 'pedido_recebido';
  return 'outro';
}

const textoDe = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** O tipo de um documento do Graph: pelo nome do tipo e o título; sem conclusão, pelo contexto. */
export function tipoDoDocumento(doc: Record<string, unknown>): TipoDaFoto {
  const pelaCapa = classificar(`${textoDe(doc.tipo)} ${textoDe(doc.titulo)}`);
  return pelaCapa !== 'outro' ? pelaCapa : classificar(textoDe(doc.contexto));
}

/**
 * Tira o dado pessoal que o resumo ou a transcrição possam trazer: e-mail e sequência de 9 dígitos ou mais (telefone, CPF,
 * CNPJ, conta, cartão, CEP com o número). Preço, hora, data e número de pedido curto ficam.
 */
export function semDadoPessoal(texto: string): string {
  return texto
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '(e-mail omitido)')
    .replace(/\+?[0-9][0-9 .()/-]{6,}[0-9]/g, (trecho) => (trecho.replace(/[^0-9]/g, '').length >= 9 ? '(número omitido)' : trecho));
}

/** As linhas de aviso de uma tela (erro, indisponível, mínimo…): das seções e da transcrição, sem repetir, até 3. */
function avisosDaTela(doc: Record<string, unknown>): string[] {
  const linhas: string[] = [];
  const secoes = Array.isArray(doc.secoes) ? (doc.secoes as unknown[]) : [];
  for (const s of secoes) if (s && typeof s === 'object') linhas.push(...textoDe((s as Record<string, unknown>).texto).split(/\r?\n/));
  linhas.push(...textoDe(doc.transcricao).split(/\r?\n/));
  const vistos = new Set<string>();
  const avisos: string[] = [];
  for (const cru of linhas) {
    const l = cru.replace(/\s+/g, ' ').trim();
    const chave = normal(l);
    if (l.length < 4 || vistos.has(chave) || !DE_AVISO.test(chave)) continue;
    vistos.add(chave);
    avisos.push(l.slice(0, 150));
    if (avisos.length >= 3) break;
  }
  return avisos;
}

/**
 * O resultado do Graph (`structuredContent` da `analisar_arquivo`) → a análise que o atendente usa hoje, ou null (fora do
 * formato: a foto segue pela IA da empresa). Lista vazia = o Graph não achou nada analisável: "imagem ilegível", como a
 * regra da IA da empresa. Qualquer documento que seja comprovante faz da foto um comprovante (o caminho do comprovante);
 * senão vale o primeiro.
 */
export function analiseDoGraph(dados: unknown): AnaliseDaFoto | null {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return null;
  const d = dados as Record<string, unknown>;
  if (!Array.isArray(d.resultados)) return null;
  const docs = (d.resultados as unknown[]).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
  if (!docs.length) return { tipo: 'outro', descricao: 'imagem ilegível' };
  const tipos = docs.map(tipoDoDocumento);
  if (tipos.includes('comprovante')) return { tipo: 'comprovante', descricao: 'comprovante de pagamento' };
  const doc = docs[0];
  const tipo = tipos[0];
  const base = textoDe(doc.contexto) || textoDe(doc.titulo) || textoDe(doc.tipo);
  const avisos = tipo === 'tela_do_cardapio' ? avisosDaTela(doc) : [];
  const partes = [base, avisos.length ? `Na tela: ${avisos.map((a) => `"${a}"`).join(' / ')}` : ''].filter(Boolean);
  const descricao = limparDescricao(semDadoPessoal(partes.join(' ')));
  return { tipo, descricao: descricao || 'imagem ilegível' };
}

/** O motivo curto de não ter lido pelo Graph (vai à `ultima_leitura_resultado` e ao registro; nunca o conteúdo). */
export function motivoDaFalha(e: unknown): string {
  if (!(e instanceof ErroMcp)) return 'erro';
  if (e.tipo === 'ferramenta') {
    const dados = e.dados && typeof e.dados === 'object' ? (e.dados as Record<string, unknown>) : {};
    const codigo = String(dados.codigo ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
    const limite = String(dados.limite ?? '');
    if (codigo === 'limite-de-chamadas' && limite === 'franquia_mensal') return 'franquia-esgotada';
    return `recusada:${codigo || 'sem-codigo'}`;
  }
  if (e.tipo === 'indisponivel' && e.problema === 'integracao-parada') return 'integracao-parada';
  return e.tipo;
}

/**
 * Versão 7, V7d: o motivo de quando o Graph recusou um argumento opcional novo (`estilo`, `lerTom`). O Graph de antes do
 * contrato 1.7.0 recusa o que não conhece ANTES de reservar a franquia: quem chamou repete sem o argumento.
 */
export const MOTIVO_ARGUMENTO_RECUSADO = 'argumento-recusado';

/** A recusa é de argumento (`parametro-invalido`)? Nunca lê a frase: só o código estruturado da porta. */
export function recusouArgumento(e: unknown): boolean {
  if (!(e instanceof ErroMcp) || e.tipo !== 'ferramenta') return false;
  const dados = e.dados && typeof e.dados === 'object' ? (e.dados as Record<string, unknown>) : {};
  return dados.codigo === 'parametro-invalido';
}

// ───────────────────────────── a imagem (editar_imagem e criar_imagem, contrato 1.4.0) ─────────────────────────────

export const FERRAMENTA_EDITAR_IMAGEM = 'editar_imagem';
export const FERRAMENTA_CRIAR_IMAGEM = 'criar_imagem';
/** Contrato 1.5.0: o GIF a partir de uma imagem pronta, sem IA e sem franquia; a permissão é a de editar. */
export const FERRAMENTA_ANIMAR_IMAGEM = 'animar_imagem';

export type MotivoDaImagem =
  | 'desligado'
  | 'sem-ligacao'
  | 'sem-permissao'
  | 'sem-franquia'
  | 'franquia-esgotada'
  | 'recusada'
  | 'pedido-invalido'
  | 'ocupado'
  | 'indisponivel'
  | 'demora'
  | 'ligacao-desfeita'
  | 'fora-do-formato'
  | 'erro';

/** Por que a imagem não veio, em poucas palavras para o código de quem chama. Nunca o conteúdo. */
export function motivoDaImagem(e: unknown): MotivoDaImagem {
  if (!(e instanceof ErroMcp)) return 'erro';
  if (e.tipo === 'ligacao') return 'ligacao-desfeita';
  if (e.tipo === 'permissao') return 'sem-permissao';
  if (e.tipo === 'limite') return 'ocupado';
  if (e.tipo === 'indisponivel') return 'indisponivel';
  if (e.tipo === 'sem-resposta') return 'demora';
  if (e.tipo !== 'ferramenta') return 'erro';
  const d = e.dados && typeof e.dados === 'object' ? (e.dados as Record<string, unknown>) : {};
  if (d.codigo === 'limite-de-chamadas') {
    if (d.limite !== 'franquia_imagem') return 'ocupado';
    return franquiaDe(d.franquia)?.total === 0 ? 'sem-franquia' : 'franquia-esgotada';
  }
  if (d.codigo === 'regra-invalida') return 'recusada';
  if (d.codigo === 'parametro-invalido') return 'pedido-invalido';
  if (d.codigo === 'integracao-parada') return 'indisponivel';
  return 'erro';
}

/** A frase do GIF: o que muda em relação à imagem é que aqui o Google não entra. */
export function fraseDoGif(motivo: MotivoDaImagem): string {
  if (motivo === 'recusada') return 'Esta imagem tem detalhe demais para um GIF de até 1 MB. Use a imagem parada.';
  if (motivo === 'pedido-invalido') return 'Não deu para animar esta imagem. Use a imagem parada ou crie outra.';
  if (motivo === 'ocupado') return 'Muitos GIFs ao mesmo tempo. Tente de novo em alguns segundos.';
  if (motivo === 'demora') return 'O GIF demorou além do prazo. Tente de novo.';
  if (motivo === 'erro' || motivo === 'fora-do-formato') return 'O GIF não ficou pronto agora. Tente de novo em instantes.';
  return fraseDaImagem(motivo);
}

/** A frase para a pessoa, por motivo. */
export function fraseDaImagem(motivo: MotivoDaImagem): string {
  switch (motivo) {
    case 'desligado':
    case 'sem-ligacao':
    case 'ligacao-desfeita':
      return 'O DMS Graph não está ligado nesta empresa. O presidente liga em Delivery › Configurações › Integrações.';
    case 'sem-permissao':
      return 'Este recurso ainda não foi liberado. O presidente pede em Delivery › Configurações › Integrações › DMS Graph.';
    case 'sem-franquia':
      return 'A empresa ainda não tem franquia de imagem. Fale com a DMS para liberar.';
    case 'franquia-esgotada':
      return 'A franquia de imagem deste mês acabou. Ela volta no dia 1º.';
    case 'recusada':
      return 'O Google não gerou a imagem. Use só fotos suas ou dos seus produtos, ou mude o pedido.';
    case 'pedido-invalido':
      return 'O pedido da imagem não está certo. Confira a foto e o texto.';
    case 'ocupado':
      return 'Muitas imagens ao mesmo tempo. Tente de novo em alguns segundos.';
    case 'demora':
      return 'A imagem demorou além do prazo. Tente de novo.';
    default:
      return 'A criação de imagem não respondeu agora. Tente de novo em instantes.';
  }
}
