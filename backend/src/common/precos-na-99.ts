import { and, eq } from 'drizzle-orm';
import { entitlement } from '../db/schema';
import { precoDoAppDoPedido } from './preco-do-app';

// PREÇO E PAUSA NA 99 (R3 da Gestão do catálogo, fase F2; protótipo `mockups/regem-conciliacao-ifood.html` aprovado pelo
// dono em 11/11/2026 — decisão 6).
//
// O Regem guarda o preço NA 99 e se o produto está no cardápio da 99 (mig 401), como já guarda para o iFood (mig 369). O
// envio item a item à 99 vai pela fila da mig 402 (`Food99CatalogoEnvioService`). Tudo nasce DESLIGADO: o servidor só
// grava os campos com este direito ligado na empresa, e a tela só os mostra assim.
//
// Quem liga é a DISTRIBUIÇÃO (console › Integrações › "Preço e pausa na 99"; nenhuma rota do lojista grava este
// direito). Ligar só com todos os servidores de loja da empresa na versão que traz a mig 401 — o porquê está no
// cabeçalho da migration.

/** Nome do direito em `entitlement` (por empresa; sem linha = desligado). */
export const MODULO_PRECOS_NA_99 = 'precos_na_99';

/**
 * A versão do servidor da loja que traz a mig 401 (o `.zip` 1.30.13). ⚠️ Se o corte da 1.30.13 sair SEM a 401, esta
 * versão sobe junto (o `RELEASES.md` registra a dependência).
 */
export const VERSAO_MINIMA_PRECOS_NA_99 = '1.30.13';

/** O direito está ligado nesta empresa? */
export async function precosNa99Ligado(db: any, tenantId: string): Promise<boolean> {
  const [e] = await db
    .select({ ativo: entitlement.ativo })
    .from(entitlement)
    .where(and(eq(entitlement.tenantId, tenantId), eq(entitlement.modulo, MODULO_PRECOS_NA_99)));
  return e?.ativo === true;
}

/** O preço na 99 que veio no pedido (a regra do preço no iFood: ausente mantém, vazio limpa, até 2 casas). */
export function preco99DoPedido(valor: unknown): string | null | undefined {
  return precoDoAppDoPedido(valor, 'Preço na 99');
}
