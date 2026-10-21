import { RequestMethod } from '@nestjs/common';
import {
  CABECALHO_LIGACAO,
  cabecalhoWwwAuthenticate,
  ErroPermissaoFaltando,
  ErroProblema,
  ErroTokenDmsId,
  lerChave,
} from '../../dms/integracao-dms';
import { CLIENTES_INTEGRACAO, ESCOPOS_INTEGRACAO, type EscopoIntegracao } from './escopos';
import { enderecoDeServico } from './hub.regras';
import { ProblemaException } from './problema';

// A VIA DO DMS ID na API de integração (Hub DMS, F3, parte A): regras puras, sem banco.
//
// Com a via ligada (`DMS_ID_LIGADO`), cada chamada pode trazer, no lugar do `rgm_it_`, DUAS coisas: o token do DMS ID
// (`Authorization: Bearer <jwt>`), que diz QUAL APLICATIVO chama, e o segredo da ligação (`DMS-Ligacao:
// dms_lg_regem_…`), que diz QUAL AUTORIZAÇÃO da loja vale. Vazar um só não abre nada: o segredo só vale com o token do
// aplicativo dono da ligação, e o token sozinho não diz loja nenhuma.
//
// Regras do Padrão DMS (§2.1, §6 e §7) que moram aqui:
// - ligação ausente, inexistente, revogada, de token revogado ou de outro aplicativo respondem IGUAL (a mesma frase),
//   para quem tem um segredo não descobrir se ele existiu nem de quem é;
// - vale a MENOR das duas permissões: a do token (o que o DMS ID deixa o aplicativo fazer no Regem) e a da ligação
//   (o que a loja autorizou);
// - o aplicativo tem de ser o que a distribuição cadastrou para o cliente do token (`DMS_ID_APLICATIVOS`): tirar um
//   aplicativo da lista corta todas as ligações dele na chamada seguinte, sem tocar no banco.

/** O cabeçalho como o Node entrega (nome em minúsculas). */
export const CABECALHO_LIGACAO_NO_NODE = CABECALHO_LIGACAO.toLowerCase();

/** O caminho do recurso protegido: o `resource` dos metadados e o destino (`aud`) do token terminam nele. */
export const CAMINHO_DO_RECURSO = '/api/v1/integracao';

/** O caminho dos metadados do recurso protegido (RFC 9728 §3.1), FORA do prefixo `/api/v1` (`main.ts`). */
export const CAMINHO_DOS_METADADOS = '.well-known/oauth-protected-resource/api/v1/integracao';

/** As rotas que ficam fora do prefixo global `/api/v1` (o `main.ts` e os testes que sobem o app usam a mesma lista). */
export const ROTAS_FORA_DO_PREFIXO = [{ path: CAMINHO_DOS_METADADOS, method: RequestMethod.GET }];

/** A frase de toda ligação que não vale — a mesma para todo motivo. */
export const LIGACAO_INVALIDA =
  'Ligação ausente, inválida ou revogada. Mande o segredo da ligação no cabeçalho DMS-Ligacao, junto do token do DMS ID do aplicativo dono dela.';

/** A frase da troca recusada — a mesma para token inexistente, revogado, vencido, de outra loja apagada ou de outro aplicativo. */
export const TROCA_RECUSADA =
  'O token de integração informado não vale para este aplicativo: inexistente, revogado, vencido ou de outro aplicativo. Conecte a loja de novo.';

/** A via do DMS ID desligada: as duas rotas dela respondem 404. */
export const VIA_DESLIGADA = 'A via do DMS ID não está ligada neste ambiente. Use o token de integração.';

/** Todas as permissões do Regem, na ordem do catálogo: é o que o 401 e o 403 da via anunciam. */
export const PERMISSOES_DO_RECURSO: readonly EscopoIntegracao[] = ESCOPOS_INTEGRACAO;

/**
 * O segredo da ligação do cabeçalho, ou nulo. Só aceita o que tem a forma de uma ligação do Regem, com os dígitos de
 * conferência certos: o resto nem chega ao banco. Cabeçalho repetido (o Node entrega lista) não vale.
 */
export function ligacaoDoCabecalho(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  const lida = lerChave(texto);
  return lida && lida.tipo === 'lg' && lida.produto === 'regem' ? texto : null;
}

