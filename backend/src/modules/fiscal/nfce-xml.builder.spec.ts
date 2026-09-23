import { montarNfceXml, NfceInput, NfceItem } from './nfce-xml.builder';

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

// A chave carrega o tpEmis no 35º dígito (índice 34): 1 = normal, 9 = contingência off-line.
// Uma chave "3" repetido 44 vezes diria tpEmis=3, que não existe — e o builder recusa.
const CHAVE = '3'.repeat(34) + '1' + '3'.repeat(9);
const CHAVE_CONTINGENCIA = '3'.repeat(34) + '9' + '3'.repeat(9);

const item = (o: Partial<NfceItem> = {}): NfceItem => ({
  codigo: 'X', descricao: 'Produto', ncm: '21069090',
  quantidade: 1, precoUnitario: 10, ...o,
});

// Destinatário e transportador de teste. O CPF tem dígito verificador válido de propósito:
// a SEFAZ confere (regra E03-10 → rejeição 237) e o builder também.
const destino: NfceInput['dest'] = {
  documento: '11144477735',
  nome: 'Consumidor Teste',
  endereco: {
    logradouro: 'Rua B', numero: '50', bairro: 'Centro',
    codigoMunicipio: 3550308, municipio: 'Sao Paulo', uf: 'SP', cep: '01001000',
  },
};
// Entrega da própria loja: o manual da SEFAZ manda pôr os dados da EMPRESA no transportador.
const transportador: NfceInput['transportador'] = {
  documento: config.cnpj, nome: config.razaoSocial, municipio: config.municipio, uf: config.uf,
};

