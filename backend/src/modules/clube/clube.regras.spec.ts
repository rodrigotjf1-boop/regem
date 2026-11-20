import {
  CONFIG_PADRAO,
  descricaoDoPremio,
  FERRAMENTAS_PRONTAS,
  gatilhosDaLinha,
  lerConfigDoClube,
  lerGatilhoEntregue,
  lerPremio,
  ligandoAntesDaHora,
  ondeEstaEmUso,
  premiosCitados,
  regrasDoClube,
} from './clube.regras';
import { codigoDoDireito, fatiasDaRoleta } from './clube-surpresa.service';

// As regras puras do Clube de recompra (fase A0, mig 471): o que a tela manda (V15/V16, só as opções), o prêmio com os
// limites do `check` da 471, a descrição e as regras que o cliente lê (sem sorteio, um benefício por pedido).
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('a configuração do clube', () => {
  it('ausente fica de fora (V16); liga/desliga só com booleano (V15); cada escolha só entre as opções', () => {
    expect(lerConfigDoClube({})).toEqual({});
    expect(lerConfigDoClube(null)).toEqual({});
    expect(lerConfigDoClube({ surpresaAtivo: false, surpresaForma: 'roleta', minimo: 25.5 })).toEqual({
      surpresaAtivo: false,
      surpresaForma: 'roleta',
      minimo: 25.5,
    });
    expect(() => lerConfigDoClube({ albumAtivo: 'sim' })).toThrow('Álbum de selos');
    expect(() => lerConfigDoClube({ surpresaForma: 'sorteio' })).toThrow('raspadinha ou roleta');
    for (const n of [2, 13, 4.5, '4']) expect(() => lerConfigDoClube({ albumSelos: n })).toThrow('Selos para completar o álbum: de 3 a 12.');
    expect(() => lerConfigDoClube({ albumValidadeMeses: 9 })).toThrow('6 ou 12 meses');
    expect(() => lerConfigDoClube({ metaValidadeDias: 7 })).toThrow('15 ou 30 dias');
    for (const m of [-1, 1001, '30', NaN]) expect(() => lerConfigDoClube({ minimo: m })).toThrow('Pedido mínimo para contar');
  });

  it('os prêmios escolhidos: ids da lista, sem repetir, até 6', () => {
    expect(lerConfigDoClube({ albumPremios: [A, A.toUpperCase(), B] })).toEqual({ albumPremios: [A, B] });
    expect(() => lerConfigDoClube({ albumPremios: ['x'] })).toThrow('não é da lista');
    expect(() => lerConfigDoClube({ albumPremios: 'x' })).toThrow('escolha os prêmios da lista');
    const sete = Array.from({ length: 7 }, (_, i) => `${String(i).repeat(8)}-1111-4111-8111-111111111111`);
    expect(() => lerConfigDoClube({ albumPremios: sete })).toThrow('no máximo 6');
  });

  it('a meta: de 1 a 3 níveis, cada um pedindo mais que o anterior', () => {
    expect(lerConfigDoClube({ metaNiveis: [{ pedidos: 3, premios: [A] }, { pedidos: 6, premios: [] }] })).toEqual({
      metaNiveis: [
        { pedidos: 3, premios: [A] },
        { pedidos: 6, premios: [] },
      ],
    });
    expect(() => lerConfigDoClube({ metaNiveis: [] })).toThrow('de 1 a 3 níveis');
    expect(() => lerConfigDoClube({ metaNiveis: [{ pedidos: 3 }, { pedidos: 3 }] })).toThrow('cada nível pede mais pedidos');
    expect(() => lerConfigDoClube({ metaNiveis: [{ pedidos: 0 }] })).toThrow('de 1 a 30 pedidos');
  });

  it('nenhuma ferramenta liga antes da sua fase (a tela nem mostra o liga/desliga dela) — a surpresa chegou na A1', () => {
    expect(FERRAMENTAS_PRONTAS).toEqual({ surpresa: true, album: false, meta: false });
    expect(ligandoAntesDaHora({ surpresaAtivo: true, albumAtivo: true, metaAtivo: false })).toEqual(['album']);
    expect(ligandoAntesDaHora({ surpresaAtivo: true, albumAtivo: true }, { surpresa: false, album: false, meta: false })).toEqual(['surpresa', 'album']);
    expect(ligandoAntesDaHora({ surpresaAtivo: false })).toEqual([]); // desligar sempre pode
    expect(ligandoAntesDaHora({ surpresaAtivo: true }, { surpresa: true, album: false, meta: false })).toEqual([]);
  });

  it('o padrão nasce tudo desligado, raspadinha, 4 selos de 12 meses, a meta 3 e 6 pedidos, R$ 30', () => {
    expect(CONFIG_PADRAO).toMatchObject({ surpresaAtivo: false, albumAtivo: false, metaAtivo: false, surpresaForma: 'raspadinha', albumSelos: 4, albumValidadeMeses: 12, minimo: 30 });
    expect(CONFIG_PADRAO.metaNiveis.map((n) => n.pedidos)).toEqual([3, 6]);
  });

  it('onde cada prêmio está em uso e os citados', () => {
    const c = { albumPremios: [A], metaNiveis: [{ pedidos: 3, premios: [A, B] }, { pedidos: 6, premios: [B] }] };
    expect(ondeEstaEmUso(c, A)).toEqual(['Álbum de selos', 'Meta do mês, nível 1']);
    expect(ondeEstaEmUso(c, B)).toEqual(['Meta do mês, nível 1', 'Meta do mês, nível 2']);
    expect(premiosCitados(c)).toEqual([A, B]);
  });
});

