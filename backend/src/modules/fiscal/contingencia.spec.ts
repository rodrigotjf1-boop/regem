import { randomBytes } from 'node:crypto';
import * as forge from 'node-forge';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { FiscalService } from './fiscal.service';
import { salvarCertificado } from './credencial';
import {
  JUSTIFICATIVA_PADRAO,
  horasAteOPrazo,
  justificativaValida,
  prazoTransmissao,
  prazoVencido,
  silencioDaSefaz,
} from './contingencia';

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('./sefaz/soap', () => ({
  ...jest.requireActual('./sefaz/soap'),
  chamarSefaz: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chamarSefaz, SefazInalcancavel } = require('./sefaz/soap');

// CONTINGÊNCIA OFF-LINE — do silêncio da SEFAZ ao cupom na mão do cliente.
//
// O que se prova aqui é o comportamento que a loja vê: a SEFAZ para de responder, a venda NÃO
// trava, sai um cupom válido (assinado, com QR próprio de contingência), e a nota entra numa
// fila que se esvazia sozinha quando a SEFAZ volta.
//
// As três regras que mais custam caro se forem quebradas:
//  1. entra por SILÊNCIO, nunca por rejeição (rejeição é a SEFAZ dizendo não);
//  2. o número da nota que ficou pendente NÃO é reaproveitado (cl. 11ª, §2º, I);
//  3. número emitido em contingência NÃO se inutiliza (§2º, II) — rejeição na transmissão
//     mantém a nota na fila, para ser corrigida e reenviada com a MESMA numeração.

describe('prazo de transmissão da contingência', () => {
  // Fim do PRIMEIRO DIA ÚTIL SUBSEQUENTE (Ajuste 19/16, cl. 11ª, §1º, II, "a"). Não são 24 h —
  // o título de uma pergunta do manual do RJ ficou velho dizendo isso.
  it('emitida numa quarta: vence no fim da quinta', () => {
    const p = prazoTransmissao(new Date('2026-09-23T14:00:00Z')); // quarta
    expect(p.toISOString().slice(0, 10)).toBe('2026-09-24');
    expect(p.getUTCHours()).toBe(23);
  });

  it('emitida na SEXTA: pula o fim de semana e vence na segunda', () => {
    expect(prazoTransmissao(new Date('2026-09-25T20:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-28');
  });

  it('emitida no SÁBADO ou no DOMINGO: vence na segunda', () => {
    expect(prazoTransmissao(new Date('2026-09-26T10:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(prazoTransmissao(new Date('2026-09-27T10:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-28');
  });

  it('diz quantas horas faltam e quando já venceu', () => {
    const emissao = new Date('2026-09-23T12:00:00Z');
    expect(horasAteOPrazo(emissao, new Date('2026-09-23T12:00:00Z'))).toBeGreaterThan(30);
    expect(prazoVencido(emissao, new Date('2026-09-24T22:00:00Z'))).toBe(false);
    expect(prazoVencido(emissao, new Date('2026-09-25T00:30:00Z'))).toBe(true);
  });
});

describe('justificativa da entrada (xJust)', () => {
  it('texto curto demais cai no padrão — menos de 15 caracteres é rejeição 557', () => {
    expect(justificativaValida('caiu')).toBe(JUSTIFICATIVA_PADRAO);
    expect(justificativaValida('')).toBe(JUSTIFICATIVA_PADRAO);
    expect(justificativaValida(null)).toBe(JUSTIFICATIVA_PADRAO);
    expect(JUSTIFICATIVA_PADRAO.length).toBeGreaterThanOrEqual(15);
  });

  it('texto próprio é mantido, aparado e limitado a 256', () => {
    expect(justificativaValida('  Queda   de energia no provedor  ')).toBe('Queda de energia no provedor');
    expect(justificativaValida('x'.repeat(400))).toHaveLength(256);
  });
});

describe('o gatilho é o silêncio, não a rejeição', () => {
  // Rejeição significa que a SEFAZ RESPONDEU, e respondeu não — inclusive quando o problema é a
  // loja (781). No RJ, documento emitido com IE irregular é inidôneo INCLUSIVE em contingência.
  it('só a nota pendente autoriza entrar em contingência', () => {
    expect(silencioDaSefaz('pendente')).toBe(true);
    expect(silencioDaSefaz('rejeitada')).toBe(false);
    expect(silencioDaSefaz('denegada')).toBe(false);
    expect(silencioDaSefaz('autorizada')).toBe(false);
    expect(silencioDaSefaz(null)).toBe(false);
  });
});

// ===== Contra o Postgres de verdade =====

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('contingencia.spec: sem TEST_PG_URL — a parte de banco foi PULADA');

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

const soap = (miolo: string, servico: string) =>
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
  `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}">` +
  miolo +
  '</nfeResultMsg></soap:Body></soap:Envelope>';

const RET_STATUS_OK = soap(
  '<retConsStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>' +
    '<verAplic>SVRS</verAplic><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo><cUF>33</cUF>' +
    '<dhRecbto>2026-09-23T10:00:00-03:00</dhRecbto><tMed>1</tMed></retConsStatServ>',
  'NFeStatusServico4',
);

const retAutorizacao = (cStat: string, xMotivo: string, chave: string) =>
  soap(
    '<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>' +
      '<verAplic>SVRS</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>33</cUF>' +
      `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${chave}</chNFe>` +
      `<dhRecbto>2026-09-23T10:00:00-03:00</dhRecbto>${cStat === '100' ? '<nProt>333260002547395</nProt>' : ''}` +
      `<digVal>abc=</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>` +
      '</retEnviNFe>',
    'NFeAutorizacao4',
  );

descrever('a venda não trava quando a SEFAZ fica muda', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const servico = new FiscalService(db, { registrar: async () => {} } as any);

  const chaveOriginal = process.env.SEGREDOS_CHAVE;
  const edgeOriginal = process.env.EDGE_MODE;
  let tenant = '';
  let unidade = '';
  let produto = '';

  async function venda(): Promise<string> {
    const c = await pool.query(
      `insert into comanda (tenant_id, unidade_id, status, forma, total) values ($1,$2,'fechada','dinheiro','10.00') returning id`,
      [tenant, unidade],
    );
    await pool.query(
      `insert into comanda_item (tenant_id, comanda_id, produto_id, descricao, quantidade, preco_unitario)
       values ($1,$2,$3,'Prato de teste',1,'10.00')`,
      [tenant, c.rows[0].id, produto],
    );
    return c.rows[0].id;
  }

  const notasDa = (comandaId: string) =>
    pool.query('select * from nota_fiscal where comanda_id = $1 order by numero', [comandaId]).then((r) => r.rows);
  const estado = () =>
    pool.query('select * from fiscal_contingencia where tenant_id = $1', [tenant]).then((r) => r.rows[0]);

  beforeAll(async () => {
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    delete process.env.EDGE_MODE; // esta instalação é a NUVEM
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste contingencia') returning id`)).rows[0].id;
    unidade = (await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [tenant])).rows[0].id;
    produto = (
      await pool.query(
        `insert into produto (tenant_id, nome, ncm, cfop, csosn, origem, unidade_trib)
         values ($1,'Prato de teste','21069090','5102','102','0','UN') returning id`,
        [tenant],
      )
    ).rows[0].id;
    await pool.query(
      `insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente, serie, serie_nuvem,
         cnpj, razao_social, ie, uf, codigo_uf, codigo_municipio, municipio, endereco, bairro, numero, cep,
         url_qrcode_homolog, url_chave_homolog)
       values ($1,null,true,'2',60,61,$2,'Bar de Teste LTDA','13047081','RJ',33,3304557,'Rio de Janeiro',
               'Rua A','Centro','100','21221240',
               'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode','www.fazenda.rj.gov.br/nfce/consulta')`,
      [tenant, CNPJ],
    );
    // Uma impressora de cupom na loja: sem ela a DANFE não é enfileirada e os testes de via
    // passariam por engano (nenhuma via é "nenhuma via a mais").
    await pool.query(
      `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo, faz_cupom, padrao)
       values ($1,$2,'Caixa 1','impressora',$3,true,true,true)`,
      [tenant, unidade, randomBytes(8).toString('hex')],
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

  it('SEFAZ muda: a nota fica pendente, a venda sai em contingência com número NOVO', async () => {
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('timeout de 30s'));
    const comanda = await venda();

    const nota: any = await servico.emitir(tenant, null, comanda);
    expect(nota.status).toBe('contingencia');

    const todas = await notasDa(comanda);
    expect(todas).toHaveLength(2);
    // A primeira foi enviada e não se sabe o que virou: fica pendente e o número dela NÃO é
    // reaproveitado (Ajuste 19/16, cl. 11ª, §2º, I).
    expect(todas[0].status).toBe('pendente');
    expect(todas[1].status).toBe('contingencia');
    expect(Number(todas[1].numero)).toBe(Number(todas[0].numero) + 1);
  }, 60000);

  it('o documento de contingência é uma NFC-e completa: tpEmis 9 na chave e no ide, com dhCont e xJust', async () => {
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('timeout'));
    const comanda = await venda();
    const nota: any = await servico.emitir(tenant, null, comanda);

    expect(nota.chave[34]).toBe('9'); // o 35º dígito da chave é o tipo de emissão
    expect(nota.xml).toContain('<tpEmis>9</tpEmis>');
    expect(nota.xml).toContain('<dhCont>');
    expect(nota.xml).toContain(`<xJust>${JUSTIFICATIVA_PADRAO}</xJust>`);
    expect(nota.xml).toContain('<Signature'); // assinada, mesmo sem a SEFAZ ter visto
    // QR off-line: oito parâmetros, o último sendo a assinatura.
    const p = String(nota.qrcode).slice(String(nota.qrcode).indexOf('?p=') + 3).split('|');
    expect(p).toHaveLength(8);
    expect(p[1]).toBe('3');
    expect(p[7].length).toBeGreaterThan(50);
  }, 60000);

  it('já em contingência, a venda seguinte NEM TENTA a SEFAZ — era a espera que travava o caixa', async () => {
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('timeout'));
    await servico.emitir(tenant, null, await venda()); // liga a contingência

    chamarSefaz.mockReset();
    const comanda = await venda();
    const nota: any = await servico.emitir(tenant, null, comanda);

    expect(nota.status).toBe('contingencia');
    expect(chamarSefaz).not.toHaveBeenCalled();
    expect(await notasDa(comanda)).toHaveLength(1); // uma nota só: não houve tentativa perdida
  }, 60000);

  it('a SEFAZ volta: o job sai da contingência e transmite a fila', async () => {
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('timeout'));
    const comanda = await venda();
    const emitida: any = await servico.emitir(tenant, null, comanda);
    expect((await estado()).ativa).toBe(true);

    // Status do serviço responde 107, e a autorização da nota da fila responde 100.
    chamarSefaz.mockReset();
    chamarSefaz.mockImplementation(async (p: any) =>
      p.servico === 'NFeStatusServico4'
        ? RET_STATUS_OK
        : retAutorizacao('100', 'Autorizado o uso da NF-e', p.corpoXml.match(/Id="NFe(\d{44})"/)![1]),
    );

    const r: any = await servico.rodarContingencia();
    expect(r.transmitidas).toBeGreaterThanOrEqual(1);
    expect((await estado()).ativa).toBe(false);

    const [nota] = (await notasDa(comanda)).filter((n: any) => n.id === emitida.id);
    expect(nota.status).toBe('autorizada');
    expect(nota.protocolo).toBe('333260002547395');
    expect(nota.xml).toContain('<nfeProc'); // virou documento: nota + protocolo
  }, 60000);

  it('rejeitada na transmissão CONTINUA na fila — número de contingência não se inutiliza', async () => {
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('timeout'));
    const comanda = await venda();
    const emitida: any = await servico.emitir(tenant, null, comanda);

    chamarSefaz.mockReset();
    chamarSefaz.mockImplementation(async (p: any) =>
      p.servico === 'NFeStatusServico4'
        ? RET_STATUS_OK
        : retAutorizacao('539', 'Rejeicao: Duplicidade de NF-e com diferenca na chave', p.corpoXml.match(/Id="NFe(\d{44})"/)![1]),
    );
    await servico.rodarContingencia();

    const nota = (await notasDa(comanda)).find((n: any) => n.id === emitida.id);
    expect(nota.status).toBe('contingencia'); // NÃO virou 'rejeitada'
    expect(nota.tentativas_transmissao).toBeGreaterThanOrEqual(1);
    expect(nota.motivo).toContain('539');

    // E por isso ela não aparece como lacuna a inutilizar.
    const lacunas: any = await servico.lacunas(tenant, unidade);
    const numeros = lacunas.flatMap((s: any) => s.faixas.map((f: any) => f.inicio));
    expect(numeros).not.toContain(Number(nota.numero));
  }, 60000);

  it('a fila mostra o prazo de cada nota', async () => {
    const fila: any = await servico.filaContingencia(tenant, unidade);
    expect(fila.length).toBeGreaterThan(0);
    expect(fila[0]).toHaveProperty('horasRestantes');
    expect(fila[0].vencida).toBe(false);
  }, 60000);

  it('por padrão NÃO imprime a 2ª via: restaurante entrega só o cupom do cliente', async () => {
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('timeout'));
    const comanda = await venda();
    const nota: any = await servico.emitir(tenant, null, comanda);

    const vias = await pool.query(`select conteudo from impressao_job where comanda_id = $1`, [comanda]);
    expect(nota.status).toBe('contingencia');
    // A via do cliente sai, com a mensagem obrigatória…
    expect(vias.rows).toHaveLength(1);
    expect(vias.rows[0].conteudo).toContain('EMITIDA EM CONTINGENCIA');
    // …e a do estabelecimento, não.
    expect(vias.rows.filter((v: any) => v.conteudo.includes('VIA DO ESTABELECIMENTO'))).toHaveLength(0);
  }, 60000);

  it('com o interruptor ligado, a 2ª via sai — para a UF que exigir papel', async () => {
    await pool.query(`update fiscal_config set contingencia_via_estabelecimento = true where tenant_id = $1`, [tenant]);
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('timeout'));
    const comanda = await venda();
    await servico.emitir(tenant, null, comanda);

    const vias = await pool.query(`select conteudo from impressao_job where comanda_id = $1`, [comanda]);
    expect(vias.rows.filter((v: any) => v.conteudo.includes('VIA DO ESTABELECIMENTO'))).toHaveLength(1);
    await pool.query(`update fiscal_config set contingencia_via_estabelecimento = false where tenant_id = $1`, [tenant]);
  }, 60000);
});
