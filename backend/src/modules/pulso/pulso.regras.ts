import { createHash } from 'node:crypto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O REGEM LÊ O PULSO (F7 parte 4 do docs/plano-perfil-cliente.md; D12 — a base nacional de eventos é produto do Hub DMS,
// https://pulso.dmstecnologias.com, contrato 1.0.0). Regras puras (testáveis sem banco nem rede):
//  • NASCE DESLIGADO: só com a ligação do Pulso na variável `PULSO_LIGACAO` (o segredo `dms_lg_pulso_…` que o Pulso cria;
//    o dono põe no regem-api) e a credencial do aplicativo do Regem no DMS ID (as mesmas do DMS Graph);
//  • o Pulso não recebe NADA de cliente, de loja ou de empresa: só a lista somada dos municípios (código IBGE) e o ramo;
//  • as respostas são lidas sem confiar: o que vem torto fica de fora (nunca derruba a rotina).

export const ENDERECO_PADRAO = 'https://pulso.dmstecnologias.com/v1';
export const PERMISSOES_DO_PULSO: readonly string[] = ['eventos.ler'];
export const RAMO_DO_REGEM = 'bares_restaurantes';
/** O clima vai até 16 dias (o Pulso recusa mais). */
export const DIAS_DE_CLIMA = 16;
/** Páginas por volta da leitura incremental (500 eventos cada). */
export const PAGINAS_POR_VOLTA = 20;
export const LIMITE_POR_PAGINA = 500;
/** O Pulso aceita até 500 municípios por aplicativo. */
export const MAXIMO_DE_MUNICIPIOS = 500;
/** A porta aceita 120 leituras por minuto: com mais de 100 municípios, a rotina do clima vai no ritmo (100 por minuto). */
export const pausaEntreMunicipios = (quantos: number): number => (quantos > 100 ? 600 : 0);

const ID_DE_APLICATIVO = /^[a-z0-9]{8,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO_IBGE = /^[1-5][0-9]{6}$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const semBarra = (v?: string) => (v ?? '').trim().replace(/\/+$/, '');

/** A ligação do Pulso: `dms_lg_pulso_<43>_<6 de conferência>` (o mesmo formato e os mesmos dígitos do pacote comum). */
export function ligacaoDoPulsoValida(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 120) return false;
  const m = /^dms_lg_pulso_([A-Za-z0-9_-]{43})_([A-Za-z0-9_-]{6})$/.exec(v);
  if (!m) return false;
  return createHash('sha256').update(m[1], 'utf8').digest('base64url').slice(0, 6) === m[2];
}

export type ConfigPulso = {
  /** Ligado: a ligação válida e a credencial do aplicativo completa. Desligado: nenhuma rotina chama o Pulso. */
  ligado: boolean;
  /** Por que está desligado (para o log; nunca o segredo). */
  motivo: string | null;
  base: string;
  recurso: string;
  emissor: string;
  aplicativo: string;
  segredo: string;
  ligacao: string;
};

/** Lê a configuração do ambiente. Nunca lança: o que falta vira `motivo`. Só https (a máquina local, fora de produção). */
export function lerConfigPulso(env: Record<string, string | undefined> = process.env): ConfigPulso {
  const base = semBarra(env.PULSO_URL) || ENDERECO_PADRAO;
  const ligacao = (env.PULSO_LIGACAO ?? '').trim();
  const emissor = semBarra(env.DMS_ID_EMISSOR);
  const aplicativo = (env.HUB_APLICATIVO ?? '').trim();
  const segredo = (env.HUB_SEGREDO ?? '').trim();
  let motivo: string | null = null;
  try {
    const u = new URL(base);
    const local = ['localhost', '127.0.0.1'].includes(u.hostname);
    if (u.username || u.password || u.search || u.hash) motivo = 'PULSO_URL não pode ter usuário, senha, parâmetro nem âncora';
    else if (!u.pathname.endsWith('/v1')) motivo = 'PULSO_URL precisa terminar em /v1 (o recurso do Pulso no DMS ID)';
    else if (u.protocol !== 'https:' && !(local && env.NODE_ENV !== 'production' && u.protocol === 'http:')) motivo = 'PULSO_URL precisa ser https';
  } catch {
    motivo = 'PULSO_URL não é um endereço';
  }
  if (!motivo && !ligacao) motivo = 'PULSO_LIGACAO não configurada (desligado)';
  if (!motivo && !ligacaoDoPulsoValida(ligacao)) motivo = 'PULSO_LIGACAO não é uma ligação do Pulso (dms_lg_pulso_…)';
  if (!motivo && !emissor) motivo = 'DMS_ID_EMISSOR não configurado';
  if (!motivo && !ID_DE_APLICATIVO.test(aplicativo)) motivo = 'HUB_APLICATIVO precisa ser o client_id do aplicativo do Regem no DMS ID';
  if (!motivo && segredo.length < 16) motivo = 'HUB_SEGREDO falta ou está curto';
  return { ligado: motivo === null, motivo, base, recurso: base, emissor, aplicativo, segredo, ligacao };
}

