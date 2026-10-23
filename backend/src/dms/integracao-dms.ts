// Pacote comum do Padrão DMS de integração (docs/padrao-dms-integracao.md).
//
// Fonte única: repositório hub-dms, arquivo pacote/integracao-dms.ts. Cada produto guarda uma CÓPIA deste arquivo
// (ADR-002). Não edite a cópia: mude aqui, rode os testes (`npm test` no hub) e copie de novo. `VERSAO_PACOTE` diz
// qual versão a cópia é.
//
// Sem dependência: só o Node (22 ou mais). Escrito para compilar como CommonJS (NestJS 10) e como ESM (Liame), e para
// rodar direto no Node sem compilar: nada de enum, namespace nem propriedade declarada no construtor.

import { createHash, createHmac, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify as conferirAssinatura, type JsonWebKey, type KeyObject } from 'node:crypto';
import { isIP } from 'node:net';

export const VERSAO_PACOTE = '0.7.1';

const DIA_MS = 86_400_000;

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. Produtos e classes (Padrão §1)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const PRODUTOS = ['regem', 'regemcast', 'liame', 'farol', 'gogem', 'regemboard', 'orzuni', 'muraljob'] as const;
export type Produto = (typeof PRODUTOS)[number];

export function ehProduto(v: unknown): v is Produto {
  return typeof v === 'string' && (PRODUTOS as readonly string[]).includes(v);
}

/** `dms` = produto DMS (lista no código do produto); `parceiro` = software de outra empresa; `proprio` = programa do cliente. */
export type Classe = 'dms' | 'parceiro' | 'proprio';

/**
 * As permissões que valem de fato: as gravadas no banco que o TETO da classe permite. O teto fica no código do
 * produto; permissão gravada que a classe não pode ter não vira permissão (herdado do RegemCast). A ordem é a do teto.
 */
export function permissoesEfetivas<P extends string>(
  classe: Classe,
  gravadas: readonly string[],
  teto: Readonly<Record<Classe, readonly P[]>>,
): P[] {
  const permitidas = teto[classe] ?? [];
  return permitidas.filter((p) => gravadas.includes(p));
}

/** De onde veio um texto que um agente vai ler. */
export type OrigemConteudo = Classe | 'pessoa_da_loja' | 'terceiro';

/**
 * O agente de um produto DMS, ao agir a partir de um TEXTO (Padrão §8): ação de risco tirada de texto de parceiro, do
 * programa do cliente ou de terceiro pede uma pessoa. Não é o portão entre produtos: R2 e R3 pedidos pela porta de
 * integração esperam a aprovação no destino em qualquer caso (`pedeAprovacaoNoDestino`, seção 11).
 */
export function riscoPedeAprovacao(origem: OrigemConteudo): boolean {
  return origem !== 'dms' && origem !== 'pessoa_da_loja';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. Chaves e segredos (Padrão §2.3 e §2.4)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** `ap` = chave do acesso próprio; `lg` = segredo da ligação. */
export type TipoChave = 'ap' | 'lg';

const FORMATO_CHAVE = /^dms_(ap|lg)_([a-z]+)_([A-Za-z0-9_-]{43})_([A-Za-z0-9_-]{6})$/;
const TAMANHO_MAXIMO_CHAVE = 120;

function digitosDeConferencia(corpo: string): string {
  return createHash('sha256').update(corpo, 'utf8').digest('base64url').slice(0, 6);
}

/** SHA-256 (hex) da chave inteira: é só isto que o banco guarda. */
export function resumoChave(chave: string): string {
  return createHash('sha256').update(chave, 'utf8').digest('hex');
}

/** O tipo, o produto e 5 caracteres: o bastante para reconhecer a chave na tela, sem dar a chave. */
export function prefixoVisivel(chave: string): string {
  const m = /^dms_(?:ap|lg)_[a-z]+_/.exec(chave);
  return m ? chave.slice(0, m[0].length + 5) : '';
}

/** Gera uma chave nova. A chave em claro aparece uma vez; guarde só `resumo` e `prefixo`. */
export function gerarChave(tipo: TipoChave, produto: Produto): { chave: string; resumo: string; prefixo: string } {
  if (tipo !== 'ap' && tipo !== 'lg') throw new TypeError(`Tipo de chave desconhecido: ${String(tipo)}`);
  if (!ehProduto(produto)) throw new TypeError(`Produto desconhecido: ${String(produto)}`);
  const corpo = randomBytes(32).toString('base64url');
  const chave = `dms_${tipo}_${produto}_${corpo}_${digitosDeConferencia(corpo)}`;
  return { chave, resumo: resumoChave(chave), prefixo: prefixoVisivel(chave) };
}

/**
 * Lê uma chave SEM ir ao banco: formato, produto conhecido e dígitos de conferência. O que não passa aqui nem é
 * procurado (chave digitada errada, colada pela metade, inventada).
 */
export function lerChave(texto: unknown): { tipo: TipoChave; produto: Produto } | null {
  if (typeof texto !== 'string' || texto.length > TAMANHO_MAXIMO_CHAVE) return null;
  const m = FORMATO_CHAVE.exec(texto);
  if (!m) return null;
  const [, tipo, produto, corpo, conferencia] = m;
  if (!tipo || !corpo || !conferencia || !ehProduto(produto)) return null;
  if (digitosDeConferencia(corpo) !== conferencia) return null;
  return { tipo: tipo as TipoChave, produto };
}

/** Confere a chave apresentada contra o resumo guardado, em tempo constante. */
export function chaveConfere(chave: string, resumoGuardado: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(resumoGuardado)) return false;
  return timingSafeEqual(Buffer.from(resumoChave(chave), 'hex'), Buffer.from(resumoGuardado, 'hex'));
}

/** As regras do acesso próprio aprovadas pelo dono em 14/10/2026 (Padrão §2.4). */
export const POLITICA_CHAVE_PROPRIA = Object.freeze({
  validadeMeses: 12,
  avisoAntesDias: 15,
  sobreposicaoNaTrocaDias: 7,
  suspensaoSemUsoDias: 90,
  maximoAtivasPorEmpresaEProduto: 10,
});

/** Ligação de software de parceiro parada há 90 dias é suspensa (Padrão §3). */
export const POLITICA_LIGACAO = Object.freeze({ suspensaoParadaDias: 90 });

/** Soma meses no calendário (31/01 + 1 mês = 28 ou 29/02), em UTC. */
export function somarMeses(data: Date, meses: number): Date {
  const ano = data.getUTCFullYear();
  const mes = data.getUTCMonth() + meses;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const r = new Date(data.getTime());
  r.setUTCFullYear(ano, mes, Math.min(data.getUTCDate(), ultimoDia));
  return r;
}

/** Quando vence uma chave criada agora. */
export function vencimentoPadrao(criadaEm: Date): Date {
  return somarMeses(criadaEm, POLITICA_CHAVE_PROPRIA.validadeMeses);
}

/** Na troca (renovação), a chave antiga passa a vencer daqui a 7 dias, para dar tempo de trocar no programa. */
export function vencimentoDaAntigaNaTroca(agora: Date): Date {
  return new Date(agora.getTime() + POLITICA_CHAVE_PROPRIA.sobreposicaoNaTrocaDias * DIA_MS);
}

export type RegistroChave = {
  criadaEm: Date;
  venceEm: Date | null;
  revogadaEm: Date | null;
  ultimoUsoEm: Date | null;
  /** Reativar uma chave suspensa conta como uso. */
  reativadaEm?: Date | null;
};

export type SituacaoChave = 'valida' | 'revogada' | 'vencida' | 'suspensa';

function maisRecente(...datas: (Date | null | undefined)[]): Date {
  let r = 0;
  for (const d of datas) if (d && d.getTime() > r) r = d.getTime();
  return new Date(r);
}

/**
 * A situação de uma chave (ou de uma ligação de parceiro, com `suspensaoDias` = 90 da `POLITICA_LIGACAO`).
 * `avisarVencimento` = falta 15 dias ou menos para vencer.
 */
export function situacaoChave(
  r: RegistroChave,
  agora: Date,
  suspensaoDias: number = POLITICA_CHAVE_PROPRIA.suspensaoSemUsoDias,
): { situacao: SituacaoChave; avisarVencimento: boolean } {
  const t = agora.getTime();
  if (r.revogadaEm && r.revogadaEm.getTime() <= t) return { situacao: 'revogada', avisarVencimento: false };
  if (r.venceEm && r.venceEm.getTime() <= t) return { situacao: 'vencida', avisarVencimento: false };
  const ultimaAtividade = maisRecente(r.ultimoUsoEm, r.reativadaEm, r.criadaEm);
  if (t - ultimaAtividade.getTime() >= suspensaoDias * DIA_MS) return { situacao: 'suspensa', avisarVencimento: false };
  const avisar = !!r.venceEm && r.venceEm.getTime() - t <= POLITICA_CHAVE_PROPRIA.avisoAntesDias * DIA_MS;
  return { situacao: 'valida', avisarVencimento: avisar };
}

/** Até 10 chaves ativas por empresa em cada produto. */
export function podeCriarChave(ativasNaEmpresaEProduto: number): boolean {
  return ativasNaEmpresaEProduto < POLITICA_CHAVE_PROPRIA.maximoAtivasPorEmpresaEProduto;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. Erros RFC 9457 (Padrão §7)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const BASE_ERROS = 'https://dev.dmstecnologias.com/erros/';
export const TIPO_CONTEUDO_PROBLEMA = 'application/problem+json';

/**
 * Nome do problema → [status padrão, título]. Os 16 primeiros vêm do Regem; os 6 seguintes são novos (o da parada, na
 * 0.3.0); os 9 do fim são os do pedido de ação (0.7.0, seção 11), com a mensagem comum em `problemaDoPedido`.
 */
export const PROBLEMAS = {
  'token-invalido': [401, 'Token inválido'],
  'escopo-insuficiente': [403, 'Escopo insuficiente'],
  'conta-bloqueada': [403, 'Conta bloqueada'],
  'limite-de-chamadas': [429, 'Limite de chamadas'],
  'parametro-invalido': [400, 'Parâmetro inválido'],
  'cursor-invalido': [400, 'Cursor inválido'],
  'nao-encontrado': [404, 'Não encontrado'],
  'codigo-em-uso': [409, 'Código em uso'],
  'chave-em-uso': [409, 'Chave de idempotência em uso'],
  'regra-invalida': [422, 'Regra inválida'],
  'chave-reutilizada': [422, 'Chave de idempotência reutilizada'],
  'cliente-invalido': [401, 'Cliente inválido'],
  'autorizacao-invalida': [400, 'Autorização inválida'],
  'endereco-nao-permitido': [422, 'Endereço não permitido'],
  'aviso-indisponivel': [503, 'Avisos indisponíveis'],
  'erro-interno': [500, 'Erro interno'],
  'ligacao-invalida': [401, 'Ligação inválida'],
  'ligacao-suspensa': [403, 'Ligação suspensa'],
  'chave-vencida': [401, 'Chave vencida'],
  'chave-suspensa': [403, 'Chave suspensa'],
  'fonte-inativa': [409, 'Fonte inativa'],
  'integracao-parada': [503, 'Integração parada'],
  'aprovacao-pendente': [409, 'Aprovação pendente'],
  'aprovacao-recusada': [409, 'Aprovação recusada'],
  'aprovacao-vencida': [409, 'Aprovação vencida'],
  'plano-mudou': [409, 'O plano mudou'],
  'aprovacao-usada': [409, 'Aprovação já usada'],
  'pedido-cancelado': [409, 'Pedido cancelado'],
  'aprovacao-propria': [403, 'Quem pediu não aprova'],
  'segundo-fator-invalido': [403, 'Segundo fator inválido'],
  'teto-de-gasto': [409, 'Teto de gasto'],
} as const satisfies Record<string, readonly [number, string]>;

export type TipoProblema = keyof typeof PROBLEMAS;

export function ehTipoProblema(v: unknown): v is TipoProblema {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PROBLEMAS, v);
}

/** Erro com o nome do problema do Padrão. O adaptador de cada produto transforma em resposta. */
export class ErroProblema extends Error {
  readonly tipo: TipoProblema;
  readonly status: number;
  readonly detalhe: string;
  readonly retryAfterSeg: number | undefined;

  constructor(tipo: TipoProblema, detalhe: string, opcoes: { status?: number; retryAfterSeg?: number } = {}) {
    super(detalhe);
    this.name = 'ErroProblema';
    this.tipo = tipo;
    this.status = opcoes.status ?? PROBLEMAS[tipo][0];
    this.detalhe = detalhe;
    this.retryAfterSeg = opcoes.retryAfterSeg;
  }
}

export type CorpoProblema = { type: string; title: string; status: number; detail: string; request_id?: string };

/** O corpo `application/problem+json`. `detail` em pt-BR, dizendo como resolver. */
export function corpoProblema(
  tipo: TipoProblema,
  detalhe: string,
  opcoes: { status?: number; requestId?: string | null; base?: string } = {},
): CorpoProblema {
  const corpo: CorpoProblema = {
    type: (opcoes.base ?? BASE_ERROS) + tipo,
    title: PROBLEMAS[tipo][1],
    status: opcoes.status ?? PROBLEMAS[tipo][0],
    detail: detalhe,
  };
  if (opcoes.requestId) corpo.request_id = opcoes.requestId;
  return corpo;
}

/** O problema de uma chave que não está válida. Revogada responde igual a inexistente (Padrão §7). */
export function problemaDaSituacao(situacao: Exclude<SituacaoChave, 'valida'>): ErroProblema {
  if (situacao === 'vencida') return new ErroProblema('chave-vencida', 'A chave venceu. Gere outra na tela de integrações do produto.');
  if (situacao === 'suspensa') {
    return new ErroProblema('chave-suspensa', 'A chave foi suspensa por falta de uso. O dono da conta reativa na tela de integrações.');
  }
  return new ErroProblema('token-invalido', 'Credencial ausente, inválida ou revogada.');
}

/**
 * O cabeçalho `WWW-Authenticate` das respostas 401 e 403. Na porta MCP, `metadadosRecurso` é obrigatório e, no 403,
 * `escopos` leva TODAS as permissões que faltam de uma vez (especificação MCP 2026-07-28).
 */
