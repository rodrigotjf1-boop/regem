import { randomBytes } from 'node:crypto';
import * as forge from 'node-forge';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { FiscalService } from './fiscal.service';
import { salvarCertificado } from './credencial';
import { SefazInalcancavel } from './sefaz/soap';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A REDE é a única coisa trocada por um dublê: o resto é de verdade — Postgres, contador de
// série, certificado A1 (fabricado aqui), assinatura, XML, gravação da nota.
jest.mock('./sefaz/soap', () => ({
  ...jest.requireActual('./sefaz/soap'),
  chamarSefaz: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chamarSefaz } = require('./sefaz/soap');

// NFC-e DE TESTE EM HOMOLOGAÇÃO — o caminho inteiro da emissão.
//
// O que precisa ser verdade, e por quê:
//   • a nota nasce 'pendente' e só vira 'autorizada' com protocolo da SEFAZ na mão;
//   • rejeição e silêncio da SEFAZ NUNCA viram autorizada — e ficam gravados com o motivo;
//   • em homologação o primeiro item leva a frase obrigatória (senão é rejeição 373);
//   • o QR do RJ é v3 (sem CSC) e a nota sai na série e no contador da LOJA, não num à parte;
//   • produção não reaproveita série usada em teste (os números dos testes virariam buraco
//     na sequência de produção, que o Fisco manda inutilizar);
//   • a configuração gravada no nível da EMPRESA vale para a loja (regra V4).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('emissao-teste-homologacao.spec: sem TEST_PG_URL — PULADO');

const CNPJ = '12345678000195';
const SENHA = 'Senha-Do-Certificado-9!';
const FRASE_HOMOLOGACAO = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

function pfxDeTeste(): Buffer {
  const k = forge.pki.rsa.generateKeyPair(1024);
  const c = forge.pki.createCertificate();
  c.publicKey = k.publicKey;
  c.serialNumber = '12fa9c';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 60 * 86_400_000);
  c.setSubject([{ name: 'commonName', value: `BAR DE TESTE LTDA:${CNPJ}` }]);
  c.setIssuer([{ name: 'commonName', value: 'AC DE TESTE' }]);
  c.sign(k.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(k.privateKey, [c], SENHA, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

// Resposta da SEFAZ (envelope SOAP inteiro, como vem do webservice).
const soap = (miolo: string) =>
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
  '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">' +
  miolo +
  '</nfeResultMsg></soap:Body></soap:Envelope>';
const retEnvi = (cStat: string, xMotivo: string, prot = '') =>
  `<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>` +
  `<verAplic>SVRS</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>33</cUF>` +
  `<dhRecbto>2026-09-22T10:00:01-03:00</dhRecbto>${prot}</retEnviNFe>`;
const protNFe = (cStat: string, xMotivo: string, chave: string) =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${chave}</chNFe>` +
  `<dhRecbto>2026-09-22T10:00:01-03:00</dhRecbto>${cStat === '100' ? '<nProt>333260000000777</nProt>' : ''}` +
  `<digVal>abc=</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;

// A chave que a SEFAZ devolve é sempre a da nota que acabou de ser enviada — o dublê lê o
// XML recebido, como a SEFAZ leria.
const chaveEnviada = (corpo: string) => /Id="NFe(\d{44})"/.exec(corpo)?.[1] ?? '';

descrever('NFC-e de teste em homologação, do banco à SEFAZ', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const auditado: any[] = [];
  const servico = new FiscalService(db, {
    registrar: async (e: any) => void auditado.push(e),
  } as any);

  const chaveOriginal = process.env.SEGREDOS_CHAVE;
  const edgeOriginal = process.env.EDGE_MODE;
  let tenant = '';
  let unidade = '';

  beforeAll(async () => {
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    delete process.env.EDGE_MODE; // emitindo como NUVEM: série 51
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste NFC-e homolog') returning id`)).rows[0].id;
    unidade = (await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [tenant]))
      .rows[0].id;
    // ATENÇÃO: gravada SEM unidade (nível empresa) — é como a tela grava numa rede de uma loja só.
    await pool.query(
      `insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente, serie, serie_nuvem,
         cnpj, razao_social, ie, uf, codigo_uf, codigo_municipio, municipio, endereco, bairro, numero,
         url_qrcode_homolog, url_chave_homolog, url_qrcode_prod, url_chave_prod)
       values ($1,null,true,'2',50,51,$2,'Bar de Teste LTDA','13047081','RJ',33,3304557,'Rio de Janeiro',
               'Rua A','Centro','100',
               'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode',
               'www.fazenda.rj.gov.br/nfce/consulta',
               'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode',
               'www.fazenda.rj.gov.br/nfce/consulta')`,
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
  });

  beforeEach(() => chamarSefaz.mockReset());

  const notaNoBanco = (chave: string) =>
    pool.query('select * from nota_fiscal where chave = $1', [chave]).then((r) => r.rows[0]);

  it('autorizada: guarda protocolo e o XML PROTOCOLADO; o XML enviado tem a frase de homologação, o QR v3 e vai assinado', async () => {
    let enviado = '';
    chamarSefaz.mockImplementation(async ({ corpoXml }: any) => {
      enviado = corpoXml;
      return soap(retEnvi('104', 'Lote processado', protNFe('100', 'Autorizado o uso da NF-e', chaveEnviada(corpoXml))));
    });

    const r: any = await servico.emitirTesteHomologacao(tenant, null, null);
    expect(r.status).toBe('autorizada');
    expect(r.protocolo).toBe('333260000000777');
    expect(r.ambiente).toBe('2');
    // Série e contador da LOJA (config do nível empresa vale para ela — V4), e não um contador à parte.
    expect(r.serie).toBe(51);
    expect(r.numero).toBe(1);

    // O que foi enviado: assinado, com a frase obrigatória no PRIMEIRO item (senão: rejeição 373)…
    expect(enviado).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
    expect(enviado).toContain(`<xProd>${FRASE_HOMOLOGACAO}</xProd>`);
    // …e o QR do RJ na versão 3: o parâmetro é só chave|3|ambiente, sem nenhum hash de CSC.
    expect(enviado).toContain(
      `<qrCode><![CDATA[https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode?p=${r.chave}|3|2]]></qrCode>`,
    );
    expect(enviado).not.toContain('cHashQRCode');
    expect(enviado).toContain('<urlChave>www.fazenda.rj.gov.br/nfce/consulta</urlChave>');

    const nota = await notaNoBanco(r.chave);
    expect(nota.status).toBe('autorizada');
    expect(nota.unidade_id).toBe(unidade); // resolvida sozinha: a rede tem uma loja só
    expect(nota.emitida_em).not.toBeNull();
    // O que fica guardado é o nfeProc (nota + protocolo) — é ele que vale como documento.
    expect(nota.xml).toContain('<nfeProc');
    expect(nota.xml).toContain('<protNFe');
    expect(auditado.at(-1)).toMatchObject({ acao: 'emitiu_nfce_teste' });
  }, 60000);

  it('rejeitada pela SEFAZ NÃO vira autorizada — fica gravada com o motivo', async () => {
    chamarSefaz.mockImplementation(async ({ corpoXml }: any) =>
      soap(retEnvi('104', 'Lote processado', protNFe('225', 'Falha no Schema XML', chaveEnviada(corpoXml)))),
    );
    const r: any = await servico.emitirTesteHomologacao(tenant, null, null);
    expect(r.status).toBe('rejeitada');
    expect(r.motivo).toContain('225');
    expect(r.protocolo).toBeNull();
    expect((await notaNoBanco(r.chave)).emitida_em).toBeNull();
  }, 60000);

  it('lote recusado inteiro também é rejeição — e não some sem registro', async () => {
    chamarSefaz.mockResolvedValue(soap(retEnvi('215', 'Falha no schema XML do lote')));
    const r: any = await servico.emitirTesteHomologacao(tenant, null, null);
    expect(r.status).toBe('rejeitada');
    expect(r.motivo).toContain('215');
  }, 60000);

  it('SEFAZ muda: enviada e sem resposta fica PENDENTE (pode ter sido autorizada lá) — nunca autorizada aqui', async () => {
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('Tempo esgotado ao falar com a SEFAZ.'));
    const r: any = await servico.emitirTesteHomologacao(tenant, null, null);
    expect(r.status).toBe('pendente');
    expect(r.motivo).toMatch(/situação desconhecida/i);
    const nota = await notaNoBanco(r.chave);
    expect(nota.status).toBe('pendente');
    expect(nota.emitida_em).toBeNull();
  }, 60000);

  it('cada nota gasta UM número, em sequência — inclusive as que a SEFAZ recusou', async () => {
    const r = await pool.query(
      `select numero, status from nota_fiscal where tenant_id = $1 and serie = 51 order by numero`,
      [tenant],
    );
    expect(r.rows.map((x: any) => Number(x.numero))).toEqual([1, 2, 3, 4]);
    expect(r.rows.filter((x: any) => x.status === 'autorizada')).toHaveLength(1);
  }, 60000);

  it('a nota de teste não existe em produção — a rota recusa antes de qualquer coisa', async () => {
    await pool.query(`update fiscal_config set ambiente = '1' where tenant_id = $1`, [tenant]);
    chamarSefaz.mockResolvedValue(soap(retEnvi('104', 'Lote processado', protNFe('100', 'ok', '3'.repeat(44)))));
    await expect(servico.emitirTesteHomologacao(tenant, null, null)).rejects.toThrow(/HOMOLOGAÇÃO/i);
    expect(chamarSefaz).not.toHaveBeenCalled();
    await pool.query(`update fiscal_config set ambiente = '2' where tenant_id = $1`, [tenant]);
  }, 60000);

  it('produção não reaproveita série já usada em homologação (os testes viram buraco na sequência)', async () => {
    await pool.query(`update fiscal_config set ambiente = '1' where tenant_id = $1`, [tenant]);
    await expect(
      db.transaction((tx: any) => (servico as any).reservarNumero(tx, tenant, unidade, true)),
    ).rejects.toThrow(/série 51 foi usada em homologação/i);
    await pool.query(`update fiscal_config set ambiente = '2' where tenant_id = $1`, [tenant]);
  }, 60000);

  it('com mais de uma loja, a nota de teste exige escolher em qual emitir', async () => {
    const outra = (
      await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Loja 2') returning id`, [tenant])
    ).rows[0].id;
    await expect(servico.emitirTesteHomologacao(tenant, null, null)).rejects.toThrow(/mais de uma loja/i);
    await pool.query('delete from unidade where id = $1', [outra]);
  }, 60000);

  it('a configuração da PRÓPRIA loja vence a da empresa quando existe', async () => {
    await pool.query(
      `insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente, serie, serie_nuvem, cnpj, razao_social)
       values ($1,$2,true,'2',60,61,$3,'Bar de Teste LTDA')`,
      [tenant, unidade, CNPJ],
    );
    const cfg: any = await (servico as any).configRaw(tenant, unidade);
    expect(cfg.serieNuvem).toBe(61);
    await pool.query(`delete from fiscal_config where tenant_id = $1 and unidade_id = $2`, [tenant, unidade]);
    // Sem a da loja, volta a valer a da empresa — é o que faz a venda achar a configuração.
    expect(((await (servico as any).configRaw(tenant, unidade)) as any).serieNuvem).toBe(51);
  }, 60000);
});
