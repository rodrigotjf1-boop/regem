// PRÉ-VOO DO EMITENTE — o que precisa existir para a nota poder sair.
//
// ⚠️ O defeito que isto corrige: o builder tinha um padrão para cada campo que faltava —
//    CNPJ virava `00000000000000`, logradouro virava `N/D`, município virava a UF, o
//    código de município virava o de São Paulo. Com a configuração vazia a nota saía
//    assim mesmo e era gravada como emitida. Documento fiscal não tem padrão: ou o
//    emitente está completo, ou não se emite.

const soDig = (s: unknown) => String(s ?? '').replace(/\D/g, '');

type Campo = { chave: string; rotulo: string; ok: (c: any) => boolean };

/* eslint-disable @typescript-eslint/no-explicit-any */

const CAMPOS: Campo[] = [
  { chave: 'cnpj', rotulo: 'CNPJ', ok: (c) => soDig(c.cnpj).length === 14 },
  { chave: 'razaoSocial', rotulo: 'razão social', ok: (c) => !!String(c.razaoSocial ?? '').trim() },
  { chave: 'ie', rotulo: 'inscrição estadual', ok: (c) => !!String(c.ie ?? '').trim() },
  { chave: 'uf', rotulo: 'UF', ok: (c) => String(c.uf ?? '').trim().length === 2 },
  { chave: 'codigoUf', rotulo: 'código da UF (IBGE)', ok: (c) => Number(c.codigoUf) > 0 },
  {
    chave: 'codigoMunicipio',
    rotulo: 'código do município (IBGE)',
    ok: (c) => soDig(c.codigoMunicipio).length === 7,
  },
  { chave: 'municipio', rotulo: 'município', ok: (c) => !!String(c.municipio ?? '').trim() },
  { chave: 'endereco', rotulo: 'logradouro', ok: (c) => !!String(c.endereco ?? '').trim() },
  // O grupo `enderEmit` do leiaute 4.00 exige o bairro: sem ele o XML nem valida.
  { chave: 'bairro', rotulo: 'bairro', ok: (c) => !!String(c.bairro ?? '').trim() },
  { chave: 'numero', rotulo: 'número', ok: (c) => !!String(c.numero ?? '').trim() },
  // CSC: só o QR Code VERSÃO 2 usa (hash do CSC). Na v3 (NT 2025.001) ele não existe — por isso
  // só é exigido quando a UF ainda estiver na v2 (`qrVersao` vem de sefaz/webservices.ts).
  { chave: 'cscId', rotulo: 'ID do CSC', ok: (c) => c.qrVersao === 3 || !!String(c.cscId ?? '').trim() },
  { chave: 'cscToken', rotulo: 'CSC', ok: (c) => c.qrVersao === 3 || !!String(c.cscToken ?? '').trim() },
  {
    chave: 'urlQrcode',
    // A URL de consulta do QR é POR UF e por ambiente — não existe uma nacional.
    rotulo: 'URL de consulta do QR Code desta UF',
    ok: (c) => !!urlConsultaQr(c),
  },
  {
    chave: 'urlChave',
    // Vai no <urlChave> da NFC-e; é obrigatória no grupo <infNFeSupl>.
    rotulo: 'URL de consulta pela chave de acesso desta UF',
    ok: (c) => !!urlConsultaChave(c),
  },
];

/** Campos do emitente que faltam para emitir. Vazio = pode emitir. */
export function camposFaltando(config: any): string[] {
  return CAMPOS.filter((f) => !f.ok(config ?? {})).map((f) => f.rotulo);
}

/**
 * URL de consulta do QR Code da UF, conforme o ambiente. Vem da configuração porque
 * varia por estado (o IT 2025.003 mudou a de Goiás, por exemplo) — antes era a de São
 * Paulo, fixa no código, o que produz QR inválido em qualquer outra UF.
 */
export function urlConsultaQr(config: any): string | null {
  const url =
    String(config?.ambiente ?? '2') === '1'
      ? config?.urlQrcodeProd
      : config?.urlQrcodeHomolog;
  const s = String(url ?? '').trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

/**
 * URL de "consulta pela chave de acesso" da UF, conforme o ambiente — vai no <urlChave>.
 * NÃO é a URL do QR Code: são endereços diferentes (no RJ, a de consulta é
 * www.fazenda.rj.gov.br/nfce/consulta). Aceita com ou sem "http(s)://", porque é assim que
 * cada SEFAZ publica o seu valor — e ele tem de ir exatamente como publicado.
 */
export function urlConsultaChave(config: any): string | null {
  const url =
    String(config?.ambiente ?? '2') === '1' ? config?.urlChaveProd : config?.urlChaveHomolog;
  const s = String(url ?? '').trim();
  return s && !/\s/.test(s) && s.includes('.') ? s : null;
}
