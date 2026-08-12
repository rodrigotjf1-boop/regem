import { DeliveryService } from '../delivery/delivery.service';
import { pedidoExterno } from '../../db/schema';

// Idempotência do pedido público (Etapa 1): duas chamadas com o MESMO client_ref
// geram UM pedido. Testa o contrato no ponto de gravação (DeliveryService.ingest),
// com um banco falso em memória (sem depender de Postgres).
function fakeDb() {
  const store: any[] = [];
  // Query encadeável: só a tabela pedido_externo devolve o store; outras, vazio.
  const thenable = (tbl: any) => {
    const p: any = Promise.resolve(tbl === pedidoExterno ? [...store] : []);
    p.from = () => p;
    p.where = () => p;
    p.limit = () => p;
    p.orderBy = () => p;
    return p;
  };
  return {
    store,
    select: () => ({ from: (t: any) => thenable(t) }),
    insert: () => ({
      values: (v: any) => ({
        returning: () => {
          const row = { id: `p${store.length + 1}`, ...v };
          store.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    execute: () => Promise.resolve({ rows: [{ n: store.length + 1 }] }),
  };
}

describe('pedido público — idempotência por client_ref', () => {
  const raw = {
    cliente: 'Cliente',
    clienteTelefone: '11999999999',
    tipo: 'retirada',
    endereco: null,
    formaPagamento: 'entrega',
    total: 10,
    displayId: '1',
    itens: [],
  };

  it('duas chamadas com o mesmo client_ref geram UM pedido', async () => {
    const db = fakeDb();
    const svc = new DeliveryService(db as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const a: any = await svc.ingest('t1', null, 'cardapio', raw, { clientRef: 'ref-1' });
    const b: any = await svc.ingest('t1', null, 'cardapio', raw, { clientRef: 'ref-1' });
    expect(db.store.length).toBe(1); // não duplicou
    expect(a.id).toBe(b.id); // devolveu o mesmo pedido
  });

  it('sem client_ref, cada chamada cria um pedido (comportamento atual preservado)', async () => {
    const db = fakeDb();
    const svc = new DeliveryService(db as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    await svc.ingest('t1', null, 'cardapio', raw); // sem extra.clientRef
    await svc.ingest('t1', null, 'cardapio', raw);
    expect(db.store.length).toBe(2);
  });
});
