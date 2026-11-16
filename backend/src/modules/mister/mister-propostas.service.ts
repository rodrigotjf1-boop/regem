import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { horaNoFuso } from '../../common/data';
import { enfileirarComandoEdge } from '../../common/edge-comando';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import {
  PREFIXO_DO_BOTAO,
  PROCEDIMENTOS,
  ProcedimentoDoMister,
  TEXTOS_DA_PROPOSTA,
  botoesDaProposta,
  lerBotao,
  perguntaDaProposta,
  propostaDoAviso,
  resultadoDaConsulta,
  textoDoDesfecho,
} from './mister-procedimentos';

/* eslint-disable @typescript-eslint/no-explicit-any */

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';

/** A proposta pendente de um aviso, pronta para ir com ele: a pergunta e os botões. */
export interface PropostaPendente {
  id: string;
  procedimento: ProcedimentoDoMister;
  pergunta: string;
  botoes: { id: string; titulo: string }[];
}

/**
 * AS PROPOSTAS DO MISTER (F4.1, mig 428). Nasce com o aviso que um procedimento do catálogo resolve; vai ao presidente com
 * "Autorizar" e "Não agora"; o toque autoriza UMA vez dentro do prazo (gravação condicional); a execução passa pelo serviço
 * da tela; a conferência diz "feito" só com o efeito visto. Tudo da nuvem.
 */
@Injectable()
export class MisterPropostasService implements OnModuleInit {
  private readonly logger = new Logger('MisterPropostas');
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly numero: MisterNumeroService,
    @Optional() private readonly entrada?: MisterEntradaService,
    // O tipo é a classe (o Nest injeta pelo tipo refletido; um `Pick` viraria `Object` e nada seria injetado).
    @Optional() private readonly fiscal?: FiscalService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** O toque num botão de proposta chega pela entrada do WhatsApp, que mora no módulo de baixo. */
  onModuleInit(): void {
    this.entrada?.registrarBotao(PREFIXO_DO_BOTAO, (botaoId, quem) => this.responder(botaoId, quem));
  }

  // ───────────────────────────── propor ─────────────────────────────

  /**
   * A proposta de um aviso aberto, se um procedimento do catálogo o resolve. Uma por aviso e procedimento (índice único):
   * a volta repetida devolve a mesma. A que VENCEU sem resposta renova quando o aviso vai de novo a quem autoriza (o
   * toque no modelo horas depois, a escalada) — a respondida nunca renova. Só devolve a que espera resposta.
   */
  async propor(a: { id: string; tenantId: string; unidadeId: string | null; tipo: string; chave: string }): Promise<PropostaPendente | null> {
    const p = propostaDoAviso(a);
    if (!p) return null;
    const proc = PROCEDIMENTOS[p.procedimento];
    try {
      await this.db.execute(sql`
        insert into mister_proposta (tenant_id, unidade_id, aviso_id, procedimento, parametros, nivel, vence_em)
        values (${a.tenantId}::uuid, ${a.unidadeId}::uuid, ${a.id}::uuid, ${p.procedimento}, ${JSON.stringify(p.parametros)}::jsonb, ${proc.nivel},
                clock_timestamp() + make_interval(mins => ${proc.prazoMin}::int))
        on conflict (aviso_id, procedimento) do update
          set situacao = 'proposta', vence_em = excluded.vence_em, concluida_em = null, resultado = null
          where mister_proposta.situacao = 'vencida' or (mister_proposta.situacao = 'proposta' and mister_proposta.vence_em <= now())`);
      return await this.pendenteDoAviso(a.id);
    } catch (e: any) {
      if (!semTabela(e)) this.logger.warn(`a proposta do aviso ${a.id} não foi criada — ${e?.message ?? e}`);
      return null;
    }
  }

  /** A proposta do aviso que ainda espera resposta (no prazo); null quando não há. */
  async pendenteDoAviso(avisoId: string): Promise<PropostaPendente | null> {
    const [p] = linhas(
      await this.db.execute(sql`
        select id::text as id, procedimento from mister_proposta
         where aviso_id = ${avisoId}::uuid and situacao = 'proposta' and vence_em > now() and nivel = 'botao'
         order by criada_em limit 1`),
    );
    if (!p || !(p.procedimento in PROCEDIMENTOS)) return null;
    return { id: p.id, procedimento: p.procedimento, pergunta: perguntaDaProposta(p.procedimento), botoes: botoesDaProposta(p.id) };
  }

  // ───────────────────────────── a resposta ─────────────────────────────

