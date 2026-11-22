import { sql, type SQL } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PERFIL SÓ ABRE DEPOIS DO AVISO (decisão do dono de 22/11/2026; CDC art. 43 §2º, LGPD arts. 9º e 10 §2º; ERR-562). Com a
// variável `PERFIL_SO_COM_AVISO=1` na API:
//  • o cálculo só grava o perfil de quem viu o aviso (os números da loja continuam vindo de todos os pedidos);
//  • a rotina tira de uso o que já existia: apaga o perfil e o que move o cliente, e devolve os cliques ao anônimo. Os pedidos,
//    o cadastro e o que o cliente contou (a alergia é segurança) ficam; o perfil é refeito pelos pedidos depois do aviso;
//  • o aviso só se grava com a prova de posse do telefone (o `clienteToken` — V79): pedido sem conta não abre perfil.
// NASCE DESLIGADO: ligar apaga os perfis de quem ainda não viu o aviso, e quem liga é o dono (no EasyPanel, como as `MISTER_*`).

/** A regra ligada na instalação (lida a cada chamada). */
export const perfilSoComAviso = (): boolean => String(process.env.PERFIL_SO_COM_AVISO ?? '').trim() === '1';

/** Mudou o texto, muda a versão: o histórico prova o que cada cliente leu. */
export const VERSAO_DO_AVISO = '2026-11-22';

export const TEXTO_DO_AVISO =
  'A loja guarda um resumo dos pedidos que você fez direto com ela, inclusive antes deste cardápio: o que costuma pedir, ' +
  'quando, quanto gasta e suas avaliações e reclamações. Pedidos do iFood e da 99 não entram. O resumo serve para sugerir ' +
  'produtos e atender você melhor. Não vendemos seus dados nem enviamos sua lista para anúncios. Você pode recusar agora ou ' +
  'depois, no Perfil ou mandando PRIVACIDADE no WhatsApp. Recusar não muda preço, desconto comum nem seu pedido.';

export const RESPOSTAS_DO_AVISO = ['continuou', 'recusou'] as const;
export type RespostaDoAviso = (typeof RESPOSTAS_DO_AVISO)[number];

const linhas = (r: any): any[] => r?.rows ?? r ?? [];

/** A condição "este cliente já viu o aviso" (qualquer versão). */
export const sqlFoiAvisado = (tenant: SQL, cliente: SQL): SQL =>
  sql`exists (select 1 from cliente_aviso_perfil av where av.cliente_id = ${cliente} and av.tenant_id = ${tenant})`;

/** Com a regra desligada vale `true`: nada muda, e a tabela nem é lida. */
export async function clienteFoiAvisado(db: any, tenantId: string, clienteId: string): Promise<boolean> {
  if (!perfilSoComAviso()) return true;
  const [r] = linhas(await db.execute(sql`select ${sqlFoiAvisado(sql`${tenantId}::uuid`, sql`${clienteId}::uuid`)} as ok`));
  return !!r?.ok;
}

/** O que o cardápio mostra. `null` = regra desligada (o cardápio continua como era). */
export async function lerAvisoDoPerfil(db: any, tenantId: string, clienteId: string) {
  if (!perfilSoComAviso()) return null;
  return { versao: VERSAO_DO_AVISO, texto: TEXTO_DO_AVISO, visto: await clienteFoiAvisado(db, tenantId, clienteId) };
}

/** Grava a resposta com o texto DESTE arquivo (nunca o que veio do navegador). Repetir não muda a primeira. */
export async function gravarRespostaDoAviso(tx: any, c: { tenantId: string; id: string }, resposta: RespostaDoAviso, origem: string): Promise<void> {
  await tx.execute(sql`
    insert into cliente_aviso_perfil (tenant_id, cliente_id, versao, texto, resposta, origem)
    values (${c.tenantId}::uuid, ${c.id}::uuid, ${VERSAO_DO_AVISO}, ${TEXTO_DO_AVISO}, ${resposta}, ${origem})
    on conflict (cliente_id, versao) do nothing`);
}

/**
 * Tira de uso, numa instrução só, o que foi montado de quem não viu o aviso. Idempotente. `skip locked`: a linha presa pela
 * rotina fica para a volta seguinte (V93). Só na nuvem e só com a regra ligada (quem chama confere).
 */
export async function retirarPerfisSemAviso(db: any): Promise<{ perfis: number; sensibilidades: number; cliques: number }> {
  const semAviso = sql`not ${sqlFoiAvisado(sql`alvo.tenant_id`, sql`alvo.cliente_id`)}`;
  const [r] = linhas(
    await db.execute(sql`
      with perfil_alvo as (
        select alvo.cliente_id from cliente_perfil alvo where ${semAviso}
         for update of alvo skip locked
      ),
      sensibilidade_alvo as (
        select alvo.cliente_id, alvo.tipo from cliente_evento_sensibilidade alvo where ${semAviso}
         for update of alvo skip locked
      ),
      clique_alvo as (
        select alvo.id from cardapio_interacao alvo where alvo.cliente_id is not null and ${semAviso}
         for update of alvo skip locked
      ),
      sem_perfil as (
        delete from cliente_perfil x using perfil_alvo a where x.cliente_id = a.cliente_id returning 1
      ),
      sem_sensibilidade as (
        delete from cliente_evento_sensibilidade x using sensibilidade_alvo a
         where x.cliente_id = a.cliente_id and x.tipo = a.tipo returning 1
      ),
      anonimos as (
        update cardapio_interacao x set cliente_id = null from clique_alvo a where x.id = a.id returning 1
      )
      select (select count(*)::int from sem_perfil) as perfis,
             (select count(*)::int from sem_sensibilidade) as sensibilidades,
             (select count(*)::int from anonimos) as cliques`),
  );
  return { perfis: Number(r?.perfis ?? 0), sensibilidades: Number(r?.sensibilidades ?? 0), cliques: Number(r?.cliques ?? 0) };
}
