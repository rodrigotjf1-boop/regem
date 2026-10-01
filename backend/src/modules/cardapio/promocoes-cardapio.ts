import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { registrarEvento, registrarSaida, registrarVolta } from '../../common/consentimento-marketing';
import { chaveTelefone, sqlChaveTelefone, telefoneCadastro } from '../../common/telefone-chave';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PROMOÇÕES PELO WHATSAPP NO CARDÁPIO (mockup aprovado em 01/10/2026 — docs/decisoes-design.md §6).
//
// O que o dono decidiu: no PRIMEIRO pedido a opção já vem MARCADA; respondida, não se pergunta de
// novo; no Perfil ela aparece LIGADA para quem não pediu para sair; desligar vale na hora.
//
// O que isso é (e o que não é): caixa que já vem marcada NÃO é consentimento (ANPD). O envio se
// apoia no legítimo interesse da loja em divulgar os próprios produtos a quem já é cliente dela
// (LGPD, art. 7º, IX, e art. 10, I) — o mesmo das campanhas do Regem: recebe até pedir para sair.
// Por isso o registro CONTA COMO FOI: a origem `cardapio_checkout_marcada` diz que a caixa já
// vinha marcada (quem lê pela integração não a trata como um "sim" clicado). O "sim" de verdade é
// o de quem LIGA a chave no Perfil, que só abre com o código do WhatsApp (`cardapio_perfil`).
//
// Regras:
//  • só em loja que manda promoção (`promocoesDaLoja`): RegemCast ligado ou WhatsApp conectado;
//  • o checkout não confirma o telefone: a caixa marcada NUNCA tira ninguém da lista de quem pediu
//    para sair — só o VOLTAR no WhatsApp ou a chave do Perfil (com o código);
//  • desmarcar, desligar e SAIR dão no mesmo: lista de exclusão + marca do cadastro (o painel da
//    loja e a trava do envio já olham as duas), e a integração publica a mudança;
//  • nada daqui pode derrubar o pedido: quem chama trata a falha como aviso no log.
// Só nuvem (cardápio, campanha e a tabela do histórico — mig 300 — não existem no servidor da loja).

const log = new Logger('PromocoesCardapio');

