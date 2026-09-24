import { randomBytes } from 'node:crypto';
import * as forge from 'node-forge';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { FiscalService } from './fiscal.service';
import { salvarCertificado } from './credencial';

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('./sefaz/soap', () => ({
  ...jest.requireActual('./sefaz/soap'),
  chamarSefaz: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chamarSefaz } = require('./sefaz/soap');

// PARTE 2 — cada estabelecimento escolhe, e a escolha chega de verdade à nota.
//
//  • TERMINAL QUE NÃO EMITE (mig 288): numa troca de sistema, um caixa emite pelo sistema antigo
//    e outro pelo novo. O terminal marcado como "não emite" vende com o comprovante não fiscal,
//    e a mesma venda não sai com duas notas. Quem decide é presidente ou gerência — e fica na
//    auditoria com o antes e o depois.
//  • TAXA DE SERVIÇO: sem a escolha da loja, a nota de comanda com taxa é recusada (é decisão
//    do contador); com a escolha, a taxa vira linha e o total da nota bate com o que o cliente
//    pagou.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('terminal-fiscal.spec: sem TEST_PG_URL — PULADO');

const CNPJ = '12345678000195';
const SENHA = 'Senha-Do-Certificado-9!';

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
  return Buffer.from(
    forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(k.privateKey, [c], SENHA, { algorithm: '3des' })).getBytes(),
    'binary',
  );
}

const autorizada = (chave: string) =>
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
  '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">' +
  '<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>' +
  '<verAplic>SVRS</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>33</cUF>' +
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${chave}</chNFe>` +
  '<dhRecbto>2026-09-24T10:00:00-03:00</dhRecbto><nProt>333260002547395</nProt>' +
  '<digVal>abc=</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>' +
  '</retEnviNFe></nfeResultMsg></soap:Body></soap:Envelope>';

descrever('o que cada estabelecimento escolhe chega à nota', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const auditado: any[] = [];
  const servico = new FiscalService(db, { registrar: async (e: any) => void auditado.push(e) } as any);

  const chaveOriginal = process.env.SEGREDOS_CHAVE;
  const edgeOriginal = process.env.EDGE_MODE;
  let tenant = '';
  let unidade = '';
  let produto = '';
  let pdv = '';

  async function comanda(taxaPct = 0): Promise<string> {
    const c = await pool.query(
      `insert into comanda (tenant_id, unidade_id, status, forma, taxa_servico_pct)
       values ($1,$2,'fechada','dinheiro',$3) returning id`,
      [tenant, unidade, String(taxaPct)],
    );
    await pool.query(
      `insert into comanda_item (tenant_id, comanda_id, produto_id, descricao, quantidade, preco_unitario)
       values ($1,$2,$3,'Prato executivo',2,'32.90')`,
      [tenant, c.rows[0].id, produto],
    );
    return c.rows[0].id;
  }
  const notasDa = (comandaId: string) =>
    pool.query('select * from nota_fiscal where comanda_id = $1', [comandaId]).then((r) => r.rows);

  beforeAll(async () => {
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    delete process.env.EDGE_MODE;
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste terminal fiscal') returning id`)).rows[0].id;
    unidade = (await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [tenant])).rows[0].id;
    produto = (
      await pool.query(
        `insert into produto (tenant_id, nome, ncm, cfop, csosn, origem, unidade_trib)
         values ($1,'Prato executivo','00000000','5101','102','0','UN') returning id`,
        [tenant],
      )
    ).rows[0].id;
    pdv = (
      await pool.query(
        `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo)
         values ($1,$2,'Caixa 2','pdv',$3,true) returning id`,
        [tenant, unidade, randomBytes(8).toString('hex')],
      )
    ).rows[0].id;
    await pool.query(
      `insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente, serie, serie_nuvem,
         cnpj, razao_social, ie, uf, codigo_uf, codigo_municipio, municipio, endereco, bairro, numero, cep,
         url_qrcode_homolog, url_chave_homolog)
       values ($1,null,true,'2',70,71,$2,'Bar de Teste LTDA','13047081','RJ',33,3304557,'Rio de Janeiro',
               'Rua A','Centro','100','21221240',
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
  });

  beforeEach(() => {
    chamarSefaz.mockReset();
    chamarSefaz.mockImplementation(async (p: any) => autorizada(p.corpoXml.match(/Id="NFe(\d{44})"/)![1]));
  });

  it('terminal marcado para NÃO emitir: a venda passa sem nota, e a SEFAZ nem é chamada', async () => {
    await servico.definirTerminalFiscal(tenant, null, 'gerente', pdv, false);
    const c = await comanda();
    const nota = await servico.emitirSeAtivo(tenant, null, c, unidade, { terminalId: pdv });
    expect(nota).toBeNull();
    expect(await notasDa(c)).toHaveLength(0);
    expect(chamarSefaz).not.toHaveBeenCalled();
  }, 60000);

  it('a mudança fica auditada com quem, o antes e o depois', async () => {
    const reg = auditado.filter((a) => a.entidadeId === pdv).at(-1);
    expect(reg).toMatchObject({ acao: 'terminal_deixou_de_emitir_nfce', atorPerfil: 'gerente' });
    expect(reg.detalhe).toMatchObject({ nome: 'Caixa 2', antes: null, depois: false });
  }, 60000);

  it('o mesmo terminal liberado de novo passa a emitir', async () => {
    await servico.definirTerminalFiscal(tenant, null, 'presidente', pdv, true);
    const c = await comanda();
    const nota: any = await servico.emitirSeAtivo(tenant, null, c, unidade, { terminalId: pdv });
    expect(nota?.status).toBe('autorizada');
  }, 60000);

  it('a lista de terminais mostra o que cada um faz', async () => {
    const lista = await servico.listarTerminaisFiscais(tenant, unidade);
    expect(lista.find((t: any) => t.id === pdv)).toMatchObject({ nome: 'Caixa 2', tipo: 'pdv', emiteNfce: true });
  }, 60000);

  it('comanda com taxa de serviço e SEM a escolha da loja: a nota é recusada com o caminho', async () => {
    const c = await comanda(10);
    await expect(servico.emitir(tenant, null, c)).rejects.toThrow(/Taxa de serviço/);
    expect(chamarSefaz).not.toHaveBeenCalled();
  }, 60000);

  it('com "linha tributada" (Simples): a taxa entra na nota e o total bate com o que foi cobrado', async () => {
    await pool.query(`update fiscal_config set taxa_servico_nfce = 'item_tributado' where tenant_id = $1`, [tenant]);
    const c = await comanda(10); // 2 × 32,90 = 65,80 → cobrado round2(65,80 × 1,10) = 72,38
    const nota: any = await servico.emitir(tenant, null, c);
    expect(nota.status).toBe('autorizada');
    expect(nota.xml).toContain('<xProd>Taxa de servico 10%</xProd>');
    expect(nota.xml).toContain('<vNF>72.38</vNF>');
    expect(Number(nota.valorTotal ?? nota.valor_total)).toBe(72.38);
  }, 60000);

  it('com "fora da nota": a NFC-e fica só com os itens', async () => {
    await pool.query(`update fiscal_config set taxa_servico_nfce = 'fora_da_nota' where tenant_id = $1`, [tenant]);
    const c = await comanda(10);
    const nota: any = await servico.emitir(tenant, null, c);
    expect(nota.xml).not.toContain('Taxa de servico');
    expect(nota.xml).toContain('<vNF>65.80</vNF>');
  }, 60000);
});
