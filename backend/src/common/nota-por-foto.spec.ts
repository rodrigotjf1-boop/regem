import { montarChave } from '../modules/fiscal/chave';
import { conferirNota, lerChaveDaNfe, lerLeituraDaNota, numeroDoTexto, palavrasDaDescricao, sugerirInsumos } from './nota-por-foto';

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
  it('as palavras: minúsculas, sem acento, a medida num token só', () => {
    expect(palavrasDaDescricao('BLEND BOVINO 56 G')).toEqual(['blend', 'bovino', '56g']);
    expect(palavrasDaDescricao('Queijo 1,5 kg')).toEqual(['queijo', '1.5kg']);
    expect(palavrasDaDescricao('Pão de Açúcar 120gr')).toEqual(['pao', 'acucar', '120g']);
  });
  it('a medida separa: a de 56 g vai para a carne de 56 g, nunca para a de 120 g', () => {
    expect(sugerirInsumos('BLEND BOVINO 56G', INSUMOS).map((x) => x.id)).toEqual(['c56']);
    expect(sugerirInsumos('CARNE BOVINA 120G', INSUMOS).map((x) => x.id)).toEqual(['c120']);
  });
  it('o bacon fatiado sugere o bacon em tiras (a pessoa confirma); o que não tem nada em comum, nada', () => {
    expect(sugerirInsumos('BACON FATIADO', INSUMOS).map((x) => x.id)).toEqual(['bac']);
    expect(sugerirInsumos('DETERGENTE NEUTRO', INSUMOS)).toEqual([]);
  });
});
