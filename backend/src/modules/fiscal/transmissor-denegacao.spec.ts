import { SefazDiretoTransmitter } from './transmitter';
import * as autorizacao from './sefaz/autorizacao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O QUE O TRANSMISSOR DEVOLVE PARA O SERVIÇO — e por que "denegada" não pode virar "rejeitada".
//
// A nota DENEGADA é gravada na base da SEFAZ: o número está consumido para sempre. A REJEITADA
// nunca entrou lá: o número continua livre e, como a nossa numeração só anda para a frente,
// vira lacuna a inutilizar. Se a denegação chegar aqui como rejeição, aquele número entra no
// relatório de lacunas e o lojista pede à SEFAZ a inutilização de uma numeração que ela já tem
// — pedido que a SEFAZ recusa, e ninguém entende por quê (ERR-094).

const CONFIG = { uf: 'RJ', ambiente: '2', cert: { pfx: Buffer.from(''), passphrase: '' } } as any;

describe('retorno da autorização → estado da nota', () => {
  afterEach(() => jest.restoreAllMocks());

  it('denegada chega como DENEGADA, com o protocolo do registro', async () => {
    jest.spyOn(autorizacao, 'autorizarNfce').mockResolvedValue({
      situacao: 'denegada',
      cStat: '301',
      xMotivo: 'Uso Denegado: Irregularidade fiscal do emitente',
      protocolo: '333260000000001',
    } as any);
    const r = await new SefazDiretoTransmitter().autorizar('<NFe/>', 'x', CONFIG);
    expect(r.status).toBe('denegada');
    expect(r.protocolo).toBe('333260000000001');
    expect(r.motivo).toContain('301');
  });

  it('781 chega como REJEITADA — a mesma irregularidade, tratada por outra UF sem consumir número', async () => {
    jest.spyOn(autorizacao, 'autorizarNfce').mockResolvedValue({
      situacao: 'rejeitada',
      cStat: '781',
      xMotivo: 'Rejeicao: Emissor nao habilitado para emissao da NF-e/NFC-e',
      nivel: 'nota',
    } as any);
    const r = await new SefazDiretoTransmitter().autorizar('<NFe/>', 'x', CONFIG);
    expect(r.status).toBe('rejeitada');
  });

  it('o aviso da SEFAZ (cMsg/xMsg) atravessa junto com a autorização', async () => {
    jest.spyOn(autorizacao, 'autorizarNfce').mockResolvedValue({
      situacao: 'autorizada',
      cStat: '120',
      xMotivo: 'Autorizado o uso da NF-e, com alerta',
      protocolo: '333260000000002',
      dhRecbto: null,
      nfeProc: '<nfeProc/>',
      mensagem: { codigo: '1', texto: 'Emitente em situacao a regularizar' },
    } as any);
    const r = await new SefazDiretoTransmitter().autorizar('<NFe/>', 'x', CONFIG);
    expect(r.status).toBe('autorizada');
    expect(r.mensagem).toEqual({ codigo: '1', texto: 'Emitente em situacao a regularizar' });
  });

  it('sem certificado carregado não se transmite nada', async () => {
    await expect(new SefazDiretoTransmitter().autorizar('<NFe/>', 'x', { uf: 'RJ' } as any)).rejects.toThrow(
      /certificado/i,
    );
  });
});
