import { sql, SQL } from 'drizzle-orm';
import type { IntegracaoCtxData } from './integracao-token.guard';
import { versaoDoRetrato, versaoInformada } from './catalogo-integracao';

// As duas regras que valem para TODA leitura na hora da API de integração (catálogo, fichas e a fila
// de produção — os escopos de `ESCOPOS_SEM_CARIMBO`). Ficam aqui para serem UMA só.

/**
 * O recorte pela loja: o que é da loja do token OU da rede (cadastrado sem loja — V4). A empresa de
 * uma loja só (ou o token da empresa inteira) lê tudo, como nas vendas e nos cupons.
 */
export function daLojaDoToken(coluna: SQL, ctx: IntegracaoCtxData): SQL {
  if (!ctx.unidadeId || ctx.lojaUnica) return sql`true`;
  return sql`(${coluna} = ${ctx.unidadeId}::uuid or ${coluna} is null)`;
}

export type ConsultaComVersao = { versao?: unknown };

/**
 * A resposta de um retrato: com a versão que o cliente diz ter (`?versao=`) em dia, só "nada mudou";
 * senão o retrato inteiro, com a versão dele e a hora em que foi lido (que não entra na versão).
 */
export function responderComVersao<T extends object>(retrato: T, q: ConsultaComVersao) {
  const versao = versaoDoRetrato(retrato);
  if (versaoInformada(q.versao) === versao) return { versao, atualizado: false as const };
  return { versao, atualizado: true as const, gerado_em: new Date().toISOString(), ...retrato };
}
