/* eslint-disable @typescript-eslint/no-explicit-any */

// CONTRATO DO LIAME (v1) — cópia, campo a campo, dos schemas zod que o conector do Liame usa para
// aceitar a resposta do Regem (`C:\Liame\apps\server\src\connectors\regem\contrato-regem.ts`,
// `PedidoRegem`, `ClienteAnonimizado`, `CupomRegem`, `UsoCupomRegem` e `pagina`). O que foge do contrato vira erro DEFINITIVO do
// conector e para a leitura da loja inteira — por isso toda resposta das specs passa por aqui.
// O backend não tem zod: as regras estão escritas à mão, uma a uma (e conferidas contra as
// fixtures do Liame em `contrato-liame.spec.ts`).
//
// Nome terminado em `spec.ts` só para ficar FORA do build (`tsconfig.build.json`), sem ser suíte
// de teste (o jest roda `*.spec.ts`).

// z.iso.datetime({ offset: true }) do zod 4: data válida, hora com segundos, fração opcional e
// `Z` ou `±hh:mm`.
const DATA = '\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|02-(?:0[1-9]|1\\d|2\\d))';
const INSTANTE = new RegExp(`^${DATA}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$`);
const CANAL = /^[a-z0-9_]{1,40}$/;
const MOEDA = /^[A-Z]{3}$/;
const QUANTIDADE = /^\d{1,10}(\.\d{1,3})?$/;
const VERSAO_TEXTO = /^\d{1,19}$/;
const MAX_CENTAVOS = 900_000_000_000_000;

type Erros = string[];

const ehTexto = (v: unknown, min: number, max: number) => typeof v === 'string' && v.length >= min && v.length <= max;
const ehCentavos = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_CENTAVOS;
const ehInstante = (v: unknown) => typeof v === 'string' && INSTANTE.test(v);
const ehVersao = (v: unknown) =>
  (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) || (typeof v === 'string' && VERSAO_TEXTO.test(v));

function exigir(ok: boolean, erros: Erros, campo: string) {
  if (!ok) erros.push(campo);
}

function item(it: any, erros: Erros, p: string) {
  if (!it || typeof it !== 'object') return void erros.push(p);
  exigir(ehTexto(it.id, 1, 100), erros, `${p}.id`);
  exigir(it.produto_id === undefined || it.produto_id === null || ehTexto(it.produto_id, 1, 100), erros, `${p}.produto_id`);
  exigir(ehTexto(it.nome, 1, 300), erros, `${p}.nome`);
  exigir(
    (typeof it.quantidade === 'string' && QUANTIDADE.test(it.quantidade)) ||
      (typeof it.quantidade === 'number' && Number.isFinite(it.quantidade) && it.quantidade >= 0),
    erros,
    `${p}.quantidade`,
  );
  exigir(ehCentavos(it.receita_centavos), erros, `${p}.receita_centavos`);
  exigir('custo_centavos' in it && (it.custo_centavos === null || ehCentavos(it.custo_centavos)), erros, `${p}.custo_centavos`);
}

