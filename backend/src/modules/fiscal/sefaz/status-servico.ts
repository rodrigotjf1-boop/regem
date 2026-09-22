import { CertificadoCliente, campo, chamarSefaz } from './soap';
import { urlServicoNfce } from './webservices';

// CONSULTA DE STATUS DO SERVIÇO (NFeStatusServico4) — "a SEFAZ está no ar e me aceita?".
//
// É o primeiro contato seguro com a SEFAZ: NÃO emite nada, NÃO gasta número, NÃO gera registro
// fiscal. Mas exercita tudo o que a emissão vai precisar: o endereço certo, o certificado A1 no
// aperto de mão TLS, a verificação do servidor pela raiz da ICP-Brasil, o envelope SOAP e a
// leitura do retorno. Se isto responde 107, o caminho até a autorização está aberto.
//
//   107 — Serviço em Operação
//   108 — Serviço Paralisado Momentaneamente (curto prazo)
//   109 — Serviço Paralisado sem Previsão

export interface StatusServico {
  cStat: string;
  xMotivo: string;
  emOperacao: boolean;
  tMedSegundos: number | null; // tempo médio de resposta informado pela SEFAZ
  dhRecbto: string | null;
  verAplic: string | null;
  cUF: string | null;
  tpAmb: string | null;
  url: string;
  msResposta: number;
}

export async function consultarStatusServico(p: {
  uf: string;
  codigoUf: number | string;
  ambiente: string;
  cert: CertificadoCliente;
  ca?: string[];
  url?: string; // só para teste
}): Promise<StatusServico> {
  const ambiente = String(p.ambiente) === '1' ? '1' : '2';
  const url = p.url ?? urlServicoNfce(p.uf, ambiente, 'NFeStatusServico4');
  const cUF = String(p.codigoUf ?? '').replace(/\D/g, '');
  if (cUF.length !== 2) throw new Error('Código IBGE da UF inválido na configuração fiscal.');

  const corpo =
    `<consStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<tpAmb>${ambiente}</tpAmb><cUF>${cUF}</cUF><xServ>STATUS</xServ></consStatServ>`;

  const inicio = Date.now();
  const ret = await chamarSefaz({ url, servico: 'NFeStatusServico4', corpoXml: corpo, cert: p.cert, ca: p.ca });
  const cStat = campo(ret, 'cStat') ?? '';
  const tMed = campo(ret, 'tMed');
  return {
    cStat,
    xMotivo: campo(ret, 'xMotivo') ?? '',
    emOperacao: cStat === '107',
    tMedSegundos: tMed != null && tMed !== '' ? Number(tMed) : null,
    dhRecbto: campo(ret, 'dhRecbto'),
    verAplic: campo(ret, 'verAplic'),
    cUF: campo(ret, 'cUF'),
    tpAmb: campo(ret, 'tpAmb'),
    url,
    msResposta: Date.now() - inicio,
  };
}
