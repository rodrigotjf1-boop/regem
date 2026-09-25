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

// ===== SERVIDOR SUBSTITUÍDO (decisão do dono, 25/09/2026) =====
//
// A loja troca de máquina (ou reinstala com um `.exe` novo) e o `servidor_local` antigo fica com o
// token ATIVO para sempre — o piloto chegou a 6. Token ativo sem uso é chave de sync da empresa
// inteira esperando vazar, e a máquina velha religada voltaria a sincronizar dado de semanas atrás.

/** Dias sem sinal de vida para um servidor SUBSTITUÍDO ser revogado. */
export const DIAS_SEM_SINAL_PARA_REVOGAR = 10;

export type ServidorRevogado = {
  id: string;
  tenant_id: string;
  unidade_id: string | null;
  nome: string;
  ultimo_sinal: string;
  substituto: string;
};

/**
 * Revoga, numa consulta só, o `servidor_local` que:
 *  • NÃO é credencial de integração (o do GoGeM nunca sincroniza — e nunca sai por aqui);
 *  • está há `dias` sem SINAL DE VIDA — sync (`last_push_ts`) nem relatório de status
 *    (`edge_status`); quem nunca deu sinal conta da criação;
 *  • tem SUBSTITUTO: outro servidor ativo da mesma loja (ou da rede) com sinal de verdade nos
 *    últimos `dias`, e mais recente que o dele.
 * Sem substituto não revoga: é o único servidor de uma loja parada (férias, reforma), e revogá-lo
 * deixaria a loja sem sync na volta. `soEmpresas`: só para o teste — o job passa por todas, e no CI
 * as specs dividem o banco em paralelo (LIC-084).
 */
export async function revogarServidoresSubstituidos(
  db: any,
  dias = DIAS_SEM_SINAL_PARA_REVOGAR,
  soEmpresas?: string[],
): Promise<ServidorRevogado[]> {
  const empresas = soEmpresas?.length
    ? sql`e.tenant_id in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})`
    : sql`true`;
  const r: any = await db.execute(sql`
    with sinal as (
      select e.id, e.tenant_id, e.unidade_id, e.created_at,
             greatest(e.last_push_ts, s.recebido_em) as sinal_real
        from equipamento e
        left join edge_status s on s.equipamento_id = e.id
       where e.tipo = 'servidor_local' and e.ativo and e.integrador is null
         and ${empresas}
    ),
    alvo as (
      select a.id,
             coalesce(a.sinal_real, a.created_at) as ultimo_sinal,
             (select b.id from sinal b
               where b.tenant_id = a.tenant_id and b.id <> a.id
                 and (b.unidade_id is not distinct from a.unidade_id or b.unidade_id is null or a.unidade_id is null)
                 and b.sinal_real >= now() - make_interval(days => ${dias})
                 and b.sinal_real > coalesce(a.sinal_real, a.created_at)
               order by b.sinal_real desc
               limit 1) as substituto
        from sinal a
       where coalesce(a.sinal_real, a.created_at) < now() - make_interval(days => ${dias})
    )
    update equipamento e
       set ativo = false, revogado_em = now(), segredo_hash = null, pareamento_codigo = null
      from alvo
     where e.id = alvo.id and alvo.substituto is not null and e.ativo
    returning e.id, e.tenant_id, e.unidade_id, e.nome, alvo.ultimo_sinal, alvo.substituto`);
  return (r.rows ?? r) as ServidorRevogado[];
}