export type EventoDoPulso = {
  id: string;
  chave: string;
  tipo: string;
  nome: string | null;
  dia_inteiro: boolean;
  inicio: string | null;
  fim: string | null;
  fuso: string | null;
  janela: any;
  abrangencia: any;
  situacao: string;
  detalhes: any;
  versao: number;
  fonte: any;
  credito: string | null;
};

const texto = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const objeto = (v: unknown): any => (v && typeof v === 'object' ? v : null);

/**
 * Lê a página de `GET /v1/eventos/mudancas`. O evento retirado (inclusive o de fonte que não pode ser redistribuída, que
 * vem só com id, chave, situação e versão) entra como retirado. O que vem sem id, chave ou versão fica de fora.
 */
export function lerMudancas(corpo: unknown): { eventos: EventoDoPulso[]; proximaVersao: number | null; temMais: boolean } {
  const c = objeto(corpo);
  const proxima = Number(c?.proxima_versao);
  const eventos: EventoDoPulso[] = [];
  for (const e of Array.isArray(c?.eventos) ? c.eventos : []) {
    const versao = Number(e?.versao);
    const chave = texto(e?.chave, 200);
    if (typeof e?.id !== 'string' || !UUID.test(e.id) || !chave || !Number.isSafeInteger(versao) || versao < 0) continue;
    const retirado = e?.situacao === 'retirado';
    eventos.push({
      id: e.id.toLowerCase(),
      chave,
      tipo: texto(e?.tipo, 60) ?? (retirado ? 'retirado' : 'desconhecido'),
      nome: texto(e?.nome, 200),
      dia_inteiro: e?.dia_inteiro !== false,
      inicio: texto(e?.inicio, 40),
      fim: texto(e?.fim, 40),
      fuso: texto(e?.fuso, 60),
      janela: objeto(e?.janela),
      abrangencia: Array.isArray(e?.abrangencia) ? e.abrangencia : null,
      situacao: texto(e?.situacao, 30) ?? 'ativo',
      detalhes: objeto(e?.detalhes),
      versao,
      fonte: objeto(e?.fonte),
      credito: texto(e?.credito, 300),
    });
  }
  return {
    eventos,
    proximaVersao: Number.isSafeInteger(proxima) && proxima >= 0 ? proxima : null,
    temMais: c?.tem_mais === true,
  };
}

export type ClimaDoDia = { dia: string; chuvaPrevista: boolean | null; inmet: any; cptec: any };

/** Lê `GET /v1/clima`: um item por dia (a chuva prevista de qualquer fonte e o dado de cada uma). */
export function lerClima(corpo: unknown): ClimaDoDia[] {
  const c = objeto(corpo);
  const out: ClimaDoDia[] = [];
  for (const d of Array.isArray(c?.dias) ? c.dias : []) {
    if (typeof d?.dia !== 'string' || !DIA.test(d.dia)) continue;
    out.push({
      dia: d.dia,
      chuvaPrevista: typeof d?.chuva_prevista === 'boolean' ? d.chuva_prevista : null,
      inmet: objeto(d?.inmet),
      cptec: objeto(d?.cptec),
    });
  }
  return out;
}

/** O corpo do `PUT /v1/interesses`: a lista SOMADA e sem repetição de todas as lojas (o PUT substitui o conjunto), em ordem. */
export function corpoDosInteresses(municipios: unknown[]): { municipios: string[]; temas: string[]; ramos: string[] } {
  const lista = [...new Set(municipios.map((m) => String(m ?? '').trim()).filter((m) => CODIGO_IBGE.test(m)))].sort();
  return { municipios: lista.slice(0, MAXIMO_DE_MUNICIPIOS), temas: [], ramos: [RAMO_DO_REGEM] };
}

/** O resumo do que foi mandado (para não repetir o mesmo PUT todo dia). */
export const resumoDosInteresses = (corpo: { municipios: string[]; temas: string[]; ramos: string[] }): string =>
  createHash('sha256').update(JSON.stringify(corpo), 'utf8').digest('hex');

export const codigoIbgeValido = (v: unknown): boolean => CODIGO_IBGE.test(String(v ?? ''));

// ── NOTÍCIAS DO RAMO (fase N1; protótipo `mockups/regem-noticias-do-ramo.html`) ─────────────────────────────────────────

