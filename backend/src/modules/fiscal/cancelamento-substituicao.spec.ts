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
import { lerRetornoEvento, montarEventoCancSubst } from './sefaz/evento-cancelamento';

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('./sefaz/soap', () => ({
  ...jest.requireActual('./sefaz/soap'),
  chamarSefaz: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chamarSefaz } = require('./sefaz/soap');

// P20 — DUAS NOTAS PARA A MESMA VENDA (evento 110112).
//
// O caso que o MOC 7.0 (§3.5) descreve e que o nosso próprio fluxo cria: a primeira nota ficou
// sem resposta, a consulta disse "não consta", emitimos a segunda para o cliente — e a primeira
// aparece autorizada depois. A lei dá 168 horas para cancelar a que não acobertou a operação,
// REFERENCIANDO a que substituiu. Errar aqui é ficar com venda duplicada nos livros.

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
  chaveSubstituta: chaveDe(2),
  justificativa: 'NFC-e emitida em duplicidade - operacao acobertada pela nota substituta',
  dhEvento: '2026-09-23T00:20:00-03:00',
};

describe('o evento de cancelamento por substituição', () => {
  it('leva os campos exclusivos do 110112 e VALIDA contra o schema oficial', async () => {
    const xml = assinarEvento(montarEventoCancSubst(BASE), certificadoDeTeste());
    // Id = ID + tpEvento(6) + chave(44) + nSeq(2).
    expect(xml).toMatch(/<infEvento Id="ID110112\d{44}01">/);
    expect(xml).toContain('<descEvento>Cancelamento por substituicao</descEvento>'); // sem acento: valor fixo
    expect(xml).toContain('<tpAutor>1</tpAutor>'); // 1 = empresa emitente (rejeição 466 se não)
    expect(xml).toContain(`<cOrgaoAutor>33</cOrgaoAutor>`); // UF da chave (rejeição 455 se divergir)
    expect(xml).toContain(`<chNFeRef>${BASE.chaveSubstituta}</chNFeRef>`);
    expect(assinaturaValida(xml)).toBe(true);

    const XSD = join(__dirname, 'xsd');
    const arq = (n: string) => ({ fileName: n, contents: readFileSync(join(XSD, n), 'utf8') });
    const r = await validateXML({
      xml: [{ fileName: 'ev.xml', contents: xml }],
      schema: [arq('envEventoCancSubst_v1.00.xsd')],
      preload: ['leiauteEventoCancSubst_v1.00.xsd', 'tiposBasico_v1.03.xsd', 'xmldsig-core-schema_v1.01.xsd'].map(arq),
    });
    expect({ valido: r.valid, erros: (r.errors ?? []).map((e: any) => e.message).join(' | ') }).toEqual({
      valido: true,
      erros: '',
    });
  }, 120000);

  it('a assinatura é do infEvento, e fica DENTRO de <evento> (não na raiz do lote)', () => {
    const xml = assinarEvento(montarEventoCancSubst(BASE), certificadoDeTeste());
    expect(xml).toMatch(/<Reference URI="#ID110112\d{46}">/);
    expect(xml).toMatch(/<\/infEvento><Signature[\s\S]*<\/Signature><\/evento>/);
  });

  it('recusa o que a SEFAZ recusaria, antes de enviar', () => {
    expect(() => montarEventoCancSubst({ ...BASE, justificativa: 'curta' })).toThrow(/15 a 255/);
    expect(() => montarEventoCancSubst({ ...BASE, chaveSubstituta: '123' })).toThrow(/substituta inv/i);
    // A substituta não pode ser a própria nota: seria a nota referenciando a si mesma.
    expect(() => montarEventoCancSubst({ ...BASE, chaveSubstituta: BASE.chave })).toThrow(/não pode ser a própria/i);
    expect(() => montarEventoCancSubst({ ...BASE, protocolo: '123' })).toThrow(/Protocolo/i);
  });

  const ret = (cStat: string, xMotivo: string) =>
    `<retEnvEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>1</idLote>` +
    `<tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cOrgao>33</cOrgao><cStat>128</cStat>` +
    `<xMotivo>Lote de Evento Processado</xMotivo>` +
    `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cOrgao>33</cOrgao>` +
    `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><chNFe>${BASE.chave}</chNFe>` +
    `<tpEvento>110112</tpEvento><xEvento>Cancelamento por substituicao</xEvento><nSeqEvento>1</nSeqEvento>` +
    `<dhRegEvento>2026-09-23T00:20:05-03:00</dhRegEvento>` +
    `${cStat === '135' || cStat === '155' ? '<nProt>333260009911223</nProt>' : ''}` +
    `</infEvento></retEvento></retEnvEvento>`;

  it('135 (e 155, fora de prazo aceito pela UF) = REGISTRADO, com comprovante', () => {
    const assinado = assinarEvento(montarEventoCancSubst(BASE), certificadoDeTeste());
    const r: any = lerRetornoEvento(ret('135', 'Evento registrado e vinculado a NF-e'), assinado);
    expect(r).toMatchObject({ situacao: 'registrado', protocolo: '333260009911223' });
    expect(r.procEventoNFe).toContain('<procEventoNFe');
    expect(r.procEventoNFe).toContain('<retEvento');
    expect(lerRetornoEvento(ret('155', 'Cancelamento homologado fora de prazo'), assinado).situacao).toBe('registrado');
  });

  it.each([
    ['501', 'Prazo de cancelamento superior ao previsto na Legislacao'],
    ['573', 'Rejeicao: Duplicidade de evento'],
    ['136', 'Evento registrado, mas nao vinculado a NF-e'],
  ])('%s NÃO é cancelamento — a nota continua valendo', (cStat, xMotivo) => {
    const assinado = assinarEvento(montarEventoCancSubst(BASE), certificadoDeTeste());
    expect(lerRetornoEvento(ret(cStat, xMotivo), assinado)).toMatchObject({ situacao: 'rejeitado', cStat });
  });
});

// ── Do banco ao evento ────────────────────────────────────────────────────────────────────
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cancelamento-substituicao.spec: parte contra o Postgres PULADA');

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

const soapEvento = (miolo: string) =>
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
  '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/RecepcaoEvento4">' + miolo +
  '</nfeResultMsg></soap:Body></soap:Envelope>';

descrever('a venda com duas notas, contra o Postgres', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const auditado: any[] = [];
  const servico = new FiscalService(db, { registrar: async (e: any) => void auditado.push(e) } as any);

  const chaveOriginal = process.env.SEGREDOS_CHAVE;
  let tenant = '';
  let unidade = '';
  let comanda = '';
  let notaAntiga: any;
  let notaNova: any;

  const retornoSefaz = (cStat: string, xMotivo: string, chave: string) =>
    soapEvento(
      `<retEnvEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>1</idLote>` +
        `<tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cOrgao>33</cOrgao><cStat>128</cStat>` +
        `<xMotivo>Lote de Evento Processado</xMotivo>` +
        `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cOrgao>33</cOrgao>` +
        `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><chNFe>${chave}</chNFe>` +
        `<tpEvento>110112</tpEvento><nSeqEvento>1</nSeqEvento>` +
        `<dhRegEvento>2026-09-23T00:20:05-03:00</dhRegEvento>` +
        `${cStat === '135' ? '<nProt>333260009911223</nProt>' : ''}` +
        `</infEvento></retEvento></retEnvEvento>`,
    );

  beforeAll(async () => {
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste cancel subst') returning id`)).rows[0].id;
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
    comanda = (
      await pool.query(`insert into comanda (tenant_id, unidade_id, status) values ($1,$2,'fechada') returning id`, [tenant, unidade])
    ).rows[0].id;

    // A nota 1 ficou sem resposta e apareceu autorizada DEPOIS; a 2 foi a que o cliente levou.
    notaAntiga = (
      await pool.query(
        `insert into nota_fiscal (tenant_id, unidade_id, comanda_id, modelo, serie, numero, ambiente, status,
           valor_total, chave, protocolo, emitida_em, created_at)
         values ($1,$2,$3,'65',51,1,'2','autorizada','10.00',$4,'333260002547395', now() - interval '2 hours', now() - interval '2 hours')
         returning *`,
        [tenant, unidade, comanda, chaveDe(1)],
      )
    ).rows[0];
    notaNova = (
      await pool.query(
        `insert into nota_fiscal (tenant_id, unidade_id, comanda_id, modelo, serie, numero, ambiente, status,
           valor_total, chave, protocolo, emitida_em, created_at)
         values ($1,$2,$3,'65',51,2,'2','autorizada','10.00',$4,'333260002547396', now() - interval '1 hour', now() - interval '1 hour')
         returning *`,
        [tenant, unidade, comanda, chaveDe(2)],
      )
    ).rows[0];
  }, 60000);

  afterAll(async () => {
    if (chaveOriginal === undefined) delete process.env.SEGREDOS_CHAVE;
    else process.env.SEGREDOS_CHAVE = chaveOriginal;
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  beforeEach(() => chamarSefaz.mockReset());

  it('enxerga a duplicidade, aponta a ANTIGA como a que se cancela e diz quanto resta do prazo', async () => {
    const r: any = await servico.duplicidades(tenant, unidade);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: notaAntiga.id, numero: 1, substitutaId: notaNova.id, substitutaNumero: 2 });
    expect(Number(r[0].horasRestantes)).toBeGreaterThan(165); // 168 h menos as 2 já passadas
  }, 60000);

  it('cancela a duplicada referenciando a substituta, e a nota deixa de valer', async () => {
    chamarSefaz.mockResolvedValue(retornoSefaz('135', 'Evento registrado e vinculado a NF-e', notaAntiga.chave));
    const r: any = await servico.cancelarPorSubstituicao(tenant, null, notaAntiga.id);
    expect(r).toMatchObject({ status: 'registrado', protocolo: '333260009911223', substituta: notaNova.chave });

    const chamada = chamarSefaz.mock.calls[0][0];
    expect(chamada.servico).toBe('RecepcaoEvento4');
    expect(chamada.corpoXml).toContain(`<chNFe>${notaAntiga.chave}</chNFe>`);
    expect(chamada.corpoXml).toContain(`<chNFeRef>${notaNova.chave}</chNFeRef>`);
    expect(chamada.corpoXml).toContain('<nProt>333260002547395</nProt>'); // protocolo da nota cancelada

    const nota = (await pool.query('select * from nota_fiscal where id = $1', [notaAntiga.id])).rows[0];
    expect(nota.status).toBe('cancelada');
    expect(nota.cancelada_em).not.toBeNull();
    const ev = (await pool.query('select * from fiscal_evento where tenant_id = $1', [tenant])).rows[0];
    expect(ev.status).toBe('registrado');
    expect(ev.xml).toContain('<procEventoNFe');
    expect(auditado.at(-1)).toMatchObject({ acao: 'cancelou_por_substituicao' });

    // Resolvida, a duplicidade sai da lista.
    expect(await servico.duplicidades(tenant, unidade)).toHaveLength(0);
  }, 60000);

  it('nota sem outra da mesma venda não pode ser cancelada por substituição', async () => {
    const outra = (
      await pool.query(
        `insert into comanda (tenant_id, unidade_id, status) values ($1,$2,'fechada') returning id`,
        [tenant, unidade],
      )
    ).rows[0].id;
    const sozinha = (
      await pool.query(
        `insert into nota_fiscal (tenant_id, unidade_id, comanda_id, modelo, serie, numero, ambiente, status,
           valor_total, chave, protocolo, emitida_em)
         values ($1,$2,$3,'65',51,3,'2','autorizada','10.00',$4,'333260002547397', now()) returning *`,
        [tenant, unidade, outra, chaveDe(3)],
      )
    ).rows[0];
    await expect(servico.cancelarPorSubstituicao(tenant, null, sozinha.id)).rejects.toThrow(/substituta/i);
    expect(chamarSefaz).not.toHaveBeenCalled();
  }, 60000);

  it('fora das 168 horas, nem tenta: a SEFAZ recusaria e a explicação seria pior', async () => {
    const c2 = (
      await pool.query(`insert into comanda (tenant_id, unidade_id, status) values ($1,$2,'fechada') returning id`, [tenant, unidade])
    ).rows[0].id;
    const velha = (
      await pool.query(
        `insert into nota_fiscal (tenant_id, unidade_id, comanda_id, modelo, serie, numero, ambiente, status,
           valor_total, chave, protocolo, emitida_em, created_at)
         values ($1,$2,$3,'65',51,4,'2','autorizada','10.00',$4,'333260002547398',
                 now() - interval '200 hours', now() - interval '200 hours') returning *`,
        [tenant, unidade, c2, chaveDe(4)],
      )
    ).rows[0];
    await pool.query(
      `insert into nota_fiscal (tenant_id, unidade_id, comanda_id, modelo, serie, numero, ambiente, status,
         valor_total, chave, protocolo, emitida_em, created_at)
       values ($1,$2,$3,'65',51,5,'2','autorizada','10.00',$4,'333260002547399',
               now() - interval '199 hours', now() - interval '199 hours')`,
      [tenant, unidade, c2, chaveDe(5)],
    );
    await expect(servico.cancelarPorSubstituicao(tenant, null, velha.id)).rejects.toThrow(/168 horas/);
    expect(chamarSefaz).not.toHaveBeenCalled();
  }, 60000);
});
