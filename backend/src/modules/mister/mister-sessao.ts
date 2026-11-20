import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A SESSÃO COM PIN DO MISTER (versão 6, M6d; mig 476; `mockups/regem-mister-v6.html`, "Segurança"). Com o ajuste do
// presidente ligado (`mister_conversa_config.pin_a_cada_h`: 6, 12 ou 24 horas), os valores em reais, os dados de pessoas e
// as ações de botão pedem o PIN pelo link (o procedimento `abrir_sessao`, a página da F4.2a); o PIN certo grava até quando
// vale (`mister_vinculo.pin_ate`). Uma leitura só, das duas tabelas. Sem as colunas (o banco antes da 476) ou sem a tabela
// do ajuste: a sessão não é exigida — o comportamento de antes.

export interface EstadoDaSessao {
  /** O ajuste está ligado na empresa. */
  exigida: boolean;
  /** Por quantas horas o PIN vale (null = desligado). */
  horas: number | null;
  /** O PIN desta pessoa ainda vale. */
  valida: boolean;
}

const HORAS_VALIDAS = new Set([6, 12, 24]);
const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semColunaOuTabela = (e: any) => ['42703', '42P01'].includes(e?.code) || ['42703', '42P01'].includes(e?.cause?.code);

/** O estado da sessão de uma pessoa numa empresa. Nunca lança por falta da migration (devolve "não exigida"). */
export async function estadoDaSessao(db: DrizzleDB, tenantId: string, colaboradorId: string): Promise<EstadoDaSessao> {
  try {
    const [l] = linhas(
      await db.execute(sql`
        select c.pin_a_cada_h as horas, (v.pin_ate is not null and v.pin_ate > clock_timestamp()) as valida
          from (select ${tenantId}::uuid as tenant_id) t
          left join mister_conversa_config c on c.tenant_id = t.tenant_id
          left join mister_vinculo v on v.tenant_id = t.tenant_id and v.colaborador_id = ${colaboradorId}::uuid`),
    );
    const horas = HORAS_VALIDAS.has(Number(l?.horas)) ? Number(l.horas) : null;
    return { exigida: horas !== null, horas, valida: horas === null || l?.valida === true };
  } catch (e: any) {
    if (semColunaOuTabela(e)) return { exigida: false, horas: null, valida: true };
    throw e;
  }
}