  /**
   * O toque em "Autorizar" ou "Não agora". Devolve false só quando a proposta não é de nenhuma empresa deste telefone (a
   * entrada responde "não achei"). Gerente não autoriza (até o perfil de permissões); vencida e já respondida têm a frase.
   */
  async responder(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const b = lerBotao(botaoId);
    const empresas = quem.vinculos.map((v) => v.tenantId);
    if (!b || !empresas.length) return false;
    const [p] = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", procedimento, situacao, vence_em as "venceEm"
          from mister_proposta
         where id = ${b.propostaId}::uuid and tenant_id in (${sql.join(empresas.map((t) => sql`${t}::uuid`), sql`, `)})`),
    );
    if (!p) return false;
    const v = quem.vinculos.find((x) => x.tenantId === p.tenantId)!;
    if (v.nivel !== 'presidente') {
      await this.falar(quem.telefone, TEXTOS_DA_PROPOSTA.soPresidente);
      return true;
    }
    const final = quem.telefone.slice(-4);
    // A gravação condicional: só a proposta ainda pendente e no prazo muda (o segundo toque e o de outro aparelho não).
    const [mudou] = linhas(
      await this.db.execute(sql`
        update mister_proposta
           set situacao = ${b.autorizar ? 'autorizada' : 'recusada'}, respondida_em = now(), autorizada_por = ${v.colaboradorId}::uuid,
               telefone_final = ${final}, concluida_em = case when ${b.autorizar} then null else now() end,
               resultado = case when ${b.autorizar} then null else 'recusada pelo presidente' end
         where id = ${p.id}::uuid and situacao = 'proposta' and vence_em > now()
        returning id`),
    );
    if (!mudou) {
      const vencida = p.situacao === 'vencida' || (p.situacao === 'proposta' && new Date(p.venceEm).getTime() <= Date.now());
      await this.falar(quem.telefone, vencida ? TEXTOS_DA_PROPOSTA.vencida(horaNoFuso(new Date(p.venceEm))) : TEXTOS_DA_PROPOSTA.jaRespondida);
      return true;
    }
    await this.auditar(p.tenantId, v.colaboradorId, b.autorizar ? 'mister_proposta_autorizada' : 'mister_proposta_recusada', p.id, { procedimento: p.procedimento, final });
    await this.falar(quem.telefone, b.autorizar ? TEXTOS_DA_PROPOSTA.autorizada(p.procedimento) : TEXTOS_DA_PROPOSTA.recusada);
    // A execução não segura a resposta ao WhatsApp: segue sozinha (e a rotina pega a que ficar para trás).
    if (b.autorizar) void this.executar(p.id).catch((e) => this.logger.error(`a proposta ${p.id} não executou — ${e?.message ?? e}`));
    return true;
  }

  // ───────────────────────────── executar e conferir ─────────────────────────────

  /**
   * Executa a proposta autorizada pelo serviço da tela. Uma vez só: a passagem de "autorizada" para "executando" é
   * condicional (a resposta e a rotina podem chegar juntas). A consulta da nota confere na hora; a via de teste confere
   * depois, na rotina. Devolve a situação em que a proposta ficou (ou null se outra execução já a pegou).
   */
  async executar(id: string): Promise<string | null> {
    const [p] = linhas(
      await this.db.execute(sql`
        update mister_proposta p
           set situacao = 'executando', executada_em = now(),
               conferir_ate = now() + make_interval(mins => case p.procedimento when 'imprimir_teste' then ${PROCEDIMENTOS.imprimir_teste.conferirMin}::int else ${PROCEDIMENTOS.consultar_nota.conferirMin}::int end)
         where id = ${id}::uuid and situacao = 'autorizada'
        returning id::text as id, tenant_id::text as "tenantId", unidade_id::text as "unidadeId", procedimento, parametros,
                  autorizada_por::text as "autorizadaPor"`),
    );
    if (!p) return null;
    await this.auditar(p.tenantId, p.autorizadaPor, 'mister_proposta_executada', p.id, { procedimento: p.procedimento });
    if (p.procedimento === 'consultar_nota') {
      if (!this.fiscal) return this.concluir(p, false, 'a consulta à SEFAZ não está disponível agora. Consulte pelo Regem.');
      try {
        const r: any = await this.fiscal.consultarNota(p.tenantId, String(p.parametros?.notaId ?? ''), p.autorizadaPor);
        const res = resultadoDaConsulta(r ?? {});
        return this.concluir(p, res.feita, res.texto);
      } catch (e: any) {
        // As recusas da consulta (a espera da SEFAZ entre consultas da mesma nota, nota sem chave, SEFAZ fora do ar) vêm
        // com a frase pronta para a pessoa.
        const motivo = String(e?.response?.message ?? e?.message ?? 'a consulta falhou').slice(0, 300);
        return this.concluir(p, false, motivo.charAt(0).toLowerCase() + motivo.slice(1));
      }
    }
    if (p.procedimento === 'imprimir_teste') {
      // O "Imprimir teste" da tela com a loja que tem servidor: o comando vai para o servidor da loja da impressora.
      await enfileirarComandoEdge(this.db, p.tenantId, 'testar_impressora', {
        unidadeId: p.unidadeId,
        solicitadoPor: 'mister',
        dados: { equipamentoId: String(p.parametros?.impressoraId ?? ''), propostaId: p.id },
      });
      return 'executando';
    }
    return this.concluir(p, false, 'esse procedimento não existe mais.');
  }

  /**
   * A conferência da via de teste: feita quando o servidor da loja pegou o pedido E o aviso da impressora fechou (ela
   * voltou a responder). Passado o prazo, "não deu" com o que faltou. Devolve quantas concluiu.
   */
  async conferir(): Promise<number> {
    const abertas = linhas(
      await this.db.execute(sql`
        select p.id::text as id, p.tenant_id::text as "tenantId", p.procedimento, p.autorizada_por::text as "autorizadaPor",
               p.conferir_ate as "conferirAte", a.situacao as aviso,
               exists (select 1 from edge_comando c
                        where c.tenant_id = p.tenant_id and c.comando = 'testar_impressora' and c.status = 'executado'
                          and c.dados ->> 'propostaId' = p.id::text) as executado
          from mister_proposta p
          left join mister_aviso a on a.id = p.aviso_id
         where p.situacao = 'executando' and p.procedimento = 'imprimir_teste'`),
    );
    let n = 0;
    for (const p of abertas) {
      if (p.executado && p.aviso === 'resolvido') {
        if (await this.concluir(p, true, 'A impressora recebeu a via de teste e voltou a responder.')) n++;
      } else if (new Date(p.conferirAte).getTime() <= Date.now()) {
        const motivo = p.executado
          ? 'o servidor da loja mandou a via de teste, mas a impressora ainda não responde. Confira se ela está ligada, com papel e no cabo ou na rede.'
          : 'o servidor da loja não pegou o pedido. Confira se o computador do servidor está ligado e com internet.';
        if (await this.concluir(p, false, motivo)) n++;
      }
    }
    return n;
  }

  /**
   * Fecha a proposta que está executando (condicional: uma vez só) e avisa quem autorizou. Devolve a situação final, ou
   * null quando outra volta já fechou.
   */
  private async concluir(p: { id: string; tenantId: string; autorizadaPor: string | null }, feita: boolean, resultado: string): Promise<string | null> {
    const situacao = feita ? 'feita' : 'nao_deu';
    const [fechou] = linhas(
      await this.db.execute(sql`
        update mister_proposta set situacao = ${situacao}, resultado = ${resultado.slice(0, 400)}, concluida_em = now()
         where id = ${p.id}::uuid and situacao = 'executando'
        returning concluida_em as "concluidaEm"`),
    );
    if (!fechou) return null;
    await this.auditar(p.tenantId, p.autorizadaPor, feita ? 'mister_proposta_feita' : 'mister_proposta_nao_deu', p.id, { resultado: resultado.slice(0, 200) });
    const [quem] = p.autorizadaPor
      ? linhas(
          await this.db.execute(sql`
            select telefone from mister_vinculo
             where tenant_id = ${p.tenantId}::uuid and colaborador_id = ${p.autorizadaPor}::uuid and ligado_em is not null and telefone is not null`),
        )
      : [];
    if (quem?.telefone) await this.falar(quem.telefone, textoDoDesfecho(feita, resultado, horaNoFuso(new Date(fechou.concluidaEm))));
    return situacao;
  }

  /** As propostas sem resposta no prazo vencem. Devolve quantas. */
  async vencer(): Promise<number> {
    return linhas(
      await this.db.execute(sql`
        update mister_proposta set situacao = 'vencida', concluida_em = now(), resultado = 'ninguém respondeu no prazo'
         where situacao = 'proposta' and vence_em <= now()
        returning id`),
    ).length;
  }

  /**
   * A rotina: vence as sem resposta, executa as autorizadas que ficaram para trás (a execução logo depois do toque é o
   * caminho de sempre) e confere as que esperam o efeito. Só na nuvem.
   */
  @Cron('*/30 * * * * *')
  async rotina(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      await this.vencer();
      const paraTras = linhas(
        await this.db.execute(sql`
          select id::text as id from mister_proposta where situacao = 'autorizada' and respondida_em < now() - interval '20 seconds'
           order by respondida_em limit 20`),
      );
      for (const p of paraTras) await this.executar(p.id).catch((e) => this.logger.warn(`a proposta ${p.id} não executou — ${e?.message ?? e}`));
      await this.conferir();
    } catch (e: any) {
      if (!semTabela(e)) this.logger.warn(`a rotina das propostas falhou — ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }

  // ───────────────────────────── apoio ─────────────────────────────

  private async falar(telefone: string, texto: string): Promise<void> {
    try {
      await this.numero.enviar(telefone, { texto });
    } catch (e: any) {
      this.logger.warn(`a resposta da proposta não saiu — ${e instanceof FalhaDoEnvioDoMister ? e.motivo : (e?.message ?? e)}`);
    }
  }

  private async auditar(tenantId: string, atorId: string | null, acao: string, propostaId: string, detalhe: Record<string, unknown>): Promise<void> {
    await this.auditoria
      ?.registrar({ tenantId, atorId, atorPerfil: 'presidente', tipo: 'mister', acao, entidadeTipo: 'mister_proposta', entidadeId: propostaId, detalhe, origem: 'whatsapp' } as any)
      .catch((e: any) => this.logger.warn(`a auditoria da proposta ${propostaId} falhou — ${e?.message ?? e}`));
  }
}
