import { gerarPdfDoResumo } from '../relatorio-resumo-pdf';
import { planoCanais, planoMaisVendidos, planoVendasPorDia, planoVendasPorHora } from './plano-do-grafico';
import { ATENCAO_MAX, DadosDoResumo, contraDoResumo, ehPlanoDoResumo, montarPlanoDoResumo, nomeDoPdfDoResumo, resumoTemConteudo, tituloDoResumo } from './plano-do-resumo';

// O PLANO DO RESUMO EM ARQUIVO E NO LINK (versão 5, M5e): os números grandes, as abas, a atenção e a conferência do plano
// guardado (o link público só abre o que a página sabe desenhar); e o PDF que sai dele.

const LIDO = '19/11 às 09:00';
const dias = ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'];
const anteriores = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'];

const dadosDoDia = (verValores = true): DadosDoResumo => ({
  tipo: 'resumo_dia',
  empresa: 'Hamburgueria do Centro',
  loja: 'Loja Centro',
  referencia: '2026-11-18',
  ate: '2026-11-18',
  lidoEm: LIDO,
  verValores,
  atual: { vendas: 86, faturado: verValores ? 4130 : null, ticket: verValores ? 48.02 : null },
  anterior: { vendas: 60, faturado: verValores ? 2700 : null },
  contra: 'a quarta passada',
  pico: { hora: '21h', total: verValores ? 1040 : null, vendas: 22 },
  cancelamentos: { quantos: 2, valor: verValores ? 96 : null, linhas: [{ oque: 'Cancelamento', detalhe: '#284 · iFood · cliente desistiu', valor: verValores ? 'R$ 58,00' : '—' }] },
  estoque: [{ oque: 'Estoque (agora)', detalhe: 'Batata rústica: 2 cx (mínimo 4)', valor: '—' }],
  graficos: {
    hora: planoVendasPorHora({
      loja: 'Loja Centro',
      rotuloDoPeriodo: '18/11',
      porHora: [
        { hora: '19h', total: verValores ? 800 : null, vendas: 15 },
        { hora: '20h', total: verValores ? 900 : null, vendas: 18 },
        { hora: '21h', total: verValores ? 1040 : null, vendas: 22 },
      ],
      verValores,
      lidoEm: LIDO,
    }),
    dias: planoVendasPorDia({
      loja: 'Loja Centro',
      rotuloDoPeriodo: '12/11 a 18/11',
      dias,
      porDia: dias.map((d, i) => ({ dia: d, total: verValores ? 3000 + i * 100 : null, vendas: 60 + i })),
      anteriores: anteriores.map((d) => ({ dia: d, total: verValores ? 2800 : null, vendas: 58 })),
      diasAnteriores: anteriores,
      verValores,
      lidoEm: LIDO,
      contra: 'a semana anterior',
    }),
    ...(verValores
      ? {
          canais: planoCanais({
            loja: 'Loja Centro',
            rotuloDoPeriodo: '18/11',
            porPlataforma: [
              { plataforma: 'ifood', total: 1700, pedidos: 35 },
              { plataforma: 'cardapio', total: 900, pedidos: 19 },
            ],
            lidoEm: LIDO,
          }),
        }
      : {}),
    produtos: planoMaisVendidos({
      loja: 'Loja Centro',
      rotuloDoPeriodo: '18/11',
      itens: [
        { nome: 'X-Burger', quantidade: 40, total: verValores ? 1200 : null },
        { nome: 'Batata', quantidade: 30, total: verValores ? 450 : null },
      ],
      verValores,
      lidoEm: LIDO,
    }),
  },
});

