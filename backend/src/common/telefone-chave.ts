import { sql, SQL } from 'drizzle-orm';

/**
 * Telefone como o CADASTRO de cliente guarda: só os dígitos, sem o 55 do país quando vier com ele
 * (mais de 11 dígitos começando por 55) — a mesma regra da entrada de pedidos
 * (`DeliveryService.normTel`). O cardápio e o login por código gravavam o número como veio: quem
 * digitava "+55 21 9…" ganhava um SEGUNDO cadastro, porque a entrada de pedidos já tinha ligado o
 * pedido ao cadastro sem o 55 (ERR-135).
 */
export function telefoneCadastro(bruto: unknown): string {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return d;
}

/**
 * Formas em que o MESMO número pode estar guardado num cadastro antigo: a de hoje (sem o 55) e a
 * que o cardápio gravava antes da correção (com o 55). Para ACHAR o cadastro que já existe em vez
 * de criar outro — nunca para inventar número.
 */
export function formasNoCadastro(bruto: unknown): string[] {
  const t = telefoneCadastro(bruto);
  if (!t) return [];
  return t.length === 10 || t.length === 11 ? [t, `55${t}`] : [t];
}

/**
 * CHAVE DE COMPARAÇÃO do telefone brasileiro — para decidir se dois registros são o MESMO número
 * (opt-out, lista de exclusão, trava do envio). Nunca é o número a discar: não se inventa o 9 para
 * mandar mensagem (LIC-068, `telefoneE164`).
 *
 * Tira a formatação, o `0055`/`55` do país (12–13 dígitos) e o 0 de longa distância; celular
 * antigo sem o nono dígito (10 dígitos, número começando de 6 a 9) ganha o 9 — o WhatsApp manda o
 * `wa_id` de muitos celulares SEM o 9, e o cadastro tem COM (ERR-134). Fixo (número de 2 a 5) fica
 * com 10 dígitos e nunca casa com celular. O que não tem a cara de um número do Brasil fica só com
 * os dígitos: casa só com ele mesmo.
 */
export function chaveTelefone(bruto: unknown): string | null {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('0055')) d = d.slice(4);
  else if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  if (/^[1-9][0-9][6-9][0-9]{7}$/.test(d)) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d || null;
}

/**
 * A mesma chave em SQL (Postgres), para comparar dentro da consulta — `chaveTelefone` e esta têm de
 * dar o MESMO resultado (teste contra o banco real em `telefone-chave.spec.ts`). Sem barra
 * invertida no SQL (V27): `[^0-9]` no lugar de `\D`. Vazio vira `null` (nunca casa).
 */
export function sqlChaveTelefone(expr: SQL): SQL {
  const d0 = sql`regexp_replace(coalesce((${expr})::text, ''), '[^0-9]', '', 'g')`;
  const d1 = sql`(case
      when ${d0} like '0055%' then substr(${d0}, 5)
      when ${d0} like '55%' and length(${d0}) in (12, 13) then substr(${d0}, 3)
      when ${d0} like '0%' then substr(${d0}, 2)
      else ${d0} end)`;
  return sql`nullif((case
      when ${d1} ~ '^[1-9][0-9][6-9][0-9]{7}$' then substr(${d1}, 1, 2) || '9' || substr(${d1}, 3)
      else ${d1} end), '')`;
}
