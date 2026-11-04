import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';
import { horaNoFuso } from '../../common/data';
import { exigirBooleano } from '../../common/exigir';
import { uuidDeChave } from '../../common/id-deterministico';
import { formasNoCadastro, telefoneCadastro } from '../../common/telefone-chave';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO IGUAL EM ATÉ 30 MINUTOS (pedido do dono, 03/11/2026; protótipo `mockups/regem-alteracao-pedido.html`,
// aprovado no mesmo dia — decisões 1 e 2A; mig 360).
//
// Medido na produção (60 dias): 30 vezes o mesmo cliente repetiu um pedido igual em menos de 30 min (24 no Anota AI,
// metade em até 5 min) e, em 19 delas, os dois pedidos seguiram.
//
// • "Igual" = os mesmos produtos, tamanhos, adicionais e quantidades (a soma por produto: duas linhas de 1 = uma de 2).
//   A observação, o endereço e o pagamento não contam. Pedido cancelado e encomenda (data marcada) não contam.
// • "O mesmo cliente" = o CADASTRO ligado ao pedido, nunca o telefone cru: no iFood o telefone é um 0800 da plataforma
//   (1.095 pedidos com 13 números, de 577 clientes).
// • Cardápio online e robô do WhatsApp: o cliente responde ANTES de o pedido entrar (`receberPedido` devolve 409
//   `PEDIDO_REPETIDO`; o "sim" volta com `confirmarRepetido`). Canais de fora (Anota AI, iFood, 99, Cardápio Web): o
//   Regem não conversa com o cliente lá — o pedido entra com a marca (`pedido_externo.repetido_de`) e o painel, o KDS e a
//   via avisam a equipe até alguém confirmar "São dois pedidos" (`pedido_repetido_ok`).
// • A marca nasce NA GRAVAÇÃO do pedido e não muda mais. A confirmação mora em tabela À PARTE, só de inclusão, com o id
//   pela chave do pedido (a loja e a nuvem chegam ao mesmo id): `pedido_externo` sincroniza pela linha inteira, e uma
//   coluna de confirmação nele seria apagada pela cópia mais nova do outro lado — o motivo da `pedido_chegada` (mig 354).

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: unknown): string | null => {
  if (d == null) return null;
  const t = new Date(d as any);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

// ───────────────────────── ajuste da loja ─────────────────────────

export const JANELA_PADRAO_MIN = 30;
/** As janelas que a tela de ajustes oferece. */
export const JANELAS_MIN = [10, 15, 20, 30, 45, 60] as const;

export type AjusteRepetido = { ativo: boolean; minutos: number };
export const AJUSTE_REPETIDO_PADRAO: AjusteRepetido = { ativo: true, minutos: JANELA_PADRAO_MIN };

/** O ajuste a partir da linha de `cardapio_config` (sem linha, ou sem as colunas: o padrão — ligado, 30 min). */
export function ajusteRepetidoDaLinha(l: any): AjusteRepetido {
  if (!l) return { ...AJUSTE_REPETIDO_PADRAO };
  const ativo = l.pedido_repetido_ativo ?? l.pedidoRepetidoAtivo;
  const min = Number(l.pedido_repetido_min ?? l.pedidoRepetidoMin);
  return {
    ativo: ativo == null ? AJUSTE_REPETIDO_PADRAO.ativo : ativo === true,
    minutos: Number.isFinite(min) && min > 0 ? Math.min(240, Math.round(min)) : JANELA_PADRAO_MIN,
  };
}

/** O que a tela de ajustes mandou, conferido (V15: liga/desliga só com booleano de verdade; V16: ausente mantém). */
export function lerAjusteRepetido(dto: unknown): Partial<AjusteRepetido> {
  const d = (dto ?? {}) as Record<string, unknown>;
  const parcial: Partial<AjusteRepetido> = {};
  if (d.ativo !== undefined) parcial.ativo = exigirBooleano(d.ativo, 'ativo');
  if (d.minutos !== undefined) {
    const m = typeof d.minutos === 'number' ? d.minutos : NaN;
    if (!(JANELAS_MIN as readonly number[]).includes(m))
      throw new BadRequestException('Pedido igual: escolha 10, 15, 20, 30, 45 ou 60 minutos.');
    parcial.minutos = m;
  }
  return parcial;
}

/** A linha do ajuste: a de `cardapio_config` da loja, senão a da empresa (a mesma herança do "Cheguei", mig 354). */
export async function linhaDoAjusteRepetido(db: DrizzleDB, tenantId: string, unidadeId: string | null) {
  const r = rows(
    await db.execute(sql`
      select id, unidade_id, pedido_repetido_ativo, pedido_repetido_min
        from cardapio_config
       where tenant_id = ${tenantId}::uuid
         and (${unidadeId && UUID.test(unidadeId) ? sql`unidade_id = ${unidadeId}::uuid or ` : sql``}unidade_id is null)
       order by (unidade_id is null), id
       limit 1`),
  );
  return r[0] ?? null;
}

/** O ajuste valendo para a loja. Leitura que falha (banco sem a mig 360) cai no padrão — nunca derruba o pedido. */
export async function ajusteRepetidoDaLoja(db: DrizzleDB, tenantId: string, unidadeId: string | null): Promise<AjusteRepetido> {
  try {
    return ajusteRepetidoDaLinha(await linhaDoAjusteRepetido(db, tenantId, unidadeId));
  } catch {
    return { ...AJUSTE_REPETIDO_PADRAO };
  }
}

// ───────────────────────── "igual" ─────────────────────────

const texto = (v: unknown): string =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** As escolhas de uma linha: os ids das opções (nosso cardápio e o robô) ou os complementos do canal (nome e quantidade). */
function escolhasDaLinha(it: any): string {
  if (Array.isArray(it?.opcaoIds) && it.opcaoIds.length)
    return it.opcaoIds.map((x: unknown) => String(x)).sort().join(',');
  if (Array.isArray(it?.complementosItens) && it.complementosItens.length)
    return it.complementosItens
      .map((c: any) => `${texto(c?.codigo || c?.nome)}x${Number(c?.quantidade) || 1}`)
      .sort()
      .join(',');
  return texto(it?.complementos);
}

/**
 * A "impressão digital" dos itens (no formato gravado em `pedido_externo.itens`): a mesma quando os produtos, os
 * tamanhos, os adicionais e as quantidades são os mesmos — em qualquer ordem, e somando a mesma escolha repetida em
 * duas linhas. A observação do item não entra (decisão 1). Vazio = sem itens (nunca é "igual").
 */
export function assinaturaDosItens(itens: unknown): string {
  const lista = Array.isArray(itens) ? itens : [];
  const soma = new Map<string, number>();
  for (const it of lista) {
    if (!it || typeof it !== 'object') continue;
    const chave = [texto((it as any).produtoId || (it as any).codigo), texto((it as any).descricao), escolhasDaLinha(it)].join('~');
    const q = Number((it as any).quantidade);
    soma.set(chave, (soma.get(chave) ?? 0) + (Number.isFinite(q) && q > 0 ? q : 1));
  }
  return [...soma.entries()]
    .map(([k, q]) => `${k}~${Math.round(q * 1000) / 1000}`)
    .sort()
    .join('|');
}

/**
 * O cadastro do cliente pelo telefone, SEM criar — a MESMA busca com que o cardápio liga o pedido ao cliente depois de
 * gravar (`receberPedido`: as formas do número no cadastro, a exata primeiro e, empatando, a mais antiga). Menos de 10
 * dígitos: nada.
 */
export async function clientePeloTelefone(db: DrizzleDB, tenantId: string, telefone: unknown): Promise<string | null> {
  const tel = telefoneCadastro(telefone);
  const formas = formasNoCadastro(tel);
  if (tel.length < 10 || !formas.length) return null;
  const r = rows(
    await db.execute(sql`
      select id from cliente
       where tenant_id = ${tenantId}::uuid and telefone in (${sql.join(formas.map((f) => sql`${f}`), sql`, `)})
       order by (telefone = ${tel}) desc, criado_em
       limit 1`),
  );
  return r[0]?.id ? String(r[0].id) : null;
}

export type PedidoIgual = {
  id: string;
  numero: number | null;
  displayId: string | null;
  criadoEm: string;
  status: string;
  canal: string;
};

/**
 * O pedido IGUAL mais antigo do mesmo cliente na janela (da loja OU sem loja — V4), ou nada. Busca pelo cadastro do
 * cliente (índice `idx_pedido_externo_cliente`) e compara as impressões digitais aqui: são poucos pedidos por cliente.
 */
export async function procurarPedidoIgual(
  db: DrizzleDB,
  a: { tenantId: string; unidadeId: string | null; clienteId: string | null; itens: unknown; minutos: number },
): Promise<PedidoIgual | null> {
  const alvo = assinaturaDosItens(a.itens);
  if (!a.clienteId || !UUID.test(a.clienteId) || !alvo || !(a.minutos > 0)) return null;
  const lista = rows(
    await db.execute(sql`
      select id, numero, display_id, criado_em, status, canal, itens
        from pedido_externo
       where tenant_id = ${a.tenantId}::uuid
         and cliente_id = ${a.clienteId}::uuid
         and criado_em >= now() - make_interval(mins => ${Math.round(a.minutos)}::int)
         and status <> 'cancelado'
         and deleted_at is null
         and agendamento is null
         ${a.unidadeId && UUID.test(a.unidadeId) ? sql`and (unidade_id = ${a.unidadeId}::uuid or unidade_id is null)` : sql``}
       order by criado_em, id
       limit 50`),
  );
  const p = lista.find((x) => assinaturaDosItens(x.itens) === alvo);
  if (!p) return null;
  return {
    id: String(p.id),
    numero: p.numero == null ? null : Number(p.numero),
    displayId: p.display_id ?? null,
    criadoEm: iso(p.criado_em) ?? new Date().toISOString(),
    status: String(p.status ?? ''),
    canal: String(p.canal ?? ''),
  };
}

/** A situação do outro pedido, como o cliente entende. */
export function situacaoParaOCliente(status: string): string {
  switch (status) {
    case 'novo':
      return 'recebido';
    case 'confirmado':
      return 'em produção';
    case 'pronto':
      return 'pronto';
    case 'despachado':
      return 'a caminho';
    case 'entregue':
    case 'concluido':
      return 'entregue';
    default:
      return 'em andamento';
  }
}

/** A hora (HH:MM, no fuso da loja) de um instante gravado. */
export const horaDoPedido = (quando: string | null | undefined): string | null => {
  const t = quando ? new Date(quando) : null;
  return t && !Number.isNaN(t.getTime()) ? horaNoFuso(t) : null;
};

// ───────────────────────── a marca e a confirmação ─────────────────────────

/** O id da confirmação "São dois pedidos" de um pedido: o mesmo na loja e na nuvem (V42). */
export const idDaConfirmacao = (pedidoId: string) => uuidDeChave('pedido-repetido-ok', pedidoId);

export type MarcaDoRepetido = {
  pedidoId: string;
  comandaId: string | null;
  deId: string;
  deNumero: number | null;
  deDisplayId: string | null;
  deEm: string | null;
  /** Quem confirmou "São dois pedidos" e quando; null = a marca está aberta. */
  ok: { porNome: string | null; em: string } | null;
};

/**
 * As marcas dos pedidos dados (pelos ids ou pelas comandas), numa consulta só. Só vêm os pedidos MARCADOS
 * (`repetido_de` preenchido), com o outro pedido e a confirmação, se houver.
 */
export async function marcasDosPedidos(
  db: DrizzleDB,
  tenantId: string,
  por: { pedidoIds?: (string | null | undefined)[]; comandaIds?: (string | null | undefined)[] },
): Promise<MarcaDoRepetido[]> {
  const ids = [...new Set((por.pedidoIds ?? []).filter((x): x is string => !!x && UUID.test(x)))];
  const cmds = [...new Set((por.comandaIds ?? []).filter((x): x is string => !!x && UUID.test(x)))];
  if (!ids.length && !cmds.length) return [];
  const lista = (vals: string[]) => sql.join(vals.map((v) => sql`${v}::uuid`), sql`, `);
  const r = rows(
    await db.execute(sql`
      select p.id, p.comanda_id, p.repetido_de,
             d.numero as de_numero, d.display_id as de_display, d.criado_em as de_em,
             ok.por_nome, ok.created_at as ok_em
        from pedido_externo p
        left join pedido_externo d on d.id = p.repetido_de and d.tenant_id = p.tenant_id
        left join pedido_repetido_ok ok on ok.tenant_id = p.tenant_id and ok.pedido_id = p.id
       where p.tenant_id = ${tenantId}::uuid
         and p.repetido_de is not null
         and (${ids.length ? sql`p.id in (${lista(ids)})` : sql`false`}
              or ${cmds.length ? sql`p.comanda_id in (${lista(cmds)})` : sql`false`})`),
  );
  return r.map((x) => ({
    pedidoId: String(x.id),
    comandaId: x.comanda_id ? String(x.comanda_id) : null,
    deId: String(x.repetido_de),
    deNumero: x.de_numero == null ? null : Number(x.de_numero),
    deDisplayId: x.de_display ?? null,
    deEm: iso(x.de_em),
    ok: x.ok_em ? { porNome: x.por_nome ?? null, em: iso(x.ok_em) as string } : null,
  }));
}

/** "pedido #127 de 19:46" (ou o que se souber do outro pedido). */
export function textoDoOutro(m: { deNumero: number | null; deEm: string | null }): string {
  const n = m.deNumero != null ? `pedido #${m.deNumero}` : 'outro pedido do mesmo cliente';
  const h = horaDoPedido(m.deEm);
  return h ? `${n} de ${h}` : n;
}

/** O aviso no alto da via (cozinha, caixa, entregador) enquanto a marca está aberta. Texto fixo: nada do cliente. */
export function linhasDaViaDoRepetido(m: { deNumero: number | null; deEm: string | null }): string {
  return (
    '@CBD !! POSSÍVEL REPETIDO !!\n' +
    `@CB Igual ao ${textoDoOutro(m)}\n` +
    '@C Mesmo cliente, mesmos itens.\n' +
    '@CB Confirme com o cliente antes de produzir.\n'
  );
}

/** O aviso no cartão do KDS. */
export const textoDoKds = (m: { deNumero: number | null; deEm: string | null }) =>
  `Igual ao ${textoDoOutro(m)} — confirme com o atendimento antes de fazer.`;

/** A marca ABERTA da comanda (para a via e o cartão do KDS), ou nada. Leitura que falha não derruba a impressão. */
export async function marcaAbertaDaComanda(db: DrizzleDB, tenantId: string, comandaId: string | null | undefined) {
  if (!comandaId) return null;
  try {
    const m = (await marcasDosPedidos(db, tenantId, { comandaIds: [comandaId] })).find((x) => !x.ok);
    return m ?? null;
  } catch {
    return null;
  }
}

/** A marca ABERTA do pedido (pela linha de `pedido_externo`), ou nada. */
export async function marcaAbertaDoPedido(db: DrizzleDB, tenantId: string, ped: { id?: string | null; repetidoDe?: string | null } | null | undefined) {
  if (!ped?.id || !ped.repetidoDe) return null;
  try {
    const m = (await marcasDosPedidos(db, tenantId, { pedidoIds: [ped.id] })).find((x) => !x.ok);
    return m ?? null;
  } catch {
    return null;
  }
}

/**
 * "São dois pedidos": grava a confirmação (uma por pedido; repetir não muda nada). Devolve `true` quando gravou agora.
 * Só de inclusão: a loja e a nuvem criam o MESMO id, e o sync casa as duas.
 */
export async function gravarConfirmacao(
  db: DrizzleDB,
  a: { tenantId: string; unidadeId: string | null; pedidoId: string; porId: string | null; porNome: string | null },
): Promise<boolean> {
  const r = rows(
    await db.execute(sql`
      insert into pedido_repetido_ok (id, tenant_id, unidade_id, pedido_id, por_id, por_nome)
      values (${idDaConfirmacao(a.pedidoId)}::uuid, ${a.tenantId}::uuid,
              ${a.unidadeId && UUID.test(a.unidadeId) ? sql`${a.unidadeId}::uuid` : sql`null`},
              ${a.pedidoId}::uuid,
              ${a.porId && UUID.test(a.porId) ? sql`${a.porId}::uuid` : sql`null`},
              ${a.porNome ? String(a.porNome).slice(0, 120) : null})
      on conflict do nothing
      returning id`),
  );
  return r.length > 0;
}
