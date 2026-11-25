import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TRAVA DO INSUMO — revisão do estoque de 25/11/2026 (EST-B-01, EST-E-01, EST-D-01).
//
// Quem LÊ o saldo ou o custo médio de um insumo e GRAVA uma conta feita em cima do que leu (o ajuste para o saldo
// contado, o ajuste da contagem, o custo médio de uma entrada) precisa que ninguém mude esse saldo no meio. Sem trava,
// dois terminais liam o mesmo "antes" e lançavam a mesma diferença duas vezes; duas notas diferentes do mesmo insumo
// sobrescreviam o custo médio uma da outra.
//
// `for no key update` na linha de `item_estoque`, DENTRO da transação de quem grava:
//  • põe em fila quem lê-e-grava o mesmo insumo (a segunda transação espera a primeira terminar e, como cada comando
//    em READ COMMITTED vê o que já foi confirmado, a leitura seguinte já enxerga o que a primeira gravou);
//  • NÃO segura a venda: a chave estrangeira do movimento pega `for key share`, que não conflita com `for no key update`;
//  • em ORDEM de id: dois documentos com os mesmos insumos em ordem diferente não ficam esperando um pelo outro.
// A trava vale até o fim da transação. Chamar ANTES da primeira leitura do saldo ou do custo.
export async function travarInsumos(tx: any, tenantId: string, itemIds: (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(itemIds.filter((x): x is string => !!x))].sort();
  if (!ids.length) return;
  await tx.execute(sql`
    select id from item_estoque
     where tenant_id = ${tenantId} and id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
     order by id
       for no key update`);
}
