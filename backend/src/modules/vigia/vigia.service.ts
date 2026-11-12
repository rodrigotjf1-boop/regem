import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { Achado, LIMITES_DO_VIGIA, LimitesDoVigia, REGRAS_DO_VIGIA, ServidorVigiado, acharProblemas, semSinal } from './vigia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O vigia nasce DESLIGADO: só roda com `VIGIA_LIGADO=1` (ou `true`) na nuvem. Lido a cada volta — desligar a variável e
 * reiniciar o serviço para tudo; a tabela fica como está (nenhuma outra parte do sistema a lê).
 */
export const vigiaLigado = (): boolean => ['1', 'true'].includes(String(process.env.VIGIA_LIGADO ?? '').trim().toLowerCase());

export type ResultadoDaVolta = {
  /** Servidores de loja olhados nesta volta (ativos, que já deram sinal). */
  servidores: number;
  /** Episódios que começaram agora. */
  abertos: number;
  /** Episódios que já estavam abertos e foram vistos de novo. */
  vistos: number;
  /** Episódios que fecharam porque o problema sumiu. */
  recuperados: number;
  /** Episódios que fecharam porque o servidor saiu da vigia (desativado, trocado). */
  encerrados: number;
  /** Servidores cuja linha não deu para avaliar (o motivo vai para o log; os outros seguem). */
  comErro: number;
};

type AchadoDoServidor = Achado & { tenantId: string; unidadeId: string | null; equipamentoId: string };

/**
 * O VIGIA DO SERVIDOR DA LOJA (F1.1 do plano do Mister, `docs/plano-mister.md`; mig 413). Só NUVEM. A cada volta:
 *  1. lê o último sinal de cada servidor de loja (`edge_status`, uma linha por servidor) — só o que as regras usam;
 *  2. aplica as regras puras (`vigia.regras.ts`);
 *  3. grava os episódios em `vigia_incidente`: o problema novo ABRE um episódio, o que continua soma `vezes`, o que sumiu
 *     FECHA como `recuperado`, e o servidor que saiu da vigia tem os episódios `encerrado`.
 * Nesta entrega NINGUÉM é avisado: a tabela só guarda. Os destinos são a entrega seguinte.
 *
 * • Uma consulta para todas as empresas e gravação em conjunto (nada de laço de N comandos): a volta custa o mesmo com
 *   uma loja ou com milhares.
 * • Quem garante "um episódio aberto por regra e alvo" é o índice único parcial da tabela, não a memória do processo: a
 *   volta repetida, a réplica a mais e o reinício caem no `on conflict` (V24).
 * • Servidor SEM SINAL: só a regra do sinal é avaliada; os outros episódios dele ficam como estavam (a saúde guardada é
 *   velha — nem confirmo, nem dou por resolvido). Quando ele volta, a volta seguinte decide com o dado novo.
 * • A credencial de integração (`integrador`, mig 290) também é um `servidor_local`, mas não é servidor de loja: fica
 *   fora (ERR-108), como no `edge-comando.ts`.
 */
@Injectable()
export class VigiaService {
  private readonly logger = new Logger('Vigia');

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private linhas(r: any): any[] {
    return (r?.rows ?? r ?? []) as any[];
  }