/** As permissões do token que existem no catálogo do Regem (o DMS ID pode mandar as de outro recurso no mesmo token). */
export function permissoesDoCatalogo(doToken: readonly string[]): EscopoIntegracao[] {
  return ESCOPOS_INTEGRACAO.filter((e) => doToken.includes(e));
}

/** As permissões que valem na chamada: as que a loja autorizou E o token também tem, na ordem do catálogo. */
export function permissoesDaLigacao(daLigacao: readonly string[], doToken: readonly string[]): EscopoIntegracao[] {
  return ESCOPOS_INTEGRACAO.filter((e) => daLigacao.includes(e) && doToken.includes(e));
}

/**
 * Este aplicativo do DMS ID pode trocar um `rgm_it_` deste cliente (e usar a ligação que saiu dele)? Só o aplicativo
 * que a distribuição cadastrou para o cliente: o aplicativo do Liame não troca o token do GoGeM.
 */
export function podeTrocar(cliente: string, aplicativoDoToken: string, aplicativos: Readonly<Record<string, string>>): boolean {
  return Object.prototype.hasOwnProperty.call(aplicativos, cliente) && aplicativos[cliente] === aplicativoDoToken;
}

/** A ligação como o banco devolve: só o que decide se ela vale (o estado do token já vem resolvido no `motivoDoToken`). */
export type LigacaoGuardada = {
  aplicativo: string;
  cliente: string;
  revogada: boolean;
  /** Por que o token da ligação não vale (revogado, vencido, loja apagada, empresa apagada), ou nulo. */
  motivoDoToken: string | null;
};

/**
 * Por que a ligação não vale para este token, ou nulo (vale). O motivo vai só para o log local: a resposta é a mesma
 * para todos (`LIGACAO_INVALIDA`).
 */
export function motivoDaRecusaDaLigacao(
  l: LigacaoGuardada | undefined | null,
  aplicativoDoToken: string,
  aplicativos: Readonly<Record<string, string>>,
): string | null {
  if (!l) return 'ligação desconhecida';
  if (l.aplicativo !== aplicativoDoToken) return 'ligação de outro aplicativo';
  if (!podeTrocar(l.cliente, aplicativoDoToken, aplicativos)) return `aplicativo fora da lista da distribuição para o cliente ${l.cliente}`;
  if (l.revogada) return 'ligação revogada';
  if (l.motivoDoToken) return `token da ligação ${l.motivoDoToken}`;
  return null;
}