describe('o prêmio', () => {
  const base = { nome: '  Batata   média grátis ', validadeDias: 7 };
  it('os quatro tipos, com os limites do check da 471', () => {
    expect(lerPremio({ ...base, tipo: 'percentual', valor: 15, teto: 20, minimo: 30 })).toEqual({
      nome: 'Batata média grátis', tipo: 'percentual', valor: 15, teto: 20, produtoId: null, minimo: 30, validadeDias: 7,
    });
    expect(lerPremio({ ...base, tipo: 'valor', valor: 10 })).toMatchObject({ tipo: 'valor', valor: 10, teto: null, minimo: 0 });
    expect(lerPremio({ ...base, tipo: 'fretegratis', valor: 99 })).toMatchObject({ tipo: 'fretegratis', valor: 0 });
    expect(lerPremio({ ...base, tipo: 'produto', produtoId: A.toUpperCase() })).toMatchObject({ tipo: 'produto', valor: 0, produtoId: A });
  });
  it('recusa o que não cabe', () => {
    expect(() => lerPremio({ ...base, nome: ' ', tipo: 'valor', valor: 5 })).toThrow('Escreva o nome');
    expect(() => lerPremio({ ...base, nome: 'x'.repeat(61), tipo: 'valor', valor: 5 })).toThrow('no máximo 60');
    expect(() => lerPremio({ ...base, tipo: 'brinde' })).toThrow('Tipo do prêmio');
    for (const v of [0, 101, '15']) expect(() => lerPremio({ ...base, tipo: 'percentual', valor: v })).toThrow('Desconto em %: de 1 a 100.');
    expect(() => lerPremio({ ...base, tipo: 'percentual', valor: 10, teto: 0 })).toThrow('Teto do desconto');
    expect(() => lerPremio({ ...base, tipo: 'valor', valor: 0 })).toThrow('Desconto em R$');
    expect(() => lerPremio({ ...base, tipo: 'produto' })).toThrow('Escolha o produto grátis.');
    expect(() => lerPremio({ ...base, tipo: 'valor', valor: 5, minimo: -1 })).toThrow('Pedido mínimo para usar');
    expect(() => lerPremio({ ...base, tipo: 'valor', valor: 5, validadeDias: 10 })).toThrow('3, 7, 15 ou 30 dias');
  });
  it('a descrição da lista e das regras', () => {
    expect(descricaoDoPremio({ tipo: 'percentual', valor: 15, teto: 20, minimo: 30, validadeDias: 7 })).toBe(
      '15% de desconto, até R$ 20 · em pedido a partir de R$ 30 · vale 7 dias',
    );
    expect(descricaoDoPremio({ tipo: 'valor', valor: 10.5, teto: null, minimo: 0, validadeDias: 15 })).toBe('R$ 10,50 de desconto · vale 15 dias');
    expect(descricaoDoPremio({ tipo: 'fretegratis', valor: 0, teto: null, minimo: 0, validadeDias: 3 })).toBe('entrega grátis · vale 3 dias');
    expect(descricaoDoPremio({ tipo: 'produto', valor: 0, teto: null, minimo: 0, validadeDias: 7, produtoNome: 'Batata média' })).toBe(
      'Batata média grátis · vale 7 dias',
    );
  });
});