/** A frase da caixinha e a do Perfil — as MESMAS que a tela mostra (vêm daqui) e que ficam gravadas. */
export function frasesPromocoes(lojaNome: string | null | undefined) {
  const loja = String(lojaNome ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const de = loja && loja !== 'Cardápio' ? `de ${loja}` : 'desta loja';
  return {
    frase: `Receber promoções ${de} pelo WhatsApp`,
    apoio: 'Desmarque se não quiser. Para sair depois, responda SAIR ou desligue no seu Perfil.',
    ligado: `Você recebe as promoções ${de} neste número. Para sair, desligue aqui ou responda SAIR.`,
    desligado: 'Pronto: você não recebe mais promoções desta loja. Já avisamos quem envia as mensagens.',
    fora: 'Você não recebe promoções desta loja. Ligue aqui para voltar a receber.',
  };
}

const rows = (r: any): any[] => r?.rows ?? r ?? [];

/**
 * A loja manda promoção? RegemCast ligado (token ativo com `clientes.ler`) ou algum número de
 * WhatsApp conectado no Regem. Loja que não faz campanha não pergunta nada. Sem as tabelas (banco
 * de loja, migration faltando) → `false`, com o motivo no log.
 */
export async function lojaFazCampanha(db: any, tenantId: string): Promise<boolean> {
  try {
    const [r] = rows(
      await db.execute(sql`
        select (exists (select 1 from integracao_token_loja t
                         where t.tenant_id = ${tenantId}::uuid and t.revogado_em is null
                           and (t.expira_em is null or t.expira_em > now())
                           and 'clientes.ler' = any(t.escopos))
                or exists (select 1 from whatsapp_numero n
                            where n.tenant_id = ${tenantId}::uuid and n.status = 'conectado')) as faz`),
    );
    return r?.faz === true;
  } catch (e: any) {
    log.warn(`campanhas da empresa ${tenantId.slice(0, 8)} não conferidas (a caixinha fica escondida): ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
    return false;
  }
}

/** O que o cardápio mostra (`menu().loja.promocoes`): as frases, ou `null` = não pergunta. */
export async function promocoesDaLoja(db: any, tenantId: string, lojaNome: string | null | undefined) {
  if (!(await lojaFazCampanha(db, tenantId))) return null;
  const f = frasesPromocoes(lojaNome);
  return { frase: f.frase, apoio: f.apoio };
}

type Situacao = {
  /** Na lista de exclusão (em qualquer forma do número) ou com a marca do cadastro. */
  fora: boolean;
  /** O último aceite/recusa do número (ou do cadastro), se houver. */
  ultima: 'aceite' | 'recusa' | null;
  /** Quando aceitou ou voltou pela última vez. */
  desde: string | null;
  /** Já respondeu alguma vez (aceite, recusa, saída ou volta) — ou está fora. */
  respondeu: boolean;
};

async function situacao(db: any, tenantId: string, chave: string, clienteId: string | null): Promise<Situacao> {
  const [r] = rows(
    await db.execute(sql`
      select (exists (select 1 from marketing_optout mo
                       where mo.tenant_id = ${tenantId}::uuid and ${sqlChaveTelefone(sql`mo.telefone`)} = ${chave})
              or exists (select 1 from cliente c
                          where c.tenant_id = ${tenantId}::uuid and c.opt_out_marketing
                            and (c.id = ${clienteId}::uuid or ${sqlChaveTelefone(sql`c.telefone`)} = ${chave}))) as fora,
             (select h.acao from marketing_consentimento h
               where h.tenant_id = ${tenantId}::uuid and h.acao in ('aceite', 'recusa')
                 and (h.cliente_id = ${clienteId}::uuid or h.telefone_chave = ${chave})
               order by h.em desc, h.id desc limit 1) as ultima,
             (select to_char(h.em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from marketing_consentimento h
               where h.tenant_id = ${tenantId}::uuid and h.acao in ('aceite', 'volta')
                 and (h.cliente_id = ${clienteId}::uuid or h.telefone_chave = ${chave})
               order by h.em desc, h.id desc limit 1) as desde,
             exists (select 1 from marketing_consentimento h
                      where h.tenant_id = ${tenantId}::uuid
                        and (h.cliente_id = ${clienteId}::uuid or h.telefone_chave = ${chave})) as teve_evento`),
  );
  const fora = r?.fora === true;
  return {
    fora,
    ultima: r?.ultima === 'aceite' || r?.ultima === 'recusa' ? r.ultima : null,
    desde: fora ? null : (r?.desde ?? null),
    respondeu: fora || r?.teve_evento === true,
  };
}

/** A marca do cadastro acompanha a escolha — o painel da loja e a prévia das campanhas olham ela. */
async function marcarCadastros(db: any, tenantId: string, chave: string, clienteId: string | null, fora: boolean) {
  await db.execute(sql`
    update cliente set opt_out_marketing = ${fora}, atualizado_em = now()
     where tenant_id = ${tenantId}::uuid and opt_out_marketing = ${!fora}
       and (id = ${clienteId}::uuid or ${sqlChaveTelefone(sql`telefone`)} = ${chave})`);
}

export type ResultadoCheckout = 'aceite' | 'recusa' | 'ja_respondido' | 'continua_fora' | 'sem_telefone' | 'loja_nao_pergunta';

/**
 * A escolha da caixinha no pedido enviado. `marcada = true` (como ela vem): entra na lista de
 * promoções, a não ser que o número já tenha pedido para sair (o checkout não confirma o telefone —
 * continua fora). `marcada = false`: "não quero" → lista de exclusão. Repetir não duplica.
 */
export async function escolhaNoCheckout(
  db: any,
  p: { tenantId: string; lojaNome: string | null | undefined; telefone: unknown; clienteId: string | null; marcada: boolean },
): Promise<ResultadoCheckout> {
  if (!(await lojaFazCampanha(db, p.tenantId))) return 'loja_nao_pergunta';
  const telefone = telefoneCadastro(p.telefone);
  const chave = chaveTelefone(telefone);
  if (!telefone || !chave) return 'sem_telefone';
  const s = await situacao(db, p.tenantId, chave, p.clienteId);
  const texto = frasesPromocoes(p.lojaNome).frase;
  if (p.marcada) {
    if (s.fora) return 'continua_fora';
    if (s.ultima === 'aceite') return 'ja_respondido';
    await registrarEvento(db, { tenantId: p.tenantId, telefone, clienteId: p.clienteId, origem: 'cardapio_checkout_marcada', texto }, 'aceite');
    return 'aceite';
  }
  if (s.fora) return 'ja_respondido';
  await registrarSaida(
    db,
    { tenantId: p.tenantId, telefone, clienteId: p.clienteId, origem: 'cardapio_checkout', texto, motivo: 'cardapio_checkout' },
    'recusa',
  );
  await marcarCadastros(db, p.tenantId, chave, p.clienteId, true);
  return 'recusa';
}

/** O bloco "Promoções pelo WhatsApp" do Perfil: `null` = a loja não faz campanha (não aparece). */
export async function promocoesDoPerfil(
  db: any,
  c: { tenantId: string; id: string; telefone: string | null },
  lojaNome: string | null | undefined,
): Promise<{ ativo: boolean; desde: string | null; respondeu: boolean; ligado: string; desligado: string; fora: string } | null> {
  if (!(await lojaFazCampanha(db, c.tenantId))) return null;
  const chave = chaveTelefone(c.telefone);
  if (!chave) return null;
  const s = await situacao(db, c.tenantId, chave, c.id);
  const f = frasesPromocoes(lojaNome);
  return { ativo: !s.fora, desde: s.desde, respondeu: s.respondeu, ligado: f.ligado, desligado: f.desligado, fora: f.fora };
}

/**
 * A chave do Perfil (o cliente entrou com o código do WhatsApp: o número é dele). Desligar = sair
 * (lista de exclusão + marca do cadastro). Ligar = o "sim" do próprio cliente: sai da lista em
 * todas as formas do número e a marca do cadastro cai. Repetir o mesmo estado não grava nada.
 */
export async function definirNoPerfil(
  db: any,
  p: { tenantId: string; clienteId: string; telefone: string | null; lojaNome: string | null | undefined; ativo: boolean },
): Promise<{ ativo: boolean; mudou: boolean }> {
  const telefone = telefoneCadastro(p.telefone);
  const chave = chaveTelefone(telefone);
  if (!telefone || !chave) return { ativo: false, mudou: false };
  const s = await situacao(db, p.tenantId, chave, p.clienteId);
  const f = frasesPromocoes(p.lojaNome);
  if (p.ativo) {
    if (!s.fora && s.ultima === 'aceite') return { ativo: true, mudou: false };
    await registrarVolta(db, { tenantId: p.tenantId, telefone, clienteId: p.clienteId, origem: 'cardapio_perfil', texto: f.frase }, 'aceite');
    await marcarCadastros(db, p.tenantId, chave, p.clienteId, false);
    return { ativo: true, mudou: true };
  }
  if (s.fora) return { ativo: false, mudou: false };
  await registrarSaida(
    db,
    { tenantId: p.tenantId, telefone, clienteId: p.clienteId, origem: 'cardapio_perfil', texto: f.ligado, motivo: 'cardapio_perfil' },
    'recusa',
  );
  await marcarCadastros(db, p.tenantId, chave, p.clienteId, true);
  return { ativo: false, mudou: true };
}
