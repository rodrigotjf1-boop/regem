// iFOOD PELO ORZUNI — as regras puras do lado do Regem (R2a; mig 370). O Regem CONSOME a porta MCP do Orzuni (produto
// DMS que gerencia o cardápio do iFood), pelo `ClienteMcp` do pacote comum, com o token do DMS ID do PRÓPRIO
// aplicativo do Regem (o mesmo do hub: `DMS_ID_EMISSOR`, `HUB_APLICATIVO`, `HUB_SEGREDO`) e o segredo da ligação da
// loja no cabeçalho `DMS-Ligacao`. Contrato da porta: `docs/porta-mcp.md` do Orzuni.
//
// Tudo DESLIGADO por padrão, em três chaves: `ORZUNI_LIGADO` (a distribuição liga no EasyPanel), o direito
// `ifood_pelo_orzuni` da empresa e a ligação viva da loja. Sem as três, nada sai.

import { ErroMcp, montarChaveIdempotencia } from '../../dms/integracao-dms';

/** A porta MCP do Orzuni em produção (o recurso no DMS ID é o mesmo endereço). */
export const ENDERECO_PADRAO = 'https://api.orzuni.com/v1/mcp';

/** O que o token pede. A porta ainda confere a ligação: vale a menor das duas. */
export const PERMISSOES_ORZUNI: readonly string[] = ['catalogo.ler', 'preco.escrever', 'status.escrever'];

/** A chave da conta da loja no Orzuni, como ele a emite (`ligacao.service.ts` do Orzuni). */
export const CHAVE_ORZUNI = /^orz_live_[0-9a-f]{32,}$/;

/** O segredo que a troca devolve (o pacote: `dms_lg_<produto>_…`). */
export const SEGREDO_LIGACAO = /^dms_lg_orzuni_[A-Za-z0-9_-]{16,}$/;

/** A versão do servidor da loja que já tem a mig 369 (as colunas do iFood): abaixo dela o direito não liga. */
export const VERSAO_MINIMA_DA_LOJA = '1.30.13';

/** Desiste de um envio que falha (porta fora, iFood fora) depois de tanto tempo da mudança. */
export const DESISTIR_DEPOIS_HORAS = 24;

/** Reserva de um envio em andamento: se o processo morrer no meio, ele volta à fila sozinho. */
export const RESERVA_MINUTOS = 2;

export type ConfigOrzuni = {
  /** `ORZUNI_LIGADO=true`: o despacho manda. Falso: a fila espera (nada se perde). */
  envioLigado: boolean;
  /** A credencial do aplicativo no DMS ID está completa (sem ela, nem a troca da chave nem o envio). */
  credencialOk: boolean;
  motivo: string | null;
  endereco: string;
  recurso: string;
  urlLigacao: string;
  emissor: string;
  aplicativo: string;
  segredo: string;
};

const semBarra = (v?: string) => (v ?? '').trim().replace(/\/+$/, '');
const ID_DE_APLICATIVO = /^[A-Za-z0-9_-]{4,64}$/;

/** Lê a configuração do ambiente. Nunca lança: o que falta vira `motivo` (o console mostra; o log diz). */
export function lerConfigOrzuni(env: Record<string, string | undefined> = process.env): ConfigOrzuni {
  const endereco = semBarra(env.ORZUNI_MCP_URL) || ENDERECO_PADRAO;
  let urlLigacao = '';
  let motivo: string | null = null;
  try {
    const u = new URL(endereco);
    if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) motivo = 'ORZUNI_MCP_URL precisa ser https';
    urlLigacao = new URL('/v1/dms-id/ligacao', u.origin).href;
  } catch {
    motivo = 'ORZUNI_MCP_URL não é um endereço';
  }
  const emissor = semBarra(env.DMS_ID_EMISSOR);
  const aplicativo = (env.HUB_APLICATIVO ?? '').trim();
  const segredo = (env.HUB_SEGREDO ?? '').trim();
  if (!motivo && !emissor) motivo = 'DMS_ID_EMISSOR não configurado';
  if (!motivo && !ID_DE_APLICATIVO.test(aplicativo)) motivo = 'HUB_APLICATIVO precisa ser o client_id do aplicativo do Regem no DMS ID';
  if (!motivo && segredo.length < 16) motivo = 'HUB_SEGREDO falta ou está curto (o segredo do aplicativo do Regem no DMS ID)';
  const credencialOk = motivo === null;
  return {
    envioLigado: credencialOk && env.ORZUNI_LIGADO === 'true',
    credencialOk,
    motivo,
    endereco,
    recurso: endereco,
    urlLigacao,
    emissor,
    aplicativo,
    segredo,
  };
}