export function cabecalhoWwwAuthenticate(
  o: { erro?: 'invalid_token' | 'insufficient_scope'; escopos?: readonly string[]; metadadosRecurso?: string } = {},
): string {
  const partes: string[] = [];
  if (o.metadadosRecurso) partes.push(`resource_metadata="${o.metadadosRecurso.replace(/["\\]/g, '')}"`);
  if (o.erro) partes.push(`error="${o.erro}"`);
  if (o.escopos && o.escopos.length) partes.push(`scope="${o.escopos.join(' ').replace(/["\\]/g, '')}"`);
  return partes.length ? `Bearer ${partes.join(', ')}` : 'Bearer';
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 4. Idempotência (Padrão §5 e §6)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const VALIDADE_IDEMPOTENCIA_HORAS = 24;

/** REST: cabeçalho `Idempotency-Key`, de 1 a 255 caracteres visíveis (ASCII 33 a 126), sem espaço. */
export function chaveIdempotenciaRestValida(v: unknown): v is string {
  return typeof v === 'string' && /^[\x21-\x7E]{1,255}$/.test(v);
}

/** MCP: argumento `chaveIdempotencia`, de 8 a 100 caracteres visíveis (herdado do RegemCast). */
export function chaveIdempotenciaMcpValida(v: unknown): v is string {
  return typeof v === 'string' && /^[\x21-\x7E]{8,100}$/.test(v);
}

/** JSON com as chaves dos objetos em ordem: o mesmo pedido dá sempre o mesmo texto. */
export function jsonCanonico(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    const t = JSON.stringify(v);
    return t === undefined ? 'null' : t;
  }
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : jsonCanonico(x))).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const partes = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(obj[k])}`);
  return `{${partes.join(',')}}`;
}

/**
 * A impressão de um pedido: método, caminho e corpo. A mesma chave de idempotência com OUTRA impressão é recusada
 * (`chave-reutilizada`); com a mesma, devolve a resposta guardada inteira (LIC-042).
 */
export function impressaoPedido(metodo: string, caminho: string, corpo: unknown): string {
  return createHash('sha256')
    .update(`${metodo.toUpperCase()}\n${caminho}\n${jsonCanonico(corpo ?? null)}`, 'utf8')
    .digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 5. Limite de chamadas (Padrão §5)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Janela fixa em memória, por chave (ligação, chave própria ou empresa). Vale por processo: com mais de uma cópia do
 * serviço, cada uma conta a sua, e o produto que precisar de conta única troca por um armazenamento compartilhado.
 */
export class JanelaFixa {
  private readonly limite: number;
  private readonly janelaMs: number;
  private readonly relogio: () => number;
  private readonly contagens = new Map<string, { inicio: number; usadas: number }>();

  constructor(limitePorJanela: number, janelaMs: number = 60_000, relogio: () => number = Date.now) {
    if (!Number.isInteger(limitePorJanela) || limitePorJanela < 1) throw new RangeError('O limite precisa ser um inteiro positivo.');
    this.limite = limitePorJanela;
    this.janelaMs = janelaMs;
    this.relogio = relogio;
  }

  /** Conta uma chamada. `ok:false` → responder 429 com `Retry-After: retryAfterSeg`. */
  contar(chave: string): { ok: boolean; restante: number; retryAfterSeg: number } {
    const agora = this.relogio();
    let c = this.contagens.get(chave);
    if (!c || agora - c.inicio >= this.janelaMs) {
      c = { inicio: agora, usadas: 0 };
      this.contagens.set(chave, c);
      if (this.contagens.size > 10_000) this.limpar(agora);
    }
    const retryAfterSeg = Math.max(1, Math.ceil((c.inicio + this.janelaMs - agora) / 1000));
    if (c.usadas >= this.limite) return { ok: false, restante: 0, retryAfterSeg };
    c.usadas += 1;
    return { ok: true, restante: this.limite - c.usadas, retryAfterSeg };
  }

  private limpar(agora: number): void {
    for (const [k, c] of this.contagens) if (agora - c.inicio >= this.janelaMs) this.contagens.delete(k);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 6. Cursor opaco (Padrão §5; generalizado de cursor-integracao.ts do Regem)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PosicaoCursor = { t: string; i: string } | null;

const INSTANTE_US = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAMANHO_MAXIMO_CURSOR = 1000;

/** O vínculo do cursor com a empresa e a loja (resumo curto: não revela os ids). */
export function vinculoCursor(empresaId: string, lojaId: string | null): string {
  return createHash('sha256').update(`${empresaId}:${lojaId ?? 'empresa'}`, 'utf8').digest('base64url').slice(0, 16);
}

/**
 * Cursor preso à rota e ao vínculo, com a posição (carimbo com microssegundos e id). `extra` guarda valores curtos
 * da carga inicial (como o `desde`). Nada disso é segredo: o filtro de empresa e loja vem SEMPRE da credencial.
 */
export function codificarCursor(
  rota: string,
  vinculo: string,
  posicao: PosicaoCursor,
  extra: Readonly<Record<string, string | null>> = {},
): string {
  const corpo = { k: rota, l: vinculo, t: posicao ? posicao.t : null, i: posicao ? posicao.i : null, x: extra };
  return Buffer.from(JSON.stringify(corpo), 'utf8').toString('base64url');
}

function cursorInvalido(): never {
  throw new ErroProblema('cursor-invalido', 'Cursor inválido para esta rota e esta loja. Recomece sem cursor.');
}

/** Lê o cursor devolvido pelo cliente. Qualquer coisa fora do formato → 400 `cursor-invalido`. */
export function lerCursor(
  texto: unknown,
  rota: string,
  vinculo: string,
): { posicao: PosicaoCursor; extra: Record<string, string | null> } {
  // A regex é ancorada e de uma classe de caracteres só, sem repetição aninhada: tempo linear, sem retrocesso
  // catastrófico; e o tamanho já passou pelo teto (TAMANHO_MAXIMO_CURSOR) antes dela.
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos
  if (typeof texto !== 'string' || !texto || texto.length > TAMANHO_MAXIMO_CURSOR || !/^[A-Za-z0-9_-]+$/.test(texto)) cursorInvalido();
  let corpo: unknown;
  try {
    corpo = JSON.parse(Buffer.from(texto, 'base64url').toString('utf8'));
  } catch {
    cursorInvalido();
  }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) cursorInvalido();
  const c = corpo as Record<string, unknown>;
  if (c.k !== rota || c.l !== vinculo) cursorInvalido();
  const temT = c.t !== null && c.t !== undefined;
  const temI = c.i !== null && c.i !== undefined;
  if (temT !== temI) cursorInvalido();
  if (temT && (typeof c.t !== 'string' || !INSTANTE_US.test(c.t))) cursorInvalido();
  if (temI && (typeof c.i !== 'string' || !UUID.test(c.i))) cursorInvalido();
  const x = c.x ?? {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) cursorInvalido();
  const extra: Record<string, string | null> = {};
  const entradas = Object.entries(x as Record<string, unknown>);
  if (entradas.length > 5) cursorInvalido();
  for (const [k, v] of entradas) {
    if (!/^[a-z_]{1,20}$/.test(k) || (v !== null && (typeof v !== 'string' || v.length > 100))) cursorInvalido();
    extra[k] = v as string | null;
  }
  const posicao = temT ? { t: c.t as string, i: (c.i as string).toLowerCase() } : null;
  return { posicao, extra };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 7. Avisos — Standard Webhooks (Padrão §9; assinatura herdada de webhook-integracao.ts do Regem)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const PREFIXO_SEGREDO_AVISO = 'whsec_';

/** Segredo novo de aviso: `whsec_` + 32 bytes em base64. Um por ligação. */
export function gerarSegredoAviso(): string {
  return PREFIXO_SEGREDO_AVISO + randomBytes(32).toString('base64');
}

/** Os bytes do segredo `whsec_<base64>` (24 a 64 bytes), ou `null` se o formato não serve. */
export function chaveDoSegredoAviso(segredo: unknown): Buffer | null {
  if (typeof segredo !== 'string' || !segredo.startsWith(PREFIXO_SEGREDO_AVISO)) return null;
  const b64 = segredo.slice(PREFIXO_SEGREDO_AVISO.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const chave = Buffer.from(b64, 'base64');
  return chave.length >= 24 && chave.length <= 64 ? chave : null;
}

/** `v1,` + HMAC-SHA256 (base64) de `id.timestamp.corpo`. */
export function assinarAviso(chave: Buffer, id: string, timestampSeg: number, corpo: string): string {
  return `v1,${createHmac('sha256', chave).update(`${id}.${timestampSeg}.${corpo}`, 'utf8').digest('base64')}`;
}

export type CabecalhosAviso = { 'webhook-id': string; 'webhook-timestamp': string; 'webhook-signature': string };

/** Os três cabeçalhos de um aviso. O corpo vai como está (o mesmo texto que foi assinado). */
export function cabecalhosAviso(segredo: string, id: string, corpo: string, agora: Date = new Date()): CabecalhosAviso {
  const chave = chaveDoSegredoAviso(segredo);
  if (!chave) throw new TypeError('Segredo de aviso fora do formato whsec_.');
  const ts = Math.floor(agora.getTime() / 1000);
  return { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': assinarAviso(chave, id, ts, corpo) };
}

/**
 * Confere um aviso recebido: assinatura certa (aceita várias, separadas por espaço, para a troca de segredo) e
 * horário dentro da tolerância (5 minutos), contra repetição de aviso antigo.
 */
export function conferirAviso(
  segredo: string,
  cabecalhos: Partial<Record<keyof CabecalhosAviso, string | undefined>>,
  corpo: string,
  agora: Date = new Date(),
  toleranciaSeg: number = 300,
): boolean {
  const chave = chaveDoSegredoAviso(segredo);
  const id = cabecalhos['webhook-id'];
  const tsTexto = cabecalhos['webhook-timestamp'];
  const assinaturas = cabecalhos['webhook-signature'];
  if (!chave || !id || !tsTexto || !assinaturas || !/^\d{1,12}$/.test(tsTexto)) return false;
  const ts = Number(tsTexto);
  if (Math.abs(Math.floor(agora.getTime() / 1000) - ts) > toleranciaSeg) return false;
  const esperada = Buffer.from(assinarAviso(chave, id, ts, corpo), 'utf8');
  return assinaturas.split(' ').some((a) => {
    const recebida = Buffer.from(a, 'utf8');
    return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
  });
}

/**
 * O destino de um aviso está dentro da lista aprovada do aplicativo? Só HTTPS, na porta padrão, sem usuário e senha,
 * sem pergunta (`?`) nem fragmento, mesma origem de uma base da lista e o caminho = o caminho da base + UM trecho
 * (o id da ligação no aplicativo). Comparado com `new URL()`, nunca pelo começo do texto (LIC-119).
 */
export function destinoAvisoPermitido(endereco: unknown, bases: readonly string[]): boolean {
  if (typeof endereco !== 'string' || endereco.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(endereco);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username || u.password || u.search || u.hash) return false;
  for (const textoBase of bases) {
    let b: URL;
    try {
      b = new URL(textoBase);
    } catch {
      continue;
    }
    if (b.protocol !== 'https:' || b.origin !== u.origin) continue;
    const caminhoBase = b.pathname.endsWith('/') ? b.pathname : b.pathname + '/';
    if (!u.pathname.startsWith(caminhoBase)) continue;
    const resto = u.pathname.slice(caminhoBase.length);
    if (/^[A-Za-z0-9_-]{1,128}$/.test(resto)) return true;
  }
  return false;
}

function ipv4ParaNumero(ip: string): number {
  return ip.split('.').reduce((acc, p) => acc * 256 + Number(p), 0);
}

const FAIXAS_IPV4_INTERNAS: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function ipv4Interno(ip: string): boolean {
  const n = ipv4ParaNumero(ip);
  return FAIXAS_IPV4_INTERNAS.some(([base, bits]) => {
    const mascara = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((n & mascara) >>> 0) === ((ipv4ParaNumero(base) & mascara) >>> 0);
  });
}

type GruposIpv6 = [number, number, number, number, number, number, number, number];

/** Os 8 grupos de 16 bits de um IPv6 (aceita `::` e o final em IPv4, como `::ffff:10.0.0.1`). */
function gruposIpv6(ip: string): GruposIpv6 | null {
  let texto = ip.toLowerCase().split('%')[0] ?? '';
  let finalV4: [number, number] | null = null;
  const ultimoDoisPontos = texto.lastIndexOf(':');
  const cauda = texto.slice(ultimoDoisPontos + 1);
  if (cauda.includes('.')) {
    if (isIP(cauda) !== 4) return null;
    const n = ipv4ParaNumero(cauda);
    finalV4 = [(n >>> 16) & 0xffff, n & 0xffff];
    texto = texto.slice(0, ultimoDoisPontos + 1) + '0:0';
  }
  const [esq, dir, ...demais] = texto.split('::');
  if (demais.length) return null;
  const a = esq ? esq.split(':') : [];
  const b = dir !== undefined ? (dir ? dir.split(':') : []) : null;
  if (b !== null && a.length + b.length > 7) return null; // com `::`, ao menos um grupo é zero
  const total = b === null ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
  if (total.length !== 8) return null;
  const grupos = total.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)) as GruposIpv6;
  if (grupos.some((g) => Number.isNaN(g))) return null;
  if (finalV4) {
    grupos[6] = finalV4[0];
    grupos[7] = finalV4[1];
  }
  return grupos;
}

/**
 * O endereço IP é interno, reservado ou de rede local? Quem envia o aviso resolve o nome do destino, recusa se
 * QUALQUER endereço resolvido for interno e conecta no endereço que conferiu (Padrão §9). Texto que não é IP → true.
 */
export function enderecoInterno(ip: string): boolean {
  const versao = isIP(ip.split('%')[0] ?? '');
  if (versao === 4) return ipv4Interno(ip);
  if (versao !== 6) return true;
  const g = gruposIpv6(ip);
  if (!g) return true;
  const zerosAte = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zerosAte(8)) return true; // ::
  if (zerosAte(7) && g[7] === 1) return true; // ::1
  const v4Embutido = () => `${g[6] >>> 8}.${g[6] & 0xff}.${g[7] >>> 8}.${g[7] & 0xff}`;
  if (zerosAte(5) && g[5] === 0xffff) return ipv4Interno(v4Embutido()); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return ipv4Interno(v4Embutido()); // 64:ff9b::/96
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // 100::/64
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 8. O token do DMS ID, a ligação e o cliente pronto (Padrão §2.1; decisões F2-1 e F2-4 de 15/10/2026)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//
// O token do DMS ID diz QUAL APLICATIVO chama; o segredo da ligação (`DMS-Ligacao: dms_lg_…`) diz qual conta autorizou.
// O produto confere os dois e que a ligação é daquele aplicativo: vazar um só não abre nada. O token é conferido NO
// produto, com as chaves públicas do DMS ID guardadas — o produto não chama o DMS ID a cada pedido.
//
// Forma conferida no Logto 1.44 (15/10/2026): assinatura ES384 (chave EC P-384), cabeçalho `typ: at+jwt` com `kid`;
// campos `iss` (`<endereço>/oidc`), `aud` (texto: o produto), `sub` = `client_id`, `scope` (separado por espaço),
// `exp`, `iat`, `jti`. O Logto emite token para QUALQUER destino, mesmo sem permissão lá (`scope` vazio): por isso o
// produto exige a permissão, nunca só o destino (prova, P1).

/** O cabeçalho do segredo da ligação, na REST e na MCP entre produtos DMS. Nome de cabeçalho é só ASCII: sem cedilha. */
export const CABECALHO_LIGACAO = 'DMS-Ligacao';

/**
 * Assinaturas aceitas: as duas que o Logto usa — ES384 (a chave EC P-384 de fábrica) e RS256 (se a chave for trocada
 * para RSA). `none`, as de segredo (HS*) e qualquer outra, nunca.
 */
const ASSINATURAS = {
  ES384: { hash: 'sha384', tipo: 'ec' },
  RS256: { hash: 'sha256', tipo: 'rsa' },
} as const;
type Assinatura = keyof typeof ASSINATURAS;

/** Lê um pedaço base64url de JSON. Nulo = não é JSON de objeto. */
function jsonDoPedaco(pedaco: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(Buffer.from(pedaco, 'base64url').toString('utf8'));
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type OpcoesChavesDmsId = {
  /** O endereço das chaves públicas do DMS ID (`<emissor>/jwks`). */
  jwks: string;
  buscar?: typeof fetch;
  /** Depois disso, as chaves guardadas são buscadas de novo (padrão: 10 minutos). */
  validadeMs?: number;
  /** Intervalo mínimo entre duas buscas, para um `kid` inventado não virar enxurrada no DMS ID (padrão: 30 s). */
  intervaloMinimoMs?: number;
  tempoLimiteMs?: number;
  relogio?: () => number;
};

/**
 * As chaves públicas do DMS ID, guardadas. Busca de novo quando ficam velhas ou quando chega um `kid` que não conhece
 * (a troca de chave). Se o DMS ID não responde, segue com as que tem: o token já emitido continua conferível. A chave
 * que saiu do DMS ID sai daqui na busca seguinte que der certo.
 */
export class ChavesDmsId {
  private readonly jwks: string;
  private readonly buscar: typeof fetch;
  private readonly validadeMs: number;
  private readonly intervaloMinimoMs: number;
  private readonly tempoLimiteMs: number;
  private readonly relogio: () => number;
  private chaves = new Map<string, KeyObject>();
  private buscadoEm = Number.NEGATIVE_INFINITY;
  private tentadoEm = Number.NEGATIVE_INFINITY;
  private emCurso: Promise<void> | null = null;

  constructor(o: OpcoesChavesDmsId) {
    this.jwks = o.jwks;
    this.buscar = o.buscar ?? fetch;
    this.validadeMs = o.validadeMs ?? 600_000;
    this.intervaloMinimoMs = o.intervaloMinimoMs ?? 30_000;
    this.tempoLimiteMs = o.tempoLimiteMs ?? 3_000;
    this.relogio = o.relogio ?? Date.now;
  }

  /** A chave de um `kid`, ou nulo se o DMS ID não a publica (nem publicou da última vez que respondeu). */
  async chave(kid: string): Promise<KeyObject | null> {
    // Uma busca em andamento (a primeira, na subida, ou a de um kid novo): espera por ela antes de decidir.
    if (this.emCurso) await this.emCurso;
    const agora = this.relogio();
    const velha = agora - this.buscadoEm >= this.validadeMs;
    if (this.chaves.has(kid) && !velha) return this.chaves.get(kid) ?? null;
    if (agora - this.tentadoEm >= this.intervaloMinimoMs) await this.atualizar();
    return this.chaves.get(kid) ?? null;
  }

  private atualizar(): Promise<void> {
    this.tentadoEm = this.relogio();
    this.emCurso = this.buscarChaves().finally(() => {
      this.emCurso = null;
    });
    return this.emCurso;
  }

  private async buscarChaves(): Promise<void> {
    try {
      const r = await this.buscar(this.jwks, { signal: AbortSignal.timeout(this.tempoLimiteMs) });
      if (!r.ok) return;
      const corpo = (await r.json()) as { keys?: unknown };
      if (!Array.isArray(corpo.keys)) return;
      const novas = new Map<string, KeyObject>();
      for (const k of corpo.keys as Array<Record<string, unknown>>) {
        if (typeof k.kid !== 'string' || (k.use !== undefined && k.use !== 'sig')) continue;
        // chave simétrica (`oct`) ou quebrada não se lê como pública e fica de fora; a de outro tipo (Ed25519) é lida, mas
        // a conferência do token exige o tipo da assinatura (`asymmetricKeyType`)
        try {
          novas.set(k.kid, createPublicKey({ key: k as JsonWebKey, format: 'jwk' }));
        } catch {
          // chave que não se lê fica de fora; as outras valem
        }
      }
      if (novas.size === 0) return;
      this.chaves = novas;
      this.buscadoEm = this.relogio();
    } catch {
      // DMS ID fora do ar ou lento: seguem as chaves guardadas
    }
  }
}

/** O token que não vale. A resposta é a mesma para todo motivo (Padrão §7); o `motivo` é só para o registro local. */
export class ErroTokenDmsId extends ErroProblema {
  readonly motivo: string;

  constructor(motivo: string) {
    super('token-invalido', 'Token do DMS ID ausente, inválido ou vencido. Peça outro ao DMS ID.');
    this.name = 'ErroTokenDmsId';
    this.motivo = motivo;
  }
}

/** Falta permissão no token. `faltando` traz TODAS de uma vez, para o `WWW-Authenticate` da porta MCP. */
export class ErroPermissaoFaltando extends ErroProblema {
  readonly faltando: string[];

  constructor(faltando: readonly string[]) {
    super('escopo-insuficiente', `Falta a permissão: ${faltando.join(', ')}.`);
    this.name = 'ErroPermissaoFaltando';
    this.faltando = [...faltando];
  }
}

export type TokenDmsId = {
  /** O aplicativo que chama (`client_id`). */
  aplicativo: string;
  permissoes: string[];
  expiraEm: Date;
};

export type OpcoesTokenDmsId = {
  chaves: ChavesDmsId;
  /** O `iss` esperado: o endereço do DMS ID com `/oidc` (ex.: `https://id.dmstecnologias.com/oidc`). */
  emissor: string;
  /** O `aud` esperado: o identificador do produto que confere (o recurso cadastrado no DMS ID). */
  destino: string;
  /** As permissões que a chamada exige. Falta uma: 403 com todas as que faltam. */
  exigidas?: readonly string[];
  agora?: Date;
  /** Folga para relógios desencontrados (padrão: 30 s). */
  folgaSeg?: number;
};

