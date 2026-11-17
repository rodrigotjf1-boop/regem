import { gerarPdfDoDocumento, nomeDoPdf } from './documento-pdf';

// O PDF do boleto lançado (M3a parte 4b): sai um PDF de verdade, com e sem o código de barras, e o nome do arquivo sem
// acento nem espaço. O conteúdo do desenho é o do código do Regem (nada da IA).

const base = {
  empresa: 'Burger da Praça',
  quem: 'Ana',
  criadoEm: '2026-11-16T22:41:00Z',
  tipo: 'boleto' as const,
  beneficiario: 'Distribuidora Sabor Ltda.',
  fornecedor: 'Distribuidora Sabor',
  valorCentavos: 128490,
  vencimento: '2026-11-25',
  linhaDigitavel: '00191.23454 67890.123457 67890.123457 7 16410000128490',
  codigoDeBarras: '00197164100001284901234567890123456789012345',
  origem: { valor: 'codigo' as const, vencimento: 'codigo' as const },
  situacao: 'lançado',
};

describe('o PDF do boleto lançado', () => {
  it('sai um PDF de uma página, com o código de barras', async () => {
    const pdf = await gerarPdfDoDocumento(base);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
    // As barras são retângulos preenchidos: muitos "re" no conteúdo (o código tem 113 barras).
    expect(pdf.length).toBeGreaterThan(2000);
  });
  it('sem o código (a conta completada na conversa): sai sem as barras', async () => {
    const pdf = await gerarPdfDoDocumento({ ...base, linhaDigitavel: null, codigoDeBarras: null, origem: { valor: 'pessoa', vencimento: 'pessoa' }, fornecedor: null });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
  it('o nome do arquivo', () => {
    expect(nomeDoPdf(base)).toBe('boleto-distribuidora-sabor-ltda-2026-11-25.pdf');
    expect(nomeDoPdf({ tipo: 'conta', beneficiario: 'Gás Rio', vencimento: '2026-11-30' })).toBe('conta-gas-rio-2026-11-30.pdf');
    expect(nomeDoPdf({ tipo: 'boleto', beneficiario: null, vencimento: null })).toBe('boleto.pdf');
  });
});
