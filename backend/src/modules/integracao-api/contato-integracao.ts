import { createHash } from 'crypto';
import { sql, SQL } from 'drizzle-orm';
import { telefoneE164 } from '../../common/telefone-e164';
import { sqlChaveTelefone } from '../../common/telefone-chave';
import { CANAIS_MARKETPLACE_INTEGRACAO, canalIntegracao } from './canal-integracao';
import { sqlIso, textoCanonico } from './venda-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A FICHA DO CLIENTE para o RegemCast (`GET /integracao/clientes`, mig 302 — contrato em
// docs/integracao-regemcast.md). Uma função monta a ficha a partir da linha do banco e é usada
// pelos DOIS lados: o carimbador (a ficha mudou? → versão nova) e a leitura (a resposta). Assim a
// versão N nunca descreve uma coisa e a resposta outra.
//
// O que a FOTO guarda (integracao_versao.foto): só o hash da ficha, os canais e se tem telefone —
// nada de dado pessoal. Nome, telefone, bairro etc. são lidos NA HORA (cliente esquecido não deixa
// cópia aqui). Os canais e o "tem telefone" ficam na foto para a leitura filtrar em SQL, ANTES do
// limite da página (página vazia com `tem_mais: true` é lida como fim pelo conector).

export type FichaContato = {
  nome: string | null;
  telefone: string | null;
  canais: string[];
  bairro: string | null;
  cidade: string | null;
  opt_out: { ativo: boolean; em: string | null; origem: string | null };
  aceite_marketing: { aceito: boolean; em: string | null; origem: string | null; texto: string | null } | null;
};

export type FotoContato = { h: string; canais: string[]; tel: boolean };

/**
 * Marketplaces (nunca "cliente da loja" sozinhos): os do contrato, `open_delivery` incluso, mais o
 * `aiqfome` da lista do RegemCast (a lista fiscal não o tem — e não muda por aqui: mexe na nota).
 */
export const MARKETPLACES = [...new Set([...CANAIS_MARKETPLACE_INTEGRACAO, 'aiqfome'])].sort();
export const MARKETPLACES_REGEMCAST: ReadonlySet<string> = new Set(MARKETPLACES);

/** "Bairro" que é distância ("~3.2 km") ou número não é bairro. */
export function bairroOuNulo(v: unknown): string | null {
  const b = String(v ?? '').trim();
  if (!b || /^~?\s*\d+([.,]\d+)?\s*(km|m)?$/i.test(b) || /km|raio|metro/i.test(b)) return null;
  return b.slice(0, 120);
}

/**
 * Os clientes do lote, com o que a ficha mostra — UMA consulta. Canais = os de TODOS os pedidos
 * do cliente (a relação com a loja; quem só comprou por marketplace fica de fora da lista sem o
 * escopo — a regra está na leitura). Opt-out = a marca do cadastro OU a lista de exclusão (pela
 * chave do telefone: com/sem 55, com/sem o nono dígito); a data e a origem vêm do histórico
 * (mig 300). Aceite = o último aceite/recusa do número ou do cadastro.
 */
export function sqlFichasContato(ids: string[]): SQL {
  const lista = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const chaveCli = sqlChaveTelefone(sql`c.telefone`);
  return sql`
    select c.id::text as id, c.tenant_id::text as tenant_id, c.nome, c.telefone, c.opt_out_marketing,
           ${sqlIso(sql`c.criado_em`)} as criado_em,
           coalesce((select array_agg(distinct lower(btrim(pe.canal)))
                       from pedido_externo pe
                      where pe.tenant_id = c.tenant_id and pe.cliente_id = c.id and pe.canal is not null), '{}') as canais,
           ender.bairro, ender.cidade,
           ${sqlIso(sql`lista.em`)} as lista_em,
           op.acao as op_acao, ${sqlIso(sql`op.em`)} as op_em, op.origem as op_origem,
           ac.acao as ac_acao, ${sqlIso(sql`ac.em`)} as ac_em, ac.origem as ac_origem, ac.texto as ac_texto
      from cliente c
      left join lateral (
        select e.bairro, e.cidade from cliente_endereco e
         where e.cliente_id = c.id and e.tenant_id = c.tenant_id
         order by e.principal desc nulls last, e.criado_em desc
         limit 1) ender on true
      left join lateral (
        select min(mo.criado_em) as em from marketing_optout mo
         where mo.tenant_id = c.tenant_id and ${sqlChaveTelefone(sql`mo.telefone`)} = ${chaveCli}) lista on true
      left join lateral (
        select h.acao, h.em, h.origem from marketing_consentimento h
         where h.tenant_id = c.tenant_id and h.acao in ('saida', 'volta')
           and (h.cliente_id = c.id or h.telefone_chave = ${chaveCli})
         order by h.em desc, h.id desc
         limit 1) op on true
      left join lateral (
        select h.acao, h.em, h.origem, h.texto from marketing_consentimento h
         where h.tenant_id = c.tenant_id and h.acao in ('aceite', 'recusa')
           and (h.cliente_id = c.id or h.telefone_chave = ${chaveCli})
         order by h.em desc, h.id desc
         limit 1) ac on true
     where c.id in (${lista})`;
}

