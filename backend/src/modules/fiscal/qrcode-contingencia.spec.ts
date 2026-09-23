import { createVerify, generateKeyPairSync } from 'node:crypto';
import { montarQrCodeV3, montarQrCodeV3Offline } from './chave';

/* eslint-disable @typescript-eslint/no-explicit-any */

// QR CODE DA NFC-e EMITIDA EM CONTINGÊNCIA OFF-LINE (tpEmis=9), VERSÃO 3.
//
// Na v3 não existe CSC: a autenticidade do QR vem da ASSINATURA dos próprios parâmetros com o
// certificado da loja (Manual do DANFE NFC-e e QR Code v6.0, §4.4.2, Tabela 7). Errar a
// composição não dá erro em lugar nenhum — dá um cupom com QR que o consumidor não consegue
// consultar, e depois a rejeição **583** ("Valor da assinatura do qrCode difere do calculado")
// quando a nota for transmitida.
//
// A ordem é: chave | 3 | tpAmb | DIA da emissão | vNF | tipo do destinatário | destinatário |
// assinatura. Sem destinatário, os dois campos ficam VAZIOS e os separadores permanecem.

const CHAVE = '33260936219750000104650510000000011552821127';
const URL = 'https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

const partes = (qr: string) => qr.slice(qr.indexOf('?p=') + 3).split('|');

describe('QR Code v3 off-line (contingência)', () => {
  it('leva os oito parâmetros, na ordem do manual', () => {
    const { qrCode } = montarQrCodeV3Offline({
      chave: CHAVE, tpAmb: '2', dhEmi: '2026-09-23T14:05:00-03:00', vNF: 37.5,
      destTipo: '2', destDocumento: '111.444.777-35', chavePrivadaPem: PEM, urlConsulta: URL,
    });
    const p = partes(qrCode);
    expect(p).toHaveLength(8);
    expect(p[0]).toBe(CHAVE);
    expect(p[1]).toBe('3');
    expect(p[2]).toBe('2');
    expect(p[3]).toBe('23'); // só o DIA, com dois dígitos
    expect(p[4]).toBe('37.50'); // ponto decimal, sem separador de milhar
    expect(p[5]).toBe('2'); // 2 = CPF
    expect(p[6]).toBe('11144477735');
  });

  it('a assinatura é RSA-SHA1 dos parâmetros 1 a 7, COM os separadores', () => {
    const { qrCode, assinatura } = montarQrCodeV3Offline({
      chave: CHAVE, tpAmb: '1', dhEmi: '2026-09-23T14:05:00-03:00', vNF: 10,
      chavePrivadaPem: PEM, urlConsulta: URL,
    });
    const p = partes(qrCode);
    const assinado = p.slice(0, 7).join('|');
    const ok = createVerify('RSA-SHA1').update(assinado, 'utf8').verify(publicKey, assinatura, 'base64');
    expect(ok).toBe(true);
    // E não é a assinatura de outra coisa: mudar um centavo invalida.
    const outro = createVerify('RSA-SHA1').update(assinado.replace('|10.00|', '|10.01|'), 'utf8');
    expect(outro.verify(publicKey, assinatura, 'base64')).toBe(false);
  });

  it('sem destinatário, os campos 6 e 7 ficam vazios — e os separadores ficam', () => {
    const { qrCode } = montarQrCodeV3Offline({
      chave: CHAVE, tpAmb: '2', dhEmi: '2026-09-23T14:05:00-03:00', vNF: 5,
      chavePrivadaPem: PEM, urlConsulta: URL,
    });
    expect(qrCode).toContain(`p=${CHAVE}|3|2|23|5.00||`);
    expect(partes(qrCode)).toHaveLength(8);
  });

  it('CNPJ no destinatário vira tipo 1 sem ninguém precisar dizer', () => {
    const { qrCode } = montarQrCodeV3Offline({
      chave: CHAVE, tpAmb: '2', dhEmi: '2026-09-23T14:05:00-03:00', vNF: 5,
      destDocumento: '11222333000181', chavePrivadaPem: PEM, urlConsulta: URL,
    });
    expect(partes(qrCode)[5]).toBe('1');
  });

  it('o DIA sai do texto da data, não de um Date — senão vira o fuso da máquina', () => {
    // 23:30 em -03:00 é dia 24 em UTC. O QR tem de levar 23, que é o dia da NOTA.
    const { qrCode } = montarQrCodeV3Offline({
      chave: CHAVE, tpAmb: '2', dhEmi: '2026-09-23T23:30:00-03:00', vNF: 5,
      chavePrivadaPem: PEM, urlConsulta: URL,
    });
    expect(partes(qrCode)[3]).toBe('23');
  });

  it('chave ou data inválida não viram QR', () => {
    const base = { tpAmb: '2', vNF: 5, chavePrivadaPem: PEM, urlConsulta: URL } as any;
    expect(() => montarQrCodeV3Offline({ ...base, chave: '123', dhEmi: '2026-09-23T14:05:00-03:00' })).toThrow(/44/);
    expect(() => montarQrCodeV3Offline({ ...base, chave: CHAVE, dhEmi: 'ontem' })).toThrow(/data/i);
  });

  it('o QR ONLINE continua com três parâmetros e SEM assinatura (ZX02-330)', () => {
    const { qrCode } = montarQrCodeV3({ chave: CHAVE, tpAmb: '2', urlConsulta: URL });
    expect(partes(qrCode)).toEqual([CHAVE, '3', '2']);
  });
});
