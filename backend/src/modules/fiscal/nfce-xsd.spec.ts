import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import * as forge from 'node-forge';
import { validateXML } from 'xmllint-wasm';
import { assinarNfe } from './assinatura';
import { montarNfceXml, NfceInput } from './nfce-xml.builder';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O XML DA NFC-e CONTRA O SCHEMA OFICIAL (XSD do leiaute 4.00, pacote PL_009_V4).
//
// Por que este teste existe: a SEFAZ rejeitou uma nota real com **225 — Falha no Schema XML**
// apontando `enderEmit/cPais`. O elemento apontado não era o errado: era o que apareceu no
// LUGAR do que faltava (o CEP, obrigatório). Descobrir isso na SEFAZ custa um número gasto —
// que vira buraco na sequência, e buraco a lei manda inutilizar. Aqui custa um teste.
//
// Os `.xsd` em `xsd/` são os arquivos oficiais, sem edição. Para atualizar (nova NT que mexa no
// leiaute), troque os arquivos pelo pacote publicado no Portal da NF-e.
//
// ⚠️ Isto confere o SCHEMA — forma, ordem e tipo dos campos. Regra de negócio da SEFAZ
// (duplicidade, CSC, horário, CNPJ não credenciado) é outra coisa e não aparece aqui.

const XSD = join(__dirname, 'xsd');
const arquivo = (nome: string) => ({ fileName: nome, contents: readFileSync(join(XSD, nome), 'utf8') });

async function validar(xml: string) {
  const r = await validateXML({
    xml: [{ fileName: 'nfe.xml', contents: xml }],
    schema: [arquivo('nfe_v4.00.xsd')],
    preload: ['leiauteNFe_v4.00.xsd', 'tiposBasico_v4.00.xsd', 'xmldsig-core-schema_v1.01.xsd'].map(arquivo),
  });
  return { valido: r.valid, erros: (r.errors ?? []).map((e: any) => e.message).join(' | ') };
}

// Certificado só para fechar a assinatura — o schema exige o grupo <Signature>.
function certificadoDeTeste() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  c.serialNumber = '01';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 86_400_000);
  c.setSubject([{ name: 'commonName', value: 'BAR DE TESTE LTDA:12345678000195' }]);
  c.setIssuer([{ name: 'commonName', value: 'AC DE TESTE' }]);
  c.sign(forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()), forge.md.sha256.create());
  return {
    certificadoPem: forge.pki.certificateToPem(c),
    chavePrivadaPem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  };
}

const CHAVE = '33260936219750000104650510000000011552821127';
const CONFIG: any = {
  crt: 1, ambiente: '2', cnpj: '36219750000104', razaoSocial: 'BAR DE TESTE LTDA',
  ie: '13047081', uf: 'RJ', codigoUf: 33, codigoMunicipio: 3304557, municipio: 'Rio de Janeiro',
  endereco: 'R. Nossa Senhora de Fatima', numero: '39587', bairro: 'Penha',
  complemento: 'LOJA 02', cep: '21221-240',
};
const entrada = (over: Partial<NfceInput> = {}, config: any = CONFIG): NfceInput => ({
  config, serie: 51, numero: 1, chave: CHAVE, cNF: '15528211',
  dhEmi: '2026-09-22T20:15:00-03:00',
  itens: [{
    codigo: 'TESTE', descricao: 'PRODUTO DE TESTE', ncm: '21069090', cfop: '5102',
    origem: '0', csosn: '102', unidadeTrib: 'UN', quantidade: 1, precoUnitario: 1,
  }],
  forma: 'dinheiro',
  qrCode: `https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode?p=${CHAVE}|3|2`,
  urlChave: 'www.fazenda.rj.gov.br/nfce/consulta',
  ...over,
});

const DESTINO: NfceInput['dest'] = {
  documento: '11144477735',
  nome: 'CONSUMIDOR DE TESTE',
  endereco: {
    logradouro: 'Rua da Entrega', numero: '12', complemento: 'apto 301', bairro: 'Penha',
    codigoMunicipio: 3304557, municipio: 'Rio de Janeiro', uf: 'RJ', cep: '21221-240',
  },
};
// Entrega da própria loja: o manual da NFC-e da SEFAZ-RJ manda pôr os dados da EMPRESA no
// grupo do transportador, mesmo quando quem leva é motoboy ou ciclista.
const TRANSPORTADOR: NfceInput['transportador'] = {
  documento: CONFIG.cnpj, nome: CONFIG.razaoSocial, ie: CONFIG.ie,
  municipio: CONFIG.municipio, uf: CONFIG.uf,
};

