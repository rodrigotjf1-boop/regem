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

// P18 — A NOTA QUE FICOU "PENDENTE", do banco à decisão.
//
// `pendente` é o único estado que não se resolve sozinho: a nota foi enviada e não se sabe o que
// virou. Enquanto durar, o número fica travado e a venda não emite outra. Os dois erros possíveis
// são simétricos e graves — dar por autorizada uma nota que não existe (venda sem documento) ou
// dar por inexistente uma que existe (duas notas para a mesma venda). Estes testes fixam o
// comportamento nos dois sentidos, contra o Postgres de verdade.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('consulta-pendente.spec: sem TEST_PG_URL — PULADO');

const CNPJ = '12345678000195';
const SENHA = 'Senha-Do-Certificado-9!';
// Chave de 44 dígitos: cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) número(9) tpEmis(1) cNF(8) DV(1).
const chaveDe = (numero: number) =>
  `33` + `2609` + `12345678000195` + `65` + `051` + String(numero).padStart(9, '0') + `1` + `15528211` + `2`;

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
  '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">' +
  miolo +
  '</nfeResultMsg></soap:Body></soap:Envelope>';
const retConsulta = (cStat: string, xMotivo: string, extra = '') =>
  `<retConsSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>` +
  `<verAplic>SVRS</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>33</cUF>${extra}</retConsSitNFe>`;
const protNFe = (cStat: string, xMotivo: string, chave: string) =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${chave}</chNFe>` +
  `<dhRecbto>2026-09-22T20:56:00-03:00</dhRecbto>${cStat === '100' ? '<nProt>333260002547395</nProt>' : ''}` +
  `<digVal>abc=</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
