import { CardapioService } from './cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Cache curto dos mapas de estoque do cardápio.
//
// A soma de saldo varre TODO o histórico de movimentações da loja, sem filtro de
// data, e era refeita a cada abertura do cardápio. O que se garante aqui é o
// contrato do cache: dentro da janela não vai ao banco, fora dela vai, cada loja
// tem a sua, e dá para desligar.

function fakeDb() {
  let chamadas = 0;
  return {
    get chamadas() {
      return chamadas;
    },
    execute: () => {
      chamadas++;
      return Promise.resolve({ rows: [] });
    },
  } as any;
}

// Só `db` é usado por mapasEstoque; as outras dependências não entram no caminho.
function servico(db: any) {
  const u = undefined as any;
  return new CardapioService(db, u, u, u, u, u, u, u);
}

describe('CardapioService — cache dos mapas de estoque', () => {
  afterEach(() => {
    delete process.env.CARDAPIO_ESTOQUE_TTL_MS;
  });

  it('vai ao banco na primeira vez e reaproveita dentro da janela', async () => {
    const db = fakeDb();
    const svc: any = servico(db);
    await svc.mapasEstoque('loja-1');
    expect(db.chamadas).toBe(3); // saldo + fichas + combos

    await svc.mapasEstoque('loja-1');
    await svc.mapasEstoque('loja-1');
    expect(db.chamadas).toBe(3); // nada de novo: veio do cache
  });

  it('cada loja tem o seu cache', async () => {
    const db = fakeDb();
    const svc: any = servico(db);
    await svc.mapasEstoque('loja-1');
    await svc.mapasEstoque('loja-2');
    expect(db.chamadas).toBe(6);
  });

  it('volta ao banco depois que a janela expira', async () => {
    process.env.CARDAPIO_ESTOQUE_TTL_MS = '1';
    const db = fakeDb();
    const svc: any = servico(db);
    await svc.mapasEstoque('loja-1');
    await new Promise((r) => setTimeout(r, 15));
    await svc.mapasEstoque('loja-1');
    expect(db.chamadas).toBe(6);
  });

  it('TTL 0 desliga o cache (loja que precisa de exatidão)', async () => {
    process.env.CARDAPIO_ESTOQUE_TTL_MS = '0';
    const db = fakeDb();
    const svc: any = servico(db);
    await svc.mapasEstoque('loja-1');
    await svc.mapasEstoque('loja-1');
    expect(db.chamadas).toBe(6);
  });

  it('invalidarEstoque força a próxima leitura a ir ao banco', async () => {
    const db = fakeDb();
    const svc: any = servico(db);
    await svc.mapasEstoque('loja-1');
    svc.invalidarEstoque('loja-1');
    await svc.mapasEstoque('loja-1');
    expect(db.chamadas).toBe(6);
  });

  it('devolve os três mapas mesmo sem nenhuma movimentação', async () => {
    const db = fakeDb();
    const svc: any = servico(db);
    const m = await svc.mapasEstoque('loja-1');
    expect(m.saldo instanceof Map).toBe(true);
    expect(m.ingMap instanceof Map).toBe(true);
    expect(m.comboMap instanceof Map).toBe(true);
  });
});
