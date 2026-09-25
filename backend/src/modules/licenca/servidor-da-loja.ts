import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// QUAL `servidor_local` É O DESTA INSTALAÇÃO (ERR-108).
//
// A instalação reusava "o primeiro" `servidor_local` da empresa (sem ordem, sem loja) e religava
// TODOS; a re-autorização girava o mais recente. Numa empresa com vários — servidores de loja,
// sobras de instalação e a credencial do GoGeM (que também é um `servidor_local`) — isso podia
// entregar a um servidor de loja o token do GoGeM, ressuscitar sobras, e girar o token do GoGeM
// (a venda do totem e o cardápio dele paravam com 401).
//
// A escolha agora é uma só e determinística, e NUNCA a credencial de integração (`integrador`):
//  1. o ligado a ESTA máquina (o fingerprint gravado na instalação — até aqui ninguém gravava),
//     mesmo desativado: é a mesma máquina reinstalando, e reinstalar cura;
//  2. senão, um servidor de LOJA ATIVO (já sincronizou) — da loja da instalação antes do da
//     rede —, o do push mais recente;
//  3. senão, nenhum — quem chama cria um novo.
// Não se reusa: o `servidor_local` que nunca sincronizou e não é desta máquina (pode ser a
// credencial do GoGeM ainda não marcada, ou a sobra de uma instalação que não terminou); nem o
// DESATIVADO de outra máquina — desativar é o que se faz com a máquina roubada ou trocada, e
// religá-lo na próxima instalação devolveria o acesso a ela.

export type ServidorDaLoja = { id: string; token: string; unidadeId: string | null };

export async function escolherServidorDaLoja(
  db: any,
  tenantId: string,
  opts: { fingerprint?: string | null; unidadeId?: string | null },
): Promise<ServidorDaLoja | null> {
  const fp = String(opts.fingerprint ?? '').trim().slice(0, 200) || null;
  const uni = opts.unidadeId ?? null;
  const r: any = await db.execute(sql`
    select id, token, unidade_id from equipamento
     where tenant_id = ${tenantId}::uuid and tipo = 'servidor_local'
       and integrador is null
       and (${uni}::uuid is null or unidade_id = ${uni}::uuid or unidade_id is null)
       and ((${fp}::text is not null and fingerprint = ${fp}::text)
            or (ativo and (last_push_ts is not null or last_push_seq is not null)))
     order by case when ${fp}::text is not null and fingerprint = ${fp}::text then 0 else 1 end,
              case when unidade_id = ${uni}::uuid then 0 else 1 end,
              last_push_ts desc nulls last,
              created_at desc
     limit 1`);
  const l = (r.rows ?? r)[0];
  return l ? { id: l.id, token: l.token, unidadeId: l.unidade_id ?? null } : null;
}

/**
 * Liga o `servidor_local` escolhido a esta máquina e o reativa — SÓ ele, pelo id (antes o update
 * era "todos os servidor_local da empresa", e cada instalação religava as sobras).
 */
export async function ligarServidorAMaquina(
  db: any,
  equipamentoId: string,
  fingerprint: string | null | undefined,
  extra: { token?: string } = {},
): Promise<void> {
  const fp = String(fingerprint ?? '').trim().slice(0, 200) || null;
  await db.execute(sql`
    update equipamento
       set ativo = true, revogado_em = null,
           fingerprint = coalesce(${fp}::text, fingerprint),
           token = coalesce(${extra.token ?? null}::text, token)
     where id = ${equipamentoId}::uuid`);
}
