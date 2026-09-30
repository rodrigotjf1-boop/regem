import { sql, SQL } from 'drizzle-orm';
import { FUSO_OPERACAO } from '../../common/data';
import { numeroJson, sqlIso, textoCanonico } from './venda-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CUPOM e o USO DO CUPOM como a API de integração devolve (contrato de cupons v1 do Liame,
// §3.1 e §3.2) e a CRIAÇÃO pela integração (§3.3).
//
// Como nas vendas, a montagem roda no CARIMBADOR (em conjunto, uma consulta por tipo) e vira a
// FOTO guardada em `integracao_versao`: quem lê a versão N vê exatamente o que foi publicado como N.
//
// O que o Regem faz com o cupom HOJE (e o que a foto conta — o contrato pede a regra "como a
// origem aplica"; `cardapio.service.ts`, `avaliarCupom`/`checarCondicoesCupom`):
//  • só o cardápio online aplica cupom (achado A9): o balcão/PDV não tem cupom de desconto;
//  • a validação olha só a EMPRESA (achado A8): cupom cadastrado para uma loja vale em todas as
//    lojas da empresa — `todas_as_lojas` só informa se ele foi cadastrado sem loja (decisão do dono:
//    fica assim enquanto a empresa tiver uma loja só);
//  • valor 0/nulo em `max_usos`, `max_por_cliente`, `minimo` e `min_dias_sem_compra` = sem limite
//    (o teste é "se tem valor"); `teto_desconto` só vale no percentual;
//  • as datas valem no fuso da operação (`hojeISO()`, America/Sao_Paulo), não no da loja;
//  • `usos` = todos os usos do cupom, de qualquer loja — é o que o `max_usos` confere.
//
// Dado estranho que a tela aceitou (percentual 0 ou acima de 100, valor negativo) não pode ir cru:
// o zod do Liame aceitaria, mas o banco dele recusa (`liame.coupon`: `percent > 0 and <= 100`,
// valores `>= 0`) e a PÁGINA INTEIRA cairia. Esse cupom sai como `tipo: "outro"` (regra que o
// Liame não modela), com aviso no log.

export type TipoCupom = 'percentual' | 'valor' | 'frete_gratis' | 'outro';

export type FotoCupom = {
  codigo: string;
  nome: string | null;
  tipo: TipoCupom;
  percentual: string | null;
  valor_centavos: number | null;
  teto_desconto_centavos: number | null;
  pedido_minimo_centavos: number | null;
  valido_de: string | null;
  valido_ate: string | null;
  ativo: boolean;
  max_usos: number | null;
  usos: number;
  condicoes: { somente_novos: boolean; max_por_cliente: number | null; min_dias_sem_compra: number | null };
  todas_as_lojas: boolean;
};

export type FotoUsoCupom = {
  cupom_id: string;
  codigo: string;
  pedido_id: string | null;
  usado_em: string;
  desconto_centavos: number | null;
};

/** Fuso em que o Regem aplica `valido_de`/`valido_ate` (o de `hojeISO()`). */
export const FUSO_CUPOM = FUSO_OPERACAO;

const MAX_CENTAVOS = 900_000_000_000_000;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const PERCENTUAL = /^\d{1,3}([.]\d{1,2})?$/;

