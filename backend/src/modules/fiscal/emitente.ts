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
  // CSC é o que assina o QR Code (NT 2015/002). Sem ele o QR não é conferível.
  { chave: 'cscId', rotulo: 'ID do CSC', ok: (c) => !!String(c.cscId ?? '').trim() },
  { chave: 'cscToken', rotulo: 'CSC', ok: (c) => !!String(c.cscToken ?? '').trim() },
  {
    chave: 'urlQrcode',
    // A URL de consulta do QR é POR UF e por ambiente — não existe uma nacional.
    rotulo: 'URL de consulta do QR Code desta UF',
    ok: (c) => !!urlConsultaQr(c),
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
