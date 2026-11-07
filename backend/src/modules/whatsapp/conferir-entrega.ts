import { sql } from 'drizzle-orm';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';
import { abrirChamadoPeloRobo, type Emitir } from '../atendimento/abrir-chamado';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "CHEGOU TUDO CERTO?" DEPOIS DA ENTREGA (B1 do plano do atendimento, aprovado pelo dono em 01/11/2026; mig 352). A
// pergunta sai UMA vez por pedido, com 3 botões, só pela API oficial e só dentro da janela de 24 h (decisão do dono:
// "pesquisa só dentro da janela") — a rotina está em conferir-entrega.processor.ts. Aqui: o texto, os botões, a leitura
// da resposta e o PORTÃO da entrada (a resposta não vai ao robô):
//  • "Tudo certo 👍" → só agradece (nada de pedir avaliação: o Google proíbe pedir só a quem gostou);
//  • "Tive um problema" → caso na central (normal), ligado ao pedido; o cliente conta o que houve e a equipe responde;
//  • "Não chegou" → caso URGENTE na central.
// Pedido de iFood e 99 nunca recebe: o contato com o cliente deles é da plataforma.

/** Quanto tempo depois de concluído o pedido a pergunta sai — e até quando ainda vale perguntar. */
export const DEPOIS_MIN = 20;
export const ATE_HORAS = 3;
/** Por quanto tempo a resposta do cliente conta como a resposta à pergunta. */
export const RESPOSTA_ATE_HORAS = 6;

export const ACAO_PERGUNTA = 'conferir_entrega';
export const ACAO_RESPOSTA = 'conferir_entrega_resposta';
/** Canais de marketplace: o contato com o cliente é da plataforma (termos do iFood e da 99). */
export const CANAIS_DE_FORA = ['ifood', '99food'];

export type RespostaDaConferencia = 'ok' | 'problema' | 'nao_chegou';

/** Os 3 botões (o título cabe nos 20 caracteres do botão da Meta). */
export const OPCOES_DA_CONFERENCIA = [
  { id: 'conferir_ok', titulo: 'Tudo certo 👍' },
  { id: 'conferir_problema', titulo: 'Tive um problema' },
  { id: 'conferir_nao_chegou', titulo: 'Não chegou' },
];

/** O que o cliente recebe depois de responder. */
export const TEXTO_DEPOIS_DA_RESPOSTA: Record<RespostaDaConferencia, string> = {
  ok: 'Que bom! 😊 Obrigado pela preferência.',
  problema: 'Poxa, sinto muito! Já avisei a equipe. Me conta aqui o que aconteceu que alguém responde em instantes.',
  nao_chegou: 'Poxa! Já avisei a equipe com prioridade e vamos verificar agora. Alguém responde aqui em instantes.',
};

/** A pergunta: o primeiro nome e o número do pedido. */
export function textoDaPergunta(nome: unknown, numero: unknown): string {
  const primeiro = String(nome ?? '').trim().split(/\s+/)[0];
  const n = String(numero ?? '').trim();
  return `Oi${primeiro ? `, ${primeiro}` : ''}! Seu pedido${n ? ` #${n}` : ''} chegou tudo certo? 🙂`;
}

const normal = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * A resposta do cliente: pelo botão (o id) ou por uma frase curta que diz o mesmo (quem escreve em vez de tocar). Texto
 * longo é outra conversa — vai ao robô, como sempre. Nada que case: null.
 */
export function classificarResposta(texto: unknown, opcaoId?: string | null): RespostaDaConferencia | null {
  const porBotao: Record<string, RespostaDaConferencia> = { conferir_ok: 'ok', conferir_problema: 'problema', conferir_nao_chegou: 'nao_chegou' };
  if (opcaoId && porBotao[opcaoId]) return porBotao[opcaoId];
  const t = normal(texto);
  if (!t || t.length > 40) return null;
  if (/^(3|nao chegou|ainda nao chegou|nao recebi|nao recebi ainda|nao veio)$/.test(t)) return 'nao_chegou';
  if (/^(2|tive um problema|problema|deu problema|teve problema|veio errado|faltou)$/.test(t)) return 'problema';
  if (/^(1|tudo certo|tudo ok|chegou|chegou sim|chegou tudo certo|sim|ok|certo|tudo otimo|tudo bem|perfeito|beleza)$/.test(t)) return 'ok';
  return null;
}

export type PedidoEsperandoConferencia = { id: string; numero: string | null; unidadeId: string | null; clienteNome: string | null };

/**
 * O pedido deste telefone que recebeu a pergunta há menos de 6 h (o mais recente). Se já foi respondido, quem barra é o
 * índice único da mig 352 na gravação da resposta (o portão) — uma regra só, que vale também entre duas réplicas. O
 * telefone é comparado pela CHAVE (com/sem 55 e nono dígito): o pedido guarda sem o 55, a conversa com.
 */
