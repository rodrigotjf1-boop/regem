import { montarNfceXml, NfceItem } from './nfce-xml.builder';

// A NFC-e é o único lugar do Regem onde um centavo errado vira REJEIÇÃO da SEFAZ.
// Estes testes travam as regras de somatório do layout 4.00:
//   W12-10  vProd  = Σ det/prod/vProd
//   W14-10  vFrete = Σ det/prod/vFrete
//   W16-10  vDesc  = Σ det/prod/vDesc
//   W16a    vNF    = vProd − vDesc + vFrete (+ demais, zerados neste layout)
//   YA09    Σ detPag/vPag = vNF

const config = {
  crt: 1, serie: 1, ambiente: '2', cnpj: '11222333000181',
  razaoSocial: 'LOJA TESTE', uf: 'SP', codigoUf: 35, codigoMunicipio: 3550308,
  // Endereço completo do emitente (mig 278): o grupo enderEmit exige bairro e número, e
  // o município é campo próprio — antes o XML levava a UF no lugar dele.
  municipio: 'Sao Paulo', bairro: 'Centro', numero: '100', endereco: 'Rua A', cep: '01001000',
};

const item = (o: Partial<NfceItem> = {}): NfceItem => ({
  codigo: 'X', descricao: 'Produto', ncm: '21069090',
  quantidade: 1, precoUnitario: 10, ...o,
});

function montar(itens: NfceItem[], desconto?: number, frete?: number) {
  return montarNfceXml({
    config, serie: 1, numero: 1, chave: '3'.repeat(44), cNF: '12345678',
    dhEmi: '2026-09-14T12:00:00-03:00', itens, forma: 'dinheiro',
    qrCode: 'http://q', urlChave: 'www.sefaz.uf.gov.br/nfce/consulta', desconto, frete,
  });
}

// Lê todas as ocorrências de uma tag e soma. `escopo` permite separar os <det> do <total>.
const todos = (xml: string, tag: string): number[] =>
  [...xml.matchAll(new RegExp(`<${tag}>([\\d.]+)</${tag}>`, 'g'))].map((m) => Number(m[1]));
const soma = (a: number[]) => Number(a.reduce((x, y) => x + y, 0).toFixed(2));
// O último valor de cada tag de somatório está no grupo <total><ICMSTot>.
const doTotal = (xml: string, tag: string) => {
  const t = xml.slice(xml.indexOf('<ICMSTot>'));
  return Number(t.match(new RegExp(`<${tag}>([\\d.]+)</${tag}>`))![1]);
};
const dosItens = (xml: string, tag: string) =>
  todos(xml.slice(0, xml.indexOf('<total>')), tag);

describe('NFC-e — desconto e frete', () => {
  it('sem desconto nem frete: comportamento antigo preservado', () => {
    const xml = montar([item({ precoUnitario: 25 })]);
    expect(doTotal(xml, 'vProd')).toBe(25);
    expect(doTotal(xml, 'vDesc')).toBe(0);
    expect(doTotal(xml, 'vFrete')).toBe(0);
    expect(doTotal(xml, 'vNF')).toBe(25);
    expect(xml).toContain('<modFrete>9</modFrete>'); // sem ocorrência de transporte
    expect(dosItens(xml, 'vDesc')).toEqual([]); // não polui o XML com zeros
  });

  it('declara frete no item e no total, e muda o modFrete', () => {
    const xml = montar([item({ precoUnitario: 30 })], 0, 7.5);
    expect(dosItens(xml, 'vFrete')).toEqual([7.5]);
    expect(doTotal(xml, 'vFrete')).toBe(7.5);
    expect(doTotal(xml, 'vNF')).toBe(37.5);
    expect(xml).toContain('<modFrete>0</modFrete>'); // por conta do remetente
  });

  it('declara desconto no item e no total', () => {
    const xml = montar([item({ precoUnitario: 30 })], 5);
    expect(dosItens(xml, 'vDesc')).toEqual([5]);
    expect(doTotal(xml, 'vDesc')).toBe(5);
    expect(doTotal(xml, 'vNF')).toBe(25);
  });

  it('W16-10: o vDesc do total é EXATAMENTE a soma dos itens, mesmo com dízima', () => {
    // 10,00 de desconto em 3 itens iguais → 3,34 / 3,33 / 3,33 (nunca 3×3,33 = 9,99).
    const xml = montar([item(), item(), item()], 10);
    const porItem = dosItens(xml, 'vDesc');
    expect(porItem).toEqual([3.34, 3.33, 3.33]);
    expect(soma(porItem)).toBe(doTotal(xml, 'vDesc'));
  });

  it('W14-10: o vFrete do total é EXATAMENTE a soma dos itens', () => {
    const xml = montar([item({ precoUnitario: 7.77 }), item({ precoUnitario: 3.33 })], 0, 9.99);
    expect(soma(dosItens(xml, 'vFrete'))).toBe(doTotal(xml, 'vFrete'));
  });

  it('rateia proporcional ao valor da linha, não por quantidade de linhas', () => {
    // 30,00 de produto (10 + 20) com 3,00 de desconto → 1,00 e 2,00.
    const xml = montar([item({ precoUnitario: 10 }), item({ precoUnitario: 20 })], 3);
    expect(dosItens(xml, 'vDesc')).toEqual([1, 2]);
  });

  it('YA09: o pagamento fecha com o vNF (e não com o valor dos produtos)', () => {
    const xml = montar([item({ precoUnitario: 40 })], 6, 9);
    expect(doTotal(xml, 'vNF')).toBe(43);
    expect(Number(xml.match(/<vPag>([\d.]+)<\/vPag>/)![1])).toBe(43);
  });

  it('desconto maior que os produtos é limitado — vNF nunca fica negativo', () => {
    const xml = montar([item({ precoUnitario: 10 })], 999);
    expect(doTotal(xml, 'vDesc')).toBe(10);
    expect(doTotal(xml, 'vNF')).toBe(0);
  });

  it('valores negativos ou inválidos não viram crédito na nota', () => {
    const xml = montar([item({ precoUnitario: 10 })], -5, -3);
    expect(doTotal(xml, 'vDesc')).toBe(0);
    expect(doTotal(xml, 'vFrete')).toBe(0);
    expect(doTotal(xml, 'vNF')).toBe(10);
  });

  it('a ordem das tags segue o layout 4.00 (vUnTrib → vFrete → vDesc → indTot)', () => {
    const xml = montar([item({ precoUnitario: 10 })], 2, 3);
    expect(xml).toMatch(/<vUnTrib>[\d.]+<\/vUnTrib><vFrete>[\d.]+<\/vFrete><vDesc>[\d.]+<\/vDesc><indTot>1<\/indTot>/);
  });

  it('a soma dos itens fecha com o total em 200 combinações de desconto', () => {
    const itens = [
      item({ precoUnitario: 19.9, quantidade: 3 }),
      item({ precoUnitario: 4.5 }),
      item({ precoUnitario: 0.99, quantidade: 7 }),
    ];
    const vProd = 19.9 * 3 + 4.5 + 0.99 * 7;
    for (let cent = 0; cent < 200; cent++) {
      const xml = montar(itens, cent / 100, (cent * 3) / 100);
      expect(soma(dosItens(xml, 'vDesc'))).toBe(doTotal(xml, 'vDesc'));
      expect(soma(dosItens(xml, 'vFrete'))).toBe(doTotal(xml, 'vFrete'));
      expect(doTotal(xml, 'vNF')).toBeCloseTo(
        Number((vProd - cent / 100 + (cent * 3) / 100).toFixed(2)), 2,
      );
    }
  });

  it('PIS/COFINS tributados usam a base LÍQUIDA (desconto reduz, frete compõe)', () => {
    const xml = montar(
      [item({ precoUnitario: 100, cstPis: '01', aliqPis: 10, cstCofins: '01', aliqCofins: 10 })],
      20, 10,
    );
    // base = 100 − 20 + 10 = 90 → PIS 10% = 9,00
    expect(xml).toContain('<PISAliq><CST>01</CST><vBC>90.00</vBC>');
    expect(xml).toContain('<vPIS>9.00</vPIS>');
  });
});

