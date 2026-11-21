import {
  CONFIG_PADRAO,
  descricaoDoPremio,
  FERRAMENTAS_PRONTAS,
  GATILHO_CAMPANHA_PADRAO,
  GATILHO_CLASSIFICACAO_PADRAO,
  GATILHO_RECLAMACAO_PADRAO,
  gatilhosDaLinha,
  lerConfigDoClube,
  lerGatilhoClassificacao,
  lerGatilhoEntregue,
  lerGatilhoReclamacao,
  lerPremio,
  ligandoAntesDaHora,
  mensagemDasDesculpas,
  ondeEstaEmUso,
  podeMandarDesculpas,
  premiosCitados,
  regrasDoClube,
  estadoDoAlbum,
  estadoDaMeta,
  mesAnterior,
  mesesQueEscolhem,
  periodoDosResultados,
  mesPorExtenso,
  seloDoMes,
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

  it('nenhuma ferramenta liga antes da sua fase (a tela nem mostra o liga/desliga dela) — surpresa na A1, álbum na A2, meta na A3', () => {
    expect(FERRAMENTAS_PRONTAS).toEqual({ surpresa: true, album: true, meta: true });
    expect(ligandoAntesDaHora({ surpresaAtivo: true, albumAtivo: true, metaAtivo: true })).toEqual([]);
    expect(ligandoAntesDaHora({ metaAtivo: true }, { surpresa: true, album: true, meta: false })).toEqual(['meta']);
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
    const ligado = { entregue: { ativo: true, premioId: B, desde: '2026-11-20T12:00:00.000Z' }, reclamacao: GATILHO_RECLAMACAO_PADRAO, classificacao: GATILHO_CLASSIFICACAO_PADRAO, campanha: GATILHO_CAMPANHA_PADRAO };
    expect(regrasDoClube(c, nome, ligado).slice(0, 2)).toEqual([
      'Prêmio surpresa: todo pedido entregue pelo cardápio online ou pelo WhatsApp a partir de R$ 30 dá uma raspadinha com o prêmio "Frete grátis".',
      'O prêmio já vem definido pela regra quando o cliente ganha: a raspadinha só mostra.',
    ]);
    expect(regrasDoClube(c, nome, { ...ligado, entregue: { ...ligado.entregue, ativo: false } })[0]).toContain('só mostra');
    // A surpresa desligada não fala do gatilho, mesmo ligado.
    expect(regrasDoClube(CONFIG_PADRAO, nome, ligado)[0]).toContain('Não há sorteio');
  });
  it('o prêmio de desculpas ligado entra com o limite; sem prêmio liberado, não', () => {
    const c = { ...CONFIG_PADRAO, surpresaAtivo: true, surpresaForma: 'roleta' as const };
    const entregue = { ativo: false, premioId: null, desde: null };
    const r = regrasDoClube(c, nome, { entregue, reclamacao: { ativo: true, premios: [A], limite: 'tri1', quem: 'gerente' }, classificacao: GATILHO_CLASSIFICACAO_PADRAO, campanha: GATILHO_CAMPANHA_PADRAO });
    expect(r[0]).toBe('Prêmio de desculpas: depois de uma reclamação, a equipe pode mandar uma roleta com um prêmio da lista da loja (no máximo 1 a cada 3 meses por cliente).');
    expect(regrasDoClube(c, nome, { entregue, reclamacao: { ...GATILHO_RECLAMACAO_PADRAO, ativo: true }, classificacao: GATILHO_CLASSIFICACAO_PADRAO, campanha: GATILHO_CAMPANHA_PADRAO })[0]).toContain('só mostra');
  });
});