export async function pedidoEsperandoConferencia(db: any, tenantId: string, telefone: string): Promise<PedidoEsperandoConferencia | null> {
  const k = chaveTelefone(telefone);
  if (!k) return null;
  const r: any = await db.execute(sql`
    select p.id, coalesce(p.display_id, p.numero::text) as numero, p.unidade_id, p.cliente_nome
      from pedido_externo p
      join pedido_envio e on e.pedido_id = p.id and e.tenant_id = p.tenant_id and e.acao = ${ACAO_PERGUNTA} and e.resultado = 'enviado'
     where p.tenant_id = ${tenantId}::uuid
       and e.criado_em > now() - make_interval(hours => ${RESPOSTA_ATE_HORAS})
       and ${sqlChaveTelefone(sql`p.cliente_telefone`)} = ${k}
     order by e.criado_em desc
     limit 1`);
  const row = (r?.rows ?? r ?? [])[0];
  if (!row) return null;
  return { id: row.id, numero: row.numero ?? null, unidadeId: row.unidade_id ?? null, clienteNome: row.cliente_nome ?? null };
}

/**
 * O PORTÃO: é a resposta à pergunta? `tratou` = sim (o robô NÃO recebe a mensagem); `responder` = o que mandar ao
 * cliente. A resposta é gravada UMA vez por pedido (índice da mig 352) — a segunda mensagem segue ao robô. Problema e
 * "não chegou" abrem o caso na central, com o resumo; o caso aberto cala o robô na conversa.
 */
export async function portaoDaConferencia(
  db: any,
  emitir: Emitir,
  d: { tenantId: string; unidadeId?: string | null; telefone: string; nome?: string | null; texto: string; opcaoId?: string | null },
): Promise<{ tratou: boolean; responder: string | null; pedidoId?: string; resposta?: RespostaDaConferencia }> {
  const resposta = classificarResposta(d.texto, d.opcaoId);
  if (!resposta) return { tratou: false, responder: null };
  const ped = await pedidoEsperandoConferencia(db, d.tenantId, d.telefone);
  if (!ped) return { tratou: false, responder: null };
  const gravou: any = await db.execute(sql`
    insert into pedido_envio (tenant_id, unidade_id, pedido_id, destino, acao, resultado, motivo, servidor)
    values (${d.tenantId}::uuid, ${ped.unidadeId}, ${ped.id}::uuid, 'cliente_whatsapp', ${ACAO_RESPOSTA}, 'enviado', ${resposta}, 'nuvem')
    on conflict (pedido_id, acao) where acao in ('conferir_entrega', 'conferir_entrega_resposta') do nothing
    returning id`);
  if (!(gravou?.rows ?? gravou ?? []).length) return { tratou: false, responder: null }; // já respondeu: segue ao robô
  let responder = TEXTO_DEPOIS_DA_RESPOSTA[resposta];
  if (resposta !== 'ok') {
    const naoChegou = resposta === 'nao_chegou';
    const n = ped.numero ? ` #${ped.numero}` : '';
    const caso = await abrirChamadoPeloRobo(db, emitir, d.tenantId, ped.unidadeId ?? d.unidadeId ?? null, {
      tipo: 'erro',
      cliente: ped.clienteNome ?? d.nome ?? undefined,
      telefone: d.telefone,
      pedidoNumero: ped.numero ?? undefined,
      pedidoId: ped.id,
      mensagem: `Resposta ao "Chegou tudo certo?" do pedido${n}: ${naoChegou ? 'não chegou' : 'teve um problema'}.`,
      prioridade: naoChegou ? 'urgente' : 'normal',
      resumo: {
        motivo: naoChegou ? `Pedido${n} não chegou (o pedido está como concluído)` : `Problema no pedido${n}`,
        quer: naoChegou ? 'Receber o pedido' : null,
        jaFez: `Perguntou "Chegou tudo certo?"; o cliente respondeu "${naoChegou ? 'Não chegou' : 'Tive um problema'}" e foi avisado de que a equipe responde aqui`,
        humor: null,
      },
    });
    // HORÁRIO DA EQUIPE (mig 379): o pedido já concluído, fora do horário, vira RECADO para a abertura — o cliente não
    // ouve "alguém responde em instantes", e sim quando a equipe volta (a frase da loja).
    if (caso.foraDoHorario && caso.paraOCliente) responder = textoDepoisDaRespostaForaDoHorario(resposta, caso.paraOCliente);
  }
  return { tratou: true, responder, pedidoId: ped.id, resposta };
}

/** A resposta ao "Chegou tudo certo?" quando o caso virou recado (fora do horário da equipe): sem "em instantes". */
export function textoDepoisDaRespostaForaDoHorario(resposta: RespostaDaConferencia, paraOCliente: string): string {
  return resposta === 'problema' ? `Poxa, sinto muito! Me conta aqui o que aconteceu. ${paraOCliente}` : `Poxa! ${paraOCliente}`;
}