/**
 * Confere o token do DMS ID: a forma, a assinatura (com a chave do `kid`), o emissor, o destino, a validade e as
 * permissões exigidas. Token que não vale → `ErroTokenDmsId` (401); falta permissão → `ErroPermissaoFaltando` (403).
 * Não confere a ligação: isso é do produto, com o segredo da ligação (`lerChave`, `resumoChave`) e
 * `permissoesDaChamada`.
 */
export async function conferirTokenDmsId(token: unknown, o: OpcoesTokenDmsId): Promise<TokenDmsId> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 8192) throw new ErroTokenDmsId('ausente ou grande demais');
  const partes = token.split('.');
  if (partes.length !== 3) throw new ErroTokenDmsId('não é JWS compacto');
  const [cabecaTexto, corpoTexto, assinaturaTexto] = partes as [string, string, string];
  const cabeca = jsonDoPedaco(cabecaTexto);
  const corpo = jsonDoPedaco(corpoTexto);
  if (!cabeca || !corpo) throw new ErroTokenDmsId('cabeçalho ou corpo ilegível');
  if (typeof cabeca.alg !== 'string' || !Object.prototype.hasOwnProperty.call(ASSINATURAS, cabeca.alg)) throw new ErroTokenDmsId('assinatura não aceita');
  if (typeof cabeca.typ !== 'string' || cabeca.typ.toLowerCase() !== 'at+jwt') throw new ErroTokenDmsId('não é token de acesso');
  if (typeof cabeca.kid !== 'string' || cabeca.kid.length === 0) throw new ErroTokenDmsId('sem kid');

  const assinatura = ASSINATURAS[cabeca.alg as Assinatura];
  const chave = await o.chaves.chave(cabeca.kid);
  if (!chave) throw new ErroTokenDmsId('kid desconhecido');
  if (chave.asymmetricKeyType !== assinatura.tipo) throw new ErroTokenDmsId('chave de outro tipo');
  const dados = Buffer.from(`${cabecaTexto}.${corpoTexto}`, 'ascii');
  const valida = conferirAssinatura(
    assinatura.hash,
    dados,
    assinatura.tipo === 'ec' ? { key: chave, dsaEncoding: 'ieee-p1363' } : chave,
    Buffer.from(assinaturaTexto, 'base64url'),
  );
  if (!valida) throw new ErroTokenDmsId('assinatura não confere');

  const agoraSeg = Math.floor((o.agora ?? new Date()).getTime() / 1000);
  const folga = o.folgaSeg ?? 30;
  if (corpo.iss !== o.emissor) throw new ErroTokenDmsId('outro emissor');
  const destinos = Array.isArray(corpo.aud) ? corpo.aud : [corpo.aud];
  if (!destinos.includes(o.destino)) throw new ErroTokenDmsId('outro destino');
  if (typeof corpo.exp !== 'number' || corpo.exp <= agoraSeg - folga) throw new ErroTokenDmsId('vencido');
  if (typeof corpo.nbf === 'number' && corpo.nbf > agoraSeg + folga) throw new ErroTokenDmsId('ainda não vale');
  if (typeof corpo.iat === 'number' && corpo.iat > agoraSeg + folga) throw new ErroTokenDmsId('emitido no futuro');
  const aplicativo = typeof corpo.client_id === 'string' ? corpo.client_id : typeof corpo.sub === 'string' ? corpo.sub : null;
  if (!aplicativo) throw new ErroTokenDmsId('sem aplicativo');

  const permissoes = typeof corpo.scope === 'string' ? corpo.scope.split(' ').filter((p) => p.length > 0) : [];
  const faltando = (o.exigidas ?? []).filter((p) => !permissoes.includes(p));
  if (faltando.length > 0) throw new ErroPermissaoFaltando(faltando);
  return { aplicativo, permissoes, expiraEm: new Date(corpo.exp * 1000) };
}

/**
 * As permissões que valem numa chamada: as do token E as que a conta autorizou na ligação. Vale a menor das duas — o
 * DMS ID diz o que o aplicativo pode no produto; a ligação diz o que aquela conta deixou.
 */
export function permissoesDaChamada(doToken: readonly string[], daLigacao: readonly string[]): string[] {
  return doToken.filter((p) => daLigacao.includes(p));
}

/** O DMS ID recusou ou não respondeu o pedido de token. A mensagem nunca leva o segredo do aplicativo. */
export class ErroDmsId extends Error {
  readonly status: number;
  readonly codigo: string;

  constructor(status: number, codigo: string) {
    super(`O DMS ID não deu o token (${status}${codigo ? ` ${codigo}` : ''}).`);
    this.name = 'ErroDmsId';
    this.status = status;
    this.codigo = codigo;
  }
}

export type OpcoesClienteDmsId = {
  /** O endereço do DMS ID com `/oidc` (o mesmo `iss` dos tokens). O pedido vai a `<emissor>/token`. */
  emissor: string;
  /** O `client_id` do aplicativo no DMS ID. */
  aplicativo: string;
  /** O segredo do aplicativo. Fica na configuração do servidor, nunca em registro. */
  segredo: string;
  buscar?: typeof fetch;
  /** Renova este tanto antes de vencer (padrão: 60 s). */
  margemSeg?: number;
  tempoLimiteMs?: number;
  relogio?: () => number;
};

/**
 * O cliente pronto: pede o token do DMS ID para um produto, guarda até perto de vencer e renova sozinho. Pedidos ao
 * mesmo tempo para o mesmo destino viram UM pedido ao DMS ID. Recebeu 401 do produto? `esquecer` e pedir de novo, uma
 * vez.
 */
export class ClienteDmsId {
  private readonly emissor: string;
  private readonly aplicativo: string;
  private readonly segredo: string;
  private readonly buscar: typeof fetch;
  private readonly margemMs: number;
  private readonly tempoLimiteMs: number;
  private readonly relogio: () => number;
  private readonly guardados = new Map<string, { token: string; venceEm: number }>();
  private readonly emCurso = new Map<string, Promise<string>>();

  constructor(o: OpcoesClienteDmsId) {
    this.emissor = o.emissor.replace(/\/+$/, '');
    this.aplicativo = o.aplicativo;
    this.segredo = o.segredo;
    this.buscar = o.buscar ?? fetch;
    this.margemMs = (o.margemSeg ?? 60) * 1000;
    this.tempoLimiteMs = o.tempoLimiteMs ?? 5_000;
    this.relogio = o.relogio ?? Date.now;
  }

  private static chave(destino: string, permissoes: readonly string[]): string {
    return `${destino} ${[...permissoes].sort().join(' ')}`;
  }

  /** O token para chamar `destino` com estas permissões. */
  async token(destino: string, permissoes: readonly string[]): Promise<string> {
    const chave = ClienteDmsId.chave(destino, permissoes);
    const guardado = this.guardados.get(chave);
    if (guardado && guardado.venceEm - this.margemMs > this.relogio()) return guardado.token;
    const andando = this.emCurso.get(chave);
    if (andando) return andando;
    const pedido = this.pedir(destino, permissoes, chave).finally(() => this.emCurso.delete(chave));
    this.emCurso.set(chave, pedido);
    return pedido;
  }

  /** Joga fora o token guardado (o produto respondeu 401: o próximo `token` pede outro). */
  esquecer(destino: string, permissoes: readonly string[]): void {
    this.guardados.delete(ClienteDmsId.chave(destino, permissoes));
  }