describe('os gatilhos do prêmio surpresa (mig 474)', () => {
  const PADRAO_R = { ativo: false, premios: [], limite: 'mes1', quem: 'gerencia' };
  const PADRAO_C = { ativo: false, segmentos: [], premioId: null, periodoDias: 60 };
  it('a linha do banco vira o gatilho com os padrões no que falta', () => {
    expect(gatilhosDaLinha(null)).toEqual({ entregue: { ativo: false, premioId: null, desde: null }, reclamacao: PADRAO_R, classificacao: PADRAO_C, campanha: { ativo: false } });
    expect(gatilhosDaLinha({})).toEqual({ entregue: { ativo: false, premioId: null, desde: null }, reclamacao: PADRAO_R, classificacao: PADRAO_C, campanha: { ativo: false } });
    expect(gatilhosDaLinha({ entregue: { ativo: true, premioId: A, desde: '2026-11-20T12:00:00.000Z' } })).toEqual({
      entregue: { ativo: true, premioId: A, desde: '2026-11-20T12:00:00.000Z' },
      reclamacao: PADRAO_R,
      classificacao: PADRAO_C,
      campanha: { ativo: false },
    });
    // A reclamação gravada: os ids da lista (sem repetir, sem lixo), o limite e quem manda só entre as opções.
    expect(gatilhosDaLinha({ reclamacao: { ativo: true, premios: [A, A.toUpperCase(), 'x', B], limite: 'tri1', quem: 'nada' } }).reclamacao).toEqual({
      ativo: true,
      premios: [A, B],
      limite: 'tri1',
      quem: 'gerencia',
    });
  });
  it('o que a tela manda para a reclamação: só as opções; ausente mantém', () => {
    expect(lerGatilhoReclamacao({})).toEqual({});
    expect(lerGatilhoReclamacao({ ativo: true, premios: [A, B, A], limite: 'mes2', quem: 'atendimento' })).toEqual({
      ativo: true,
      premios: [A, B],
      limite: 'mes2',
      quem: 'atendimento',
    });
    expect(() => lerGatilhoReclamacao({ ativo: 1 })).toThrow();
    expect(() => lerGatilhoReclamacao({ premios: ['x'] })).toThrow('escolha os prêmios da lista');
    expect(() => lerGatilhoReclamacao({ premios: Array.from({ length: 7 }, (_, i) => `${i}${A.slice(1)}`) })).toThrow('no máximo 6');
    expect(() => lerGatilhoReclamacao({ limite: 'sempre' })).toThrow('limite');
    expect(() => lerGatilhoReclamacao({ quem: 'todos' })).toThrow('quem pode mandar');
  });
  it('quem pode mandar e a mensagem com o link', () => {
    expect(podeMandarDesculpas('gerencia', 'supervisao')).toBe(true);
    expect(podeMandarDesculpas('gerencia', 'execucao')).toBe(false);
    expect(podeMandarDesculpas('gerente', 'supervisao')).toBe(false);
    expect(podeMandarDesculpas('gerente', 'presidente')).toBe(true);
    expect(podeMandarDesculpas('atendimento', 'execucao')).toBe(true);
    expect(podeMandarDesculpas('atendimento', 'suporte')).toBe(false); // o controller troca "suporte" por gerente antes
    expect(mensagemDasDesculpas('', 'https://app/p/abc')).toBe(
      'Pedimos desculpas pelo transtorno. Para compensar, um prêmio surpresa no seu próximo pedido.\n\n🎁 Toque para revelar o seu prêmio: https://app/p/abc',
    );
    expect(mensagemDasDesculpas('  Desculpe a demora!  ', 'L')).toBe('Desculpe a demora!\n\n🎁 Toque para revelar o seu prêmio: L');
    expect(() => mensagemDasDesculpas('x'.repeat(301), 'L')).toThrow('no máximo 300');
  });
  it('o que a tela manda: liga/desliga só com booleano (V15), ausente mantém (V16), o prêmio é um id', () => {
    expect(lerGatilhoEntregue({})).toEqual({});
    expect(lerGatilhoEntregue({ ativo: true, premioId: A })).toEqual({ ativo: true, premioId: A });
    expect(lerGatilhoEntregue({ premioId: null })).toEqual({ premioId: null });
    expect(() => lerGatilhoEntregue({ ativo: 'sim' })).toThrow();
    expect(() => lerGatilhoEntregue({ premioId: 'x' })).toThrow();
  });
  it('onde o prêmio está em uso conta os três gatilhos', () => {
    const g = { entregue: { ativo: true, premioId: A, desde: null }, reclamacao: { ...GATILHO_RECLAMACAO_PADRAO, premios: [A, B] }, classificacao: { ...GATILHO_CLASSIFICACAO_PADRAO, premioId: B }, campanha: GATILHO_CAMPANHA_PADRAO };
    expect(ondeEstaEmUso(CONFIG_PADRAO, A, g)).toEqual(['Prêmio surpresa · pedido entregue', 'Prêmio surpresa · reclamação']);
    expect(ondeEstaEmUso(CONFIG_PADRAO, B, g)).toEqual(['Prêmio surpresa · reclamação', 'Prêmio surpresa · classificação']);
    expect(ondeEstaEmUso(CONFIG_PADRAO, B, { ...g, reclamacao: GATILHO_RECLAMACAO_PADRAO, classificacao: GATILHO_CLASSIFICACAO_PADRAO, campanha: GATILHO_CAMPANHA_PADRAO })).toEqual([]);
  });
});

