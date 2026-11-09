import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A FALA DO ATENDENTE VIRTUAL NO WHATSAPP ("Corrigir no WhatsApp", mig 385). A tela do caso oferece "Corrigir" na mensagem
// que o ROBÔ mandou — como no Direct do Instagram e no chat do iFood/99. O histórico do WhatsApp não tem autor (a API
// oficial grava `whatsapp_mensagem` sem ele; a Evolution guarda o histórico nela), então a resposta do robô
// (`publico/bot/responder`) anota aqui o id de cada mensagem que SAIU (o wamid na API oficial, o `key.id` na Evolution — o
// MESMO id que `GET /whatsapp/mensagens` devolve), e a caixa de conversas devolve `doRobo` em cada mensagem.
// Só a resposta do robô anota: a equipe, os avisos automáticos e o pedido montado pelo Regem não são fala do atendente.
// Tudo aqui é só da NUVEM (a tabela é @cloud-only) e NUNCA derruba quem chamou: falha = aviso no log com o motivo (V11).

/** Quantos dias a marca fica: o "Corrigir" é para conversa recente. A rotina de 6 h da nuvem apaga as mais velhas. */
export const DIAS_DA_MARCA_DO_ROBO = 30;

type Aviso = { warn(mensagem: string): void };

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';
// Banco sem a 385 (antes de ela entrar na nuvem): um aviso só por processo, não um a cada mensagem.
let jaAvisouSemTabela = false;
function avisar(logger: Aviso, oQue: string, e: any): void {
  if (semTabela(e)) {
    if (jaAvisouSemTabela) return;
    jaAvisouSemTabela = true;
    logger.warn(`${oQue}: o banco não tem a whatsapp_do_robo (mig 385) — nenhuma mensagem sai marcada como do robô`);
    return;
  }
  logger.warn(`${oQue}: ${e?.message ?? e}`);
}

/** Só para teste: volta a avisar da tabela ausente. */
export function esquecerAvisoDaMarca(): void {
  jaAvisouSemTabela = false;
}

/** Os ids de mensagem que valem (texto não vazio, de tamanho são, sem repetição). */
function idsValidos(ids: readonly unknown[]): string[] {
  const vistos = new Set<string>();
  for (const v of Array.isArray(ids) ? ids : []) {
    const id = typeof v === 'string' ? v.trim() : '';
    if (id && id.length <= 200) vistos.add(id);
  }
  return [...vistos];
}

/** A lista como `array[...]::text[]` (um parâmetro por id — V31). */
const arrayDeTexto = (ids: string[]) => sql`array[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::text[]`;

/** O id que um envio devolveu (`{ ok, id }`), ou nulo. */
export function idDoEnvio(r: unknown): string | null {
  const id = (r as any)?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

/**
 * Anota as mensagens que o robô mandou ao cliente (uma gravação para o lote, `on conflict do nothing` — V24). Devolve
 * quantas entraram. NUNCA rejeita: a resposta ao cliente já saiu, a marca é só para a tela.
 */
export async function marcarDoRobo(
  db: DrizzleDB,
  tenantId: string,
  telefone: string,
  ids: readonly unknown[],
  logger: Aviso,
): Promise<number> {
  const lista = idsValidos(ids);
  // A rota do robô é só da nuvem (@CloudOnly); a guarda fica aqui também, para quem chamar de outro lugar (V1).
  if (!lista.length || !tenantId || ehServidorLocal()) return 0;
  try {
    const tel = String(telefone ?? '').replace(/\D/g, '') || null;
    const r: any = await db.execute(sql`
      insert into whatsapp_do_robo (tenant_id, mensagem_id, telefone)
      select ${tenantId}::uuid, x.id, ${tel}::text from unnest(${arrayDeTexto(lista)}) as x(id)
      on conflict (tenant_id, mensagem_id) do nothing`);
    return Number(r?.rowCount ?? 0) || 0;
  } catch (e: any) {
    avisar(logger, 'marca da fala do robô não gravada (o "Corrigir" não aparece nesta mensagem)', e);
    return 0;
  }
}

/**
 * Cada mensagem da caixa de conversas com `doRobo`: `true` só quando a LOJA mandou (`fromMe`) e o id está anotado como do
 * robô NESTA empresa. Uma consulta para o lote, cada id achado por igualdade na chave primária (`unnest` + `exists` —
 * V85). Sem a 385, no servidor da loja ou com falha na leitura: todas `false` (a caixa abre igual).
 */
export async function comMarcaDoRobo<T extends { id?: unknown; fromMe?: unknown }>(
  db: DrizzleDB,
  tenantId: string,
  mensagens: readonly T[],
  logger: Aviso,
): Promise<Array<T & { doRobo: boolean }>> {
  const lista = Array.isArray(mensagens) ? mensagens : [];
  const chave = (m: T) => (typeof m?.id === 'string' ? m.id.trim() : '');
  const daLoja = idsValidos(lista.filter((m) => m?.fromMe === true).map(chave));
  let marcadas = new Set<string>();
  if (daLoja.length && tenantId && !ehServidorLocal()) {
    try {
      const r: any = await db.execute(sql`
        select x.id from unnest(${arrayDeTexto(daLoja)}) as x(id)
         where exists (select 1 from whatsapp_do_robo w where w.tenant_id = ${tenantId}::uuid and w.mensagem_id = x.id)`);
      marcadas = new Set(linhasDe(r).map((l) => String(l.id)));
    } catch (e: any) {
      avisar(logger, 'marca da fala do robô não lida (a caixa abre sem o "Corrigir")', e);
    }
  }
  return lista.map((m) => ({ ...m, doRobo: m?.fromMe === true && marcadas.has(chave(m)) }));
}

/**
 * A limpeza: as marcas com mais de 30 dias saem (um `delete` só, pelo índice de `criado_em`). Só na nuvem; nunca rejeita
 * (roda na rotina de 6 h, junto com o expurgo do histórico). Devolve quantas saíram.
 */
export async function limparMarcasDoRobo(db: DrizzleDB, logger: Aviso): Promise<number> {
  if (ehServidorLocal()) return 0;
  try {
    const r: any = await db.execute(
      sql`delete from whatsapp_do_robo where criado_em < now() - make_interval(days => ${DIAS_DA_MARCA_DO_ROBO}::int)`,
    );
    return Number(r?.rowCount ?? 0) || 0;
  } catch (e: any) {
    if (!semTabela(e)) logger.warn(`limpeza das marcas da fala do robô não rodou: ${e?.message ?? e}`);
    return 0;
  }
}
