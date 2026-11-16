import { ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { FalhaDaIa, IaEmpresaService, PedidoDeIa } from '../ia/ia-empresa.service';
import { UsoDaChamada, custoEstimadoUsd } from '../ia/ia.regras';
import { CASOS_DA_AVALIACAO, CasoDaAvaliacao, PerfilDaAvaliacao, ResultadoDoCaso, conferirCaso, conversaDaAvaliacao, executarNaAvaliacao, versaoDasInstrucoes } from './mister-avaliacao-casos';
import { modeloDasPerguntas, responderComFerramentas } from './mister-laco';
import { MisterInstrucoesService } from './mister-instrucoes.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A AVALIAÇÃO DE REGRESSÃO DO MISTER (F5.3; mig 424). O console da distribuição (Diretoria) pede uma RODADA: as perguntas
// fixas de `mister-avaliacao-casos.ts` passam pelo MESMO laço do agente (`mister-laco.ts`: as mesmas instruções, as
// mesmas ferramentas, os mesmos tetos), com a chave da DISTRIBUIÇÃO e os dados inventados da loja de teste. Cada resposta
// é conferida por regra.
//
//  • Só na nuvem, só pelo botão (nunca sozinha: cada rodada gasta a chave da DMS), uma de cada vez (o índice único).
//  • A rodada roda em segundo plano: a rota devolve na hora e a tela acompanha pelo andamento gravado a cada pergunta.
//  • A rodada que ficou "rodando" porque o processo caiu vence pelo tempo (`PRAZO_DA_RODADA_MIN`) — a regra é UMA, aqui
//    (V80): quem lê recebe "interrompida", e a próxima rodada não trava.
//  • A chave da distribuição recusada ou sem crédito para a rodada inteira (as outras perguntas falhariam igual).
//  • Não soma no medidor de nenhuma empresa: o uso e o custo ficam na linha da rodada.

export const RECURSO_DA_AVALIACAO = 'mister_avaliacao';
export const PRAZO_DA_RODADA_MIN = 20;
const EM_PARALELO = 3;
const PADRAO: PerfilDaAvaliacao = { nivel: 'presidente', verValores: true };
const PARA_A_RODADA = ['sem_chave', 'chave_recusada', 'sem_credito', 'teto_atingido'];
const MOTIVO_DA_RODADA: Record<string, string> = {
  sem_chave: 'a chave de IA da distribuição não está configurada neste servidor',
  chave_recusada: 'a chave de IA da distribuição foi recusada',
  sem_credito: 'a conta de IA da distribuição está sem crédito',
  teto_atingido: 'a conta de IA da distribuição chegou ao limite de gasto',
};

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';
const unica = (e: any) => e?.code === '23505' || e?.cause?.code === '23505';

@Injectable()
export class MisterAvaliacaoService {
  private readonly logger = new Logger(MisterAvaliacaoService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ia: IaEmpresaService,
    // M2b (mig 435): a avaliação roda com o texto NO AR (o do código com as trocas publicadas) — ou com o da candidata.
    @Optional() private readonly instrucoes?: MisterInstrucoesService,
  ) {}

  /** A rodada "rodando" que passou do prazo vira "interrompida" (o processo caiu no meio). Nunca lança. */
  private async vencerAsParadas(): Promise<void> {
    try {
      await this.db.execute(sql`
        update mister_avaliacao
           set situacao = 'interrompida', terminada_em = now(), atualizado_em = now(),
               motivo = coalesce(motivo, 'o servidor reiniciou no meio da rodada')
         where situacao = 'rodando' and iniciada_em < now() - make_interval(mins => ${PRAZO_DA_RODADA_MIN})`);
    } catch (e: any) {
      if (!semTabela(e)) this.logger.warn(`avaliação: não consegui encerrar as rodadas paradas — ${e?.message ?? e}`);
    }
  }

  /**
   * Começa uma rodada (em segundo plano) e devolve o id na hora. Sem `comInstrucoes`, roda com o texto no ar; a candidata
   * (M2b) passa o texto e a versão dela.
   */
  async rodar(pedidaPor: string | null, comInstrucoes?: { texto: string; versao: string }): Promise<{ id: string; total: number }> {
    if (ehServidorLocal()) throw new ServiceUnavailableException('A avaliação do Mister só roda na nuvem.');
    if (!this.ia.iaIncluidaDisponivel()) throw new ServiceUnavailableException('A chave de IA da distribuição não está configurada neste servidor.');
    await this.vencerAsParadas();
    const instrucoes = comInstrucoes ?? (this.instrucoes ? await this.instrucoes.noAr() : null);
    const { consultas } = versaoDasInstrucoes();
    const versao = instrucoes?.versao ?? versaoDasInstrucoes().versao;
    const modelo = modeloDasPerguntas();
    const casos = CASOS_DA_AVALIACAO;
    let id: string;
    try {
      const [l] = linhas(
        await this.db.execute(sql`
          insert into mister_avaliacao (pedida_por, versao, consultas, modelo, total)
          values (${pedidaPor ? String(pedidaPor).slice(0, 80) : null}, ${versao}, ${consultas}, ${modelo}, ${casos.length})
          returning id::text as id`),
      );
      id = String(l.id);
    } catch (e: any) {
      if (unica(e)) throw new ConflictException('Já tem uma avaliação rodando. Espere ela terminar.');
      if (semTabela(e)) throw new ServiceUnavailableException('A avaliação ainda não está disponível neste servidor (falta a migration 424).');
      throw e;
    }
    void this.executar(id, modelo, casos, instrucoes?.texto).catch((e: any) => this.logger.error(`avaliação ${id}: a rodada parou — ${e?.message ?? e}`, e?.stack));
    return { id, total: casos.length };
  }

  /** As perguntas, EM_PARALELO de cada vez; cada uma grava o resultado na hora (o andamento). Exposto para o teste. */
  async executar(id: string, modelo: string, casos: CasoDaAvaliacao[], instrucoes?: string): Promise<void> {
    let parar: string | null = null;
    let proxima = 0;
    const trabalhar = async () => {
      while (!parar && proxima < casos.length) {
        const caso = casos[proxima++];
        const r = await this.umaPergunta(caso, modelo, instrucoes);
        if (r.paraARodada) {
          parar = r.paraARodada;
          return;
        }
        await this.gravarCaso(id, r.resultado, r.uso);
      }
    };
    await Promise.all(Array.from({ length: Math.min(EM_PARALELO, casos.length) }, trabalhar));
    await this.fechar(id, modelo, parar);
  }

  private async umaPergunta(caso: CasoDaAvaliacao, modelo: string, instrucoes?: string): Promise<{ resultado: ResultadoDoCaso; uso: UsoDaChamada; paraARodada?: string }> {
    const perfil = caso.perfil ?? PADRAO;
    const uso: UsoDaChamada = { entrada: 0, cacheEscrita: 0, cacheLeitura: 0, saida: 0 };
    let paraARodada: string | undefined;
    const t0 = Date.now();
    const fim = await responderComFerramentas(
      {
        modelo,
        instrucoes,
        recurso: RECURSO_DA_AVALIACAO,
        conversa: conversaDaAvaliacao(perfil),
        pedir: async (p: PedidoDeIa) => {
          try {
            const r = await this.ia.pedirPelaDistribuicao(p);
            uso.entrada += r.uso.entrada;
            uso.cacheEscrita += r.uso.cacheEscrita;
            uso.cacheLeitura += r.uso.cacheLeitura;
            uso.saida += r.uso.saida;
            return r;
          } catch (e: any) {
            if (e instanceof FalhaDaIa && PARA_A_RODADA.includes(e.motivo)) paraARodada = e.motivo;
            throw e;
          }
        },
        executar: async (nome, entrada) => executarNaAvaliacao(nome, entrada, perfil),
      },
      [],
      caso.pergunta,
    );
    return { resultado: conferirCaso(caso, fim, Date.now() - t0), uso, paraARodada };
  }

  private async gravarCaso(id: string, r: ResultadoDoCaso, uso: UsoDaChamada): Promise<void> {
    // Somas no banco (as perguntas em paralelo gravam na mesma linha) e só enquanto a rodada está de pé.
    await this.db.execute(sql`
      update mister_avaliacao
         set casos = casos || ${JSON.stringify([r])}::jsonb,
             feitas = feitas + 1,
             acertos = acertos + ${r.ok ? 1 : 0},
             tokens_entrada = tokens_entrada + ${uso.entrada},
             tokens_cache_escrita = tokens_cache_escrita + ${uso.cacheEscrita},
             tokens_cache_leitura = tokens_cache_leitura + ${uso.cacheLeitura},
             tokens_saida = tokens_saida + ${uso.saida},
             atualizado_em = now()
       where id = ${id}::uuid and situacao = 'rodando'`);
  }

  private async fechar(id: string, modelo: string, parar: string | null): Promise<void> {
    const [l] = linhas(
      await this.db.execute(sql`
        select tokens_entrada as entrada, tokens_cache_escrita as "cacheEscrita", tokens_cache_leitura as "cacheLeitura", tokens_saida as saida
          from mister_avaliacao where id = ${id}::uuid`),
    );
    const uso: UsoDaChamada = { entrada: Number(l?.entrada) || 0, cacheEscrita: Number(l?.cacheEscrita) || 0, cacheLeitura: Number(l?.cacheLeitura) || 0, saida: Number(l?.saida) || 0 };
    const custo = custoEstimadoUsd(modelo, uso);
    await this.db.execute(sql`
      update mister_avaliacao
         set situacao = ${parar ? 'falhou' : 'terminou'},
             motivo = ${parar ? MOTIVO_DA_RODADA[parar] ?? parar : null},
             custo_usd = ${custo},
             terminada_em = now(), atualizado_em = now()
       where id = ${id}::uuid and situacao = 'rodando'`);
  }

  /** As últimas rodadas, a versão de agora e se há chave — para o cartão do console. Nunca o texto de loja nenhuma. */
  async lista() {
    // M2b: a versão "de agora" é a do texto no ar (o do código com as trocas publicadas).
    const doCodigo = versaoDasInstrucoes();
    const atual = this.instrucoes ? { versao: (await this.instrucoes.noAr()).versao, consultas: doCodigo.consultas } : doCodigo;
    const base = { versaoAtual: atual, total: CASOS_DA_AVALIACAO.length, chaveDaDistribuicao: this.ia.iaIncluidaDisponivel(), modelo: modeloDasPerguntas(), prazoMin: PRAZO_DA_RODADA_MIN };
    let rodadas: any[] = [];
    try {
      rodadas = linhas(
        await this.db.execute(sql`
          select id::text as id, ${situacaoLida} as situacao, iniciada_em as "iniciadaEm", terminada_em as "terminadaEm", pedida_por as "pedidaPor",
                 versao, consultas, modelo, total, feitas, acertos, motivo, custo_usd::float8 as "custoUsd",
                 (select coalesce(jsonb_agg(jsonb_build_object('pergunta', c ->> 'pergunta', 'falha', c -> 'falhas' ->> 0)), '[]'::jsonb)
                    from (select c from jsonb_array_elements(casos) c where (c ->> 'ok')::boolean is false limit 2) x) as "oQueFalhou",
                 (select count(*)::int from jsonb_array_elements(casos) c where (c ->> 'ok')::boolean is false) as falhas
            from mister_avaliacao
           order by iniciada_em desc
           limit 10`),
      );
    } catch (e: any) {
      if (!semTabela(e)) throw e;
      return { ...base, disponivel: false, rodadas: [] };
    }
    return { ...base, disponivel: true, rodadas: rodadas.map(rodadaDaLista) };
  }

  /** Uma rodada com as perguntas, para a gaveta "Ver as 40". */
  async detalhe(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id ?? ''))) throw new NotFoundException('Avaliação não encontrada.');
    let l: any;
    try {
      [l] = linhas(
        await this.db.execute(sql`
          select id::text as id, ${situacaoLida} as situacao, iniciada_em as "iniciadaEm", terminada_em as "terminadaEm", pedida_por as "pedidaPor",
                 versao, consultas, modelo, total, feitas, acertos, motivo, custo_usd::float8 as "custoUsd", casos
            from mister_avaliacao where id = ${id}::uuid`),
      );
    } catch (e: any) {
      if (semTabela(e)) throw new NotFoundException('Avaliação não encontrada.');
      throw e;
    }
    if (!l) throw new NotFoundException('Avaliação não encontrada.');
    const casos = (Array.isArray(l.casos) ? l.casos : []) as ResultadoDoCaso[];
    // Na ordem das perguntas (em paralelo, elas terminam fora de ordem).
    const ordem = new Map(CASOS_DA_AVALIACAO.map((c, i) => [c.id, i]));
    casos.sort((a, b) => (ordem.get(a.id) ?? 999) - (ordem.get(b.id) ?? 999));
    return { ...rodadaDaLista(l), casos };
  }
}

/** A situação como a tela recebe: a "rodando" vencida já sai "interrompida" (a regra é esta, V80). */
const situacaoLida = sql.raw(`case when situacao = 'rodando' and iniciada_em < now() - make_interval(mins => ${PRAZO_DA_RODADA_MIN}) then 'interrompida' else situacao end`);

function rodadaDaLista(l: any) {
  return {
    id: String(l.id),
    situacao: String(l.situacao),
    iniciadaEm: l.iniciadaEm,
    terminadaEm: l.terminadaEm ?? null,
    pedidaPor: l.pedidaPor ?? null,
    versao: String(l.versao ?? ''),
    consultas: Number(l.consultas) || 0,
    modelo: String(l.modelo ?? ''),
    total: Number(l.total) || 0,
    feitas: Number(l.feitas) || 0,
    acertos: Number(l.acertos) || 0,
    motivo: l.motivo ?? null,
    custoUsd: l.custoUsd === null || l.custoUsd === undefined ? null : Number(l.custoUsd),
    ...(l.oQueFalhou !== undefined ? { oQueFalhou: Array.isArray(l.oQueFalhou) ? l.oQueFalhou : [], falhas: Number(l.falhas) || 0 } : {}),
  };
}
