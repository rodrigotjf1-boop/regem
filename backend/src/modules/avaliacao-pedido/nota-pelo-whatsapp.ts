import { sql } from 'drizzle-orm';
import { chaveTelefone } from '../../common/telefone-chave';
import type { Emitir } from '../atendimento/abrir-chamado';
import { googleDaNota } from './nota-do-pedido';
import { gravarNota, lerPedidoParaNota, situacaoDaNota } from './nota-do-pedido.service';
import {
  TEXTO_ENCERROU,
  TEXTO_JA_AVALIOU,
  VERSAO_DO_FORMULARIO,
  lerRespostaDoFormulario,
  textoDepoisDaNota,
  tituloDoFormulario,
  tokenDaNota,
} from './formulario-da-nota';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A NOTA PELO FORMULÁRIO DO WHATSAPP OFICIAL (fase A2, mig 456). Três peças, todas só na NUVEM (o WhatsApp oficial só
// existe lá):
//  • o CONVITE: depois do "Tudo certo 👍" do "Chegou tudo certo?", se o pedido ainda pode receber nota e a conta da loja
//    tem o formulário publicado, o obrigado vira a mensagem com o botão "Avaliar pedido" (sem formulário: o obrigado de
//    sempre — quem decide é o `WhatsappCloudService`);
//  • o REGISTRO do convite em `pedido_envio` (ação `pedir_nota`), como os outros envios ao cliente;
//  • o PORTÃO da resposta (`interactive.nfm_reply`): grava a nota pelo MESMO caminho da página (`gravarNota` — uma por
//    pedido, o caso na nota baixa) e diz o que responder (o Google só na nota 5). Antes do robô.

export const TIPO_DO_FORMULARIO = 'nota_do_pedido';
export const ACAO_PEDIR_NOTA = 'pedir_nota';

const rows = (r: any): any[] => r?.rows ?? r ?? [];

/**
 * O formulário publicado (versão atual) na conta do número da loja — a WABA do `cardapio_config` da empresa, que é a do
 * número que envia. null = não há (ainda preparando, recusado, conexão por QR Code ou banco sem a mig 456).
 */
export async function formularioPublicado(db: any, tenantId: string): Promise<{ flowId: string } | null> {
  try {
    const r: any = await db.execute(sql`
      select f.flow_id
        from whatsapp_flow f
        join cardapio_config cc on cc.tenant_id = f.tenant_id and cc.unidade_id is null and cc.provedor = 'cloud'
                               and cc.wa_cloud_waba_id = f.waba_id
       where f.tenant_id = ${tenantId}::uuid and f.tipo = ${TIPO_DO_FORMULARIO} and f.versao = ${VERSAO_DO_FORMULARIO}
         and f.situacao = 'publicado' and coalesce(f.flow_id, '') <> ''
       order by f.publicado_em desc nulls last
       limit 1`);
    const l = rows(r)[0];
    return l?.flow_id ? { flowId: String(l.flow_id) } : null;
  } catch (e: any) {
    if (e?.code === '42P01') return null;
    throw e;
  }
}

/**
 * A situação do formulário para a TELA da loja (o cartão "Pedir uma nota depois da entrega"): publicado; a DMS
 * preparando (inclusive a nova tentativa depois de um erro da Meta); a Meta recusou (a DMS vê o motivo — é da
 * distribuição, não vai à tela); ou a loja não usa o WhatsApp oficial (só a página do pedido).
 */
export type SituacaoDoFormulario = 'publicado' | 'preparando' | 'recusado' | 'sem_oficial';

export async function situacaoDoFormulario(db: any, tenantId: string): Promise<SituacaoDoFormulario> {
  try {
    const r: any = await db.execute(sql`
      select cc.provedor, cc.wa_cloud_waba_id, f.situacao
        from cardapio_config cc
        left join whatsapp_flow f on f.waba_id = cc.wa_cloud_waba_id and f.tipo = ${TIPO_DO_FORMULARIO} and f.versao = ${VERSAO_DO_FORMULARIO}
       where cc.tenant_id = ${tenantId}::uuid and cc.unidade_id is null
       order by f.publicado_em desc nulls last
       limit 1`);
    const l = rows(r)[0];
    if (!l || l.provedor !== 'cloud' || !String(l.wa_cloud_waba_id ?? '').trim()) return 'sem_oficial';
    if (l.situacao === 'publicado') return 'publicado';
    if (l.situacao === 'recusado') return 'recusado';
    return 'preparando';
  } catch (e: any) {
    if (e?.code === '42P01' || e?.code === '42703') return 'preparando';
    throw e;
  }
}

export type ConviteDaNota = { flowId: string; token: string; titulo: string; unidadeId: string | null };

/**
 * O convite pode sair para ESTE pedido? Ele ainda pode receber nota (a mesma situação da página: ajuste ligado, pedido do
 * Regem, entregue, sem nota, no prazo) e a conta tem o formulário publicado. null = não convida (sai o obrigado de sempre).
 */
export async function conviteDaNota(db: any, tenantId: string, pedidoId: string): Promise<ConviteDaNota | null> {
  const l = await lerPedidoParaNota(db, { tenantId, pedidoId });
  if (!l || situacaoDaNota(l) !== 'aberta') return null;
  const f = await formularioPublicado(db, tenantId);
  if (!f) return null;
  const numero = l.display_id ?? (l.numero != null ? String(l.numero) : null);
  return { flowId: f.flowId, token: tokenDaNota(pedidoId), titulo: tituloDoFormulario(numero), unidadeId: l.unidade_id ?? null };
}

/** O convite saiu (ou não): fica no registro dos envios do pedido, como os outros avisos ao cliente. Nunca lança. */
export async function registrarConvite(
  db: any,
  d: { tenantId: string; unidadeId: string | null; pedidoId: string; resultado: 'enviado' | 'falhou'; motivo?: string | null },
): Promise<void> {
  try {
    await db.execute(sql`
      insert into pedido_envio (tenant_id, unidade_id, pedido_id, destino, acao, resultado, motivo, servidor)
      values (${d.tenantId}::uuid, ${d.unidadeId}, ${d.pedidoId}::uuid, 'cliente_whatsapp', ${ACAO_PEDIR_NOTA}, ${d.resultado},
              ${d.motivo ? String(d.motivo).slice(0, 400) : null}, 'nuvem')`);
  } catch {
    /* o registro é para conferir depois; nunca derruba a conversa */
  }
}

export type PortaoDaNota = { tratou: boolean; responder: string | null; pedidoId?: string; motivo?: string };

/**
 * O PORTÃO da resposta do formulário. `tratou` falso = não é o nosso formulário (outro Flow da conta, ou sem o token):
 * segue o caminho de sempre. Sendo o nosso, o robô nunca recebe a mensagem: a nota só vale da conversa do CLIENTE do
 * pedido, na loja do pedido (o pedido é lido pela empresa da conversa e o telefone conferido pela chave); a situação é a
 * mesma da página. `responder` null = nada a dizer (o `motivo` vai para o log).
 */
export async function portaoDaNotaPeloWhatsapp(
  db: any,
  emitir: Emitir,
  d: { tenantId: string; telefone: string; nome?: string | null; m: any },
): Promise<PortaoDaNota> {
  const r = lerRespostaDoFormulario(d.m);
  if (!r || !r.pedidoId) return { tratou: false, responder: null };
  const l = await lerPedidoParaNota(db, { tenantId: d.tenantId, pedidoId: r.pedidoId });
  if (!l) return { tratou: true, responder: null, motivo: 'pedido de outra loja ou inexistente' };
  const k = chaveTelefone(l.cliente_telefone);
  if (!k || k !== chaveTelefone(d.telefone)) return { tratou: true, responder: null, pedidoId: l.id, motivo: 'outro telefone' };
  if (!r.nota) return { tratou: true, responder: null, pedidoId: l.id, motivo: 'campos do formulário fora da regra' };
  const s = situacaoDaNota(l);
  if (s === 'avaliado') return { tratou: true, responder: TEXTO_JA_AVALIOU, pedidoId: l.id, motivo: 'já avaliado' };
  if (s === 'encerrada') return { tratou: true, responder: TEXTO_ENCERROU, pedidoId: l.id, motivo: 'prazo encerrado' };
  if (s !== 'aberta') return { tratou: true, responder: null, pedidoId: l.id, motivo: `situação ${s}` };
  const g = await gravarNota(db, emitir, l, r.nota, 'whatsapp');
  if (!g) return { tratou: true, responder: TEXTO_JA_AVALIOU, pedidoId: l.id, motivo: 'já avaliado (gravação)' };
  const numero = l.display_id ?? (l.numero != null ? String(l.numero) : null);
  return {
    tratou: true,
    pedidoId: l.id,
    responder: textoDepoisDaNota({
      nome: l.cliente_nome ?? d.nome ?? null,
      nota: r.nota.nota,
      caso: !!g.caso,
      google: googleDaNota(r.nota.nota, l.avaliacao_link),
      pedidoNumero: numero,
      foraDoHorario: g.caso?.paraOCliente ?? null,
    }),
  };
}
