import { randomBytes, randomUUID } from 'node:crypto';
import * as forge from 'node-forge';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { salvarCertificado } from '../fiscal/credencial';
import { PRAZO_AUTORIZACAO_TOTEM_MS } from '../fiscal/nfce-totem';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { DeliveryService } from '../delivery/delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../fiscal/sefaz/soap', () => ({
  ...jest.requireActual('../fiscal/sefaz/soap'),
  chamarSefaz: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chamarSefaz, SefazInalcancavel, SefazRecusouChamada } = require('../fiscal/sefaz/soap');

// A VENDA DO TOTEM COM NFC-e, DE PONTA A PONTA — pedido retido → pagamento aprovado → nota →
// cozinha (ou venda desfeita) → cupom que não imprimiu. Postgres de verdade; só a SEFAZ é falsa.
//
// As regras do dono que isto prova:
//  • a compra só termina com o cupom fiscal na mão do cliente — nota que não sai DESFAZ a venda
//    (estoque, caixa, pedido) e a cozinha nunca recebe;
//  • contingência é aprovação: o totem imprime e não estorna;
//  • o totem nunca perde o DANFE: a repetição da liberação devolve a MESMA nota;
//  • DANFE que não saiu no papel: a nota é cancelada (110111) — ou, em contingência, fica
//    agendada para quando for autorizada, porque ela não pode ser inutilizada.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('venda-totem-fiscal.spec: sem TEST_PG_URL — PULADO');

const CNPJ = '12345678000195';
const SENHA = 'Senha-Do-Certificado-9!';

// A chave sai UMA vez: gerar RSA leva segundos, e o certificado "que vence daqui a pouco" já
// nasceria vencido se a validade fosse contada antes da geração.
const CHAVE_TESTE = forge.pki.rsa.generateKeyPair(1024);

function pfxDeTeste(validoAte: Date): Buffer {
  const k = CHAVE_TESTE;
  const c = forge.pki.createCertificate();
  c.publicKey = k.publicKey;
  c.serialNumber = '12fa9c';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = validoAte;
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
  `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}">${miolo}</nfeResultMsg>` +
  '</soap:Body></soap:Envelope>';

const RET_STATUS_OK = soap(
  '<retConsStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>' +
    '<verAplic>SVRS</verAplic><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo><cUF>33</cUF>' +
    '<dhRecbto>2026-09-24T10:00:00-03:00</dhRecbto><tMed>1</tMed></retConsStatServ>',
  'NFeStatusServico4',
);

const retAutorizacao = (cStat: string, xMotivo: string, chave: string) =>
  soap(
    '<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>' +
      '<verAplic>SVRS</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>33</cUF>' +
      `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${chave}</chNFe>` +
      `<dhRecbto>2026-09-24T10:00:00-03:00</dhRecbto>${cStat === '100' ? '<nProt>333260002547395</nProt>' : ''}` +
      `<digVal>abc=</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>` +
      '</retEnviNFe>',
    'NFeAutorizacao4',
  );

const retEvento = (cStat: string, chave: string) =>
  soap(
    `<retEnvEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><idLote>1</idLote>` +
      `<tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cOrgao>33</cOrgao><cStat>128</cStat>` +
      `<xMotivo>Lote de Evento Processado</xMotivo>` +
      `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><cOrgao>33</cOrgao>` +
      `<cStat>${cStat}</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${chave}</chNFe>` +
      `<tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-09-24T12:10:05-03:00</dhRegEvento>` +
      `${cStat === '135' ? '<nProt>333260009911224</nProt>' : ''}</infEvento></retEvento></retEnvEvento>`,
    'RecepcaoEvento4',
  );

const retConsultaCancelada = (chave: string) =>
  soap(
    `<retConsSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>` +
      `<verAplic>SVRS</verAplic><cStat>101</cStat><xMotivo>Cancelamento de NF-e homologado</xMotivo>` +
      `<cUF>33</cUF><chNFe>${chave}</chNFe></retConsSitNFe>`,
    'NFeConsultaProtocolo4',
  );

const chaveNfe = (corpo: string) => /Id="NFe(\d{44})"/.exec(corpo)![1];
const chaveEvento = (corpo: string) => /<chNFe>(\d{44})<\/chNFe>/.exec(corpo)![1];

descrever('venda do totem com NFC-e (Postgres real)', () => {
  jest.setTimeout(60_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditado: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditado.push(e) } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const estornos = { estornarPedido: async () => undefined } as any;
  const delivery = new DeliveryService(db, vendas, producao, estornos, estornos, eventos, { flashPedidos: () => undefined } as any);

  const chaveOriginal = process.env.SEGREDOS_CHAVE;
  const edgeOriginal = process.env.EDGE_MODE;
  let tenant = '';
  let unidade = '';
  let totem = '';
  let senha = 700;
  const pfxValido = pfxDeTeste(new Date(Date.now() + 60 * 86_400_000)).toString('base64');

  // ── ajudantes ──────────────────────────────────────────────────────────────────────────────
  async function pedidoRetido(): Promise<string> {
    senha++;
    const r = await pool.query(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome,
         tipo, itens, total, forma_pagamento, status, pago)
       values ($1,$2,'totem',$3,$4,'Cliente do totem','retirada',$5::jsonb,'20.00','cartao','novo',false)
       returning id`,
      [tenant, unidade, `totem-${randomUUID()}`, String(senha),
       JSON.stringify([{ codigo: 'XB1', descricao: 'X-Burguer', quantidade: 1, precoUnitario: 20 }])],
    );
    return r.rows[0].id;
  }
  const liberar = (pedidoId: string): Promise<any> =>
    delivery.liberarPagamentoTotem(tenant, { unidadeId: unidade, equipamentoId: totem }, pedidoId, [
      { forma: 'credito', valor: 20, nsu: '123456', autorizacao: 'A1B2' },
    ]);
  const linhas = (q: string, p: any[]) => pool.query(q, p).then((r) => r.rows);
  const producaoDa = (c: string) => linhas('select * from producao_pedido where comanda_id = $1', [c]);
  const notasDa = (c: string) => linhas('select * from nota_fiscal where comanda_id = $1 order by created_at', [c]);
  const comandaDe = (c: string) => linhas('select * from comanda where id = $1', [c]).then((r) => r[0]);
  const pedidoDe = (p: string) => linhas('select * from pedido_externo where id = $1', [p]).then((r) => r[0]);
  const eventosDa = (notaId: string) =>
    linhas(`select * from fiscal_evento where nota_id = $1 and tp_evento = '110111' order by created_at`, [notaId]);
  const caixaDa = (c: string) =>
    linhas(`select tipo, valor::float as valor, categoria from lancamento_caixa where comanda_id = $1`, [c]);
  const estoqueDa = (c: string) =>
    linhas(`select tipo, quantidade::float as q, ref_tipo from movimento_estoque where ref_id = $1`, [c]);
  const soma = (xs: any[], tipo: string) => xs.filter((x) => x.tipo === tipo).reduce((s, x) => s + Number(x.valor ?? x.q), 0);

  /** SEFAZ que responde tudo certo — e registra cada chamada. */
  const chamadas: any[] = [];
  function sefazOk(extra?: (p: any) => void) {
    chamarSefaz.mockImplementation(async (p: any) => {
      chamadas.push(p);
      extra?.(p);
      if (p.servico === 'NFeAutorizacao4') return retAutorizacao('100', 'Autorizado o uso da NF-e', chaveNfe(p.corpoXml));
      if (p.servico === 'NFeStatusServico4') return RET_STATUS_OK;
      if (p.servico === 'RecepcaoEvento4') return retEvento('135', chaveEvento(p.corpoXml));
      throw new Error(`serviço inesperado no teste: ${p.servico}`);
    });
  }

  beforeAll(async () => {
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    delete process.env.EDGE_MODE; // nuvem: a série é a da nuvem; o fluxo do totem é o mesmo
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste totem fiscal') returning id`)).rows[0].id;
    unidade = (await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [tenant])).rows[0].id;
    // Tabelas só-nuvem que a impressão/produção consultam (o banco do CI simula uma instalação
    // sem elas — ver contingencia.spec).
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool.query(
        `create table if not exists ${t} (id uuid primary key default gen_random_uuid(),
           tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`,
      );
    const item = (await pool.query(`insert into item_estoque (tenant_id, nome) values ($1,'Pão de hambúrguer') returning id`, [tenant])).rows[0].id;
    await pool.query(
      `insert into produto (tenant_id, codigo, nome, ncm, cfop, csosn, origem, unidade_trib, preco_venda,
         vai_para_producao, controla_estoque, item_id)
       values ($1,'XB1','X-Burguer','21069090','5102','102','0','UN','20.00',true,true,$2)`,
      [tenant, item],
    );
    await pool.query(
      `insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente, serie, serie_nuvem,
         cnpj, razao_social, ie, uf, codigo_uf, codigo_municipio, municipio, endereco, bairro, numero, cep,
         url_qrcode_homolog, url_chave_homolog)
       values ($1,null,true,'2',70,71,$2,'Bar de Teste LTDA','13047081','RJ',33,3304557,'Rio de Janeiro',
               'Rua A','Centro','100','21221240',
               'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode','www.fazenda.rj.gov.br/nfce/consulta')`,
      [tenant, CNPJ],
    );
    await salvarCertificado(db, tenant, null, { pfxBase64: pfxValido, senha: SENHA });
    totem = (
      await pool.query(
        `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo)
         values ($1,$2,'Totem 1','totem',$3,true) returning id`,
        [tenant, unidade, randomBytes(8).toString('hex')],
      )
    ).rows[0].id;
  }, 120_000);

  afterAll(async () => {
    if (chaveOriginal === undefined) delete process.env.SEGREDOS_CHAVE;
    else process.env.SEGREDOS_CHAVE = chaveOriginal;
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  beforeEach(async () => {
    chamarSefaz.mockReset();
    chamadas.length = 0;
    // Cada teste começa com a SEFAZ "no ar": a contingência de um não pode vazar para o outro.
    await pool.query(`update fiscal_contingencia set ativa = false where tenant_id = $1`, [tenant]);
  });

  // ── A. os quatro casos do contrato ─────────────────────────────────────────────────────────

  it('loja SEM fiscal ativo: nfce null, a cozinha recebe na hora e a SEFAZ nem é chamada', async () => {
    await pool.query(`update fiscal_config set ativo = false where tenant_id = $1`, [tenant]);
    try {
      const p = await pedidoRetido();
      const r = await liberar(p);
      expect(r.nfce).toBeNull();
      expect(await producaoDa(r.comandaId)).toHaveLength(1);
      expect(chamarSefaz).not.toHaveBeenCalled();
      expect((await pedidoDe(p)).status).toBe('confirmado');
    } finally {
      await pool.query(`update fiscal_config set ativo = true where tenant_id = $1`, [tenant]);
    }
  });

  it('ESTE totem desmarcado (presidente/gerência, mig 288) vale como "sem fiscal": nfce null', async () => {
    await pool.query(`update equipamento set emite_nfce = false where id = $1`, [totem]);
    try {
      const r = await liberar(await pedidoRetido());
      expect(r.nfce).toBeNull();
      expect(await producaoDa(r.comandaId)).toHaveLength(1);
      expect(chamarSefaz).not.toHaveBeenCalled();
    } finally {
      await pool.query(`update equipamento set emite_nfce = null where id = $1`, [totem]);
    }
  });

  it('AUTORIZADA: resumo + danfe + via false — e a cozinha só recebe DEPOIS da nota', async () => {
    let producaoNaHoraDaSefaz = -1;
    sefazOk();
    chamarSefaz.mockImplementationOnce(async (p: any) => {
      chamadas.push(p);
      // No instante em que a nota está na SEFAZ, a cozinha ainda NÃO pode ter o pedido.
      const [{ n }] = await linhas(
        `select count(*)::int n from producao_pedido pp join nota_fiscal nf on nf.comanda_id = pp.comanda_id
          where nf.chave = $1`,
        [chaveNfe(p.corpoXml)],
      );
      producaoNaHoraDaSefaz = n;
      return retAutorizacao('100', 'Autorizado o uso da NF-e', chaveNfe(p.corpoXml));
    });
    const p = await pedidoRetido();
    const r = await liberar(p);

    expect(r.nfce).toMatchObject({
      status: 'autorizada', protocolo: '333260002547395', contingencia: false, viaEstabelecimento: false,
    });
    expect(r.nfce.danfe).toContain('DANFE NFC-e');
    expect(r.nfce.danfe).toContain('Protocolo: 333260002547395');
    expect(r.nfce.danfe).toContain('PROCON-RJ');
    expect(producaoNaHoraDaSefaz).toBe(0);
    expect(await producaoDa(r.comandaId)).toHaveLength(1);
    // O prazo curto do totem chegou à chamada da SEFAZ — é o que garante a resposta em segundos.
    expect(chamadas[0].prazoTotalMs).toBe(PRAZO_AUTORIZACAO_TOTEM_MS);
    // Quem imprime é o totem: a loja não enfileira DANFE nenhuma.
    expect(await linhas(`select 1 from impressao_job where comanda_id = $1 and via = 'fiscal'`, [r.comandaId])).toHaveLength(0);
    expect(await pedidoDe(p)).toMatchObject({ status: 'confirmado', pago: true });
  });

  it('CONTINGÊNCIA (SEFAZ muda): danfe com a tarja, protocolo null — e o totem NÃO estorna', async () => {
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('timeout'));
    const r = await liberar(await pedidoRetido());
    expect(r.nfce).toMatchObject({ status: 'contingencia', protocolo: null, contingencia: true, viaEstabelecimento: false });
    expect(r.nfce.danfe).toContain('EMITIDA EM CONTINGENCIA');
    expect(await producaoDa(r.comandaId)).toHaveLength(1); // contingência é aprovação

    // A 2ª via (do estabelecimento) segue a configuração da loja (mig 287).
    await pool.query(`update fiscal_config set contingencia_via_estabelecimento = true where tenant_id = $1`, [tenant]);
    try {
      const r2 = await liberar(await pedidoRetido());
      expect(r2.nfce).toMatchObject({ status: 'contingencia', viaEstabelecimento: true });
    } finally {
      await pool.query(`update fiscal_config set contingencia_via_estabelecimento = false where tenant_id = $1`, [tenant]);
    }
  });

  it('SEFAZ que não responde no prazo do totem → contingência, com a resposta em até 15 s', async () => {
    chamarSefaz.mockImplementation(
      (p: any) =>
        new Promise((_, rejeita) => {
          // Como a SEFAZ muda de verdade: só o prazo da chamada a interrompe. Sem prazo, nunca.
          if (p.prazoTotalMs)
            setTimeout(() => rejeita(new SefazInalcancavel(`ETIMEDOUT — prazo de ${p.prazoTotalMs} ms esgotado`, 'ETIMEDOUT')), p.prazoTotalMs);
        }),
    );
    const t0 = Date.now();
    const r = await liberar(await pedidoRetido());
    const segundos = (Date.now() - t0) / 1000;
    expect(r.nfce.status).toBe('contingencia');
    expect(segundos).toBeLessThan(15);
  }, 40_000);

  it('REJEITADA: nao_emitida com a etapa e o cStat; sem cozinha; estoque e caixa revertidos; pedido cancelado', async () => {
    chamarSefaz.mockImplementation(async (p: any) =>
      retAutorizacao('225', 'Rejeicao: Falha no Schema XML da NFe', chaveNfe(p.corpoXml)),
    );
    const p = await pedidoRetido();
    const r = await liberar(p);

    expect(r.nfce).toEqual({
      status: 'nao_emitida',
      danfe: null,
      erro: { etapa: 'rejeitada', codigo: '225', motivo: expect.stringContaining('225'), repete: false },
    });
    expect(await producaoDa(r.comandaId)).toHaveLength(0); // a cozinha nunca soube
    const c = await comandaDe(r.comandaId);
    expect(c.status).toBe('cancelada');
    expect(c.motivo_cancelamento).toMatch(/^NFC-e não emitida \(rejeitada 225\): /);
    const caixa = await caixaDa(r.comandaId);
    expect(soma(caixa, 'entrada')).toBeCloseTo(20);
    expect(soma(caixa, 'saida')).toBeCloseTo(20); // estornado, na mesma forma
    const estoque = await estoqueDa(r.comandaId);
    expect(soma(estoque, 'saida')).toBeCloseTo(1);
    expect(soma(estoque, 'entrada')).toBeCloseTo(1); // o pão voltou para a prateleira
    expect(await pedidoDe(p)).toMatchObject({
      status: 'cancelado', comanda_id: r.comandaId, motivo_cancelamento: c.motivo_cancelamento,
    });

    // A repetição devolve o MESMO resultado — sem tentar emitir de novo.
    chamarSefaz.mockReset();
    const r2 = await liberar(p);
    expect(r2.nfce).toEqual(r.nfce);
    expect(chamarSefaz).not.toHaveBeenCalled();
  });

  it('CERTIFICADO VENCIDO: barrado no pré-voo, ANTES do número — configuracao, repete (ERR-099)', async () => {
    // O certificado da loja vale por 60 dias; o relógio do PROCESSO é adiantado 90 dias — só o
    // `Date`: timers, rede e banco seguem reais. Nada de "certificado que vence em segundos":
    // sob carga, ele venceria no próprio cadastro (que exige validade) e o teste mentiria.
    const [antes] = await linhas(`select proximo_numero from fiscal_serie where tenant_id = $1`, [tenant]);
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('ECONNRESET')); // o que o TLS faria
    const pedido = await pedidoRetido();
    jest.useFakeTimers({
      now: Date.now() + 90 * 86_400_000,
      doNotFake: [
        'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate',
        'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
      ],
    });
    let r: any;
    try {
      r = await liberar(pedido);
    } finally {
      jest.useRealTimers();
    }

    expect(r.nfce).toMatchObject({ status: 'nao_emitida', danfe: null, erro: { etapa: 'configuracao', codigo: null, repete: true } });
    expect(r.nfce.erro.motivo).toMatch(/vencido/);
    expect(chamarSefaz).not.toHaveBeenCalled(); // nem contingência, nem SEFAZ
    expect(await notasDa(r.comandaId)).toHaveLength(0); // nenhum número gasto
    const [depois] = await linhas(`select proximo_numero from fiscal_serie where tenant_id = $1`, [tenant]);
    expect(depois?.proximo_numero).toBe(antes?.proximo_numero);
    expect(await producaoDa(r.comandaId)).toHaveLength(0);
  });

  it('SEM CONTINGÊNCIA (SEFAZ muda e a contingência não entra): nao_emitida — e a pendente fica com o cancelamento AGENDADO', async () => {
    const espiao = jest
      .spyOn(fiscal as any, 'entrarEmContingencia')
      .mockRejectedValueOnce(new Error('banco indisponível'));
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('timeout'));
    try {
      const r = await liberar(await pedidoRetido());
      expect(r.nfce).toMatchObject({ status: 'nao_emitida', erro: { etapa: 'sem_contingencia', repete: true } });
      const [pendente] = await notasDa(r.comandaId);
      expect(pendente.status).toBe('pendente'); // foi à SEFAZ; pode ter sido autorizada
      const [ev] = await eventosDa(pendente.id);
      expect(ev).toMatchObject({ status: 'agendado', tp_evento: '110111' }); // se aparecer, é cancelada
      expect((await comandaDe(r.comandaId)).status).toBe('cancelada');
      expect(await producaoDa(r.comandaId)).toHaveLength(0);
    } finally {
      espiao.mockRestore();
    }
  });

  it('HTTP 5xx sem SOAP Fault: no totem é silêncio (contingência) — não se diz "não emitida" sem certeza', async () => {
    chamarSefaz.mockRejectedValue(new SefazRecusouChamada('HTTP 504 — Gateway Timeout', 504));
    const r = await liberar(await pedidoRetido());
    expect(r.nfce.status).toBe('contingencia');
  });

  // ── C. a repetição nunca perde o DANFE ───────────────────────────────────────────────────

  it('REPETIÇÃO da liberação: a MESMA nfce, com o MESMO danfe (remontado do XML) — sem emitir de novo', async () => {
    sefazOk();
    const p = await pedidoRetido();
    const r1 = await liberar(p);
    chamarSefaz.mockReset(); // qualquer emissão nova agora falharia

    const r2 = await liberar(p);
    expect(r2.idempotente).toBe(true);
    expect(r2.nfce.chave).toBe(r1.nfce.chave);
    expect(r2.nfce.danfe).toBe(r1.nfce.danfe);
    expect(r2.nfce).toEqual(r1.nfce);
    expect(chamarSefaz).not.toHaveBeenCalled();
    expect(await notasDa(r1.comandaId)).toHaveLength(1);
    expect(await producaoDa(r1.comandaId)).toHaveLength(1); // a cozinha não recebe duas vezes
  });

  // ── B. os outros caminhos continuam como eram ────────────────────────────────────────────

  it('emitirSeAtivo (PDV, balcão, delivery): igual a antes — null na falha, prazo de sempre, nada desfeito', async () => {
    const venda = async () => {
      const c = (
        await pool.query(
          `insert into comanda (tenant_id, unidade_id, status, forma, total) values ($1,$2,'fechada','dinheiro','20.00') returning id`,
          [tenant, unidade],
        )
      ).rows[0].id;
      const [prod] = await linhas(`select id from produto where tenant_id = $1 and codigo = 'XB1'`, [tenant]);
      await pool.query(
        `insert into comanda_item (tenant_id, comanda_id, produto_id, descricao, quantidade, preco_unitario)
         values ($1,$2,$3,'X-Burguer',1,'20.00')`,
        [tenant, c, prod.id],
      );
      return c;
    };
    chamarSefaz.mockImplementation(async (p: any) => {
      chamadas.push(p);
      return retAutorizacao('225', 'Rejeicao: Falha no Schema XML da NFe', chaveNfe(p.corpoXml));
    });
    const c1 = await venda();
    expect(await fiscal.emitirSeAtivo(tenant, null, c1, unidade)).toBeNull();
    expect((await comandaDe(c1)).status).toBe('fechada'); // o caixa não trava nem desfaz
    expect(chamadas[0].prazoTotalMs).toBeUndefined(); // os 30 s de sempre

    // E o 504 fora do totem segue sendo recusa (não vira contingência).
    chamarSefaz.mockReset();
    chamarSefaz.mockRejectedValue(new SefazRecusouChamada('HTTP 504 — Gateway Timeout', 504));
    const c2 = await venda();
    expect(await fiscal.emitirSeAtivo(tenant, null, c2, unidade)).toBeNull();
    expect((await notasDa(c2)).map((n: any) => n.status)).toEqual(['rejeitada']);
  });

  // ── F. o DANFE não saiu no papel ────────────────────────────────────────────────────────

  it('falha-impressao com nota AUTORIZADA: evento 110111, venda desfeita, cozinha cancelada, pedido cancelado', async () => {
    sefazOk();
    const p = await pedidoRetido();
    const r = await liberar(p);
    expect(r.nfce.status).toBe('autorizada');
    chamadas.length = 0;

    const f = await delivery.falhaImpressaoTotem(tenant, p, 'papel acabou');
    expect(f).toEqual({ ok: true, notaCancelada: true, cancelamentoPendente: false });

    const evento = chamadas.find((c) => c.servico === 'RecepcaoEvento4');
    expect(evento.corpoXml).toContain('<tpEvento>110111</tpEvento>');
    expect(evento.corpoXml).toContain('Cupom fiscal nao impresso no totem; venda desfeita');
    expect(evento.prazoTotalMs).toBe(PRAZO_AUTORIZACAO_TOTEM_MS);
    const [nota] = await notasDa(r.comandaId);
    expect(nota.status).toBe('cancelada');
    expect((await eventosDa(nota.id)).map((e: any) => e.status)).toEqual(['registrado']);
    expect((await comandaDe(r.comandaId)).status).toBe('cancelada');
    expect((await producaoDa(r.comandaId)).map((x: any) => x.status)).toEqual(['cancelado']);
    const caixa = await caixaDa(r.comandaId);
    expect(soma(caixa, 'saida')).toBeCloseTo(soma(caixa, 'entrada'));
    expect(await pedidoDe(p)).toMatchObject({ status: 'cancelado', motivo_cancelamento: 'Cupom fiscal não impresso no totem: papel acabou' });

    // Repetir não desfaz de novo nem manda outro evento.
    chamadas.length = 0;
    expect(await delivery.falhaImpressaoTotem(tenant, p, 'papel acabou')).toEqual(f);
    expect(chamadas.filter((c) => c.servico === 'RecepcaoEvento4')).toHaveLength(0);
    expect(soma(await caixaDa(r.comandaId), 'saida')).toBeCloseTo(20);
  });

  it('falha-impressao em CONTINGÊNCIA: nunca inutilizada — agendada, e cancelada quando a fila a autoriza', async () => {
    chamarSefaz.mockRejectedValue(new SefazInalcancavel('timeout'));
    const p = await pedidoRetido();
    const r = await liberar(p);
    expect(r.nfce.status).toBe('contingencia');

    const f = await delivery.falhaImpressaoTotem(tenant, p, 'impressora sem papel');
    expect(f).toEqual({ ok: true, notaCancelada: false, cancelamentoPendente: true });
    // A venda tem DUAS notas: a que foi à SEFAZ sem resposta (pendente) e a de contingência que
    // saiu no papel. As duas ficam com o cancelamento agendado — qualquer uma que venha a valer
    // é cancelada.
    const notas = await notasDa(r.comandaId);
    expect(notas.map((n: any) => n.status)).toEqual(['pendente', 'contingencia']);
    for (const n of notas) expect((await eventosDa(n.id)).map((e: any) => e.status)).toEqual(['agendado']);
    const nota = notas[1];
    expect(nota.status).toBe('contingencia'); // continua na fila: número de contingência não se inutiliza
    expect((await eventosDa(nota.id)).map((e: any) => e.status)).toEqual(['agendado']);
    const lacunas: any = await fiscal.lacunas(tenant, unidade);
    expect(lacunas.flatMap((s: any) => s.faixas.map((x: any) => x.inicio))).not.toContain(Number(nota.numero));
    expect((await comandaDe(r.comandaId)).status).toBe('cancelada'); // a venda já foi desfeita

    // A SEFAZ volta: a fila autoriza a nota e o cancelamento agendado sai em seguida. (O ciclo
    // limitado à empresa do teste — no CI as specs dividem o banco; ver ERR-105.)
    sefazOk();
    await fiscal.transmitirContingencia({ tenantIds: [tenant] });
    const depois = (await notasDa(r.comandaId)).find((n: any) => n.id === nota.id);
    expect(depois.status).toBe('cancelada');
    expect((await eventosDa(nota.id)).map((e: any) => e.status)).toEqual(['registrado']);
  });

  it('cancelamento SEM RESPOSTA da SEFAZ: fica pendente, e o job resolve pela consulta', async () => {
    sefazOk();
    const p = await pedidoRetido();
    const r = await liberar(p);
    chamarSefaz.mockImplementation(async (x: any) => {
      if (x.servico === 'RecepcaoEvento4') throw new SefazInalcancavel('timeout');
      throw new Error(`serviço inesperado: ${x.servico}`);
    });

    const f = await delivery.falhaImpressaoTotem(tenant, p, 'papel enroscou');
    expect(f).toEqual({ ok: true, notaCancelada: false, cancelamentoPendente: true });
    const [nota] = await notasDa(r.comandaId);
    expect(nota.status).toBe('autorizada');
    expect((await eventosDa(nota.id)).map((e: any) => e.status)).toEqual(['pendente']);

    // Passados os 6 minutos de respiro (limite de consultas da SEFAZ), a consulta diz: cancelada.
    // (O relógio é recuado com `regem.sync` ligado: fora dele o gatilho da mig 259 carimbaria
    // `updated_at = now()` por cima do valor do teste.)
    const cli = await pool.connect();
    try {
      await cli.query('begin');
      await cli.query(`set local regem.sync = 'on'`);
      await cli.query(`update fiscal_evento set updated_at = now() - interval '7 minutes' where nota_id = $1`, [nota.id]);
      await cli.query('commit');
    } finally {
      cli.release();
    }
    chamarSefaz.mockImplementation(async (x: any) => {
      if (x.servico === 'NFeConsultaProtocolo4') return retConsultaCancelada(nota.chave);
      throw new Error(`serviço inesperado: ${x.servico}`);
    });
    await fiscal.rodarCancelamentosAgendados();
    expect((await notasDa(r.comandaId))[0].status).toBe('cancelada');
    expect((await eventosDa(nota.id)).map((e: any) => e.status)).toEqual(['registrado']);
  });

  it('pedido que ainda não virou venda: falha-impressao é recusada com o motivo', async () => {
    await expect(delivery.falhaImpressaoTotem(tenant, await pedidoRetido(), 'x')).rejects.toThrow(/ainda não virou venda/);
  });
});
