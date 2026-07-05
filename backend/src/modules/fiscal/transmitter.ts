/* eslint-disable @typescript-eslint/no-explicit-any */
// Transmissão da NFC-e à SEFAZ. Interface para trocar a implementação:
// - SefazMockTransmitter: homologação SIMULADA (autoriza local) — usado agora.
// - SefazDiretoTransmitter: assina o XML (XML-DSig com o A1) e chama o webservice
//   da UF. É o "plug" do certificado — implementar quando o certificado existir.

export interface RetornoAutorizacao {
  status: 'autorizada' | 'rejeitada' | 'contingencia';
  protocolo?: string;
  motivo: string; // xMotivo (cStat)
  xmlAutorizado?: string;
}

export interface RetornoCancelamento {
  status: 'cancelada' | 'rejeitada';
  protocolo?: string;
  motivo: string;
}

export interface FiscalTransmitter {
  autorizar(xml: string, chave: string, config: any): Promise<RetornoAutorizacao>;
  cancelar(
    chave: string,
    protocolo: string,
    justificativa: string,
    config: any,
  ): Promise<RetornoCancelamento>;
}

// Homologação simulada: devolve autorização sem tocar a SEFAZ (para validar o
// pipeline ponta a ponta). NÃO emite documento fiscal válido.
export class SefazMockTransmitter implements FiscalTransmitter {
  async autorizar(xml: string, chave: string): Promise<RetornoAutorizacao> {
    const protocolo = '135' + Date.now().toString().slice(-12);
    return {
      status: 'autorizada',
      protocolo,
      motivo: 'Autorizado o uso da NF-e (SIMULADO/HOMOLOGACAO)',
      xmlAutorizado: xml,
    };
  }
  async cancelar(
    chave: string,
    protocolo: string,
  ): Promise<RetornoCancelamento> {
    return {
      status: 'cancelada',
      protocolo: '135' + Date.now().toString().slice(-12),
      motivo: 'Cancelamento homologado (SIMULADO)',
    };
  }
}

// PLUG DO CERTIFICADO: aqui entram (1) assinatura XML-DSig do infNFe com o A1,
// (2) montagem do envelope SOAP e chamada ao webservice NFeAutorizacao4 da UF,
// (3) tratamento do retorno (cStat). Lançar até estar implementado + certificado.
export class SefazDiretoTransmitter implements FiscalTransmitter {
  async autorizar(): Promise<RetornoAutorizacao> {
    throw new Error(
      'SEFAZ direto não configurado: plugue o certificado A1 e a assinatura/transmissão.',
    );
  }
  async cancelar(): Promise<RetornoCancelamento> {
    throw new Error('SEFAZ direto não configurado: plugue o certificado A1.');
  }
}
