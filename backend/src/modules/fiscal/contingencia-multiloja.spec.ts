import { randomBytes } from 'node:crypto';
import * as forge from 'node-forge';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { BadRequestException, Logger } from '@nestjs/common';
import { FiscalService } from './fiscal.service';
import { salvarCertificado } from './credencial';
import { FalhaDaLoja, SilencioDoCiclo, autorizador, motivoDaFalha } from './contingencia';

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('./sefaz/soap', () => ({
  ...jest.requireActual('./sefaz/soap'),
  chamarSefaz: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chamarSefaz, SefazInalcancavel, SefazRecusouChamada } = require('./sefaz/soap');

// A FILA DA CONTINGÊNCIA NA NUVEM TEM NOTAS DE MUITAS LOJAS (ERR-105).
//
// O ciclo parava no PRIMEIRO erro ("a SEFAZ caiu, não adianta insistir"). No servidor da loja, com
// uma loja só, isso estava certo; na nuvem, o erro de UMA loja — o certificado dela que não abre,
// a conexão dela que caiu — parava a transmissão de todas. E como a nota travada nunca sai da fila
// e era a mais antiga, ela vinha sempre primeiro: o bloqueio era permanente. No RJ, nota de
// contingência não transmitida é multa de 5% do valor (RICMS, art. 62-C, III).

describe('quem responde pela nota', () => {
  it('a UF vem dos dois primeiros dígitos da chave; o ambiente, da nota', () => {
    expect(autorizador('33260912345678000195650610000000011900000019'.slice(0, 2), '2')).toBe('33/2');
    expect(autorizador(33, '1')).toBe('33/1');
    expect(autorizador('35', null)).toBe('35/2'); // sem ambiente é homologação, como no resto do módulo
  });
});

describe('o silêncio de uma loja não para as outras', () => {
  it('a loja muda sai do ciclo; as outras da mesma UF, não', () => {
    const s = new SilencioDoCiclo();
    s.registrar('A', '33/2');
    expect(s.pular('A', '33/2')).toBe(true);
    expect(s.pular('B', '33/2')).toBe(false);
    expect(s.foraDoAr()).toEqual([]);
  });

  it('DUAS lojas mudas da mesma UF: a SEFAZ dela está fora — a terceira não espera os 30 s', () => {
    const s = new SilencioDoCiclo();
    s.registrar('A', '33/2');
    s.registrar('B', '33/2');
    expect(s.pular('C', '33/2')).toBe(true);
    expect(s.foraDoAr()).toEqual(['33/2']);
  });

  it('a mesma loja muda duas vezes continua sendo UMA loja', () => {
    const s = new SilencioDoCiclo();
    s.registrar('A', '33/2');
    s.registrar('A', '33/2');
    expect(s.pular('B', '33/2')).toBe(false);
  });

  it('a SEFAZ de outra UF, ou do outro ambiente, segue de pé', () => {
    const s = new SilencioDoCiclo();
    s.registrar('A', '33/2');
    s.registrar('B', '33/2');
    expect(s.pular('C', '35/2')).toBe(false);
    expect(s.pular('D', '33/1')).toBe(false);
  });
});

describe('o motivo que a loja lê na fila', () => {
  it('erro escrito para a loja vai como está', () => {
    expect(motivoDaFalha(new FalhaDaLoja('o certificado digital da loja não serve (vencido)'))).toBe(
      'Contingencia nao transmitida: o certificado digital da loja não serve (vencido)',
    );
    expect(motivoDaFalha(new SefazInalcancavel('ETIMEDOUT'))).toContain('A SEFAZ não respondeu: ETIMEDOUT');
    expect(motivoDaFalha(new SefazRecusouChamada('HTTP 403 — Forbidden', 403))).toContain('HTTP 403');
    expect(motivoDaFalha(new BadRequestException('Nenhum certificado digital cadastrado para esta loja.'))).toContain(
      'Nenhum certificado digital',
    );
  });

  it('defeito nosso não vai para a tela da loja — fica no log', () => {
    const m = motivoDaFalha(new TypeError("Cannot read properties of undefined (reading 'xml')"));
    expect(m).not.toContain('Cannot read');
    expect(m).toContain('log do servidor');
  });

  it('cabe na coluna', () => {
    expect(motivoDaFalha(new FalhaDaLoja('x'.repeat(1000)))).toHaveLength(400);
  });
});

describe('um ciclo não começa por cima do outro', () => {
  // Sem banco: o ciclo em si é trocado por um que só termina quando o teste manda.
  it('com o job rodando, o próximo tique e o botão esperam a vez', async () => {
    const s = new FiscalService({} as any, {} as any);
    let terminar!: (v: any) => void;
    const ciclo = jest
      .spyOn(s as any, 'cicloContingencia')
      .mockImplementation(() => new Promise((r) => (terminar = r)));

    const primeiro = s.rodarContingencia();
    expect(await s.rodarContingencia()).toMatchObject({ emAndamento: true });
    expect(await s.transmitirContingencia({ tenantIds: ['empresa-1'] })).toMatchObject({ emAndamento: true });
    terminar({ verificados: 0, transmitidas: 2 });
    expect(await primeiro).toEqual({ verificados: 0, transmitidas: 2 });
    expect(ciclo).toHaveBeenCalledTimes(1);
    expect(ciclo).toHaveBeenCalledWith(20, null); // o job: todas as lojas

    ciclo.mockResolvedValue({ verificados: 0, transmitidas: 0 });
    expect(await s.rodarContingencia()).toEqual({ verificados: 0, transmitidas: 0 });
  });

  it('o botão trava por empresa: a mesma espera, outra empresa segue', async () => {
    const s = new FiscalService({} as any, {} as any);
    const pendentes: Array<(v: any) => void> = [];
    const ciclo = jest
      .spyOn(s as any, 'cicloContingencia')
      .mockImplementation(() => new Promise((r) => pendentes.push(r)));

    const primeiro = s.transmitirContingencia({ tenantIds: ['empresa-1'], unidadeId: 'loja-1' });
    expect(await s.transmitirContingencia({ tenantIds: ['empresa-1'] })).toMatchObject({ emAndamento: true });
    const outra = s.transmitirContingencia({ tenantIds: ['empresa-2'] });
    expect(ciclo).toHaveBeenCalledTimes(2);
    expect(ciclo).toHaveBeenNthCalledWith(1, 20, { tenantIds: ['empresa-1'], unidadeId: 'loja-1' });
    expect(ciclo).toHaveBeenNthCalledWith(2, 20, { tenantIds: ['empresa-2'], unidadeId: null });
    pendentes.forEach((r) => r({ verificados: 0, transmitidas: 1 }));
    await Promise.all([primeiro, outra]);

    ciclo.mockResolvedValue({ verificados: 0, transmitidas: 0 });
    expect(await s.transmitirContingencia({ tenantIds: ['empresa-1'] })).toEqual({ verificados: 0, transmitidas: 0 });
  });

  it('sem empresa, o botão não roda nada — nunca vira a fila de todas', async () => {
    const s = new FiscalService({} as any, {} as any);
    const ciclo = jest.spyOn(s as any, 'cicloContingencia');
    expect(await s.transmitirContingencia({ tenantIds: [] })).toEqual({ verificados: 0, transmitidas: 0 });
    expect(await s.transmitirContingencia({ tenantIds: ['', null as any] })).toEqual({ verificados: 0, transmitidas: 0 });
    expect(ciclo).not.toHaveBeenCalled();
  });

  it('um ciclo que quebra solta a trava', async () => {
    const s = new FiscalService({} as any, {} as any);
    const ciclo = jest.spyOn(s as any, 'cicloContingencia').mockRejectedValueOnce(new Error('banco fora'));
    await expect(s.rodarContingencia()).rejects.toThrow('banco fora');
    ciclo.mockResolvedValue({ verificados: 0, transmitidas: 0 });
    expect(await s.rodarContingencia()).toEqual({ verificados: 0, transmitidas: 0 });
  });
});

// ===== Contra o Postgres de verdade =====

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('contingencia-multiloja.spec: sem TEST_PG_URL — a parte de banco foi PULADA');

const SENHA = 'Senha-Do-Certificado-9!';

/** Um CNPJ válido e diferente por loja: a chave de acesso leva o CNPJ, e o teste separa as lojas por ele. */
function cnpjDeTeste(): string {
  const base = String(Math.floor(Math.random() * 1e8)).padStart(8, '0') + '0001';
  const dv = (s: string) => {
    const pesos = s.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = s.split('').reduce((soma, d, i) => soma + Number(d) * pesos[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  return base + d1 + dv(base + d1);
}

function pfxDeTeste(cnpj: string): Buffer {
  const k = forge.pki.rsa.generateKeyPair(1024);
  const c = forge.pki.createCertificate();
  c.publicKey = k.publicKey;
  c.serialNumber = randomBytes(4).toString('hex');
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 60 * 86_400_000);
  c.setSubject([{ name: 'commonName', value: `LOJA DE TESTE LTDA:${cnpj}` }]);
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
    '<dhRecbto>2026-09-25T10:00:00-03:00</dhRecbto><tMed>1</tMed></retConsStatServ>',
  'NFeStatusServico4',
);

const retAutorizada = (chave: string) =>
  soap(
    '<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>' +
      '<verAplic>SVRS</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>33</cUF>' +
      `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${chave}</chNFe>` +
      '<dhRecbto>2026-09-25T10:00:00-03:00</dhRecbto><nProt>333260002547395</nProt>' +
      '<digVal>abc=</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>' +
      '</retEnviNFe>',
    'NFeAutorizacao4',
  );

interface Loja {
  tenant: string;
  unidade: string;
  produto: string;
  cnpj: string;
  chaveCifra: string;
}

descrever('a fila da contingência na nuvem, com várias lojas', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const servico = new FiscalService(db, { registrar: async () => {} } as any);

  const chaveOriginal = process.env.SEGREDOS_CHAVE;
  const edgeOriginal = process.env.EDGE_MODE;
  // A chave de proteção desta nuvem, e a de "outro servidor": o certificado cifrado com ela não
  // abre aqui — foi o que travou a fila no CI do #575.
  const CHAVE = randomBytes(32).toString('base64');
  const CHAVE_DE_OUTRO_SERVIDOR = randomBytes(32).toString('base64');
  const empresas: string[] = [];

  async function novaLoja(nome: string, chaveCifra = CHAVE): Promise<Loja> {
    const cnpj = cnpjDeTeste();
    const tenant = (await pool.query(`insert into empresa (nome) values ($1) returning id`, [`Teste fila ${nome}`]))
      .rows[0].id;
    empresas.push(tenant);
    const unidade = (await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [tenant]))
      .rows[0].id;
    const produto = (
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
       values ($1,null,true,'2',60,61,$2,'Loja de Teste LTDA','13047081','RJ',33,3304557,'Rio de Janeiro',
               'Rua A','Centro','100','21221240',
               'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode','www.fazenda.rj.gov.br/nfce/consulta')`,
      [tenant, cnpj],
    );
    process.env.SEGREDOS_CHAVE = chaveCifra;
    try {
      await salvarCertificado(db, tenant, null, { pfxBase64: pfxDeTeste(cnpj).toString('base64'), senha: SENHA });
    } finally {
      process.env.SEGREDOS_CHAVE = CHAVE;
    }
    return { tenant, unidade, produto, cnpj, chaveCifra };
  }

  async function venda(l: Loja): Promise<string> {
    const c = await pool.query(
      `insert into comanda (tenant_id, unidade_id, status, forma, total) values ($1,$2,'fechada','dinheiro','10.00') returning id`,
      [l.tenant, l.unidade],
    );
    await pool.query(
      `insert into comanda_item (tenant_id, comanda_id, produto_id, descricao, quantidade, preco_unitario)
       values ($1,$2,$3,'Prato de teste',1,'10.00')`,
      [l.tenant, c.rows[0].id, l.produto],
    );
    return c.rows[0].id;
  }

  /** Vendas emitidas com a SEFAZ muda: saem em contingência e ficam na fila, na ordem de emissão. */
  async function emitirEmContingencia(l: Loja, quantas = 1): Promise<any[]> {
    process.env.SEGREDOS_CHAVE = l.chaveCifra;
    try {
      chamarSefaz.mockReset();
      chamarSefaz.mockRejectedValue(new SefazInalcancavel('timeout'));
      const notas: any[] = [];
      for (let i = 0; i < quantas; i++) {
        const n: any = await servico.emitir(l.tenant, null, await venda(l));
        expect(n.status).toBe('contingencia');
        notas.push(n);
      }
      return notas;
    } finally {
      process.env.SEGREDOS_CHAVE = CHAVE;
    }
  }

  const cnpjDoCertificado = (p: any): string =>
    String(forge.pki.certificateFromPem(p.cert.certificadoPem).subject.getField('CN').value).split(':').pop() ?? '';

  /**
   * A SEFAZ dos testes. `mudas`: CNPJs cujas transmissões ficam sem resposta; `statusMudo`: a
   * consulta de status de todas; `quebra`: chaves cuja resposta vem ilegível. O resto é autorizado.
   */
  function sefaz(opts: { mudas?: string[]; statusMudo?: boolean; quebra?: string[] } = {}) {
    const chamadas: Array<{ servico: string; cnpj: string }> = [];
    chamarSefaz.mockReset();
    chamarSefaz.mockImplementation(async (p: any) => {
      if (p.servico === 'NFeStatusServico4') {
        chamadas.push({ servico: p.servico, cnpj: cnpjDoCertificado(p) });
        if (opts.statusMudo) throw new SefazInalcancavel('ETIMEDOUT');
        return RET_STATUS_OK;
      }
      const chave = String(p.corpoXml).match(/Id="NFe(\d{44})"/)![1];
      const cnpj = chave.slice(6, 20);
      chamadas.push({ servico: p.servico, cnpj });
      if (opts.mudas?.includes(cnpj)) throw new SefazInalcancavel('ECONNRESET');
      if (opts.quebra?.includes(chave)) throw new TypeError("Cannot read properties of null (reading 'textContent')");
      return retAutorizada(chave);
    });
    return chamadas;
  }

  const nota = (id: string) => pool.query('select * from nota_fiscal where id = $1', [id]).then((r) => r.rows[0]);
  const estado = (tenant: string) =>
    pool.query('select * from fiscal_contingencia where tenant_id = $1', [tenant]).then((r) => r.rows[0]);
  const autorizacoes = (chamadas: Array<{ servico: string; cnpj: string }>, cnpj?: string) =>
    chamadas.filter((c) => c.servico === 'NFeAutorizacao4' && (!cnpj || c.cnpj === cnpj));

  beforeAll(() => {
    process.env.SEGREDOS_CHAVE = CHAVE;
    delete process.env.EDGE_MODE; // esta instalação é a NUVEM
  });

  afterAll(async () => {
    if (chaveOriginal === undefined) delete process.env.SEGREDOS_CHAVE;
    else process.env.SEGREDOS_CHAVE = chaveOriginal;
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    // Uma empresa por loja, e o `delete` desce em cascata por todas as tabelas: com o CI rodando
    // as specs em paralelo, os 5 s padrão do hook não bastam.
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    await pool.end();
  }, 120000);

  afterEach(() => jest.restoreAllMocks());

  it('a loja cujo certificado não abre NÃO trava as outras — o caso do CI do #575', async () => {
    const a = await novaLoja('A', CHAVE_DE_OUTRO_SERVIDOR);
    const b = await novaLoja('B');
    const [notaA] = await emitirEmContingencia(a); // a mais antiga da fila: era sempre a primeira
    const [notaB] = await emitirEmContingencia(b);
    sefaz();

    const r: any = await servico.transmitirContingencia({ tenantIds: [a.tenant, b.tenant] });

    expect(r.transmitidas).toBe(1); // antes: 0 — o ciclo parava na nota da A
    expect((await nota(notaB.id)).status).toBe('autorizada');
    const na = await nota(notaA.id);
    expect(na.status).toBe('contingencia'); // número de contingência não se inutiliza: espera o certificado
    expect(na.motivo).toContain('Não consegui abrir o certificado guardado');
    expect(na.tentativas_transmissao).toBe(1);
  }, 60000);

  it('as notas travadas de uma loja não ocupam o lote inteiro — cada loja tem a sua vez', async () => {
    const a = await novaLoja('A', CHAVE_DE_OUTRO_SERVIDOR);
    const b = await novaLoja('B');
    const notasA = await emitirEmContingencia(a, 4);
    const [notaB] = await emitirEmContingencia(b);
    sefaz();
    const erros = jest.spyOn(Logger.prototype, 'error');

    // Lote de 3: na ordem de chegada seriam as três primeiras da A, e a B não entraria nunca.
    const r: any = await servico.transmitirContingencia({ tenantIds: [a.tenant, b.tenant] }, 3);

    expect(r.transmitidas).toBe(1);
    expect((await nota(notaB.id)).status).toBe('autorizada');
    // Uma tentativa da A no ciclo: as outras notas dela esperam o conserto, sem repetir o erro.
    const tentativas = (await Promise.all(notasA.map((n) => nota(n.id)))).map((n) => n.tentativas_transmissao);
    expect(tentativas).toEqual([1, 0, 0, 0]);
    expect(erros.mock.calls.filter((c) => String(c[0]).includes('não sai'))).toHaveLength(1);
  }, 60000);

  it('o silêncio de UMA loja não para as outras da mesma UF', async () => {
    const a = await novaLoja('A');
    const b = await novaLoja('B');
    const notasA = await emitirEmContingencia(a, 2);
    const [notaB] = await emitirEmContingencia(b);
    const chamadas = sefaz({ mudas: [a.cnpj] }); // a conexão da A caiu; a SEFAZ está de pé

    const r: any = await servico.transmitirContingencia({ tenantIds: [a.tenant, b.tenant] });

    expect(r.transmitidas).toBe(1);
    expect((await nota(notaB.id)).status).toBe('autorizada');
    // A loja muda sai do ciclo na PRIMEIRA nota: a segunda não espera outros 30 s.
    expect(autorizacoes(chamadas, a.cnpj)).toHaveLength(1);
    const [a1, a2] = await Promise.all(notasA.map((n) => nota(n.id)));
    expect(a1.status).toBe('contingencia');
    expect(a1.motivo).toContain('A SEFAZ não respondeu');
    expect(a1.tentativas_transmissao).toBe(1);
    expect(a2.tentativas_transmissao).toBe(0);
  }, 60000);

  it('a SEFAZ da UF fora do ar: duas lojas sem resposta bastam, e a terceira não espera', async () => {
    const lojas = [await novaLoja('A'), await novaLoja('B'), await novaLoja('C')];
    const notas: any[] = [];
    for (const l of lojas) notas.push(...(await emitirEmContingencia(l)));
    const empresasDoTeste = lojas.map((l) => l.tenant);
    const chamadas = sefaz({ mudas: lojas.map((l) => l.cnpj), statusMudo: true });

    const r: any = await servico.transmitirContingencia({ tenantIds: empresasDoTeste });

    expect(r.transmitidas).toBe(0);
    expect(autorizacoes(chamadas)).toHaveLength(2);
    expect(chamadas.filter((c) => c.servico === 'NFeStatusServico4')).toHaveLength(2);
    // A loja pulada também conta como verificada: a SEFAZ dela é a que calou.
    for (const l of lojas) {
      const e = await estado(l.tenant);
      expect(e.ativa).toBe(true);
      expect(e.ultima_verificacao).not.toBeNull();
    }

    // A SEFAZ volta: o ciclo seguinte desliga a contingência das três e transmite a fila inteira.
    sefaz();
    const r2: any = await servico.transmitirContingencia({ tenantIds: empresasDoTeste });
    expect(r2).toEqual({ verificados: 3, transmitidas: 3 });
    for (const n of notas) expect((await nota(n.id)).status).toBe('autorizada');
    for (const l of lojas) expect((await estado(l.tenant)).ativa).toBe(false);
  }, 60000);

  it('o erro de UMA nota fica nela, e a fila segue — inclusive na mesma loja', async () => {
    const b = await novaLoja('B');
    const [n1, n2] = await emitirEmContingencia(b, 2);
    sefaz({ quebra: [n1.chave] });

    const r: any = await servico.transmitirContingencia({ tenantIds: [b.tenant] });

    expect(r.transmitidas).toBe(1);
    expect((await nota(n2.id)).status).toBe('autorizada');
    const quebrada = await nota(n1.id);
    expect(quebrada.status).toBe('contingencia');
    expect(quebrada.motivo).toContain('log do servidor');
    expect(quebrada.motivo).not.toContain('Cannot read'); // defeito nosso não vai para a tela da loja
    expect(quebrada.tentativas_transmissao).toBe(1);
  }, 60000);

  it('o botão transmite só a fila da PRÓPRIA empresa — e conta só as dela', async () => {
    const a = await novaLoja('A');
    const b = await novaLoja('B');
    const [notaA] = await emitirEmContingencia(a);
    const [notaB] = await emitirEmContingencia(b);
    const chamadas = sefaz();

    const r: any = await servico.transmitirContingencia({ tenantIds: [a.tenant] });

    expect(r).toEqual({ verificados: 1, transmitidas: 1 });
    expect((await nota(notaA.id)).status).toBe('autorizada');
    const nb = await nota(notaB.id);
    expect(nb.status).toBe('contingencia');
    expect(nb.tentativas_transmissao).toBe(0);
    expect(chamadas.every((c) => c.cnpj === a.cnpj)).toBe(true); // nem o status da B foi consultado
    expect((await estado(b.tenant)).ativa).toBe(true);
  }, 60000);

  it('com loja em uso, entram as notas dela e as da rede (sem loja)', async () => {
    const b = await novaLoja('B');
    const [n] = await emitirEmContingencia(b); // emitida sem loja: é da rede
    sefaz();

    const r: any = await servico.transmitirContingencia({ tenantIds: [b.tenant], unidadeId: b.unidade });

    expect(r).toEqual({ verificados: 1, transmitidas: 1 });
    expect((await nota(n.id)).status).toBe('autorizada');
  }, 60000);
});
