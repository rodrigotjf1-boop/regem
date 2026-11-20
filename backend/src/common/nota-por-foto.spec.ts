import { montarChave } from '../modules/fiscal/chave';
import {
  FRASES_DA_NOTA,
  ItemNoMister,
  botoesDoComoLancar,
  conferirNota,
  custosQueMudaram,
  destinosDosItens,
  formaDoPagamento,
  lerChaveDaNfe,
  lerComoLancar,
  lerLeituraDaNota,
  numeroDoTexto,
  palavrasDaDescricao,
  sugerirInsumos,
} from './nota-por-foto';

// A NOTA DO FORNECEDOR POR FOTO (M3b, parte 1 — só o que é puro): a chave conferida pelo dígito, a leitura do que a IA
// devolve, a conferência dos totais e a sugestão do insumo de cada item (a medida "56 g" separa a carne de 120 g).

const CNPJ = '12345678000195';
const CHAVE = montarChave({ codigoUf: 33, ano2: '26', mes2: '11', cnpj: CNPJ, modelo: '55', serie: 1, numero: 48213, tpEmis: 1, cNF: '12345678' });

describe('a chave de acesso da NF-e', () => {
  it('confere pelo dígito e separa as partes (com espaços, como impressa no DANFE)', () => {
    const espacada = CHAVE.replace(/(\d{4})/g, '$1 ').trim();
    expect(lerChaveDaNfe(espacada)).toEqual({ ok: true, chave: CHAVE, uf: '33', ano: '26', mes: '11', cnpj: CNPJ, modelo: '55', serie: 1, numero: 48213 });
  });
  it('um dígito trocado, o tamanho errado e a NFC-e (modelo 65) não passam', () => {
    const errada = CHAVE.slice(0, 30) + ((Number(CHAVE[30]) + 1) % 10) + CHAVE.slice(31);
    expect(lerChaveDaNfe(errada)).toEqual({ ok: false, motivo: 'digito' });
    expect(lerChaveDaNfe(CHAVE.slice(1))).toEqual({ ok: false, motivo: 'tamanho' });
    const nfce = montarChave({ codigoUf: 33, ano2: '26', mes2: '11', cnpj: CNPJ, modelo: '65', serie: 1, numero: 10, tpEmis: 1, cNF: '12345678' });
    expect(lerChaveDaNfe(nfce)).toEqual({ ok: false, motivo: 'modelo' });
  });
});

describe('o que a IA devolve da nota', () => {
  const leitura = (o: Record<string, unknown> = {}) =>
    JSON.stringify({
      chave: CHAVE,
      emitenteNome: 'Frigorífico Boa Carne',
      emitenteCnpj: '12.345.678/0001-95',
      numero: '000.048.213',
      valorTotal: '2.640,00',
      duplicatas: [{ vencimento: '2026-12-16', valor: '2.640,00' }],
      itens: [
        { descricao: 'BLEND BOVINO 56G', codigo: '1001', quantidade: '40,000', unidade: 'KG', valorUnitario: '33,00', valorTotal: '1.320,00' },
        { descricao: 'BLEND BOVINO 120G', codigo: '1002', quantidade: '30', unidade: 'KG', valorUnitario: '36,00', valorTotal: '1.080,00' },
        { descricao: 'BACON FATIADO', codigo: '2001', quantidade: '5', unidade: 'KG', valorUnitario: '48,00', valorTotal: '240,00' },
      ],
      legivel: true,
      ...o,
    });
  it('lê o emitente, o número, o total, as duplicatas e os itens', () => {
    const l = lerLeituraDaNota(`aqui: ${leitura()} fim`)!;
    expect(l).toMatchObject({ chave: CHAVE, emitenteNome: 'Frigorífico Boa Carne', emitenteCnpj: CNPJ, numero: '48213', valorTotalCentavos: 264000, legivel: true });
    expect(l.duplicatas).toEqual([{ vencimento: '2026-12-16', valorCentavos: 264000 }]);
    expect(l.itens).toHaveLength(3);
    expect(l.itens[0]).toEqual({ descricao: 'BLEND BOVINO 56G', codigo: '1001', quantidade: 40, unidade: 'KG', valorUnitarioCentavos: 3300, valorTotalCentavos: 132000 });
    expect(conferirNota(l)).toEqual([]);
  });
  it('a chave que não confere cai (fica null); fora do formato, nada', () => {
    expect(lerLeituraDaNota(leitura({ chave: CHAVE.slice(0, 43) + ((Number(CHAVE[43]) + 1) % 10) }))!.chave).toBeNull();
    expect(lerLeituraDaNota('não consegui')).toBeNull();
    expect(lerLeituraDaNota('{quebrado')).toBeNull();
  });
  it('item sem descrição ou sem quantidade fica de fora; a quantidade com casas decimais', () => {
    const l = lerLeituraDaNota(leitura({ itens: [{ descricao: '', quantidade: '1' }, { descricao: 'QUEIJO', quantidade: '0' }, { descricao: 'QUEIJO MUSSARELA', quantidade: '2,500', unidade: 'KG' }] }))!;
    expect(l.itens.map((x) => [x.descricao, x.quantidade])).toEqual([['QUEIJO MUSSARELA', 2.5]]);
    expect(numeroDoTexto('1.284,90')).toBe(1284.9);
    expect(numeroDoTexto('0,250')).toBe(0.25);
  });
});

