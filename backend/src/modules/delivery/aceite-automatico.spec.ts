import { DeliveryService } from './delivery.service';
import { pedidoExterno } from '../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ACEITE AUTOMÁTICO da entrada (`DeliveryService.aceitarSeAutomatico`), pelo `ingest` de verdade com um banco falso em
// memória: a regra é a de sempre (o "aceitar automaticamente" ligado, sem pagamento online pendente, sem servidor da loja
// que processe) e quem grava com `naoAutoAceitar` decide depois — o pedido agendado confere o limite da janela ANTES do
// aceite (achado do vigia de código, 19/11/2026: aceito dentro do `ingest`, o pedido que estourou a janela ia à cozinha).

function fakeDb() {
  const store: any[] = [];
  const thenable = (tbl: any) => {
    const p: any = Promise.resolve(tbl === pedidoExterno ? [...store] : []);
    p.from = () => p;
    p.where = () => p;
    p.limit = () => p;
    p.orderBy = () => p;
    return p;
  };
  const marcados: string[] = [];
  return {
    store,
    marcados,
    select: () => ({ from: (t: any) => thenable(t) }),
    insert: (t: any) => ({
      values: (v: any) => ({
        returning: () => {
          const row = { id: `p${store.length + 1}`, status: 'novo', ...v };
          if (t === pedidoExterno) store.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    // O "aceite automático falhou" (`autoAceiteFalhou`) marcado na linha.
    update: () => ({
      set: (s: any) => ({
        where: () => ({
          returning: () => {
            if (s?.autoAceiteFalhou) marcados.push('falhou');
            return Promise.resolve(s?.autoAceiteFalhou ? [{ ...store[store.length - 1], autoAceiteFalhou: true }] : []);
          },
        }),
      }),
    }),
    execute: () => Promise.resolve({ rows: [{ n: store.length + 1 }] }),
  };
}

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

function servico(cfg: any, opts: { edge?: boolean; aceitarFalha?: boolean } = {}) {
  const db = fakeDb();
  const svc: any = new DeliveryService(db as any, {} as any, {} as any, {} as any, {} as any, {} as any, { flashPedidos: () => {} } as any);
  const aceitos: string[] = [];
  svc.configRaw = async () => cfg;
  svc.deferirParaEdge = async () => !!opts.edge;
  svc.aceitar = async (_t: string, _u: any, id: string) => {
    if (opts.aceitarFalha) throw new Error('produto sem cadastro');
    aceitos.push(id);
    return { id, status: 'confirmado' };
  };
  return { svc, db, aceitos };
}

describe('aceite automático da entrada do pedido (aceitarSeAutomatico)', () => {
  it('ligado: o ingest aceita na entrada (como sempre)', async () => {
    const { svc, aceitos } = servico({ autoAceitar: true });
    const p = await svc.ingest('t1', null, 'cardapio', raw, { statusPagamento: 'na_entrega' });
    expect(aceitos).toEqual([p.id]);
    expect(p.status).toBe('confirmado');
  });

  it('com naoAutoAceitar o ingest só grava; o aceitarSeAutomatico, chamado depois, aceita pela mesma regra', async () => {
    const { svc, aceitos } = servico({ autoAceitar: true });
    const p = await svc.ingest('t1', null, 'cardapio', raw, { statusPagamento: 'na_entrega', naoAutoAceitar: true });
    expect(aceitos).toEqual([]);
    expect(p.status).toBe('novo');
    const depois = await svc.aceitarSeAutomatico('t1', null, p);
    expect(aceitos).toEqual([p.id]);
    expect(depois.status).toBe('confirmado');
  });

  it('não aceita: desligado, pagamento online pendente ou loja com servidor (o servidor processa)', async () => {
    const desligado = servico({ autoAceitar: false });
    await desligado.svc.aceitarSeAutomatico('t1', null, { id: 'a', status: 'novo', statusPagamento: 'na_entrega' });
    expect(desligado.aceitos).toEqual([]);
    const pix = servico({ autoAceitar: true });
    await pix.svc.aceitarSeAutomatico('t1', null, { id: 'b', status: 'novo', statusPagamento: 'aguardando' });
    expect(pix.aceitos).toEqual([]);
    const edge = servico({ autoAceitar: true }, { edge: true });
    await edge.svc.aceitarSeAutomatico('t1', null, { id: 'c', status: 'novo', statusPagamento: 'na_entrega' });
    expect(edge.aceitos).toEqual([]);
  });

  it('o aceite que falha mantém "novo" e marca o "aceite automático falhou"', async () => {
    const { svc, db } = servico({ autoAceitar: true }, { aceitarFalha: true });
    const p = await svc.ingest('t1', null, 'cardapio', raw, { statusPagamento: 'na_entrega' });
    expect(db.marcados).toEqual(['falhou']);
    expect(p.status).toBe('novo');
    expect(p.autoAceiteFalhou).toBe(true);
  });
});