describe('o gatilho pela classificação do marketing (A1c)', () => {
  const nome = (id: string) => ({ [A]: 'Batata média grátis', [B]: 'Frete grátis' })[id] ?? null;
  it('a linha do banco: só os segmentos da lista, sem repetir; o período só entre as opções', () => {
    expect(gatilhosDaLinha({ classificacao: { ativo: true, segmentos: ['inativos', 'x', 'inativos', 'atrasado'], premioId: B, periodoDias: 45 } }).classificacao).toEqual({
      ativo: true,
      segmentos: ['inativos', 'atrasado'],
      premioId: B,
      periodoDias: 60,
    });
  });
  it('o que a tela manda: os segmentos e o período só da lista; ausente mantém', () => {
    expect(lerGatilhoClassificacao({})).toEqual({});
    expect(lerGatilhoClassificacao({ ativo: true, segmentos: ['em_risco', 'inativos', 'em_risco'], premioId: B, periodoDias: 90 })).toEqual({
      ativo: true,
      segmentos: ['em_risco', 'inativos'],
      premioId: B,
      periodoDias: 90,
    });
    expect(() => lerGatilhoClassificacao({ ativo: 'sim' })).toThrow();
    expect(() => lerGatilhoClassificacao({ segmentos: ['recentes'] })).toThrow('escolha os segmentos da lista');
    expect(() => lerGatilhoClassificacao({ premioId: 'x' })).toThrow('escolha o prêmio da lista');
    expect(() => lerGatilhoClassificacao({ periodoDias: 45 })).toThrow('de quanto em quanto tempo');
  });
  it('as regras do clube dizem os grupos, o prêmio e o período; desligado ou sem segmento, nada', () => {
    const c = { ...CONFIG_PADRAO, surpresaAtivo: true };
    const g = {
      entregue: { ativo: false, premioId: null, desde: null },
      reclamacao: GATILHO_RECLAMACAO_PADRAO,
      classificacao: { ativo: true, segmentos: ['em_risco', 'inativos'] as Array<'em_risco' | 'inativos'>, premioId: B, periodoDias: 60 },
      campanha: GATILHO_CAMPANHA_PADRAO,
    };
    expect(regrasDoClube(c, nome, g)[0]).toBe(
      'Prêmio pela classificação: todos os clientes dos grupos Em risco, Inativos (pelas compras de cada um) ganham uma raspadinha com o prêmio "Frete grátis", no máximo 1 vez a cada 60 dias.',
    );
    expect(regrasDoClube(c, nome, { ...g, classificacao: { ...g.classificacao, segmentos: [] } })[0]).toContain('só mostra');
    expect(regrasDoClube(c, nome, { ...g, classificacao: { ...g.classificacao, ativo: false } })[0]).toContain('só mostra');
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

describe('o álbum de selos (A2)', () => {
  it('um selo por mês, sem repetir, em ordem, até o total; completo quando junta o total', () => {
    expect(estadoDoAlbum(['2026-11', '2026-09', '2026-11'], 4)).toEqual({
      selos: [seloDoMes('2026-09'), seloDoMes('2026-11')],
      tem: 2,
      total: 4,
      completo: false,
    });
    const cheio = estadoDoAlbum(['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'], 4);
    expect([cheio.tem, cheio.completo, cheio.selos.map((s) => s.rotulo)]).toEqual([4, true, ['Ago', 'Set', 'Out', 'Nov']]);
    expect(estadoDoAlbum([], 3)).toEqual({ selos: [], tem: 0, total: 3, completo: false });
  });
  it('o selo do mês: o rótulo curto, a arte padrão e o mês por extenso', () => {
    expect(seloDoMes('2026-11')).toEqual({ mes: '2026-11', rotulo: 'Nov', arte: '🍔' });
    expect(seloDoMes('2026-10').arte).toBe('🎃');
    expect(mesPorExtenso('2026-03')).toBe('março');
  });
});

describe('a meta do mês (A3)', () => {
  const niveis = [
    { pedidos: 3, premios: [A] },
    { pedidos: 6, premios: [B] },
  ];
  it('cada nível dá um prêmio por mês; o próximo a bater e o que falta', () => {
    expect(estadoDaMeta('2026-11', 2, niveis, [])).toEqual({
      mes: '2026-11',
      mesNome: 'novembro',
      pedidos: 2,
      niveis: [
        { nivel: 1, pedidos: 3, falta: 1, atingido: false, escolhido: false },
        { nivel: 2, pedidos: 6, falta: 4, atingido: false, escolhido: false },
      ],
      proximo: { nivel: 1, pedidos: 3, falta: 1 },
      pendente: false,
    });
    // bateu o 1º: pendente até escolher; o 2º segue como o próximo
    const bateu = estadoDaMeta('2026-11', 4, niveis, []);
    expect(bateu.niveis[0]).toMatchObject({ atingido: true, escolhido: false, falta: 0 });
    expect(bateu.proximo).toEqual({ nivel: 2, pedidos: 6, falta: 2 });
    expect(bateu.pendente).toBe(true);
    expect(estadoDaMeta('2026-11', 4, niveis, [1]).pendente).toBe(false);
    // bater o 2º não tira o do 1º; bateu todos: sem próximo
    const todos = estadoDaMeta('2026-11', 9, niveis, [1]);
    expect(todos.niveis.map((n) => [n.atingido, n.escolhido])).toEqual([[true, true], [true, false]]);
    expect(todos.proximo).toBeNull();
    expect(todos.pendente).toBe(true);
    // "escolhido" só vale para o nível batido (um resto de outro mês não conta)
    expect(estadoDaMeta('2026-11', 0, niveis, [1]).niveis[0].escolhido).toBe(false);
  });
  it('o mês anterior: escolhe até o dia 7; a virada do ano', () => {
    expect(mesAnterior('2026-11')).toBe('2026-10');
    expect(mesAnterior('2027-01')).toBe('2026-12');
    expect(mesesQueEscolhem('2026-12-07')).toEqual(['2026-12', '2026-11']);
    expect(mesesQueEscolhem('2026-12-08')).toEqual(['2026-12']);
    expect(mesesQueEscolhem('2027-01-01')).toEqual(['2027-01', '2026-12']);
  });
});

describe('os resultados do clube (A4)', () => {
  it('o período no relógio da operação: este mês, o mês passado (a virada do ano) e os últimos 90 dias', () => {
    expect(periodoDosResultados('mes', '2026-11-20')).toEqual({ periodo: 'mes', de: '2026-11-01 00:00:00', ate: '2026-11-20 23:59:59', titulo: 'Novembro' });
    expect(periodoDosResultados('mes_passado', '2026-11-20')).toEqual({
      periodo: 'mes_passado',
      de: '2026-10-01 00:00:00',
      ate: '2026-10-31 23:59:59',
      titulo: 'Outubro',
    });
    expect(periodoDosResultados('mes_passado', '2027-01-03')).toMatchObject({ de: '2026-12-01 00:00:00', ate: '2026-12-31 23:59:59', titulo: 'Dezembro' });
    expect(periodoDosResultados('90d', '2026-11-20')).toEqual({ periodo: '90d', de: '2026-08-23 00:00:00', ate: '2026-11-20 23:59:59', titulo: 'Últimos 90 dias' });
    // o que não existe vira "este mês"
    expect(periodoDosResultados('ano', '2026-11-20').periodo).toBe('mes');
    expect(periodoDosResultados(undefined, '2026-11-20').periodo).toBe('mes');
  });
});
