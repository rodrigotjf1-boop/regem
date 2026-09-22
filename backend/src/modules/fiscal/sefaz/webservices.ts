// ENDEREÇOS DOS WEBSERVICES DA NFC-e — só o que foi CONFIRMADO em fonte oficial.
//
// Regra: UF sem autorizador confirmado aqui = emissão RECUSADA com mensagem clara. Nada de
// "provavelmente é a SVRS" — autorizador errado é rejeição, e o erro some na primeira nota.

export type Ambiente = '1' | '2'; // 1 produção, 2 homologação

export type ServicoSefaz = 'NFeStatusServico4' | 'NFeAutorizacao4';

// Método SOAP de cada serviço (vai no `action` do Content-Type). Confirmado no mapa de
// webservices da biblioteca sped-nfe (storage/wsnfe_4.00_mod55.xml) e nos stubs gerados do
// WSDL da NF-e 4.00. Os demais serviços entram quando forem implementados — e conferidos.
export const METODO_SOAP: Record<ServicoSefaz, string> = {
  NFeStatusServico4: 'nfeStatusServicoNF',
  NFeAutorizacao4: 'nfeAutorizacaoLote',
};

export const NS_WSDL = (s: ServicoSefaz) => `http://www.portalfiscal.inf.br/nfe/wsdl/${s}`;

// SVRS (SEFAZ Virtual do RS) — NFC-e 4.00. Copiado do portal oficial em 22/09/2026:
// https://dfe-portal.svrs.rs.gov.br/Nfce/Servicos
const SVRS_NFCE: Record<Ambiente, Record<ServicoSefaz, string>> = {
  '2': {
    NFeStatusServico4: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    NFeAutorizacao4: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  },
  '1': {
    NFeStatusServico4: 'https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    NFeAutorizacao4: 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
  },
};

// Quem autoriza a NFC-e de cada UF. RJ → SVRS: o portal da SVRS lista 7 autorizadores próprios
// (AM, GO, MS, MT, PR, RS, SP) e o RJ não é um deles; a própria SEFAZ-RJ publica avisos de
// "mudança de URLs SVRS". A confirmação definitiva é a consulta de status com cUF=33 — a SVRS
// só responde "107 Serviço em Operação" para UF que ela atende.
const AUTORIZADOR_NFCE: Record<string, Record<Ambiente, Record<ServicoSefaz, string>>> = {
  RJ: SVRS_NFCE,
};

export class UfSemAutorizador extends Error {
  constructor(uf: string) {
    super(
      `A emissão de NFC-e para ${uf || '(UF não informada)'} ainda não está habilitada: o ` +
        'endereço do autorizador desta UF precisa ser confirmado antes. Nenhuma nota foi emitida.',
    );
    this.name = 'UfSemAutorizador';
  }
}

export function urlServicoNfce(uf: string, ambiente: string, servico: ServicoSefaz): string {
  const amb: Ambiente = String(ambiente) === '1' ? '1' : '2';
  const tabela = AUTORIZADOR_NFCE[String(uf ?? '').trim().toUpperCase()];
  if (!tabela) throw new UfSemAutorizador(String(uf ?? '').trim().toUpperCase());
  return tabela[amb][servico];
}