  private async pedir(destino: string, permissoes: readonly string[], chave: string): Promise<string> {
    // RFC 6749 §2.3.1: o id e o segredo vão codificados antes do Basic.
    const credencial = Buffer.from(`${encodeURIComponent(this.aplicativo)}:${encodeURIComponent(this.segredo)}`).toString('base64');
    let r: Response;
    try {
      r = await this.buscar(`${this.emissor}/token`, {
        method: 'POST',
        headers: { authorization: `Basic ${credencial}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', resource: destino, scope: [...permissoes].join(' ') }).toString(),
        signal: AbortSignal.timeout(this.tempoLimiteMs),
      });
    } catch {
      throw new ErroDmsId(0, 'sem_resposta');
    }
    const corpo = (await r.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; error?: unknown };
    if (!r.ok || typeof corpo.access_token !== 'string') throw new ErroDmsId(r.status, typeof corpo.error === 'string' ? corpo.error.slice(0, 60) : '');
    const segundos = typeof corpo.expires_in === 'number' && corpo.expires_in > 0 ? corpo.expires_in : 300;
    this.guardados.set(chave, { token: corpo.access_token, venceEm: this.relogio() + segundos * 1000 });
    return corpo.access_token;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 8b. O cliente pronto de uma porta do Padrão: o token, a ligação, repetir com recuo e ler por cursor (Padrão §14;
//     F4, parte J, 22/10/2026)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Repetir sem risco: o que só lê, `PUT` e `DELETE` (idempotentes no HTTP) e qualquer escrita com `Idempotency-Key` (Padrão §6). */
export function podeRepetir(metodo: string, comChaveDeIdempotencia: boolean): boolean {
  return comChaveDeIdempotencia || ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'].includes(metodo.toUpperCase());
}

/** O que se repete: sem resposta (0), o limite (429) e o produto ou o caminho fora (502, 503, 504). O 401 é outro caso. */
export function respostaParaRepetir(status: number): boolean {
  return status === 0 || status === 429 || status === 502 || status === 503 || status === 504;
}

export type RecuoDaRepeticao = { baseMs: number; tetoMs: number };

/**
 * Quanto esperar antes da repetição `n` (1 = a primeira): o `Retry-After` quando vem (em segundos ou como data, até o
 * teto); senão, o recuo exponencial com a metade sorteada, para muitos clientes não voltarem juntos.
 */
export function esperaDaRepeticao(n: number, retryAfter: string | null, recuo: RecuoDaRepeticao, sorteio: number, agoraMs: number): number {
  const pedido = (retryAfter ?? '').trim();
  if (/^\d{1,9}$/.test(pedido)) return Math.min(Number(pedido) * 1000, recuo.tetoMs);
  if (pedido !== '') {
    const data = Date.parse(pedido);
    if (Number.isFinite(data)) return Math.min(Math.max(0, data - agoraMs), recuo.tetoMs);
  }
  const exponencial = Math.min(recuo.baseMs * 2 ** Math.max(0, n - 1), recuo.tetoMs);
  const s = Math.min(Math.max(sorteio, 0), 1);
  return Math.round(exponencial / 2 + s * (exponencial / 2));
}

/** O nome do problema numa resposta `problem+json` do Padrão (o fim do `type`), ou vazio. */
export function problemaDaResposta(corpo: unknown): string {
  if (!corpo || typeof corpo !== 'object') return '';
  const tipo = (corpo as { type?: unknown }).type;
  if (typeof tipo !== 'string') return '';
  const nome = tipo.slice(tipo.lastIndexOf('/') + 1);
  return /^[a-z][a-z0-9-]{1,63}$/.test(nome) ? nome : '';
}

/** A porta não respondeu, ou a leitura por cursor recebeu algo fora de 2xx: o status e o nome do problema. Nunca a credencial. */
export class ErroPorta extends Error {
  readonly status: number;
  readonly problema: string;

  constructor(status: number, problema: string) {
    super(`A porta respondeu ${status || 'nada'}${problema ? ` (${problema})` : ''}.`);
    this.name = 'ErroPorta';
    this.status = status;
    this.problema = problema;
  }
}

export type OpcoesClienteIntegracao = {
  /** O endereço da porta, até a versão (`https://api.dmsregem.com/api/v1`). */
  base: string;
  /** O destino do token: o identificador do recurso do produto no DMS ID. */
  recurso: string;
  /** As permissões que o token pede (o produto ainda confere a da ligação: vale a menor das duas). */
  permissoes: readonly string[];
  dmsId: ClienteDmsId;
  /** O segredo da ligação da loja, no cabeçalho `DMS-Ligacao`. Sem ele, a chamada vai só com o token. */
  ligacao?: string;
  buscar?: typeof fetch;
  /** Quantas tentativas ao todo, a primeira inclusive (padrão 4). */
  tentativas?: number;
  recuo?: Partial<RecuoDaRepeticao>;
  tempoLimiteMs?: number;
  esperar?: (ms: number) => Promise<void>;
  sorteio?: () => number;
  relogio?: () => number;
};

export type PedidoPorta = {
  corpo?: unknown;
  /** A chave de idempotência (obrigatória em toda escrita, Padrão §6). Com ela, a escrita também se repete. */
  idempotencia?: string;
  consulta?: Readonly<Record<string, string | number | undefined>>;
};

export type RespostaPorta = {
  status: number;
  corpo: unknown;
  /** O nome do problema do Padrão, quando a resposta é `problem+json`. */
  problema: string;
  retryAfter: string | null;
  /** Quantas tentativas a chamada levou (o pedido de outro token depois de um 401 não conta). */
  tentativas: number;
};

const RECUO_PADRAO: RecuoDaRepeticao = { baseMs: 500, tetoMs: 30_000 };

async function corpoDaResposta(r: Response): Promise<unknown> {
  const texto = await r.text().catch(() => '');
  if (texto === '') return null;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return texto.slice(0, 2_000);
  }
}

/**
 * O cliente pronto de uma porta do Padrão (§14). Cada chamada leva o token do DMS ID e o segredo da ligação. O limite
 * (429) e o produto fora (502, 503, inclusive `integracao-parada`, 504 e sem resposta) repetem com recuo, só no que
 * pode repetir. O 401 pede outro token uma vez, menos `ligacao-invalida`: a ligação foi revogada, outro token não
 * ajuda, e quem chama decide (só ela desconecta a loja). `lerPorCursor` percorre uma lista (`itens` e
 * `proximo_cursor`). Não segue redirecionamento: o token não vai a outro lugar.
 */
export class ClienteIntegracao {
  private readonly base: string;
  private readonly recurso: string;
  private readonly permissoes: readonly string[];
  private readonly dmsId: ClienteDmsId;
  private readonly ligacao: string | undefined;
  private readonly buscar: typeof fetch;
  private readonly tentativas: number;
  private readonly recuo: RecuoDaRepeticao;
  private readonly tempoLimiteMs: number;
  private readonly esperar: (ms: number) => Promise<void>;
  private readonly sorteio: () => number;
  private readonly relogio: () => number;

  constructor(o: OpcoesClienteIntegracao) {
    this.base = o.base.replace(/\/+$/, '');
    this.recurso = o.recurso;
    this.permissoes = [...o.permissoes];
    this.dmsId = o.dmsId;
    this.ligacao = o.ligacao;
    this.buscar = o.buscar ?? fetch;
    this.tentativas = Math.max(1, Math.floor(o.tentativas ?? 4));
    this.recuo = { ...RECUO_PADRAO, ...o.recuo };
    this.tempoLimiteMs = o.tempoLimiteMs ?? 15_000;
    this.esperar = o.esperar ?? ((ms) => new Promise((resolver) => setTimeout(resolver, ms)));
    this.sorteio = o.sorteio ?? Math.random;
    this.relogio = o.relogio ?? Date.now;
  }

  /** Uma chamada à porta. Devolve a resposta final (qualquer status); só a falta de resposta, esgotadas as tentativas, vira `ErroPorta`. */
  async pedir(metodo: string, caminho: string, p: PedidoPorta = {}): Promise<RespostaPorta> {
    const url = new URL(this.base + (caminho.startsWith('/') ? caminho : `/${caminho}`));
    for (const [nome, valor] of Object.entries(p.consulta ?? {})) if (valor !== undefined) url.searchParams.set(nome, String(valor));
    const verbo = metodo.toUpperCase();
    const repete = podeRepetir(verbo, typeof p.idempotencia === 'string' && p.idempotencia !== '');
    let renovou = false;
    let tentativa = 0;
    for (;;) {
      tentativa += 1;
      const token = await this.dmsId.token(this.recurso, this.permissoes);
      const cabecalhos: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
      if (this.ligacao) cabecalhos[CABECALHO_LIGACAO] = this.ligacao;
      if (p.idempotencia) cabecalhos['idempotency-key'] = p.idempotencia;
      if (p.corpo !== undefined) cabecalhos['content-type'] = 'application/json';
      let r: Response | null = null;
      try {
        r = await this.buscar(url, {
          method: verbo,
          headers: cabecalhos,
          body: p.corpo === undefined ? undefined : JSON.stringify(p.corpo),
          redirect: 'error',
          signal: AbortSignal.timeout(this.tempoLimiteMs),
        });
      } catch {
        r = null;
      }
      const status = r ? r.status : 0;
      const corpo = r ? await corpoDaResposta(r) : null;
      const problema = problemaDaResposta(corpo);
      const retryAfter = r ? r.headers.get('retry-after') : null;
      if (status === 401 && !renovou && problema !== 'ligacao-invalida') {
        renovou = true;
        tentativa -= 1;
        this.dmsId.esquecer(this.recurso, this.permissoes);
        continue;
      }
      if (repete && respostaParaRepetir(status) && tentativa < this.tentativas) {
        await this.esperar(esperaDaRepeticao(tentativa, retryAfter, this.recuo, this.sorteio(), this.relogio()));
        continue;
      }
      if (!r) throw new ErroPorta(0, 'sem-resposta');
      return { status, corpo, problema, retryAfter, tentativas: tentativa };
    }
  }

  /**
   * Percorre uma lista do Padrão: pede a primeira página, depois cada `proximo_cursor`, até ele vir vazio. Status fora
   * de 2xx, resposta sem `itens` ou o mesmo cursor de novo viram `ErroPorta` (nunca uma lista cortada calada).
   */
  async *lerPorCursor<T = unknown>(caminho: string, o: { consulta?: Readonly<Record<string, string | number | undefined>>; limite?: number; maxPaginas?: number } = {}): AsyncGenerator<T, void, undefined> {
    const vistos = new Set<string>();
    let cursor: string | undefined;
    for (let pagina = 1; pagina <= (o.maxPaginas ?? 10_000); pagina += 1) {
      const consulta = { ...o.consulta, ...(o.limite === undefined ? {} : { limite: o.limite }), ...(cursor === undefined ? {} : { cursor }) };
      const r = await this.pedir('GET', caminho, { consulta });
      if (r.status < 200 || r.status >= 300) throw new ErroPorta(r.status, r.problema);
      const corpo = r.corpo as { itens?: unknown; proximo_cursor?: unknown } | null;
      if (!corpo || typeof corpo !== 'object' || !Array.isArray(corpo.itens)) throw new ErroPorta(r.status, 'resposta-sem-itens');
      for (const item of corpo.itens as unknown[]) yield item as T;
      const proximo = corpo.proximo_cursor;
      if (typeof proximo !== 'string' || proximo === '') return;
      if (vistos.has(proximo)) throw new ErroPorta(r.status, 'cursor-repetido');
      vistos.add(proximo);
      cursor = proximo;
    }
    throw new ErroPorta(200, 'paginas-demais');
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 9. O cliente do hub: registro central, erros, lista de parada e batida (Padrão §10 e §11; A4 da F2, 17/10/2026)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** As permissões que o aplicativo de cada produto tem no recurso do hub (contrato em docs/console-hub.md do hub). */
export const PERMISSOES_HUB: readonly string[] = ['registro.enviar', 'parada.ler'];

export type ResultadoChamada = 'aceita' | 'recusada' | 'erro';
export type CredencialChamada = 'dms_id' | 'token_integracao' | 'acesso_proprio';

/** Uma chamada recebida por uma porta do produto: quem chamou, o quê, quando, o resultado e a duração. Nunca o conteúdo. */
export type ChamadaRegistrada = {
  /** O código do pedido no produto (o `request_id`, 6 a 100 caracteres): o mesmo código de novo não duplica no hub. */
  codigo: string;
  /** Instante ISO 8601 com fuso. */
  ocorrido_em: string;
  aplicativo?: string;
  credencial: CredencialChamada;
  /** O prefixo visível da ligação ou da chave (`prefixoVisivel`), nunca o segredo. */
  ligacao_prefixo?: string;
  conta?: string;
  /** O nome comercial da empresa ou da loja, nunca o de uma pessoa. */
  conta_nome?: string;
  ferramenta: string;
  resultado: ResultadoChamada;
  /** O nome do problema do Padrão, quando recusada. */
  problema?: string;
  status_http?: number;
  duracao_ms?: number;
};

/**
 * O resultado de um aviso mandado (0.4.0): `entregue` (2xx), `recusado` (o destino respondeu 4xx, menos 408 e 429),
 * `falhou` (sem resposta, 5xx, 408, 429 ou redirecionamento, que não se segue) e `pausado` (o produto parou de mandar
 * para aquele destino depois de falhas seguidas).
 */
export type ResultadoAviso = 'entregue' | 'recusado' | 'falhou' | 'pausado';

/** Um aviso que o produto mandou a um aplicativo (Padrão §9 e §10; F3, parte D): para quem, qual, quando e o resultado. Nunca o conteúdo. */
export type AvisoRegistrado = {
  /** O id do envio (o `webhook-id`, 6 a 100 caracteres): o mesmo código de novo não duplica no hub. */
  codigo: string;
  /** Instante ISO 8601 com fuso. */
  ocorrido_em: string;
  /** Quem recebe. */
  aplicativo: string;
  /** O prefixo visível da ligação ou da chave do acesso a que o aviso pertence, nunca o segredo. */
  ligacao_prefixo?: string;
  conta?: string;
  /** O nome comercial da empresa ou da loja, nunca o de uma pessoa. */
  conta_nome?: string;
  /** O tipo do aviso, em minúsculas com ponto (`pedido.alterado`). */
  tipo: string;
  /** Só a origem do destino (`origemDoDestino`): sem caminho, sem parâmetro. */
  destino?: string;
  resultado: ResultadoAviso;
  status_http?: number;
  duracao_ms?: number;
  /** 1 = a primeira tentativa. */
  tentativa?: number;
};

/** O nome com que o aviso aparece na lista de parada (nível ferramenta) e no console: `aviso pedido.alterado`. */
export function ferramentaDoAviso(tipo: string): string {
  return `aviso ${tipo}`;
}

/** Só a origem de um endereço http(s) (`https://host[:porta]`), para o registro do aviso; outro formato: nada. */
export function origemDoDestino(endereco: unknown): string | undefined {
  try {
    const u = new URL(String(endereco));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    const origem = u.origin;
    return /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(origem) && origem.length <= 200 ? origem : undefined;
  } catch {
    return undefined;
  }
}

/** O resultado do aviso pelo status do destino (nulo = sem resposta) e por o produto ter pausado aquele destino. */
export function resultadoDoAviso(status: number | null, pausado = false): ResultadoAviso {
  if (pausado) return 'pausado';
  if (status !== null && status >= 200 && status < 300) return 'entregue';
  if (status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429) return 'recusado';
  return 'falhou';
}

export type OrigemErro = 'backend' | 'rotina' | 'tela' | 'servidor_loja' | 'app';
/** Um erro do produto. A mensagem passa por `limparMensagem` antes de sair; o mesmo erro junto vira uma quantidade. */
export type ErroDoProduto = { origem: OrigemErro; tipo: string; mensagem: string; lugar: string; codigo?: string; quando?: Date };

export type NivelParada = 'geral' | 'aplicativo' | 'ligacao' | 'ferramenta';
export type ItemDeParada = { nivel: NivelParada; produto: string | null; alvo: string | null };
export type ListaDeParada = { versao: number; itens: ItemDeParada[] };
/** O que o produto confere antes de atender: quem chama, por qual ligação e qual ferramenta. */
export type ChamadaAtendida = { aplicativo?: string | null; ligacaoPrefixo?: string | null; ferramenta?: string | null };

/**
 * A parada que vale para uma chamada (a primeira da lista que bate), ou nula. A geral e a de aplicativo valem em todo
 * produto; a de ligação e a de ferramenta, só no produto delas.
 */
export function paradaQueVale(lista: ListaDeParada | null, produto: Produto, c: ChamadaAtendida): ItemDeParada | null {
  if (!lista) return null;
  for (const i of lista.itens) {
    if (i.nivel === 'geral') return i;
    if (i.nivel === 'aplicativo' && c.aplicativo && i.alvo === c.aplicativo) return i;
    if (i.produto !== produto) continue;
    if (i.nivel === 'ligacao' && c.ligacaoPrefixo && i.alvo === c.ligacaoPrefixo) return i;
    if (i.nivel === 'ferramenta' && c.ferramenta && i.alvo === c.ferramenta) return i;
  }
  return null;
}

/** A chamada recusada pela parada (a lista do hub ou a chave própria "aceitar integrações: não" do produto). */
export function problemaDaParada(): ErroProblema {
  return new ErroProblema('integracao-parada', 'Esta integração está parada pela DMS no momento. Tente de novo mais tarde.', { retryAfterSeg: 60 });
}

/**
 * O que sai da mensagem de erro antes de ir ao hub (Padrão §11): segredo e token, e-mail, endereço com parâmetros,
 * identificador, documento, telefone e número longo. Toda expressão é linear (sem repetição aninhada) e o texto é
 * cortado antes, então o custo é limitado.
 */
const LIMPEZAS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <token>'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '<token>'],
  [/\b(?:rct_it|dms_lg|dms_ap|whsec)_[A-Za-z0-9_-]+/g, '<segredo>'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, '<e-mail>'],
  [/(\bhttps?:\/\/[^\s?#]+)[?#]\S*/gi, '$1?…'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>'],
  [/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '<documento>'],
  [/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '<documento>'],
  // telefone com o DDD separado ("(21) 3456-7890", "+55 21 9…"), celular sem separador (DDD + 9 + 8 dígitos) e número
  // local com hífen; sequência de dígitos sem forma de telefone vira "número" na linha seguinte
  [/(?<!\d)(?:\+?55[\s-]?)?(?:\(\d{2}\)[\s-]?|\d{2}[\s-])9?\d{4}[\s-]?\d{4}(?!\d)/g, '<telefone>'],
  [/(?<!\d)(?:\+?55)?\d{2}9\d{8}(?!\d)/g, '<telefone>'],
  [/(?<!\d)9?\d{4}-\d{4}(?!\d)/g, '<telefone>'],
  [/\d{6,}/g, '<número>'],
];

export function limparMensagem(texto: unknown, maximo = 300): string {
  let t = String(texto ?? '').slice(0, 2000);
  for (const [expressao, troca] of LIMPEZAS) t = t.replace(expressao, troca);
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return '(sem mensagem)';
  return t.length > maximo ? `${t.slice(0, maximo - 1)}…` : t;
}

type EventoErroHub = {
  evento_id: string;
  ocorrido_em: string;
  origem: OrigemErro;
  tipo: string;
  mensagem: string;
  lugar: string;
  versao: string;
  codigo?: string;
  quantidade: number;
};

export type OpcoesClienteHub = {
  /** O endereço do hub (`https://hub.dmstecnologias.com`). */
  url: string;
  /** O identificador do recurso do hub no DMS ID: o destino do token. */
  recurso: string;
  /** O cliente do DMS ID do produto (o aplicativo dele, com o segredo na configuração do servidor). */
  dmsId: ClienteDmsId;
  produto: Produto;
  /** A versão no ar (o commit), na batida e em cada erro. */
  versao: string;
  iniciadoEm?: Date;
  /** A chave própria "aceitar integrações" do produto: vai na batida. */
  aceitaIntegracoes?: () => boolean;
  /** A última lista de parada que o produto guardou: vale até o hub responder. */
  listaInicial?: ListaDeParada | null;
  /** Quando a lista muda (para o produto guardar a cópia). */
  aoMudarLista?: (lista: ListaDeParada) => void;
  /** Cada falha de envio ou de leitura, com o motivo (sem dado). */
  aoFalhar?: (motivo: string) => void;
  buscar?: typeof fetch;
  relogio?: () => number;
  tempoLimiteMs?: number;
  /** Quantas chamadas e quantos erros diferentes esperam no máximo; acima disso, sai o mais velho (e conta). */
  tetoDaFila?: number;
  intervalos?: { paradaMs?: number; envioMs?: number; batidaMs?: number };
};

const LOTE_REGISTRO = 500;
const LOTE_ERROS = 200;
const LOTE_AVISOS = 500;
const LOTE_ACOES = 100;
/** O hub que ainda não tem a rota dos avisos (404): o cliente para de mandar avisos por este tempo, e as chamadas seguem. */
export const PAUSA_AVISOS_SEM_ROTA_MS = 30 * 60_000;
/**
 * O hub que ainda não tem a rota das mudanças de pedido (404, antes da 0.7.0): o cliente espera este tempo e tenta de
 * novo. As mudanças ficam na fila (são eventos de segurança), até o teto dela.
 */
export const PAUSA_ACOES_SEM_ROTA_MS = 30 * 60_000;

const motivoDe = (erro: unknown) => (erro instanceof ErroDmsId ? erro.message : erro instanceof Error ? `${erro.name}: ${erro.message}`.slice(0, 200) : String(erro).slice(0, 200));

function listaValida(v: unknown): v is ListaDeParada {
  if (!v || typeof v !== 'object') return false;
  const l = v as { versao?: unknown; itens?: unknown };
  if (typeof l.versao !== 'number' || !Array.isArray(l.itens)) return false;
  return l.itens.every((i: unknown) => {
    const x = i as { nivel?: unknown; produto?: unknown; alvo?: unknown } | null;
    return !!x && ['geral', 'aplicativo', 'ligacao', 'ferramenta'].includes(String(x.nivel)) && (x.produto === null || typeof x.produto === 'string') && (x.alvo === null || typeof x.alvo === 'string');
  });
}

/**
 * O cliente do hub, um por processo do produto. `registrar`, `registrarAviso`, `registrarAcao` e `erro` só anotam (nunca
 * esperam o hub nem falham a chamada do produto); o envio sai em lote a cada 5 s. `parado` e `avisoParado` decidem pela
 * última lista recebida (lida a cada 15 s, só quando muda): se o hub cair, vale a cópia. `iniciar` liga os relógios;
 * `parar` os desliga e manda o que falta.
 */
export class ClienteHub {
  private readonly url: string;
  private readonly recurso: string;
  private readonly dmsId: ClienteDmsId;
  private readonly produto: Produto;
  private readonly versao: string;
  private readonly iniciadoEm: Date;
  private readonly aceitaIntegracoes: (() => boolean) | undefined;
  private readonly aoMudarLista: ((lista: ListaDeParada) => void) | undefined;
  private readonly aoFalhar: ((motivo: string) => void) | undefined;
  private readonly buscar: typeof fetch;
  private readonly relogio: () => number;
  private readonly tempoLimiteMs: number;
  private readonly teto: number;
  private readonly intervalos: { paradaMs: number; envioMs: number; batidaMs: number };
  private chamadas: ChamadaRegistrada[] = [];
  private avisos: AvisoRegistrado[] = [];
  private avisosParadosAte = 0;
  private acoes: AcaoRegistrada[] = [];
  private acoesParadasAte = 0;
  private readonly errosNovos = new Map<string, EventoErroHub>();
  private errosEmEspera: EventoErroHub[] = [];
  private lista: ListaDeParada | null;
  private listaLidaEm: number | null = null;
  private descartadas = 0;
  private esperarAte = 0;
  private ultimaFalha: string | null = null;
  private emEnvio: Promise<{ chamadas: number; erros: number; avisos: number; acoes: number }> | null = null;
  private readonly relogios: Array<ReturnType<typeof setInterval>> = [];

  constructor(o: OpcoesClienteHub) {
    this.url = o.url.replace(/\/+$/, '');
    this.recurso = o.recurso;
    this.dmsId = o.dmsId;
    this.produto = o.produto;
    this.versao = o.versao;
    this.iniciadoEm = o.iniciadoEm ?? new Date();
    this.aceitaIntegracoes = o.aceitaIntegracoes;
    this.aoMudarLista = o.aoMudarLista;
    this.aoFalhar = o.aoFalhar;
    this.buscar = o.buscar ?? fetch;
    this.relogio = o.relogio ?? Date.now;
    this.tempoLimiteMs = o.tempoLimiteMs ?? 5_000;
    this.teto = o.tetoDaFila ?? 5_000;
    this.intervalos = { paradaMs: o.intervalos?.paradaMs ?? 15_000, envioMs: o.intervalos?.envioMs ?? 5_000, batidaMs: o.intervalos?.batidaMs ?? 60_000 };
    this.lista = o.listaInicial ?? null;
  }

  /** Anota uma chamada para o registro central. */
  registrar(c: ChamadaRegistrada): void {
    this.chamadas.push(c);
    if (this.chamadas.length > this.teto) {
      const sobra = this.chamadas.length - this.teto;
      this.chamadas.splice(0, sobra);
      this.descartadas += sobra;
    }
  }

  /**
   * Anota um aviso mandado, para o registro do hub (0.4.0). Com o hub que ainda não recebe avisos (respondeu 404 na
   * rota), o aviso é descartado, contando, até a pausa acabar: as chamadas e os erros seguem como sempre.
   */
  registrarAviso(a: AvisoRegistrado): void {
    if (this.relogio() < this.avisosParadosAte) {
      this.descartadas += 1;
      return;
    }
    this.avisos.push(a);
    if (this.avisos.length > this.teto) {
      const sobra = this.avisos.length - this.teto;
      this.avisos.splice(0, sobra);
      this.descartadas += sobra;
    }
  }

  /**
   * Anota uma mudança de situação de um pedido de ação, para a cadeia de eventos do hub (0.7.0; `acaoParaRegistro` monta).
   * Com o hub que ainda não tem a rota (404), a mudança fica na fila e espera: é evento de segurança.
   */
  registrarAcao(a: AcaoRegistrada): void {
    this.acoes.push(a);
    if (this.acoes.length > this.teto) {
      const sobra = this.acoes.length - this.teto;
      this.acoes.splice(0, sobra);
      this.descartadas += sobra;
    }
  }

  /**
   * A parada que vale para um aviso, pela última lista recebida (nula: pode mandar). Confere o aplicativo que recebe,
   * cada prefixo do acesso (a chave e a ligação, quando as duas existem) e a ferramenta `aviso <tipo>`.
   */
  avisoParado(a: { aplicativo: string; ligacaoPrefixos?: readonly (string | null | undefined)[]; tipo: string }): ItemDeParada | null {
    const ferramenta = ferramentaDoAviso(a.tipo);
    const prefixos = (a.ligacaoPrefixos ?? []).filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (!prefixos.length) return paradaQueVale(this.lista, this.produto, { aplicativo: a.aplicativo, ferramenta });
    for (const ligacaoPrefixo of prefixos) {
      const p = paradaQueVale(this.lista, this.produto, { aplicativo: a.aplicativo, ligacaoPrefixo, ferramenta });
      if (p) return p;
    }
    return null;
  }

  /** Anota um erro. A mensagem, o tipo e o lugar saem limpos; o mesmo erro antes do envio só soma a quantidade. */
  erro(e: ErroDoProduto): void {
    const tipo = limparMensagem(e.tipo, 80);
    const mensagem = limparMensagem(e.mensagem, 300);
    const lugar = limparMensagem(e.lugar, 200);
    const chave = `${e.origem}\n${tipo}\n${lugar}\n${mensagem}`;
    const ja = this.errosNovos.get(chave);
    if (ja) {
      ja.quantidade += 1;
      return;
    }
    if (this.errosNovos.size >= this.teto) {
      this.descartadas += 1;
      return;
    }
    const codigo = e.codigo && /^[A-Za-z0-9_.:-]{6,100}$/.test(e.codigo) ? e.codigo : undefined;
    this.errosNovos.set(chave, {
      evento_id: randomUUID(),
      ocorrido_em: new Date(e.quando ? e.quando.getTime() : this.relogio()).toISOString(),
      origem: e.origem,
      tipo,
      mensagem,
      lugar,
      versao: this.versao.slice(0, 80),
      ...(codigo ? { codigo } : {}),
      quantidade: 1,
    });
  }

  /** A parada que vale para esta chamada, pela última lista recebida (nula: pode atender). */
  parado(c: ChamadaAtendida): ItemDeParada | null {
    return paradaQueVale(this.lista, this.produto, c);
  }

  get estado(): { fila: number; avisos: number; acoes: number; erros: number; descartadas: number; paradaVersao: number | null; paradaLidaEm: number | null; ultimaFalha: string | null } {
    return {
      fila: this.chamadas.length,
      avisos: this.avisos.length,
      acoes: this.acoes.length,
      erros: this.errosNovos.size + this.errosEmEspera.length,
      descartadas: this.descartadas,
      paradaVersao: this.lista ? this.lista.versao : null,
      paradaLidaEm: this.listaLidaEm,
      ultimaFalha: this.ultimaFalha,
    };
  }

  private falhou(motivo: string): void {
    this.ultimaFalha = motivo;
    if (this.aoFalhar) this.aoFalhar(motivo);
  }

  /** Um pedido ao hub com o token do DMS ID; o 401 joga o token fora e tenta uma vez de novo. */
  private async pedir(metodo: string, caminho: string, corpo?: unknown, cabecalhos: Record<string, string> = {}): Promise<Response> {
    let ultima: Response | null = null;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const token = await this.dmsId.token(this.recurso, PERMISSOES_HUB);
      ultima = await this.buscar(`${this.url}${caminho}`, {
        method: metodo,
        headers: { authorization: `Bearer ${token}`, ...(corpo === undefined ? {} : { 'content-type': 'application/json' }), ...cabecalhos },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(this.tempoLimiteMs),
      });
      if (ultima.status !== 401 || tentativa === 1) return ultima;
      await ultima.arrayBuffer().catch(() => null);
      this.dmsId.esquecer(this.recurso, PERMISSOES_HUB);
    }
    return ultima as Response;
  }

  /**
   * Manda um lote. 'ok' tira da fila; 'descartar' (o hub recusou o formato) também tira, contando; 'sem_rota' (404) e
   * o resto ficam. Os avisos e as mudanças de pedido tratam o 404 de outro jeito (o hub de antes não tem a rota deles).
   */
  private async mandar(caminho: string, corpo: unknown): Promise<'ok' | 'descartar' | 'depois' | 'sem_rota'> {
    let r: Response;
    try {
      r = await this.pedir('POST', caminho, corpo);
    } catch (erro) {
      this.falhou(`sem resposta do hub em ${caminho} (${motivoDe(erro)})`);
      return 'depois';
    }
    if (r.ok) {
      await r.arrayBuffer().catch(() => null);
      return 'ok';
    }
    const j = (await r.json().catch(() => null)) as { detail?: unknown } | null;
    const detalhe = j && typeof j.detail === 'string' ? `: ${j.detail.slice(0, 160)}` : '';
    this.falhou(`o hub respondeu ${r.status} em ${caminho}${detalhe}`);
    if (r.status === 429) {
      const seg = Number(r.headers.get('retry-after'));
      this.esperarAte = this.relogio() + (Number.isFinite(seg) && seg > 0 ? seg : 60) * 1000;
    }
    if (r.status === 404) return 'sem_rota';
    return r.status === 400 || r.status === 413 ? 'descartar' : 'depois';
  }

  /** Manda o que está na fila (registro, avisos, mudanças de pedido e erros, em lotes). Dois envios ao mesmo tempo viram um. */
  enviar(): Promise<{ chamadas: number; erros: number; avisos: number; acoes: number }> {
    if (this.emEnvio) return this.emEnvio;
    this.emEnvio = this.enviarAgora().finally(() => {
      this.emEnvio = null;
    });
    return this.emEnvio;
  }

  private async enviarAgora(): Promise<{ chamadas: number; erros: number; avisos: number; acoes: number }> {
    const feito = { chamadas: 0, erros: 0, avisos: 0, acoes: 0 };
    if (this.relogio() < this.esperarAte) return feito;
    while (this.chamadas.length) {
      const lote = this.chamadas.slice(0, LOTE_REGISTRO);
      const r = await this.mandar('/api/v1/registro', { chamadas: lote });
      if (r === 'depois' || r === 'sem_rota') break;
      // tira pelo próprio item: o que chegou durante o envio (ou saiu pelo teto) não se confunde com o lote
      const enviadas = new Set(lote);
      this.chamadas = this.chamadas.filter((c) => !enviadas.has(c));
      if (r === 'ok') feito.chamadas += lote.length;
      else this.descartadas += lote.length;
    }
    // Os avisos vão por rota própria: o hub de antes responde 404 a ela, e o que estava na fila sai (contado) até a
    // pausa acabar. As chamadas acima e os erros abaixo não dependem disso.
    while (this.avisos.length && this.relogio() >= this.esperarAte && this.relogio() >= this.avisosParadosAte) {
      const lote = this.avisos.slice(0, LOTE_AVISOS);
      const r = await this.mandar('/api/v1/avisos', { avisos: lote });
      if (r === 'depois') break;
      if (r === 'sem_rota') {
        this.avisosParadosAte = this.relogio() + PAUSA_AVISOS_SEM_ROTA_MS;
        this.descartadas += this.avisos.length;
        this.avisos = [];
        break;
      }
      const enviados = new Set(lote);
      this.avisos = this.avisos.filter((a) => !enviados.has(a));
      if (r === 'ok') feito.avisos += lote.length;
      else this.descartadas += lote.length;
    }
    // As mudanças dos pedidos de ação (0.7.0) também vão por rota própria, mas são eventos de segurança: com o hub de
    // antes (404), ficam na fila e esperam a pausa, em vez de sair como os avisos.
    while (this.acoes.length && this.relogio() >= this.esperarAte && this.relogio() >= this.acoesParadasAte) {
      const lote = this.acoes.slice(0, LOTE_ACOES);
      const r = await this.mandar('/api/v1/acoes', { acoes: lote });
      if (r === 'depois') break;
      if (r === 'sem_rota') {
        this.acoesParadasAte = this.relogio() + PAUSA_ACOES_SEM_ROTA_MS;
        break;
      }
      const enviadas = new Set(lote);
      this.acoes = this.acoes.filter((x) => !enviadas.has(x));
      if (r === 'ok') feito.acoes += lote.length;
      else this.descartadas += lote.length;
    }
    // o erro que sai num lote não soma mais: a repetição do envio leva o mesmo evento_id (o hub não conta duas vezes)
    if (this.errosNovos.size) {
      this.errosEmEspera.push(...this.errosNovos.values());
      this.errosNovos.clear();
    }
    while (this.errosEmEspera.length && this.relogio() >= this.esperarAte) {
      const lote = this.errosEmEspera.slice(0, LOTE_ERROS);
      const r = await this.mandar('/api/v1/erros', { erros: lote });
      if (r === 'depois' || r === 'sem_rota') break;
      const enviados = new Set(lote);
      this.errosEmEspera = this.errosEmEspera.filter((e) => !enviados.has(e));
      if (r === 'ok') feito.erros += lote.length;
      else this.descartadas += lote.length;
    }
    return feito;
  }

  /** Lê a lista de parada (só quando muda: ETag). Falhou: fica a última. */
  async lerParada(): Promise<ListaDeParada | null> {
    let r: Response;
    try {
      r = await this.pedir('GET', '/api/v1/parada', undefined, this.lista ? { 'if-none-match': `"v${this.lista.versao}"` } : {});
    } catch (erro) {
      this.falhou(`sem resposta do hub na lista de parada (${motivoDe(erro)})`);
      return this.lista;
    }
    if (r.status === 304) {
      await r.arrayBuffer().catch(() => null);
      this.listaLidaEm = this.relogio();
      return this.lista;
    }
    if (!r.ok) {
      await r.arrayBuffer().catch(() => null);
      this.falhou(`o hub respondeu ${r.status} na lista de parada`);
      return this.lista;
    }
    const j: unknown = await r.json().catch(() => null);
    if (!listaValida(j)) {
      this.falhou('a lista de parada veio fora do formato');
      return this.lista;
    }
    const mudou = !this.lista || this.lista.versao !== j.versao;
    this.lista = { versao: j.versao, itens: j.itens.map((i) => ({ nivel: i.nivel, produto: i.produto, alvo: i.alvo })) };
    this.listaLidaEm = this.relogio();
    if (mudou && this.aoMudarLista) this.aoMudarLista(this.lista);
    return this.lista;
  }

  /** A batida: a versão, desde quando, a chave própria e a lista lida. A lista mais nova no hub faz ler na hora. */
  async bater(): Promise<boolean> {
    const corpo: Record<string, unknown> = { versao: this.versao.slice(0, 80), iniciado_em: this.iniciadoEm.toISOString() };
    if (this.aceitaIntegracoes) corpo.aceita_integracoes = this.aceitaIntegracoes();
    if (this.lista) corpo.parada_versao_lida = this.lista.versao;
    let r: Response;
    try {
      r = await this.pedir('POST', '/api/v1/batida', corpo);
    } catch (erro) {
      this.falhou(`sem resposta do hub na batida (${motivoDe(erro)})`);
      return false;
    }
    if (!r.ok) {
      await r.arrayBuffer().catch(() => null);
      this.falhou(`o hub respondeu ${r.status} na batida`);
      return false;
    }
    const j = (await r.json().catch(() => null)) as { parada_versao?: unknown } | null;
    if (j && typeof j.parada_versao === 'number' && (!this.lista || j.parada_versao > this.lista.versao)) await this.lerParada();
    return true;
  }

  /** Liga os relógios (lista, envio e batida) e lê a lista e bate na hora. Nada aqui segura o processo aberto. */
  iniciar(): void {
    if (this.relogios.length) return;
    const cada = (ms: number, fn: () => Promise<unknown>) => {
      const t = setInterval(() => {
        fn().catch((erro: unknown) => this.falhou(motivoDe(erro)));
      }, ms);
      t.unref();
      this.relogios.push(t);
    };
    cada(this.intervalos.paradaMs, () => this.lerParada());
    cada(this.intervalos.envioMs, () => this.enviar());
    cada(this.intervalos.batidaMs, () => this.bater());
    this.bater().catch((erro: unknown) => this.falhou(motivoDe(erro)));
  }

  /** Desliga os relógios e manda o que falta (uma vez). */
  async parar(): Promise<void> {
    for (const t of this.relogios) clearInterval(t);
    this.relogios.length = 0;
    await this.enviar().catch((erro: unknown) => this.falhou(motivoDe(erro)));
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 10. O manifesto do produto (Padrão §13; decisões F4-1 e F4-2 de 23/10/2026)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//
// OpenAPI 3.1 com campos `x-dms`. Cada produto monta o seu a partir do próprio código (`montarManifesto`: as permissões
// com a frase e o teto, as rotas, as ferramentas MCP e os avisos), serve em `GET /.well-known/dms-manifesto`, sem
// credencial (é a documentação pública da porta de integração, e só dela), e confere com `conferirManifesto` no próprio
// CI; o kit, no modo `manifesto`, confere o mesmo. O portal desenha a documentação a partir dele, e o simulador também.

/** Onde o produto serve o manifesto, sem credencial. */
export const CAMINHO_MANIFESTO = '/.well-known/dms-manifesto';
export const CLASSES_DO_PADRAO: readonly Classe[] = ['dms', 'parceiro', 'proprio'];

export type PermissaoNoManifesto = {
  /** A frase que o dono da loja lê na tela de autorização (Padrão §3 e §4). */
  frase: string;
  /** As classes que podem ter a permissão: o teto, que mora no código do produto (Padrão §1). */
  classes: readonly Classe[];
  /** Dado pessoal ou dinheiro: vai num bloco próprio da tela, desligado (Padrão §4). */
  sensivel: boolean;
};
export type LimiteNoManifesto = { porMinuto: number; por: 'ligacao' | 'chave' | 'empresa' };
export type MetodoRest = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type RotaNoManifesto = {
  metodo: MetodoRest;
  /** O caminho com os parâmetros entre chaves, como no OpenAPI: `/integracao/v1/fichas/{id}`. */
  caminho: string;
  resumo: string;
  /** A permissão que a rota exige; nula = qualquer credencial válida da empresa. */
  permissao: string | null;
  /** Só na escrita: `chave` = `Idempotency-Key` obrigatória; `substituicao` = o envio troca o conjunto inteiro (§5). */
  escrita?: 'chave' | 'substituicao';
  /** Sem isto, vale o limite do manifesto. */
  limite?: LimiteNoManifesto;
  /** O status do sucesso (padrão 200). O 204 é sem corpo. */
  status?: number;
  exemploPedido?: unknown;
  /** O exemplo do sucesso: obrigatório, menos no 204. */
  exemploResposta?: unknown;
};
export type FerramentaNoManifesto = { nome: string; descricao: string; permissao: string | null; esquemaEntrada: Record<string, unknown> };
export type AvisoNoManifesto = {
  /** Em minúsculas com ponto (`pedido.alterado`). */
  tipo: string;
  permissao: string | null;
  descricao: string;
  /** Só o gatilho: o tipo e os ids, nunca dado pessoal (Padrão §9). */
  exemplo: Record<string, unknown>;
};
export type EntradaManifesto = {
  produto: Produto;
  /** A versão do contrato (Padrão §12), como `1.0.0`. */
  versao: string;
  titulo: string;
  descricao?: string;
  /** O endereço da porta, até a versão. */
  base: string;
  permissoes: Readonly<Record<string, PermissaoNoManifesto>>;
  limite: LimiteNoManifesto;
  rotas: readonly RotaNoManifesto[];
  ferramentas?: readonly FerramentaNoManifesto[];
  avisos?: readonly AvisoNoManifesto[];
  /** As credenciais que a porta aceita (0.7.1). Sem isto, as duas do Padrão (§2.1 e §2.2). */
  credenciais?: readonly CredencialDoManifesto[];
};
/** `dms_id` = o token do DMS ID com o segredo da ligação (§2.1); `acesso_proprio` = a chave `dms_ap_` (§2.2). */
export type CredencialDoManifesto = 'dms_id' | 'acesso_proprio';
export type ManifestoDms = Record<string, unknown>;

const METODOS_REST: readonly string[] = ['get', 'post', 'put', 'patch', 'delete'];
/**
 * `recurso.acao` (duas partes ou mais), em minúsculas, só com letras, números e _: a primeira parte começa por letra; as
 * outras podem começar por número (`vendas.99food.ler`, no ar no Regem), como o tipo de aviso no contrato do hub.
 */
const nomeComPonto = (v: string): boolean => {
  const partes = v.split('.');
  return v.length <= 100 && partes.length >= 2 && partes.every((parte, i) => (i === 0 ? /^[a-z][a-z0-9_]*$/.test(parte) : /^[a-z0-9_][a-z0-9_]*$/.test(parte)));
};
const NOME_DE_FERRAMENTA = /^[a-z][a-z0-9_]{1,63}$/;
const VERSAO_DO_CONTRATO = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const CAMPO_PESSOAL_NO_AVISO = /^(nome|name|e_?mail|telefone|fone|phone|celular|whatsapp|cpf|documento|endereco|address|nascimento)$/i;
/** E-mail, CPF com pontuação e telefone com +55. */
const TEXTO_PESSOAL_NO_AVISO: readonly RegExp[] = [/[^\s@"]{1,64}@[^\s@"]{1,255}\.[A-Za-z]{2,24}/, /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, /\+55\s?\(?\d{2}\)?\s?\d{4,5}/];
const TETO_DO_MANIFESTO = 1024 * 1024;
const TETO_DO_GATILHO = 4 * 1024;

const ehObjetoSimples = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const parametrosDoCaminho = (caminho: string): string[] => [...caminho.matchAll(/\{([A-Za-z0-9_]{1,64})\}/g)].map((m) => m[1] ?? '');
const idDaOperacao = (metodo: string, caminho: string): string =>
  `${metodo.toLowerCase()}_${caminho.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;

/** Monta o manifesto (OpenAPI 3.1 com os campos `x-dms`) a partir do que o produto declara no próprio código. */
export function montarManifesto(e: EntradaManifesto): ManifestoDms {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of e.rotas) {
    const operacao: Record<string, unknown> = { operationId: idDaOperacao(r.metodo, r.caminho), summary: r.resumo, 'x-dms-permissao': r.permissao };
    if (r.escrita) operacao['x-dms-escrita'] = r.escrita;
    if (r.limite) operacao['x-dms-limite'] = { porMinuto: r.limite.porMinuto, por: r.limite.por };
    const parametros: Record<string, unknown>[] = parametrosDoCaminho(r.caminho).map((nome) => ({ name: nome, in: 'path', required: true, schema: { type: 'string' } }));
    // a chave da REST tem de 1 a 255 caracteres visíveis (§5; `chaveIdempotenciaRestValida`)
    if (r.escrita === 'chave') parametros.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 1, maxLength: 255 } });
    if (parametros.length) operacao.parameters = parametros;
    if (r.exemploPedido !== undefined) operacao.requestBody = { required: true, content: { 'application/json': { example: r.exemploPedido } } };
    const status = r.status ?? 200;
    operacao.responses = {
      [String(status)]: status === 204 ? { description: 'Sucesso, sem corpo' } : { description: 'Sucesso', content: { 'application/json': { example: r.exemploResposta } } },
      default: { description: 'Erro no formato do Padrão (§7)', content: { [TIPO_CONTEUDO_PROBLEMA]: { schema: { $ref: '#/components/schemas/Problema' } } } },
    };
    const item = paths[r.caminho] ?? {};
    item[r.metodo.toLowerCase()] = operacao;
    paths[r.caminho] = item;
  }
  const credenciais: readonly CredencialDoManifesto[] = e.credenciais && e.credenciais.length ? e.credenciais : ['dms_id', 'acesso_proprio'];
  const esquemas: Record<string, unknown> = {};
  if (credenciais.includes('dms_id')) {
    esquemas.dmsId = { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: `Token do DMS ID, com o segredo da ligação no cabeçalho ${CABECALHO_LIGACAO} (Padrão §2.1)` };
  }
  if (credenciais.includes('acesso_proprio')) esquemas.acessoProprio = { type: 'http', scheme: 'bearer', description: 'A chave dms_ap_ do acesso próprio (Padrão §2.2)' };
  return {
    openapi: '3.1.0',
    info: { title: e.titulo, version: e.versao, ...(e.descricao ? { description: e.descricao } : {}), 'x-dms-produto': e.produto, 'x-dms-pacote': VERSAO_PACOTE },
    servers: [{ url: e.base }],
    security: Object.keys(esquemas).map((nome) => ({ [nome]: [] })),
    paths,
    components: {
      securitySchemes: esquemas,
      schemas: {
        Problema: {
          type: 'object',
          required: ['type', 'title', 'status', 'detail'],
          properties: { type: { type: 'string', format: 'uri' }, title: { type: 'string' }, status: { type: 'integer' }, detail: { type: 'string' }, request_id: { type: 'string' } },
        },
      },
    },
    // cópias só com os campos do Padrão: mexer no manifesto não mexe nas tabelas do produto
    'x-dms-permissoes': Object.fromEntries(Object.entries(e.permissoes).map(([nome, p]) => [nome, { frase: p.frase, classes: [...p.classes], sensivel: p.sensivel }])),
    'x-dms-limite': { porMinuto: e.limite.porMinuto, por: e.limite.por },
    'x-dms-ferramentas': (e.ferramentas ?? []).map((f) => ({ nome: f.nome, descricao: f.descricao, permissao: f.permissao, esquemaEntrada: f.esquemaEntrada })),
    'x-dms-avisos': (e.avisos ?? []).map((a) => ({ tipo: a.tipo, permissao: a.permissao, descricao: a.descricao, exemplo: a.exemplo })),
  };
}

/** O que há de errado no exemplo de um aviso para "só gatilho" (Padrão §9). Nunca repete um valor: só o nome do campo. */
export function problemasDoGatilho(exemplo: unknown, tipo?: string): string[] {
  if (!ehObjetoSimples(exemplo)) return ['o exemplo não é um objeto JSON'];
  const problemas: string[] = [];
  if (typeof exemplo.tipo !== 'string' || !nomeComPonto(exemplo.tipo)) problemas.push('falta o "tipo" em minúsculas com ponto');
  else if (tipo !== undefined && exemplo.tipo !== tipo) problemas.push(`o "tipo" do exemplo não é "${tipo}"`);
  for (const [campo, valor] of Object.entries(exemplo)) {
    if (CAMPO_PESSOAL_NO_AVISO.test(campo)) problemas.push(`o campo "${campo}" é dado pessoal`);
    else if (valor !== null && typeof valor === 'object') problemas.push(`o campo "${campo}" traz um objeto, e o aviso leva só o tipo e os ids`);
    else if (typeof valor === 'string' && TEXTO_PESSOAL_NO_AVISO.some((r) => r.test(valor))) problemas.push(`o campo "${campo}" parece dado pessoal (e-mail, CPF ou telefone)`);
  }
  if (JSON.stringify(exemplo).length > TETO_DO_GATILHO) problemas.push(`o exemplo passa de ${TETO_DO_GATILHO} bytes`);
  return problemas;
}

function problemasDoLimite(v: unknown, onde: string): string[] {
  if (!ehObjetoSimples(v)) return [`${onde}: o limite precisa ser um objeto { porMinuto, por }`];
  const problemas: string[] = [];
  if (typeof v.porMinuto !== 'number' || !Number.isInteger(v.porMinuto) || v.porMinuto < 1) problemas.push(`${onde}: porMinuto precisa ser um inteiro de 1 para cima`);
  if (v.por !== 'ligacao' && v.por !== 'chave' && v.por !== 'empresa') problemas.push(`${onde}: "por" precisa ser ligacao, chave ou empresa`);
  return problemas;
}

/** O sucesso (2xx) tem exemplo em `application/json`? */
function temExemploDeSucesso(respostas: unknown): boolean {
  if (!ehObjetoSimples(respostas)) return false;
  return Object.entries(respostas).some(([status, r]) => {
    // o 204 é o sucesso sem corpo: vale sem exemplo, e só sem conteúdo
    if (status === '204') return ehObjetoSimples(r) && r.content === undefined;
    if (!/^2\d\d$/.test(status) || !ehObjetoSimples(r) || !ehObjetoSimples(r.content)) return false;
    const json = r.content['application/json'];
    return ehObjetoSimples(json) && (json.example !== undefined || (ehObjetoSimples(json.examples) && Object.keys(json.examples).length > 0));
  });
}

/**
 * Confere um manifesto (Padrão §13). Devolve o que está errado, vazio se nada: o formato (OpenAPI 3.1 e os campos
 * `x-dms`); que toda rota, ferramenta e aviso usa uma permissão declarada; que toda permissão tem a frase, as classes do
 * Padrão e diz se é sensível; que toda escrita diz como é idempotente; que todo sucesso tem exemplo; e que o exemplo de
 * cada aviso é só o gatilho.
 */
export function conferirManifesto(doc: unknown): string[] {
  if (!ehObjetoSimples(doc)) return ['o manifesto não é um objeto JSON'];
  const problemas: string[] = [];
  if (typeof doc.openapi !== 'string' || !doc.openapi.startsWith('3.1.')) problemas.push('openapi precisa ser 3.1.x');
  const info = doc.info;
  if (!ehObjetoSimples(info)) problemas.push('falta info');
  else {
    if (typeof info.title !== 'string' || !info.title.trim()) problemas.push('falta info.title');
    if (typeof info.version !== 'string' || !VERSAO_DO_CONTRATO.test(info.version)) problemas.push('info.version precisa ser a versão do contrato (como 1.0.0)');
    if (!ehProduto(info['x-dms-produto'])) problemas.push('info.x-dms-produto precisa ser um produto do Padrão (§2.3)');
  }
  // as credenciais que a porta aceita: cada item de security, um esquema do Padrão declarado em components (0.7.1)
  const componentes = doc.components;
  const esquemas = ehObjetoSimples(componentes) && ehObjetoSimples(componentes.securitySchemes) ? Object.keys(componentes.securitySchemes) : [];
  const seguranca = doc.security;
  const credenciaisBoas =
    Array.isArray(seguranca) &&
    seguranca.length > 0 &&
    seguranca.every((s) => ehObjetoSimples(s) && Object.keys(s).length === 1 && Object.keys(s).every((k) => (k === 'dmsId' || k === 'acessoProprio') && esquemas.includes(k)));
  if (!credenciaisBoas) problemas.push('falta dizer as credenciais que a porta aceita (security com dmsId ou acessoProprio, declarados em components.securitySchemes)');

  const declaradas = new Set<string>();
  const permissoes = doc['x-dms-permissoes'];
  if (!ehObjetoSimples(permissoes)) problemas.push('falta x-dms-permissoes');
  else {
    for (const [nome, v] of Object.entries(permissoes)) {
      declaradas.add(nome);
      if (!nomeComPonto(nome)) problemas.push(`a permissão "${nome}" está fora do formato recurso.acao`);
      if (!ehObjetoSimples(v)) {
        problemas.push(`a permissão "${nome}" precisa ser um objeto`);
        continue;
      }
      if (typeof v.frase !== 'string' || !v.frase.trim() || v.frase.length > 200) problemas.push(`a permissão "${nome}" precisa da frase que o dono lê (até 200 caracteres)`);
      const classes = v.classes;
      const classesBoas = Array.isArray(classes) && classes.length > 0 && new Set(classes).size === classes.length && classes.every((c) => CLASSES_DO_PADRAO.includes(c as Classe));
      if (!classesBoas) problemas.push(`a permissão "${nome}" precisa das classes que podem tê-la, sem repetir (dms, parceiro, proprio)`);
      if (typeof v.sensivel !== 'boolean') problemas.push(`a permissão "${nome}" precisa dizer se é sensível`);
    }
  }
  const usa = (onde: string, permissao: unknown): void => {
    if (permissao === null) return;
    if (typeof permissao !== 'string') problemas.push(`${onde}: a permissão precisa ser um nome ou null`);
    else if (!declaradas.has(permissao)) problemas.push(`${onde}: a permissão "${permissao}" não está em x-dms-permissoes`);
  };
  problemas.push(...problemasDoLimite(doc['x-dms-limite'], 'x-dms-limite'));

  const paths = doc.paths;
  if (!ehObjetoSimples(paths)) problemas.push('falta paths');
  else {
    for (const [caminho, item] of Object.entries(paths)) {
      if (!caminho.startsWith('/')) problemas.push(`o caminho "${caminho}" precisa começar por /`);
      if (!ehObjetoSimples(item)) {
        problemas.push(`${caminho}: precisa ser um objeto`);
        continue;
      }
      const nomes = parametrosDoCaminho(caminho);
      for (const [metodo, op] of Object.entries(item)) {
        if (!METODOS_REST.includes(metodo)) continue;
        const onde = `${metodo.toUpperCase()} ${caminho}`;
        if (!ehObjetoSimples(op)) {
          problemas.push(`${onde}: precisa ser um objeto`);
          continue;
        }
        if (typeof op.summary !== 'string' || !op.summary.trim()) problemas.push(`${onde}: falta o resumo (summary)`);
        if (!('x-dms-permissao' in op)) problemas.push(`${onde}: falta x-dms-permissao (o nome, ou null para qualquer credencial)`);
        else usa(onde, op['x-dms-permissao']);
        if (op['x-dms-limite'] !== undefined) problemas.push(...problemasDoLimite(op['x-dms-limite'], onde));
        if (metodo !== 'get' && op['x-dms-escrita'] !== 'chave' && op['x-dms-escrita'] !== 'substituicao') {
          problemas.push(`${onde}: a escrita precisa de x-dms-escrita (chave ou substituicao, Padrão §5)`);
        }
        const params = Array.isArray(op.parameters) ? op.parameters : [];
        for (const nome of nomes) {
          if (!params.some((x) => ehObjetoSimples(x) && x.in === 'path' && x.name === nome && x.required === true)) problemas.push(`${onde}: falta o parâmetro de caminho "${nome}"`);
        }
        const temChave = params.some((x) => ehObjetoSimples(x) && x.in === 'header' && typeof x.name === 'string' && x.name.toLowerCase() === 'idempotency-key' && x.required === true);
        if (op['x-dms-escrita'] === 'chave' && !temChave) problemas.push(`${onde}: a escrita por chave precisa do cabeçalho Idempotency-Key obrigatório`);
        if (!temExemploDeSucesso(op.responses)) problemas.push(`${onde}: o sucesso (2xx) precisa de um exemplo em application/json (ou 204, sem corpo)`);
      }
    }
  }

  const ferramentas = doc['x-dms-ferramentas'];
  if (ferramentas !== undefined && !Array.isArray(ferramentas)) problemas.push('x-dms-ferramentas precisa ser uma lista');
  else {
    for (const f of ferramentas ?? []) {
      if (!ehObjetoSimples(f)) {
        problemas.push('uma ferramenta não é um objeto');
        continue;
      }
      const onde = `a ferramenta "${String(f.nome)}"`;
      if (typeof f.nome !== 'string' || !NOME_DE_FERRAMENTA.test(f.nome)) problemas.push(`${onde}: o nome precisa ter de 2 a 64 letras minúsculas, números e _`);
      if (typeof f.descricao !== 'string' || !f.descricao.trim()) problemas.push(`${onde}: falta a descrição`);
      usa(onde, f.permissao);
      if (!ehObjetoSimples(f.esquemaEntrada) || f.esquemaEntrada.type !== 'object') problemas.push(`${onde}: o esquema de entrada precisa ser um objeto JSON Schema (type: object)`);
    }
  }

  const avisos = doc['x-dms-avisos'];
  if (avisos !== undefined && !Array.isArray(avisos)) problemas.push('x-dms-avisos precisa ser uma lista');
  else {
    for (const a of avisos ?? []) {
      if (!ehObjetoSimples(a)) {
        problemas.push('um aviso não é um objeto');
        continue;
      }
      const onde = `o aviso "${String(a.tipo)}"`;
      if (typeof a.tipo !== 'string' || !nomeComPonto(a.tipo)) problemas.push(`${onde}: o tipo precisa ser em minúsculas com ponto (pedido.alterado)`);
      if (typeof a.descricao !== 'string' || !a.descricao.trim()) problemas.push(`${onde}: falta a descrição`);
      usa(onde, a.permissao);
      for (const p of problemasDoGatilho(a.exemplo, typeof a.tipo === 'string' ? a.tipo : undefined)) problemas.push(`${onde}: ${p}`);
    }
  }

  if (JSON.stringify(doc).length > TETO_DO_MANIFESTO) problemas.push('o manifesto passa de 1 MB');
  return problemas;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 11. O pedido de ação: R2 e R3 esperam uma pessoa no destino (Padrão §8; F5, decisões de 23/10/2026)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//
// Quem pede pela porta de integração uma ação R2 (mensagem a cliente) ou R3 (dinheiro ou orçamento) não a executa: o
// produto de destino guarda um pedido preso ao plano, uma pessoa aprova na tela dele, com o segundo fator, e só então
// ele executa, uma vez. As regras ficam aqui para todo produto decidir igual; a tela, o segundo fator, a guarda e a
// execução são de cada um. `casosDoPedidoDeAcao` são os testes comuns, que cada produto roda contra o próprio serviço.

export type NivelDeRisco = 'R0' | 'R1' | 'R2' | 'R3';

/** R2 e R3 esperam a aprovação de uma pessoa no produto de destino, também quando quem pede é produto DMS (§8). */
export function pedeAprovacaoNoDestino(risco: NivelDeRisco): boolean {
  return risco === 'R2' || risco === 'R3';
}

/**
 * As situações do pedido. `executando` é gravado de forma condicional (`… where situacao = 'aprovado'`) quando a
 * execução começa: a aprovação vale uma vez só, e quem tentar depois encontra o pedido tomado (`aprovacao-usada`).
 */
export const SITUACOES_DO_PEDIDO = ['aguardando', 'aprovado', 'executando', 'executado', 'recusado', 'vencido', 'cancelado', 'falhou'] as const;
export type SituacaoDoPedido = (typeof SITUACOES_DO_PEDIDO)[number];

/** As situações de onde o pedido não sai. */
export const SITUACOES_FINAIS: readonly SituacaoDoPedido[] = ['executado', 'recusado', 'vencido', 'cancelado', 'falhou'];

const TRANSICOES_DO_PEDIDO: Readonly<Record<SituacaoDoPedido, readonly SituacaoDoPedido[]>> = {
  aguardando: ['aprovado', 'recusado', 'vencido', 'cancelado'],
  aprovado: ['executando', 'vencido', 'cancelado'],
  executando: ['executado', 'falhou'],
  executado: [],
  recusado: [],
  vencido: [],
  cancelado: [],
  falhou: [],
};

export function ehSituacaoDoPedido(v: unknown): v is SituacaoDoPedido {
  return typeof v === 'string' && (SITUACOES_DO_PEDIDO as readonly string[]).includes(v);
}

/** O pedido pode ir de `de` para `para`? A gravação no produto é condicional a `de`, para duas mudanças não passarem juntas. */
export function transicaoDoPedido(de: SituacaoDoPedido, para: SituacaoDoPedido): boolean {
  return ehSituacaoDoPedido(de) && TRANSICOES_DO_PEDIDO[de].includes(para);
}

/** O prazo do pedido (decisão F5-4): 24 horas desde que nasceu, com o lembrete a quem aprova na metade. */
export const PRAZO_DO_PEDIDO_HORAS = 24;
const HORA_MS = 3_600_000;

export function vencimentoDoPedido(criadoEm: Date): Date {
  return new Date(criadoEm.getTime() + PRAZO_DO_PEDIDO_HORAS * HORA_MS);
}

export function lembreteDoPedido(criadoEm: Date): Date {
  return new Date(criadoEm.getTime() + (PRAZO_DO_PEDIDO_HORAS * HORA_MS) / 2);
}

/**
 * A situação de agora: o pedido aguardando ou aprovado que passou do prazo está vencido, antes mesmo de a rotina do
 * produto gravar. A leitura, a consulta e as conferências usam esta.
 */
export function situacaoAgora(p: { situacao: SituacaoDoPedido; venceEm: Date }, agora: Date): SituacaoDoPedido {
  return (p.situacao === 'aguardando' || p.situacao === 'aprovado') && agora.getTime() >= p.venceEm.getTime() ? 'vencido' : p.situacao;
}

/**
 * O resumo do plano: SHA-256, em hexadecimal, do plano em JSON com as chaves em ordem (`jsonCanonico`). O plano leva
 * tudo o que a pessoa vê para aprovar (o texto, o público, quantos recebem, o custo estimado, o cupom, o recurso e a
 * versão dele): mudou qualquer coisa, muda o resumo, e a aprovação antiga não vale. É a conta do `planHashOf` do Liame;
 * os campos, cada produto escolhe.
 */
export function resumoDoPlano(plano: unknown): string {
  return createHash('sha256').update(jsonCanonico(plano ?? null), 'utf8').digest('hex');
}

/**
 * O resumo de uma pessoa, para "quem pede não aprova" entre produtos (decisão F5-3): SHA-256 do e-mail sem espaços nas
 * pontas e em minúsculas. Quem pede manda o resumo, nunca o e-mail, e o destino compara com o de quem aprova. A mesma
 * pessoa com dois e-mails não é pega por aqui; o registro dos dois lados mostra quem pediu e quem aprovou.
 */
export function resumoDaPessoa(email: string): string {
  return createHash('sha256').update(String(email).trim().toLowerCase(), 'utf8').digest('hex');
}

const RESUMO_SHA256 = /^[0-9a-f]{64}$/;

/** Quem fez o pedido no produto de origem: o agente, sem pessoa, ou uma pessoa, pelo `resumoDaPessoa` do e-mail. */
export type QuemPede = { tipo: 'agente' } | { tipo: 'pessoa'; pessoa: string };

/** `{ "tipo": "agente" }` ou `{ "tipo": "pessoa", "pessoa": "<resumo>" }`, sem outro campo: é o que vai no pedido. */
export function quemPedeValido(v: unknown): v is QuemPede {
  if (!ehObjetoSimples(v)) return false;
  const chaves = Object.keys(v).sort().join(',');
  if (v.tipo === 'agente') return chaves === 'tipo';
  return v.tipo === 'pessoa' && chaves === 'pessoa,tipo' && typeof v.pessoa === 'string' && RESUMO_SHA256.test(v.pessoa);
}

/** O pedido como o produto de destino o guarda (as colunas são de cada um). */
export type PedidoDeAcao = {
  id: string;
  /** A ferramenta ou a rota da ação (`campanhas_disparar`). */
  acao: string;
  risco: 'R2' | 'R3';
  situacao: SituacaoDoPedido;
  resumoDoPlano: string;
  /** O aplicativo que pediu (`liame`). */
  aplicativo: string;
  pedidoPor: QuemPede;
  criadoEm: Date;
  venceEm: Date;
  /** Quando foi aprovado, recusado, cancelado ou venceu. */
  decididoEm?: Date | null;
  /** O teto de gasto que quem aprovou fixou para esta execução, em centavos (decisão F5-6). */
  tetoDeGastoCentavos?: number | null;
  /** Por que acabou sem executar, ou parou: o nome do problema (`plano-mudou`, `teto-de-gasto`). */
  motivo?: TipoProblema | null;
  /** O que quem recusou escreveu (sai limpo na consulta). */
  motivoDaRecusa?: string | null;
};

/** Quem aprova, na tela do destino, e o que a tela conferiu. */
export type Aprovacao = {
  /** O `resumoDaPessoa` do e-mail de quem aprova. */
  pessoa: string;
  /** É o dono da conta, ou tem a permissão de aprovar que ele deu (decisão F5-2). */
  podeAprovar: boolean;
  /** O código do aplicativo autenticador foi conferido agora, para esta aprovação (decisão F5-1). */
  segundoFator: boolean;
  /** O resumo do plano que a tela mostrou. */
  resumoVisto: string;
  /** O teto de gasto desta execução, em centavos (decisão F5-6). */
  tetoDeGastoCentavos?: number | null;
};

/** As mensagens de erro do pedido, iguais em todos os produtos: em pt-BR, dizendo o que fazer. */
const MENSAGENS_DO_PEDIDO = {
  'aprovacao-pendente': 'A ação espera a aprovação de uma pessoa no produto de destino. O resultado chega por aviso, e o pedido pode ser consultado.',
  'aprovacao-recusada': 'A pessoa que aprova recusou o pedido. Para tentar de novo, faça um pedido novo.',
  'aprovacao-vencida': 'O pedido venceu sem ser executado (o prazo é de 24 horas). Faça um pedido novo.',
  'plano-mudou': 'O plano mudou depois do pedido, e a aprovação vale só para o plano que a pessoa viu. Faça um pedido novo.',
  'aprovacao-usada': 'Este pedido já foi aprovado, e a aprovação vale uma vez só. Para repetir a ação, faça um pedido novo.',
  'pedido-cancelado': 'O pedido foi cancelado antes de executar. Para tentar de novo, faça um pedido novo.',
  'aprovacao-propria': 'Quem pediu não aprova o próprio pedido de mensagem ou de gasto. Outra pessoa, com a permissão de aprovar, aprova.',
  'segundo-fator-invalido': 'Aprovar pede o código de agora do aplicativo autenticador. Confira o código e tente de novo.',
  'teto-de-gasto': 'A execução chegou ao teto de gasto aprovado e parou. Para seguir, faça um pedido novo, com outro teto.',
} as const satisfies Partial<Record<TipoProblema, string>>;

export type ProblemaDoPedido = keyof typeof MENSAGENS_DO_PEDIDO;

/** O erro do pedido com a mensagem comum a todos os produtos (o título e o status vêm de `PROBLEMAS`). */
export function problemaDoPedido(tipo: ProblemaDoPedido): ErroProblema {
  return new ErroProblema(tipo, MENSAGENS_DO_PEDIDO[tipo]);
}

/** O erro de quem tenta aprovar, recusar ou executar um pedido que não está onde devia. */
function problemaDoPedidoFora(situacao: SituacaoDoPedido, motivo: TipoProblema | null | undefined): ErroProblema {
  if (situacao === 'aguardando') return problemaDoPedido('aprovacao-pendente');
  if (situacao === 'recusado') return problemaDoPedido('aprovacao-recusada');
  if (situacao === 'vencido') return problemaDoPedido('aprovacao-vencida');
  if (situacao === 'cancelado') return problemaDoPedido(motivo === 'plano-mudou' ? 'plano-mudou' : 'pedido-cancelado');
  return problemaDoPedido('aprovacao-usada');
}

/** Centavos de um valor que existe: inteiro e maior que zero. */
const centavosPositivos = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
/** Centavos que podem ser zero: inteiro e sem sinal. */
const centavosSemSinal = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/**
 * A aprovação vale? Nulo = vale, e o produto grava `aprovado` (condicional a `aguardando`) com o teto. Senão, o erro com
 * a mensagem comum. A ordem é a do que a pessoa resolve primeiro: a permissão, o segundo fator, a situação (com o
 * prazo), quem pediu, o plano que ela viu e o teto. `exigeTeto` (padrão: R3) pede o teto de gasto desta execução.
 */
export function conferirAprovacao(p: PedidoDeAcao, a: Aprovacao, agora: Date, opcoes: { exigeTeto?: boolean } = {}): ErroProblema | null {
  if (a.podeAprovar !== true) return new ErroProblema('escopo-insuficiente', 'Só o dono da conta, ou quem ele autorizou, aprova este pedido.');
  if (a.segundoFator !== true) return problemaDoPedido('segundo-fator-invalido');
  const situacao = situacaoAgora(p, agora);
  if (situacao !== 'aguardando') return problemaDoPedidoFora(situacao, p.motivo);
  if (typeof a.pessoa !== 'string' || !RESUMO_SHA256.test(a.pessoa)) return new ErroProblema('parametro-invalido', 'Quem aprova vai pelo resumo do e-mail (resumoDaPessoa).');
  if (p.pedidoPor.tipo === 'pessoa' && p.pedidoPor.pessoa === a.pessoa) return problemaDoPedido('aprovacao-propria');
  if (a.resumoVisto !== p.resumoDoPlano) return problemaDoPedido('plano-mudou');
  const teto = a.tetoDeGastoCentavos;
  if (teto != null && !centavosPositivos(teto)) return new ErroProblema('parametro-invalido', 'O teto de gasto vai em centavos, inteiro e maior que zero.');
  if ((opcoes.exigeTeto ?? p.risco === 'R3') && teto == null) return new ErroProblema('parametro-invalido', 'Fixe o teto de gasto desta execução para aprovar.');
  return null;
}

/** A recusa vale? Recusar não executa nada: pede a permissão de aprovar, sem o segundo fator. */
export function conferirRecusa(p: PedidoDeAcao, a: { podeAprovar: boolean }, agora: Date): ErroProblema | null {
  if (a.podeAprovar !== true) return new ErroProblema('escopo-insuficiente', 'Só o dono da conta, ou quem ele autorizou, recusa este pedido.');
  const situacao = situacaoAgora(p, agora);
  return situacao === 'aguardando' ? null : problemaDoPedidoFora(situacao, p.motivo);
}

/**
 * O executor confere antes de executar, com o resumo do plano refeito agora (o público, o custo e o recurso de agora).
 * Nulo = pode tomar o pedido (`aprovado` → `executando`, gravação condicional) e executar uma vez.
 */
export function conferirExecucao(p: PedidoDeAcao, resumoAgora: string, agora: Date): ErroProblema | null {
  const situacao = situacaoAgora(p, agora);
  if (situacao !== 'aprovado') return problemaDoPedidoFora(situacao, p.motivo);
  if (resumoAgora !== p.resumoDoPlano) return problemaDoPedido('plano-mudou');
  return null;
}

/**
 * O teto de gasto, antes de cada lote (decisão F5-6): o já gasto mais o custo do próximo lote não passa do teto. Passou:
 * o lote não sai, a execução para com o motivo `teto-de-gasto`, e seguir pede um pedido novo. Sem teto: nulo.
 */
export function conferirTetoDeGasto(tetoCentavos: number | null | undefined, gastoCentavos: number, loteCentavos: number): ErroProblema | null {
  if (tetoCentavos == null) return null;
  if (!centavosPositivos(tetoCentavos) || !centavosSemSinal(gastoCentavos) || !centavosSemSinal(loteCentavos)) {
    return new ErroProblema('parametro-invalido', 'O teto e os gastos vão em centavos, inteiros e sem sinal.');
  }
  return gastoCentavos + loteCentavos > tetoCentavos ? problemaDoPedido('teto-de-gasto') : null;
}

/**
 * O pedido repetido, numa regra só (F5, parte A): a chave de repetição fica presa ao pedido enquanto ele existir. A
 * mesma chave com a mesma impressão (`impressaoPedido`) devolve o mesmo pedido como está agora, aprovado ou não, com
 * 202; com outra impressão, `chave-reutilizada`. Nulo = devolver o pedido guardado.
 */
export function conferirPedidoRepetido(impressaoGuardada: string, impressaoNova: string): ErroProblema | null {
  if (impressaoGuardada === impressaoNova) return null;
  return new ErroProblema('chave-reutilizada', 'Esta chave de repetição já foi usada num pedido com outro conteúdo. Para um pedido novo, use uma chave nova.');
}

/**
 * O pedido novo pode nascer? Só da classe `dms` (§1), só para R2 e R3, com o resumo do plano e com quem pede na forma
 * do pacote. Nulo = o produto grava `aguardando` com `vencimentoDoPedido` e responde 202 com `pedidoPublico`.
 */
export function conferirPedidoNovo(n: { classe: Classe; risco: NivelDeRisco; resumoDoPlano: string; pedidoPor: unknown }): ErroProblema | null {
  if (n.classe !== 'dms') return new ErroProblema('escopo-insuficiente', 'Mensagem a cliente e gasto só se pedem por produto da DMS.');
  if (!pedeAprovacaoNoDestino(n.risco)) return new ErroProblema('regra-invalida', 'Só ação R2 ou R3 vira pedido de aprovação; R0 e R1 seguem pela permissão.');
  if (typeof n.resumoDoPlano !== 'string' || !RESUMO_SHA256.test(n.resumoDoPlano)) {
    return new ErroProblema('parametro-invalido', 'O resumo do plano é o SHA-256 em hexadecimal (resumoDoPlano).');
  }
  if (!quemPedeValido(n.pedidoPor)) {
    return new ErroProblema('parametro-invalido', 'Quem pede vai como {"tipo":"agente"} ou {"tipo":"pessoa","pessoa":"<resumo do e-mail>"}.');
  }
  return null;
}

/** O pedido como quem pediu o vê, na resposta do pedido e na consulta: sem dado pessoal, nem quem aprovou. */
export type PedidoPublico = {
  id: string;
  acao: string;
  risco: 'R2' | 'R3';
  situacao: SituacaoDoPedido;
  resumo_do_plano: string;
  criado_em: string;
  vence_em: string;
  decidido_em?: string;
  teto_de_gasto_centavos?: number;
  motivo?: string;
  motivo_da_recusa?: string;
  /** A tela de aprovação no destino, para quem pediu mostrar "esperando o destino" com o link (decisão F5-9). */
  tela?: string;
};

/** Só um endereço https, sem usuário nem senha, de até 500 caracteres. */
function enderecoHttps(endereco: unknown): string | undefined {
  if (typeof endereco !== 'string' || endereco.length > 500) return undefined;
  try {
    const u = new URL(endereco);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** O pedido para a resposta e a consulta: com a situação de agora (o que passou do prazo aparece vencido) e a tela só em https. */
export function pedidoPublico(p: PedidoDeAcao, agora: Date, tela?: string): PedidoPublico {
  const situacao = situacaoAgora(p, agora);
  const v: PedidoPublico = {
    id: p.id,
    acao: p.acao,
    risco: p.risco,
    situacao,
    resumo_do_plano: p.resumoDoPlano,
    criado_em: p.criadoEm.toISOString(),
    vence_em: p.venceEm.toISOString(),
  };
  if (p.decididoEm) v.decidido_em = p.decididoEm.toISOString();
  else if (situacao === 'vencido') v.decidido_em = p.venceEm.toISOString();
  if (centavosPositivos(p.tetoDeGastoCentavos)) v.teto_de_gasto_centavos = p.tetoDeGastoCentavos;
  if (p.motivo) v.motivo = p.motivo;
  if (situacao === 'recusado' && typeof p.motivoDaRecusa === 'string' && p.motivoDaRecusa.trim()) v.motivo_da_recusa = limparMensagem(p.motivoDaRecusa, 300);
  const endereco = enderecoHttps(tela);
  if (endereco) v.tela = endereco;
  return v;
}

/** O aviso a quem pediu, a cada mudança do pedido (decisão F5-7): só o gatilho, e quem recebe lê o pedido pela consulta. */
export const TIPO_AVISO_DO_PEDIDO = 'acao.alterada';

export function gatilhoDoPedido(id: string): { tipo: string; id: string } {
  return { tipo: TIPO_AVISO_DO_PEDIDO, id };
}

/** Quem mudou a situação, para o registro do hub: o papel, nunca o nome de uma pessoa. */
export type DecididoPor = 'dono' | 'autorizado' | 'prazo' | 'quem_pediu' | 'produto';

/**
 * Uma mudança de situação de um pedido, para a cadeia de eventos do hub (Padrão §10; `POST /api/v1/acoes`, pelo
 * `ClienteHub.registrarAcao`). Nada pessoal: quem decidiu vai pelo papel.
 */
export type AcaoRegistrada = {
  /** O código da mudança (6 a 100 caracteres): o mesmo código de novo não duplica no hub. */
  codigo: string;
  /** Instante ISO 8601 com fuso. */
  ocorrido_em: string;
  /** O id do pedido no produto. */
  pedido: string;
  acao: string;
  risco: 'R2' | 'R3';
  situacao: SituacaoDoPedido;
  /** O aplicativo que pediu. */
  aplicativo: string;
  pedido_por: 'agente' | 'pessoa';
  decidido_por?: DecididoPor;
  resumo_do_plano: string;
  /** O prefixo visível da ligação por onde veio o pedido, nunca o segredo. */
  ligacao_prefixo?: string;
  conta?: string;
  /** O nome comercial da empresa ou da loja, nunca o de uma pessoa. */
  conta_nome?: string;
  teto_de_gasto_centavos?: number;
  motivo?: string;
};

const pelaImpressao = (texto: string) => `h_${createHash('sha256').update(texto, 'utf8').digest('hex').slice(0, 40)}`;

/**
 * A mudança do pedido na forma do registro. O código sai do pedido e da situação (o pedido passa por cada situação uma
 * vez só), então a mesma mudança mandada de novo não duplica; o id fora da forma do hub vai pelo resumo.
 */
export function acaoParaRegistro(
  p: PedidoDeAcao,
  o: { ocorridoEm: Date; decididoPor?: DecididoPor; ligacaoPrefixo?: string; conta?: string; contaNome?: string },
): AcaoRegistrada {
  // A forma do hub (docs/console-hub.md): o pedido com 1 a 100 caracteres de letras, números e _ . : -. A regex é
  // ancorada, de uma classe de caracteres só e com tamanho limitado: tempo linear, sem retrocesso catastrófico.
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos
  const pedido = /^[A-Za-z0-9_.:-]{1,100}$/.test(p.id) ? p.id : pelaImpressao(p.id);
  // O código (de 6 a 100) já tem só caracteres da forma (o pedido, ":" e a situação) e pelo menos 8: falta o teto.
  const direto = `${pedido}:${p.situacao}`;
  const a: AcaoRegistrada = {
    codigo: direto.length <= 100 ? direto : pelaImpressao(direto),
    ocorrido_em: o.ocorridoEm.toISOString(),
    pedido,
    acao: p.acao.slice(0, 120),
    risco: p.risco,
    situacao: p.situacao,
    aplicativo: p.aplicativo.slice(0, 80),
    pedido_por: p.pedidoPor.tipo,
    resumo_do_plano: p.resumoDoPlano,
  };
  if (o.decididoPor) a.decidido_por = o.decididoPor;
  if (o.ligacaoPrefixo) a.ligacao_prefixo = o.ligacaoPrefixo;
  if (o.conta) a.conta = o.conta.slice(0, 80);
  if (o.contaNome) a.conta_nome = o.contaNome.slice(0, 120);
  if (centavosPositivos(p.tetoDeGastoCentavos)) a.teto_de_gasto_centavos = p.tetoDeGastoCentavos;
  if (p.motivo) a.motivo = p.motivo;
  return a;
}

/**
 * A exceção do estorno (decisão F5-10): devolver dinheiro ao cliente, por cancelamento que uma pessoa fez no produto
 * dono da venda, não pede aprovação no destino. O destino confere que a venda é dele e que a devolução, somada ao que já
 * devolveu, não passa do que foi pago. Desfazer venda que não foi paga não move dinheiro e também não pede aprovação:
 * basta a venda ser do destino. Nulo = pode devolver.
 */
export function conferirEstornoSemAprovacao(e: {
  vendaDoDestino: boolean;
  feitoPorPessoa: boolean;
  valorCentavos: number;
  pagoCentavos: number;
  jaDevolvidoCentavos?: number;
}): ErroProblema | null {
  if (e.vendaDoDestino !== true) return new ErroProblema('nao-encontrado', 'A venda não é deste produto, e o estorno não sai.');
  if (e.feitoPorPessoa !== true) {
    return new ErroProblema('regra-invalida', 'Sem aprovação no destino, só sai o estorno de um cancelamento feito por uma pessoa no produto dono da venda.');
  }
  const ja = e.jaDevolvidoCentavos ?? 0;
  if (!centavosPositivos(e.valorCentavos) || !centavosSemSinal(e.pagoCentavos) || !centavosSemSinal(ja)) {
    return new ErroProblema('parametro-invalido', 'Os valores do estorno vão em centavos, inteiros, e a devolução é maior que zero.');
  }
  if (ja + e.valorCentavos > e.pagoCentavos) return new ErroProblema('regra-invalida', 'A devolução passa do valor pago, somada ao que já foi devolvido.');
  return null;
}

/**
 * O que cada produto liga ao próprio serviço para rodar os casos comuns do pedido, com o relógio de mentira. A recusa se
 * lança como erro com o nome do problema em `tipo` (`ErroProblema`, ou o erro do produto com o mesmo campo). Cada `pedir`
 * com chave nova é um recurso novo (o adaptador cria a campanha de teste, por exemplo).
 */
export type AdaptadorDoPedido = {
  pedir(o: { chave: string; plano: Record<string, unknown>; pedidoPor: QuemPede }): Promise<{ id: string; situacao: SituacaoDoPedido }>;
  aprovar(id: string, a: { pessoa: string; resumoVisto: string; segundoFator: boolean; tetoDeGastoCentavos?: number }): Promise<void>;
  recusar(id: string, a: { pessoa: string }): Promise<void>;
  /** Roda a execução como a rotina do produto: confere, toma o pedido e executa. */
  executar(id: string): Promise<void>;
  /** Muda o plano depois do pedido (o texto, o público ou o custo). */
  mudarPlano(id: string): Promise<void>;
  /** Avança o relógio do produto. */
  avancar(ms: number): Promise<void>;
  ler(id: string): Promise<{ situacao: SituacaoDoPedido; resumoDoPlano: string }>;
  /** Quantas vezes a ação aconteceu de fato (o lote que saiu, o gasto feito). */
  efeitos(id: string): Promise<number>;
};

export type CasoComum = { nome: string; rodar: () => Promise<void> };

function falhaSe(condicao: boolean, mensagem: string): void {
  if (condicao) throw new Error(mensagem);
}

async function esperarRecusa(fn: () => Promise<unknown>, tipo: TipoProblema, oQue: string): Promise<void> {
  let veio: unknown = null;
  let deuCerto = false;
  try {
    await fn();
    deuCerto = true;
  } catch (erro) {
    veio = erro;
  }
  const recebido = veio && typeof veio === 'object' ? (veio as { tipo?: unknown }).tipo : undefined;
  if (deuCerto) throw new Error(`${oQue}: esperava a recusa "${tipo}", e deu certo`);
  if (recebido !== tipo) {
    const como = typeof recebido === 'string' ? `"${recebido}"` : veio instanceof Error ? `o erro "${veio.message.slice(0, 200)}"` : String(veio).slice(0, 200);
    throw new Error(`${oQue}: esperava a recusa "${tipo}", e veio ${como}`);
  }
}

/**
 * Os testes comuns do pedido (F5, parte A): sem aprovação não executa, a aprovação de outro plano não vale, ela vale uma
 * vez só, o vencido não executa, quem pediu não aprova, sem o segundo fator não aprova, o recusado não executa e a mesma
 * chave devolve o mesmo pedido. Cada produto roda, em ordem, no próprio executor de testes:
 * `for (const c of casosDoPedidoDeAcao(adaptador)) it(c.nome, c.rodar)`.
 */
export function casosDoPedidoDeAcao(a: AdaptadorDoPedido): CasoComum[] {
  const PRAZO_MS = PRAZO_DO_PEDIDO_HORAS * HORA_MS;
  const QUEM_PEDE = resumoDaPessoa('pessoa-a@exemplo.invalid');
  const OUTRA = resumoDaPessoa('pessoa-b@exemplo.invalid');
  const TETO = 1_000;
  let n = 0;
  const novo = (caso: string, pedidoPor: QuemPede = { tipo: 'agente' }) => {
    n += 1;
    const plano = { caso, numero: n, texto: 'Sexta tem combo em dobro.', publico: 'clientes-da-sexta', mensagens: 3, custo_centavos: 120 };
    return { chave: `caso-${n}-${randomUUID()}`, plano, pedidoPor };
  };
  const aprovarBem = async (id: string, pessoa = OUTRA): Promise<void> => {
    const { resumoDoPlano: resumoVisto } = await a.ler(id);
    await a.aprovar(id, { pessoa, resumoVisto, segundoFator: true, tetoDeGastoCentavos: TETO });
  };
  const situacao = async (id: string) => (await a.ler(id)).situacao;
  return [
    {
      nome: 'sem aprovação, não executa',
      rodar: async () => {
        const p = await a.pedir(novo('sem-aprovacao'));
        falhaSe(p.situacao !== 'aguardando', `o pedido nasceu "${p.situacao}", e não "aguardando"`);
        await esperarRecusa(() => a.executar(p.id), 'aprovacao-pendente', 'executar sem aprovação');
        falhaSe((await a.efeitos(p.id)) !== 0, 'a ação aconteceu sem aprovação');
        falhaSe((await situacao(p.id)) !== 'aguardando', 'o pedido saiu de "aguardando" sem aprovação');
      },
    },
    {
      nome: 'a aprovação de outro plano não vale',
      rodar: async () => {
        const p = await a.pedir(novo('outro-plano-na-tela'));
        const outro = resumoDoPlano({ outro: 'plano' });
        await esperarRecusa(() => a.aprovar(p.id, { pessoa: OUTRA, resumoVisto: outro, segundoFator: true, tetoDeGastoCentavos: TETO }), 'plano-mudou', 'aprovar com o resumo de outro plano');
        falhaSe((await situacao(p.id)) !== 'aguardando', 'a aprovação de outro plano mudou o pedido');
        const q = await a.pedir(novo('plano-mudou-depois'));
        await aprovarBem(q.id);
        await a.mudarPlano(q.id);
        await esperarRecusa(() => a.executar(q.id), 'plano-mudou', 'executar depois de o plano mudar');
        falhaSe((await a.efeitos(q.id)) !== 0, 'a ação aconteceu com o plano mudado');
      },
    },
    {
      nome: 'a aprovação vale uma vez só',
      rodar: async () => {
        const p = await a.pedir(novo('uma-vez'));
        await aprovarBem(p.id);
        await a.executar(p.id);
        falhaSe((await a.efeitos(p.id)) !== 1, 'a ação aprovada não aconteceu uma vez');
        await esperarRecusa(() => a.executar(p.id), 'aprovacao-usada', 'executar de novo');
        await esperarRecusa(() => aprovarBem(p.id), 'aprovacao-usada', 'aprovar de novo');
        falhaSe((await a.efeitos(p.id)) !== 1, 'a ação aconteceu duas vezes com uma aprovação');
      },
    },
    {
      nome: 'o vencido não executa',
      rodar: async () => {
        const p = await a.pedir(novo('vence-aguardando'));
        await a.avancar(PRAZO_MS + 1_000);
        falhaSe((await situacao(p.id)) !== 'vencido', 'o pedido passou do prazo e não aparece vencido');
        await esperarRecusa(() => aprovarBem(p.id), 'aprovacao-vencida', 'aprovar depois do prazo');
        const q = await a.pedir(novo('vence-aprovado'));
        await aprovarBem(q.id);
        await a.avancar(PRAZO_MS + 1_000);
        await esperarRecusa(() => a.executar(q.id), 'aprovacao-vencida', 'executar depois do prazo');
        falhaSe((await a.efeitos(q.id)) !== 0, 'a ação aconteceu depois do prazo');
      },
    },
    {
      nome: 'quem pediu não aprova; o pedido do agente, quem tem a permissão aprova',
      rodar: async () => {
        const p = await a.pedir(novo('quem-pede', { tipo: 'pessoa', pessoa: QUEM_PEDE }));
        await esperarRecusa(() => aprovarBem(p.id, QUEM_PEDE), 'aprovacao-propria', 'quem pediu aprovar');
        await aprovarBem(p.id, OUTRA);
        falhaSe((await situacao(p.id)) !== 'aprovado', 'outra pessoa aprovou, e o pedido não ficou aprovado');
        const q = await a.pedir(novo('agente'));
        await aprovarBem(q.id, QUEM_PEDE);
        falhaSe((await situacao(q.id)) !== 'aprovado', 'o pedido do agente não ficou aprovado');
      },
    },
    {
      nome: 'sem o segundo fator, não aprova',
      rodar: async () => {
        const p = await a.pedir(novo('segundo-fator'));
        const { resumoDoPlano: resumoVisto } = await a.ler(p.id);
        await esperarRecusa(() => a.aprovar(p.id, { pessoa: OUTRA, resumoVisto, segundoFator: false, tetoDeGastoCentavos: TETO }), 'segundo-fator-invalido', 'aprovar sem o segundo fator');
        falhaSe((await situacao(p.id)) !== 'aguardando', 'o pedido mudou sem o segundo fator');
      },
    },
    {
      nome: 'o recusado não executa',
      rodar: async () => {
        const p = await a.pedir(novo('recusado'));
        await a.recusar(p.id, { pessoa: OUTRA });
        falhaSe((await situacao(p.id)) !== 'recusado', 'o pedido recusado não aparece recusado');
        await esperarRecusa(() => a.executar(p.id), 'aprovacao-recusada', 'executar o recusado');
        await esperarRecusa(() => aprovarBem(p.id), 'aprovacao-recusada', 'aprovar o recusado');
        falhaSe((await a.efeitos(p.id)) !== 0, 'a ação recusada aconteceu');
      },
    },
    {
      nome: 'a mesma chave devolve o mesmo pedido; com outro conteúdo, recusa',
      rodar: async () => {
        const pedido = novo('repetido');
        const p = await a.pedir(pedido);
        const de = await a.pedir(pedido);
        falhaSe(de.id !== p.id, 'a mesma chave e o mesmo conteúdo fizeram outro pedido');
        await aprovarBem(p.id);
        const depois = await a.pedir(pedido);
        falhaSe(depois.id !== p.id || depois.situacao !== 'aprovado', 'depois de aprovado, a mesma chave não devolveu o mesmo pedido como está');
        await esperarRecusa(() => a.pedir({ ...pedido, plano: { ...pedido.plano, texto: 'Outro texto.' } }), 'chave-reutilizada', 'a mesma chave com outro conteúdo');
      },
    },
  ];
}
