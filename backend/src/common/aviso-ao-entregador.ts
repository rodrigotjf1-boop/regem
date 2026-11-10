import { sql } from 'drizzle-orm';
import { ehServidorLocal } from './modo';
import { chaveTelefone, sqlChaveTelefone } from './telefone-chave';
import { SEM_LOGISTICA_DO_CANAL } from '../modules/entregador/modo-entrega';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS AVISOS AO ENTREGADOR (mig 391; pedido do dono, 10/11/2026). Uma regra só para quem cria o aviso:
//  • o AUTOMÁTICO — o cliente perguntou pelo pedido ou reclamou de demora pelo WhatsApp da loja (as duas vias) ou pelo
//    chat do iFood/99 (a ponte), com o pedido A CAMINHO na mão de um entregador da loja. Não tira a mensagem do robô: o
//    robô (ou a equipe) responde como sempre; o entregador só fica sabendo. Um aberto por pedido e motivo até ele
//    responder (índice único parcial da 391);
//  • o do ATENDIMENTO — a equipe encaminhou pelo caso, com o motivo e o recado; vale também depois da entrega (faltou
//    bebida, troco, item: até 12 h depois de concluído).
// Só a NUVEM tem a tabela: no servidor da loja o automático não faz nada (a mensagem chega na nuvem de qualquer jeito)
// e o Atendimento pede à nuvem.

export const MOTIVOS_DO_AVISO = ['onde_esta', 'demora', 'faltou_item', 'faltou_troco', 'outro'] as const;
export type MotivoDoAviso = (typeof MOTIVOS_DO_AVISO)[number];
export const ehMotivoDoAviso = (v: unknown): v is MotivoDoAviso => (MOTIVOS_DO_AVISO as readonly string[]).includes(String(v));

/** O que o entregador fez com o aviso no app. */
export const RESPOSTAS_DO_AVISO = ['a_caminho', 'cheguei', 'imprevisto', 'ligou', 'mensagem', 'ok'] as const;
export type RespostaDoAviso = (typeof RESPOSTAS_DO_AVISO)[number];
export const ehRespostaDoAviso = (v: unknown): v is RespostaDoAviso => (RESPOSTAS_DO_AVISO as readonly string[]).includes(String(v));

/** Como o motivo aparece para quem lê (app e Atendimento). */
export const ROTULO_DO_MOTIVO: Record<MotivoDoAviso, string> = {
  onde_esta: 'O cliente está perguntando pelo pedido',
  demora: 'O cliente está reclamando da demora',
  faltou_item: 'Faltou item no pedido',
  faltou_troco: 'Faltou o troco',
  outro: 'Recado do atendimento',
};

/** Depois de concluído, por quanto tempo a equipe ainda encaminha ao entregador (faltou bebida, troco, item). */
export const HORAS_DEPOIS_DA_ENTREGA = 12;
/** O app mostra os avisos abertos até este tempo; depois, o assunto já passou. */
export const HORAS_DO_AVISO_ABERTO = 4;

const normalizar = (texto: unknown) =>
  String(texto ?? '')
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const DEMORA =
  /\b(demor\w*|atrasad\w*|atraso|ainda nao chegou|nao chegou|falta muito|to esperando|estou esperando|esperando ate agora|faz uma hora|mais de uma hora)\b/;
const ONDE_ESTA =
  /\b(cade|onde (esta|ta|anda|fica)|ja saiu|saiu ja|quanto tempo|previsao|que horas|chega quando|quando chega|ta chegando|esta chegando|ta vindo|esta vindo|vem quando)\b/;

/** O que a mensagem do cliente pede ao entregador saber: a demora, onde está o pedido — ou nada. */
export function motivoDaMensagem(texto: unknown): 'onde_esta' | 'demora' | null {
  const t = normalizar(texto);
  if (!t || t.length > 300) return null;
  if (DEMORA.test(t)) return 'demora';
  if (ONDE_ESTA.test(t)) return 'onde_esta';
  return null;
}

/** As respostas que mandam mensagem ao cliente (as outras só registram o que o entregador fez). */
export const RESPOSTAS_AO_CLIENTE = ['a_caminho', 'cheguei', 'imprevisto'] as const;
export type RespostaAoCliente = (typeof RESPOSTAS_AO_CLIENTE)[number];
export const ehRespostaAoCliente = (v: unknown): v is RespostaAoCliente => (RESPOSTAS_AO_CLIENTE as readonly string[]).includes(String(v));

/**
 * O texto que o cliente recebe quando o entregador responde no app — o MESMO no chat do iFood/99 (sem link nem telefone:
 * regra da plataforma) e no WhatsApp da loja. `depoisDaEntrega` = o entregador volta com o que faltou.
 */
