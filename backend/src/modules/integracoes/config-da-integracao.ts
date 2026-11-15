import { eq, sql, type SQL } from 'drizzle-orm';
import { integracao } from '../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CONFIGURAÇÃO de uma integração (`integracao.config`, jsonb) tem vários escritores ao mesmo tempo: o poller (cursor,
// ids vistos, token renovado), a tela da loja (ambiente, ajustes), a distribuição (o pedido de integração concluído no
// console) e os avisos do canal (o vínculo da loja). Quem grava o objeto INTEIRO a partir da cópia que leu no começo
// apaga o que os outros gravaram no meio — o fim de um ciclo de leitura devolvia o `refreshToken` velho do Cardápio Web
// e o "pendente" do pedido do Anota AI que a distribuição tinha acabado de concluir (V82, ERR-345, ERR-474, ERR-475).
//
// Aqui cada escritor grava SÓ as chaves dele, mesclando no banco (`config || parcial`), e pode tirar chaves (`config - k`).
// As colunas comuns (token, ativo, loja…) vão na MESMA gravação. Devolve o `config` como ficou, para atualizar a cópia de
// quem chamou; `null` quando a integração não existe mais.

type Colunas = Partial<Omit<typeof integracao.$inferInsert, 'id' | 'tenantId' | 'canal' | 'config' | 'createdAt' | 'updatedAt'>>;

export async function mesclarNoConfigDaIntegracao(
  db: any,
  integracaoId: string,
  parcial: Record<string, unknown>,
  opcoes: { tirar?: string[]; colunas?: Colunas } = {},
): Promise<Record<string, any> | null> {
  let base: SQL = sql`coalesce(${integracao.config}, '{}'::jsonb)`;
  for (const chave of opcoes.tirar ?? []) base = sql`(${base} - ${chave}::text)`;
  const [l] = await db
    .update(integracao)
    .set({ ...(opcoes.colunas ?? {}), config: sql`${base} || ${JSON.stringify(parcial)}::jsonb`, updatedAt: new Date() })
    .where(eq(integracao.id, integracaoId))
    .returning({ config: integracao.config });
  return l ? ((l.config as Record<string, any>) ?? {}) : null;
}