describe('a conferência da nota', () => {
  const base = lerLeituraDaNota(
    JSON.stringify({
      chave: CHAVE,
      emitenteCnpj: CNPJ,
      valorTotal: '100,00',
      duplicatas: [],
      itens: [{ descricao: 'A', quantidade: '1', valorTotal: '60,00' }, { descricao: 'B', quantidade: '1', valorTotal: '40,00' }],
      legivel: true,
    }),
  )!;
  it('a nota certa não tem problema', () => expect(conferirNota(base)).toEqual([]));
  it('os itens que não somam o total (faltou linha), com a tolerância do frete', () => {
    expect(conferirNota({ ...base, itens: base.itens.slice(0, 1) })).toEqual(['itens_nao_somam']);
    expect(conferirNota({ ...base, valorTotalCentavos: 10050 })).toEqual([]); // R$ 0,50 de diferença (o frete)
  });
  it('a chave de outro CNPJ, as duplicatas que não somam, sem total, ilegível, sem itens', () => {
    expect(conferirNota({ ...base, emitenteCnpj: '98765432000110' })).toEqual(['chave_de_outro_emitente']);
    expect(conferirNota({ ...base, duplicatas: [{ vencimento: '2026-12-01', valorCentavos: 5000 }] })).toEqual(['duplicatas_nao_somam']);
    expect(conferirNota({ ...base, valorTotalCentavos: null })).toEqual(['sem_total']);
    expect(conferirNota({ ...base, legivel: false })).toEqual(['ilegivel']);
    expect(conferirNota({ ...base, itens: [] })).toEqual(['sem_itens']);
  });
});

describe('a sugestão do insumo de cada item', () => {
  const INSUMOS = [
    { id: 'c56', nome: 'Carne 56 g', nomeComercial: 'Blend bovino 56g' },
    { id: 'c120', nome: 'Carne 120 g', nomeComercial: null },
    { id: 'bac', nome: 'Bacon em tiras' },
    { id: 'pao', nome: 'Pão brioche' },
  ];
  it('as palavras: minúsculas, sem acento, a medida num token só, os sinônimos do ramo num nome só', () => {
    expect(palavrasDaDescricao('BLEND BOVINO 56 G')).toEqual(['carne', '56g']);
    expect(palavrasDaDescricao('Queijo 1,5 kg')).toEqual(['queijo', '1.5kg']);
    expect(palavrasDaDescricao('Pão de Açúcar 120gr')).toEqual(['pao', 'acucar', '120g']);
    expect(palavrasDaDescricao('QUEIJO MUÇARELA')).toEqual(['queijo', 'mussarela']);
  });
  it('a medida separa: a de 56 g vai para a carne de 56 g, nunca para a de 120 g (o "blend" da nota é a carne do estoque)', () => {
    expect(sugerirInsumos('BLEND BOVINO 56G', INSUMOS).map((x) => x.id)).toEqual(['c56']);
    expect(sugerirInsumos('CARNE BOVINA 120G', INSUMOS).map((x) => x.id)).toEqual(['c120']);
    // Sem o nome comercial: o "blend" ainda chega à carne de 56 g.
    expect(sugerirInsumos('BLEND 56G', [{ id: 'c56', nome: 'Carne 56 g' }, { id: 'c120', nome: 'Carne 120 g' }]).map((x) => x.id)).toEqual(['c56']);
  });
  it('o bacon fatiado sugere o bacon em tiras (a pessoa confirma); o que não tem nada em comum, nada', () => {
    expect(sugerirInsumos('BACON FATIADO', INSUMOS).map((x) => x.id)).toEqual(['bac']);
    expect(sugerirInsumos('DETERGENTE NEUTRO', INSUMOS)).toEqual([]);
  });
});