/** Os canais no formato do contrato, sem repetição e em ordem (`99food` exatamente assim). */
export function canaisDoContrato(v: unknown): string[] {
  const brutos: unknown[] = Array.isArray(v) ? v : [];
  return [...new Set(brutos.map((c) => canalIntegracao(c)).filter((c) => c && c !== 'outro'))].sort();
}

/** A ficha no formato do contrato, a partir da linha de `sqlFichasContato`. */
export function fichaDoContrato(l: any): FichaContato {
  const naLista = !!l.lista_em;
  const ativo = !!l.opt_out_marketing || naLista;
  // A data e a origem da última saída (ou da volta, quando voltou); sem histórico, a da lista.
  const op = l.op_acao ? { acao: l.op_acao as string, em: l.op_em as string | null, origem: l.op_origem as string | null } : null;
  // Quem saiu pelo cardápio (desmarcou no pedido, desligou no Perfil) deixa um evento de RECUSA:
  // vale o mais recente entre ele e a saída (SAIR no WhatsApp, painel da loja).
  const saidas = [
    op?.acao === 'saida' ? { em: op.em, origem: op.origem } : null,
    l.ac_acao === 'recusa' ? { em: l.ac_em as string | null, origem: l.ac_origem as string | null } : null,
  ].filter((s): s is { em: string | null; origem: string | null } => !!s);
  const saiu = saidas.sort((a, b) => String(b.em ?? '').localeCompare(String(a.em ?? '')))[0] ?? null;
  const opt_out = ativo
    ? {
        ativo: true,
        em: saiu?.em ?? l.lista_em ?? null,
        origem: saiu?.origem ?? (naLista ? 'lista_de_exclusao' : 'painel'),
      }
    : { ativo: false, em: op?.acao === 'volta' ? op.em : null, origem: op?.acao === 'volta' ? op.origem : null };
  return {
    nome: l.nome ? String(l.nome).trim().slice(0, 200) || null : null,
    telefone: telefoneE164(l.telefone),
    canais: canaisDoContrato(l.canais),
    bairro: bairroOuNulo(l.bairro),
    cidade: l.cidade ? String(l.cidade).trim().slice(0, 120) || null : null,
    opt_out,
    aceite_marketing: l.ac_acao
      ? {
          aceito: l.ac_acao === 'aceite',
          em: l.ac_em ?? null,
          origem: l.ac_origem ?? null,
          texto: l.ac_texto ?? null,
        }
      : null,
  };
}

/** A foto guardada na versão: o hash da ficha, os canais e se tem telefone (nada pessoal). */
export function fotoDoContato(f: FichaContato): FotoContato {
  const h = createHash('sha256').update(textoCanonico(f), 'utf8').digest('base64url').slice(0, 32);
  return { h, canais: f.canais, tel: !!f.telefone };
}

/**
 * Filtro da LEITURA (em SQL, antes do limite): a lápide sempre sai; o cliente vivo sai se tem
 * telefone E (não tem pedido, OU tem algum canal que não é de marketplace, OU tem 99Food e o
 * token tem o escopo da 99). Quem só comprou por marketplace nunca sai — e só pela 99, só com o
 * escopo.
 */
export function sqlContatoVisivel(com99: boolean): SQL {
  const mkt = sql.join(
    MARKETPLACES.map((m) => sql`${m}`),
    sql`, `,
  );
  return sql`(v.situacao = 'removido' or (
      coalesce((v.foto->>'tel')::boolean, false)
      and (jsonb_array_length(coalesce(v.foto->'canais', '[]'::jsonb)) = 0
           or exists (select 1 from jsonb_array_elements_text(coalesce(v.foto->'canais', '[]'::jsonb)) x(c)
                       where x.c not in (${mkt}))
           ${com99 ? sql`or coalesce(v.foto->'canais', '[]'::jsonb) ? '99food'` : sql``})))`;
}
