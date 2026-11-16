import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { FUSO_SQL } from '../../common/fuso-sql';
import { FalhaDaIa, IaEmpresaService } from '../ia/ia-empresa.service';
import { UsoDaChamada, custoEstimadoUsd } from '../ia/ia.regras';
import { modeloDasPerguntas } from './mister-laco';
import { MisterSegurancaService } from './mister-seguranca.service';
import {
  DIAS_DA_ANALISE,
  INSTRUCOES_DO_SENTINELA,
  MetadadosDaAnalise,
  PRAZO_DA_ANALISE_MIN,
  RECURSO_DA_ANALISE,
  SAIDA_MAX_TOKENS,
  conferirDecisaoDaAnalise,
  contarEventos,
  estimativaDaAnalise,
  lerPropostas,
  mensagensDaAnalise,
} from './mister-sentinela';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ANÁLISE COM IA DA SEGURANÇA (o Sentinela, parte 2; S2, mig 434). Só na nuvem, só pelo botão da Diretoria (cada rodada
// gasta a chave da DMS), uma de cada vez (índice único). A rodada roda em segundo plano: a rota devolve na hora e a tela
// acompanha. A IA lê só os metadados (`mister-sentinela.ts`) e só PROPÕE; as propostas ficam com a rodada.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';
const unica = (e: any) => e?.code === '23505' || e?.cause?.code === '23505';
const NOTAS = sql`case when jsonb_typeof(p.conferencia) = 'array' then p.conferencia else '[]'::jsonb end`;
const TRILHA = sql`case when jsonb_typeof(p.ferramentas) = 'array' then p.ferramentas else '[]'::jsonb end`;
const MOTIVO_DA_FALHA: Record<string, string> = {
  sem_chave: 'a chave de IA da distribuição não está configurada neste servidor',
  chave_recusada: 'a chave de IA da distribuição foi recusada',
  sem_credito: 'a conta de IA da distribuição está sem crédito',
  teto_atingido: 'a conta de IA da distribuição chegou ao limite de gasto',
};

@Injectable()
export class MisterSentinelaService {
  private readonly logger = new Logger('MisterSentinela');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ia: IaEmpresaService,
    private readonly seguranca: MisterSegurancaService,
  ) {}

  /** A rodada "rodando" que passou do prazo vira "interrompida" (o processo caiu no meio). Nunca lança. */
  private async vencerAsParadas(): Promise<void> {
    try {
      await this.db.execute(sql`
        update mister_analise set situacao = 'interrompida', terminada_em = now(), motivo = coalesce(motivo, 'o servidor reiniciou no meio da análise')
         where situacao = 'rodando' and iniciada_em < now() - make_interval(mins => ${PRAZO_DA_ANALISE_MIN})`);
    } catch (e: any) {
      if (!semTabela(e)) this.logger.warn(`análise: não consegui encerrar as rodadas paradas — ${e?.message ?? e}`);
    }
  }

  /** Os metadados do período: o resumo da Segurança e três leituras a mais — nunca o texto, o telefone inteiro ou o código. */
  async metadados(dias = DIAS_DA_ANALISE): Promise<MetadadosDaAnalise> {
    const desde = sql`now() - make_interval(days => ${dias})`;
    const seguranca = await this.seguranca.resumo(dias);
    let telefones: any[] = [];
    let notas: any[] = [];
    let motivos: any[] = [];
    try {
      telefones = linhas(
        await this.db.execute(sql`
          select right(telefone, 4) as final, count(*)::int as vezes,
                 to_char(min(recebida_em) at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as de,
                 to_char(max(recebida_em) at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as ate
            from mister_mensagem
           where recebida_em > ${desde} and telefone is not null
             and desfecho in ('codigo_nao_vale', 'codigos_demais', 'codigo_calado')
           group by telefone
          having count(*) >= 3
           order by vezes desc, final
           limit 5`),
      );
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }
    try {
      notas = linhas(
        await this.db.execute(sql`
          select nota, coalesce(f ->> 'nome', '(sem consulta)') as consulta, count(distinct p.id)::int as vezes,
                 count(distinct p.tenant_id)::int as empresas
            from mister_pergunta p
            cross join lateral jsonb_array_elements_text(${NOTAS}) nota
            left join lateral jsonb_array_elements(${TRILHA}) f on true
           where p.criado_em > ${desde}
           group by nota, consulta
           order by vezes desc, nota, consulta
           limit 20`),
      );
      motivos = linhas(
        await this.db.execute(sql`
          select motivo, count(*)::int as vezes from mister_pergunta
           where criado_em > ${desde} and motivo is not null
           group by motivo order by vezes desc, motivo limit 10`),
      );
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }
    return {
      dias,
      seguranca,
      telefonesComCodigoErrado: telefones.map((t) => ({ final: String(t.final), vezes: Number(t.vezes) || 0, de: String(t.de), ate: String(t.ate) })),
      notasPorConsulta: notas.map((n) => ({ nota: String(n.nota), consulta: String(n.consulta), vezes: Number(n.vezes) || 0, empresas: Number(n.empresas) || 0 })),
      motivosSemResposta: motivos.map((m) => ({ motivo: String(m.motivo), vezes: Number(m.vezes) || 0 })),
    };
  }

  /** O cartão do console: a última rodada com as propostas, se há chave, o modelo e o custo estimado de rodar agora. */
  async ultima() {
    await this.vencerAsParadas();
    const modelo = modeloDasPerguntas();
    const base = { chaveDaDistribuicao: this.ia.iaIncluidaDisponivel(), modelo, dias: DIAS_DA_ANALISE, prazoMin: PRAZO_DA_ANALISE_MIN };
    let estimativaUsd: number | null = null;
    try {
      estimativaUsd = estimativaDaAnalise(modelo, await this.metadados());
    } catch (e: any) {
      this.logger.warn(`análise: não consegui estimar o custo — ${e?.message ?? e}`);
    }
    try {
      const [a] = linhas(
        await this.db.execute(sql`
          select id::text as id, situacao, pedida_por as "pedidaPor", dias, eventos, modelo, custo_usd::float8 as "custoUsd", motivo,
                 iniciada_em as "iniciadaEm", terminada_em as "terminadaEm"
            from mister_analise order by iniciada_em desc limit 1`),
      );
      if (!a) return { ...base, estimativaUsd, analise: null, propostas: [] };
      const propostas = linhas(
        await this.db.execute(sql`
          select id::text as id, nivel, titulo, viu, proposta, impacto, situacao, tarefa, decidida_por as "decididaPor", decidida_em as "decididaEm"
            from mister_analise_proposta where analise_id = ${a.id}::uuid order by ordem`),
      );
      return { ...base, estimativaUsd, analise: { ...a, custoUsd: a.custoUsd === null ? null : Number(a.custoUsd) }, propostas };
    } catch (e: any) {
      if (semTabela(e)) return { ...base, estimativaUsd, analise: null, propostas: [], indisponivel: true };
      throw e;
    }
  }

  /** Começa uma rodada (em segundo plano) e devolve o id na hora. */
  async analisar(pedidaPor: string | null): Promise<{ id: string }> {
    if (ehServidorLocal()) throw new ServiceUnavailableException('A análise do Mister só roda na nuvem.');
    if (!this.ia.iaIncluidaDisponivel()) throw new ServiceUnavailableException('A chave de IA da distribuição não está configurada neste servidor.');
    await this.vencerAsParadas();
    const modelo = modeloDasPerguntas();
    let id: string;
    try {
      const [l] = linhas(
        await this.db.execute(sql`
          insert into mister_analise (pedida_por, dias, modelo) values (${pedidaPor ? String(pedidaPor).slice(0, 80) : null}, ${DIAS_DA_ANALISE}, ${modelo})
          returning id::text as id`),
      );
      id = String(l.id);
    } catch (e: any) {
      if (unica(e)) throw new ConflictException('Já tem uma análise rodando. Espere ela terminar.');
      if (semTabela(e)) throw new ServiceUnavailableException('A análise ainda não está disponível neste servidor (falta a migration 434).');
      throw e;
    }
    void this.executar(id, modelo).catch((e: any) => this.logger.error(`análise ${id}: parou — ${e?.message ?? e}`, e?.stack));
    return { id };
  }

  /** A rodada: lê os metadados, pede à IA, confere a resposta e grava as propostas — só se a rodada ainda está de pé. */
  async executar(id: string, modelo: string): Promise<void> {
    let uso: UsoDaChamada = { entrada: 0, cacheEscrita: 0, cacheLeitura: 0, saida: 0 };
    let eventos = 0;
    try {
      const m = await this.metadados();
      eventos = contarEventos(m);
      const r = await this.ia.pedirPelaDistribuicao({
        recurso: RECURSO_DA_ANALISE,
        modelo,
        maxTokens: SAIDA_MAX_TOKENS,
        system: INSTRUCOES_DO_SENTINELA,
        messages: mensagensDaAnalise(m),
        prazoMs: 60_000,
      });
      uso = r.uso;
      const propostas = r.recusou ? null : lerPropostas(r.texto);
      if (!propostas) {
        await this.fechar(id, modelo, uso, eventos, 'a IA respondeu fora do formato pedido; nenhuma proposta foi gravada');
        return;
      }
      await this.db.transaction(async (tx) => {
        const [fechou] = linhas(
          await tx.execute(sql`
            update mister_analise
               set situacao = 'terminou', eventos = ${eventos}, tokens_entrada = ${uso.entrada}, tokens_cache_escrita = ${uso.cacheEscrita},
                   tokens_cache_leitura = ${uso.cacheLeitura}, tokens_saida = ${uso.saida}, custo_usd = ${custoEstimadoUsd(modelo, uso)}, terminada_em = now()
             where id = ${id}::uuid and situacao = 'rodando'
            returning id`),
        );
        if (!fechou) return;
        for (const [i, p] of propostas.entries())
          await tx.execute(sql`
            insert into mister_analise_proposta (analise_id, ordem, nivel, titulo, viu, proposta, impacto)
            values (${id}::uuid, ${i}, ${p.nivel}, ${p.titulo}, ${p.viu}, ${p.proposta}, ${p.impacto})`);
      });
    } catch (e: any) {
      const motivo =
        e instanceof FalhaDaIa ? (MOTIVO_DA_FALHA[e.motivo] ?? 'a IA não respondeu; tente de novo daqui a pouco') : `a análise parou: ${String(e?.message ?? e).slice(0, 200)}`;
      if (!(e instanceof FalhaDaIa)) this.logger.error(`análise ${id}: ${e?.message ?? e}`, e?.stack);
      await this.fechar(id, modelo, uso, eventos, motivo);
    }
  }

  private async fechar(id: string, modelo: string, uso: UsoDaChamada, eventos: number, motivo: string): Promise<void> {
    await this.db.execute(sql`
      update mister_analise
         set situacao = 'falhou', motivo = ${motivo}, eventos = ${eventos}, tokens_entrada = ${uso.entrada}, tokens_cache_escrita = ${uso.cacheEscrita},
             tokens_cache_leitura = ${uso.cacheLeitura}, tokens_saida = ${uso.saida}, custo_usd = ${custoEstimadoUsd(modelo, uso)}, terminada_em = now()
       where id = ${id}::uuid and situacao = 'rodando'`);
  }

  /** "Virou tarefa" (link ou código opcional) ou "Descartar" numa proposta ainda aberta. Uma vez só (gravação condicional). */
  async decidir(dto: unknown, quem: string | null) {
    const d = conferirDecisaoDaAnalise(dto);
    if ('erro' in d) throw new BadRequestException(d.erro);
    const [mudou] = linhas(
      await this.db.execute(sql`
        update mister_analise_proposta
           set situacao = ${d.decisao}, tarefa = ${d.tarefa}, decidida_por = ${quem ? String(quem).slice(0, 80) : null}, decidida_em = now()
         where id = ${d.id}::uuid and situacao = 'aberta'
        returning id::text as id, situacao, tarefa, titulo`),
    );
    if (mudou) return mudou;
    const [existe] = linhas(await this.db.execute(sql`select situacao from mister_analise_proposta where id = ${d.id}::uuid`));
    if (!existe) throw new NotFoundException('Proposta não encontrada.');
    throw new ConflictException('Essa proposta já foi decidida.');
  }
}
