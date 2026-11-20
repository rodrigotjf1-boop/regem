import { sql } from 'drizzle-orm';
import { DrizzleDB } from '../../db/drizzle.module';
import { DIAS_SEM_CONVERSA } from './mister.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// DESLIGAR O WHATSAPP DE UMA PESSOA DO MISTER (versão 6, M6a; mig 468) — um caminho só para todos os motivos, com o motivo
// guardado na pessoa (a parte "Pessoas" mostra) e no telefone (quem escreve depois recebe a frase do motivo):
//   pessoa         a própria pessoa desligou (Mister › Pessoas);
//   presidente     o presidente desligou o de outra pessoa;
//   vencido        60 dias sem conversa (decisão V6-3; a volta diária de `MisterVinculoSegurancaService`);
//   dms            o suporte da DMS, pelo console, com o motivo na auditoria (para quem não consegue entrar no Regem);
//   nao_reconheco  o presidente tocou "Não reconheço" no aviso de telefone ligado.
// Quem desliga perde a memória do Mister junto (decisão 5 da versão 4). A auditoria é de quem chama (cada um sabe o ator).

export const MOTIVOS_DO_DESLIGAMENTO = ['pessoa', 'presidente', 'vencido', 'dms', 'nao_reconheco'] as const;
export type MotivoDoDesligamento = (typeof MOTIVOS_DO_DESLIGAMENTO)[number];
export { DIAS_SEM_CONVERSA };

/** O que a parte "Pessoas" escreve ao lado de quem foi desligado. */
export const MOTIVO_NA_TELA: Record<MotivoDoDesligamento, string> = {
  pessoa: 'desligou o próprio WhatsApp',
  presidente: 'desligado pelo presidente',
  vencido: `${DIAS_SEM_CONVERSA} dias sem conversa`,
  dms: 'desligado pelo suporte da DMS',
  nao_reconheco: 'o presidente não reconheceu o telefone',
};

export const ehMotivoDoDesligamento = (m: unknown): m is MotivoDoDesligamento =>
  typeof m === 'string' && (MOTIVOS_DO_DESLIGAMENTO as readonly string[]).includes(m);

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';

export interface Desligado {
  /** O vínculo (a pessoa nesta empresa). */
  id: string;
  /** O telefone que estava ligado — null quando só havia um código aberto (ainda não tinha ligado). */
  telefone: string | null;
}

/**
 * Desliga o WhatsApp de uma pessoa nesta empresa: o telefone sai, o código para de valer, a pausa dos avisos some, a
 * memória dela é apagada e o motivo fica na pessoa e no telefone. A gravação é condicional (só quem tinha telefone ou
 * código): chamar de novo não faz nada e devolve null. `soSeLigadoEm` (o "Não reconheço"): só desliga se o telefone ainda
 * for o daquele aviso — quem ligou de novo depois não cai pelo toque num aviso antigo.
 */
export async function desligarVinculo(
  db: DrizzleDB,
  p: { tenantId: string; colaboradorId: string; motivo: MotivoDoDesligamento; soSeLigadoEm?: string | null },
): Promise<Desligado | null> {
  const doAviso = p.soSeLigadoEm ? sql`and to_char(ligado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = ${p.soSeLigadoEm}` : sql``;
  const [d] = linhas(
    await db.execute(sql`
      with antes as (
        select id, telefone from mister_vinculo
         where tenant_id = ${p.tenantId}::uuid and colaborador_id = ${p.colaboradorId}::uuid
           and (telefone is not null or codigo is not null) ${doAviso}
         for update)
      update mister_vinculo g
         set telefone = null, ligado_em = null, pausado_em = null, codigo = null, codigo_expira_em = null,
             desligado_em = case when antes.telefone is not null then clock_timestamp() else g.desligado_em end,
             desligado_motivo = case when antes.telefone is not null then ${p.motivo} else g.desligado_motivo end,
             atualizado_em = now()
        from antes
       where g.id = antes.id
      returning g.id::text as id, antes.telefone`),
  );
  if (!d) return null;
  await db
    .execute(sql`delete from mister_memoria where tenant_id = ${p.tenantId}::uuid and colaborador_id = ${p.colaboradorId}::uuid`)
    .catch((e: any) => {
      if (!semTabela(e)) throw e;
    });
  if (d.telefone) {
    await db.execute(sql`
      update mister_conversa set desligado_em = clock_timestamp(), desligado_motivo = ${p.motivo}, atualizado_em = now()
       where telefone = ${d.telefone}`);
  }
  return { id: String(d.id), telefone: d.telefone ? String(d.telefone) : null };
}
