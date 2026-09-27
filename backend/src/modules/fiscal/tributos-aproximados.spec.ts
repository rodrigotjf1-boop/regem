import {
  TabelaIbptDaNota,
  calcularTributosAprox,
  fraseTributosAprox,
  origemNacional,
} from './tributos-aproximados';

// Valor aproximado dos tributos (Lei 12.741). Informativo — mas a SEFAZ confere que o total é a
// soma dos itens (rejeição 685), e o IBPT pede para citar fonte e chave no cupom.
const TABELA: TabelaIbptDaNota = {
  fonte: 'IBPT/empresometro.com.br',
  chave: 'C44399',
  versao: '26.2.B',
  aliquotas: {
    '21069090': { nacionalFederal: 13.45, importadosFederal: 36.08, estadual: 20, municipal: 0 },
    '22021000': { nacionalFederal: 17.05, importadosFederal: 20.1, estadual: 18, municipal: 0 },
    '21011200': { nacionalFederal: 9.25, importadosFederal: 12, estadual: 12, municipal: 2.5 },
  },
};

describe('valor aproximado dos tributos (Lei 12.741)', () => {
  it('origem: 0, 3, 4 e 5 são nacionais; as demais usam a alíquota de importados', () => {
    for (const o of ['0', '3', '4', '5', undefined, null, '']) expect(origemNacional(o as any)).toBe(true);
    for (const o of ['1', '2', '6', '7', '8']) expect(origemNacional(o)).toBe(false);
  });

  it('trunca (sugestão do IBPT), por ente, sobre o item menos o desconto', () => {
    const r = calcularTributosAprox([{ ncm: '21069090', origem: '0', base: 10 }], TABELA);
    // 10,00 × 13,45% = 1,345 → 1,34 · 10,00 × 20% = 2,00
    expect(r.resumo).toMatchObject({ federal: 1.34, estadual: 2, municipal: 0, total: 3.34 });
    expect(r.porItem).toEqual([3.34]);
    const imp = calcularTributosAprox([{ ncm: '21069090', origem: '1', base: 10 }], TABELA);
    expect(imp.resumo.federal).toBe(3.6); // 36,08% de 10,00 = 3,608 → 3,60
  });

  it('o total é EXATAMENTE a soma dos itens — senão a SEFAZ rejeita com 685', () => {
    const itens = Array.from({ length: 37 }, (_, i) => ({
      ncm: ['21069090', '22021000', '21011200'][i % 3],
      origem: i % 5 === 0 ? '2' : '0',
      base: Math.round((3.33 + i * 7.77) * 100) / 100,
    }));
    const r = calcularTributosAprox(itens, TABELA);
    const somaCentavos = r.porItem.reduce((s, v) => s + Math.round(v * 100), 0);
    expect(Math.round(r.resumo.total * 100)).toBe(somaCentavos);
    expect(Math.round((r.resumo.federal + r.resumo.estadual + r.resumo.municipal) * 100)).toBe(somaCentavos);
  });

  it('linha sem mercadoria (NCM 00000000, a da taxa de serviço) e NCM fora da tabela: zero', () => {
    const r = calcularTributosAprox(
      [
        { ncm: '00000000', base: 50 },
        { ncm: '99999999', base: 50 },
        { ncm: undefined, base: 50 },
        { ncm: '2106.90.90', origem: '0', base: 100 },
      ],
      TABELA,
    );
    expect(r.porItem).toEqual([0, 0, 0, 33.45]);
    expect(r.resumo.total).toBe(33.45);
  });

  it('o erro do float não tira centavo no truncamento', () => {
    // 20,00 × 4,35% = 0,87 exato — mas 2000 × 4,35 em binário dá 8699,999…, e truncar sem folga
    // daria 0,86.
    const t: TabelaIbptDaNota = { ...TABELA, aliquotas: { '11111111': { nacionalFederal: 4.35, importadosFederal: 4.35, estadual: 0, municipal: 0 } } };
    expect(calcularTributosAprox([{ ncm: '11111111', base: 20 }], t).resumo.federal).toBe(0.87);
    // base que já chega "suja" do float (3 × 1,10 = 3,3000000000000003): 3,30 × 4,35% = 0,1435 → 0,14
    expect(calcularTributosAprox([{ ncm: '11111111', base: 3 * 1.1 }], t).resumo.federal).toBe(0.14);
  });

  it('a frase do cupom cita os entes, a lei, a fonte e a chave — municipal só quando existe', () => {
    const sem = calcularTributosAprox([{ ncm: '21069090', base: 10 }], TABELA).resumo;
    expect(fraseTributosAprox(sem)).toBe(
      'Trib aprox R$ 1,34 Federal e R$ 2,00 Estadual (Lei 12.741/12). Fonte: IBPT/empresometro.com.br C44399',
    );
    const com = calcularTributosAprox([{ ncm: '21011200', base: 100 }], TABELA).resumo;
    expect(fraseTributosAprox(com)).toBe(
      'Trib aprox R$ 9,25 Federal, R$ 12,00 Estadual e R$ 2,50 Municipal (Lei 12.741/12). Fonte: IBPT/empresometro.com.br C44399',
    );
    // Gravado no banco como JSON: a frase sai igual.
    expect(fraseTributosAprox(JSON.stringify(sem))).toBe(fraseTributosAprox(sem));
    expect(fraseTributosAprox(null)).toBeNull();
    expect(fraseTributosAprox({ ...sem, federal: 0, estadual: 0, municipal: 0, total: 0 })).toBeNull();
    expect(fraseTributosAprox('não é json')).toBeNull();
  });
});
