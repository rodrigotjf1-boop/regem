import {
  TABELAS_SYNC,
  TABELAS_PULL,
  TABELAS_JANELA_MIRROR,
  TABELAS_DESDE_ZERO,
  TABELAS_RESTORE,
  modoPush,
  colunaLWW,
} from './sync-config';

// A config do sync é um contrato silencioso: nada falha quando uma tabela está
// FALTANDO — o edge só passa a operar com dado incompleto. Estes testes travam as
// duas omissões que quebravam o estoque no servidor local.
describe('sync-config — cadeia da ficha', () => {
  const pull = TABELAS_PULL.map((t) => t.tabela);
  const idx = (t: string) => TABELAS_PULL.findIndex((x) => x.tabela === t);

  it.each(['ficha_ingrediente', 'produto_variacao', 'produto_combo_item'])(
    '%s desce para o edge (sem ela a venda local não baixa insumo)',
    (t) => expect(pull).toContain(t),
  );

  it('a cadeia inteira da explosão de ficha está no pull', () => {
    // acumularProduto/acumularFicha lê exatamente estas tabelas.
    ['produto', 'ficha_tecnica', 'ficha_ingrediente', 'produto_combo_item', 'item_estoque']
      .forEach((t) => expect(pull).toContain(t));
  });

  it('ficha_ingrediente vem DEPOIS de ficha_tecnica e item_estoque (ordem de FK)', () => {
    expect(idx('ficha_ingrediente')).toBeGreaterThan(idx('ficha_tecnica'));
    expect(idx('ficha_ingrediente')).toBeGreaterThan(idx('item_estoque'));
  });

  it('variação e combo vêm DEPOIS de produto (ordem de FK)', () => {
    expect(idx('produto_variacao')).toBeGreaterThan(idx('produto'));
    expect(idx('produto_combo_item')).toBeGreaterThan(idx('produto'));
  });

  it('catálogo é master na nuvem: as três só DESCEM', () => {
    ['ficha_ingrediente', 'produto_variacao', 'produto_combo_item'].forEach((t) => {
      expect(TABELAS_SYNC.find((x) => x.tabela === t)?.direcao).toBe('desce');
      expect(modoPush(t)).toBeNull(); // não sobe: o edge não é dono do catálogo
    });
  });

  it('o cursor delas é updated_at — created_at não pegaria EDIÇÃO de ficha', () => {
    ['ficha_ingrediente', 'produto_variacao', 'produto_combo_item'].forEach((t) => {
      expect(TABELAS_SYNC.find((x) => x.tabela === t)?.cursor).toBe('updated_at');
      expect(colunaLWW(t)).toBe('updated_at');
    });
  });

  it('nenhuma delas é janelada — catálogo desce integral', () => {
    ['ficha_ingrediente', 'produto_variacao', 'produto_combo_item'].forEach((t) =>
      expect(TABELAS_JANELA_MIRROR.has(t)).toBe(false),
    );
  });
});

describe('sync-config — ledger de estoque não pode ser janelado', () => {
  it('movimento_estoque FORA da janela de espelho', () => {
    // O saldo é a soma de TODO o ledger; truncar em N dias faz o saldo local nascer
    // errado. Se alguém reintroduzir isto, o estoque do edge volta a mentir.
    expect(TABELAS_JANELA_MIRROR.has('movimento_estoque')).toBe(false);
  });

  it('os transacionais de EVENTO seguem janelados (a janela continua valendo)', () => {
    ['comanda', 'comanda_item', 'caixa_sessao', 'lancamento_caixa', 'pedido_externo']
      .forEach((t) => expect(TABELAS_JANELA_MIRROR.has(t)).toBe(true));
  });

  it('movimento_estoque continua descendo e subindo como append', () => {
    expect(TABELAS_PULL.map((t) => t.tabela)).toContain('movimento_estoque');
    expect(modoPush('movimento_estoque')).toBe('append');
  });

  it('o snapshot do restore também traz o ledger inteiro', () => {
    // O snapshot usa TABELAS_JANELA_MIRROR; fora dela = sem corte na restauração.
    expect(TABELAS_RESTORE.map((t) => t.tabela)).toContain('movimento_estoque');
    expect(TABELAS_JANELA_MIRROR.has('movimento_estoque')).toBe(false);
  });
});

describe('sync-config — piso do cursor para tabela nova', () => {
  it('as tabelas recém-adicionadas começam do zero', () => {
    ['ficha_ingrediente', 'produto_variacao', 'produto_combo_item', 'movimento_estoque']
      .forEach((t) => expect(TABELAS_DESDE_ZERO.has(t)).toBe(true));
  });

  it('só vale para tabela que o edge realmente puxa', () => {
    const pull = new Set(TABELAS_PULL.map((t) => t.tabela));
    TABELAS_DESDE_ZERO.forEach((t) => expect(pull.has(t)).toBe(true));
  });

  it('não afeta o catálogo que já descia (piso global segue valendo lá)', () => {
    ['produto', 'ficha_tecnica', 'item_estoque', 'colaborador']
      .forEach((t) => expect(TABELAS_DESDE_ZERO.has(t)).toBe(false));
  });
});

describe('sync-config — invariantes gerais', () => {
  it('nenhuma tabela aparece duas vezes em TABELAS_SYNC', () => {
    const nomes = TABELAS_SYNC.map((t) => t.tabela);
    expect(nomes.length).toBe(new Set(nomes).size);
  });

  it('toda tabela do pull tem cursor declarado', () => {
    TABELAS_PULL.forEach((t) => expect(t.cursor).toBeTruthy());
  });
});