/** O endereço dos metadados do recurso (RFC 9728 §3.1): o `.well-known` entre a origem e o caminho do recurso. */
export function enderecoDosMetadados(recurso: string): string {
  const u = new URL(recurso);
  return `${u.origin}/.well-known/oauth-protected-resource${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * O `WWW-Authenticate` de uma recusa (RFC 6750 §3), ou nulo (a recusa não leva desafio). Todo 401 leva o desafio;
 * com a via do DMS ID ligada, também o endereço dos metadados e as permissões do recurso. Sem credencial nenhuma, vai
 * sem código de erro (RFC 6750 §3.1). O 403 de permissão leva TODAS as que faltam (Padrão §6).
 */
export function desafioDaRecusa(
  erro: unknown,
  o: { veioToken: boolean; metadadosRecurso?: string | null },
): string | null {
  const metadadosRecurso = o.metadadosRecurso ?? undefined;
  if (erro instanceof ErroPermissaoFaltando) {
    return cabecalhoWwwAuthenticate({ metadadosRecurso, erro: 'insufficient_scope', escopos: erro.faltando });
  }
  if (erro instanceof EscopoFaltando) {
    return cabecalhoWwwAuthenticate({ metadadosRecurso, erro: 'insufficient_scope', escopos: erro.faltando });
  }
  const status = erro instanceof ErroProblema ? erro.status : erro instanceof ProblemaException ? erro.getStatus() : null;
  if (status !== 401) return null;
  // Só o token que veio e não vale é `invalid_token`: a ligação recusada com o token bom não é defeito do token.
  const tokenRuim = o.veioToken && (erro instanceof ErroTokenDmsId || (erro instanceof ProblemaException && erro.tipo === 'token-invalido'));
  return cabecalhoWwwAuthenticate({
    metadadosRecurso,
    ...(metadadosRecurso ? { escopos: PERMISSOES_DO_RECURSO } : {}),
    ...(tokenRuim ? { erro: 'invalid_token' as const } : {}),
  });
}

/** O 403 da rota: a credencial não tem uma das permissões que ela exige. `faltando` traz todas de uma vez. */
export class EscopoFaltando extends ProblemaException {
  constructor(
    readonly faltando: readonly string[],
    credencial: 'token' | 'ligacao',
  ) {
    super(403, 'escopo-insuficiente', `${credencial === 'token' ? 'Este token' : 'Esta ligação'} não tem o escopo ${faltando.join(', ')}.`);
  }
}

// ───────────────────────────── a configuração (ambiente da distribuição) ─────────────────────────────

/**
 * A via do DMS ID, lida do ambiente (a distribuição configura no EasyPanel; nada disso é da loja):
 * - `DMS_ID_LIGADO=true` liga a via (sem isso, tudo segue só com o `rgm_it_`);
 * - `DMS_ID_EMISSOR`: o `iss` dos tokens, o endereço do DMS ID com `/oidc` (as chaves públicas saem de `<emissor>/jwks`);
 * - `DMS_ID_RECURSO`: o identificador do recurso do Regem no DMS ID (o `aud` dos tokens), terminado em
 *   `/api/v1/integracao` — é dele que sai o endereço dos metadados;
 * - `DMS_ID_APLICATIVOS`: JSON cliente → client_id dos aplicativos que a distribuição cadastrou (`{"liame":"…"}`).
 * Configuração torta não liga a via: a recusa vem com o motivo, para o log.
 */
export type ConfigDmsId =
  | { ligado: true; emissor: string; recurso: string; aplicativos: Readonly<Record<string, string>> }
  | { ligado: false; motivo: string | null };

const ID_DE_APLICATIVO = /^[A-Za-z0-9_-]{4,64}$/;

export function lerConfigDmsId(env: Record<string, string | undefined> = process.env): ConfigDmsId {
  if (env.DMS_ID_LIGADO !== 'true') return { ligado: false, motivo: null };
  const desligada = (motivo: string): ConfigDmsId => ({ ligado: false, motivo });

  const emissorBruto = (env.DMS_ID_EMISSOR ?? '').trim().replace(/\/+$/, '');
  if (!enderecoDeServico(emissorBruto)) return desligada('DMS_ID_EMISSOR precisa ser o endereço https do DMS ID com /oidc');

  const recurso = (env.DMS_ID_RECURSO ?? '').trim();
  const u = enderecoDeServico(recurso);
  if (!u || u.pathname !== CAMINHO_DO_RECURSO) {
    return desligada(`DMS_ID_RECURSO precisa ser o endereço https da API terminado em ${CAMINHO_DO_RECURSO} (sem barra no fim)`);
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(env.DMS_ID_APLICATIVOS ?? '');
  } catch {
    return desligada('DMS_ID_APLICATIVOS precisa ser um JSON, como {"liame":"<client_id do Liame no DMS ID>"}');
  }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    return desligada('DMS_ID_APLICATIVOS precisa mapear cliente → client_id');
  }
  const aplicativos: Record<string, string> = {};
  const vistos = new Set<string>();
  for (const [cliente, aplicativo] of Object.entries(bruto as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(CLIENTES_INTEGRACAO, cliente)) {
      return desligada(`DMS_ID_APLICATIVOS tem um cliente que não existe: ${cliente}`);
    }
    if (typeof aplicativo !== 'string' || !ID_DE_APLICATIVO.test(aplicativo)) {
      return desligada(`DMS_ID_APLICATIVOS.${cliente} precisa ser o client_id do aplicativo`);
    }
    if (vistos.has(aplicativo)) return desligada('o mesmo aplicativo aparece para dois clientes em DMS_ID_APLICATIVOS');
    vistos.add(aplicativo);
    aplicativos[cliente] = aplicativo;
  }
  if (!vistos.size) return desligada('DMS_ID_APLICATIVOS está vazio: nenhum aplicativo pode usar a via');
  return { ligado: true, emissor: emissorBruto, recurso, aplicativos: Object.freeze(aplicativos) };
}
