import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TABELAS_SYNC,
  TABELAS_PULL,
  TABELAS_JANELA_MIRROR,
  TABELAS_DESDE_ZERO,
  TABELAS_RESTORE,
  modoPush,
  colunaLWW,
  TABELAS_EXCLUIVEIS,
  TABELAS_PULL_APPEND,
  JANELA_ABERTOS,
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

describe('sync-config — documentos de estoque', () => {
  const DOCS = [
    'recebimento', 'recebimento_item', 'lote', 'desperdicio',
    'contagem_lista', 'contagem_lista_item', 'contagem_execucao', 'contagem_item',
    'compra_lista', 'compra_item', 'titulo_financeiro',
  ];
  const idx = (t: string) => TABELAS_SYNC.findIndex((x) => x.tabela === t);

  it.each(DOCS)('%s sincroniza nos dois sentidos', (t) => {
    expect(TABELAS_SYNC.find((x) => x.tabela === t)?.direcao).toBe('ambos');
  });

  it('sobem por LWW — o documento MUDA DE ESTADO depois de criado', () => {
    // Recebimento confirma, contagem fecha, título é pago. Como append puro, a mudança
    // de estado nunca chegaria do outro lado (é a razão escrita na mig 095).
    DOCS.forEach((t) => {
      expect(modoPush(t)).toBe('lww');
      expect(colunaLWW(t)).toBe('updated_at');
    });
  });

  it('a conta a pagar do recebimento chega ao Financeiro da nuvem', () => {
    // `recebimento.confirmar()` insere em titulo_financeiro. Sem esta linha, a dívida
    // com o fornecedor ficava presa no servidor local.
    expect(TABELAS_PULL.map((t) => t.tabela)).toContain('titulo_financeiro');
    expect(modoPush('titulo_financeiro')).toBe('lww');
  });

  it('filho vem depois do pai (ordem de FK no apply)', () => {
    const pais: [string, string][] = [
      ['recebimento_item', 'recebimento'],
      ['lote', 'recebimento'],
      ['contagem_lista_item', 'contagem_lista'],
      ['contagem_execucao', 'contagem_lista'],
      ['contagem_item', 'contagem_execucao'],
      ['compra_item', 'compra_lista'],
    ];
    pais.forEach(([filho, pai]) => expect(idx(filho)).toBeGreaterThan(idx(pai)));
  });

  it('vêm depois de fornecedor e item_estoque (FK dos documentos)', () => {
    DOCS.forEach((t) => {
      expect(idx(t)).toBeGreaterThan(idx('item_estoque'));
      expect(idx(t)).toBeGreaterThan(idx('fornecedor'));
    });
  });

  it('o histórico desce uma vez em edge já instalado', () => {
    DOCS.forEach((t) => expect(TABELAS_DESDE_ZERO.has(t)).toBe(true));
  });

  it('documento não é janelado — nota de um ano atrás continua visível', () => {
    DOCS.forEach((t) => expect(TABELAS_JANELA_MIRROR.has(t)).toBe(false));
  });
});

