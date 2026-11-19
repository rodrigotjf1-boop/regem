import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../db/drizzle.module';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * SAIR ENCERRA A SESSÃO NO SERVIDOR (3ª rodada de segurança, 19/11/2026, achado R3-01; ERR-534; mig 457).
 *
 * Cada sessão nasce com um número próprio (`jti`, posto por `AuthService.assinar`). "Sair" grava esse número em
 * `sessao_encerrada` (com o vencimento do token) e o `JwtAuthGuard` e o tempo real recusam a sessão encerrada — antes, uma
 * cópia do cookie ou do token, feita antes de sair, seguia valendo até vencer (12 h).
 *
 * A conferência é a cada requisição, então tem memória (a nuvem fala com um banco longe — cada ida custa):
 *  - `encerradas`: as sessões que ESTE processo sabe encerradas (pela saída feita aqui ou lidas do banco) — valem até o
 *    token vencer; a saída feita aqui vale na hora para TODOS os guardas do processo (cada módulo do Nest tem a própria
 *    instância do guarda — por isso a memória é do arquivo, não da instância).
 *  - `conferidas`: "esta sessão não estava encerrada" por 30 s, a mesma janela que o guarda já usa para bloqueio e
 *    exclusão. É o prazo máximo para uma saída feita por OUTRO processo valer aqui.
 * Sem o banco (fora do ar, ou a tabela ainda não existe no servidor da loja antes da migration): não derruba a sessão —
 * a mesma escolha do guarda para o bloqueio; a memória das encerradas aqui continua valendo.
 *
 * Só o token com `jti` se encerra: os emitidos antes desta mudança vencem sozinhos em até 12 h. A sessão de suporte (da
 * distribuição) tem o encerramento dela (`suporte_sessao`).
 */

const JTI_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFERIDA_MS = 30_000;
const LIMPAR_ACIMA_DE = 5_000;

const encerradas = new Map<string, number>(); // jti → quando o token vence (ms)
const conferidas = new Map<string, number>(); // jti → até quando vale o "não estava encerrada" (ms)

/** O `jti` do token, quando é um dos nossos (uuid); senão, `null` (token antigo, sem número). */
export function jtiDoToken(payload: any): string | null {
  const j = payload?.jti;
  return typeof j === 'string' && JTI_RE.test(j) ? j.toLowerCase() : null;
}

function limparVencidas(agora: number) {
  if (encerradas.size > LIMPAR_ACIMA_DE) for (const [j, vence] of encerradas) if (vence <= agora) encerradas.delete(j);
  if (conferidas.size > LIMPAR_ACIMA_DE) for (const [j, ate] of conferidas) if (ate <= agora) conferidas.delete(j);
}

/** Anota na memória deste processo que a sessão foi encerrada (vale até o token vencer). */
export function anotarEncerrada(jti: string, venceEmMs: number) {
  const agora = Date.now();
  limparVencidas(agora);
  encerradas.set(jti, venceEmMs);
  conferidas.delete(jti);
}

/** Esta sessão foi encerrada por "Sair"? Token sem `jti` (antigo) nunca está. */
export async function sessaoEncerrada(db: DrizzleDB | undefined, payload: any): Promise<boolean> {
  const jti = jtiDoToken(payload);
  if (!jti) return false;
  const agora = Date.now();
  const vence = encerradas.get(jti);
  if (vence !== undefined) {
    if (vence > agora) return true;
    encerradas.delete(jti);
  }
  const ate = conferidas.get(jti);
  if (ate !== undefined && ate > agora) return false;
  if (!db) return false;
  try {
    const r: any = await db.execute(sql`select expira_em from sessao_encerrada where jti = ${jti}::uuid limit 1`);
    const linha = ((r.rows ?? r) as any[])[0];
    limparVencidas(agora);
    if (linha) {
      encerradas.set(jti, new Date(linha.expira_em).getTime());
      return true;
    }
    conferidas.set(jti, agora + CONFERIDA_MS);
    return false;
  } catch {
    return false; // banco fora do ar ou tabela ainda não criada: não derruba a sessão (ver o cabeçalho)
  }
}

/**
 * Encerra a sessão do token já CONFERIDO (assinatura válida): grava o número com o vencimento, idempotente, e varre as
 * linhas vencidas há mais de um dia. Devolve `true` só quando ESTA chamada a encerrou (token com `jti`, dentro da validade
 * e ainda não encerrado) — a segunda saída da mesma sessão devolve `false` (nada a auditar de novo).
 */
export async function encerrarSessao(db: DrizzleDB, payload: any): Promise<boolean> {
  const jti = jtiDoToken(payload);
  const expSeg = Number(payload?.exp);
  if (!jti || !Number.isFinite(expSeg)) return false;
  const venceEmMs = expSeg * 1000;
  if (venceEmMs <= Date.now()) return false;
  anotarEncerrada(jti, venceEmMs); // vale na hora neste processo, mesmo que o banco falhe abaixo
  const r: any = await db.execute(sql`
    insert into sessao_encerrada (jti, expira_em) values (${jti}::uuid, to_timestamp(${expSeg}))
    on conflict (jti) do nothing
    returning jti`);
  const nova = ((r.rows ?? r) as any[]).length > 0;
  if (nova) await db.execute(sql`delete from sessao_encerrada where expira_em < now() - interval '1 day'`);
  return nova;
}

/** Só para os testes: esquece a memória do processo (força a conferência pelo banco). */
export function esquecerMemoriaDasSessoes() {
  encerradas.clear();
  conferidas.clear();
}
