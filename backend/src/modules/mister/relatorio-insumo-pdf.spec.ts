import { RelatorioDoInsumo } from './insumo-vendido';
import { comUnidade, gerarPdfDoInsumo, nomeDoPdfDoInsumo, planoDoPdfDoInsumo } from './relatorio-insumo-pdf';

// O PDF do relatório por insumo (M3c parte 2; aba "Arquivos e links" do protótipo v3): o PLANO é o que o PDF mostra — os
// números, as barras com o valor, a linha da média do outro período e de onde saiu —, e o desenho só desenha o plano.

const base: RelatorioDoInsumo = {
  loja: 'Loja Centro',
  periodo: 'hoje (16/11)',
  ateAs: '22:40',
  insumo: { id: 'c56', nome: 'Carne 56 g', unidade: 'unidade' },
  total: 212,
  kg: 11.872,
  cercaDeUnidades: null,
  serie: {
    por: 'hora',
    pontos: [
      { rotulo: '18h', quantidade: 12 },
      { rotulo: '19h', quantidade: 48 },
      { rotulo: '20h', quantidade: 71 },
      { rotulo: '21h', quantidade: 54 },
      { rotulo: '22h', quantidade: 27 },
    ],
  },
  deOndeSaiu: [
    { produto: 'X-Burger', quantidade: 120, porUnidade: 1, vendidos: 120 },
    { produto: 'Combo Duplo', quantidade: 64, porUnidade: 2, vendidos: 32 },
    { produto: 'Kids', quantidade: 28, porUnidade: 1, vendidos: 28 },
  ],
  outros: null,
  semanas: { media: 179.7, diferencaPct: 18, contra: 'segundas anteriores, até a mesma hora' },
  comparado: null,
};
const QUEM = { empresa: 'Burger da Praça', pedidoPor: 'Ana Souza', geradoEm: '2026-11-17T01:43:00Z' };

describe('o plano do PDF do insumo', () => {
  it('a conversa 15: o total, os quilos, a comparação com as semanas, as barras por hora e de onde saiu', () => {
    const p = planoDoPdfDoInsumo(base, QUEM);
    expect(p.cabecalho).toBe('Burger da Praça · Loja Centro');
    expect(p.gerado).toBe('Gerado em 16/11/2026, 22:43 pelo Mister, a pedido de Ana');
    expect(p.titulo).toBe('Carne 56 g · hoje (16/11), até 22:40');
    expect(p.numeros).toEqual([
      { valor: '212 unidades', rotulo: 'Loja Centro' },
      { valor: '11,9 kg', rotulo: 'pela ficha técnica' },
      { valor: '+18%', rotulo: 'contra a média das segundas anteriores, até a mesma hora (179,7)' },
    ]);
    expect(p.grafico.titulo).toBe('Carne 56 g por hora (unidades)');
    expect(p.grafico.barras.map((b) => [b.rotulo, b.texto])).toEqual([
      ['18h', '12'],
      ['19h', '48'],
      ['20h', '71'],
      ['21h', '54'],
      ['22h', '27'],
    ]);
    expect(p.grafico.linha).toBeNull();
    expect(p.grafico.nota).toBe('Hoje vai até 22:40.');
    expect(p.deOnde).toEqual([
      { produto: 'X-Burger', detalhe: '120 vendidos', valor: '120' },
      { produto: 'Combo Duplo', detalhe: '2 por unidade, 32 vendidos', valor: '64' },
      { produto: 'Kids', detalhe: '28 vendidos', valor: '28' },
    ]);
    expect(p.outros).toBeNull();
    expect(p.fonte).toContain('baixadas pela ficha técnica');
  });
  it('a conversa 16: o outro período no título, a diferença e a linha da média por dia', () => {
    const p = planoDoPdfDoInsumo(
      {
        ...base,
        periodo: 'de 01/11 a 16/11',
        ateAs: null,
        insumo: { id: 'c120', nome: 'Carne 120 g', unidade: 'unidade' },
        total: 1486,
        kg: 178.32,
        serie: { por: 'dia', pontos: [{ rotulo: '01/11 dom', dia: '2026-11-01', quantidade: 90 }, { rotulo: '02/11 seg', dia: '2026-11-02', quantidade: 0 }] },
        semanas: null,
        comparado: { periodo: 'de 01/10 a 16/10', total: 1312, dias: 16, diferencaPct: 13 },
        outros: 4,
      },
      QUEM,
    );
    expect(p.titulo).toBe('Carne 120 g · de 01/11 a 16/11 contra 01/10 a 16/10');
    expect(p.numeros.map((n) => n.valor)).toEqual(['1.486 unidades', '178,3 kg', '+13%']);
    expect(p.numeros[2].rotulo).toBe('contra 01/10 a 16/10 (1.312)');
    expect(p.grafico.barras.map((b) => b.rotulo)).toEqual(['01', '02']);
    expect(p.grafico.linha).toEqual({ valor: 82, texto: 'média de 01/10 a 16/10: 82 por dia' });
    expect(p.outros).toBe('Outros (adicionais, outros produtos, a embalagem do delivery): 4');
  });
  it('mais de 62 dias vai por mês; o insumo em kg não repete os quilos', () => {
    const pontos = Array.from({ length: 70 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
      return { rotulo: d, dia: d, quantidade: 1 };
    });
    const p = planoDoPdfDoInsumo({ ...base, insumo: { id: 'b', nome: 'Bacon', unidade: 'kg' }, total: 70, kg: 70, serie: { por: 'dia', pontos }, semanas: null }, QUEM);
    expect(p.grafico.titulo).toBe('Bacon por mês (kg)');
    expect(p.grafico.barras.map((b) => [b.rotulo, b.valor])).toEqual([
      ['09/26', 30],
      ['10/26', 31],
      ['11/26', 9],
    ]);
    expect(p.numeros.map((n) => n.valor)).toEqual(['70 kg']);
  });
  it('a unidade no plural, como a pessoa fala', () => {
    expect(comUnidade(212, 'unidade')).toBe('212 unidades');
    expect(comUnidade(1, 'pacote')).toBe('1 pacote');
    expect(comUnidade(2, 'porção')).toBe('2 porções');
    expect(comUnidade(11.872, 'kg')).toBe('11,872 kg');
  });
});

describe('o PDF do insumo', () => {
  it('sai um PDF de uma página; com nada vendido também', async () => {
    const pdf = await gerarPdfDoInsumo(planoDoPdfDoInsumo(base, QUEM));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
    const vazio = await gerarPdfDoInsumo(planoDoPdfDoInsumo({ ...base, total: 0, kg: 0, serie: { por: 'hora', pontos: [] }, deOndeSaiu: [], semanas: null }, QUEM));
    expect((vazio.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
  });
  it('o nome do arquivo', () => {
    expect(nomeDoPdfDoInsumo(base, '2026-11-16', '2026-11-16')).toBe('carne-56-g-2026-11-16.pdf');
    expect(nomeDoPdfDoInsumo({ insumo: { id: 'x', nome: 'Pão brioche', unidade: 'unidade' } }, '2026-11-01', '2026-11-16')).toBe('pao-brioche-2026-11-01-a-2026-11-16.pdf');
  });
});
