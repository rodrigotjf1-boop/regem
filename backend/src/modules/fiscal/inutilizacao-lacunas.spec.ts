import { randomBytes } from 'node:crypto';
import * as forge from 'node-forge';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { FiscalService } from './fiscal.service';
import { salvarCertificado } from './credencial';
import { SefazInalcancavel } from './sefaz/soap';

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('./sefaz/soap', () => ({
  ...jest.requireActual('./sefaz/soap'),
  chamarSefaz: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chamarSefaz } = require('./sefaz/soap');

// P19 — O NÚMERO QUE NÃO VIROU NOTA, do banco ao pedido de inutilização.
//
// Número reservado e não autorizado deixa buraco na sequência, e o Ajuste SINIEF 19/16 (cl. 16ª)
// manda pedir a inutilização até o 10º dia do mês seguinte — a cl. 11ª, §5º presume venda sem
// nota em quem não pede. Reaproveitar não é opção: o MOC 7.0 (Anexo III, nota 2) veda manter o
// número de nota "normalmente emitida" cujo resultado não se conseguiu confirmar.
//
// O que estes testes protegem: a lacuna ser identificada corretamente (nem de menos, nem de
// mais) e o pedido NUNCA engolir um número que tem documento — inutilização não volta atrás.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('inutilizacao-lacunas.spec: sem TEST_PG_URL — PULADO');

const CNPJ = '36219750000104';
const SENHA = 'Senha-Do-Certificado-9!';
const chaveDe = (n: number) => '33' + '2609' + CNPJ + '65' + '051' + String(n).padStart(9, '0') + '1' + '15528211' + '2';

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

const soap = (miolo: string) =>
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
  '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4">' + miolo +
  '</nfeResultMsg></soap:Body></soap:Envelope>';
const retInut = (cStat: string, xMotivo: string) =>
  `<retInutNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><infInut><tpAmb>2</tpAmb>` +
  `<verAplic>SVRS</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>33</cUF>` +
  `<dhRecbto>2026-09-22T23:10:00-03:00</dhRecbto>${cStat === '102' ? '<nProt>333260009988776</nProt>' : ''}` +
  `</infInut></retInutNFe>`;

descrever('lacunas de numeração e inutilização, contra o Postgres', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const auditado: any[] = [];
  const servico = new FiscalService(db, { registrar: async (e: any) => void auditado.push(e) } as any);

  const chaveOriginal = process.env.SEGREDOS_CHAVE;
  const edgeOriginal = process.env.EDGE_MODE;
  let tenant = '';
  let unidade = '';

  const nota = (numero: number, status: string, serie = 51) =>
    pool.query(
      `insert into nota_fiscal (tenant_id, unidade_id, modelo, serie, numero, ambiente, status, valor_total, chave)
       values ($1,$2,'65',$3,$4,'2',$5,'1.00',$6)`,
      [tenant, unidade, serie, numero, status, chaveDe(numero)],
    );

  beforeAll(async () => {
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    delete process.env.EDGE_MODE;
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste inutilizacao') returning id`)).rows[0].id;
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

    // A sequência da loja: 1 e 2 autorizadas, 3 e 4 rejeitadas (buraco), 5 pendente (situação
    // ainda desconhecida), 6 autorizada. O buraco a inutilizar é exatamente 3–4.
    await nota(1, 'autorizada');
    await nota(2, 'autorizada');
    await nota(3, 'rejeitada');
    await nota(4, 'rejeitada');
    await nota(5, 'pendente');
    await nota(6, 'autorizada');
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

  it('acha o buraco — e NÃO conta a pendente, cuja situação ainda não se conhece', async () => {
    const r: any = await servico.lacunas(tenant, unidade);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ serie: 51, total: 2 });
    expect(r[0].faixas).toEqual([{ inicio: 3, fim: 4, quantidade: 2 }]);
  }, 60000);

  it('números soltos viram faixas separadas (um pedido por faixa, não um por número)', async () => {
    await nota(8, 'rejeitada');
    await nota(9, 'autorizada');
    const r: any = await servico.lacunas(tenant, unidade);
    // 7 nunca existiu (buraco entre 6 e 8) e 8 foi rejeitada: faixa 7–8. A 3–4 continua.
    expect(r[0].faixas).toEqual([
      { inicio: 3, fim: 4, quantidade: 2 },
      { inicio: 7, fim: 8, quantidade: 2 },
    ]);
  }, 60000);

  it('recusa faixa que tem nota ocupando o número — inutilização não volta atrás', async () => {
    await expect(
      servico.inutilizarFaixa(tenant, null, { serie: 51, numeroInicial: 3, numeroFinal: 6, justificativa: 'Faixa com nota autorizada dentro' }),
    ).rejects.toThrow(/ocupa o n[úu]mero/i);
    expect(chamarSefaz).not.toHaveBeenCalled();
  }, 60000);

  it('recusa justificativa curta e faixa invertida antes de falar com a SEFAZ', async () => {
    await expect(
      servico.inutilizarFaixa(tenant, null, { serie: 51, numeroInicial: 3, numeroFinal: 4, justificativa: 'curta' }),
    ).rejects.toThrow(/15 caracteres/);
    await expect(
      servico.inutilizarFaixa(tenant, null, { serie: 51, numeroInicial: 4, numeroFinal: 3, justificativa: 'Justificativa suficientemente longa' }),
    ).rejects.toThrow(/Faixa inv[áa]lida/i);
    expect(chamarSefaz).not.toHaveBeenCalled();
  }, 60000);

  it('homologada: guarda protocolo e comprovante, e a lacuna some da lista', async () => {
    chamarSefaz.mockResolvedValue(soap(retInut('102', 'Inutilizacao de numero homologado')));
    const r: any = await servico.inutilizarFaixa(tenant, null, {
      serie: 51, numeroInicial: 3, numeroFinal: 4,
      justificativa: 'Numeracao sem nota autorizada - quebra de sequencia',
    });
    expect(r).toMatchObject({ status: 'homologada', protocolo: '333260009988776', serie: 51 });
    expect(r.xml).toContain('<ProcInutNFe');

    // O pedido saiu assinado, no serviço certo e com a faixa pedida.
    const chamada = chamarSefaz.mock.calls[0][0];
    expect(chamada.servico).toBe('NFeInutilizacao4');
    expect(chamada.corpoXml).toContain('<xServ>INUTILIZAR</xServ>');
    expect(chamada.corpoXml).toContain('<nNFIni>3</nNFIni><nNFFin>4</nNFFin>');
    expect(chamada.corpoXml).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');

    const depois: any = await servico.lacunas(tenant, unidade);
    expect(depois[0].faixas).toEqual([{ inicio: 7, fim: 8, quantidade: 2 }]);
    expect(auditado.at(-1)).toMatchObject({ acao: 'inutilizou_numeracao' });
  }, 60000);

  it('não repete pedido da mesma faixa (a SEFAZ devolveria 563)', async () => {
    chamarSefaz.mockResolvedValue(soap(retInut('102', 'Inutilizacao de numero homologado')));
    await expect(
      servico.inutilizarFaixa(tenant, null, { serie: 51, numeroInicial: 3, numeroFinal: 4, justificativa: 'Tentando de novo a mesma faixa' }),
    ).rejects.toThrow(/j[áa] tem pedido/i);
    expect(chamarSefaz).not.toHaveBeenCalled();
  }, 60000);

  it('rejeitada pela SEFAZ: fica registrada como rejeitada e a lacuna CONTINUA aberta', async () => {
    chamarSefaz.mockResolvedValue(soap(retInut('241', 'Rejeicao: Um numero da faixa ja foi utilizado')));
    await expect(
      servico.inutilizarFaixa(tenant, null, { serie: 51, numeroInicial: 7, numeroFinal: 8, justificativa: 'Numeracao sem nota - tentativa' }),
    ).rejects.toThrow(/241/);
    const depois: any = await servico.lacunas(tenant, unidade);
    expect(depois[0].faixas).toEqual([{ inicio: 7, fim: 8, quantidade: 2 }]);
  }, 60000);

  it('sem resposta da SEFAZ: NÃO vira rejeitada (ela pode ter homologado) e barra pedido novo', async () => {
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('Tempo esgotado ao falar com a SEFAZ.'));
    await expect(
      servico.inutilizarFaixa(tenant, null, { serie: 51, numeroInicial: 7, numeroFinal: 8, justificativa: 'Numeracao sem nota - sem resposta' }),
    ).rejects.toThrow(/Tempo esgotado/);

    const linha = (
      await pool.query(
        `select status, motivo from fiscal_inutilizacao
          where tenant_id = $1 and numero_inicial = 7 order by created_at desc limit 1`,
        [tenant],
      )
    ).rows[0];
    expect(linha.status).toBe('pendente');
    expect(linha.motivo).toMatch(/situação desconhecida/i);

    chamarSefaz.mockResolvedValue(soap(retInut('102', 'Inutilizacao de numero homologado')));
    await expect(
      servico.inutilizarFaixa(tenant, null, { serie: 51, numeroInicial: 7, numeroFinal: 8, justificativa: 'Mesma faixa depois do timeout' }),
    ).rejects.toThrow(/j[áa] tem pedido/i);
  }, 60000);

  describe('o limite de consultas da SEFAZ (rejeição 656)', () => {
    it('o botão respeita o mesmo recuo do job — clicar sem parar bloquearia a empresa inteira', async () => {
      const pend = (
        await pool.query(
          `insert into nota_fiscal (tenant_id, unidade_id, modelo, serie, numero, ambiente, status, valor_total, chave, xml, created_at)
           values ($1,$2,'65',51,90,'2','pendente','1.00',$3,'<NFe/>', now() - interval '10 minutes') returning *`,
          [tenant, unidade, chaveDe(90)],
        )
      ).rows[0];
      chamarSefaz.mockResolvedValue(
        '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">' +
          '<retConsSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><cStat>999</cStat><xMotivo>Erro nao catalogado</xMotivo></retConsSitNFe>' +
          '</nfeResultMsg></soap:Body></soap:Envelope>',
      );
      await servico.consultarNota(tenant, pend.id, null); // 1ª: passa
      await expect(servico.consultarNota(tenant, pend.id, null)).rejects.toThrow(/656/);
      expect(chamarSefaz).toHaveBeenCalledTimes(1);
    }, 60000);
  });
});
