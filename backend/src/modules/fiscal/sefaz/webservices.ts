// ENDEREÇOS DOS WEBSERVICES DA NFC-e — só o que foi CONFIRMADO em fonte oficial.
//
// Regra: UF sem autorizador confirmado aqui = emissão RECUSADA com mensagem clara. Nada de
// "provavelmente é a SVRS" — autorizador errado é rejeição, e o erro some na primeira nota.

export type Ambiente = '1' | '2'; // 1 produção, 2 homologação

export type ServicoSefaz =
  | 'NFeStatusServico4'
  | 'NFeAutorizacao4'
  | 'NFeConsultaProtocolo4'
  | 'NFeInutilizacao4'
  | 'RecepcaoEvento4';

// Método SOAP de cada serviço (vai no `action` do Content-Type). Confirmado no mapa de
// webservices da biblioteca sped-nfe (storage/wsnfe_4.00_mod55.xml) e nos stubs gerados do
// WSDL da NF-e 4.00. Os demais serviços entram quando forem implementados — e conferidos.
export const METODO_SOAP: Record<ServicoSefaz, string> = {
  NFeStatusServico4: 'nfeStatusServicoNF',
  NFeAutorizacao4: 'nfeAutorizacaoLote',
  // Consulta da situação pela chave. Método e endereço conferidos em DUAS fontes que batem:
  // o portal da SVRS (tabela de serviços da NFC-e) e o mapa da sped-nfe — o mesmo par que já
  // se provou certo no status e na autorização. Repare que o endereço NÃO repete o nome do
  // serviço: é `/ws/NfeConsulta/NfeConsulta4.asmx`.
  NFeConsultaProtocolo4: 'nfeConsultaNF',
  // Inutilização de faixa de numeração. Mesmas duas fontes; repare que o endereço da NFC-e é
  // todo minúsculo (`/ws/nfeinutilizacao/nfeinutilizacao4.asmx`), diferente dos outros.
  NFeInutilizacao4: 'nfeInutilizacaoNF',
  // Eventos (cancelamento, cancelamento por substituição). Endereço todo minúsculo, como o
  // da inutilização — copiado do portal da SVRS.
  RecepcaoEvento4: 'nfeRecepcaoEvento',
};

export const NS_WSDL = (s: ServicoSefaz) => `http://www.portalfiscal.inf.br/nfe/wsdl/${s}`;

// SVRS (SEFAZ Virtual do RS) — NFC-e 4.00. Copiado do portal oficial em 22/09/2026:
// https://dfe-portal.svrs.rs.gov.br/Nfce/Servicos
const SVRS_NFCE: Record<Ambiente, Record<ServicoSefaz, string>> = {
  '2': {
    NFeStatusServico4: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    NFeAutorizacao4: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    NFeConsultaProtocolo4: 'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    NFeInutilizacao4: 'https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
    RecepcaoEvento4: 'https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
  },
  '1': {
    NFeStatusServico4: 'https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    NFeAutorizacao4: 'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    NFeConsultaProtocolo4: 'https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    NFeInutilizacao4: 'https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx',
    RecepcaoEvento4: 'https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx',
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

// VERSÃO DO QR CODE da NFC-e online, por UF.
// v3 (NT 2025.001 + Manual do DANFE NFC-e v6.0, §4.4.1): `?p=<chave>|3|<tpAmb>` — SEM CSC. As
// UFs tinham até 01/09/2025 para aceitá-la em produção; a que não aceita rejeita com 407.
// v2 (com o hash do CSC) continua aceita para CNPJ e fica como alternativa se a UF recusar a v3.
export const QR_VERSAO_NFCE: Record<string, 2 | 3> = {
  RJ: 3,
};

export function qrVersaoNfce(uf: string): 2 | 3 {
  return QR_VERSAO_NFCE[String(uf ?? '').trim().toUpperCase()] ?? 2;
}

export function urlServicoNfce(uf: string, ambiente: string, servico: ServicoSefaz): string {
  const amb: Ambiente = String(ambiente) === '1' ? '1' : '2';
  const tabela = AUTORIZADOR_NFCE[String(uf ?? '').trim().toUpperCase()];
  if (!tabela) throw new UfSemAutorizador(String(uf ?? '').trim().toUpperCase());
  return tabela[amb][servico];
}