/** `PedidoRegem` do Liame. Devolve a lista de campos fora do contrato (vazia = aceito). */
export function errosPedidoRegem(p: any): string[] {
  const e: Erros = [];
  if (!p || typeof p !== 'object') return ['(item)'];
  exigir(ehTexto(p.id, 1, 100), e, 'id');
  exigir(ehVersao(p.versao), e, 'versao');
  exigir(ehInstante(p.atualizado_em), e, 'atualizado_em');
  exigir(typeof p.canal === 'string' && CANAL.test(p.canal), e, 'canal');
  exigir(['cardapio', 'whatsapp', 'presencial', 'marketplace', 'outro'].includes(p.grupo_canal), e, 'grupo_canal');
  exigir(['confirmado', 'cancelado', 'removido'].includes(p.situacao), e, 'situacao');
  exigir(typeof p.moeda === 'string' && MOEDA.test(p.moeda), e, 'moeda');
  exigir(ehTexto(p.fuso, 1, 64), e, 'fuso');
  exigir(ehCentavos(p.receita_centavos), e, 'receita_centavos');
  exigir(ehCentavos(p.desconto_loja_centavos), e, 'desconto_loja_centavos');
  exigir(ehCentavos(p.estornado_centavos), e, 'estornado_centavos');
  exigir('cupom' in p && (p.cupom === null || ehTexto(p.cupom, 0, 60)), e, 'cupom');
  exigir('cliente' in p, e, 'cliente');
  if (p.cliente !== null && p.cliente !== undefined) {
    const c = p.cliente;
    exigir(typeof c === 'object' && ehTexto(c.id, 1, 100), e, 'cliente.id');
    exigir(typeof c === 'object' && 'telefone' in c && (c.telefone === null || ehTexto(c.telefone, 0, 40)), e, 'cliente.telefone');
    exigir(typeof c === 'object' && (c.novo === undefined || c.novo === null || typeof c.novo === 'boolean'), e, 'cliente.novo');
  }
  exigir(p.criado_em === undefined || p.criado_em === null || ehInstante(p.criado_em), e, 'criado_em');
  exigir(ehInstante(p.confirmado_em), e, 'confirmado_em');
  exigir(p.faturado_em === undefined || p.faturado_em === null || ehInstante(p.faturado_em), e, 'faturado_em');
  exigir('cancelado_em' in p && (p.cancelado_em === null || ehInstante(p.cancelado_em)), e, 'cancelado_em');
  exigir(Array.isArray(p.itens) && p.itens.length <= 1000, e, 'itens');
  if (Array.isArray(p.itens)) p.itens.forEach((it: any, i: number) => item(it, e, `itens.${i}`));
  if (p.origem !== null && p.origem !== undefined) {
    const o = p.origem;
    exigir(typeof o === 'object' && ehInstante(o.capturado_em), e, 'origem.capturado_em');
    for (const k of ['lk', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'campaign_id', 'adset_id',
      'adgroup_id', 'ad_id', 'gclid', 'gbraid', 'wbraid', 'fbclid']) {
      exigir(o[k] === undefined || o[k] === null || ehTexto(o[k], 0, 1024), e, `origem.${k}`);
    }
  }
  return e;
}

/** `ClienteAnonimizado` do Liame. */
export function errosClienteAnonimizado(c: any): string[] {
  const e: Erros = [];
  if (!c || typeof c !== 'object') return ['(item)'];
  exigir(ehTexto(c.id, 1, 100), e, 'id');
  exigir(ehInstante(c.anonimizado_em), e, 'anonimizado_em');
  exigir(ehVersao(c.versao), e, 'versao');
  exigir(ehInstante(c.atualizado_em), e, 'atualizado_em');
  return e;
}

/** `z.iso.date()`: AAAA-MM-DD de um dia que existe. */
const ehData = (v: unknown) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const opcional = (v: unknown, ok: (x: unknown) => boolean) => v === undefined || v === null || ok(v);

