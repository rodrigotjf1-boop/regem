import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import * as forge from 'node-forge';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { validateXML } from 'xmllint-wasm';
import { FiscalService } from './fiscal.service';
import { salvarCertificado } from './credencial';
import { assinarEvento, assinaturaValida } from './assinatura';
import { montarEventoCancelamento, PRAZO_CANCELAMENTO_MINUTOS } from './sefaz/evento-cancelamento';

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('./sefaz/soap', () => ({
  ...jest.requireActual('./sefaz/soap'),
  chamarSefaz: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chamarSefaz, SefazInalcancavel } = require('./sefaz/soap');

// CANCELAMENTO COMUM DA NFC-e (evento 110111) — a venda errada, a desistência, o item trocado.
//
// Até aqui a rota existia e o transmissor real RECUSAVA: toda nota autorizada ficava autorizada
// para sempre. O prazo é de 30 minutos da autorização (Ajuste SINIEF 19/16, cl. 15ª, teto
// nacional); fora dele a SEFAZ devolve 501. O leiaute é o oficial do pacote Evento_Canc_PL_v1.01
// (NT 2018.004): `descEvento` "Cancelamento", `nProt` e `xJust` — nada dos campos do 110112.

const CNPJ = '36219750000104';
const SENHA = 'Senha-Do-Certificado-9!';
const chaveDe = (n: number) => '33' + '2609' + CNPJ + '65' + '051' + String(n).padStart(9, '0') + '1' + '15528211' + '2';

function certificadoDeTeste() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  c.serialNumber = '01';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 86_400_000);
  c.setSubject([{ name: 'commonName', value: `BAR DE TESTE LTDA:${CNPJ}` }]);
  c.setIssuer([{ name: 'commonName', value: 'AC DE TESTE' }]);
  c.sign(forge.pki.privateKeyFromPem(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()), forge.md.sha256.create());
  return {
    certificadoPem: forge.pki.certificateToPem(c),
    chavePrivadaPem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
  };
}

const BASE = {
  ambiente: '2',
  codigoUf: 33,
  cnpj: CNPJ,
  chave: chaveDe(1),
  protocolo: '333260002547395',
  justificativa: 'Cliente desistiu da compra antes de retirar o pedido',
  dhEvento: '2026-09-24T12:10:00-03:00',
};

describe('o evento de cancelamento comum (110111)', () => {
  it('leva só descEvento, nProt e xJust — e VALIDA contra o schema oficial do pacote de cancelamento', async () => {
    const xml = assinarEvento(montarEventoCancelamento(BASE), certificadoDeTeste());
    expect(xml).toMatch(/<infEvento Id="ID110111\d{44}01">/);
    expect(xml).toContain('<detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>333260002547395</nProt>');
    // Os campos exclusivos do 110112 NÃO podem aparecer aqui.
    expect(xml).not.toContain('cOrgaoAutor');
    expect(xml).not.toContain('chNFeRef');
    expect(assinaturaValida(xml)).toBe(true);

    // O pacote de cancelamento tem o PRÓPRIO tiposBasico_v1.03 — diferente do pacote do 110112 —,
    // por isso mora numa pasta à parte e é validado com as dependências dele.
    const XSD = join(__dirname, 'xsd', 'evento-cancelamento');
    const arq = (n: string) => ({ fileName: n, contents: readFileSync(join(XSD, n), 'utf8') });
    const r = await validateXML({
      xml: [{ fileName: 'ev.xml', contents: xml }],
      schema: [arq('envEventoCancNFe_v1.00.xsd')],
      preload: ['leiauteEventoCancNFe_v1.00.xsd', 'eventoCancNFe_v1.00.xsd', 'e110111_v1.00.xsd', 'tiposBasico_v1.03.xsd', 'xmldsig-core-schema_v1.01.xsd'].map(arq),
    });
    expect({ valido: r.valid, erros: (r.errors ?? []).map((e: any) => e.message).join(' | ') }).toEqual({
      valido: true,
      erros: '',
    });
  }, 120000);

  it('recusa o que a SEFAZ recusaria, antes de enviar', () => {
    expect(() => montarEventoCancelamento({ ...BASE, justificativa: 'curta' })).toThrow(/15 a 255/);
    expect(() => montarEventoCancelamento({ ...BASE, protocolo: '123' })).toThrow(/Protocolo/i);
  });

  it('o prazo é o teto nacional de 30 minutos', () => {
    expect(PRAZO_CANCELAMENTO_MINUTOS).toBe(30);
  });
});

// ── Do banco ao evento ────────────────────────────────────────────────────────────────────
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cancelamento-comum.spec: parte contra o Postgres PULADA');

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
  return Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(k.privateKey, [c], SENHA, { algorithm: '3des' })).getBytes(), 'binary');
}

const retornoSefaz = (cStat: string, xMotivo: string, chave: string) =>
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
  '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/RecepcaoEvento4">' +
  `<retEnvEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>1</idLote>` +
  `<tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cOrgao>33</cOrgao><cStat>128</cStat>` +
  `<xMotivo>Lote de Evento Processado</xMotivo>` +
  `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cOrgao>33</cOrgao>` +
  `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><chNFe>${chave}</chNFe>` +
  `<tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento>` +
  `<dhRegEvento>2026-09-24T12:10:05-03:00</dhRegEvento>` +
  `${cStat === '135' ? '<nProt>333260009911224</nProt>' : ''}` +
  `</infEvento></retEvento></retEnvEvento>` +
  '</nfeResultMsg></soap:Body></soap:Envelope>';

