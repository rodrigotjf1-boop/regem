import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig } from '../../db/schema';
import { ehServidorLocal } from '../../common/modo';
import { chaveTelefone, formasDaChaveTelefone } from '../../common/telefone-chave';
import { estadoDaPausa } from '../whatsapp/robo-pausa';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { CardapioService } from './cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Há quanto tempo o carrinho está parado para receber o lembrete. */
export const PARADO_MIN = 30;
/** Carrinho parado há mais que isto não recebe lembrete (o cliente já desistiu; a conversa esfriou). */
export const ATE_HORAS = 3;

/** O lembrete (sem pressão, uma vez só): o cliente responde e o robô segue de onde parou. */
export function textoDoLembrete(nome: unknown, itens: number): string {
  const primeiro = String(nome ?? '').trim().split(/\s+/)[0];
  const quem = primeiro ? `, ${primeiro}` : '';
  const qtd = itens === 1 ? '1 item' : `${itens} itens`;
  return `Oi${quem}! Seu pedido ainda está aqui comigo 🛒 (${qtd}). Quer que eu finalize? É só responder por aqui.`;
}

type Candidato = { id: string; tenantId: string; telefone: string; nome: string | null; itens: number };

/**
 * O LEMBRETE DO PEDIDO QUE FICOU PELA METADE NO ROBÔ (Onda 0 do plano do atendimento, aprovado pelo dono; mig 349). Só
 * na NUVEM (o robô e o carrinho só existem lá).
 *
 * Quem recebe: o cliente da loja que LIGOU o lembrete (`robo_config.lembrete_carrinho`, nasce desligado) com o carrinho
 * do robô ABERTO, com itens, parado há mais de 30 min e menos de 3 h, com o robô e a loja ligados e a loja ABERTA AGORA
 * (a regra do cardápio online), a conversa sem atendente (pausa ou chamado aberto) e, na API oficial, a conversa parada
 * há mais de 30 min e dentro da janela de 24 h (o lembrete é texto livre; fora da janela a Meta não deixa).
 *
 * Uma vez só por carrinho: `lembrado_em` é gravado ANTES do envio (`update … where lembrado_em is null returning`) —
 * duas réplicas da API, ou duas voltas, nunca mandam duas vezes (V24, V42). Até 50 por volta, de 2 em 2 minutos.
 */
@Injectable()
export class LembreteDoCarrinhoProcessor {
  private readonly logger = new Logger('LembreteDoCarrinho');
  private rodando = false;
  static readonly POR_VOLTA = 50;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly cardapio: CardapioService,
    private readonly evolution: WhatsappService,
    private readonly cloud: WhatsappCloudService,
  ) {}

  @Interval(120_000)
  async processar(): Promise<number> {
    if (ehServidorLocal() || this.rodando) return 0;
    this.rodando = true;
    try {
      return await this.lembrar();
    } catch (e: any) {
      this.logger.warn(`lembrete do carrinho: a volta falhou — ${e?.message ?? e}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }

  /** Os carrinhos parados das lojas que ligaram o lembrete — uma consulta para todas as lojas (set-based). */
  async carrinhosParados(): Promise<Candidato[]> {
    const r: any = await this.db.execute(sql`
      select c.id, c.tenant_id, c.telefone, c.cliente_nome, jsonb_array_length(c.itens) as itens
        from robo_carrinho c
        join robo_config rc on rc.tenant_id = c.tenant_id and rc.lembrete_carrinho
       where c.status = 'aberto'
         and c.lembrado_em is null
         and jsonb_array_length(c.itens) > 0
         and c.atualizado_em < now() - make_interval(mins => ${PARADO_MIN})
         and c.atualizado_em > now() - make_interval(hours => ${ATE_HORAS})
       order by c.atualizado_em
       limit ${LembreteDoCarrinhoProcessor.POR_VOLTA}`);
    return (r?.rows ?? r ?? []).map((x: any) => ({
      id: String(x.id),
      tenantId: String(x.tenant_id),
      telefone: String(x.telefone),
      nome: x.cliente_nome ?? null,
      itens: Number(x.itens) || 0,
    }));
  }

  /** O ajuste do cardápio da loja (a linha da empresa, a mesma que o robô usa). */
  private async ajusteDaLoja(tenantId: string): Promise<any | null> {
    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(and(eq(cardapioConfig.tenantId, tenantId), sql`unidade_id is null`));
    return cfg ?? null;
  }

  /** Na API oficial: a conversa está parada há mais de 30 min E o cliente escreveu nas últimas 24 h (a janela)? */
  private async conversaParadaNaJanela(tenantId: string, telefone: string): Promise<boolean> {
    const formas = formasDaChaveTelefone(chaveTelefone(telefone));
    if (!formas.length) return false;
    const r: any = await this.db.execute(sql`
      select max(criado_em) as ultima,
             max(criado_em) filter (where direcao = 'entrada') as ultima_entrada
        from whatsapp_mensagem
       where tenant_id = ${tenantId}::uuid and telefone in (${sql.join(formas.map((f) => sql`${f}`), sql`, `)})`);
    const l = (r?.rows ?? r ?? [])[0];
    const agora = Date.now();
    const ultima = l?.ultima ? new Date(l.ultima).getTime() : 0;
    const entrada = l?.ultima_entrada ? new Date(l.ultima_entrada).getTime() : 0;
    return !!entrada && agora - entrada < 24 * 3600_000 && agora - ultima >= PARADO_MIN * 60_000;
  }

  /** Lembra os parados: confere a loja e a conversa, marca "já lembrei" primeiro e manda. Devolve quantos saíram. */
  async lembrar(): Promise<number> {
    const ajustes = new Map<string, any | null>();
    let n = 0;
    for (const c of await this.carrinhosParados()) {
      try {
        if (!ajustes.has(c.tenantId)) ajustes.set(c.tenantId, await this.ajusteDaLoja(c.tenantId));
        const cfg = ajustes.get(c.tenantId);
        if (!cfg || !cfg.ativo || !cfg.roboAtivo || !this.cardapio.lojaAbertaAgora(cfg)) continue;
        if ((await estadoDaPausa(this.db, c.tenantId, c.telefone)).pausado) continue;
        const oficial = cfg.provedor === 'cloud';
        if (oficial && !(await this.conversaParadaNaJanela(c.tenantId, c.telefone))) continue;
        const marcou: any = await this.db.execute(sql`
          update robo_carrinho set lembrado_em = now()
           where id = ${c.id}::uuid and lembrado_em is null and status = 'aberto'
          returning id`);
        if (!(marcou?.rows ?? marcou ?? []).length) continue; // outra volta já lembrou (ou o cliente fechou o pedido)
        const texto = textoDoLembrete(c.nome, c.itens);
        if (oficial) await this.cloud.enviarTexto(c.tenantId, c.telefone, texto);
        else await this.evolution.enviar(c.tenantId, c.telefone, texto);
        n++;
      } catch (e: any) {
        this.logger.warn(`lembrete do carrinho ${c.id}: não saiu — ${e?.message ?? e}`);
      }
    }
    if (n) this.logger.log(`lembrete do carrinho: ${n} cliente(s) lembrado(s)`);
    return n;
  }
}
