import {
  origemDoDestino,
  resultadoDoAviso,
  type AvisoRegistrado,
  type ChamadaRegistrada,
  type CredencialChamada,
  type ResultadoChamada,
} from '../../dms/integracao-dms';

// O HUB DA DMS do lado do Regem (Hub DMS, F3, parte A2): regras puras — a configuração, a chave própria e o registro de
// cada chamada no contrato do hub (`docs/console-hub.md` do hub). Um registro fora do contrato faz o hub recusar o LOTE
// inteiro (400), e o pacote joga o lote fora: por isso o que não cabe sai (campo opcional) ou é cortado, nunca vai torto.

/**
 * O hub, lido do ambiente (a distribuição configura no EasyPanel; nada disso é da loja). Nomes iguais aos do RegemCast:
 * - `HUB_LIGADO=true` liga o registro, os erros, a batida e a lista de parada;
 * - `HUB_URL` (o hub) e `HUB_RECURSO` (o identificador do recurso do hub no DMS ID, o destino do token);
 * - `DMS_ID_EMISSOR` (o mesmo da via do DMS ID) e o aplicativo do REGEM no DMS ID: `HUB_APLICATIVO` (client_id) e
 *   `HUB_SEGREDO` (o segredo, só no ambiente do servidor).
 * Configuração torta não liga o hub — e NÃO derruba a API (o Regem é balcão e delivery): o motivo vai para o log.
 */
export type ConfigHub =
  | { ligado: true; url: string; recurso: string; emissor: string; aplicativo: string; segredo: string }
  | { ligado: false; motivo: string | null };

const ID_DE_APLICATIVO = /^[A-Za-z0-9_-]{4,64}$/;

/** `https:`; `http:` só na própria máquina (testes). Sem usuário, senha, consulta nem fragmento. */
export function enderecoDeServico(texto: string): URL | null {
  let u: URL;
  try {
    u = new URL(texto);
  } catch {
    return null;
  }
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return u;
}

export function lerConfigHub(env: Record<string, string | undefined> = process.env): ConfigHub {
  if (env.HUB_LIGADO !== 'true') return { ligado: false, motivo: null };
  const desligado = (motivo: string): ConfigHub => ({ ligado: false, motivo });
  const semBarra = (v: string | undefined) => (v ?? '').trim().replace(/\/+$/, '');
  const url = semBarra(env.HUB_URL);
  const recurso = semBarra(env.HUB_RECURSO);
  const emissor = semBarra(env.DMS_ID_EMISSOR);
  for (const [nome, valor] of [['HUB_URL', url], ['HUB_RECURSO', recurso], ['DMS_ID_EMISSOR', emissor]] as const) {
    if (!enderecoDeServico(valor)) return desligado(`${nome} precisa ser um endereço https`);
  }
  const aplicativo = (env.HUB_APLICATIVO ?? '').trim();
  if (!ID_DE_APLICATIVO.test(aplicativo)) return desligado('HUB_APLICATIVO precisa ser o client_id do aplicativo do Regem no DMS ID');
  // o segredo nunca aparece na mensagem
  const segredo = (env.HUB_SEGREDO ?? '').trim();
  if (segredo.length < 16) return desligado('HUB_SEGREDO falta ou está curto (o segredo do aplicativo do Regem no DMS ID)');
  return { ligado: true, url, recurso, emissor, aplicativo, segredo };
}

/**
 * A chave própria do Padrão (§10): `ACEITAR_INTEGRACOES` diferente de `true` (e não vazia) para TODA chamada de
 * integração com 503 `integracao-parada` — vale com ou sem o hub, mesmo com o hub fora do ar ou comprometido. Na
 * dúvida ela para: quem escreve `nao`, `0` ou `false` quer parar. Ausente ou vazia: aceita.
 */
export function aceitaIntegracoes(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.ACEITAR_INTEGRACOES ?? '').trim().toLowerCase();
  return v === '' || v === 'true';
}

/** A versão no ar para a batida e os erros (`APP_VERSION`; na nuvem, quando falta, "nuvem"). */
export function versaoNoAr(env: Record<string, string | undefined> = process.env): string {
  const v = (env.APP_VERSION ?? '').trim();
  return v ? v.slice(0, 80) : 'nuvem';
}

// ───────────────────────────── o registro de cada chamada ─────────────────────────────

/** O que se anota durante a chamada (o middleware abre; o guard, o filtro e a troca anotam). */
export type ChamadaAtual = {
  /** `Date.now()` da chegada. */
  readonly inicio: number;
  credencial?: CredencialChamada;
  ligacaoPrefixo?: string;
  /** Quem chamou: o cliente da integração (`liame`, `farol`…) — o nome que a lista de parada usa. */
  aplicativo?: string;
  /** A loja (ou a empresa, no acesso da empresa inteira). */
  conta?: string;
  contaNome?: string;
  /** A empresa da conta, para achar o nome comercial. */
  tenantId?: string;
  problema?: string;
  /** O erro inesperado (5xx), que vai também à lista de erros do hub. */
  erro?: { tipo: string; mensagem: string };
};

/** O código do pedido no formato do hub (6 a 100 de letras, números e `_ . : -`), ou nulo. */
export function codigoDoHub(requestId: unknown): string | null {
  return typeof requestId === 'string' && /^[A-Za-z0-9_.:-]{6,100}$/.test(requestId) ? requestId : null;
}

/**
 * A ferramenta: o método e a rota (o caminho declarado, nunca o pedido com ids ou consulta), sem o `/api/v1`. Rota que
 * não existe vira um nome só, para a lista do hub não crescer com o que quem chama inventa.
 */
