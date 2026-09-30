import { sql } from 'drizzle-orm';
import { marketingConsentimento } from '../db/schema';
import { chaveTelefone, sqlChaveTelefone, telefoneCadastro } from './telefone-chave';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONSENTIMENTO DE MARKETING (mig 300) — as ÚNICAS funções que mexem na lista de exclusão
// (`marketing_optout`, a que bloqueia o envio) e no histórico (`marketing_consentimento`, um
// evento por linha). Sempre as duas coisas na mesma transação: o VOLTAR apagava a linha da lista
// sem deixar rastro, e quem saiu e voltou sumia da história (o RegemCast precisa da data da volta).
// Só nuvem (campanha, WhatsApp e cardápio não rodam no servidor da loja).
//
// A comparação é pela CHAVE do telefone (`chaveTelefone`: sem 55, sem formatação, com o nono
// dígito) — o WhatsApp manda muitos números SEM o 9 e o cadastro tem COM (ERR-134).

export type OrigemConsentimento =
  | 'cardapio_checkout'
  | 'cardapio_perfil'
  | 'whatsapp'
  | 'painel'
  | 'integracao';

type Evento = {
  tenantId: string;
  telefone: string;
  origem: OrigemConsentimento;
  clienteId?: string | null;
  autorId?: string | null;
  texto?: string | null;
};

/** `tx` = o `db` ou uma transação do Drizzle. `null` = telefone sem chave (nada a fazer). */
function preparar(e: Evento) {
  const telefone = telefoneCadastro(e.telefone);
  const chave = chaveTelefone(telefone);
  if (!telefone || !chave) return null;
  return { telefone, chave };
}

/**
 * Só o EVENTO no histórico, sem mexer na lista de exclusão — o botão do painel liga/desliga a
 * marca do cadastro (`cliente.opt_out_marketing`), que bloqueia por conta própria.
 */
export async function registrarEvento(
  db: any,
  e: Evento,
  acao: 'aceite' | 'recusa' | 'saida' | 'volta',
): Promise<boolean> {
  const p = preparar(e);
  if (!p) return false;
  await evento(db, e, acao, p);
  return true;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNulo = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);

async function evento(tx: any, e: Evento, acao: 'aceite' | 'recusa' | 'saida' | 'volta', p: { telefone: string; chave: string }) {
  await tx.insert(marketingConsentimento).values({
    tenantId: e.tenantId,
    clienteId: uuidOuNulo(e.clienteId),
    telefone: p.telefone,
    telefoneChave: p.chave,
    acao,
    origem: e.origem,
    texto: e.texto ? String(e.texto).slice(0, 500) : null,
    autorId: uuidOuNulo(e.autorId),
  });
}

/**
 * O número pediu para SAIR (ou recusou): entra na lista de exclusão — se ainda não estiver em
 * nenhuma forma equivalente — e o evento vai para o histórico. Idempotente na lista; o histórico
 * registra cada pedido. `acao = 'recusa'` é o "desmarquei" do perfil do cardápio (bloqueia igual).
 */
export async function registrarSaida(
  db: any,
  e: Evento & { motivo: string },
  acao: 'saida' | 'recusa' = 'saida',
): Promise<boolean> {
  const p = preparar(e);
  if (!p) return false;
  await db.transaction(async (tx: any) => {
    await tx.execute(sql`
      insert into marketing_optout (tenant_id, telefone, cliente_id, motivo)
      select ${e.tenantId}::uuid, ${p.telefone}, ${uuidOuNulo(e.clienteId)}::uuid, ${e.motivo}
       where not exists (select 1 from marketing_optout mo
                          where mo.tenant_id = ${e.tenantId}::uuid
                            and ${sqlChaveTelefone(sql`mo.telefone`)} = ${p.chave})
      on conflict do nothing`);
    await evento(tx, e, acao, p);
  });
  return true;
}

/**
 * O número VOLTOU a aceitar (VOLTAR no WhatsApp, "quero receber" no perfil, o painel da loja):
 * sai da lista de exclusão em TODAS as formas equivalentes e o evento fica no histórico.
 * Devolve quantas linhas saíram da lista.
 */
export async function registrarVolta(db: any, e: Evento, acao: 'volta' | 'aceite' = 'volta'): Promise<number> {
  const p = preparar(e);
  if (!p) return 0;
  return db.transaction(async (tx: any) => {
    const r: any = await tx.execute(sql`
      delete from marketing_optout mo
       where mo.tenant_id = ${e.tenantId}::uuid
         and ${sqlChaveTelefone(sql`mo.telefone`)} = ${p.chave}`);
    await evento(tx, e, acao, p);
    return Number(r?.rowCount ?? 0);
  });
}

/** O número está na lista de exclusão (em qualquer forma equivalente)? */
export async function estaNaListaDeExclusao(db: any, tenantId: string, telefone: unknown): Promise<boolean> {
  const chave = chaveTelefone(telefoneCadastro(telefone));
  if (!chave) return false;
  const r: any = await db.execute(sql`
    select 1 from marketing_optout mo
     where mo.tenant_id = ${tenantId}::uuid and ${sqlChaveTelefone(sql`mo.telefone`)} = ${chave}
     limit 1`);
  return (r?.rows ?? r ?? []).length > 0;
}
