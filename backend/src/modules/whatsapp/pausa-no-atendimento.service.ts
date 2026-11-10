import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { idPausaDoCanal } from '../../common/id-deterministico';
import { montarMensagemDaPausa, pausaVigenteDoCanal, pedeOAudio } from '../../common/pausa-do-canal';
import { RoboRespostaService } from './robo-resposta.service';
import { definirPorteiroDaPausa } from './juntar-mensagens';

/* eslint-disable @typescript-eslint/no-explicit-any */

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
/** As conversas que não são de cliente: o teste do atendente, o chat do iFood/99 (a pausa é de outro canal) e o comentário. */
const FORA_DA_PAUSA = /^(teste|chat|cm):/;

/**
 * A PAUSA DOS PEDIDOS NO ATENDIMENTO (F3, migs 394 e 395; protótipo `mockups/regem-pausa.html`). Com o cardápio digital
 * pausado no painel, a PRIMEIRA mensagem do cliente ao atendente (WhatsApp nas duas vias, Instagram Direct, Messenger)
 * é respondida pelo Regem com a mensagem pronta da pausa — formatada, com o nome, o motivo e a hora de volta — e não vai
 * ao robô. Uma vez por cliente em cada pausa (estender não avisa de novo; pausar de novo, sim). As mensagens seguintes vão
 * ao robô como sempre: ele sabe da pausa pelo `consultar_loja` (o `resumoDaLoja` traz a pausa e a mensagem de ausência
 * vira a da pausa).
 *
 * Por que o Regem manda e não o robô: o robô do n8n escreve curto e sem formatação ("no máximo 3 frases, sem markdown") —
 * a mensagem pedida pelo dono é a formatada, com espaços e emojis. Sai pela MESMA porta das respostas do robô
 * (`RoboRespostaService.responderDoRegem`): o canal certo e as mesmas travas (robô ligado, conversa não assumida).
 *
 * Só na nuvem (é lá que o atendente recebe). Nunca segura a mensagem por erro: na dúvida, vai ao robô ('segue').
 */
@Injectable()
export class PausaNoAtendimentoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PausaNoAtendimento');
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly resposta: RoboRespostaService,
  ) {}

  onModuleInit(): void {
    if (!ehServidorLocal()) definirPorteiroDaPausa((m) => this.decidir(m));
  }

  onModuleDestroy(): void {
    definirPorteiroDaPausa(null);
  }

  /**
   * A mensagem (já juntada) do cliente: 'respondido' quando o Regem mandou a mensagem da pausa; 'falar' quando ela vai ao
   * robô pedindo a resposta em áudio (F4); senão 'segue' (ao robô, como sempre).
   */
  async decidir(msg: any, agora: Date = new Date()): Promise<'segue' | 'respondido' | 'falar'> {
    try {
      const tenantId = String(msg?.tenantId ?? '');
      const token = String(msg?.cardapioToken ?? '');
      const chave = String(msg?.de ?? '').trim();
      if (!tenantId || !token || !chave) return 'segue';
      if (FORA_DA_PAUSA.test(chave) || FORA_DA_PAUSA.test(String(msg?.instancia ?? ''))) return 'segue';
      const [cfg] = linhas(
        await this.db.execute(sql`
          select c.unidade_id, to_jsonb(c) ->> 'pausa_mensagem' as modelo, to_jsonb(c) ->> 'pausa_audio' as audio
            from cardapio_config c where c.token = ${token} and c.tenant_id = ${tenantId}::uuid limit 1`),
      );
      if (!cfg) return 'segue';
      const pausa = await pausaVigenteDoCanal(this.db, tenantId, cfg.unidade_id ?? null, 'cardapio', agora);
      if (!pausa?.pausadoEm) return 'segue';
      // A contagem sobe na MESMA instrução: duas mensagens juntas dão 1 e 2, nunca duas "primeira".
      const [c] = linhas(
        await this.db.execute(sql`
          insert into pausa_aviso_cliente (tenant_id, pausa_id, pausado_em, chave)
          values (${tenantId}::uuid, ${idPausaDoCanal(tenantId, pausa.unidadeId, 'cardapio')}::uuid, ${pausa.pausadoEm}::timestamptz, ${chave})
          on conflict (pausa_id, pausado_em, chave) do update
            set mensagens = pausa_aviso_cliente.mensagens + 1, atualizado_em = clock_timestamp()
          returning id, mensagens, avisado_em, falado_em`),
      );
      if (Number(c?.mensagens) !== 1) {
        // F4 (mig 396): quem JÁ recebeu a mensagem pronta e insiste (ou não entendeu) recebe a resposta do robô em ÁUDIO —
        // a mesma voz do atendimento, uma vez por pausa, só no WhatsApp (Direct e Messenger não têm áudio do atendente).
        // A gravação condicional garante o "uma vez": duas mensagens juntas, um áudio.
        const whatsapp = !/^(ig|fb):/.test(chave);
        if (!whatsapp || cfg.audio === 'false' || !c?.avisado_em || c?.falado_em || !pedeOAudio(msg?.texto)) return 'segue';
        const [f] = linhas(
          await this.db.execute(sql`
            update pausa_aviso_cliente set falado_em = clock_timestamp() where id = ${c.id}::uuid and falado_em is null returning id`),
        );
        return f ? 'falar' : 'segue';
      }
      // Direct e Messenger não mostram o negrito do WhatsApp: vai sem os asteriscos.
      const texto = montarMensagemDaPausa(cfg.modelo, { nome: msg?.nome, frase: pausa.frase, volta: pausa.volta }, { semDestaque: /^(ig|fb):/.test(chave) });
      const r = await this.resposta.responderDoRegem({
        instancia: msg?.instancia ?? undefined,
        phoneNumberId: msg?.phoneNumberId ?? undefined,
        para: chave,
        texto,
      });
      if (!r?.enviado) {
        this.logger.log(`mensagem da pausa segurada (${(r as any)?.motivo ?? 'sem motivo'}): a mensagem vai ao robô`);
        return 'segue';
      }
      await this.db.execute(sql`update pausa_aviso_cliente set avisado_em = clock_timestamp() where id = ${c.id}::uuid`);
      return 'respondido';
    } catch (e: any) {
      // Banco sem a 395 (42P01) ou o envio que caiu: o robô responde (ele também sabe da pausa).
      this.logger.warn(`pausa no atendimento não decidida (${e?.code ?? e?.message ?? e}): a mensagem vai ao robô`);
      return 'segue';
    }
  }
}
