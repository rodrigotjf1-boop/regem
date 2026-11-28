import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { AutorDaDistribuicao, inserirAuditoriaDaDistribuicao } from '../distribuicao/distribuicao-auditoria';
import { FalhaDaIa, IaEmpresaService } from '../ia/ia-empresa.service';
import { PRECOS_POR_MILHAO, custoEstimadoUsd } from '../ia/ia.regras';
import { INSTRUCOES_DO_MISTER } from './mister-agente.regras';
import { modeloDasPerguntas } from './mister-laco';
import {
  CasoComparado,
  ErradaDaAvaliacao,
  INSTRUCOES_DO_MENTOR,
  MODELO_DO_MENTOR,
  RECURSO_DO_MENTOR,
  RodadaParaComparar,
  SAIDA_DO_MENTOR,
  TrocaPublicada,
  aplicarTrocas,
  lerCandidata,
  mensagensDoMentor,
  regraDePublicar,
  versaoDoTexto,
} from './mister-instrucoes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS INSTRUÇÕES CANDIDATAS DO MISTER (M2b, o Mentor; mig 435). O texto que o agente, os relatórios e a avaliação usam é o
// "no ar": o do código com as trocas publicadas. Uma candidata por vez — uma troca nova que o Mentor propõe (pela chave da
// DMS) a partir das erradas da avaliação da versão no ar, ou a "volta" da última troca —, que só se publica com a avaliação
// de regressão passando sem errada nova. Só a Diretoria, só no console.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';
const unica = (e: any) => e?.code === '23505' || e?.cause?.code === '23505';
/** Quanto o texto no ar fica em memória: o publicar limpa na hora neste processo; as outras réplicas leem em até 30 s. */
const CACHE_MS = 30_000;
/** MIS-G-02: a candidata da tela não é mais a candidata (alguém descartou e pediu outra no meio). */
const CANDIDATA_MUDOU = 'A candidata mudou desde que você abriu esta tela. Recarregue e confira a que está agora antes de publicar ou descartar.';
const MOTIVO_DA_IA: Record<string, string> = {
  sem_chave: 'A chave de IA da distribuição não está configurada neste servidor.',
  chave_recusada: 'A chave de IA da distribuição foi recusada.',
  sem_credito: 'A conta de IA da distribuição está sem crédito.',
  teto_atingido: 'A conta de IA da distribuição chegou ao limite de gasto.',
};

export interface InstrucoesNoAr {
  texto: string;
  versao: string;
  /** As trocas aplicadas (ids) e as que não acharam a linha no código. */
  aplicadas: string[];
  quebradas: string[];
}

const casosDe = (v: unknown): CasoComparado[] =>
  (Array.isArray(v) ? v : []).map((c: any) => ({ id: String(c?.id ?? ''), pergunta: String(c?.pergunta ?? ''), ok: c?.ok === true })).filter((c) => c.id);
const rodadaDe = (r: any): (RodadaParaComparar & { id: string; acertos: number; custoUsd: number | null; iniciadaEm: string; casosInteiros: any[] }) | null =>
  r
    ? {
        id: String(r.id),
        situacao: String(r.situacao),
        versao: String(r.versao),
        total: Number(r.total) || 0,
        feitas: Number(r.feitas) || 0,
        acertos: Number(r.acertos) || 0,
        casos: casosDe(r.casos),
        casosInteiros: Array.isArray(r.casos) ? r.casos : [],
        custoUsd: r.custoUsd === null || r.custoUsd === undefined ? null : Number(r.custoUsd),
        iniciadaEm: r.iniciadaEm,
        modelo: r.modelo ? String(r.modelo) : null,
      }
    : null;

