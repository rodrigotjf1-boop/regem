import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateXML } from 'xmllint-wasm';
import { lerSituacao, montarConsSitNFe } from './consulta-protocolo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONSULTA DA SITUAÇÃO PELA CHAVE — leitura das respostas da SEFAZ.
//
// É a pergunta que desfaz o único estado que não se resolve sozinho ("enviei e não sei o que
// virou"). Errar a leitura aqui tem dois custos opostos e igualmente graves: dar por autorizada
// uma nota que não existe (venda sem documento) ou dar por inexistente uma que existe (segunda
// nota para a mesma venda). Por isso cada código tem um caso.

const CHAVE = '33260936219750000104650510000000021552821127';

const ret = (cStat: string, xMotivo: string, extra = '') =>
  `<retConsSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>` +
  `<verAplic>SVRS</verAplic><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo><cUF>33</cUF>` +
  `<chNFe>${CHAVE}</chNFe>${extra}</retConsSitNFe>`;
const prot = (cStat: string, xMotivo: string, comProtocolo = true) =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${CHAVE}</chNFe>` +
  `<dhRecbto>2026-09-22T20:56:00-03:00</dhRecbto>${comProtocolo ? '<nProt>333260002547395</nProt>' : ''}` +
  `<digVal>abc=</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;

describe('o que a SEFAZ responde sobre uma nota', () => {
  it('100 com protocolo: AUTORIZADA — e devolve o protNFe para montar o documento', () => {
    const r: any = lerSituacao(ret('100', 'Autorizado o uso da NF-e', prot('100', 'Autorizado o uso da NF-e')));
    expect(r).toMatchObject({ situacao: 'autorizada', protocolo: '333260002547395', cStat: '100' });
    expect(r.protNFe).toContain('<infProt');
    expect(r.dhRecbto).toBe('2026-09-22T20:56:00-03:00');
  });

  it('217 "não consta na base": INEXISTENTE — é o único código que libera o número', () => {
    expect(lerSituacao(ret('217', 'NF-e nao consta na base de dados da SEFAZ'))).toMatchObject({
      situacao: 'inexistente',
      cStat: '217',
    });
  });

  it('cancelada, pelo código da raiz ou pelo evento de cancelamento', () => {
    expect(lerSituacao(ret('101', 'Cancelamento de NF-e homologado')).situacao).toBe('cancelada');
    const comEvento = ret(
      '100',
      'Autorizado o uso da NF-e',
      prot('100', 'Autorizado o uso da NF-e') +
        '<procEventoNFe versao="1.00"><retEvento><infEvento><cStat>135</cStat>' +
        '<xMotivo>Evento registrado e vinculado a NF-e</xMotivo><tpEvento>110111</tpEvento></infEvento></retEvento></procEventoNFe>',
    );
    expect(lerSituacao(comEvento).situacao).toBe('cancelada');
  });

  it.each([['110', 'Uso Denegado'], ['301', 'Uso Denegado: Irregularidade fiscal do emitente'], ['302', 'Uso Denegado: Irregularidade fiscal do destinatario']])(
    'denegada (%s): a nota EXISTE na base — o número está consumido e nunca volta',
    (cStat, xMotivo) => {
      expect(lerSituacao(ret(cStat, xMotivo, prot(cStat, xMotivo, false)))).toMatchObject({
        situacao: 'denegada',
        cStat,
      });
    },
  );

  it('100 SEM protNFe não vira autorizada — sem protocolo não há documento', () => {
    expect(lerSituacao(ret('100', 'Autorizado o uso da NF-e')).situacao).toBe('indefinido');
  });

  it.each([['226', 'UF do emitente diverge'], ['236', 'Chave de Acesso com digito verificador invalido'], ['999', 'Erro nao catalogado']])(
    'código não conclusivo (%s) = INDEFINIDO: não se decide nada e a nota continua pendente',
    (cStat, xMotivo) => {
      expect(lerSituacao(ret(cStat, xMotivo)).situacao).toBe('indefinido');
    },
  );
});

describe('o pedido de consulta', () => {
  it('é montado como a SEFAZ espera, e VALIDA contra o schema oficial', async () => {
    const xml = montarConsSitNFe(CHAVE, '2');
    expect(xml).toContain('<xServ>CONSULTAR</xServ>');
    const XSD = join(__dirname, '..', 'xsd');
    const arq = (n: string) => ({ fileName: n, contents: readFileSync(join(XSD, n), 'utf8') });
    const r = await validateXML({
      xml: [{ fileName: 'cons.xml', contents: xml }],
      schema: [arq('consSitNFe_v4.00.xsd')],
      preload: ['leiauteConsSitNFe_v4.00.xsd', 'tiposBasico_v4.00.xsd', 'xmldsig-core-schema_v1.01.xsd'].map(arq),
    });
    expect({ valido: r.valid, erros: (r.errors ?? []).map((e: any) => e.message).join(' | ') }).toEqual({
      valido: true,
      erros: '',
    });
  }, 120000);

  it('chave inválida nem chega a sair daqui', () => {
    expect(() => montarConsSitNFe('123', '2')).toThrow(/44 d/i);
  });
});
