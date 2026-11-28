import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Quem fez, no console da distribuição (o `DistCtx` do guarda: o id, o nome e o perfil). */
export type AutorDaDistribuicao = { sub?: string | null; id?: string | null; nome?: string | null; perfil?: string | null };

/**
 * A linha da auditoria da distribuição, pelo executor que vier (o banco ou a transação do efeito).
 *
 * Rodada 7, MIS-G-06 (ERR-659): publicar as instruções do Mister, descartar a candidata e conectar o número eram auditados
 * DEPOIS do efeito, por um `insert` que engolia a falha — uma queda do banco no meio deixava o texto do Mister trocado para
 * todas as empresas sem o id de quem fez. Agora quem chama passa a transação do efeito: sem a auditoria, nada acontece.
 */
export async function inserirAuditoriaDaDistribuicao(
  exec: { execute: (q: any) => Promise<any> },
  autor: AutorDaDistribuicao | null,
  acao: string,
  alvo?: string | null,
  detalhe: Record<string, unknown> = {},
  ip?: string | null,
): Promise<void> {
  await exec.execute(sql`
    insert into distribuicao_auditoria (usuario_id, usuario_nome, perfil, acao, alvo, detalhe, ip)
    values (${autor?.id ?? autor?.sub ?? null}, ${autor?.nome ?? null}, ${autor?.perfil ?? null},
            ${acao}, ${alvo ?? null}, ${JSON.stringify(detalhe ?? {})}::jsonb, ${ip ?? null})`);
}