describe('o plano do resumo (M5e)', () => {
  it('o título, o "contra" (o sábado e o domingo no masculino) e o nome do arquivo sem acento', () => {
    expect(tituloDoResumo('resumo_dia', '2026-11-18', '2026-11-18')).toBe('Resumo de quarta, 18/11/2026');
    expect(tituloDoResumo('resumo_semana', '2026-11-12', '2026-11-18')).toBe('Resumo da semana, 12/11 a 18/11/2026');
    expect(contraDoResumo('resumo_dia', '2026-11-18')).toBe('a quarta passada');
    expect(contraDoResumo('resumo_dia', '2026-11-14')).toBe('o sábado passado');
    expect(contraDoResumo('resumo_dia', '2026-11-15')).toBe('o domingo passado');
    expect(contraDoResumo('resumo_semana', '2026-11-12')).toBe('a semana anterior');
    expect(nomeDoPdfDoResumo('resumo_dia', '2026-11-18', '2026-11-18')).toBe('resumo-2026-11-18.pdf');
    expect(nomeDoPdfDoResumo('resumo_semana', '2026-11-12', '2026-11-18')).toBe('resumo-semana-2026-11-12-a-2026-11-18.pdf');
  });

  it('o resumo do dia com valores: os números com a comparação, as abas na ordem do protótipo, a atenção e a fonte', () => {
    const p = montarPlanoDoResumo(dadosDoDia());
    expect(p.titulo).toBe('Resumo de quarta, 18/11/2026');
    expect(p.numeros.map((n) => [n.valor, n.rotulo, n.nota, n.tom])).toEqual([
      ['R$ 4.130', 'faturamento', '53% a mais que a quarta passada', 'bom'],
      ['86', 'vendas', null, null],
      ['R$ 48,02', 'ticket médio', null, null],
      ['21h', 'pico', 'R$ 1.040', null],
      ['2', 'cancelamentos', 'R$ 96,00', null],
    ]);
    expect(p.abas.map((a) => [a.id, a.nome])).toEqual([
      ['hora', 'Por hora'],
      ['canais', 'Canais'],
      ['dias', '7 dias'],
      ['produtos', 'Produtos'],
    ]);
    expect(p.atencao.map((a) => a.oque)).toEqual(['Cancelamento', 'Estoque (agora)']);
    expect(p.fonte).toBe('Dados do Regem lidos em 19/11 às 09:00 · vendas concluídas · a gorjeta não entra no faturamento.');
    expect(p.semValores).toBe(false);
    expect(ehPlanoDoResumo(p)).toBe(true);
    expect(resumoTemConteudo(p)).toBe(true);
  });

  it('sem valores (o perfil não mostra): nenhum "R$" no plano inteiro, sem a aba dos canais, e a comparação pelas vendas', () => {
    const p = montarPlanoDoResumo(dadosDoDia(false));
    expect(JSON.stringify(p)).not.toContain('R$');
    expect(p.abas.map((a) => a.id)).toEqual(['hora', 'dias', 'produtos']);
    expect(p.numeros[0]).toEqual({ valor: '86', rotulo: 'vendas', nota: '43% a mais que a quarta passada', tom: 'bom' });
    expect(p.numeros.find((n) => n.rotulo === 'pico')?.nota).toBe('22 vendas');
    expect(p.semValores).toBe(true);
    expect(p.fonte).toContain('sem valores em reais');
    expect(ehPlanoDoResumo(p)).toBe(true);
  });

  it('a semana: o "Por dia" primeiro, sem o pico; um dia sem nada não tem conteúdo (não vira PDF nem link)', () => {
    const semana = montarPlanoDoResumo({ ...dadosDoDia(), tipo: 'resumo_semana', referencia: '2026-11-12', ate: '2026-11-18', contra: 'a semana anterior', pico: null });
    expect(semana.titulo).toBe('Resumo da semana, 12/11 a 18/11/2026');
    expect(semana.abas.map((a) => a.id)).toEqual(['dias', 'canais', 'produtos', 'hora']);
    expect(semana.abas[0].nome).toBe('Por dia');
    expect(semana.numeros.some((n) => n.rotulo === 'pico')).toBe(false);
    const vazio = montarPlanoDoResumo({
      ...dadosDoDia(),
      atual: { vendas: 0, faturado: 0, ticket: null },
      pico: null,
      cancelamentos: { quantos: 0, valor: 0, linhas: [] },
      estoque: [],
      graficos: {},
    });
    expect(vazio.abas).toEqual([]);
    expect(resumoTemConteudo(vazio)).toBe(false);
  });

  it('a atenção para no teto', () => {
    const muitas = Array.from({ length: 20 }, (_, i) => ({ oque: 'Cancelamento', detalhe: `#${i}`, valor: '—' }));
    const p = montarPlanoDoResumo({ ...dadosDoDia(), cancelamentos: { quantos: 20, valor: 0, linhas: muitas } });
    expect(p.atencao).toHaveLength(ATENCAO_MAX);
  });

  it('a conferência do plano guardado recusa o que a página não sabe desenhar', () => {
    const p = montarPlanoDoResumo(dadosDoDia());
    const copia = () => JSON.parse(JSON.stringify(p));
    expect(ehPlanoDoResumo(null)).toBe(false);
    expect(ehPlanoDoResumo([])).toBe(false);
    expect(ehPlanoDoResumo({ ...copia(), versao: 2 })).toBe(false);
    expect(ehPlanoDoResumo({ ...copia(), tipo: 'insumo' })).toBe(false);
    expect(ehPlanoDoResumo({ ...copia(), titulo: 'x'.repeat(301) })).toBe(false);
    const forma = copia();
    forma.abas[0].grafico.forma = 'pizza';
    expect(ehPlanoDoResumo(forma)).toBe(false);
    const barra = copia();
    barra.abas[0].grafico.barras[0].valor = 'muito';
    expect(ehPlanoDoResumo(barra)).toBe(false);
    const abas = copia();
    abas.abas = [...abas.abas, ...abas.abas];
    expect(ehPlanoDoResumo(abas)).toBe(false);
    // O plano do relatório por insumo (outra forma) não passa por resumo.
    expect(ehPlanoDoResumo({ cabecalho: 'x', gerado: 'x', titulo: 'x', numeros: [], grafico: { titulo: 'x', barras: [], linha: null, nota: null }, deOnde: [], outros: null, fonte: 'x' })).toBe(false);
  });

  it('o PDF do resumo sai do plano (com e sem valores; a atenção longa quebra a página sem erro)', async () => {
    const pdf = await gerarPdfDoResumo(montarPlanoDoResumo(dadosDoDia()), 'resumo-2026-11-18.pdf');
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
    const semValores = await gerarPdfDoResumo(montarPlanoDoResumo(dadosDoDia(false)));
    expect(semValores.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const longas = Array.from({ length: 12 }, (_, i) => ({ oque: 'Cancelamento', detalhe: `#${i} · iFood · ${'motivo comprido '.repeat(6)}`, valor: 'R$ 10,00' }));
    const grande = await gerarPdfDoResumo(montarPlanoDoResumo({ ...dadosDoDia(), cancelamentos: { quantos: 12, valor: 120, linhas: longas } }));
    expect((grande.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