function lista(ids: string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

// ───────────────────────────── montagem (carimbador) ─────────────────────────────

/**
 * Os CUPONS (uma linha por cupom), com a contagem de usos. Números e datas saem em TEXTO do
 * próprio Postgres (`round(numeric)`, `to_char`): nada de ponto flutuante nem de `DateStyle`.
 */
export function sqlCupons(ids: string[]): SQL {
  return sql`
    select c.id::text as id, c.tenant_id::text as tenant_id, c.unidade_id::text as unidade_id,
           upper(btrim(c.codigo)) as codigo, c.nome, c.tipo,
           round(c.valor, 2)::text as percentual,
           round(c.valor * 100)::text as valor_centavos,
           round(c.teto_desconto * 100)::text as teto_centavos,
           round(c.minimo * 100)::text as minimo_centavos,
           c.ativo,
           to_char(c.valido_de, 'YYYY-MM-DD') as valido_de,
           to_char(c.validade, 'YYYY-MM-DD') as valido_ate,
           c.max_usos, c.somente_novos, c.max_por_cliente, c.min_dias_sem_compra,
           (select count(*)::int from cupom_uso u where u.cupom_id = c.id) as usos
      from cupom c
     where c.id in (${lista(ids)})`;
}

/**
 * Os USOS (uma linha por uso). A loja do uso é a do PEDIDO; o desconto é o do cupom gravado no
 * pedido pelo cardápio (`descontos`, mig 241: origem `cupom`, ou o frete que o cupom de frete
 * grátis zerou). Pedido antigo sem o detalhe (ou apagado) → desconto nulo (desconhecido ≠ zero).
 */
export function sqlUsosCupom(ids: string[]): SQL {
  const valor = numeroJson(sql`d->>'valor'`);
  return sql`
    select u.id::text as id, u.tenant_id::text as tenant_id, u.cupom_id::text as cupom_id,
           upper(btrim(c.codigo)) as codigo, u.pedido_id::text as pedido_id,
           ${sqlIso(sql`u.usado_em`)} as usado_em,
           pe.unidade_id::text as unidade_id,
           case when jsonb_typeof(pe.descontos) = 'array' then (
             select round(coalesce(sum(${valor}), 0) * 100)::text
               from jsonb_array_elements(pe.descontos) d
              where jsonb_typeof(d) = 'object'
                and (d->>'origem' = 'cupom'
                     or (d->>'origem' = 'frete' and coalesce(d->>'rotulo', '') like 'Cupom %'))
           ) end as desconto
      from cupom_uso u
      left join cupom c on c.id = u.cupom_id
      left join pedido_externo pe on pe.id = u.pedido_id and pe.tenant_id = u.tenant_id
     where u.id in (${lista(ids)})`;
}

/** Centavos inteiros e não negativos do texto do Postgres; fora disso, `null`. */
function centavos(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 && n <= MAX_CENTAVOS ? n : null;
}

function data(v: unknown): string | null {
  return typeof v === 'string' && DATA.test(v) ? v : null;
}

/** Limite "se tem valor" do Regem: positivo = o limite; 0/nulo = sem limite; negativo = bloqueia tudo (0). */
function limite(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return null;
  return n < 0 ? 0 : Math.min(Math.trunc(n), 2_147_483_647);
}

/** Código no formato do contrato: maiúsculas, 1 a 60. Vazio → sem foto (a versão fica com o erro). */
function codigoDoContrato(v: unknown, aviso: (m: string) => void, onde: string): string | null {
  const c = String(v ?? '').trim().toUpperCase();
  if (!c) return null;
  if (c.length > 60) aviso(`${onde}: código com ${c.length} caracteres — saem os 60 primeiros`);
  return c.slice(0, 60);
}

export function tipoDoContrato(tipoRegem: unknown): TipoCupom {
  if (tipoRegem === 'percentual') return 'percentual';
  if (tipoRegem === 'valor') return 'valor';
  if (tipoRegem === 'fretegratis') return 'frete_gratis';
  return 'outro';
}

/** A foto do cupom (linha de `sqlCupons`). `erro` = não dá para publicar (a versão guarda o motivo). */
export function montarFotoCupom(
  l: any,
  aviso: (m: string) => void = () => undefined,
): { foto: FotoCupom; erro?: undefined } | { foto?: undefined; erro: string } {
  const onde = `cupom ${l?.id}`;
  const codigo = codigoDoContrato(l?.codigo, aviso, onde);
  if (!codigo) return { erro: 'cupom sem código' };
  let tipo = tipoDoContrato(l?.tipo);
  let percentual: string | null = null;
  let valorCentavos: number | null = null;
  if (tipo === 'percentual') {
    const p = String(l?.percentual ?? '');
    const n = Number(p);
    if (PERCENTUAL.test(p) && n > 0 && n <= 100) percentual = p;
    else {
      aviso(`${onde}: percentual ${p || '(vazio)'} fora de (0, 100] — sai como tipo "outro"`);
      tipo = 'outro';
    }
  } else if (tipo === 'valor') {
    valorCentavos = centavos(l?.valor_centavos);
    if (valorCentavos === null) {
      aviso(`${onde}: valor ${l?.valor_centavos ?? '(vazio)'} centavos inválido — sai como tipo "outro"`);
      tipo = 'outro';
    }
  }
  const teto = tipo === 'percentual' ? centavos(l?.teto_centavos) : null;
  const minimo = centavos(l?.minimo_centavos);
  const nome = String(l?.nome ?? '').trim().slice(0, 300);
  return {
    foto: {
      codigo,
      nome: nome || null,
      tipo,
      percentual,
      valor_centavos: valorCentavos,
      teto_desconto_centavos: teto && teto > 0 ? teto : null,
      pedido_minimo_centavos: minimo && minimo > 0 ? minimo : null,
      valido_de: data(l?.valido_de),
      valido_ate: data(l?.valido_ate),
      ativo: l?.ativo === true,
      max_usos: limite(l?.max_usos),
      usos: Math.max(0, Math.trunc(Number(l?.usos) || 0)),
      condicoes: {
        somente_novos: l?.somente_novos === true,
        max_por_cliente: limite(l?.max_por_cliente),
        // "Há mais de N dias sem comprar": negativo nunca barra ninguém — é o mesmo que sem condição.
        min_dias_sem_compra: Number(l?.min_dias_sem_compra) > 0 ? limite(l?.min_dias_sem_compra) : null,
      },
      todas_as_lojas: l?.unidade_id === null || l?.unidade_id === undefined,
    },
  };
}

/** A foto do uso (linha de `sqlUsosCupom`). */
export function montarFotoUso(
  l: any,
  aviso: (m: string) => void = () => undefined,
): { foto: FotoUsoCupom; erro?: undefined } | { foto?: undefined; erro: string } {
  const codigo = codigoDoContrato(l?.codigo, aviso, `uso ${l?.id}`);
  if (!codigo) return { erro: 'uso sem o código do cupom' };
  if (!l?.cupom_id || !l?.usado_em) return { erro: 'uso sem cupom ou sem data' };
  return {
    foto: {
      cupom_id: String(l.cupom_id),
      codigo,
      pedido_id: l.pedido_id ? String(l.pedido_id) : null,
      usado_em: String(l.usado_em),
      desconto_centavos: centavos(l.desconto),
    },
  };
}

// ───────────────────────────── publicar? (carimbador e escrita) ─────────────────────────────

/** A versão guardada de um cupom/uso, como o carimbador (e a escrita) a leem com trava. */
export type VersaoCupomGuardada = {
  recurso: 'cupom' | 'cupom_uso';
  publicada: boolean;
  situacao: string | null;
  unidade_id: string | null;
  foto: any;
  confirmado_em: string | null;
  mudou_em: string | null;
};

export type DecisaoCupom =
  | {
      acao: 'publicar';
      situacao: 'removido' | null;
      unidade_id: string | null;
      confirmado_em: string | null;
      removido_em: string | null;
      foto: FotoCupom | FotoUsoCupom;
    }
  | { acao: 'manter' }
  | { acao: 'descartar' }
  | { acao: 'erro'; erro: string };

/**
 * O que fazer com a versão de um cupom/uso diante da linha de hoje (`rep`; ausente = apagado):
 *  • existe → foto nova; publica se nunca publicou, se mudou a foto ou a loja;
 *  • apagado depois de publicado → LÁPIDE: a última foto, versão nova, `removido` (cupom sai
 *    `ativo: false`) — excluir cupom é DELETE e cancelar o pedido apaga o uso (A7);
 *  • apagado sem nunca ter sido publicado → descarta (nada a dizer ao cliente).
 * `unidade_id` da versão = a loja que filtra a leitura (cupom: a dele, nulo = todas; uso: a do pedido).
 */
export function decidirCupom(v: VersaoCupomGuardada, rep: any | undefined, aviso: (m: string) => void = () => undefined): DecisaoCupom {
  if (rep) {
    const r = v.recurso === 'cupom' ? montarFotoCupom(rep, aviso) : montarFotoUso(rep, aviso);
    if (r.erro !== undefined) return { acao: 'erro', erro: r.erro };
    const unidade: string | null = rep.unidade_id ?? null;
    const mudou =
      !v.publicada || v.situacao !== null || (v.unidade_id ?? null) !== unidade || textoCanonico(v.foto) !== textoCanonico(r.foto);
    if (!mudou) return { acao: 'manter' };
    return {
      acao: 'publicar',
      situacao: null,
      unidade_id: unidade,
      // A leitura dos usos filtra `desde` por esta coluna (o instante do uso).
      confirmado_em: v.recurso === 'cupom_uso' ? (r.foto as FotoUsoCupom).usado_em : null,
      removido_em: null,
      foto: r.foto,
    };
  }
  if (!v.publicada) return { acao: 'descartar' };
  if (v.situacao === 'removido') return { acao: 'manter' };
  if (!v.foto) {
    aviso(`${v.recurso} publicado sem foto e apagado na origem — mantido como estava`);
    return { acao: 'manter' };
  }
  return {
    acao: 'publicar',
    situacao: 'removido',
    unidade_id: v.unidade_id ?? null,
    confirmado_em: v.confirmado_em ?? null,
    removido_em: v.mudou_em ?? null,
    foto: v.recurso === 'cupom' ? { ...(v.foto as FotoCupom), ativo: false } : (v.foto as FotoUsoCupom),
  };
}

// ───────────────────────────── contrato (leitura) ─────────────────────────────

/** Uma linha de `integracao_versao` (recurso `cupom`) no formato do contrato §3.1. */
export function cupomDoContrato(l: { id: string; versao: string | number; atualizado_em: string; situacao: string | null; foto: FotoCupom }) {
  const f = l.foto;
  return {
    id: l.id,
    versao: Number(l.versao),
    atualizado_em: l.atualizado_em,
    codigo: f.codigo,
    nome: f.nome ?? null,
    tipo: f.tipo,
    percentual: f.percentual ?? null,
    valor_centavos: f.valor_centavos ?? null,
    teto_desconto_centavos: f.teto_desconto_centavos ?? null,
    pedido_minimo_centavos: f.pedido_minimo_centavos ?? null,
    valido_de: f.valido_de ?? null,
    valido_ate: f.valido_ate ?? null,
    fuso: FUSO_CUPOM,
    ativo: f.ativo === true,
    max_usos: f.max_usos ?? null,
    usos: f.usos ?? 0,
    condicoes: {
      somente_novos: f.condicoes?.somente_novos === true,
      max_por_cliente: f.condicoes?.max_por_cliente ?? null,
      min_dias_sem_compra: f.condicoes?.min_dias_sem_compra ?? null,
    },
    todas_as_lojas: f.todas_as_lojas === true,
    removido: l.situacao === 'removido',
  };
}

/** Uma linha de `integracao_versao` (recurso `cupom_uso`) no formato do contrato §3.2. */
export function usoDoContrato(l: { id: string; versao: string | number; atualizado_em: string; situacao: string | null; foto: FotoUsoCupom }) {
  const f = l.foto;
  return {
    id: l.id,
    versao: Number(l.versao),
    atualizado_em: l.atualizado_em,
    cupom_id: f.cupom_id,
    codigo: f.codigo,
    pedido_id: f.pedido_id ?? null,
    usado_em: f.usado_em,
    desconto_centavos: f.desconto_centavos ?? null,
    removido: l.situacao === 'removido',
  };
}

// ───────────────────────────── criação (POST /cupons) ─────────────────────────────

/** O cupom a gravar, já no formato do Regem (valores em reais como TEXTO numérico). */
export type CriacaoCupom = {
  codigo: string;
  nome: string | null;
  tipo: 'percentual' | 'valor' | 'fretegratis';
  valor: string;
  tetoDesconto: string | null;
  minimo: string | null;
  validoDe: string | null;
  validade: string | null;
  maxUsos: number | null;
  somenteNovos: boolean;
  maxPorCliente: number | null;
  minDiasSemCompra: number | null;
};

const CAMPOS_CRIACAO = new Set([
  'codigo',
  'nome',
  'tipo',
  'percentual',
  'valor_centavos',
  'teto_desconto_centavos',
  'pedido_minimo_centavos',
  'valido_de',
  'valido_ate',
  'max_usos',
  'condicoes',
]);
const CAMPOS_CONDICOES = new Set(['somente_novos', 'max_por_cliente', 'min_dias_sem_compra']);
const CODIGO = /^[A-Z0-9]{3,30}$/;
// Caractere de controle (C0 e DEL): sem barra invertida no fonte (V27) — pelo código do caractere.
const temControle = (s: string) => [...s].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);

