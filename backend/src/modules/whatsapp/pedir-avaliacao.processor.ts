import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { hojeISO } from '../../common/data';
import { sqlChaveTelefone } from '../../common/telefone-chave';
import { saiuDoMarketing } from '../../common/marketing-quem-recebe';
import { estadoDaPausa } from './robo-pausa';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { sqlConversaNaJanela } from './janela-da-conversa';
import { ATE_HORAS, CANAIS_DA_PLATAFORMA, ajustesDaLinha, linkDeAvaliacaoValido, textoDaAvaliacao } from './pedir-avaliacao';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PUB = () => (process.env.PUBLIC_API_BASE || 'https://api.dmsregem.com/api/v1').replace(/\/+$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MotivoDeNaoEnviar = 'teve_problema' | 'antes_do_pedido_minimo' | 'ja_tocou_no_link' | 'pedido_recente' | 'saiu_das_mensagens';

type Candidato = {
  id: string;
  tenantId: string;
  unidadeId: string | null;
  clienteId: string | null;
  nome: string | null;
  /** A chave do telefone do pedido (`chaveTelefone`) — quem é o cliente para as regras. */
  chave: string;
  /** O número da conversa aberta (o cliente escreveu nas últimas 24 h), como a Meta o manda. */
  para: string;
  ajustes: ReturnType<typeof ajustesDaLinha>;
  /** Os pedidos do cliente no cadastro (`cliente.total_pedidos` — a mesma conta do "Sentimos sua falta"), no mínimo 1. */
  pedidosDoCliente: number;
  /** Teve problema: atrasou (a conta do aviso de atraso), recebeu o aviso de atraso, caso de problema/cancelamento, ou
   *  "Tive um problema"/"Não chegou" no "Chegou tudo certo?". */
  teveProblema: boolean;
  /** O cliente já tocou num link de avaliação desta empresa. */
  jaTocou: boolean;
  /** Há quantos dias o cliente recebeu o último pedido de avaliação desta empresa (null: nunca). */
  diasDesdeOUltimo: number | null;
};

/**
 * A ROTINA DO "PEDIR AVALIAÇÃO" (mig 365). Só na NUVEM (o WhatsApp só existe lá). Quem recebe: o cliente de um pedido de
 * ENTREGA dos canais da própria loja (nunca iFood nem 99 — a avaliação é pedida pela plataforma), concluído há N minutos a
 * 12 h, da loja que LIGOU e colou o link e usa a API OFICIAL, com a conversa aberta (o cliente escreveu nas últimas 24 h)
 * e sem atendente nela. As regras da loja ("só sem problema", "a partir do Nº pedido", "de novo depois de N dias só a
 * quem não tocou no link") decidem; a decisão de NÃO mandar também fica registrada (com o motivo — uma vez por pedido).
 *
 * Tudo o que decide vem numa consulta só para todas as lojas (set-based): a conversa aberta já filtrada nela (ERR-360 — o
 * pedido de quem não escreveu nem entra, e não toma a vez dos outros), a chave do telefone calculada uma vez por pedido e
 * a memória do cliente pelo índice (LIC-113). Por pedido sobram a lista de quem saiu das mensagens (a MESMA das campanhas)
 * e a equipe na conversa (pulada sem marcar; volta na volta seguinte).
 *
 * O envio é gravado ANTES de mandar (`insert … on conflict do nothing returning`): duas réplicas nunca mandam duas vezes
 * o mesmo pedido, e o índice "um por cliente por dia" impede dois pedidos de avaliação ao mesmo cliente no mesmo dia (dois
 * pedidos dele na mesma volta, ou duas réplicas cada uma com um). Até 50 envios por volta, de 2 em 2 minutos.
 */
@Injectable()
export class PedirAvaliacaoProcessor {
  private readonly logger = new Logger('PedirAvaliacao');
  private rodando = false;
  static readonly POR_VOLTA = 50;
  static readonly LISTA = 200;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly cloud: WhatsappCloudService,
  ) {}

  @Interval(120_000)
  async processar(): Promise<number> {
    if (ehServidorLocal() || this.rodando) return 0;
    this.rodando = true;
    try {
      return await this.pedir();
    } catch (e: any) {
      this.logger.warn(`pedir avaliação: a volta falhou — ${e?.message ?? e}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }

  /** Os pedidos que podem receber o pedido de avaliação AGORA — uma consulta para todas as lojas (set-based). */
  async candidatos(): Promise<Candidato[]> {
    const r: any = await this.db.execute(PedirAvaliacaoProcessor.consulta());
    return (r?.rows ?? r ?? []).map((x: any) => ({
      id: String(x.id),
      tenantId: String(x.tenant_id),
      unidadeId: x.unidade_id ?? null,
      clienteId: x.cliente_id ?? null,
      nome: x.cliente_nome ?? null,
      chave: String(x.chave),
      para: String(x.para),
      ajustes: ajustesDaLinha(x),
      pedidosDoCliente: Number(x.pedidos_do_cliente ?? 0),
      teveProblema: !!(x.atrasou || x.avisou_atraso || x.teve_caso || x.reclamou),
      jaTocou: x.ja_tocou === true,
      diasDesdeOUltimo: x.dias_desde_o_ultimo == null ? null : Number(x.dias_desde_o_ultimo),
    }));
  }

  /** A consulta dos candidatos (à parte para o teste conferir o plano — a conversa e a memória do cliente pelo índice). */
  static consulta(): SQL {
    return sql`
      with base as materialized (
        select p.id, p.tenant_id, p.unidade_id, p.cliente_id, p.cliente_nome, p.criado_em, p.concluido_em, p.agendamento,
               ${sqlChaveTelefone(sql`p.cliente_telefone`)} as chave,
               rc.avaliacao_ativa, rc.avaliacao_link, rc.avaliacao_texto, rc.avaliacao_depois_min, rc.avaliacao_so_sem_problema,
               rc.avaliacao_a_partir_do, rc.avaliacao_de_novo_dias, rc.aviso_atraso_tolerancia_min
          from pedido_externo p
          join robo_config rc on rc.tenant_id = p.tenant_id and rc.avaliacao_ativa and coalesce(rc.avaliacao_link, '') <> ''
          join cardapio_config cc on cc.tenant_id = p.tenant_id and cc.unidade_id is null
                                 and cc.provedor = 'cloud' and coalesce(cc.wa_cloud_phone_id, '') <> ''
         where p.status = 'concluido' and p.tipo = 'entrega'
           and p.canal not in (${sql.join(CANAIS_DA_PLATAFORMA.map((c) => sql`${c}`), sql`, `)})
           and coalesce(trim(p.cliente_telefone), '') <> ''
           and p.concluido_em < now() - make_interval(mins => rc.avaliacao_depois_min)
           and p.concluido_em > now() - make_interval(hours => ${ATE_HORAS})
           and not exists (select 1 from avaliacao_pedida a where a.pedido_id = p.id)
      )
      select b.id, b.tenant_id, b.unidade_id, b.cliente_id, b.cliente_nome, b.chave, conversa.para,
             b.avaliacao_ativa, b.avaliacao_link, b.avaliacao_texto, b.avaliacao_depois_min, b.avaliacao_so_sem_problema,
             b.avaliacao_a_partir_do, b.avaliacao_de_novo_dias,
             -- Este pedido já conta: no mínimo 1 (pedido sem cadastro ligado = o 1º — "1º pedido" é para todos).
             greatest(coalesce((select cl.total_pedidos from cliente cl where cl.id = b.cliente_id and cl.tenant_id = b.tenant_id), 0), 1)
               as pedidos_do_cliente,
             -- O MESMO "atrasou" do aviso de atraso (V74): o tempo prometido da loja mais a tolerância, contados da entrada.
             (b.agendamento is null and coalesce(cfg.prometido, 0) > 0
                and b.concluido_em > b.criado_em + make_interval(mins => cfg.prometido + coalesce(b.aviso_atraso_tolerancia_min, 0))
             ) as atrasou,
             exists (select 1 from pedido_aviso_atraso x where x.pedido_id = b.id) as avisou_atraso,
             exists (select 1 from atendimento_chamado c
                      where c.pedido_id = b.id and c.tenant_id = b.tenant_id and c.tipo in ('erro', 'cancelamento')) as teve_caso,
             exists (select 1 from pedido_envio e
                      where e.pedido_id = b.id and e.acao = 'conferir_entrega_resposta' and e.motivo in ('problema', 'nao_chegou')) as reclamou,
             exists (select 1 from avaliacao_pedida a
                      where a.tenant_id = b.tenant_id and a.chave_telefone = b.chave and a.tocou_em is not null) as ja_tocou,
             (select extract(epoch from now() - max(a.criado_em)) / 86400 from avaliacao_pedida a
               where a.tenant_id = b.tenant_id and a.chave_telefone = b.chave and a.resultado = 'enviado') as dias_desde_o_ultimo
        from base b
        join ${sqlConversaNaJanela(sql`b.tenant_id`, sql`b.chave`)} conversa on true
        join lateral (
          select c.tempo_entrega_min as prometido
            from cardapio_config c
           where c.tenant_id = b.tenant_id
           order by (c.unidade_id is not distinct from b.unidade_id) desc, (c.unidade_id is null) desc
           limit 1
        ) cfg on true
       order by b.concluido_em, b.id
       limit ${PedirAvaliacaoProcessor.LISTA}`;
  }

  /** Por que NÃO mandar a este candidato (as regras da loja), ou null — manda. A ordem é a da tela. */
  static motivoDeNaoEnviar(c: Candidato): MotivoDeNaoEnviar | null {
    const a = c.ajustes;
    if (a.soSemProblema && c.teveProblema) return 'teve_problema';
    if (c.pedidosDoCliente < a.aPartirDo) return 'antes_do_pedido_minimo';
    if (c.jaTocou) return 'ja_tocou_no_link';
    if (c.diasDesdeOUltimo != null && c.diasDesdeOUltimo < a.deNovoDias) return 'pedido_recente';
    return null;
  }

  /** Grava "decidi não mandar" (uma vez por pedido; o pedido já decidido fica como está). */
  private async naoEnviar(c: Candidato, motivo: MotivoDeNaoEnviar): Promise<void> {
    await this.db.execute(sql`
      insert into avaliacao_pedida (tenant_id, unidade_id, pedido_id, chave_telefone, resultado, motivo, dia)
      values (${c.tenantId}::uuid, ${c.unidadeId}, ${c.id}::uuid, ${c.chave}, 'nao_enviado', ${motivo}, ${hojeISO()}::date)
      on conflict do nothing`);
  }

  /**
   * Grava "vou mandar" ANTES de mandar. null: não grava — o pedido já foi decidido (outra volta ou réplica) ou o cliente
   * já tem um pedido de avaliação HOJE (o índice "um por cliente por dia"); nesse caso o pedido fica "pedido_recente".
   */
  private async marcarEnvio(c: Candidato, link: string): Promise<string | null> {
    const r: any = await this.db.execute(sql`
      insert into avaliacao_pedida (tenant_id, unidade_id, pedido_id, chave_telefone, resultado, link, dia)
      values (${c.tenantId}::uuid, ${c.unidadeId}, ${c.id}::uuid, ${c.chave}, 'enviado', ${link}, ${hojeISO()}::date)
      on conflict do nothing
      returning id`);
    const id = (r?.rows ?? r ?? [])[0]?.id ?? null;
    if (!id) await this.naoEnviar(c, 'pedido_recente'); // o pedido já decidido não muda (on conflict do nothing)
    return id;
  }

  /** Decide e manda: as regras da loja, a lista de quem saiu e a conversa sem atendente. Devolve quantas saíram. */
  async pedir(): Promise<number> {
    let n = 0;
    const jaPediuNestaVolta = new Set<string>(); // dois pedidos do mesmo cliente na mesma volta: só o primeiro
    for (const c of await this.candidatos()) {
      if (n >= PedirAvaliacaoProcessor.POR_VOLTA) break; // o resto fica para a volta seguinte
      try {
        const link = linkDeAvaliacaoValido(c.ajustes.link);
        if (!link) continue; // link guardado fora da regra (não acontece pela tela): nada sai
        const chaveDaVolta = `${c.tenantId}|${c.chave}`;
        const motivo = jaPediuNestaVolta.has(chaveDaVolta) ? 'pedido_recente' : PedirAvaliacaoProcessor.motivoDeNaoEnviar(c);
        if (motivo) {
          await this.naoEnviar(c, motivo);
          continue;
        }
        // Quem pediu para não receber mensagens (SAIR, o Perfil do cardápio, a marca do cadastro): a MESMA regra das
        // campanhas e das automáticas.
        if (await saiuDoMarketing(this.db, c.tenantId, c.para, c.clienteId)) {
          await this.naoEnviar(c, 'saiu_das_mensagens');
          continue;
        }
        if ((await estadoDaPausa(this.db, c.tenantId, c.para)).pausado) continue; // alguém da equipe está na conversa
        const id = await this.marcarEnvio(c, link);
        if (!id) continue;
        jaPediuNestaVolta.add(chaveDaVolta);
        try {
          await this.cloud.enviarTexto(c.tenantId, c.para, textoDaAvaliacao(c.ajustes.texto, c.nome, `${PUB()}/publico/avaliacao/${id}`));
          n++;
        } catch (e: any) {
          const motivoDaFalha = String(e?.message ?? e).slice(0, 300);
          await this.db.execute(sql`update avaliacao_pedida set resultado = 'falhou', motivo = ${motivoDaFalha} where id = ${id}::uuid`);
          this.logger.warn(`pedir avaliação do pedido ${c.id} não saiu: ${motivoDaFalha}`);
        }
      } catch (e: any) {
        this.logger.warn(`pedir avaliação do pedido ${c.id}: ${e?.message ?? e}`);
      }
    }
    return n;
  }

  /**
   * O TOQUE NO LINK (`/publico/avaliacao/:id`): anota "tocou" (só o primeiro toque grava) e devolve o link de avaliação
   * ATUAL da loja — conferido de novo, só Google —, ou o que foi na mensagem, se a loja tirou o link. Id que não é de um
   * pedido de avaliação enviado: null.
   */
  async destinoDoToque(id: string): Promise<string | null> {
    if (!UUID.test(String(id ?? ''))) return null;
    const r: any = await this.db.execute(sql`
      with alvo as (
        select a.id, a.tenant_id, a.link, a.tocou_em from avaliacao_pedida a where a.id = ${id}::uuid and a.resultado = 'enviado'
      ), tocou as (
        update avaliacao_pedida a set tocou_em = now() from alvo where a.id = alvo.id and alvo.tocou_em is null returning a.id
      )
      select alvo.link as enviado, rc.avaliacao_link as atual, (select count(*) from tocou)::int as gravou
        from alvo left join robo_config rc on rc.tenant_id = alvo.tenant_id`);
    const l = (r?.rows ?? r ?? [])[0];
    if (!l) return null;
    return linkDeAvaliacaoValido(l.atual) ?? linkDeAvaliacaoValido(l.enviado);
  }
}
