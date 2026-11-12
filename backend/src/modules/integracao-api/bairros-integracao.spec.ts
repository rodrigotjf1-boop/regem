import { JANELA_MAX_DIAS, lerJanelaDeDias, MINIMO_POR_BAIRRO, montarBairros, type GrupoDeBairro } from './bairros-integracao';
import { ProblemaException } from './problema';

// As regras puras dos pedidos por bairro (GET /integracao/pedidos/bairros — Liame, D-RG-8): a janela de dias e a montagem
// da resposta. A soma no banco (a régua das vendas, o fuso, a loja, a 99) está na `integracao-vendas.http.spec.ts`.

function problema(f: () => unknown): { status: number; tipo: string; detalhe: string } | 'passou' {
  try {
    f();
    return 'passou';
  } catch (e: any) {
    if (!(e instanceof ProblemaException)) throw e;
    return { status: e.getStatus(), tipo: e.tipo, detalhe: e.message };
  }
}

describe('pedidos por bairro — a janela de dias', () => {
  it('aceita de e ate em AAAA-MM-DD, inclusive, até 92 dias', () => {
    expect(lerJanelaDeDias('2026-09-01', '2026-09-30')).toEqual({ de: '2026-09-01', ate: '2026-09-30', dias: 30 });
    expect(lerJanelaDeDias('2026-10-07', '2026-10-07')).toEqual({ de: '2026-10-07', ate: '2026-10-07', dias: 1 });
    // 92 dias exatos passam; 93 não
    expect(lerJanelaDeDias('2026-08-01', '2026-10-31').dias).toBe(JANELA_MAX_DIAS);
    const longa = problema(() => lerJanelaDeDias('2026-08-01', '2026-11-01'));
    expect(longa).toMatchObject({ status: 400, tipo: 'parametro-invalido' });
    expect((longa as any).detalhe).toContain('93');
  });

  it('recusa sem os dois dias, fora do formato, dia que não existe e de depois de ate (400)', () => {
    for (const [de, ate] of [
      [undefined, '2026-09-30'],
      ['2026-09-01', ''],
      ['01/09/2026', '2026-09-30'],
      ['2026-9-1', '2026-09-30'],
      ['2026-02-30', '2026-03-01'],
      ['2026-13-01', '2026-13-02'],
      ['2026-09-30', '2026-09-01'],
    ] as const) {
      expect(problema(() => lerJanelaDeDias(de, ate))).toMatchObject({ status: 400, tipo: 'parametro-invalido' });
    }
  });
});

describe('pedidos por bairro — a montagem da resposta', () => {
  const entrega = (bairro: string | null, pedidos: number, centavos: number, cidade: string | null = 'Rio de Janeiro', uf: string | null = 'RJ'): GrupoDeBairro => ({
    grupo: 'entrega',
    bairro,
    cidade,
    uf,
    pedidos,
    receita_centavos: String(centavos),
  });

  it('bairro com 5 pedidos ou mais sai com o nome; com menos vai para "outros", só a conta', () => {
    const r = montarBairros([
      entrega('Penha', 7, 70000),
      entrega('Centro', MINIMO_POR_BAIRRO, 50000),
      entrega('Olaria', 4, 40000),
      entrega('Vila da Penha', 1, 1000),
    ]);
    expect(r.bairros).toEqual([
      { bairro: 'Penha', cidade: 'Rio de Janeiro', uf: 'RJ', pedidos: 7, receita_micros: 700_000_000 },
      { bairro: 'Centro', cidade: 'Rio de Janeiro', uf: 'RJ', pedidos: 5, receita_micros: 500_000_000 },
    ]);
    expect(r.outros).toEqual({ bairros: 2, pedidos: 5, receita_micros: 410_000_000 });
    // "outros" não leva nome nenhum
    expect(JSON.stringify(r.outros)).not.toMatch(/Olaria|Vila/);
  });

  it('distância no lugar do bairro (frete por raio) e bairro vazio vão para sem_bairro', () => {
    const r = montarBairros([entrega('~3.2 km', 6, 6000), entrega(null, 2, 2000), entrega('   ', 1, 1000), entrega('raio 5', 5, 5000)]);
    expect(r.bairros).toEqual([]);
    expect(r.sem_bairro).toEqual({ pedidos: 14, receita_micros: 140_000_000 });
    expect(r.outros).toEqual({ bairros: 0, pedidos: 0, receita_micros: 0 });
  });

  it('maiúscula e minúscula não separam o bairro; cidade diferente separa', () => {
    const r = montarBairros([entrega('Penha', 3, 3000), entrega('PENHA', 2, 2000), entrega('Penha', 5, 5000, 'Niterói')]);
    expect(r.bairros.map((b) => [b.bairro, b.cidade, b.pedidos])).toEqual([
      ['Penha', 'Rio de Janeiro', 5],
      ['Penha', 'Niterói', 5],
    ]);
  });

  it('retirada, balcão e mesa: só a conta; a UF só com 2 letras; mais pedidos primeiro, depois a receita', () => {
    const r = montarBairros([
      { grupo: 'outro', bairro: null, cidade: null, uf: null, pedidos: 12, receita_centavos: '99999' },
      entrega('Ramos', 5, 9000, 'Rio de Janeiro', 'rj'),
      entrega('Bonsucesso', 5, 12000, 'Rio de Janeiro', 'Rio'),
      entrega('Brás de Pina', 6, 1000, null, null),
    ]);
    expect(r.retirada_e_balcao).toEqual({ pedidos: 12 });
    expect(r.bairros.map((b) => [b.bairro, b.cidade, b.uf])).toEqual([
      ['Brás de Pina', null, null],
      ['Bonsucesso', 'Rio de Janeiro', null],
      ['Ramos', 'Rio de Janeiro', 'RJ'],
    ]);
  });

  it('sem nada na janela: tudo zero e listas vazias', () => {
    expect(montarBairros([])).toEqual({
      bairros: [],
      outros: { bairros: 0, pedidos: 0, receita_micros: 0 },
      sem_bairro: { pedidos: 0, receita_micros: 0 },
      retirada_e_balcao: { pedidos: 0 },
    });
  });
});