describe('cada item e para onde vai (a conversa e a gaveta, M3b.3)', () => {
  const item = (o: Partial<ItemNoMister>): ItemNoMister => ({
    descricao: 'X',
    codigo: null,
    quantidade: 2,
    unidade: 'KG',
    valorUnitarioCentavos: null,
    valorTotalCentavos: null,
    insumoId: 'i',
    insumoNome: 'Queijo',
    unidadeDoEstoque: 'kg',
    fator: 1,
    estado: 'ligado',
    sugestoes: [],
    ...o,
  });
  it('ligado (com e sem conversão), fora do estoque e o que ainda falta', () => {
    expect(
      destinosDosItens({
        itens: [
          item({}),
          item({ insumoNome: 'Bacon', unidadeDoEstoque: 'pacote', fator: 2.5 }),
          item({ estado: 'fora', insumoId: null, insumoNome: null, fator: null }),
          item({ estado: 'item', insumoId: null, insumoNome: null, fator: null }),
          item({ estado: 'fator', fator: null, unidadeDoEstoque: 'pacote' }),
        ],
      }).map((x) => x.destino),
    ).toEqual(['Queijo', 'Bacon (5 pacote)', 'fora do estoque', 'falta dizer o insumo', 'Queijo (falta a conversão de unidade)']);
  });
});

describe('o custo que mudou com a nota (M3b.3)', () => {
  it('a frase da conversa 12, com o artigo de cada unidade', () => {
    expect(custosQueMudaram([{ insumo: 'Carne 56 g', unidade: 'kg', antes: 31.9, depois: 33 }])).toEqual(['O quilo de Carne 56 g passou de R$ 31,90 para R$ 33,00.']);
    expect(custosQueMudaram([{ insumo: 'Pão', unidade: 'caixa', antes: 10, depois: 12 }])).toEqual(['A caixa de Pão passou de R$ 10,00 para R$ 12,00.']);
  });
  it('só o que mudou 1% ou mais, com custo antes; até 3, os que mais mudaram', () => {
    const m = [
      { insumo: 'A', unidade: 'kg', antes: 10, depois: 10.05 }, // 0,5%: fica de fora
      { insumo: 'B', unidade: 'kg', antes: 0, depois: 12 }, // sem custo antes: o primeiro custo não é mudança
      { insumo: 'C', unidade: 'kg', antes: 10, depois: 11 }, // 10%
      { insumo: 'D', unidade: 'kg', antes: 10, depois: 13 }, // 30%
      { insumo: 'E', unidade: 'kg', antes: 10, depois: 8 }, // -20%
      { insumo: 'F', unidade: 'kg', antes: 10, depois: 10.2 }, // 2%
    ];
    expect(custosQueMudaram(m).map((x) => x.split(' ')[3])).toEqual(['D', 'E', 'C']);
  });
});