descrever('o cancelamento comum, contra o Postgres', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const auditado: any[] = [];
  const servico = new FiscalService(db, { registrar: async (e: any) => void auditado.push(e) } as any);

  const chaveOriginal = process.env.SEGREDOS_CHAVE;
  let tenant = '';
  let unidade = '';
  let numero = 10;

  async function notaAutorizada(minutosAtras: number) {
    numero++;
    const r = await pool.query(
      `insert into nota_fiscal (tenant_id, unidade_id, modelo, serie, numero, ambiente, status,
         valor_total, chave, protocolo, emitida_em, created_at)
       values ($1,$2,'65',51,$3,'2','autorizada','10.00',$4,'333260002547395',
               now() - ($5 || ' minutes')::interval, now() - ($5 || ' minutes')::interval) returning *`,
      [tenant, unidade, numero, chaveDe(numero), String(minutosAtras)],
    );
    return r.rows[0];
  }
  const doBanco = (id: string) => pool.query('select * from nota_fiscal where id = $1', [id]).then((r) => r.rows[0]);
  const eventosDa = (id: string) =>
    pool.query('select * from fiscal_evento where nota_id = $1', [id]).then((r) => r.rows);

  beforeAll(async () => {
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste cancelamento comum') returning id`)).rows[0].id;
    unidade = (await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [tenant])).rows[0].id;
    await pool.query(
      `insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente, serie, serie_nuvem,
         cnpj, razao_social, ie, uf, codigo_uf, codigo_municipio, municipio, endereco, bairro, numero, cep,
         url_qrcode_homolog, url_chave_homolog)
       values ($1,null,true,'2',50,51,$2,'Bar de Teste LTDA','13047081','RJ',33,3304557,'Rio de Janeiro',
               'Rua A','Centro','100','21221240',
               'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode','www.fazenda.rj.gov.br/nfce/consulta')`,
      [tenant, CNPJ],
    );
    await salvarCertificado(db, tenant, null, { pfxBase64: pfxDeTeste().toString('base64'), senha: SENHA });
  }, 60000);

  afterAll(async () => {
    if (chaveOriginal === undefined) delete process.env.SEGREDOS_CHAVE;
    else process.env.SEGREDOS_CHAVE = chaveOriginal;
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  beforeEach(() => chamarSefaz.mockReset());

  it('dentro dos 30 minutos: a SEFAZ registra e a nota deixa de valer, com o comprovante guardado', async () => {
    const n = await notaAutorizada(5);
    chamarSefaz.mockResolvedValue(retornoSefaz('135', 'Evento registrado e vinculado a NF-e', n.chave));

    const r: any = await servico.cancelar(tenant, null as any, n.id, 'Cliente desistiu antes de retirar o pedido');
    expect(r.status).toBe('cancelada');

    const chamada = chamarSefaz.mock.calls[0][0];
    expect(chamada.servico).toBe('RecepcaoEvento4');
    expect(chamada.corpoXml).toContain('<tpEvento>110111</tpEvento>');
    expect(chamada.corpoXml).toContain('<nProt>333260002547395</nProt>');

    const nota = await doBanco(n.id);
    expect(nota.status).toBe('cancelada');
    expect(nota.justificativa_cancelamento).toBe('Cliente desistiu antes de retirar o pedido');
    const [ev] = await eventosDa(n.id);
    expect(ev).toMatchObject({ tp_evento: '110111', status: 'registrado' });
    expect(ev.xml).toContain('<procEventoNFe');
    expect(auditado.at(-1)).toMatchObject({ acao: 'cancelou_nfce' });
  }, 60000);

  it('fora dos 30 minutos: nem tenta — a SEFAZ devolveria 501', async () => {
    const n = await notaAutorizada(45);
    await expect(servico.cancelar(tenant, null as any, n.id, 'Cliente desistiu antes de retirar o pedido')).rejects.toThrow(
      /30 minutos/,
    );
    expect(chamarSefaz).not.toHaveBeenCalled();
    expect((await doBanco(n.id)).status).toBe('autorizada');
  }, 60000);

  it('rejeitado pela SEFAZ: a nota CONTINUA autorizada — nunca se cancela por otimismo', async () => {
    const n = await notaAutorizada(5);
    chamarSefaz.mockResolvedValue(retornoSefaz('501', 'Rejeicao: Prazo de cancelamento superior ao previsto na Legislacao', n.chave));

    await expect(servico.cancelar(tenant, null as any, n.id, 'Cliente desistiu antes de retirar o pedido')).rejects.toThrow(/501/);
    expect((await doBanco(n.id)).status).toBe('autorizada');
    const [ev] = await eventosDa(n.id);
    expect(ev.status).toBe('rejeitado');
  }, 60000);

  it('SEFAZ muda: não se sabe se cancelou — a nota fica como está e o aviso manda consultar', async () => {
    const n = await notaAutorizada(5);
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('timeout'));

    await expect(servico.cancelar(tenant, null as any, n.id, 'Cliente desistiu antes de retirar o pedido')).rejects.toThrow(
      /Consulte a nota/,
    );
    expect((await doBanco(n.id)).status).toBe('autorizada');
    const [ev] = await eventosDa(n.id);
    expect(ev.status).toBe('pendente'); // o evento saiu; a resposta não voltou
  }, 60000);

  it('justificativa curta é recusada antes de qualquer coisa', async () => {
    const n = await notaAutorizada(5);
    await expect(servico.cancelar(tenant, null as any, n.id, 'curta')).rejects.toThrow(/15 a 255/);
    expect(chamarSefaz).not.toHaveBeenCalled();
  }, 60000);
});
