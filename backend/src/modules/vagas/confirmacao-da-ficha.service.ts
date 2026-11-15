import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { sqlChaveTelefone } from '../../common/telefone-chave';
import { estadoDaPausa } from '../whatsapp/robo-pausa';
import { sqlConversaNaJanela } from '../whatsapp/janela-da-conversa';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { textoDaConfirmacao } from './vagas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CONFIRMAÇÃO DA FICHA pelo WhatsApp (F3 parte b de `docs/plano-vagas-candidatos.md` §10; mig 427). Quem chega à ficha
// pelo link que o robô mandou (`?o=whatsapp`) e manda a ficha recebe na MESMA conversa: "Recebemos sua ficha nº …".
//  • Só na API oficial e só com a conversa aberta (a pessoa escreveu à loja nas últimas 24 h — fora disso, só modelo
//    aprovado da Meta). A regra da janela é a do "Chegou tudo certo?" (`sqlConversaNaJanela`, pelo índice).
//  • Uma vez por ficha: a vez é marcada ANTES de mandar (`enviando`, condicional — duas réplicas não mandam duas vezes) e
//    o resultado fica na ficha (`enviada`, `falhou`) e no histórico. Alguém da equipe na conversa = não manda.
//  • A ficha do robô que não achou a conversa em 10 minutos sai da fila como `sem_conversa` (uma consulta só).
//  • Só na nuvem. Nunca lança para a rotina: cada falha vira log.

@Injectable()
export class ConfirmacaoDaFichaService {
  private readonly log = new Logger('ConfirmacaoDaFicha');
  static readonly LOTE = 20;
  static readonly ESPERA_MIN = 10;
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly cloud: WhatsappCloudService,
  ) {}

  @Cron('30 * * * * *')
  async rotina(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      const r = await this.confirmar();
      if (r.enviadas || r.falhas) this.log.log(`Confirmação das fichas: ${r.enviadas} enviada(s), ${r.falhas} falha(s).`);
    } catch (e: any) {
      // Banco sem a 427 (a migration ainda não entrou): nada a fazer, sem barulho.
      const code = e?.code ?? e?.cause?.code;
      if (code === '42703' || code === '42P01') return;
      this.log.error(`Confirmação das fichas falhou: ${e?.message ?? e}`, e?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /** As fichas do robô esperando a confirmação, com a conversa aberta na API oficial (à parte para o teste). */
  static consulta(): SQL {
    return sql`
      with base as materialized (
        select c.id, c.tenant_id, c.protocolo, c.nome, ${sqlChaveTelefone(sql`c.telefone`)} as chave, c.recebido_em
          from candidato c
          join cardapio_config cc on cc.tenant_id = c.tenant_id and cc.unidade_id is null
                                 and cc.provedor = 'cloud' and coalesce(cc.wa_cloud_phone_id, '') <> ''
         where c.origem = 'whatsapp' and c.confirmacao is null
           and c.recebido_em > now() - make_interval(mins => ${ConfirmacaoDaFichaService.ESPERA_MIN})
      )
      select b.id, b.tenant_id, b.protocolo, b.nome, conversa.para
        from base b
        join ${sqlConversaNaJanela(sql`b.tenant_id`, sql`b.chave`)} conversa on true
       order by b.recebido_em, b.id
       limit ${ConfirmacaoDaFichaService.LOTE}`;
  }

  /** Uma volta: confirma o que dá e tira da fila o que esperou demais. Devolve quantas saíram e quantas falharam. */
  async confirmar(): Promise<{ enviadas: number; falhas: number }> {
    const r = await this.tratar(await this.candidatas());
    // A ficha do robô que não achou a conversa aberta no tempo: sai da fila (uma consulta só).
    await this.db.execute(sql`
      update candidato set confirmacao = 'sem_conversa', confirmacao_em = clock_timestamp()
       where origem = 'whatsapp' and confirmacao is null
         and recebido_em <= now() - make_interval(mins => ${ConfirmacaoDaFichaService.ESPERA_MIN})`);
    return r;
  }

  /** As fichas da volta (a lista pode ficar velha: outra réplica pode tratar a mesma ficha — a vez decide). */
  async candidatas(): Promise<any[]> {
    const r: any = await this.db.execute(ConfirmacaoDaFichaService.consulta());
    return (r?.rows ?? r ?? []) as any[];
  }

  /** Trata uma lista de fichas: a vez marcada antes de mandar faz cada ficha sair uma vez só, mesmo com a lista velha. */
  async tratar(lista: any[]): Promise<{ enviadas: number; falhas: number }> {
    let enviadas = 0;
    let falhas = 0;
    for (const c of lista) {
      const tenantId = String(c.tenant_id);
      const para = String(c.para);
      try {
        if ((await estadoDaPausa(this.db, tenantId, para)).pausado) {
          await this.marcar(c.id, 'equipe_na_conversa');
          continue;
        }
        const vez: any = await this.db.execute(sql`
          update candidato set confirmacao = 'enviando', confirmacao_em = clock_timestamp()
           where id = ${c.id}::uuid and confirmacao is null
          returning id`);
        if (!(vez?.rows ?? vez ?? [])[0]) continue; // outra volta (ou réplica) já pegou
        try {
          await this.cloud.enviarTexto(tenantId, para, textoDaConfirmacao(String(c.nome ?? ''), String(c.protocolo ?? '')));
          await this.db.transaction(async (tx: any) => {
            await tx.execute(sql`update candidato set confirmacao = 'enviada', confirmacao_em = clock_timestamp() where id = ${c.id}::uuid`);
            await tx.execute(sql`
              insert into candidato_evento (candidato_id, tenant_id, tipo, texto)
              values (${c.id}::uuid, ${tenantId}::uuid, 'comunicacao', 'Confirmação da ficha enviada pelo WhatsApp')`);
          });
          enviadas++;
        } catch (e: any) {
          falhas++;
          await this.marcar(c.id, 'falhou', true);
          this.log.warn(`a confirmação da ficha ${c.id} não saiu: ${String(e?.message ?? e).slice(0, 200)}`);
        }
      } catch (e: any) {
        this.log.warn(`a confirmação da ficha ${c.id}: ${e?.message ?? e}`);
      }
    }
    return { enviadas, falhas };
  }

  private async marcar(id: string, situacao: string, mesmoDepoisDaVez = false): Promise<void> {
    await this.db.execute(sql`
      update candidato set confirmacao = ${situacao}, confirmacao_em = clock_timestamp()
       where id = ${id}::uuid and ${mesmoDepoisDaVez ? sql`confirmacao = 'enviando'` : sql`confirmacao is null`}`);
  }
}