const vazio = (v: unknown) => v === undefined || v === null;
const inteiro = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v);

/** Data AAAA-MM-DD que existe no calendário. */
function dataValida(v: unknown): v is string {
  if (typeof v !== 'string' || !DATA.test(v)) return false;
  const [a, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && a >= 2000 && a <= 2999;
}

/** Centavos inteiros em reais (texto exato, sem ponto flutuante). */
function reais(c: number): string {
  const s = String(c).padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

/**
 * Confere o corpo do `POST /cupons` (contrato §3.3). Tudo o que foge vira UMA lista de motivos
 * (422 `regra-invalida`) — nunca um padrão silencioso (V16): campo desconhecido é recusado,
 * condição ausente é "sem a condição". `hoje` = data de hoje no fuso da operação.
 */
export function validarCriacaoCupom(corpo: unknown, hoje: string): { ok: true; cupom: CriacaoCupom } | { ok: false; erros: string[] } {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return { ok: false, erros: ['o corpo tem de ser um objeto JSON'] };
  }
  const c = corpo as Record<string, unknown>;
  const erros: string[] = [];
  const desconhecidos = Object.keys(c).filter((k) => !CAMPOS_CRIACAO.has(k));
  if (desconhecidos.length) erros.push(`campo desconhecido: ${desconhecidos.join(', ')}`);

  const codigo = typeof c.codigo === 'string' ? c.codigo.trim().toUpperCase() : '';
  if (!CODIGO.test(codigo)) erros.push('codigo: de 3 a 30 letras (A-Z) ou números, sem espaço');

  let nome: string | null = null;
  if (!vazio(c.nome)) {
    if (typeof c.nome !== 'string' || c.nome.trim().length > 300 || temControle(c.nome)) {
      erros.push('nome: texto de até 300 caracteres, sem caractere de controle');
    } else nome = c.nome.trim() || null;
  }

  const tipoContrato = c.tipo;
  const tipo =
    tipoContrato === 'percentual' ? 'percentual' : tipoContrato === 'valor' ? 'valor' : tipoContrato === 'frete_gratis' ? 'fretegratis' : null;
  if (!tipo) erros.push('tipo: percentual, valor ou frete_gratis');

  let valor = '0';
  if (tipo === 'percentual') {
    const p = typeof c.percentual === 'number' ? String(c.percentual) : c.percentual;
    const n = Number(p);
    if (typeof p !== 'string' || !PERCENTUAL.test(p) || !(n > 0 && n <= 100)) {
      erros.push('percentual: texto com até 2 casas, maior que 0 e até 100 (ex.: "10.00")');
    } else valor = p; // o texto exato vai para o `numeric` (sem ponto flutuante no caminho)
  } else if (!vazio(c.percentual)) erros.push('percentual: só no tipo percentual');

  if (tipo === 'valor') {
    if (!inteiro(c.valor_centavos) || (c.valor_centavos as number) < 1 || (c.valor_centavos as number) > MAX_CENTAVOS) {
      erros.push('valor_centavos: inteiro maior que 0');
    } else valor = reais(c.valor_centavos as number);
  } else if (!vazio(c.valor_centavos)) erros.push('valor_centavos: só no tipo valor');

  let tetoDesconto: string | null = null;
  if (!vazio(c.teto_desconto_centavos)) {
    if (tipo !== 'percentual') erros.push('teto_desconto_centavos: só no tipo percentual');
    else if (!inteiro(c.teto_desconto_centavos) || (c.teto_desconto_centavos as number) < 1 || (c.teto_desconto_centavos as number) > MAX_CENTAVOS) {
      erros.push('teto_desconto_centavos: inteiro maior que 0');
    } else tetoDesconto = reais(c.teto_desconto_centavos as number);
  }

  let minimo: string | null = null;
  if (!vazio(c.pedido_minimo_centavos)) {
    if (!inteiro(c.pedido_minimo_centavos) || (c.pedido_minimo_centavos as number) < 0 || (c.pedido_minimo_centavos as number) > MAX_CENTAVOS) {
      erros.push('pedido_minimo_centavos: inteiro de 0 em diante');
    } else if ((c.pedido_minimo_centavos as number) > 0) minimo = reais(c.pedido_minimo_centavos as number);
  }

  let validoDe: string | null = null;
  let validade: string | null = null;
  if (!vazio(c.valido_de)) {
    if (!dataValida(c.valido_de)) erros.push('valido_de: data AAAA-MM-DD');
    else validoDe = c.valido_de;
  }
  if (!vazio(c.valido_ate)) {
    if (!dataValida(c.valido_ate)) erros.push('valido_ate: data AAAA-MM-DD');
    else if (c.valido_ate < hoje) erros.push(`valido_ate: ${c.valido_ate} já passou (hoje é ${hoje}, ${FUSO_CUPOM})`);
    else validade = c.valido_ate;
  }
  if (validoDe && validade && validoDe > validade) erros.push('valido_de: depois de valido_ate');

  let maxUsos: number | null = null;
  if (!vazio(c.max_usos)) {
    if (!inteiro(c.max_usos) || (c.max_usos as number) < 1 || (c.max_usos as number) > 2_147_483_647) {
      erros.push('max_usos: inteiro maior que 0 (sem limite: não mande o campo)');
    } else maxUsos = c.max_usos as number;
  }

  let somenteNovos = false;
  let maxPorCliente: number | null = null;
  let minDiasSemCompra: number | null = null;
  if (!vazio(c.condicoes)) {
    const k = c.condicoes;
    if (typeof k !== 'object' || Array.isArray(k)) erros.push('condicoes: objeto');
    else {
      const cond = k as Record<string, unknown>;
      const fora = Object.keys(cond).filter((x) => !CAMPOS_CONDICOES.has(x));
      if (fora.length) erros.push(`condicoes: campo desconhecido: ${fora.join(', ')}`);
      if (!vazio(cond.somente_novos)) {
        if (typeof cond.somente_novos !== 'boolean') erros.push('condicoes.somente_novos: true ou false');
        else somenteNovos = cond.somente_novos;
      }
      const positivo = (v: unknown) => inteiro(v) && (v as number) >= 1 && (v as number) <= 2_147_483_647;
      if (!vazio(cond.max_por_cliente)) {
        if (!positivo(cond.max_por_cliente)) erros.push('condicoes.max_por_cliente: inteiro maior que 0');
        else maxPorCliente = cond.max_por_cliente as number;
      }
      if (!vazio(cond.min_dias_sem_compra)) {
        if (!positivo(cond.min_dias_sem_compra)) erros.push('condicoes.min_dias_sem_compra: inteiro maior que 0');
        else minDiasSemCompra = cond.min_dias_sem_compra as number;
      }
    }
  }

  if (erros.length || !tipo) return { ok: false, erros };
  return {
    ok: true,
    cupom: { codigo, nome, tipo, valor, tetoDesconto, minimo, validoDe, validade, maxUsos, somenteNovos, maxPorCliente, minDiasSemCompra },
  };
}
