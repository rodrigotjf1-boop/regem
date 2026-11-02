import { sql } from 'drizzle-orm';
import { pedidoEnvio } from '../../db/schema';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';
import { abrirChamadoPeloRobo, type Emitir } from '../atendimento/abrir-chamado';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A RESPOSTA DO CLIENTE AO "ENTREGADOR SEM CONTATO" (Onda 0 do plano do atendimento, 01/11/2026). O aviso pede ao cliente
// "Responda esta mensagem para combinar a entrega" — e a resposta caía no robô, que não sabia de entrega nenhuma: nada
// chegava ao entregador nem à equipe. Agora a mensagem do cliente que tem um pedido A CAMINHO com o "sem contato"
// enviado há pouco é a resposta a ele:
//  • abre (ou soma a) um chamado URGENTE ligado ao pedido — a equipe vê no painel, o entregador vê no app, e o chamado
//    aberto cala o robô nessa conversa (a pessoa assume, como em todo chamado);
//  • o cliente recebe UMA confirmação por aviso de "sem contato" (registrada no pedido: `sem_contato_resposta`).
// Vale com o robô ligado ou desligado: quem pediu a resposta foi o aviso, não o robô. As duas vias (oficial e QR) usam
// esta mesma função; cada uma manda a confirmação pelo seu caminho e diz aqui como foi.

/** Por quanto tempo depois do "sem contato" a mensagem do cliente conta como a resposta a ele. */
export const JANELA_DA_RESPOSTA_MIN = 30;

/** Como o chamado começa — o app do entregador mostra o que vem depois. */
export const PREFIXO_DA_RESPOSTA = 'O cliente respondeu ao "entregador sem contato": ';

/** A confirmação ao cliente (uma por aviso de "sem contato"). */
export const TEXTO_RESPOSTA_RECEBIDA =
  'Recebido ✅ Avisei o entregador e a loja da sua mensagem. Já vamos combinar a entrega com você por aqui.';

const ACAO_CONFIRMACAO = 'sem_contato_resposta';

export type PedidoEsperandoResposta = {
  id: string;
  numero: string | null;
  unidadeId: string | null;
  clienteNome: string | null;
  /** A confirmação deste aviso de "sem contato" já saiu (o cliente mandou mais de uma mensagem). */
  jaConfirmado: boolean;
};

/**
 * O pedido deste telefone que está a caminho e recebeu o "sem contato" há menos de 30 min (o registro de envio diz
 * "enviado"). O telefone é comparado pela CHAVE (com/sem 55 e nono dígito): o pedido guarda sem o 55, a conversa com.
 */
export async function pedidoEsperandoResposta(db: any, tenantId: string, telefone: string): Promise<PedidoEsperandoResposta | null> {
  const k = chaveTelefone(telefone);
  if (!k) return null;
  const r: any = await db.execute(sql`
    select p.id, coalesce(p.display_id, p.numero::text) as numero, p.unidade_id, p.cliente_nome, s.em as aviso_em,
           exists (select 1 from pedido_envio c
                    where c.pedido_id = p.id and c.tenant_id = p.tenant_id
                      and c.acao = ${ACAO_CONFIRMACAO} and c.resultado = 'enviado' and c.criado_em >= s.em) as ja_confirmado
      from pedido_externo p
      join lateral (
        select max(e.criado_em) as em from pedido_envio e
         where e.pedido_id = p.id and e.tenant_id = p.tenant_id
           and e.acao = 'sem_contato' and e.resultado = 'enviado'
      ) s on s.em > now() - make_interval(mins => ${JANELA_DA_RESPOSTA_MIN})
     where p.tenant_id = ${tenantId}::uuid
       and p.status = 'despachado'
       and p.tipo = 'entrega'
       and ${sqlChaveTelefone(sql`p.cliente_telefone`)} = ${k}
     order by s.em desc
     limit 1`);
  const row = (r?.rows ?? r ?? [])[0];
  if (!row) return null;
  return {
    id: row.id,
    numero: row.numero ?? null,
    unidadeId: row.unidade_id ?? null,
    clienteNome: row.cliente_nome ?? null,
    jaConfirmado: row.ja_confirmado === true,
  };
}

/**
 * O portão: `tratou` = era a resposta ao "sem contato" (o robô NÃO recebe a mensagem); `responder` = a confirmação a
 * mandar ao cliente (null quando ela já saiu para este aviso).
 */
export async function portaoDaRespostaAoSemContato(
  db: any,
  emitir: Emitir,
  d: { tenantId: string; unidadeId?: string | null; telefone: string; nome?: string | null; texto: string },
): Promise<{ tratou: boolean; responder: string | null; pedidoId?: string }> {
  const ped = await pedidoEsperandoResposta(db, d.tenantId, d.telefone);
  if (!ped) return { tratou: false, responder: null };
  const texto = String(d.texto ?? '').trim() || '(mandou áudio, foto ou outro anexo: veja na conversa)';
  await abrirChamadoPeloRobo(db, emitir, d.tenantId, ped.unidadeId ?? d.unidadeId ?? null, {
    tipo: 'outro',
    cliente: ped.clienteNome ?? d.nome ?? undefined,
    telefone: d.telefone,
    pedidoNumero: ped.numero ?? undefined,
    pedidoId: ped.id,
    mensagem: `${PREFIXO_DA_RESPOSTA}${texto}`.slice(0, 1000),
    prioridade: 'urgente',
  });
  return { tratou: true, responder: ped.jaConfirmado ? null : TEXTO_RESPOSTA_RECEBIDA, pedidoId: ped.id };
}

/** Registra no pedido como foi a confirmação ao cliente (a mesma linha do tempo dos avisos). Nunca rejeita. */
export async function registrarConfirmacao(
  db: any,
  tenantId: string,
  pedidoId: string,
  resultado: 'enviado' | 'falhou',
  motivo?: string,
): Promise<void> {
  try {
    await db.insert(pedidoEnvio).values({
      tenantId,
      pedidoId,
      destino: 'cliente_whatsapp',
      acao: ACAO_CONFIRMACAO,
      resultado,
      motivo: motivo ? motivo.slice(0, 300) : null,
    });
  } catch {
    /* o registro é histórico: não pode derrubar a entrada da mensagem */
  }
}
