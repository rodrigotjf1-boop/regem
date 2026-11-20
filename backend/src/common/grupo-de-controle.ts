import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';

// O GRUPO DE CONTROLE DAS CAMPANHAS (F7 parte 3 do docs/plano-perfil-cliente.md, §6.3; mig 465). Um sorteio FIXO por
// cliente — os primeiros 28 bits do md5 de "empresa:cliente", módulo 100, abaixo de 10 —, então o cliente cai sempre no
// mesmo grupo, campanha após campanha (o controle "persistente" da Braze). O md5 é o mesmo no Postgres e no Node (o teste
// confere os dois lados). 28 bits: o número é sempre positivo (com 32, o `abs` do menor inteiro estoura).

export const PCT_DO_CONTROLE = 10;

/** No banco: o cliente (alias `c`, com `tenant_id` e `id`) está no grupo de controle. */
export function sqlNoGrupoDeControle(alias = 'c'): SQL {
  if (!/^[a-z_][a-z0-9_]*$/.test(alias)) throw new Error(`alias SQL inválido: ${alias}`);
  const a = sql.raw(alias);
  return sql`(mod(('x' || substr(md5(${a}.tenant_id::text || ':' || ${a}.id::text), 1, 7))::bit(28)::int, 100) < ${PCT_DO_CONTROLE})`;
}

/** No Node, a MESMA conta (para conferir e para a tela). */
export function noGrupoDeControle(tenantId: string, clienteId: string): boolean {
  const h = createHash('md5').update(`${tenantId}:${clienteId}`).digest('hex');
  return parseInt(h.slice(0, 7), 16) % 100 < PCT_DO_CONTROLE;
}