// A lista de PUSH do edge é HARDCODED no daemon, separada da whitelist do backend.
// Foi exatamente assim que 11 tabelas ficaram de fora sem ninguém perceber: nada falha
// quando as duas divergem — o dado só para de subir. Este teste é o alarme.
describe('sync-config × PUSH_TABLES do daemon do edge', () => {
  const fonte = readFileSync(join(__dirname, '../../../edge/sync-daemon.mjs'), 'utf8');
  const bloco = fonte.slice(fonte.indexOf('const PUSH_TABLES'), fonte.indexOf('const SNAPSHOT_TABELAS'));
  const doDaemon = new Set([...bloco.matchAll(/tabela:\s*'([a-z_]+)'/g)].map((m) => m[1]));

  it('o daemon foi lido (guarda contra o regex parar de casar)', () => {
    expect(doDaemon.size).toBeGreaterThan(10);
    expect(doDaemon.has('comanda')).toBe(true);
  });

  it('TODA tabela que sobe no backend está na lista de push do daemon', () => {
    const sobem = TABELAS_SYNC.filter((t) => t.direcao !== 'desce').map((t) => t.tabela);
    const faltando = sobem.filter((t) => !doDaemon.has(t));
    expect(faltando).toEqual([]);
  });

  it('o daemon não empurra tabela que o backend não aceita', () => {
    const sobrando = [...doDaemon].filter((t) => modoPush(t) === null);
    expect(sobrando).toEqual([]);
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

// A reconciliação pós-atualização (edge/sync-reconciliacao.mjs) rebaixa e completa as
// tabelas da lista fixa da transição 1.29.0. Tabela ali que não desce da nuvem nunca seria
// reconciliada e a fila ficaria parada nela — e o push dela, esperando para sempre.
describe('sync-reconciliacao — lista da transição 1.29.0', () => {
  const fonte = readFileSync(join(__dirname, '..', '..', '..', 'edge', 'sync-reconciliacao.mjs'), 'utf8');
  const bloco = fonte.slice(fonte.indexOf('export const COLUNAS_POS_1_29'), fonte.indexOf('};', fonte.indexOf('export const COLUNAS_POS_1_29')));
  const tabelas = [...bloco.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
  const pull = new Set(TABELAS_PULL.map((t) => t.tabela));

  it('a lista foi lida do módulo', () => expect(tabelas.length).toBeGreaterThan(10));

  it.each(tabelas.length ? tabelas : ['(vazia)'])('%s desce da nuvem', (t) => expect(pull.has(t)).toBe(true));
});

// Exclusões (mig 262). Tabela sincronizada sem o gatilho de exclusão volta a ter linha
// fantasma do outro lado — e nada falha. E a ordem importa: a exclusão tem de ser aplicada
// DEPOIS das linhas do mesmo ciclo, senão uma linha criada e apagada no intervalo ressuscita.
describe('sync_exclusao — cobertura e ordem', () => {
  const mig = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '262_sync_exclusao_e_carimbo.sql'),
    'utf8',
  );
  const blocoGatilho = mig.slice(mig.indexOf('── 1)'), mig.indexOf('── 2)'));
  const comGatilho = new Set([...blocoGatilho.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

  it('toda tabela em que a exclusão pode ser aplicada tem o gatilho na mig 262', () => {
    const faltando = [...TABELAS_EXCLUIVEIS].filter((t) => !comGatilho.has(t));
    expect(faltando).toEqual([]);
  });

  it('a exclusão desce por último no pull', () => {
    expect(TABELAS_PULL_APPEND[TABELAS_PULL_APPEND.length - 1].tabela).toBe('sync_exclusao');
  });

  it('a exclusão sobe por último no push do daemon', () => {
    const fonte = readFileSync(join(__dirname, '../../../edge/sync-daemon.mjs'), 'utf8');
    const bloco = fonte.slice(fonte.indexOf('const PUSH_TABLES'), fonte.indexOf('const SNAPSHOT_TABELAS'));
    const tabelas = [...bloco.matchAll(/tabela:\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(tabelas[tabelas.length - 1]).toBe('sync_exclusao');
  });

  it('não apaga em empresa, nem em tabela só-anexar', () => {
    expect(TABELAS_EXCLUIVEIS.has('empresa')).toBe(false);
    ['movimento_estoque', 'movimento_lote', 'lancamento_caixa', 'audit_log', 'ponto_marcacao', 'sync_exclusao'].forEach((t) =>
      expect(TABELAS_EXCLUIVEIS.has(t)).toBe(false),
    );
  });
});

// Janela de 60 dias corta pela CRIAÇÃO. Caixa ou comanda ainda abertos têm de descer mesmo
// antigos — senão o PDV local não enxerga o caixa aberto e os lançamentos dele ficam órfãos.
describe('janela do espelho — registro aberto', () => {
  it.each(['caixa_sessao', 'comanda'])('%s aberta desce mesmo fora da janela', (t) => {
    expect(TABELAS_JANELA_MIRROR.has(t)).toBe(true);
    expect(JANELA_ABERTOS[t]).toMatch(/status = 'aberta'/);
  });
});