describe('o XML que emitimos passa no schema oficial da NF-e 4.00', () => {
  const cert = certificadoDeTeste();
  const assinada = (i: NfceInput) => assinarNfe(montarNfceXml(i), cert);

  it('a NFC-e de venda simples é válida', async () => {
    expect(await validar(assinada(entrada()))).toEqual({ valido: true, erros: '' });
  }, 120000);

  it('com frete, desconto, complemento de endereço e responsável técnico — continua válida', async () => {
    const xml = assinada(
      entrada({
        // Frete só existe em operação de entrega (753), que arrasta destinatário e transportador.
        indPres: 4,
        dest: DESTINO,
        transportador: TRANSPORTADOR,
        frete: 7.5,
        desconto: 3,
        itens: [
          { codigo: 'A', descricao: 'X-Salada', ncm: '21069090', cfop: '5102', origem: '0', csosn: '102', unidadeTrib: 'UN', quantidade: 2, precoUnitario: 25.9 },
          { codigo: 'B', descricao: 'Refrigerante & "cia" <lata>', ncm: '22021000', cfop: '5102', origem: '0', csosn: '102', unidadeTrib: 'UN', quantidade: 1, precoUnitario: 7 },
        ],
        respTec: { cnpj: '12345678000195', contato: 'Suporte Regem', email: 'suporte@exemplo.com', fone: '2133334444' },
      }),
    );
    expect(await validar(xml)).toEqual({ valido: true, erros: '' });
    expect(xml).toContain('<xCpl>LOJA 02</xCpl>'); // recebido da config e escrito de verdade
  }, 120000);

  // O grupo `dest` e o `infIntermed` são novos no nosso XML, e é justamente aí que o schema
  // paga por si: `dest` fica entre `emit` e `det`, `infIntermed` entre `pag` e `infAdic`, e
  // elemento fora de ordem é a rejeição 225 — a mesma que já nos custou um número de nota.
  it('nota de entrega a domicílio com destinatário, transportador e intermediador é válida', async () => {
    const xml = assinada(
      entrada({
        indPres: 4,
        dest: DESTINO,
        transportador: TRANSPORTADOR,
        intermediador: { cnpj: '12345678000195', idCadIntTran: 'MERCHANT-42' },
        frete: 6,
      }),
    );
    expect(await validar(xml)).toEqual({ valido: true, erros: '' });
    expect(xml).toContain('<indPres>4</indPres>');
    expect(xml).toContain('<indIntermed>1</indIntermed>');
  }, 120000);

  it('a taxa de entrega em vOutro (nota sem CPF, declarada presencial) é válida', async () => {
    const xml = assinada(entrada({ outras: 6 }));
    expect(await validar(xml)).toEqual({ valido: true, erros: '' });
    expect(xml).toContain('<vOutro>6.00</vOutro>');
  }, 120000);

  // Contingência off-line: `dhCont`/`xJust` são os ÚLTIMOS elementos do `ide`, depois do
  // `verProc`. Fora de ordem é a rejeição 225 — e aqui o schema pega antes da SEFAZ.
  it('a nota emitida em contingência off-line (tpEmis=9) é válida', async () => {
    // O 35º dígito da chave (índice 34) é o tpEmis: numa nota de contingência ele é 9, e o
    // builder recusa chave e `ide` em desacordo.
    const chaveCont = CHAVE.slice(0, 34) + '9' + CHAVE.slice(35);
    const xml = assinada(
      entrada({
        chave: chaveCont,
        contingencia: { dhCont: '2026-09-22T20:10:00-03:00', xJust: 'Sem resposta da SEFAZ no caixa' },
      }),
    );
    expect(await validar(xml)).toEqual({ valido: true, erros: '' });
    expect(xml).toContain('<tpEmis>9</tpEmis>');
    expect(xml).toContain('<xJust>Sem resposta da SEFAZ no caixa</xJust></ide>');
  }, 120000);

  it('a nota de HOMOLOGAÇÃO (com a frase obrigatória no 1º item) é válida', async () => {
    const xml = assinada(entrada({}, { ...CONFIG, ambiente: '2' }));
    expect(xml).toContain('NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL');
    expect(await validar(xml)).toEqual({ valido: true, erros: '' });
  }, 120000);

  it('sem CEP o schema reprova exatamente como a SEFAZ reprovou (rejeição 225 em `cPais`)', async () => {
    // Prova que o teste PEGA o defeito real: com o CEP removido à força do XML pronto, o
    // validador dá a mesma mensagem que a SEFAZ deu na nota nº 1 da série 51.
    const semCep = assinada(entrada()).replace(/<CEP>\d{8}<\/CEP>/, '');
    const r = await validar(semCep);
    expect(r.valido).toBe(false);
    expect(r.erros).toContain("'{http://www.portalfiscal.inf.br/nfe}cPais': This element is not expected.");
    expect(r.erros).toContain('Expected is ( {http://www.portalfiscal.inf.br/nfe}CEP )');
  }, 120000);
});
