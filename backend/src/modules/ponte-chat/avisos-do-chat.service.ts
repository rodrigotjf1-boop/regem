import { Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { DeliveryService } from '../delivery/delivery.service';
import { SEM_LOGISTICA_DO_CANAL } from '../entregador/modo-entrega';
import { MotivoDoAviso, TEXTO_PADRAO, montarAviso } from './texto-do-chat';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS AVISOS AUTOMÁTICOS no chat do iFood e da 99, pela ponte (ponte do chat, parte A2 — pedido do dono, 04/11/2026: "quando
// o Regem despachar o pedido, já enviar mensagem como no WhatsApp de que o pedido saiu; quando o entregador chegar, pela
// distância dele, o aviso também pelo chat"). O aviso entra na FILA DE SAÍDA (`chat_plataforma_msg`, motivo 'saiu' |
// 'chegando' | 'obrigado'); a ponte que responde pelo canal digita no chat. Um aviso por pedido e motivo (índice único —
// duas réplicas, duas voltas e o botão "estou chegando" junto do automático não mandam dois). Só com a ponte LIGADA e o
// aviso ligado nos ajustes; só pedido de entrega do iFood e da 99. "Saiu" e "chegando" só na ENTREGA DA LOJA: quando o
// entregador é da plataforma (iFood deliveredBy=IFOOD, 99 delivery_type=1), quem avisa o cliente é a própria plataforma —
// a mesma regra da fila do entregador (`SEM_LOGISTICA_DO_CANAL`). O "obrigado" vale para as duas.
//
// "Saiu" e "obrigado" nascem de uma rotina da nuvem (o processador) porque a 99 não tem ação de despacho e o despacho
// feito no servidor da loja não gera evento na nuvem; "chegando", da cerca de 70 m do entregador (que roda na nuvem).

const CANAIS_DO_CHAT = sql`('ifood', '99food')`;
/** "Saiu" só para quem saiu há pouco: ligar a ponte não dispara o aviso do que saiu há uma hora. */
export const JANELA_SAIU_MIN = 10;
/** "Obrigado" só para quem foi concluído há pouco. */
export const JANELA_OBRIGADO_MIN = 30;
export const POR_VOLTA = 100;

const linhas = (r: any): any[] => (r?.rows ?? r) as any[];

export type ResultadoDoAviso = 'enfileirado' | 'ja_enfileirado' | 'desligado' | 'fora';

@Injectable()
export class AvisosDoChatService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // A previsão "20h15" do "saiu" (a conta do rastreio). Opcional: os testes montam sem ela — o texto sai sem a hora.
    @Optional() private readonly delivery?: DeliveryService,
  ) {}

  /** Grava os avisos já montados — uma consulta; o que já existe para o pedido e o motivo fica (índice único). */
  private async gravar(itens: { pedidoId: string; motivo: MotivoDoAviso; texto: string }[]): Promise<number> {
    if (!itens.length) return 0;
    const r = linhas(await this.db.execute(sql`
      insert into chat_plataforma_msg
        (tenant_id, unidade_id, canal, pedido_id, pedido_externo, pedido_numero, cliente_nome, direcao, autor, motivo, texto, estado)
      select pe.tenant_id, pe.unidade_id, pe.canal, pe.id, pe.external_id, pe.display_id, pe.cliente_nome,
             'saida', 'aviso', x.motivo, x.texto, 'pendente'
        from jsonb_to_recordset(${JSON.stringify(itens)}::jsonb) as x("pedidoId" uuid, motivo text, texto text)
        join pedido_externo pe on pe.id = x."pedidoId"
      on conflict (pedido_id, motivo) where motivo is not null do nothing
      returning id`));
    return r.length;
  }

  /**
   * "O entregador está chegando" — chamado pela cerca de 70 m do entregador (e pelo botão "estou chegando" do app).
   * Pedido de entrega do iFood ou da 99, ainda a caminho, com a ponte e o aviso ligados.
   */
  async enfileirarChegando(tenantId: string, pedidoId: string): Promise<ResultadoDoAviso> {
    const [p] = linhas(await this.db.execute(sql`
      select pe.id, pe.cliente_nome, rc.chat_ponte_ligada, rc.chat_aviso_chegando, rc.chat_aviso_chegando_texto
        from pedido_externo pe
        left join robo_config rc on rc.tenant_id = pe.tenant_id
       where pe.id = ${pedidoId}::uuid and pe.tenant_id = ${tenantId}::uuid
         and pe.canal in ${CANAIS_DO_CHAT} and pe.tipo <> 'retirada' and pe.status = 'despachado'
         and ${SEM_LOGISTICA_DO_CANAL}`));
    if (!p) return 'fora';
    if (p.chat_ponte_ligada !== true || p.chat_aviso_chegando !== true) return 'desligado';
    const texto = montarAviso(p.chat_aviso_chegando_texto || TEXTO_PADRAO.chegando, { nome: p.cliente_nome });
    return (await this.gravar([{ pedidoId: p.id, motivo: 'chegando', texto }])) ? 'enfileirado' : 'ja_enfileirado';
  }

  /**
   * Os pedidos que pedem "saiu" ou "obrigado" agora — TODAS as lojas numa consulta (set-based). A condição inteira está
   * no `where` (LIC-527): o que não pode receber nem entra na lista, então nada toma a vez de quem pode.
   */
  async candidatos(): Promise<any[]> {
    return linhas(await this.db.execute(sql`
      select pe.id, pe.tenant_id, pe.cliente_nome, m.motivo,
             case m.motivo when 'saiu' then rc.chat_aviso_saiu_texto else rc.chat_aviso_obrigado_texto end as modelo
        from robo_config rc
        join pedido_externo pe on pe.tenant_id = rc.tenant_id
        cross join lateral (values ('saiu'), ('obrigado')) as m(motivo)
       where rc.chat_ponte_ligada
         and pe.canal in ${CANAIS_DO_CHAT} and pe.tipo <> 'retirada'
         and ((m.motivo = 'saiu' and rc.chat_aviso_saiu and pe.status = 'despachado'
               and pe.despachado_em > now() - make_interval(mins => ${JANELA_SAIU_MIN})
               and ${SEM_LOGISTICA_DO_CANAL})
           or (m.motivo = 'obrigado' and rc.chat_aviso_obrigado and pe.status in ('entregue', 'concluido')
               and coalesce(pe.entregue_em, pe.concluido_em) > now() - make_interval(mins => ${JANELA_OBRIGADO_MIN})))
         and not exists (select 1 from chat_plataforma_msg c where c.pedido_id = pe.id and c.motivo = m.motivo)
       order by pe.criado_em
       limit ${POR_VOLTA}`));
  }

  /** Uma volta da rotina: monta e grava os "saiu" (com a previsão) e os "obrigado". Devolve quantos entraram na fila. */
  async enfileirarDaVolta(): Promise<number> {
    const itens: { pedidoId: string; motivo: MotivoDoAviso; texto: string }[] = [];
    for (const c of await this.candidatos()) {
      const motivo = c.motivo as MotivoDoAviso;
      const hora = motivo === 'saiu' && this.delivery ? await this.delivery.horaPrevistaDoPedido(c.tenant_id, c.id).catch(() => null) : null;
      itens.push({ pedidoId: c.id, motivo, texto: montarAviso(c.modelo || TEXTO_PADRAO[motivo], { nome: c.cliente_nome, hora }) });
    }
    return this.gravar(itens);
  }
}