@Injectable()
export class MisterInstrucoesService {
  private readonly logger = new Logger('MisterInstrucoes');
  private cache: { em: number; valor: InstrucoesNoAr } | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ia: IaEmpresaService,
  ) {}

  private async trocasNoAr(db: any = this.db): Promise<(TrocaPublicada & { publicadaEm: string; publicadaPor: string | null; criadaEm: string })[]> {
    try {
      return linhas(
        await db.execute(sql`
          select id::text as id, sai, entra, publicada_em as "publicadaEm", publicada_por as "publicadaPor", criada_em as "criadaEm"
            from mister_instrucao_troca where situacao = 'no_ar' and tipo = 'troca'
           order by publicada_em, criada_em`),
      );
    } catch (e: any) {
      if (semTabela(e)) return [];
      throw e;
    }
  }

  /** O texto no ar (o do código com as trocas publicadas) e a versão. Sem a tabela ou sem troca: o código, sem mudar nada. */
  async noAr(): Promise<InstrucoesNoAr> {
    if (this.cache && Date.now() - this.cache.em < CACHE_MS) return this.cache.valor;
    let trocas: Awaited<ReturnType<MisterInstrucoesService['trocasNoAr']>>;
    try {
      trocas = await this.trocasNoAr();
    } catch (e: any) {
      // Rodada 7, MIS-G-05 (ERR-659): a leitura que falha não troca o texto avaliado pelo do código — vale o último lido (mesmo
      // vencido no tempo); sem nenhum, o erro segue (e o agente cai no texto do código com o aviso no log, como antes).
      if (this.cache) {
        this.logger.warn(`instruções do Mister: a leitura das trocas falhou; sigo com o texto lido por último — ${e?.message ?? e}`);
        return this.cache.valor;
      }
      throw e;
    }
    const r = aplicarTrocas(INSTRUCOES_DO_MISTER, trocas);
    const valor = { texto: r.texto, versao: versaoDoTexto(r.texto), aplicadas: r.aplicadas, quebradas: r.quebradas };
    this.cache = { em: Date.now(), valor };
    return valor;
  }

  /** O texto com uma candidata: a troca aplicada sobre o no ar, ou (a volta) o no ar sem a troca alvo. */
  private async textoCom(c: { tipo: string; sai: string; entra: string; trocaAlvo: string | null }, db: any = this.db): Promise<string> {
    const noAr = await this.trocasNoAr(db);
    if (c.tipo === 'volta') return aplicarTrocas(INSTRUCOES_DO_MISTER, noAr.filter((t) => t.id !== c.trocaAlvo)).texto;
    return aplicarTrocas(aplicarTrocas(INSTRUCOES_DO_MISTER, noAr).texto, [{ id: 'candidata', sai: c.sai, entra: c.entra }]).texto;
  }

  private async candidata(db: any = this.db, trava = false): Promise<any | null> {
    const [c] = linhas(
      await db.execute(sql`
        select id::text as id, tipo, sai, entra, porque, padrao, troca_alvo::text as "trocaAlvo", versao_base as "versaoBase", versao,
               avaliacao_id::text as "avaliacaoId", criada_por as "criadaPor", criada_em as "criadaEm"
          from mister_instrucao_troca where situacao = 'candidata'
         ${trava ? sql`for update` : sql``}`),
    );
    return c ?? null;
  }

  private async rodada(where: any, db: any = this.db) {
    const [r] = linhas(
      await db.execute(sql`
        select id::text as id, situacao, versao, total, feitas, acertos, casos, custo_usd::float8 as "custoUsd", iniciada_em as "iniciadaEm", modelo
          from mister_avaliacao where ${where} order by iniciada_em desc limit 1`),
    );
    return rodadaDe(r);
  }

  /** A avaliação inteira mais nova da versão no ar (a base da comparação). */
  private baseDe(versao: string, db: any = this.db) {
    return this.rodada(sql`versao = ${versao} and situacao = 'terminou' and feitas >= total`, db);
  }

  /** O cartão do console: a versão no ar, a candidata com a avaliação e a comparação, e as trocas publicadas. */
  async estado() {
    const noAr = await this.noAr();
    let publicadas: any[] = [];
    let candidata: any = null;
    let base: Awaited<ReturnType<MisterInstrucoesService['baseDe']>> = null;
    try {
      publicadas = await this.trocasNoAr();
      candidata = await this.candidata();
      base = await this.baseDe(noAr.versao);
    } catch (e: any) {
      if (semTabela(e)) return { indisponivel: true, chaveDaDistribuicao: this.ia.iaIncluidaDisponivel(), noAr: { versao: noAr.versao }, candidata: null, publicadas: [], erradasNoAr: [] };
      throw e;
    }
    let daCandidata: Awaited<ReturnType<MisterInstrucoesService['rodada']>> = null;
    if (candidata?.avaliacaoId) daCandidata = await this.rodada(sql`id = ${candidata.avaliacaoId}::uuid`);
    const regra = candidata ? regraDePublicar({ versaoNoAr: noAr.versao, candidata, base, daCandidata }) : null;
    const erradasNoAr = base ? base.casosInteiros.filter((c: any) => c?.ok === false).map((c: any) => ({ pergunta: String(c.pergunta ?? ''), falhas: (Array.isArray(c.falhas) ? c.falhas : []).map(String) })) : [];
    const resumo = (r: typeof base) =>
      r ? { id: r.id, situacao: r.situacao, total: r.total, feitas: r.feitas, acertos: r.acertos, custoUsd: r.custoUsd, iniciadaEm: r.iniciadaEm } : null;
    const ultima = publicadas.at(-1);
    return {
      indisponivel: false,
      chaveDaDistribuicao: this.ia.iaIncluidaDisponivel(),
      noAr: {
        versao: noAr.versao,
        desde: ultima?.publicadaEm ?? null,
        por: ultima?.publicadaPor ?? null,
        avaliacao: resumo(base),
        quebradas: publicadas.filter((t) => noAr.quebradas.includes(t.id)).map((t) => ({ id: t.id, sai: t.sai })),
      },
      erradasNoAr,
      candidata: candidata
        ? {
            ...candidata,
            avaliacao: resumo(daCandidata),
            pode: regra!.pode,
            motivo: regra!.motivo,
            novas: regra!.novas.map((c) => c.pergunta),
            melhoraram: regra!.melhoraram.map((c) => c.pergunta),
          }
        : null,
      publicadas: publicadas.map((t, i) => ({ id: t.id, sai: t.sai, entra: t.entra, publicadaEm: t.publicadaEm, publicadaPor: t.publicadaPor, ultima: i === publicadas.length - 1 })),
    };
  }

  private exigirNuvem() {
    if (ehServidorLocal()) throw new ServiceUnavailableException('As instruções do Mister só mudam na nuvem.');
  }

  private async gravarCandidata(c: { tipo: string; sai: string; entra: string; porque: string | null; padrao: string | null; trocaAlvo: string | null }, versaoBase: string, quem: string | null) {
    const versao = versaoDoTexto(await this.textoCom(c));
    try {
      const [l] = linhas(
        await this.db.execute(sql`
          insert into mister_instrucao_troca (tipo, sai, entra, porque, padrao, troca_alvo, versao_base, versao, criada_por)
          values (${c.tipo}, ${c.sai}, ${c.entra}, ${c.porque}, ${c.padrao}, ${c.trocaAlvo}::uuid, ${versaoBase}, ${versao}, ${quem ? String(quem).slice(0, 80) : null})
          returning id::text as id, versao`),
      );
      return l;
    } catch (e: any) {
      if (unica(e)) throw new ConflictException('Já tem uma candidata. Publique ou descarte antes de pedir outra.');
      if (semTabela(e)) throw new ServiceUnavailableException('As instruções candidatas ainda não estão disponíveis neste servidor (falta a migration 435).');
      throw e;
    }
  }

  /**
   * O Mentor propõe a troca de uma linha a partir das erradas da avaliação inteira mais nova da versão no ar, pela chave da
   * DMS. A resposta que não serve (linha que não existe, fora do formato) não grava nada e diz por quê.
   */
  async proporCandidata(quem: string | null) {
    this.exigirNuvem();
    if (!this.ia.iaIncluidaDisponivel()) throw new ServiceUnavailableException(MOTIVO_DA_IA.sem_chave);
    if (await this.candidata().catch((e) => (semTabela(e) ? null : Promise.reject(e)))) throw new ConflictException('Já tem uma candidata. Publique ou descarte antes de pedir outra.');
    const noAr = await this.noAr();
    const base = await this.baseDe(noAr.versao);
    if (!base) throw new BadRequestException('A versão no ar ainda não tem uma avaliação inteira. Rode a avaliação dela antes.');
    const erradas: ErradaDaAvaliacao[] = base.casosInteiros.filter((c: any) => c?.ok === false).map((c: any) => ({ pergunta: String(c.pergunta ?? ''), falhas: (Array.isArray(c.falhas) ? c.falhas : []).map(String) }));
    if (!erradas.length) throw new BadRequestException('A avaliação da versão no ar não errou nada: não há o que corrigir.');
    const modelo = PRECOS_POR_MILHAO[MODELO_DO_MENTOR] ? MODELO_DO_MENTOR : modeloDasPerguntas();
    let resposta: string;
    try {
      const r = await this.ia.pedirPelaDistribuicao({ recurso: RECURSO_DO_MENTOR, modelo, maxTokens: SAIDA_DO_MENTOR, system: INSTRUCOES_DO_MENTOR, messages: mensagensDoMentor(noAr.texto, erradas), prazoMs: 60_000 });
      this.logger.log(`mentor: candidata pedida (${custoEstimadoUsd(modelo, r.uso) ?? '?'} US$)`);
      resposta = r.recusou || r.parou === 'max_tokens' ? '' : r.texto;
    } catch (e: any) {
      if (e instanceof FalhaDaIa) throw new ServiceUnavailableException(MOTIVO_DA_IA[e.motivo] ?? 'A IA não respondeu. Tente de novo daqui a pouco.');
      throw e;
    }
    const troca = lerCandidata(resposta, noAr.texto);
    if (!troca) throw new BadRequestException('O Mentor não devolveu uma troca que sirva (a linha que sai precisa existir nas instruções). Peça de novo.');
    return this.gravarCandidata({ tipo: 'troca', ...troca, padrao: `avaliacao:${base.id}`, trocaAlvo: null }, noAr.versao, quem);
  }

  /** "Voltar sem a última troca": vira uma candidata (tira a última publicada), que também passa pela avaliação. */
  async proporVolta(quem: string | null) {
    this.exigirNuvem();
    const publicadas = await this.trocasNoAr();
    const ultima = publicadas.at(-1);
    if (!ultima) throw new BadRequestException('Não há troca publicada para tirar: no ar está o texto do código.');
    const noAr = await this.noAr();
    return this.gravarCandidata({ tipo: 'volta', sai: ultima.entra, entra: ultima.sai, porque: 'voltar ao texto de antes da última troca', padrao: null, trocaAlvo: ultima.id }, noAr.versao, quem);
  }

  /** O texto e a versão da candidata, para a avaliação rodar com eles. */
  async textoDaCandidata(): Promise<{ id: string; texto: string; versao: string }> {
    const c = await this.candidata().catch((e) => (semTabela(e) ? null : Promise.reject(e)));
    if (!c) throw new NotFoundException('Não há candidata para avaliar.');
    const texto = await this.textoCom(c);
    return { id: c.id, texto, versao: versaoDoTexto(texto) };
  }

  /** Guarda a rodada da avaliação feita com a candidata (a última vale). */
  async marcarAvaliacao(candidataId: string, avaliacaoId: string): Promise<void> {
    await this.db.execute(sql`update mister_instrucao_troca set avaliacao_id = ${avaliacaoId}::uuid where id = ${candidataId}::uuid and situacao = 'candidata'`);
  }

  /**
   * Publica a candidata — a regra conferida DENTRO da transação, com a candidata travada (dois toques: um publica).
   * Rodada 7: MIS-G-02 (ERR-659) — com o `candidataId` que a tela mostrou, outra candidata (alguém descartou e pediu outra
   * enquanto a tela estava aberta) é recusada; MIS-G-06 — quem publica vai à auditoria da distribuição na MESMA transação.
   */
  async publicar(quem: AutorDaDistribuicao | string | null, candidataId?: string | null) {
    this.exigirNuvem();
    const autor = quem && typeof quem === 'object' ? quem : null;
    const nome = autor ? autor.nome : quem;
    const r = await this.db.transaction(async (tx) => {
      const c = await this.candidata(tx, true);
      if (!c) throw new NotFoundException('Não há candidata para publicar.');
      if (candidataId && c.id !== candidataId) throw new ConflictException(CANDIDATA_MUDOU);
      const trocas = await this.trocasNoAr(tx);
      const versaoNoAr = versaoDoTexto(aplicarTrocas(INSTRUCOES_DO_MISTER, trocas).texto);
      const base = await this.baseDe(versaoNoAr, tx);
      const daCandidata = c.avaliacaoId ? await this.rodada(sql`id = ${c.avaliacaoId}::uuid`, tx) : null;
      const regra = regraDePublicar({ versaoNoAr, candidata: c, base, daCandidata });
      if (!regra.pode) throw new ConflictException(regra.motivo);
      const por = nome ? String(nome).slice(0, 80) : null;
      if (c.tipo === 'volta') {
        await tx.execute(sql`update mister_instrucao_troca set situacao = 'retirada', retirada_em = now() where id = ${c.trocaAlvo}::uuid and situacao = 'no_ar'`);
        await tx.execute(sql`update mister_instrucao_troca set situacao = 'feita', publicada_por = ${por}, publicada_em = now() where id = ${c.id}::uuid`);
      } else {
        await tx.execute(sql`update mister_instrucao_troca set situacao = 'no_ar', publicada_por = ${por}, publicada_em = now() where id = ${c.id}::uuid`);
      }
      if (autor) await inserirAuditoriaDaDistribuicao(tx, autor, 'publicou_instrucoes_do_mister', null, { candidata: c.id, tipo: c.tipo, versao: c.versao });
      return { id: c.id, tipo: c.tipo, versao: c.versao };
    });
    this.cache = null;
    return r;
  }

  async descartar(quem: AutorDaDistribuicao | string | null, candidataId?: string | null) {
    this.exigirNuvem();
    const autor = quem && typeof quem === 'object' ? quem : null;
    const nome = autor ? autor.nome : quem;
    return this.db.transaction(async (tx) => {
      const [c] = linhas(
        await tx.execute(sql`
          update mister_instrucao_troca set situacao = 'descartada', descartada_por = ${nome ? String(nome).slice(0, 80) : null}, descartada_em = now()
           where situacao = 'candidata' ${candidataId ? sql`and id = ${candidataId}::uuid` : sql``}
          returning id::text as id`),
      );
      if (!c) {
        // MIS-G-02: com o id da tela, a candidata que mudou não é descartada no lugar dela.
        if (candidataId && (await this.candidata(tx))) throw new ConflictException(CANDIDATA_MUDOU);
        throw new NotFoundException('Não há candidata para descartar.');
      }
      if (autor) await inserirAuditoriaDaDistribuicao(tx, autor, 'descartou_candidata_do_mister', null, { candidata: c.id });
      return c;
    });
  }
}
