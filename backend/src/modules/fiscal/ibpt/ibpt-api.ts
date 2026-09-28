// CLIENTE DO WEBSERVICE DO IBPT ("De Olho no Imposto") — só para a tabela PRÓPRIA da empresa que
// informou o token dela (mig 292). A tabela padrão continua sendo a da distribuição, enviada no
// console; isto aqui é opcional e nunca derruba nada.
//
// O manual do IBPT (0.13, §3.3) diz que o token é do EMPRESÁRIO, que o entrega a quem faz o
// sistema. A consulta é por produto: `GET /api/v1/produtos` com token, CNPJ da empresa, NCM, UF,
// exceção da TIPI e dados do item. A alíquota depende só de NCM + UF + exceção; descrição, unidade,
// valor e GTIN são obrigatórios na chamada mas não entram na conta — vão genéricos, então nenhum
// dado de cardápio da loja sai daqui.
//
// SEGURANÇA: o token vai na query string, então NENHUMA mensagem de erro, log ou exceção daqui
// carrega a URL, os parâmetros ou o corpo da resposta de erro. Só o status HTTP e um motivo fixo.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const URL_API_IBPT = 'https://apidoni.ibpt.org.br/api/v1/produtos';

/** NCM que existe em todas as UFs (preparações alimentícias) — usado para testar o token. */
export const NCM_SONDA = '21069090';

const TEMPO_LIMITE_MS = 15_000;

export type ConsultaIbpt = { token: string; cnpj: string; uf: string; ncm: string };

export type RespostaIbpt = {
  ncm: string;
  uf: string;
  ex: string;
  versao: string;
  chave: string;
  fonte: string;
  vigenciaInicio: string; // AAAA-MM-DD
  vigenciaFim: string;
  nacionalFederal: number;
  importadosFederal: number;
  estadual: number;
  municipal: number;
};

/** O IBPT recusou a consulta (token, CNPJ ou parâmetro). `status` = HTTP. */
export class ConsultaIbptRecusada extends Error {
  constructor(readonly status: number) {
    super(`O IBPT recusou a consulta (HTTP ${status}).`);
  }
}

/** O IBPT não respondeu direito (fora do ar, lento, resposta que não se lê). */
export class IbptIndisponivel extends Error {}

// A resposta vem em PascalCase ("Codigo", "VigenciaFim"…); aceita qualquer caixa.
function campo(o: any, nome: string): any {
  if (!o || typeof o !== 'object') return undefined;
  const k = Object.keys(o).find((x) => x.toLowerCase() === nome.toLowerCase());
  return k === undefined ? undefined : o[k];
}

// "13.45", "13,45" ou 13.45 → 13.45. Vazio → NaN (tratado como resposta ilegível).
function numero(v: any): number {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').trim().replace(',', '.');
  return s === '' ? NaN : Number(s);
}

// "31/10/2026", "2026-10-31" ou "2026-10-31T00:00:00" → "2026-10-31".
function dataIso(v: any): string {
  const s = String(v ?? '').trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return iso ? iso[1] : '';
}

/** Lê a resposta do IBPT. `null` = não é uma alíquota (NCM que o IBPT não conhece, corpo vazio). */
export function lerRespostaIbpt(corpo: any, pedido: { uf: string; ncm: string }): RespostaIbpt | null {
  const o = Array.isArray(corpo) ? corpo[0] : corpo;
  if (!o || typeof o !== 'object') return null;
  const chave = String(campo(o, 'Chave') ?? '').trim();
  const versao = String(campo(o, 'Versao') ?? '').trim();
  if (!chave || !versao) return null;
  const r: RespostaIbpt = {
    ncm: String(campo(o, 'Codigo') ?? pedido.ncm).replace(/\D/g, '') || pedido.ncm,
    uf: String(campo(o, 'UF') ?? pedido.uf).trim().toUpperCase() || pedido.uf,
    // O arquivo usa '' para "sem exceção"; a API pode devolver 0.
    ex: ((x) => (x === '0' ? '' : x))(String(campo(o, 'EX') ?? '').trim()),
    versao,
    chave,
    fonte: String(campo(o, 'Fonte') ?? '').trim() || 'IBPT',
    vigenciaInicio: dataIso(campo(o, 'VigenciaInicio')),
    vigenciaFim: dataIso(campo(o, 'VigenciaFim')),
    nacionalFederal: numero(campo(o, 'Nacional')),
    importadosFederal: numero(campo(o, 'Importado')),
    estadual: numero(campo(o, 'Estadual')),
    municipal: numero(campo(o, 'Municipal')),
  };
  const aliquotasOk = [r.nacionalFederal, r.importadosFederal, r.estadual, r.municipal].every(
    (x) => Number.isFinite(x) && x >= 0 && x < 100,
  );
  if (!aliquotasOk || !r.vigenciaInicio || !r.vigenciaFim) throw new IbptIndisponivel('Resposta do IBPT ilegível.');
  if (r.ncm !== pedido.ncm || r.uf !== pedido.uf) throw new IbptIndisponivel('O IBPT respondeu por outro NCM/UF.');
  return r;
}

/**
 * Consulta UM NCM. `null` = o IBPT não tem esse NCM (404 ou corpo sem alíquota).
 * Lança `ConsultaIbptRecusada` (400/401/403) ou `IbptIndisponivel` (rede, 5xx, resposta estranha).
 */
export async function consultarNcmIbpt(
  c: ConsultaIbpt,
  buscar: typeof fetch = fetch,
): Promise<RespostaIbpt | null> {
  const uf = c.uf.toUpperCase();
  const ncm = c.ncm.replace(/\D/g, '');
  const q = new URLSearchParams({
    token: c.token,
    cnpj: c.cnpj.replace(/\D/g, ''),
    codigo: ncm,
    uf,
    ex: '0',
    codigoInterno: '',
    descricao: 'ITEM',
    unidadeMedida: 'UN',
    valor: '1.00',
    gtin: 'SEM GTIN',
  });
  let res: Response;
  try {
    res = await buscar(`${URL_API_IBPT}?${q.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
  } catch (e: any) {
    // A mensagem do fetch pode repetir a URL: não passa adiante.
    throw new IbptIndisponivel(
      e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'O IBPT não respondeu a tempo.' : 'Sem conexão com o IBPT.',
    );
  }
  if (res.status === 404 || res.status === 204) return null;
  if (res.status === 400 || res.status === 401 || res.status === 403) throw new ConsultaIbptRecusada(res.status);
  if (!res.ok) throw new IbptIndisponivel(`O IBPT respondeu HTTP ${res.status}.`);
  let corpo: any;
  try {
    corpo = await res.json();
  } catch {
    throw new IbptIndisponivel('Resposta do IBPT ilegível.');
  }
  return lerRespostaIbpt(corpo, { uf, ncm });
}

/** Formato mínimo de token aceito antes de gastar uma chamada (o do IBPT é longo e sem espaços). */
export function tokenIbptPlausivel(token: string): boolean {
  return /^[A-Za-z0-9_\-.~+/=]{16,300}$/.test(token);
}