// `frete` só existe em operação de entrega (rejeição 753), então quem passa frete neste
// helper está pedindo uma nota de delivery — com destinatário e transportador junto.
function montar(itens: NfceItem[], desconto?: number, frete?: number, extra: Partial<NfceInput> = {}) {
  // Só completa sozinho quando o teste não disse nada sobre indPres: quem passa indPres
  // explicitamente está montando um caso de rejeição e não quer o preenchimento automático.
  const entrega = Number(frete) > 0 && extra.indPres === undefined;
  return montarNfceXml({
    config, serie: 1, numero: 1, chave: extra.contingencia ? CHAVE_CONTINGENCIA : CHAVE, cNF: '12345678',
    dhEmi: '2026-09-14T12:00:00-03:00', itens, forma: 'dinheiro',
    qrCode: 'http://q', urlChave: 'www.sefaz.uf.gov.br/nfce/consulta', desconto, frete,
    ...(entrega ? { indPres: 4 as const, dest: destino, transportador } : {}),
    ...extra,
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

  it('a ordem das tags segue o layout 4.00 (vUnTrib → vFrete → vDesc → vOutro → indTot)', () => {
    const xml = montar([item({ precoUnitario: 10 })], 2, 3, { outras: 4 });
    expect(xml).toMatch(
      /<vUnTrib>[\d.]+<\/vUnTrib><vFrete>[\d.]+<\/vFrete><vDesc>[\d.]+<\/vDesc><vOutro>[\d.]+<\/vOutro><indTot>1<\/indTot>/,
    );
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
      config, serie: 7, numero: 3, chave: CHAVE, cNF: '12345678',
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
      config, serie: 1, numero: 1, chave: CHAVE, cNF: '12345678',
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

// ===== DESTINATÁRIO, ENTREGA A DOMICÍLIO E INTERMEDIADOR =====
// Cada teste aqui corresponde a uma rejeição real da SEFAZ. O texto das regras foi conferido no
// MOC consolidado on-line (moc.sped.fazenda.pr.gov.br/NFe_NFCe), não no PDF de 2020:
//   B25b-20 → 717  indPres da NFC-e só pode ser 1, 4 ou 5
//   B25c-10 → 434  indIntermed obrigatório quando indPres ∈ {1,2,3,4,9}
//   E01-20  → 787  entrega sem identificação do destinatário
//   E05-20  → 788  entrega sem endereço do destinatário
//   X02-10  → 753  frete (modFrete<>9) fora da entrega a domicílio
//   X03-10  → 754  transportador fora da entrega a domicílio
//   X03-20  → 786  entrega sem transportador
describe('NFC-e — destinatário e entrega a domicílio', () => {
  it('venda de balcão: indPres 1, indIntermed 0, sem dest e sem transportador', () => {
    const xml = montar([item()]);
    expect(xml).toContain('<indPres>1</indPres>');
    expect(xml).toContain('<indIntermed>0</indIntermed>');
    expect(xml).not.toContain('<dest>');
    expect(xml).toContain('<transp><modFrete>9</modFrete></transp>');
  });

  it('entrega: sai o grupo dest com documento, nome, endereço e indIEDest 9', () => {
    const xml = montar([item()], 0, 5);
    expect(xml).toContain('<indPres>4</indPres>');
    expect(xml).toContain('<dest><CPF>11144477735</CPF>');
    expect(xml).toContain('<xNome>Consumidor Teste</xNome>');
    expect(xml).toContain('<xLgr>Rua B</xLgr><nro>50</nro><xBairro>Centro</xBairro>');
    expect(xml).toContain('<cMun>3550308</cMun><xMun>Sao Paulo</xMun><UF>SP</UF><CEP>01001000</CEP>');
    // NFC-e com IE do destinatário é rejeição: consumidor final é sempre não contribuinte.
    expect(xml).toContain('<indIEDest>9</indIEDest>');
    expect(xml).not.toContain('<dest><CPF>11144477735</CPF><IE>');
  });

  it('CNPJ no destinatário sai na tag CNPJ, escolhida pelo tamanho do documento', () => {
    const xml = montar([item()], 0, 0, {
      indPres: 4,
      dest: { documento: '11.222.333/0001-81', nome: 'Empresa', endereco: destino!.endereco },
      transportador,
    });
    expect(xml).toContain('<dest><CNPJ>11222333000181</CNPJ>');
  });

  it('o grupo dest fica entre emit e det, na ordem do leiaute', () => {
    const xml = montar([item()], 0, 5);
    expect(xml.indexOf('<emit>')).toBeLessThan(xml.indexOf('<dest>'));
    expect(xml.indexOf('<dest>')).toBeLessThan(xml.indexOf('<det '));
  });

  it('entrega: o transportador sai dentro de transp, depois do modFrete', () => {
    const xml = montar([item()], 0, 5);
    expect(xml).toContain('<transp><modFrete>0</modFrete><transporta>');
    expect(xml).toContain('<CNPJ>11222333000181</CNPJ><xNome>LOJA TESTE</xNome>');
    expect(xml.indexOf('</transp>')).toBeLessThan(xml.indexOf('<pag>'));
  });

  it('787: entrega sem documento do destinatário não vira XML', () => {
    expect(() => montar([item()], 0, 0, { indPres: 4, transportador })).toThrow(/787/);
  });

  it('788: entrega com documento mas sem endereço não vira XML', () => {
    expect(() =>
      montar([item()], 0, 0, { indPres: 4, dest: { documento: '11144477735' }, transportador }),
    ).toThrow(/788/);
  });

  it('786: entrega sem transportador não vira XML', () => {
    expect(() => montar([item()], 0, 0, { indPres: 4, dest: destino })).toThrow(/786/);
  });

  it('753: frete numa venda presencial não vira XML (era o defeito de toda nota de delivery)', () => {
    expect(() =>
      montarNfceXml({
        config, serie: 1, numero: 1, chave: CHAVE, cNF: '12345678',
        dhEmi: '2026-09-14T12:00:00-03:00', itens: [item()], forma: 'dinheiro',
        qrCode: 'http://q', urlChave: 'u', frete: 7,
      }),
    ).toThrow(/753/);
  });

  it('754: transportador numa venda presencial não vira XML', () => {
    expect(() => montar([item()], 0, 0, { transportador })).toThrow(/754/);
  });

  it('237: CPF com dígito verificador errado não vira XML', () => {
    expect(() =>
      montar([item()], 0, 0, { indPres: 4, dest: { ...destino!, documento: '11144477700' }, transportador }),
    ).toThrow(/237/);
  });
});

describe('NFC-e — intermediador (marketplace)', () => {
  const intermediador = { cnpj: '11222333000181', idCadIntTran: 'LOJA-123' };

  it('pedido de marketplace: indIntermed 1 e o grupo infIntermed entre pag e infAdic', () => {
    const xml = montar([item()], 0, 0, { intermediador });
    expect(xml).toContain('<indIntermed>1</indIntermed>');
    expect(xml).toContain('<infIntermed><CNPJ>11222333000181</CNPJ><idCadIntTran>LOJA-123</idCadIntTran></infIntermed>');
    expect(xml.indexOf('</pag>')).toBeLessThan(xml.indexOf('<infIntermed>'));
    expect(xml.indexOf('<infIntermed>')).toBeLessThan(xml.indexOf('<infAdic>'));
  });

  it('intermediador pela metade é recusado — nunca vira indIntermed 0 em silêncio', () => {
    expect(() => montar([item()], 0, 0, { intermediador: { cnpj: '', idCadIntTran: 'LOJA-123' } })).toThrow(/marketplace/i);
    expect(() => montar([item()], 0, 0, { intermediador: { cnpj: '11222333000181', idCadIntTran: '' } })).toThrow(/marketplace/i);
  });
});

describe('NFC-e — taxa de entrega na nota declarada como presencial', () => {
  // Pedido sem CPF do cliente: a nota sai presencial (opção da loja), e a taxa NÃO pode ir como
  // frete (753). Vai como "outras despesas acessórias" (vOutro), que compõe o vNF (W16-10) e
  // dispensa NCM — item novo exigiria um, e NCM "00" fora de serviço é rejeição 471.
  it('a taxa entra em vOutro, some do frete e o total fecha com o que o cliente pagou', () => {
    const xml = montar([item({ precoUnitario: 30 })], 0, 0, { outras: 6 });
    expect(xml).toContain('<indPres>1</indPres>');
    expect(doTotal(xml, 'vFrete')).toBe(0);
    expect(doTotal(xml, 'vOutro')).toBe(6);
    expect(doTotal(xml, 'vNF')).toBe(36);
    expect(Number(xml.match(/<vPag>([\d.]+)<\/vPag>/)![1])).toBe(36);
    expect(xml).toContain('<transp><modFrete>9</modFrete></transp>');
  });

  it('W15-10: o vOutro do total é EXATAMENTE a soma dos itens', () => {
    const xml = montar([item({ precoUnitario: 7.77 }), item({ precoUnitario: 3.33 })], 0, 0, { outras: 9.99 });
    expect(soma(dosItens(xml, 'vOutro'))).toBe(doTotal(xml, 'vOutro'));
  });
});

// ===== CONTINGÊNCIA OFF-LINE (tpEmis=9) =====
// A nota é gerada, assinada e impressa SEM autorização prévia, e transmitida depois — até o
// fim do primeiro dia útil seguinte (MOC 7.0, Anexo IV). O anexo lista os campos obrigatórios:
// dhCont, xJust, tpEmis=9, idDest=1, finNFe=1, indFinal=1.
//   B28-20 → 557  dhCont e xJust são OBRIGATÓRIOS com tpEmis 2/4/5/9
//   B28-10 → 556  e PROIBIDOS com tpEmis=1
describe('NFC-e — contingência off-line', () => {
  const cont = { dhCont: '2026-09-23T14:05:00-03:00', xJust: 'Sem resposta da SEFAZ no caixa' };

  it('sem contingência: tpEmis 1 e nada de dhCont/xJust (556)', () => {
    const xml = montar([item()]);
    expect(xml).toContain('<tpEmis>1</tpEmis>');
    expect(xml).not.toContain('<dhCont>');
    expect(xml).not.toContain('<xJust>');
  });

  it('em contingência: tpEmis 9, com dhCont e xJust no fim do ide', () => {
    const xml = montar([item()], 0, 0, { contingencia: cont });
    expect(xml).toContain('<tpEmis>9</tpEmis>');
    expect(xml).toContain('<verProc>Regem-1.0</verProc><dhCont>2026-09-23T14:05:00-03:00</dhCont>');
    expect(xml).toContain('<xJust>Sem resposta da SEFAZ no caixa</xJust></ide>');
  });

  it('557: contingência pela metade não vira XML', () => {
    expect(() => montar([item()], 0, 0, { contingencia: { dhCont: cont.dhCont, xJust: '' } })).toThrow(/557/);
    expect(() => montar([item()], 0, 0, { contingencia: { dhCont: '', xJust: cont.xJust } })).toThrow(/557/);
  });

  it('a chave tem de concordar com o tpEmis do ide — o 35º dígito é ele', () => {
    // A chave padrão dos testes tem tpEmis=1 (só 3). Pedir contingência com ela não pode passar.
    expect(() => montar([item()], 0, 0, { contingencia: cont })).not.toThrow(); // usa a chave de contingência
    expect(() =>
      montarNfceXml({
        config, serie: 1, numero: 1, chave: CHAVE, cNF: '12345678',
        dhEmi: '2026-09-14T12:00:00-03:00', itens: [item()], forma: 'dinheiro',
        qrCode: 'http://q', urlChave: 'u', contingencia: cont,
      }),
    ).toThrow(/tpEmis=1/);
  });

  it('justificativa curta demais é recusada antes de virar rejeição', () => {
    expect(() => montar([item()], 0, 0, { contingencia: { dhCont: cont.dhCont, xJust: 'caiu' } })).toThrow(/15 a 256/);
  });
});