/** `CupomRegem` do Liame (contrato de cupons §3.1). */
export function errosCupomRegem(c: any): string[] {
  const e: Erros = [];
  if (!c || typeof c !== 'object') return ['(item)'];
  exigir(ehTexto(c.id, 1, 100), e, 'id');
  exigir(ehVersao(c.versao), e, 'versao');
  exigir(ehInstante(c.atualizado_em), e, 'atualizado_em');
  exigir(ehTexto(c.codigo, 1, 60), e, 'codigo');
  exigir(opcional(c.nome, (x) => ehTexto(x, 0, 300)), e, 'nome');
  exigir(['percentual', 'valor', 'frete_gratis', 'outro'].includes(c.tipo), e, 'tipo');
  exigir(opcional(c.percentual, (x) => typeof x === 'string' && /^\d{1,3}(\.\d{1,2})?$/.test(x)), e, 'percentual');
  for (const k of ['valor_centavos', 'teto_desconto_centavos', 'pedido_minimo_centavos']) exigir(opcional(c[k], ehCentavos), e, k);
  exigir(opcional(c.valido_de, ehData), e, 'valido_de');
  exigir(opcional(c.valido_ate, ehData), e, 'valido_ate');
  exigir(ehTexto(c.fuso, 1, 64), e, 'fuso');
  exigir(typeof c.ativo === 'boolean', e, 'ativo');
  exigir(opcional(c.max_usos, (x) => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0), e, 'max_usos');
  exigir(typeof c.usos === 'number' && Number.isSafeInteger(c.usos) && c.usos >= 0, e, 'usos');
  exigir(c.condicoes === undefined || (!!c.condicoes && typeof c.condicoes === 'object' && !Array.isArray(c.condicoes)), e, 'condicoes');
  exigir(c.todas_as_lojas === undefined || typeof c.todas_as_lojas === 'boolean', e, 'todas_as_lojas');
  exigir(c.removido === undefined || typeof c.removido === 'boolean', e, 'removido');
  return e;
}

/**
 * O que o BANCO do Liame recusa depois do zod (`liame.coupon`, migrations 0022 e 0024 do Liame): o
 * `gravarCupons` grava a página inteira num comando — um cupom recusado derruba a página. O zod
 * aceita percentual 0 ou 999,99; o banco quer `percent > 0 and percent <= 100`.
 */
export function errosCupomBancoLiame(c: any): string[] {
  const e: Erros = [];
  const code = String(c?.codigo ?? '').trim().toUpperCase();
  exigir(code.length >= 1 && code.length <= 60, e, 'code');
  if (c?.percentual !== null && c?.percentual !== undefined) {
    const p = Number(c.percentual);
    exigir(p > 0 && p <= 100, e, 'percent');
  }
  for (const k of ['valor_centavos', 'teto_desconto_centavos', 'pedido_minimo_centavos', 'max_usos', 'usos']) {
    exigir(c?.[k] === null || c?.[k] === undefined || Number(c[k]) >= 0, e, k);
  }
  exigir(String(c?.nome ?? '').length <= 500, e, 'description');
  return e;
}

/** `UsoCupomRegem` do Liame (contrato de cupons §3.2). */
export function errosUsoCupomRegem(u: any): string[] {
  const e: Erros = [];
  if (!u || typeof u !== 'object') return ['(item)'];
  exigir(ehTexto(u.id, 1, 100), e, 'id');
  exigir(ehVersao(u.versao), e, 'versao');
  exigir(ehInstante(u.atualizado_em), e, 'atualizado_em');
  exigir(ehTexto(u.cupom_id, 1, 100), e, 'cupom_id');
  exigir(ehTexto(u.codigo, 1, 60), e, 'codigo');
  exigir('pedido_id' in u && (u.pedido_id === null || ehTexto(u.pedido_id, 1, 100)), e, 'pedido_id');
  exigir(ehInstante(u.usado_em), e, 'usado_em');
  exigir(opcional(u.desconto_centavos, ehCentavos), e, 'desconto_centavos');
  exigir(u.removido === undefined || typeof u.removido === 'boolean', e, 'removido');
  return e;
}

/** `pagina(item)` do Liame: `itens` (até 500), `proximo_cursor` (texto até 2000 ou nulo) e `tem_mais`. */
export function errosPagina(pg: any, errosItem: (x: any) => string[]): string[] {
  const e: Erros = [];
  if (!pg || typeof pg !== 'object') return ['(página)'];
  exigir(Array.isArray(pg.itens) && pg.itens.length <= 500, e, 'itens');
  exigir(pg.proximo_cursor === null || ehTexto(pg.proximo_cursor, 0, 2000), e, 'proximo_cursor');
  exigir(typeof pg.tem_mais === 'boolean', e, 'tem_mais');
  if (Array.isArray(pg.itens)) pg.itens.forEach((x: any, i: number) => errosItem(x).forEach((c) => e.push(`itens.${i}.${c}`)));
  return e;
}
