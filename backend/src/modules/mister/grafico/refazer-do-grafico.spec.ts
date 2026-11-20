import { planoMaisVendidos, planoVendasPorHora, type PlanoDoGrafico } from './plano-do-grafico';
import { MAX_ITENS_NO_REFEITO, formasAceitas, refazerPlano } from './refazer-do-grafico';

// O "REFAZER" DO GRÁFICO (versão 6, M6i): a apresentação muda, os números não. A forma que os dados aceitam, o título sem
// número de fora, o destaque que existe, a ordem pelo maior (até 7) e os valores escondidos.

const porHora = (): PlanoDoGrafico =>
  planoVendasPorHora({
    loja: 'Loja Centro',
    rotuloDoPeriodo: 'hoje',
    porHora: [18, 19, 20, 21, 22, 23, 0, 1, 2].map((h, i) => ({ hora: `${String(h).padStart(2, '0')}h`, total: [100, 300, 800, 1200, 900, 400, 200, 100, 50][i], vendas: i + 1 })),
    verValores: true,
    lidoEm: '20:41',
  });
const ranking = (): PlanoDoGrafico =>
  planoMaisVendidos({
    loja: 'Loja Centro',
    rotuloDoPeriodo: 'últimos 7 dias',
    itens: [
      { nome: 'X-Burguer Clássico', quantidade: 90, total: 2700 },
      { nome: 'Batata', quantidade: 70, total: 1400 },
      { nome: 'Refrigerante', quantidade: 50, total: 400 },
    ],
    verValores: true,
    lidoEm: '20:41',
  });

describe('o refazer do gráfico', () => {
  it('a série aceita linha, colunas, barras deitadas e tabela; o ranking, não a linha', () => {
    expect(formasAceitas(porHora())).toEqual(['colunas', 'linha', 'horizontais', 'tabela']);
    expect(formasAceitas(ranking())).toEqual(['horizontais', 'tabela', 'colunas']);
    expect(refazerPlano(ranking(), { forma: 'linha' })).toEqual({ erro: 'Este gráfico pode ser refeito como: horizontais, tabela, colunas.' });
  });

  it('em linha e em tabela, com os MESMOS números (nenhum valor muda; a série vira os itens da tabela)', () => {
    const p = porHora();
    const linha = refazerPlano(p, { forma: 'linha' });
    if ('erro' in linha) throw new Error(linha.erro);
    expect(linha.plano.forma).toBe('linha');
    expect(linha.plano.barras!.map((b) => b.valor)).toEqual(p.barras!.map((b) => b.valor));
    const tabela = refazerPlano(p, { forma: 'tabela' });
    if ('erro' in tabela) throw new Error(tabela.erro);
    expect(tabela.plano.barras).toBeUndefined();
    expect(tabela.plano.partes!.map((x) => [x.nome, x.valor, x.texto])).toEqual(p.barras!.map((b) => [b.rotulo, b.valor, b.texto]));
  });

  it('só os principais: do maior para o menor, até 7; o destaque é a posição na ordem nova', () => {
    const r = refazerPlano(porHora(), { forma: 'horizontais', ordem: 'maior', destaque: 1 });
    if ('erro' in r) throw new Error(r.erro);
    expect(r.plano.partes).toHaveLength(MAX_ITENS_NO_REFEITO);
    expect(r.plano.partes!.map((x) => x.valor)).toEqual([1200, 900, 800, 400, 300, 200, 100]);
    expect(r.plano.destaque).toBe(1);
    expect(refazerPlano(porHora(), { destaque: 99 })).toEqual({ erro: 'O destaque é a posição de 1 a 9.' });
    expect(refazerPlano(porHora(), { ordem: 'alfabetica' })).toEqual({ erro: 'A ordem é "maior" (do maior para o menor) ou "original".' });
  });

  it('o título novo: a mensagem principal; número que o gráfico não mostra é recusado', () => {
    const p = porHora();
    const ok = refazerPlano(p, { titulo: 'O pico é às 21h' });
    if ('erro' in ok) throw new Error(ok.erro);
    expect(ok.plano.titulo).toBe('O pico é às 21h');
    expect(refazerPlano(p, { titulo: 'Vendemos 5.000 hoje' })).toEqual({ erro: 'O título não pode trazer número que o gráfico não mostra (5.000).' });
    expect(refazerPlano(p, { titulo: 'oi' })).toEqual({ erro: 'O título tem de ter de 3 a 70 letras.' });
  });

  it('sem os valores escritos; nada pedido, nada muda nos números', () => {
    const p = porHora();
    const r = refazerPlano(p, { mostrarValores: false });
    if ('erro' in r) throw new Error(r.erro);
    expect(r.plano.semValores).toBe(true);
    expect(r.plano.kpi).toBe(p.kpi);
    expect(r.plano.rodape).toBe(p.rodape);
    // o ranking refeito como colunas: o nome comprido encurta no rótulo
    const c = refazerPlano(ranking(), { forma: 'colunas' });
    if ('erro' in c) throw new Error(c.erro);
    expect(c.plano.barras!.map((b) => b.rotulo)).toEqual(['X-Burguer C…', 'Batata', 'Refrigerante']);
  });
});