  /**
   * Uma volta. `soEmpresas`: só para o teste — a rotina passa por todas, e no CI as specs dividem o banco (o servidor de
   * outra spec não pode ganhar nem perder episódio daqui — V32). `agora` e `limites`: o teste escolhe a hora e os limites.
   */
  async volta(soEmpresas?: string[], agora: Date = new Date(), limites: LimitesDoVigia = LIMITES_DO_VIGIA): Promise<ResultadoDaVolta> {
    const lista = (col: any) => (soEmpresas?.length ? sql`and ${col} in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``);
    const regras = sql.join(REGRAS_DO_VIGIA.map((r) => sql`${r}`), sql`, `);

    // 1. O último sinal de cada servidor de loja, só com os campos da saúde que as regras leem (a saúde inteira tem a
    //    rede, os PCs conectados e as estações — não precisam trafegar a cada minuto).
    const servidores = this.linhas(
      await this.db.execute(sql`
        select es.equipamento_id as "equipamentoId", es.tenant_id as "tenantId", coalesce(es.unidade_id, e.unidade_id) as "unidadeId",
               es.recebido_em as "recebidoEm", es.disco_livre_mb as "discoLivreMb",
               case when es.saude is null or jsonb_typeof(es.saude) <> 'object' then null else jsonb_build_object(
                 'servicos', es.saude -> 'servicos',
                 'restaurando', es.saude -> 'restaurando',
                 'backup', es.saude -> 'backup',
                 'bancoFalhasChecksum', es.saude -> 'bancoFalhasChecksum',
                 'bancoPctTransacoes', es.saude -> 'bancoPctTransacoes',
                 'relogioDesvioS', es.saude -> 'relogioDesvioS',
                 'syncFalhandoDesde', es.saude -> 'syncFalhandoDesde',
                 'impressorasSemResponder', es.saude -> 'impressorasSemResponder',
                 'impressorasComAviso', es.saude -> 'impressorasComAviso') end as saude
          from edge_status es
          join equipamento e on e.id = es.equipamento_id and e.tenant_id = es.tenant_id
         where e.tipo = 'servidor_local' and e.ativo and e.integrador is null
           ${lista(sql`es.tenant_id`)}`),
    ) as ServidorVigiado[];

    // 2. As regras. Um servidor com a linha torta não derruba a volta dos outros.
    const porChave = new Map<string, AchadoDoServidor>();
    const comSinal: string[] = [];
    let comErro = 0;
    for (const s of servidores) {
      try {
        if (!semSinal(s, agora, limites)) comSinal.push(s.equipamentoId);
        for (const a of acharProblemas(s, agora, limites))
          porChave.set(`${s.tenantId}|${a.regra}|${a.chave}`, { ...a, tenantId: s.tenantId, unidadeId: s.unidadeId ?? null, equipamentoId: s.equipamentoId });
      } catch (e: any) {
        comErro++;
        if (comErro === 1) this.logger.warn(`servidor ${s?.equipamentoId}: não deu para avaliar a saúde — ${e?.message ?? e}`);
      }
    }
    const achados = [...porChave.values()];

    // 3a. Abre o episódio novo e soma no que continua — um comando para todos (a lista vai como UM parâmetro, V31).
    let abertos = 0;
    let vistos = 0;
    if (achados.length) {
      const gravados = this.linhas(
        await this.db.execute(sql`
          insert into vigia_incidente (tenant_id, unidade_id, equipamento_id, regra, chave, gravidade, publico, evidencia)
          select a."tenantId", a."unidadeId", a."equipamentoId", a.regra, a.chave, a.gravidade, a.publico, coalesce(a.evidencia, '{}'::jsonb)
            from jsonb_to_recordset(${JSON.stringify(achados)}::jsonb)
                 as a("tenantId" uuid, "unidadeId" uuid, "equipamentoId" uuid, regra text, chave text, gravidade text, publico text, evidencia jsonb)
          on conflict (tenant_id, regra, chave) where situacao = 'aberto'
          do update set ultima_em = clock_timestamp(), vezes = vigia_incidente.vezes + 1,
                        evidencia = excluded.evidencia, gravidade = excluded.gravidade
          returning (xmax = 0) as novo`),
      );
      abertos = gravados.filter((g) => g.novo === true).length;
      vistos = gravados.length - abertos;
    }

    // 3b. Fecha o que sumiu — só dos servidores COM SINAL nesta volta (o sem sinal não diz nada sobre os outros problemas).
    let recuperados = 0;
    if (comSinal.length) {
      const chaves = achados.map((a) => ({ tenantId: a.tenantId, regra: a.regra, chave: a.chave }));
      recuperados = this.linhas(
        await this.db.execute(sql`
          update vigia_incidente i
             set situacao = 'recuperado', fechado_em = clock_timestamp()
           where i.situacao = 'aberto' and i.regra in (${regras})
             and i.equipamento_id in (select x::uuid from jsonb_array_elements_text(${JSON.stringify(comSinal)}::jsonb) as t(x))
             and not exists (
               select 1 from jsonb_to_recordset(${JSON.stringify(chaves)}::jsonb) as a("tenantId" uuid, regra text, chave text)
                where a."tenantId" = i.tenant_id and a.regra = i.regra and a.chave = i.chave)
             ${lista(sql`i.tenant_id`)}
          returning i.id`),
      ).length;
    }

    // 3c. O servidor que saiu da vigia (desativado, apagado, virou credencial de integração): os episódios dele não vão
    //     recuperar nunca — ficam `encerrado`, para não sobrar "aberto" eterno.
    const encerrados = this.linhas(
      await this.db.execute(sql`
        update vigia_incidente i
           set situacao = 'encerrado', fechado_em = clock_timestamp()
         where i.situacao = 'aberto' and i.regra in (${regras}) and i.equipamento_id is not null
           and not exists (
             select 1 from equipamento e
              where e.id = i.equipamento_id and e.tenant_id = i.tenant_id
                and e.tipo = 'servidor_local' and e.ativo and e.integrador is null)
           ${lista(sql`i.tenant_id`)}
        returning i.id`),
    ).length;

    const r = { servidores: servidores.length, abertos, vistos, recuperados, encerrados, comErro };
    if (abertos || recuperados || encerrados)
      this.logger.log(`vigia: ${abertos} episódio(s) aberto(s), ${recuperados} recuperado(s), ${encerrados} encerrado(s) em ${servidores.length} servidor(es)`);
    return r;
  }
}