/** O ramo da empresa que tem boletim: o Pulso só publica o de bares e restaurantes (decisão N3). */
export const RAMO_DA_EMPRESA_COM_BOLETIM = 'food_service';
/** Quantos dias a cópia do boletim fica guardada (decisão N4). */
export const DIAS_DE_BOLETIM = 90;
/** Cada volta confere hoje e os 2 dias anteriores: a notícia tirada no Pulso some também da cópia de ontem. */
export const DIAS_DO_BOLETIM_RECONFERIDOS = 3;
const MAX_DESTAQUES = 5;
const MAX_NOVIDADES = 3;
const MAX_NA_LISTA = 20;

export type NoticiaDoBoletim = {
  id: string;
  titulo: string;
  link: string;
  categoria: string;
  categoriaNome: string;
  publicadoEm: string;
  emDiscussao: boolean;
  aviso: string | null;
  credito: string;
};
export type IndicadorDoBoletim = {
  id: string;
  nome: string;
  valor: number;
  unidade: string;
  referencia: string;
  acumulado12Meses: number | null;
  mudou: boolean;
  credito: string;
};
export type BoletimDoRamo = {
  dia: string;
  mensagem: string | null;
  indicadores: IndicadorDoBoletim[];
  destaques: NoticiaDoBoletim[];
  novidades: NoticiaDoBoletim[];
  mais: NoticiaDoBoletim[];
};

/**
 * Só link https vai para a tela: `javascript:` e afins ficam de fora, mesmo vindo de uma fonte conhecida. O Mister confere
 * de novo antes de mandar a matéria (`mister-abrir.ts`).
 */
export function linkSeguro(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2000) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

function lerNoticia(n: any): NoticiaDoBoletim | null {
  const id = typeof n?.id === 'string' || typeof n?.id === 'number' ? String(n.id).slice(0, 40) : null;
  const titulo = texto(n?.titulo, 500);
  const link = linkSeguro(n?.link);
  const categoria = texto(n?.categoria, 40);
  const quando = typeof n?.publicado_em === 'string' ? Date.parse(n.publicado_em) : NaN;
  // A licença das fontes pede o crédito: notícia sem crédito não se repassa.
  const credito = texto(n?.fonte?.credito, 200) ?? texto(n?.fonte?.nome, 200);
  if (!id || !titulo || !link || !categoria || !Number.isFinite(quando) || !credito) return null;
  const emDiscussao = n?.em_discussao === true;
  return {
    id,
    titulo,
    link,
    categoria,
    categoriaNome: texto(n?.categoria_nome, 80) ?? categoria,
    publicadoEm: new Date(quando).toISOString(),
    emDiscussao,
    // O que está no Congresso nunca sai sem o aviso, mesmo se a porta não mandar a frase.
    aviso: texto(n?.aviso, 200) ?? (emDiscussao ? 'Em discussão no Congresso: ainda não é lei.' : null),
    credito,
  };
}

function lerIndicador(i: any): IndicadorDoBoletim | null {
  const id = texto(i?.id, 60);
  const nome = texto(i?.nome, 120);
  const valor = typeof i?.valor === 'number' ? i.valor : Number.NaN;
  const unidade = texto(i?.unidade, 40);
  const referencia = texto(i?.referencia, 20);
  const credito = texto(i?.fonte?.credito, 200) ?? texto(i?.fonte?.nome, 200);
  if (!id || !nome || !Number.isFinite(valor) || !unidade || !referencia || !credito) return null;
  const doze = i?.detalhes?.acumulado_12_meses;
  return { id, nome, valor, unidade, referencia, acumulado12Meses: typeof doze === 'number' && Number.isFinite(doze) ? doze : null, mudou: i?.mudou === true, credito };
}

const listaDeNoticias = (v: unknown, max: number): NoticiaDoBoletim[] =>
  (Array.isArray(v) ? v : []).map(lerNoticia).filter((n): n is NoticiaDoBoletim => n !== null).slice(0, max);

/** Lê `GET /v1/ramo/boletim` sem confiar: o item torto fica de fora; sem o dia, não há boletim. */
export function lerBoletimDaPorta(corpo: unknown): BoletimDoRamo | null {
  const c = objeto(corpo);
  if (typeof c?.dia !== 'string' || !DIA.test(c.dia)) return null;
  const destaques = listaDeNoticias(c.destaques, MAX_DESTAQUES);
  const novidades = listaDeNoticias(c.novidades, MAX_NOVIDADES);
  return {
    dia: c.dia,
    // Com notícia na tela, a frase de "nada importante" não vale, mesmo se a porta mandar.
    mensagem: destaques.length || novidades.length ? null : texto(c.mensagem, 200),
    indicadores: (Array.isArray(c.indicadores) ? c.indicadores : []).map(lerIndicador).filter((i: IndicadorDoBoletim | null): i is IndicadorDoBoletim => i !== null).slice(0, 10),
    destaques,
    novidades,
    mais: listaDeNoticias(c.mais, MAX_NA_LISTA),
  };
}