/** Espera antes da próxima tentativa (em minutos), pela quantidade de tentativas já feitas. */
export function recuoMinutos(tentativas: number): number {
  const passos = [1, 2, 5, 10, 30];
  return passos[Math.max(0, tentativas - 1)] ?? 60;
}

/**
 * A chave de idempotência de um envio: a linha da fila e a VERSÃO dela. A mesma tentativa repetida leva a mesma chave
 * (a porta não grava de novo); uma mudança nova sobe a versão — 30 → 35 → 30 são três envios, nunca uma chave
 * reaproveitada (que a porta responderia com "repetido" sem mudar nada).
 */
export function chaveDoEnvio(envio: { id: string; versao: number }): string {
  return montarChaveIdempotencia('regem-orzuni', envio.id, envio.versao);
}

/** O que a porta respondeu, como o Regem guarda (`orzuni_envio.resposta`). */
export type Desfecho = {
  /** aplicado | sem_mudanca | nao_encontrado | parcial | recusado | dispensado */
  resultado: string;
  /** Tentar de novo mais tarde (a mesma chave). */
  repetir: boolean;
  resposta: Record<string, unknown>;
  erro: string | null;
};

const SITUACOES = new Set(['aplicado', 'sem_mudanca', 'nao_encontrado', 'parcial', 'recusado']);

/** Só os campos do envelope da porta que interessam (nada além do que ela devolveu, nunca o segredo). */
function doEnvelope(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['situacao', 'repetido', 'antes', 'depois', 'codigo', 'pode_repetir', 'frase']) {
    if (e[k] !== undefined) out[k] = e[k];
  }
  if (Array.isArray(e.opcoes)) out.opcoes = (e.opcoes as unknown[]).slice(0, 50);
  return out;
}

/** O resultado de uma escrita que deu certo (o `structuredContent` da porta). */
export function desfechoDoResultado(dados: unknown): Desfecho {
  const e = dados && typeof dados === 'object' && !Array.isArray(dados) ? (dados as Record<string, unknown>) : {};
  const s = String(e.situacao ?? '');
  return { resultado: SITUACOES.has(s) ? s : 'aplicado', repetir: false, resposta: doEnvelope(e), erro: null };
}

/**
 * A recusa da ferramenta (`isError`). O envelope (`codigo`, `pode_repetir`, `situacao`) vem em `ErroMcp.dados` (pacote
 * 0.10.1: o `structuredContent` da recusa); a FRASE é o texto pt-BR que o Orzuni manda para a tela (Padrão §6, O5 do
 * Orzuni) e fica guardada para o "último envio ao iFood". Sem envelope, a frase é o motivo e vale o `podeRepetir`
 * genérico do pacote. Frase que é JSON (porta antiga) não vai para a tela.
 */
export function desfechoDaRecusa(erro: ErroMcp): Desfecho {
  const d = erro.dados;
  const e: Record<string, unknown> = d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : {};
  const temEnvelope = Object.keys(e).length > 0;
  const frase = erro.frase.trim().startsWith('{') ? '' : erro.frase.trim();
  const situacao = String(e.situacao ?? '');
  return {
    resultado: situacao === 'nao_encontrado' ? 'nao_encontrado' : 'recusado',
    repetir: temEnvelope ? e.pode_repetir === true : erro.podeRepetir,
    resposta: { ...doEnvelope(e), ...(frase ? { frase } : {}) },
    erro: `${erro.ferramenta}: ${String(e.codigo ?? '') || frase || 'recusado'}`.slice(0, 300),
  };
}

/** A frase do console para cada recusa da troca da chave pela ligação (o `problema` do Orzuni). */
export function fraseDaTroca(problema: string): string {
  switch (problema) {
    case 'ligacao-invalida':
      return 'O Orzuni recusou a chave: confira se é a chave orz_live_ da conta da loja e se o aplicativo do Regem está liberado no Orzuni.';
    case 'conta-bloqueada':
      return 'A conta da loja no Orzuni não está conectada ao iFood (ou foi bloqueada). Conecte-a no Orzuni e tente de novo.';
    case 'token-invalido':
    case 'permissao-insuficiente':
      return 'O DMS ID não deu acesso do Regem ao Orzuni (confira a função "Regem no Orzuni" no aplicativo do Regem).';
    case 'nao-encontrado':
      return 'A porta de integração do Orzuni não está ligada.';
    default:
      return 'O Orzuni não aceitou a troca agora. Tente de novo em instantes.';
  }
}