// Versão 6, M6h: o cupom fiscal de compra (NFC-e, modelo 65) — a chave, a leitura, a conferência com o desconto, os botões
// do "Como deseja lançar?", a forma do pagamento e as frases.
describe('o cupom fiscal de compra (M6h)', () => {
  const NFCE = montarChave({ codigoUf: 33, ano2: '26', mes2: '11', cnpj: CNPJ, modelo: '65', serie: 1, numero: 98765, tpEmis: 1, cNF: '87654321' });
  const DOC = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
  const cupom = (o: Record<string, unknown> = {}) =>
    JSON.stringify({
      especie: 'cupom',
      chave: NFCE,
      emitenteNome: 'Atacadão Centro',
      emitenteCnpj: CNPJ,
      numero: '98765',
      dataEmissao: '2026-11-19',
      valorTotal: '95,00',
      desconto: '5,00',
      formaPagamento: 'debito',
      duplicatas: [{ vencimento: '2026-12-01', valor: '95,00' }],
      itens: [
        { descricao: 'OLEO SOJA 900ML', quantidade: '10', unidade: 'UN', valorUnitario: '7,00', valorTotal: '70,00' },
        { descricao: 'SAL REFINADO 1KG', quantidade: '10', unidade: 'UN', valorUnitario: '3,00', valorTotal: '30,00' },
      ],
      legivel: true,
      ...o,
    });

  it('a chave do modelo 65 entra pela leitura da nota (o padrão segue só NF-e)', () => {
    expect(lerChaveDaNfe(NFCE)).toEqual({ ok: false, motivo: 'modelo' });
    expect(lerChaveDaNfe(NFCE, ['55', '65'])).toMatchObject({ ok: true, modelo: '65', numero: 98765 });
  });

  it('lê o cupom: espécie pela chave, dia, forma e desconto; o cupom não tem parcelas', () => {
    const l = lerLeituraDaNota(cupom())!;
    expect(l).toMatchObject({ especie: 'cupom', chave: NFCE, dataEmissao: '2026-11-19', formaPagamento: 'debito', descontoCentavos: 500, valorTotalCentavos: 9500 });
    expect(l.duplicatas).toEqual([]);
    // os itens (100,00) menos o desconto (5,00) somam o total (95,00)
    expect(conferirNota(l)).toEqual([]);
    expect(conferirNota({ ...l, descontoCentavos: null })).toEqual(['itens_nao_somam']);
  });

  it('a chave decide a espécie: modelo 55 é nota mesmo que a IA diga cupom; sem chave, vale a IA', () => {
    expect(lerLeituraDaNota(cupom({ chave: CHAVE }))!.especie).toBe('nota');
    expect(lerLeituraDaNota(cupom({ chave: null }))!.especie).toBe('cupom');
    expect(lerLeituraDaNota(cupom({ chave: null, especie: 'nota' }))!.especie).toBe('nota');
    // a forma fora da lista e a data torta caem
    expect(lerLeituraDaNota(cupom({ formaPagamento: 'boleto', dataEmissao: '2026-02-31' }))).toMatchObject({ formaPagamento: null, dataEmissao: null });
  });

  it('os botões do "Como deseja lançar?" cabem no limite da Meta e se leem de volta; o id torto não', () => {
    const b = botoesDoComoLancar(DOC);
    expect(b.map((x) => x.titulo)).toEqual(['Só despesa', 'Estoque e despesa', 'Não lançar']);
    for (const x of b) expect(x.titulo.length).toBeLessThanOrEqual(20);
    expect(b.map((x) => lerComoLancar(x.id))).toEqual([
      { documentoId: DOC, escolha: 'd' },
      { documentoId: DOC, escolha: 'e' },
      { documentoId: DOC, escolha: 'n' },
    ]);
    expect(lerComoLancar(`doc:cl:${DOC}:x`)).toBeNull();
    expect(lerComoLancar('doc:cl:nao-e-uuid:d')).toBeNull();
    expect(lerComoLancar(`doc:ni:${DOC}:1:0`)).toBeNull();
  });

  it('a forma do cupom vira a forma do pagamento da conta (débito e crédito = cartão)', () => {
    expect([formaDoPagamento('dinheiro'), formaDoPagamento('pix'), formaDoPagamento('debito'), formaDoPagamento('credito'), formaDoPagamento('outro'), formaDoPagamento(null)]).toEqual([
      'dinheiro',
      'pix',
      'cartao',
      'cartao',
      undefined,
      undefined,
    ]);
  });

  it('as frases: a pergunta com os itens e as opções, o resumo de cada jeito e o lançado (com o caminho do menu)', () => {
    const l = lerLeituraDaNota(cupom())!;
    const nota = {
      chave: l.chave,
      numero: l.numero,
      emitenteNome: l.emitenteNome,
      emitenteCnpj: l.emitenteCnpj,
      valorTotalCentavos: l.valorTotalCentavos!,
      duplicatas: [],
      itens: l.itens.map((it) => ({ ...it, insumoId: null, insumoNome: null, unidadeDoEstoque: null, fator: null, estado: 'item' as const, sugestoes: [] })),
      especie: 'cupom' as const,
      dataEmissao: l.dataEmissao,
      formaPagamento: l.formaPagamento,
      descontoCentavos: l.descontoCentavos,
      comoLancar: null,
    };
    const pergunta = FRASES_DA_NOTA.comoLancar(nota);
    expect(pergunta).toContain('🧾 Cupom · Atacadão Centro · 19/11 · R$ 95,00, pago no débito');
    expect(pergunta).toContain('• OLEO SOJA 900ML, 10 UN · R$ 70,00');
    expect(pergunta).toContain('Desconto: R$ 5,00.');
    expect(pergunta).toContain('Como deseja lançar?');
    expect(FRASES_DA_NOTA.resumoDoCupom({ ...nota, comoLancar: 'despesa' })).toContain('Lanço a despesa de R$ 95,00 como já paga no débito em 19/11? O estoque não muda.');
    expect(FRASES_DA_NOTA.resumoDoCupom({ ...nota, comoLancar: 'estoque' })).toContain('Lanço a entrada no estoque e a despesa de R$ 95,00 como já paga no débito?');
    expect(FRASES_DA_NOTA.cupomLancado({ ...nota, comoLancar: 'despesa' })).toBe('Lancei a despesa de R$ 95,00 já paga, em Financeiro › Contas a pagar. O estoque não mudou.');
  });
});
