/* eslint-disable @typescript-eslint/no-explicit-any */
// Transmissão da NFC-e à SEFAZ. Interface para trocar a implementação:
// - SefazDiretoTransmitter: assina o XML (XML-DSig com o A1) e chama o webservice da UF.
//   É o "plug" do certificado — ainda NÃO implementado.
// - SefazMockTransmitter: simulação para desenvolvimento. NÃO emite documento válido.
//
// ⚠️ A ESCOLHA ENTRE OS DOIS É O PONTO MAIS PERIGOSO DESTE MÓDULO.
//    Era `config.certRef ? direto : mock` — o ambiente não entrava na conta. Uma loja com
//    `ambiente = 1` (produção) e sem certificado caía no SIMULADO: a venda era gravada
//    como "autorizada", com protocolo inventado, e o DANFE saía SEM a tarja de homologação
//    (a tarja só olhava o ambiente). Ou seja, o cupom parecia fiscal e não era.
//    Agora o simulado só existe com ambiente de homologação E `FISCAL_SIMULADO=true`.
//    Fora disso, sem certificado a emissão é RECUSADA — nunca "autorizada".

export interface RetornoAutorizacao {
  status: 'autorizada' | 'rejeitada' | 'contingencia';
  cStat?: string; // código de status da SEFAZ (100, 120, 150, 1115…)
  protocolo?: string;
  motivo: string; // xMotivo
  xmlAutorizado?: string;
  simulado?: boolean; // true = NÃO passou pela SEFAZ
}

export interface RetornoCancelamento {
  status: 'cancelada' | 'rejeitada';
  cStat?: string;
  protocolo?: string;
  motivo: string;
  simulado?: boolean;
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

// AUTORIZAÇÃO = 100, 120 ou 150.
//   100 — autorizado o uso.
//   120 — "autorizado o uso da NF-e, COM ALERTA" (NT 2026.002, hoje só NFC-e). A nota está
//         autorizada e armazenada; o alerta vem no grupo PR13 (até 5 códigos). Tratar 120
//         como erro faz o PDV cair em contingência e EMITIR DE NOVO uma nota que já existe.
//   150 — autorizado fora do prazo (transmissão atrasada, a critério da UF).
export const CSTAT_AUTORIZADO = ['100', '120', '150'];
export function ehAutorizado(cStat?: string | null): boolean {
  return CSTAT_AUTORIZADO.includes(String(cStat ?? '').trim());
}

// Simulação para DESENVOLVIMENTO. Devolve autorização sem tocar a SEFAZ.
// Só é instanciado por `escolherTransmissor` quando o ambiente é homologação e o
// `FISCAL_SIMULADO` está ligado — ver o aviso no topo.
export class SefazMockTransmitter implements FiscalTransmitter {
  async autorizar(xml: string): Promise<RetornoAutorizacao> {
    return {
      status: 'autorizada',
      cStat: '100',
      protocolo: '135' + Date.now().toString().slice(-12),
      motivo: 'Autorizado o uso da NF-e (SIMULADO — NAO PASSOU PELA SEFAZ)',
      xmlAutorizado: xml,
      simulado: true,
    };
  }
  async cancelar(): Promise<RetornoCancelamento> {
    return {
      status: 'cancelada',
      cStat: '135',
      protocolo: '135' + Date.now().toString().slice(-12),
      motivo: 'Cancelamento homologado (SIMULADO — NAO PASSOU PELA SEFAZ)',
      simulado: true,
    };
  }
}

// PLUG DO CERTIFICADO: aqui entram (1) assinatura XML-DSig do infNFe com o A1,
// (2) montagem do envelope SOAP e chamada ao webservice NFeAutorizacao4 da UF,
// (3) tratamento do retorno (`ehAutorizado(cStat)`, nunca `cStat === '100'`).
export class SefazDiretoTransmitter implements FiscalTransmitter {
  async autorizar(): Promise<RetornoAutorizacao> {
    throw new Error(
      'Emissão fiscal indisponível: falta a assinatura digital e a transmissão à SEFAZ. ' +
        'Nenhuma nota foi emitida.',
    );
  }
  async cancelar(): Promise<RetornoCancelamento> {
    throw new Error(
      'Cancelamento indisponível: falta a transmissão à SEFAZ. A nota segue como está.',
    );
  }
}

/** O simulado está explicitamente ligado nesta instalação? */
export function simuladoLiberado(): boolean {
  const v = String(process.env.FISCAL_SIMULADO ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

/**
 * Escolhe o transmissor, FECHANDO EM CASO DE DÚVIDA.
 *  - com certificado → SEFAZ direto (que hoje recusa, por não estar implementado);
 *  - sem certificado, em homologação e com `FISCAL_SIMULADO=true` → simulado;
 *  - qualquer outro caso → lança. Nunca devolve "autorizada" sem ter emitido.
 */
export function escolherTransmissor(config: any): FiscalTransmitter {
  if (String(config?.certRef ?? '').trim()) return new SefazDiretoTransmitter();
  if (String(config?.ambiente ?? '2') === '2' && simuladoLiberado()) {
    return new SefazMockTransmitter();
  }
  throw new Error(
    'Emissão fiscal não configurada: falta o certificado digital A1 desta loja. ' +
      'Nenhuma nota foi emitida.',
  );
}
