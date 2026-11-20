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