const XML_ENVIADO = (chave: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe">` +
  `<infNFe versao="4.00" Id="NFe${chave}"></infNFe><Signature/></NFe>`;

descrever('a nota pendente se resolve pela consulta à SEFAZ', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const servico = new FiscalService(db, { registrar: async () => {} } as any);

  const chaveOriginal = process.env.SEGREDOS_CHAVE;
  const edgeOriginal = process.env.EDGE_MODE;
  let tenant = '';
  let unidade = '';

  // Cria uma nota pendente na série informada. `idadeMin` envelhece a nota (a carência do 217).
  async function pendente(numero: number, serie = 51, idadeMin = 0) {
    const chave = chaveDe(numero);
    const r = await pool.query(
      `insert into nota_fiscal (tenant_id, unidade_id, modelo, serie, numero, ambiente, status,
         valor_total, chave, xml, created_at)
       values ($1,$2,'65',$3,$4,'2','pendente','1.00',$5,$6, now() - ($7 || ' minutes')::interval)
       returning *`,
      [tenant, unidade, serie, numero, chave, XML_ENVIADO(chave), String(idadeMin)],
    );
    return r.rows[0];
  }
  const doBanco = (id: string) => pool.query('select * from nota_fiscal where id = $1', [id]).then((r) => r.rows[0]);

  beforeAll(async () => {
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    delete process.env.EDGE_MODE; // esta instalação é a NUVEM
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste pendente') returning id`)).rows[0].id;
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
    // As duas origens, para provar que o job não invade a série do outro lado.
    await pool.query(
      `insert into fiscal_serie (id, tenant_id, unidade_id, origem, serie, proximo_numero)
       values (md5($1 || $2 || 'nuvem')::uuid, $1::uuid, $2::uuid, 'nuvem', 51, 1),
              (md5($1 || $2 || 'loja')::uuid,  $1::uuid, $2::uuid, 'loja',  50, 1)`,
      [tenant, unidade],
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

  it('autorizada lá: grava protocolo e transforma o XML enviado no documento (nfeProc)', async () => {
    const n = await pendente(11);
    chamarSefaz.mockResolvedValue(soap(retConsulta('100', 'Autorizado o uso da NF-e', protNFe('100', 'Autorizado o uso da NF-e', n.chave))));

    const r: any = await servico.consultarNota(tenant, n.id, null);
    expect(r).toMatchObject({ status: 'autorizada', protocolo: '333260002547395', cstat: '100' });

    const nota = await doBanco(n.id);
    expect(nota.status).toBe('autorizada');
    expect(nota.emitida_em).not.toBeNull();
    expect(nota.xml).toContain('<nfeProc'); // o que estava guardado era só a NFe assinada
    expect(nota.xml).toContain('<protNFe');
    // O pedido de consulta foi montado com a chave DESTA nota.
    expect(chamarSefaz.mock.calls[0][0].corpoXml).toContain(`<chNFe>${n.chave}</chNFe>`);
  }, 60000);

  it('"não consta" LOGO APÓS o envio não é resposta: pode estar sendo processada agora', async () => {
    const n = await pendente(12); // recém-criada
    chamarSefaz.mockResolvedValue(soap(retConsulta('217', 'NF-e nao consta na base de dados da SEFAZ')));

    const r: any = await servico.consultarNota(tenant, n.id, null);
    expect(r.status).toBe('pendente');
    const nota = await doBanco(n.id);
    expect(nota.status).toBe('pendente');
    expect(Number(nota.tentativas_consulta)).toBe(1);
    expect(nota.consultada_em).not.toBeNull();
    expect(nota.motivo).toMatch(/car[êe]ncia/i);
  }, 60000);

  it('"não consta" depois da carência: a SEFAZ nunca a registrou — vira rejeitada (número livre)', async () => {
    const n = await pendente(13, 51, 10); // 10 minutos de idade
    chamarSefaz.mockResolvedValue(soap(retConsulta('217', 'NF-e nao consta na base de dados da SEFAZ')));

    const r: any = await servico.consultarNota(tenant, n.id, null);
    expect(r).toMatchObject({ status: 'rejeitada', cstat: '217' });
    expect((await doBanco(n.id)).emitida_em).toBeNull();
  }, 60000);

  it('denegada NÃO vira rejeitada: o número existe na base e nunca volta para a fila', async () => {
    const n = await pendente(14, 51, 10);
    chamarSefaz.mockResolvedValue(
      soap(retConsulta('302', 'Uso Denegado: Irregularidade fiscal do destinatario', protNFe('302', 'Uso Denegado', n.chave))),
    );
    const r: any = await servico.consultarNota(tenant, n.id, null);
    expect(r.status).toBe('denegada');
  }, 60000);

  it('resposta sem conclusão mantém a nota pendente e conta a tentativa (sem limite, o job giraria em falso)', async () => {
    const n = await pendente(15, 51, 10);
    chamarSefaz.mockResolvedValue(soap(retConsulta('999', 'Erro nao catalogado')));
    await servico.consultarNota(tenant, n.id, null);
    await servico.consultarNota(tenant, n.id, null);
    const nota = await doBanco(n.id);
    expect(nota.status).toBe('pendente');
    expect(Number(nota.tentativas_consulta)).toBe(2);
  }, 60000);

  it('consultar de novo uma nota já resolvida não a reescreve (a gravação é condicional)', async () => {
    const n = await pendente(16, 51, 10);
    chamarSefaz.mockResolvedValue(soap(retConsulta('100', 'Autorizado o uso da NF-e', protNFe('100', 'Autorizado', n.chave))));
    await servico.consultarNota(tenant, n.id, null);
    const depois1 = await doBanco(n.id);

    // Agora a SEFAZ "muda de ideia": a nota já não está pendente, então nada pode mudar.
    chamarSefaz.mockResolvedValue(soap(retConsulta('217', 'NF-e nao consta na base de dados da SEFAZ')));
    const r: any = await servico.consultarNota(tenant, n.id, null);
    expect(r.status).toBe('autorizada');
    const depois2 = await doBanco(n.id);
    expect(depois2.status).toBe('autorizada');
    expect(depois2.protocolo).toBe(depois1.protocolo);
    expect(depois2.xml).toBe(depois1.xml);
  }, 60000);

  it('nota simulada não é consultada — ela não existe na SEFAZ', async () => {
    const n = await pendente(17);
    await pool.query(`update nota_fiscal set simulada = true where id = $1`, [n.id]);
    await expect(servico.consultarNota(tenant, n.id, null)).rejects.toThrow(/simulada/i);
    expect(chamarSefaz).not.toHaveBeenCalled();
  }, 60000);

  describe('o job que varre as pendentes', () => {
    // Os casos acima deixam pendências de propósito; aqui elas atrapalhariam a contagem.
    beforeAll(async () => {
      await pool.query(
        `update nota_fiscal set status = 'rejeitada' where tenant_id = $1 and status = 'pendente'`,
        [tenant],
      );
    });

    it('cuida só das séries da PRÓPRIA origem, respeita a carência e o limite de tentativas', async () => {
      const daNuvem = await pendente(21, 51, 10);
      const daLoja = await pendente(22, 50, 10); // série da loja: não é desta instalação
      const novinha = await pendente(23, 51, 0); // dentro da carência de 2 min
      const cansada = await pendente(24, 51, 10);
      await pool.query(`update nota_fiscal set tentativas_consulta = 20 where id = $1`, [cansada.id]);

      chamarSefaz.mockImplementation(async ({ corpoXml }: any) => {
        const ch = /<chNFe>(\d{44})<\/chNFe>/.exec(corpoXml)![1];
        return soap(retConsulta('100', 'Autorizado o uso da NF-e', protNFe('100', 'Autorizado', ch)));
      });

      const r = await servico.reconciliarPendentes();
      expect(r).toMatchObject({ consultadas: 1, resolvidas: 1 });
      expect((await doBanco(daNuvem.id)).status).toBe('autorizada');
      expect((await doBanco(daLoja.id)).status).toBe('pendente');
      expect((await doBanco(novinha.id)).status).toBe('pendente');
      expect((await doBanco(cansada.id)).status).toBe('pendente');
    }, 60000);

    it('uma nota que não resolve não impede as outras', async () => {
      const a = await pendente(31, 51, 10);
      const b = await pendente(32, 51, 10);
      chamarSefaz.mockImplementation(async ({ corpoXml }: any) => {
        const ch = /<chNFe>(\d{44})<\/chNFe>/.exec(corpoXml)![1];
        if (ch === a.chave) throw new Error('SEFAZ fora do ar');
        return soap(retConsulta('100', 'Autorizado o uso da NF-e', protNFe('100', 'Autorizado', ch)));
      });
      const r = await servico.reconciliarPendentes();
      expect(r.consultadas).toBe(2);
      expect((await doBanco(a.id)).status).toBe('pendente');
      expect((await doBanco(b.id)).status).toBe('autorizada');
    }, 60000);
  });

  describe('a venda, diante de uma pendência da comanda', () => {
    async function comandaCom(numero: number, idadeMin = 10) {
      const c = (
        await pool.query(
          `insert into comanda (tenant_id, unidade_id, status) values ($1,$2,'fechada') returning id`,
          [tenant, unidade],
        )
      ).rows[0];
      const n = await pendente(numero, 51, idadeMin);
      await pool.query(`update nota_fiscal set comanda_id = $1 where id = $2`, [c.id, n.id]);
      return { comandaId: c.id, nota: n };
    }

    it('autorizada lá: devolve AQUELA nota e não emite outra', async () => {
      const { comandaId, nota } = await comandaCom(41);
      chamarSefaz.mockResolvedValue(soap(retConsulta('100', 'Autorizado o uso da NF-e', protNFe('100', 'Autorizado', nota.chave))));
      const r: any = await servico.emitir(tenant, null, comandaId);
      expect(r.id).toBe(nota.id);
      expect(r.status).toBe('autorizada');
      // Só a consulta falou com a SEFAZ — nenhuma transmissão de nota nova.
      expect(chamarSefaz).toHaveBeenCalledTimes(1);
    }, 60000);

    it('sem resposta conclusiva: NÃO emite outra (duas notas para a mesma venda seria pior)', async () => {
      const { comandaId } = await comandaCom(42);
      chamarSefaz.mockResolvedValue(soap(retConsulta('999', 'Erro nao catalogado')));
      await expect(servico.emitir(tenant, null, comandaId)).rejects.toThrow(/sem resposta conclusiva/i);
    }, 60000);

    it('"não consta" na SEFAZ: destrava e segue para emitir de novo', async () => {
      const { comandaId, nota } = await comandaCom(43);
      chamarSefaz.mockResolvedValue(soap(retConsulta('217', 'NF-e nao consta na base de dados da SEFAZ')));
      // A comanda não tem itens: a emissão para MAIS ADIANTE, o que prova que o portão da
      // pendência foi ultrapassado (antes, ele lançava "consulte a situação dela").
      await expect(servico.emitir(tenant, null, comandaId)).rejects.toThrow(/sem itens/i);
      expect((await doBanco(nota.id)).status).toBe('rejeitada');
    }, 60000);
  });
});
