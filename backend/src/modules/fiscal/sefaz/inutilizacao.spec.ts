import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import * as forge from 'node-forge';
import { validateXML } from 'xmllint-wasm';
import { assinarInutNFe, assinaturaValida } from '../assinatura';
import { idInutilizacao, lerRetornoInutilizacao, montarInutNFe } from './inutilizacao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PEDIDO DE INUTILIZAÇÃO DE NUMERAÇÃO.
//
// É o documento que fecha o buraco na sequência — e é IRREVERSÍVEL: homologado, aqueles números
// nunca mais podem virar nota. Um Id malformado, uma faixa invertida ou uma justificativa curta
// viram rejeição; uma faixa errada vira perda de documento. Por isso tudo aqui é conferido, e o
// XML é validado contra o schema oficial antes de existir qualquer chance de sair para a SEFAZ.

const BASE = {
  ambiente: '2',
  codigoUf: 33,
  ano2: '26',
  cnpj: '36.219.750/0001-04',
  serie: 51,
  numeroInicial: 1,
  numeroFinal: 1,
  justificativa: 'Numeracao sem nota autorizada - quebra de sequencia',
};

function certificadoDeTeste() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  c.serialNumber = '01';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 86_400_000);
  c.setSubject([{ name: 'commonName', value: 'BAR DE TESTE LTDA:36219750000104' }]);
  c.setIssuer([{ name: 'commonName', value: 'AC DE TESTE' }]);
  c.sign(forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()), forge.md.sha256.create());
  return {
    certificadoPem: forge.pki.certificateToPem(c),
    chavePrivadaPem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  };
}

describe('o Id do pedido', () => {
  it('tem os 41 dígitos que o schema exige, com zeros à esquerda em cada campo', () => {
    const id = idInutilizacao({ codigoUf: 33, ano2: '26', cnpj: '36219750000104', serie: 5, numeroInicial: 7, numeroFinal: 9 });
    expect(id).toMatch(/^ID\d{41}$/);
    // cUF(2) ano(2) CNPJ(14) mod(2) série(3) nNFIni(9) nNFFin(9)
    expect(id).toBe('ID' + '33' + '26' + '36219750000104' + '65' + '005' + '000000007' + '000000009');
  });
});

describe('o pedido de inutilização', () => {
  it('é montado como a SEFAZ espera — e SEM ASSINATURA o schema já reprova', async () => {
    const xml = montarInutNFe({ ...BASE, numeroFinal: 3 });
    expect(xml).toContain('<xServ>INUTILIZAR</xServ>');
    expect(xml).toContain('<nNFIni>1</nNFIni><nNFFin>3</nNFFin>');

    // O schema exige a assinatura DENTRO do próprio pedido. Vale registrar: o único defeito
    // apontado aqui é a falta dela — todo o resto do documento já está de acordo. A versão
    // assinada é validada no teste seguinte.
    const XSD = join(__dirname, '..', 'xsd');
    const arq = (n: string) => ({ fileName: n, contents: readFileSync(join(XSD, n), 'utf8') });
    const r = await validateXML({
      xml: [{ fileName: 'inut.xml', contents: xml }],
      schema: [arq('inutNFe_v4.00.xsd')],
      preload: ['leiauteInutNFe_v4.00.xsd', 'tiposBasico_v4.00.xsd', 'xmldsig-core-schema_v1.01.xsd'].map(arq),
    });
    expect(r.valid).toBe(false);
    const erros = (r.errors ?? []).map((e: any) => e.message);
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain('Expected is ( {http://www.w3.org/2000/09/xmldsig#}Signature )');
  }, 120000);

  it('recusa justificativa curta e faixa invertida antes de qualquer chamada', () => {
    expect(() => montarInutNFe({ ...BASE, justificativa: 'curta' })).toThrow(/15 a 255/);
    expect(() => montarInutNFe({ ...BASE, justificativa: 'x'.repeat(256) })).toThrow(/15 a 255/);
    expect(() => montarInutNFe({ ...BASE, numeroInicial: 10, numeroFinal: 2 })).toThrow(/Faixa inv/i);
  });

  it('escapa o que o usuário escreveu na justificativa (senão o XML quebra)', () => {
    const xml = montarInutNFe({ ...BASE, justificativa: 'Lacuna <teste> & "cia" ficou sem nota' });
    expect(xml).toContain('Lacuna &lt;teste&gt; &amp; "cia" ficou sem nota');
  });

  it('assinado, o pedido continua válido no schema e a assinatura confere', async () => {
    const assinado = assinarInutNFe(montarInutNFe(BASE), certificadoDeTeste());
    expect(assinado).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
    // Assina o infInut — não a raiz, não outra coisa.
    expect(assinado).toMatch(/<Reference URI="#ID\d{41}">/);
    expect(assinaturaValida(assinado)).toBe(true);

    const XSD = join(__dirname, '..', 'xsd');
    const arq = (n: string) => ({ fileName: n, contents: readFileSync(join(XSD, n), 'utf8') });
    const r = await validateXML({
      xml: [{ fileName: 'inut.xml', contents: assinado }],
      schema: [arq('inutNFe_v4.00.xsd')],
      preload: ['leiauteInutNFe_v4.00.xsd', 'tiposBasico_v4.00.xsd', 'xmldsig-core-schema_v1.01.xsd'].map(arq),
    });
    expect({ valido: r.valid, erros: (r.errors ?? []).map((e: any) => e.message).join(' | ') }).toEqual({
      valido: true,
      erros: '',
    });
  }, 120000);
});

describe('a resposta da SEFAZ', () => {
  const pedido = '<inutNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><infInut Id="ID' + '1'.repeat(41) + '"/><Signature/></inutNFe>';
  const ret = (cStat: string, xMotivo: string) =>
    `<retInutNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><infInut><tpAmb>2</tpAmb>` +
    `<verAplic>SVRS</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>33</cUF>` +
    `<ano>26</ano><CNPJ>36219750000104</CNPJ><mod>65</mod><serie>51</serie><nNFIni>1</nNFIni><nNFFin>1</nNFFin>` +
    `<dhRecbto>2026-09-22T23:10:00-03:00</dhRecbto>${cStat === '102' ? '<nProt>333260009988776</nProt>' : ''}</infInut></retInutNFe>`;

  it('102: HOMOLOGADA — guarda o protocolo e monta o comprovante (pedido + retorno)', () => {
    const r: any = lerRetornoInutilizacao(ret('102', 'Inutilizacao de numero homologado'), pedido);
    expect(r).toMatchObject({ situacao: 'homologada', protocolo: '333260009988776' });
    expect(r.procInutNFe).toContain('<ProcInutNFe');
    expect(r.procInutNFe).toContain('<inutNFe');
    expect(r.procInutNFe).toContain('<retInutNFe');
    expect(r.procInutNFe.match(/<\?xml/g)).toHaveLength(1);
  });

  it.each([
    ['563', 'Ja existe pedido de Inutilizacao com a mesma faixa de inutilizacao'],
    ['241', 'Um numero da faixa ja foi utilizado'],
    ['256', 'Uma NF-e da faixa ja esta inutilizada'],
  ])('qualquer código diferente de 102 (%s) é REJEIÇÃO — nada é dado por inutilizado', (cStat, xMotivo) => {
    expect(lerRetornoInutilizacao(ret(cStat, xMotivo), pedido)).toMatchObject({ situacao: 'rejeitada', cStat });
  });
});