export function textoDaResposta(acao: RespostaAoCliente, o: { ref: string; depoisDaEntrega: boolean }): { titulo: string; texto: string } {
  const ref = o.ref;
  if (acao === 'a_caminho')
    return o.depoisDaEntrega
      ? { titulo: 'O entregador está voltando', texto: `O entregador está voltando com o que faltou no seu pedido${ref}. 🛵` }
      : { titulo: 'O entregador está a caminho', texto: `Seu pedido${ref} está a caminho! 🛵 O entregador já está indo até você.` };
  if (acao === 'cheguei')
    return { titulo: 'O entregador chegou', texto: `O entregador chegou com o seu pedido${ref}! 📍 Ele está no endereço de entrega.` };
  return {
    titulo: 'O entregador teve um imprevisto',
    texto: `O entregador teve um imprevisto no caminho, mas já está chegando com o seu pedido${ref}. Obrigado pela paciência! 🙏`,
  };
}

export type ResultadoDoAvisoAoEntregador = { estado: 'avisado' | 'ja_avisado' | 'fora'; id?: string };

/**
 * Cria o aviso ao entregador DO PEDIDO (o que está com ele agora). Fora (sem aviso): pedido de outra empresa, sem
 * entregador, retirada, entregador da plataforma (iFood/99 entregam — `SEM_LOGISTICA_DO_CANAL`), ou fora do tempo
 * (automático: só a caminho; atendimento: a caminho, entregue ou concluído há até 12 h). O automático repetido com um
 * aberto do mesmo motivo = 'ja_avisado' (o índice único da 391 decide, também com duas réplicas ao mesmo tempo — V24).
 */
export async function avisarEntregador(
  db: any,
  d: {
    tenantId: string;
    pedidoId: string;
    origem: 'robo' | 'atendimento';
    motivo: MotivoDoAviso;
    texto?: string | null;
    chamadoId?: string | null;
    enviadoPor?: string | null;
  },
): Promise<ResultadoDoAvisoAoEntregador> {
  if (!ehMotivoDoAviso(d.motivo)) throw new Error(`motivo de aviso desconhecido: ${d.motivo}`);
  const texto = String(d.texto ?? '').trim().slice(0, 500) || null;
  const situacao =
    d.origem === 'robo'
      ? sql`pe.status = 'despachado'`
      : sql`(pe.status in ('despachado', 'entregue')
             or (pe.status = 'concluido'
                 and coalesce(pe.concluido_em, pe.entregue_em) > now() - make_interval(hours => ${HORAS_DEPOIS_DA_ENTREGA})))`;
  const r: any = await db.execute(sql`
    insert into entregador_aviso (tenant_id, pedido_id, colaborador_id, chamado_id, origem, motivo, texto, enviado_por)
    select pe.tenant_id, pe.id, pe.entregador_id, ${d.chamadoId ?? null}::uuid, ${d.origem}, ${d.motivo}, ${texto},
           ${d.enviadoPor ?? null}::uuid
      from pedido_externo pe
     where pe.tenant_id = ${d.tenantId}::uuid and pe.id = ${d.pedidoId}::uuid
       and pe.entregador_id is not null and pe.tipo <> 'retirada'
       and ${situacao}
       and ${SEM_LOGISTICA_DO_CANAL}
    on conflict (pedido_id, motivo) where origem = 'robo' and respondido_em is null do nothing
    returning id`);
  const novo = (r?.rows ?? r ?? [])[0];
  if (novo) return { estado: 'avisado', id: String(novo.id) };
  if (d.origem !== 'robo') return { estado: 'fora' };
  const ja: any = await db.execute(sql`
    select id from entregador_aviso
     where pedido_id = ${d.pedidoId}::uuid and motivo = ${d.motivo} and origem = 'robo' and respondido_em is null limit 1`);
  const aberto = (ja?.rows ?? ja ?? [])[0];
  return aberto ? { estado: 'ja_avisado', id: String(aberto.id) } : { estado: 'fora' };
}

/**
 * O AUTOMÁTICO pela mensagem do cliente no WhatsApp da loja (as duas vias chamam): o pedido A CAMINHO deste telefone
 * (pela CHAVE — o pedido guarda sem o 55, a conversa com), de até 12 h, com entregador. Não decide nada da conversa (o
 * robô segue). Nunca rejeita (V3): quem chama não pode parar por causa do aviso — banco sem a 391, servidor da loja,
 * qualquer falha = nada.
 */
export async function avisarPelaMensagemDoCliente(
  db: any,
  d: { tenantId: string; telefone: string; texto: unknown },
): Promise<ResultadoDoAvisoAoEntregador | null> {
  try {
    if (ehServidorLocal()) return null;
    const motivo = motivoDaMensagem(d.texto);
    if (!motivo) return null;
    const k = chaveTelefone(d.telefone);
    if (!k) return null;
    const r: any = await db.execute(sql`
      select pe.id from pedido_externo pe
       where pe.tenant_id = ${d.tenantId}::uuid and pe.status = 'despachado' and pe.tipo <> 'retirada'
         and pe.entregador_id is not null
         and pe.criado_em > now() - interval '12 hours'
         and ${sqlChaveTelefone(sql`pe.cliente_telefone`)} = ${k}
       order by pe.despachado_em desc nulls last
       limit 1`);
    const id = (r?.rows ?? r ?? [])[0]?.id;
    if (!id) return null;
    return await avisarEntregador(db, { tenantId: d.tenantId, pedidoId: String(id), origem: 'robo', motivo, texto: String(d.texto ?? '') });
  } catch {
    return null;
  }
}
