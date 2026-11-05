import { and, eq } from 'drizzle-orm';
import { integracao } from '../db/schema';
import { cifrar, decifrar } from './cifra-segredo';
import type { CredencialRede } from './erede';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CREDENCIAL DA REDE (e.Rede) DA LOJA — integração 'rede': o PV em `client_id` e a chave de integração CIFRADA
// em `client_secret` (AES-256-GCM, `cifra-segredo.ts`; LIC-350). Nunca em texto puro: sem `SEGREDOS_CHAVE` no
// servidor, a chave nova é recusada.
//
// Só a NUVEM usa: o cardápio online cobra de lá, e a tabela `integracao` não sincroniza com o servidor da loja (V1).

export const CANAL_REDE = 'rede';

/** PV = número do estabelecimento na Rede: só dígitos (o Itaú Checkout aceita até 9). */
export const PV_VALIDO = /^\d{4,9}$/;

/** A chave guardada não abriu (outra SEGREDOS_CHAVE, valor alterado) — nunca "sem integração". */
export class CredencialRedeIndisponivel extends Error {
  constructor() {
    super('A chave da Rede guardada não pôde ser aberta neste servidor.');
    this.name = 'CredencialRedeIndisponivel';
  }
}

/** Cifra a chave de integração para gravar. Lança `ChaveSegredosAusente` se o servidor não tem a chave de proteção. */
export function cifrarChaveRede(chave: string): string {
  return cifrar(chave.trim());
}

/** Abre a chave guardada. Lança `CredencialRedeIndisponivel` (sem vazar nada) se não abrir. */
export function abrirChaveRede(guardada: string): string {
  try {
    return decifrar(guardada);
  } catch {
    throw new CredencialRedeIndisponivel();
  }
}

/**
 * A credencial da Rede da empresa, se a integração está LIGADA e completa; `null` se desligada ou incompleta.
 * Lança `CredencialRedeIndisponivel` se está ligada mas a chave não abre — quem chama não pode tratar isso como
 * "sem gateway" (o cardápio aprovaria o pedido sem cobrar).
 */
export async function lerCredencialRede(db: any, tenantId: string): Promise<CredencialRede | null> {
  const [row] = await db
    .select({ pv: integracao.clientId, guardada: integracao.clientSecret, ativo: integracao.ativo })
    .from(integracao)
    .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL_REDE)));
  if (!row?.ativo || !row.pv || !row.guardada) return null;
  return { pv: String(row.pv), chave: abrirChaveRede(String(row.guardada)) };
}