describe('as regras do clube que o cliente lê', () => {
  const nome = (id: string) => ({ [A]: 'Batata média grátis', [B]: 'Frete grátis' })[id] ?? null;
  it('tudo desligado: só as travas (sem sorteio, um benefício por pedido, só no cardápio e no WhatsApp)', () => {
    expect(regrasDoClube(CONFIG_PADRAO, nome)).toEqual([
      'Não há sorteio: todo mundo que cumpre a regra recebe, e não há limite de prêmios.',
      'Um benefício por pedido: o prêmio não junta com outro cupom.',
      'Os prêmios valem só no cardápio online e no WhatsApp da loja, não no iFood nem na 99.',
    ]);
  });
  it('as ferramentas ligadas entram, com os prêmios pelo nome', () => {
    const r = regrasDoClube(
      { ...CONFIG_PADRAO, surpresaAtivo: true, surpresaForma: 'roleta', albumAtivo: true, albumPremios: [A, B], metaAtivo: true, metaNiveis: [{ pedidos: 3, premios: [B] }] },
      nome,
    );
    expect(r[0]).toBe('O prêmio já vem definido pela regra quando o cliente ganha: a roleta só mostra.');
    expect(r[1]).toBe('Álbum de selos: um selo por mês com pedido a partir de R$ 30; com 4 selos, escolha um prêmio (Batata média grátis, Frete grátis). Os selos valem 12 meses e não precisam ser seguidos.');
    expect(r[2]).toBe('Meta do mês: 3 pedidos no mês a partir de R$ 30 dão direito a escolher um prêmio (Frete grátis); vale 15 dias.');
    expect(r).toHaveLength(6);
  });
  it('o gatilho "Pedido entregue" ligado entra com o prêmio pelo nome; desligado, não', () => {
    const c = { ...CONFIG_PADRAO, surpresaAtivo: true };
    const ligado = { entregue: { ativo: true, premioId: B, desde: '2026-11-20T12:00:00.000Z' } };
    expect(regrasDoClube(c, nome, ligado).slice(0, 2)).toEqual([
      'Prêmio surpresa: todo pedido entregue pelo cardápio online ou pelo WhatsApp a partir de R$ 30 dá uma raspadinha com o prêmio "Frete grátis".',
      'O prêmio já vem definido pela regra quando o cliente ganha: a raspadinha só mostra.',
    ]);
    expect(regrasDoClube(c, nome, { entregue: { ...ligado.entregue, ativo: false } })[0]).toContain('só mostra');
    // A surpresa desligada não fala do gatilho, mesmo ligado.
    expect(regrasDoClube(CONFIG_PADRAO, nome, ligado)[0]).toContain('Não há sorteio');
  });
});

describe('os gatilhos do prêmio surpresa (mig 474)', () => {
  it('a linha do banco vira o gatilho com os padrões no que falta', () => {
    expect(gatilhosDaLinha(null)).toEqual({ entregue: { ativo: false, premioId: null, desde: null } });
    expect(gatilhosDaLinha({})).toEqual({ entregue: { ativo: false, premioId: null, desde: null } });
    expect(gatilhosDaLinha({ entregue: { ativo: true, premioId: A, desde: '2026-11-20T12:00:00.000Z' } })).toEqual({
      entregue: { ativo: true, premioId: A, desde: '2026-11-20T12:00:00.000Z' },
    });
  });
  it('o que a tela manda: liga/desliga só com booleano (V15), ausente mantém (V16), o prêmio é um id', () => {
    expect(lerGatilhoEntregue({})).toEqual({});
    expect(lerGatilhoEntregue({ ativo: true, premioId: A })).toEqual({ ativo: true, premioId: A });
    expect(lerGatilhoEntregue({ premioId: null })).toEqual({ premioId: null });
    expect(() => lerGatilhoEntregue({ ativo: 'sim' })).toThrow();
    expect(() => lerGatilhoEntregue({ premioId: 'x' })).toThrow();
  });
  it('onde o prêmio está em uso conta o gatilho ligado', () => {
    const g = { entregue: { ativo: true, premioId: A, desde: null } };
    expect(ondeEstaEmUso(CONFIG_PADRAO, A, g)).toEqual(['Prêmio surpresa · pedido entregue']);
    expect(ondeEstaEmUso(CONFIG_PADRAO, B, g)).toEqual([]);
  });
});

describe('as fatias da roleta', () => {
  it('os nomes da lista, sem repetir, até 8, sempre com o do cliente', () => {
    expect(fatiasDaRoleta(['A', 'B', 'A', ' ', 'C'], 'B')).toEqual(['A', 'B', 'C']);
    expect(fatiasDaRoleta(['A', 'B'], 'Z')).toEqual(['A', 'B', 'Z']);
    const nove = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    expect(fatiasDaRoleta(nove, '9')).toEqual(['1', '2', '3', '4', '5', '6', '7', '9']);
    expect(fatiasDaRoleta(nove, '3')).toHaveLength(8);
    // Um prêmio só: duas metades iguais (a roleta com uma fatia não gira de verdade).
    expect(fatiasDaRoleta([], 'Frete grátis')).toEqual(['Frete grátis', 'Frete grátis']);
  });
  it('o código do link do direito: 22 letras de base64url, sem repetir', () => {
    const a = codigoDoDireito();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(codigoDoDireito()).not.toBe(a);
  });
});