// ENDEREÇO DO EMITENTE (mig 278).
// O XML levava a UF dentro de <xMun> (o campo do MUNICÍPIO), não emitia <xBairro> — que é
// obrigatório no leiaute 4.00 — e escrevia <nro>SN</nro> fixo. Emitente errado no cupom é
// rejeição na SEFAZ, e nada disso aparecia em teste.
describe('NFC-e — grupo enderEmit', () => {
  it('município, bairro e número saem nos campos certos', () => {
    const xml = montar([item()]);
    expect(xml).toContain('<xMun>Sao Paulo</xMun>');
    expect(xml).toContain('<UF>SP</UF>');
    expect(xml).toContain('<xBairro>Centro</xBairro>');
    expect(xml).toContain('<nro>100</nro>');
    expect(xml).toContain('<CEP>01001000</CEP>');
    // A UF não pode mais aparecer como se fosse o município.
    expect(xml).not.toContain('<xMun>SP</xMun>');
  });

  it('a série do XML é a de quem reservou o número, não a da config', () => {
    const xml = montarNfceXml({
      config, serie: 7, numero: 3, chave: '3'.repeat(44), cNF: '12345678',
      dhEmi: '2026-09-14T12:00:00-03:00', itens: [item()], forma: 'dinheiro', qrCode: 'http://q', urlChave: 'www.sefaz.uf.gov.br/nfce/consulta',
    });
    expect(xml).toContain('<serie>7</serie>'); // config.serie é 1
  });
});

// GRUPO <infNFeSupl> (etapa B do P2).
// O builder recebia o QR Code e NÃO o escrevia no XML — a NFC-e sairia sem QR, que é rejeição.
// E a URL de consulta pela chave era a do QR reaproveitada.
describe('NFC-e — grupo infNFeSupl', () => {
  const qr = 'https://sefaz.uf.gov.br/qrcode?p=3326|2|2|1|ABC&x=1';

  it('leva o QR Code (em CDATA, com & e |) e a URL de consulta pela chave', () => {
    const xml = montarNfceXml({
      config, serie: 1, numero: 1, chave: '3'.repeat(44), cNF: '12345678',
      dhEmi: '2026-09-14T12:00:00-03:00', itens: [item()], forma: 'dinheiro',
      qrCode: qr, urlChave: 'www.fazenda.rj.gov.br/nfce/consulta',
    });
    expect(xml).toContain(`<qrCode><![CDATA[${qr}]]></qrCode>`);
    expect(xml).toContain('<urlChave>www.fazenda.rj.gov.br/nfce/consulta</urlChave>');
  });

  it('fica FORA do infNFe e depois dele (não entra na assinatura)', () => {
    const xml = montar([item()]);
    const fimInf = xml.indexOf('</infNFe>');
    const supl = xml.indexOf('<infNFeSupl>');
    expect(fimInf).toBeGreaterThan(0);
    expect(supl).toBeGreaterThan(fimInf);
    expect(xml.slice(0, fimInf)).not.toContain('infNFeSupl');
  });

  it('o XML inteiro sai numa linha só (quebra de linha entre tags é rejeição)', () => {
    expect(montar([item()])).not.toMatch(/[\r\n\t]/);
  });
});
