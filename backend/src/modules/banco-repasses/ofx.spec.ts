import { ArquivoRecusado, LIMITE_DE_BYTES, LIMITE_DE_LINHAS, centavosDe, diaDe, lerOfx } from './ofx';

// O leitor de OFX (R1 da versão 8 do Mister): os dois formatos, os charsets, o dia que não escorrega, o valor sem ponto
// flutuante e o arquivo que não é extrato. Dados inventados.

const SGML = (corpo: string, charset = '1252', conta = '12345-6', banco = '0341') => `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:${charset}
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261123120000[-3:BRT]<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>${banco}<BRANCHID>1234<ACCTID>${conta}<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261101000000[-3:BRT]<DTEND>20261122235959[-3:BRT]
${corpo}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>3842,00<DTASOF>20261122[-3:BRT]</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const linhaSgml = (data: string, valor: string, fitid: string, memo: string, extra = '') =>
  `<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${data}<TRNAMT>${valor}<FITID>${fitid}${extra}<MEMO>${memo}</STMTTRN>`;

const XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <!-- <STMTTRN><TRNAMT>999.99</TRNAMT></STMTTRN> -->
  <BANKMSGSRSV1><STMTTRNRS><STMTRS>
    <CURDEF>BRL</CURDEF>
    <BANKACCTFROM><BANKID>237</BANKID><BRANCHID>0001</BRANCHID><ACCTID>0098765-4</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
    <BANKTRANLIST>
      <DTSTART>20261101</DTSTART><DTEND>20261110</DTEND>
      <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261105220000.000[-3:BRT]</DTPOSTED><TRNAMT>-1234.56</TRNAMT><FITID>A1</FITID><NAME>PADARIA &amp; CIA</NAME><MEMO><![CDATA[BOLETO Açaí]]></MEMO><CHECKNUM>77</CHECKNUM></STMTTRN>
      <STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261106</DTPOSTED><TRNAMT>10.5</TRNAMT><FITID>A2</FITID><MEMO>PIX RECEBIDO</MEMO></STMTTRN>
    </BANKTRANLIST>
    <LEDGERBAL><BALAMT>1000.00</BALAMT><DTASOF>20261110</DTASOF></LEDGERBAL>
    <AVAILBAL><BALAMT>5.00</BALAMT><DTASOF>20261101</DTASOF></AVAILBAL>
  </STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const motivo = (b: Buffer | string) => {
  try {
    lerOfx(Buffer.isBuffer(b) ? b : Buffer.from(b));
    return 'leu';
  } catch (e) {
    if (e instanceof ArquivoRecusado) return e.motivo;
    throw e;
  }
};

describe('leitor de OFX', () => {
  describe('o valor, em centavos', () => {
    it.each([
      ['-1234.56', -123456],
      ['1234,56', 123456],
      ['1.234,56', 123456],
      ['1,234.56', 123456],
      ['-1.234.567,89', -123456789],
      ['10.5', 1050],
      ['10,50', 1050],
      ['0.07', 7],
      ['+15', 1500],
      ['1.234.567', 123456700],
      ['19.99', 1999],
      ['1234567.89', 123456789],
    ])('%s = %d', (t, c) => expect(centavosDe(t)).toBe(c));

    it.each(['', 'abc', '12a', '1,2,3', '12.34,56', '1..2', '1.234,567', '--5', '1e5', 'NaN', '99999999999999,00', '1.23.456', '1.234', '1,234', '12.500', '1.000', '1234.567'])('recusa "%s"', (t) =>
      expect(centavosDe(t)).toBeNull(),
    );

    it('não perde centavo onde o ponto flutuante perderia', () => {
      expect(centavosDe('1.10')).toBe(110);
      expect(centavosDe('4.35')).toBe(435);
      expect(centavosDe('1000000.29')).toBe(100000029);
    });
  });

  describe('o dia, no fuso do arquivo', () => {
    it.each([
      ['20261122', '2026-11-22'],
      ['20261122235959', '2026-11-22'],
      ['20261122235959.999', '2026-11-22'],
      ['20261122235959[-3:BRT]', '2026-11-22'],
      ['20261122000000[-3:BRT]', '2026-11-22'],
      ['20261122213000.000[-03:EST]', '2026-11-22'],
      ['20261122010000[+9:JST]', '2026-11-22'],
      ['20240229', '2024-02-29'],
    ])('%s = %s', (t, d) => expect(diaDe(t)).toBe(d));

    it.each(['', '2026', '20261301', '20260231', '20250229', 'abcdefgh', '2026112', '20261122<x>'])('recusa "%s"', (t) => expect(diaDe(t)).toBeNull());
  });

  it('SGML: tags sem fechar, conta, período, saldo e as linhas', () => {
    const e = lerOfx(Buffer.from(SGML(`${linhaSgml('20261105', '-1.234,56', 'F1', 'BOLETO FORNECEDOR')}\n${linhaSgml('20261106220000[-3:BRT]', '500.00', 'F2', 'PIX RECEBIDO', '<CHECKNUM>123<NAME>LOJA')}`), 'latin1'));
    expect(e).toMatchObject({ banco: '341', finalDaConta: '3456', periodoDe: '2026-11-01', periodoAte: '2026-11-22', saldoCentavos: 384200, saldoEm: '2026-11-22', recusadas: 0 });
    expect(e.linhas).toHaveLength(2);
    expect(e.linhas[0]).toMatchObject({ tipo: 'CREDIT', data: '2026-11-05', valorCentavos: -123456, fitid: 'F1', memo: 'BOLETO FORNECEDOR' });
    expect(e.linhas[1]).toMatchObject({ data: '2026-11-06', valorCentavos: 50000, numeroDoCheque: '123', nome: 'LOJA' });
  });

  it('o número inteiro da conta não sai do leitor', () => {
    const e = lerOfx(Buffer.from(SGML(linhaSgml('20261105', '1,00', 'F1', 'X'), '1252', '9876543-2')));
    expect(JSON.stringify(e)).not.toContain('9876543');
    expect(e.finalDaConta).toBe('5432');
  });

  it('XML: fecha as tags, ignora comentário, entende CDATA e entidade, e o saldo é o LEDGERBAL (não o AVAILBAL)', () => {
    const e = lerOfx(Buffer.from(XML, 'utf8'));
    expect(e).toMatchObject({ banco: '237', finalDaConta: '7654', periodoDe: '2026-11-01', periodoAte: '2026-11-10', saldoCentavos: 100000, saldoEm: '2026-11-10' });
    expect(e.linhas).toHaveLength(2);
    expect(e.linhas[0]).toMatchObject({ data: '2026-11-05', valorCentavos: -123456, nome: 'PADARIA & CIA', memo: 'BOLETO Açaí', numeroDoCheque: '77' });
    expect(e.linhas[1].valorCentavos).toBe(1050);
  });

  it('charset: 1252, ISO-8859-1 e UTF-8 com BOM mantêm os acentos', () => {
    const memo = 'CAFÉ AÇÃO';
    const corpo = linhaSgml('20261105', '1,00', 'F1', memo);
    expect(lerOfx(Buffer.from(SGML(corpo, '1252'), 'latin1')).linhas[0].memo).toBe(memo);
    expect(lerOfx(Buffer.from(SGML(corpo, 'ISO-8859-1'), 'latin1')).linhas[0].memo).toBe(memo);
    const utf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(XML.replace('PIX RECEBIDO', memo), 'utf8')]);
    expect(lerOfx(utf).linhas[1].memo).toBe(memo);
  });

  it('o banco que declara UTF-8 e grava em 1252 não vira lixo', () => {
    const t = XML.replace('PIX RECEBIDO', 'CAFÉ');
    expect(lerOfx(Buffer.from(t, 'latin1')).linhas[1].memo).toBe('CAFÉ');
  });

  it('banco que não informa o período: vale o primeiro e o último dia com lançamento', () => {
    const t = `<OFX><STMTRS><BANKACCTFROM><BANKID>1<ACCTID>1111</BANKACCTFROM><BANKTRANLIST>${linhaSgml('20261110', '1,00', 'F1', 'A')}${linhaSgml('20261103', '2,00', 'F2', 'B')}</BANKTRANLIST></STMTRS></OFX>`;
    expect(lerOfx(Buffer.from(t))).toMatchObject({ periodoDe: '2026-11-03', periodoAte: '2026-11-10' });
  });

  it('linha com valor ou data ilegível fica de fora e é contada', () => {
    const e = lerOfx(
      Buffer.from(SGML(`${linhaSgml('20261105', 'abc', 'F1', 'A')}${linhaSgml('20261301', '1,00', 'F2', 'B')}${linhaSgml('20261106', '2,00', 'F3', 'C')}`)),
    );
    expect(e.recusadas).toBe(2);
    expect(e.linhas.map((l) => l.fitid)).toEqual(['F3']);
  });

  describe('o que não é extrato', () => {
    it('PDF, planilha, vazio e texto qualquer', () => {
      expect(motivo(Buffer.from('%PDF-1.7 ...'))).toBe('pdf');
      expect(motivo(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe('planilha');
      expect(motivo(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).toBe('planilha');
      expect(motivo(Buffer.alloc(0))).toBe('vazio');
      expect(motivo('data;valor\n01/11;10,00')).toBe('nao_ofx');
      expect(motivo('<html><body>OFX</body></html>')).toBe('nao_ofx');
      expect(motivo('<OFX></OFX>')).toBe('sem_conta');
    });

    it('fatura de cartão e arquivo com duas contas', () => {
      expect(motivo('<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CCACCTFROM><ACCTID>4111</CCACCTFROM></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>')).toBe('cartao');
      const duas = `<OFX><STMTRS><BANKACCTFROM><BANKID>1<ACCTID>1111</BANKACCTFROM></STMTRS><STMTRS><BANKACCTFROM><BANKID>1<ACCTID>2222</BANKACCTFROM></STMTRS></OFX>`;
      expect(motivo(duas)).toBe('varias_contas');
    });

    it('arquivo sem conta', () => {
      expect(motivo(`<OFX><STMTRS><BANKACCTFROM><BANKID>1</BANKACCTFROM><BANKTRANLIST>${linhaSgml('20261105', '1,00', 'F1', 'X')}</BANKTRANLIST></STMTRS></OFX>`)).toBe('sem_conta');
    });
  });

  describe('arquivo vindo de fora', () => {
    it('recusa acima do limite de tamanho, antes de ler', () => {
      expect(motivo(Buffer.alloc(LIMITE_DE_BYTES + 1, 0x20))).toBe('grande');
    });

    it('recusa acima do limite de linhas', () => {
      const linha = '<STMTTRN><DTPOSTED>20261105<TRNAMT>1<FITID>x</STMTTRN>';
      const t = `<OFX><STMTRS><BANKACCTFROM><BANKID>1<ACCTID>1111</BANKACCTFROM><BANKTRANLIST>${linha.repeat(LIMITE_DE_LINHAS + 1)}</BANKTRANLIST></STMTRS></OFX>`;
      expect(Buffer.byteLength(t)).toBeLessThanOrEqual(LIMITE_DE_BYTES);
      expect(motivo(t)).toBe('muitas_linhas');
    });

    it('entrada feita para travar a leitura termina em tempo linear', () => {
      const casos = [
        `<OFX>${'<'.repeat(2_000_000)}`,
        `<OFX>${'<A'.repeat(1_000_000)}`,
        `<OFX><MEMO>${'&'.repeat(2_000_000)}`,
        `<OFX><MEMO>${'&#'.repeat(1_000_000)}`,
        `<OFX>${'<!--'.repeat(500_000)}`,
        `<OFX>${'<STMTTRN>'.repeat(200_000)}`,
      ];
      for (const t of casos) {
        const ini = Date.now();
        motivo(t);
        expect(Date.now() - ini).toBeLessThan(4000);
      }
      expect(centavosDe(`${'1,'.repeat(5000)}1`)).toBeNull();
    });

    it('campo gigante é cortado', () => {
      const e = lerOfx(Buffer.from(SGML(linhaSgml('20261105', '1,00', 'F1', 'A'.repeat(100_000)))));
      expect(e.linhas[0].memo.length).toBeLessThanOrEqual(512);
    });
  });
});
