import { sql, type SQL } from 'drizzle-orm';
import { REGRAS_DO_PERFIL } from './calculo-do-perfil';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PRAZO DO PERFIL DO CLIENTE (§3.5 do docs/plano-perfil-cliente.md; a política de privacidade promete o mesmo): o perfil
// vale enquanto o cliente pede + 12 meses. A rotina noturna já não recalcula quem passou do prazo, mas ela só roda com o
// módulo ligado: esta limpeza vale para TODAS as empresas, inclusive a que desligou o módulo.
//  • saem: o perfil, o que move o cliente (mig 463) e o que ele contou (`cliente_declarado`, inclusive a alergia);
//  • ficam: o cadastro, os pedidos (registro da venda) e `cliente_escolha` (a prova do que ele escolheu — LGPD art. 8º §2º);
//  • o que ele contou conta o prazo também da última vez que atualizou: quem contou há 1 mês e nunca pediu continua;
//  • `skip locked`: a linha presa pela rotina noturna fica para a volta seguinte, sem impasse entre as duas (V93).

const linhas = (r: any): any[] => r?.rows ?? r ?? [];
const corte = (): SQL => sql`now() - make_interval(months => ${REGRAS_DO_PERFIL.retencaoMeses}::int)`;
const pedidoDireto = sql`p.status <> 'cancelado' and coalesce(p.canal, '') not in ('ifood', '99food')`;
/** A linha `alvo` é de um cliente sem pedido direto dentro do prazo. */
const semPedidoNoPrazo = (): SQL => sql`not exists (
  select 1 from pedido_externo p
   where p.cliente_id = alvo.cliente_id and p.tenant_id = alvo.tenant_id and ${pedidoDireto} and p.criado_em >= ${corte()})`;

/** Apaga o que passou do prazo, numa instrução só, para todas as empresas. Idempotente. Só na nuvem (quem chama confere). */
export async function expurgarPerfisVencidos(db: any): Promise<{ perfis: number; sensibilidades: number; declarados: number }> {
  const [r] = linhas(
    await db.execute(sql`
      with perfil_alvo as (
        select alvo.cliente_id from cliente_perfil alvo
         where coalesce(alvo.ultimo_pedido_em, alvo.calculado_em) < ${corte()} and ${semPedidoNoPrazo()}
         for update of alvo skip locked
      ),
      sensibilidade_alvo as (
        select alvo.cliente_id, alvo.tipo from cliente_evento_sensibilidade alvo
         where ${semPedidoNoPrazo()}
         for update of alvo skip locked
      ),
      declarado_alvo as (
        select alvo.id from cliente_declarado alvo
         where alvo.atualizado_em < ${corte()} and ${semPedidoNoPrazo()}
         for update of alvo skip locked
      ),
      sem_perfil as (
        delete from cliente_perfil x using perfil_alvo a where x.cliente_id = a.cliente_id returning 1
      ),
      sem_sensibilidade as (
        delete from cliente_evento_sensibilidade x using sensibilidade_alvo a
         where x.cliente_id = a.cliente_id and x.tipo = a.tipo returning 1
      ),
      sem_declarado as (
        delete from cliente_declarado x using declarado_alvo a where x.id = a.id returning 1
      )
      select (select count(*)::int from sem_perfil) as perfis,
             (select count(*)::int from sem_sensibilidade) as sensibilidades,
             (select count(*)::int from sem_declarado) as declarados`),
  );
  return { perfis: Number(r?.perfis ?? 0), sensibilidades: Number(r?.sensibilidades ?? 0), declarados: Number(r?.declarados ?? 0) };
}

/** O cliente tem algum pedido direto não cancelado, de qualquer data? (A ficha separa "perfil apagado" de "só iFood/99".) */
export async function temPedidoDireto(db: any, tenantId: string, clienteId: string): Promise<boolean> {
  const [r] = linhas(
    await db.execute(sql`
      select exists (select 1 from pedido_externo p
                      where p.tenant_id = ${tenantId}::uuid and p.cliente_id = ${clienteId}::uuid and ${pedidoDireto}) as tem`),
  );
  return !!r?.tem;
}
