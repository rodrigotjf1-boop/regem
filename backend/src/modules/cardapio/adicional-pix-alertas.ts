/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm';
import { textoDoAlerta } from './adicional-pix';

/** O que a Central recebe para o alerta "segure o pedido" (fora da fila). */
export type AlertaDoAdicional = {
  id: string;
  pedidoId: string;
  numero: string | null;
  descricao: string;
  valor: number;
  situacao: string;
  expiraEm: string;
  texto: string;
};

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

/**
 * Os Pix de ADICIONAL abertos da loja em uso (mig 373): o robô pôs um item num pedido já pago e espera o Pix (ou o
 * pagamento caiu e a mudança está entrando). A loja em uso OU sem loja (V4); sem loja escolhida (o presidente), todas.
 * Com validade (V80): o aguardando só até vencer; o pago e o pedido à loja, 15 min — a rotina parada não deixa o alerta
 * preso na tela. Só NUVEM (a tabela é `@cloud-only`); banco sem a 373: nenhum.
 */
export async function alertasDoAdicionalPix(db: any, tenantId: string, unidade: string | null): Promise<AlertaDoAdicional[]> {
  let r: any;
  try {
    r = await db.execute(sql`
      select a.id, a.pedido_id, a.mudanca->>'numero' as numero, a.descricao, a.valor, a.situacao, a.expira_em
        from pedido_adicional_pix a
       where a.tenant_id = ${tenantId}::uuid
         ${unidade ? sql`and (a.unidade_id = ${unidade}::uuid or a.unidade_id is null)` : sql``}
         and ((a.situacao = 'aguardando' and a.expira_em > now())
              or (a.situacao in ('pago', 'pedido_a_loja') and a.atualizado_em > now() - interval '15 minutes'))
       order by a.criado_em
       limit 20`);
  } catch (e: any) {
    if (e?.code === '42P01') return []; // banco sem a mig 373
    throw e;
  }
  return linhasDe(r).map((x: any) => {
    const base = { numero: x.numero ?? null, descricao: String(x.descricao), valor: Number(x.valor), situacao: String(x.situacao) };
    return { id: String(x.id), pedidoId: String(x.pedido_id), ...base, expiraEm: new Date(x.expira_em).toISOString(), texto: textoDoAlerta(base) };
  });
}
