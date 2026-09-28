import { randomBytes } from 'node:crypto';
import * as forge from 'node-forge';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { FiscalService } from './fiscal.service';
import { salvarCertificado } from './credencial';
import { fraseTributosAprox } from './tributos-aproximados';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A EMISSÃO com o valor aproximado dos tributos (Lei 12.741) — o caminho inteiro: Postgres, série,
// certificado, assinatura, XML e gravação da nota. Só a REDE (SEFAZ) e a LEITURA da tabela do
// IBPT são dublês: a tabela é global (sem empresa) e as outras specs fiscais emitem notas do RJ no
// mesmo banco, em paralelo — uma versão do RJ gravada aqui mudaria o XML delas. A leitura de
// verdade é coberta por `ibpt/ibpt.spec.ts` (com UFs que ninguém mais usa).
jest.mock('./sefaz/soap', () => ({
  ...jest.requireActual('./sefaz/soap'),
  chamarSefaz: jest.fn(),
}));
jest.mock('./ibpt/ibpt-tabela', () => ({
  ...jest.requireActual('./ibpt/ibpt-tabela'),
  tabelaIbptDaNota: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chamarSefaz } = require('./sefaz/soap');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { tabelaIbptDaNota } = require('./ibpt/ibpt-tabela');

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('emissao-tributos-aprox.spec: sem TEST_PG_URL — PULADO');

const CNPJ = '12345678000195';
const SENHA = 'Senha-Do-Certificado-9!';

function pfxDeTeste(): Buffer {
  const k = forge.pki.rsa.generateKeyPair(1024);
  const c = forge.pki.createCertificate();
  c.publicKey = k.publicKey;
  c.serialNumber = '12fa9d';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 60 * 86_400_000);
  c.setSubject([{ name: 'commonName', value: `BAR DE TESTE LTDA:${CNPJ}` }]);
  c.setIssuer([{ name: 'commonName', value: 'AC DE TESTE' }]);
  c.sign(k.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(k.privateKey, [c], SENHA, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

const soap = (miolo: string) =>
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
  '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">' +
  miolo +
  '</nfeResultMsg></soap:Body></soap:Envelope>';
const autorizada = (chave: string) =>
  `<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>` +
  `<verAplic>SVRS</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>33</cUF>` +
  `<dhRecbto>2026-09-26T10:00:01-03:00</dhRecbto><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb>` +
  `<verAplic>SVRS</verAplic><chNFe>${chave}</chNFe><dhRecbto>2026-09-26T10:00:01-03:00</dhRecbto>` +
  `<nProt>333260000000888</nProt><digVal>abc=</digVal><cStat>100</cStat>` +
  `<xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></retEnviNFe>`;
const chaveEnviada = (corpo: string) => /Id="NFe(\d{44})"/.exec(corpo)?.[1] ?? '';

const TABELA = {
  fonte: 'IBPT/empresometro.com.br',
  chave: 'C44399',
  versao: '26.2.B',
  aliquotas: { '21069090': { nacionalFederal: 13.45, importadosFederal: 36.08, estadual: 20, municipal: 0 } },
};

descrever('emissão com o valor aproximado dos tributos (Lei 12.741)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const servico = new FiscalService(db, { registrar: async () => undefined } as any);
  const chaveOriginal = process.env.SEGREDOS_CHAVE;
  const edgeOriginal = process.env.EDGE_MODE;
  let tenant = '';
  let enviado = '';

  beforeAll(async () => {
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    delete process.env.EDGE_MODE;
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste Lei 12.741') returning id`)).rows[0].id;
    await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Loja')`, [tenant]);
    await pool.query(
      `insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente, serie, serie_nuvem,
         cnpj, razao_social, ie, uf, codigo_uf, codigo_municipio, municipio, endereco, bairro, numero,
         cep, url_qrcode_homolog, url_chave_homolog, url_qrcode_prod, url_chave_prod)
       values ($1,null,true,'2',50,51,$2,'Bar de Teste LTDA','13047081','RJ',33,3304557,'Rio de Janeiro',
               'Rua A','Centro','100','21221240',
               'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode','www.fazenda.rj.gov.br/nfce/consulta',
               'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode','www.fazenda.rj.gov.br/nfce/consulta')`,
      [tenant, CNPJ],
    );
    await salvarCertificado(db, tenant, null, { pfxBase64: pfxDeTeste().toString('base64'), senha: SENHA });
  }, 60000);

  afterAll(async () => {
    if (chaveOriginal === undefined) delete process.env.SEGREDOS_CHAVE;
    else process.env.SEGREDOS_CHAVE = chaveOriginal;
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  }, 60000);

  beforeEach(() => {
    enviado = '';
    tabelaIbptDaNota.mockReset();
    chamarSefaz.mockReset();
    chamarSefaz.mockImplementation(async ({ corpoXml }: any) => {
      enviado = corpoXml;
      return soap(autorizada(chaveEnviada(corpoXml)));
    });
  });

  const notaNoBanco = (chave: string) =>
    pool.query('select * from nota_fiscal where chave = $1', [chave]).then((r) => r.rows[0]);

  it('com tabela vigente: vTotTrib no item e no total, frase no infCpl e os valores gravados na nota', async () => {
    tabelaIbptDaNota.mockResolvedValue(TABELA);
    const r: any = await servico.emitirTesteHomologacao(tenant, null, null);
    expect(r.status).toBe('autorizada');
    // Pediu a tabela da UF do emitente, com os NCMs da nota, para o dia de hoje (AAAA-MM-DD), em
    // nome da empresa — é o que deixa a tabela PRÓPRIA dela (token do lojista, mig 292) valer.
    expect(tabelaIbptDaNota).toHaveBeenCalledWith(
      expect.anything(), 'RJ', ['21069090'], expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), tenant,
    );
    // R$ 1,00 × 13,45% = 0,1345 → 0,13 federal; × 20% = 0,20 estadual.
    expect(enviado).toContain('<imposto><vTotTrib>0.33</vTotTrib><ICMS>');
    expect(enviado).toMatch(/<vNF>1\.00<\/vNF><vTotTrib>0\.33<\/vTotTrib><\/ICMSTot>/);
    const nota = await notaNoBanco(r.chave);
    expect(nota.tributos_aprox).toMatchObject({
      federal: 0.13, estadual: 0.2, municipal: 0, total: 0.33,
      fonte: 'IBPT/empresometro.com.br', chave: 'C44399', versao: '26.2.B',
    });
    // O que foi para o XML é exatamente a frase dos valores gravados — é o que a reimpressão usa.
    expect(enviado).toContain(`<infCpl>${fraseTributosAprox(nota.tributos_aprox)} | `);
  }, 60000);

  it('sem tabela vigente: a nota sai igual, sem os valores — e nada é gravado', async () => {
    tabelaIbptDaNota.mockResolvedValue(null);
    const r: any = await servico.emitirTesteHomologacao(tenant, null, null);
    expect(r.status).toBe('autorizada');
    expect(enviado).not.toContain('vTotTrib');
    expect(enviado).not.toContain('Trib aprox');
    expect((await notaNoBanco(r.chave)).tributos_aprox).toBeNull();
  }, 60000);

  it('tabela ilegível (ex.: servidor da loja antes da migration 291) NUNCA derruba a venda', async () => {
    tabelaIbptDaNota.mockRejectedValue(new Error('relation "ibpt_versao" does not exist'));
    const r: any = await servico.emitirTesteHomologacao(tenant, null, null);
    expect(r.status).toBe('autorizada');
    expect(enviado).not.toContain('vTotTrib');
    expect((await notaNoBanco(r.chave)).tributos_aprox).toBeNull();
  }, 60000);
});
