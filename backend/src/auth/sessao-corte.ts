import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../db/drizzle.module';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * "PERDI O CELULAR" — O CORTE DAS SESSÕES DE UMA PESSOA (Mister versão 6, M6c; mig 473; `mockups/regem-mister-v6.html`).
 *
 * "Sair" (mig 457, `sessao-encerrada.ts`) encerra UMA sessão pelo número dela. Quem perdeu o celular não tem como sair
 * nele: o corte vale para a PESSOA — todo token dela com `iat` (quando foi emitido) ANTES do `desde` deixa de valer, em
 * todos os aparelhos. A guarda das rotas (`JwtAuthGuard`) e o tempo real (`RealtimeGateway`) conferem por aqui (V97).
 *
 * Quem escreve é a nuvem (Mister › Pessoas e o console); a linha DESCE ao servidor da loja pelo sync, e a guarda de lá passa
 * a recusar também. A conferência tem memória, como a da sessão encerrada:
 *  - `cortes`: o corte de cada pessoa lido do banco (ou feito aqui), por 30 s — a mesma janela que a guarda já usa para
 *    bloqueio e exclusão; o corte feito NESTE processo vale na hora (`anotarCorte`).
 * Sem o banco (fora do ar) ou sem a tabela (o servidor da loja antes da atualização): não derruba a sessão — a mesma escolha
 * da guarda para o bloqueio. A conferência é À PARTE da leitura da pessoa na guarda de propósito: a tabela faltando não
 * pode levar junto a conferência do bloqueio e da exclusão.
 *
 * O `iat` é em segundos: o token emitido no MESMO segundo do corte continua valendo (quem cortou e entrou de novo na hora
 * não cai). O relógio é o de quem emitiu o token — no servidor da loja com o relógio adiantado, um token anterior ao corte
 * pode passar; o bloqueio da pessoa continua sendo o caminho para os dois lados.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFERIDO_MS = 30_000;
const LIMPAR_ACIMA_DE = 5_000;

/** Pessoa → o corte (ms; null = nenhum) e até quando a leitura vale (ms). */
const cortes = new Map<string, { desde: number | null; ate: number }>();

export const MOTIVOS_DO_CORTE = ['perdi_celular'] as const;
export type MotivoDoCorte = (typeof MOTIVOS_DO_CORTE)[number];
export const QUEM_CORTA = ['pessoa', 'presidente', 'dms'] as const;
export type QuemCorta = (typeof QUEM_CORTA)[number];

function limpar(agora: number) {
  if (cortes.size > LIMPAR_ACIMA_DE) for (const [k, v] of cortes) if (v.ate <= agora) cortes.delete(k);
}

/** O corte do token: a pessoa (`sub`) e quando ele foi emitido (`iat`, em segundos). Null = não é token de pessoa. */
function doToken(payload: any): { pessoa: string; iatSeg: number } | null {
  const sub = payload?.sub;
  const iat = Number(payload?.iat);
  if (typeof sub !== 'string' || !UUID_RE.test(sub) || !Number.isFinite(iat)) return null;
  return { pessoa: sub.toLowerCase(), iatSeg: Math.floor(iat) };
}

/** O token foi emitido antes do corte? (segundo a segundo: o mesmo segundo do corte vale). */
export function emitidoAntesDoCorte(iatSeg: number, desdeMs: number | null): boolean {
  return desdeMs !== null && iatSeg < Math.floor(desdeMs / 1000);
}

/** Anota na memória deste processo o corte que acabou de ser gravado (vale na hora para todas as guardas daqui). */
export function anotarCorte(colaboradorId: string, desdeMs: number) {
  const agora = Date.now();
  limpar(agora);
  const k = colaboradorId.toLowerCase();
  const antes = cortes.get(k)?.desde ?? null;
  cortes.set(k, { desde: antes !== null ? Math.max(antes, desdeMs) : desdeMs, ate: agora + CONFERIDO_MS });
}

/** A sessão deste token foi cortada ("Perdi o celular")? Token sem pessoa ou sem `iat` (o de suporte) nunca está. */
export async function sessaoCortada(db: DrizzleDB | undefined, payload: any): Promise<boolean> {
  const t = doToken(payload);
  if (!t) return false;
  const agora = Date.now();
  const lido = cortes.get(t.pessoa);
  if (lido && lido.ate > agora) return emitidoAntesDoCorte(t.iatSeg, lido.desde);
  if (!db) return lido ? emitidoAntesDoCorte(t.iatSeg, lido.desde) : false;
  try {
    const r: any = await db.execute(sql`select desde from sessao_corte where id = ${t.pessoa}::uuid limit 1`);
    const linha = ((r.rows ?? r) as any[])[0];
    const desde = linha?.desde ? new Date(linha.desde).getTime() : null;
    limpar(agora);
    // Nunca desce o corte que este processo já conhece (o banco pode estar atrás de uma gravação feita aqui).
    const conhecido = lido?.desde ?? null;
    const vale = desde !== null && conhecido !== null ? Math.max(desde, conhecido) : (desde ?? conhecido);
    cortes.set(t.pessoa, { desde: vale, ate: agora + CONFERIDO_MS });
    return emitidoAntesDoCorte(t.iatSeg, vale);
  } catch {
    // Banco fora do ar ou a tabela ainda não existe (o servidor da loja antes da atualização): não derruba a sessão.
    return lido ? emitidoAntesDoCorte(t.iatSeg, lido.desde) : false;
  }
}

/**
 * Corta as sessões de uma pessoa AGORA (o relógio do banco), só dentro da empresa dela: grava (ou sobe) o `desde` e anota na
 * memória deste processo. Devolve o instante do corte (ISO). Nunca desce um corte que já existe (`greatest`), e a linha de
 * uma pessoa de outra empresa não é tocada.
 */
export async function cortarSessoes(
  db: DrizzleDB,
  p: { tenantId: string; colaboradorId: string; motivo: MotivoDoCorte; por: QuemCorta; porColaboradorId?: string | null },
): Promise<string> {
  const r: any = await db.execute(sql`
    insert into sessao_corte (id, tenant_id, desde, motivo, por, por_colaborador_id)
    values (${p.colaboradorId}::uuid, ${p.tenantId}::uuid, clock_timestamp(), ${p.motivo}, ${p.por}, ${p.porColaboradorId ?? null}::uuid)
    on conflict (id) do update
       set desde = greatest(sessao_corte.desde, excluded.desde), motivo = excluded.motivo, por = excluded.por,
           por_colaborador_id = excluded.por_colaborador_id, updated_at = now()
     where sessao_corte.tenant_id = excluded.tenant_id
    returning to_char(desde at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as desde`);
  const linha = ((r.rows ?? r) as any[])[0];
  if (!linha?.desde) throw new Error('o corte não foi gravado (a pessoa é de outra empresa)');
  anotarCorte(p.colaboradorId, Date.parse(linha.desde));
  return String(linha.desde);
}

/** Só para os testes: esquece a memória do processo (força a conferência pelo banco). */
export function esquecerMemoriaDosCortes() {
  cortes.clear();
}
