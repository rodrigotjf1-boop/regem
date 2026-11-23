import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';
import { somarDias } from '../../common/data';
import { FUSO_SQL, instanteDe } from '../../common/fuso-sql';
import { LEITURA_VAZIA, type LeituraDoCaixa } from './mister-caixa-banco';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A LEITURA DO CAIXA PELO EXTRATO (R2 da versão 8). Só somas por dia e por conta: a descrição dos lançamentos não passa por aqui
// e nunca chega à IA (V8-3). Uma consulta depois da outra: um indicador segura no máximo uma conexão do pool da API.

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export async function lerCaixaDoBanco(db: DrizzleDB, tenantId: string, de: string, ate: string): Promise<LeituraDoCaixa> {
  const contas = rows(
    await db.execute(sql`
      select c.id, c.unidade_id, c.final, s.saldo_centavos, s.saldo_em::text as saldo_em
        from banco_conta c
        left join lateral (
          select i.saldo_centavos, i.saldo_em
            from banco_importacao i
           where i.conta_id = c.id and i.saldo_centavos is not null and i.saldo_em is not null
           order by i.saldo_em desc, i.criado_em desc
           limit 1
        ) s on true
       where c.tenant_id = ${tenantId}::uuid`),
  );
  if (!contas.length) return LEITURA_VAZIA;

  const lojas = rows(await db.execute(sql`select id, nome from unidade where tenant_id = ${tenantId}::uuid and deleted_at is null`));
  const periodos = rows(
    await db.execute(sql`
      select conta_id, periodo_de::text as de, periodo_ate::text as ate
        from banco_importacao
       where tenant_id = ${tenantId}::uuid
         and periodo_de is not null and periodo_ate is not null
         and periodo_de <= ${ate}::date and periodo_ate >= ${de}::date`),
  );
  const dias = rows(
    await db.execute(sql`
      select l.conta_id, l.data::text as dia,
             coalesce(sum(l.valor_centavos) filter (where l.valor_centavos > 0 and l.situacao <> 'nao_e_da_loja' and l.tipo is distinct from 'transferencia_contas'), 0)::bigint as entrou,
             coalesce(-sum(l.valor_centavos) filter (where l.valor_centavos < 0 and l.situacao <> 'nao_e_da_loja' and l.tipo is distinct from 'transferencia_contas'), 0)::bigint as saiu
        from banco_lancamento l
       where l.tenant_id = ${tenantId}::uuid
         and l.data >= ${de}::date and l.data <= ${ate}::date
         and l.situacao <> 'esperado'
       group by 1, 2`),
  );
  const vendas = rows(
    await db.execute(sql`
      select unidade_id, (fechada_em at time zone ${FUSO_SQL})::date::text as dia
        from comanda
       where tenant_id = ${tenantId}::uuid
         and status = 'fechada'
         and fechada_em >= ${instanteDe(`${de} 00:00:00`)}
         and fechada_em < ${instanteDe(`${somarDias(ate, 1)} 00:00:00`)}
       group by 1, 2`),
  );

  return {
    lojas: lojas.map((x) => ({ id: x.id as string, nome: x.nome as string })),
    contas: contas.map((c) => ({
      id: c.id as string,
      unidadeId: c.unidade_id as string,
      final: c.final as string,
      saldoCentavos: c.saldo_centavos === null || c.saldo_centavos === undefined ? null : Number(c.saldo_centavos),
      saldoEm: (c.saldo_em as string | null) ?? null,
    })),
    periodos: periodos.map((p) => ({ contaId: p.conta_id as string, de: p.de as string, ate: p.ate as string })),
    dias: dias.map((d) => ({ contaId: d.conta_id as string, dia: d.dia as string, entrouCentavos: Number(d.entrou), saiuCentavos: Number(d.saiu) })),
    vendas: vendas.map((v) => ({ unidadeId: (v.unidade_id as string | null) ?? null, dia: v.dia as string })),
  };
}