export function ferramentaDaRota(metodo: string | undefined, caminhoDaRota: unknown): string {
  const m = String(metodo ?? 'GET').toUpperCase().slice(0, 10);
  if (typeof caminhoDaRota !== 'string' || !caminhoDaRota) return `${m} (rota desconhecida)`;
  return `${m} ${caminhoDaRota.replace(/^\/api\/v1(?=\/)/, '')}`.slice(0, 120);
}

const PREFIXO_VALIDO = /^[A-Za-z0-9_-]{4,40}$/;
const PROBLEMA_VALIDO = /^[a-z][a-z0-9-]{2,40}$/;

const texto = (v: string | undefined, maximo: number): string | undefined => {
  const t = (v ?? '').trim();
  return t ? t.slice(0, maximo) : undefined;
};

/**
 * O registro da chamada, no contrato do hub. `terminou` = a resposta foi até o fim (falso: a conexão caiu antes). A
 * parada (503 `integracao-parada`) é recusa, não erro.
 */
export function montarChamada(
  c: ChamadaAtual,
  o: { codigo: string; ferramenta: string; status: number; terminou: boolean; agora: number },
): ChamadaRegistrada {
  let resultado: ResultadoChamada;
  if (!o.terminou) resultado = 'erro';
  else if (o.status >= 500 && c.problema !== 'integracao-parada') resultado = 'erro';
  else if (o.status >= 400) resultado = 'recusada';
  else resultado = 'aceita';

  const registro: ChamadaRegistrada = {
    codigo: o.codigo,
    ocorrido_em: new Date(c.inicio).toISOString(),
    credencial: c.credencial ?? 'token_integracao',
    ferramenta: texto(o.ferramenta, 120) ?? '(sem rota)',
    resultado,
  };
  const aplicativo = texto(c.aplicativo, 80);
  if (aplicativo) registro.aplicativo = aplicativo;
  if (c.ligacaoPrefixo && PREFIXO_VALIDO.test(c.ligacaoPrefixo)) registro.ligacao_prefixo = c.ligacaoPrefixo;
  const conta = texto(c.conta, 80);
  if (conta) registro.conta = conta;
  const contaNome = texto(c.contaNome, 120);
  if (contaNome) registro.conta_nome = contaNome;
  if (resultado !== 'aceita' && c.problema && PROBLEMA_VALIDO.test(c.problema)) registro.problema = c.problema;
  if (Number.isInteger(o.status) && o.status >= 100 && o.status <= 599) registro.status_http = o.status;
  registro.duracao_ms = Math.min(3_600_000, Math.max(0, Math.round(o.agora - c.inicio)));
  return registro;
}

// ───────────────────────────── o registro de cada aviso (F3, parte D) ─────────────────────────────

/** O tipo do aviso no formato do hub (minúsculas com ponto, até 60), ou nulo. */
const TIPO_VALIDO = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

/**
 * O aviso mandado, no contrato do hub (`POST /api/v1/avisos`; pacote 0.4.0): para quem, o tipo, quando, o resultado, a
 * tentativa e só a origem do destino. Nunca o conteúdo. Como na chamada, o que não cabe sai ou é cortado — o hub
 * recusaria o lote inteiro. `pausado` = o Regem parou de mandar para aquele destino (falhas seguidas ou o segredo que
 * não abre mais). `concluido: false` = o destino respondeu 2xx, mas o que o aviso pedia não aconteceu e ele sai de novo
 * (o estorno do GoGeM que falhou dentro de um 200 — V30): no hub vale "falhou", com o código que veio. O tipo fora da
 * forma vira nulo, e quem chama não registra.
 */
export function montarAviso(a: {
  codigo: string;
  inicio: number;
  agora: number;
  aplicativo: string;
  prefixo: string | null;
  conta: string | null;
  contaNome: string | null;
  tipo: string;
  url: string;
  status: number | null;
  pausado: boolean;
  tentativa: number;
  concluido?: boolean;
}): AvisoRegistrado | null {
  const codigo = codigoDoHub(a.codigo);
  const aplicativo = texto(a.aplicativo, 80);
  if (!codigo || !aplicativo || a.tipo.length > 60 || !TIPO_VALIDO.test(a.tipo)) return null;
  const status = a.status !== null && Number.isInteger(a.status) && a.status >= 100 && a.status <= 599 ? a.status : null;
  const resultado = resultadoDoAviso(status, a.pausado);
  const aviso: AvisoRegistrado = {
    codigo,
    ocorrido_em: new Date(a.inicio).toISOString(),
    aplicativo,
    tipo: a.tipo,
    resultado: resultado === 'entregue' && a.concluido === false ? 'falhou' : resultado,
    duracao_ms: Math.min(3_600_000, Math.max(0, Math.round(a.agora - a.inicio))),
    tentativa: Math.min(100_000, Math.max(1, Math.trunc(a.tentativa) || 1)),
  };
  if (a.prefixo && PREFIXO_VALIDO.test(a.prefixo)) aviso.ligacao_prefixo = a.prefixo;
  const conta = texto(a.conta ?? undefined, 80);
  if (conta) aviso.conta = conta;
  const contaNome = texto(a.contaNome ?? undefined, 120);
  if (contaNome) aviso.conta_nome = contaNome;
  const destino = origemDoDestino(a.url);
  if (destino) aviso.destino = destino;
  if (status !== null) aviso.status_http = status;
  return aviso;
}

/**
 * A mensagem de erro antes de ir ao hub: tira as credenciais do Regem (`rgm_it_`, `rgm_ac_`), que o pacote comum não
 * conhece. O resto (e-mail, telefone, documento, id, JWT, as chaves do Padrão) o pacote limpa no `erro()`.
 */
export function semCredencialDoRegem(mensagem: unknown): string {
  return String(mensagem ?? '').replace(/\brgm_(?:it|ac)_[A-Za-z0-9_-]+/g, '<segredo>');
}
