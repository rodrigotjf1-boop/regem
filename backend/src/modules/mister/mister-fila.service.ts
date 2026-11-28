import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { FUSO_SQL } from '../../common/fuso-sql';
import { hojeISO } from '../../common/data';
import { RECURSO_DO_DOCUMENTO } from '../../common/documento-por-foto';
import { MotivoSemResposta, NivelDoMister, NotaDaSaida, TETOS, TEXTOS_DO_AGENTE, TrocaDaMemoria, tetoDaPergunta } from './mister-agente.regras';
import { RECURSO_DA_FOTO_DO_MISTER } from './mister-midia.regras';

/** MIS-H-06: as leituras de mídia que contam no teto do dia da empresa (a foto, a lista lida da foto e o documento). */
const RECURSOS_DE_MIDIA = [RECURSO_DA_FOTO_DO_MISTER, RECURSO_DO_DOCUMENTO];
import { lerAndamento } from './mister-andamento';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A FILA DAS PERGUNTAS DO MISTER (mig 418). Só banco: quem responde é o agente (`MisterAgenteService`), noutro módulo.
//
//  • O webhook da Meta não espera a IA: a pergunta é GRAVADA e o agente é acordado. A mesma mensagem nunca entra duas
//    vezes (a `chave` é única).
//  • Uma conversa (empresa + pessoa) é respondida por UM agente de cada vez, e as mensagens que ela mandou em seguida
//    saem juntas, como uma pergunta só (LIC-573): a pega trava a linha do vínculo da pessoa, que é a identidade da
//    conversa, e leva tudo o que ela tem na fila. Conversa já em resposta fica de fora NA CONSULTA (V84).
//  • Toda pega VENCE (LIC-580): se o processo cair no meio, a pergunta volta para a fila uma vez; na segunda, é
//    encerrada como interrompida e a pessoa é avisada por quem chama.
//  • O texto da pergunta e o da resposta saem em 30 dias; a linha, em 90 (a rotina diária da entrada chama `limpar`).

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
/** Os campos do pedido às consultas que trazem as palavras da pessoa: saem com o texto, em 30 dias. */
export const PALAVRAS_DA_PESSOA = ['busca', 'assunto'] as const;

export interface DonoDaPergunta {
  tenantId: string;
  colaboradorId: string;
  unidadeId: string | null;
  nivel: NivelDoMister;
  telefone: string;
}

export interface PerguntaNaFila {
  id: string;
  tenantId: string;
  colaboradorId: string;
  nivel: NivelDoMister;
  telefone: string;
  wamid: string | null;
  pergunta: string;
  tentativas: number;
  /** Há quantos segundos a pergunta chegou. */
  esperaS: number;
  /** MIS-H-04: o carimbo da pega (com os microssegundos) — o "dono" desta execução; o fim só grava com ele. */
  pegaEm?: string | null;
}

export interface Trilha {
  modelo?: string | null;
  chamadas?: number;
  tokensEntrada?: number;
  tokensSaida?: number;
  /** O nome, o tempo, se deu certo e o que foi PEDIDO (período, loja, ordem) — nunca o que a ferramenta trouxe. */
  ferramentas?: { nome: string; ms: number; ok: boolean; entrada?: Record<string, string | number> }[];
  conferencia?: NotaDaSaida[];
}

const COLUNAS = sql`q.id, q.tenant_id as "tenantId", q.colaborador_id as "colaboradorId", q.nivel, q.telefone, q.wamid, q.pergunta, q.tentativas,
                    extract(epoch from (now() - q.criado_em))::int as "esperaS", q.pega_em::text as "pegaEm"`;
/**
 * Rodada 7, MIS-H-03 (ERR-660): quantas perguntas uma pessoa pode ter esperando (na fila ou sendo respondidas) — a rajada
 * passava inteira para a fila e para uma pega só (um `concluir` com dezenas de milhares de ids estourava o banco).
 */
export const PENDENTES_POR_PESSOA = 20;

@Injectable()
export class MisterFilaService {
  private readonly logger = new Logger(MisterFilaService.name);
  private acordador: (() => void) | null = null;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** O agente se apresenta: é ele que a fila acorda quando chega pergunta. */
  registrar(acordador: () => void): void {
    this.acordador = acordador;
  }

  /** Acorda o agente. Nunca lança e não espera (V3): a entrada do WhatsApp segue. */
  acordar(): void {
    try {
      this.acordador?.();
    } catch (e: any) {
      this.logger.warn(`o agente do Mister não acordou: ${e?.message ?? e}`);
    }
  }

  /** Põe a pergunta na fila. Devolve `false` quando a mesma mensagem já tinha entrado. */
  async enfileirar(dono: DonoDaPergunta, texto: string, chave: string | null, wamid: string | null): Promise<boolean> {
    const pergunta = String(texto ?? '').trim().slice(0, tetoDaPergunta(texto));
    // MIS-H-03: o teto de pendências da pessoa conferido na MESMA instrução que insere (V98).
    const novas = linhas(
      await this.db.execute(sql`
        insert into mister_pergunta (tenant_id, colaborador_id, unidade_id, nivel, telefone, chave, wamid, pergunta)
        select ${dono.tenantId}::uuid, ${dono.colaboradorId}::uuid, ${dono.unidadeId}::uuid, ${dono.nivel}, ${dono.telefone},
               ${chave || randomUUID()}, ${wamid}, ${pergunta}
         where (select count(*) from mister_pergunta p
                 where p.tenant_id = ${dono.tenantId}::uuid and p.colaborador_id = ${dono.colaboradorId}::uuid
                   and p.situacao in ('na_fila', 'respondendo')) < ${PENDENTES_POR_PESSOA}
        on conflict (chave) do nothing
        returning id`),
    );
    if (novas.length) this.acordar();
    return novas.length > 0;
  }

  /**
   * Pega a próxima conversa que espera: TODAS as perguntas dela que estão na fila, da mais antiga para a mais nova — ou
   * null se não há o que pegar. A conversa que já está sendo respondida não entra.
   */
  async pegar(): Promise<PerguntaNaFila[] | null> {
    // ERR-647 (rodada 7, MIS-A-02): a pega junta as perguntas da PESSOA — a de um telefone que já não é o dela (trocou de celular,
    // desligou, ligou de novo) não pode ir no lote do telefone de agora. Sai como "sem acesso" antes de pegar.
    await this.db.execute(sql`
      update mister_pergunta q
         set situacao = 'falhou', motivo = 'sem_acesso', respondida_em = now(), atualizado_em = now()
       where q.situacao = 'na_fila'
         and not exists (
               select 1 from mister_vinculo v
                where v.tenant_id = q.tenant_id and v.colaborador_id = q.colaborador_id
                  and v.telefone = q.telefone and v.ligado_em is not null and q.criado_em >= v.ligado_em)`);
    const pegas = linhas(
      await this.db.execute(sql`
        with conversa as (
          select v.tenant_id, v.colaborador_id
            from mister_vinculo v
            join lateral (
              select min(p.criado_em) as desde
                from mister_pergunta p
               where p.tenant_id = v.tenant_id and p.colaborador_id = v.colaborador_id and p.situacao = 'na_fila'
            ) fila on fila.desde is not null
           where not exists (
                   select 1 from mister_pergunta r
                    where r.tenant_id = v.tenant_id and r.colaborador_id = v.colaborador_id and r.situacao = 'respondendo')
           order by fila.desde
           limit 1
           for update of v skip locked
        )
        update mister_pergunta q
           set situacao = 'respondendo', pega_em = now(), tentativas = q.tentativas + 1, atualizado_em = now()
          from conversa
         where q.tenant_id = conversa.tenant_id and q.colaborador_id = conversa.colaborador_id and q.situacao = 'na_fila'
           -- MIS-H-03: no máximo PENDENTES_POR_PESSOA por pega (as mais antigas); o resto espera a próxima.
           and q.id in (select p.id from mister_pergunta p
                         where p.tenant_id = conversa.tenant_id and p.colaborador_id = conversa.colaborador_id and p.situacao = 'na_fila'
                         order by p.criado_em, p.id limit ${PENDENTES_POR_PESSOA})
        returning ${COLUNAS}, q.criado_em as "criadoEm"`),
    ) as (PerguntaNaFila & { criadoEm: unknown })[];
    if (!pegas.length) return null;
    return pegas
      .sort((a, b) => new Date(a.criadoEm as any).getTime() - new Date(b.criadoEm as any).getTime())
      .map(({ criadoEm: _fora, ...p }) => ({ ...p, pergunta: String(p.pergunta ?? ''), tentativas: Number(p.tentativas) || 0, esperaS: Number(p.esperaS) || 0 }));
  }

  /** Fecha as perguntas de uma pega: respondidas (a resposta fica na última) ou sem resposta (com o motivo). */
  async concluir(
    ids: string[],
    fim: { resposta?: string | null; motivo?: MotivoSemResposta | null; trilha?: Trilha; perguntaJunta?: string; pegaEm?: string | null },
  ): Promise<void> {
    if (!ids.length) return;
    // MIS-H-04: com o carimbo da pega, só a execução DONA fecha as linhas (a vencida que outra pegou não fecha as da nova).
    const pega = fim.pegaEm ?? null;
    const respondida = !fim.motivo;
    const t = fim.trilha ?? {};
    const ultima = ids[ids.length - 1];
    // Várias mensagens respondidas juntas: a última linha fica com a pergunta inteira (é ela que a memória lê).
    const junta = ids.length > 1 && fim.perguntaJunta ? fim.perguntaJunta : null;
    await this.db.execute(sql`
      update mister_pergunta
         set situacao = ${respondida ? 'respondida' : 'falhou'},
             motivo = ${fim.motivo ?? null},
             pergunta = case when id = ${ultima}::uuid and ${junta}::text is not null then ${junta}::text else pergunta end,
             resposta = case when id = ${ultima}::uuid then ${fim.resposta ?? null} else null end,
             respondida_em = now(),
             modelo = ${t.modelo ?? null},
             chamadas = case when id = ${ultima}::uuid then ${Math.min(32767, t.chamadas ?? 0)} else 0 end,
             tokens_entrada = case when id = ${ultima}::uuid then ${t.tokensEntrada ?? 0} else 0 end,
             tokens_saida = case when id = ${ultima}::uuid then ${t.tokensSaida ?? 0} else 0 end,
             ferramentas = case when id = ${ultima}::uuid then ${JSON.stringify(t.ferramentas ?? [])}::jsonb else '[]'::jsonb end,
             conferencia = case when id = ${ultima}::uuid then ${JSON.stringify(t.conferencia ?? [])}::jsonb else '[]'::jsonb end,
             atualizado_em = now()
       where id in (${sql.join(
         ids.map((i) => sql`${i}::uuid`),
         sql`, `,
       )}) and situacao = 'respondendo' and (${pega}::timestamptz is null or pega_em = ${pega}::timestamptz)`);
  }

  /**
   * MIS-H-04: a pega ainda é desta execução? Confere (e marca o sinal de vida) ANTES de enviar: a execução que passou do prazo
   * e foi devolvida à fila — e pega de novo por outra — não manda a resposta em dobro nem repete as ações.
   */
  async aindaEDaPega(ids: string[], pegaEm: string | null | undefined): Promise<boolean> {
    if (!ids.length || !pegaEm) return true;
    const minhas = linhas(
      await this.db.execute(sql`
        update mister_pergunta set atualizado_em = now()
         where id in (${sql.join(
           ids.map((i) => sql`${i}::uuid`),
           sql`, `,
         )}) and situacao = 'respondendo' and pega_em = ${pegaEm}::timestamptz
        returning id`),
    );
    return minhas.length === ids.length;
  }

  /**
   * As pegas que venceram (o processo caiu no meio da resposta): quem ainda tem tentativa volta para a fila; quem não
   * tem é encerrado como interrompido e devolvido — quem chama avisa a pessoa.
   */
  async devolverVencidas(): Promise<PerguntaNaFila[]> {
    await this.db.execute(sql`
      update mister_pergunta
         set situacao = 'na_fila', pega_em = null, atualizado_em = now()
       where situacao = 'respondendo' and pega_em < now() - make_interval(secs => ${TETOS.pegaValeS}) and tentativas < ${TETOS.tentativas}`);
    const fora = linhas(
      await this.db.execute(sql`
        update mister_pergunta q
           set situacao = 'falhou', motivo = 'interrompida', respondida_em = now(), atualizado_em = now()
         where q.situacao = 'respondendo' and q.pega_em < now() - make_interval(secs => ${TETOS.pegaValeS}) and q.tentativas >= ${TETOS.tentativas}
        returning ${COLUNAS}`),
    ) as PerguntaNaFila[];
    return fora;
  }

  /**
   * Rodada 7, MIS-H-06 (ERR-660): a frase do teto quando a foto/documento/áudio NÃO deve ser lido — o teto de perguntas da
   * pessoa ou da empresa, ou o de leituras de mídia da empresa no dia (pelo medidor `ia_uso_dia`) — ou null (pode ler).
   */
  async limiteDeMidia(tenantId: string, colaboradorId: string): Promise<string | null> {
    const uso = await this.usoEm24h(tenantId, colaboradorId);
    if (uso.pessoa >= TETOS.porPessoaEm24h) return TEXTOS_DO_AGENTE.limite(TETOS.porPessoaEm24h);
    if (uso.empresa >= TETOS.porEmpresaEm24h) return TEXTOS_DO_AGENTE.limiteDaEmpresa;
    let leituras = 0;
    try {
      const [l] = linhas(
        await this.db.execute(sql`
          select coalesce(sum(chamadas), 0)::int as n from ia_uso_dia
           where tenant_id = ${tenantId}::uuid and dia = ${hojeISO()}::date and recurso in (${sql.join(
             RECURSOS_DE_MIDIA.map((r) => sql`${r}`),
             sql`, `,
           )})`),
      );
      leituras = Number(l?.n) || 0;
    } catch {
      /* sem o medidor (banco sem a 415): o teto das perguntas segue valendo */
    }
    return leituras >= TETOS.leiturasDeMidiaPorEmpresaNoDia ? TEXTOS_DO_AGENTE.limiteDeMidia : null;
  }

  /** Quantas perguntas a pessoa e a empresa já tiveram RESPONDIDAS pela IA nas últimas 24 horas. */
  async usoEm24h(tenantId: string, colaboradorId: string): Promise<{ pessoa: number; empresa: number }> {
    const [l] = linhas(
      await this.db.execute(sql`
        select count(*) filter (where colaborador_id = ${colaboradorId}::uuid)::int as pessoa, count(*)::int as empresa
          from mister_pergunta
         where tenant_id = ${tenantId}::uuid and criado_em > now() - interval '24 hours'
           -- MIS-H-02 (ERR-660): a execução interrompida (o processo caiu no meio) também gastou IA — conta no teto.
           and (chamadas > 0 or motivo = 'interrompida')`),
    );
    return { pessoa: Number(l?.pessoa) || 0, empresa: Number(l?.empresa) || 0 };
  }

  /**
   * A memória da conversa: as últimas perguntas respondidas (com o texto ainda guardado), da mais antiga para a mais
   * nova, cada uma com a hora da resposta e as consultas feitas para ela.
   */
  async memoria(tenantId: string, colaboradorId: string): Promise<TrocaDaMemoria[]> {
    const lidas = linhas(
      await this.db.execute(sql`
        select pergunta, resposta, ferramentas,
               to_char(coalesce(respondida_em, criado_em) at time zone ${FUSO_SQL}, 'HH24:MI') as hora
          from mister_pergunta
         where tenant_id = ${tenantId}::uuid and colaborador_id = ${colaboradorId}::uuid and situacao = 'respondida'
           and pergunta is not null and resposta is not null
           and criado_em > now() - make_interval(mins => ${TETOS.memoriaMin})
           -- ERR-647: a memória é da ligação de AGORA — o celular ligado de novo não vê as respostas do anterior.
           and criado_em >= coalesce((select ligado_em from mister_vinculo where tenant_id = ${tenantId}::uuid and colaborador_id = ${colaboradorId}::uuid), 'infinity'::timestamptz)
         order by criado_em desc
         limit ${TETOS.memoria}`),
    );
    // Com a hora e as consultas que deram certo: é o que diz ao modelo que a resposta antiga saiu de dado lido na hora.
    return lidas.reverse().map((l) => ({
      pergunta: String(l.pergunta),
      resposta: String(l.resposta),
      hora: String(l.hora ?? ''),
      consultas: (Array.isArray(l.ferramentas) ? l.ferramentas : []).filter((f: any) => f?.ok === true).map((f: any) => String(f?.nome ?? '')),
    }));
  }

  /** ERR-588: os documentos e as listas desta pessoa nas últimas horas, que não passam pela fila de perguntas. */
  andamento(tenantId: string, colaboradorId: string) {
    return lerAndamento(this.db, tenantId, colaboradorId);
  }

  /**
   * A limpeza diária: o texto com mais de 30 dias sai; a linha com mais de 90 também. Devolve quantas linhas mudaram.
   * Com o texto saem as PALAVRAS da pessoa que a trilha guardou no pedido às consultas (`busca` do estoque, `assunto` do
   * guia de uso — até 40 letras); o resto do pedido (período, loja, tema da lista fechada) fica até a linha sair.
   */
  async limpar(): Promise<number> {
    const trilha = sql`case when jsonb_typeof(ferramentas) = 'array' then ferramentas else '[]'::jsonb end`;
    const semTexto = linhas(
      await this.db.execute(sql`
        update mister_pergunta
           set pergunta = null, resposta = null,
               ferramentas = (select coalesce(jsonb_agg(case when jsonb_typeof(f -> 'entrada') = 'object' then jsonb_set(f, '{entrada}', (f -> 'entrada') - ${PALAVRAS_DA_PESSOA[0]}::text - ${PALAVRAS_DA_PESSOA[1]}::text) else f end order by o), '[]'::jsonb)
                                from jsonb_array_elements(${trilha}) with ordinality as e(f, o)),
               atualizado_em = now()
         where criado_em < now() - interval '30 days'
           and (pergunta is not null or resposta is not null
                or exists (select 1 from jsonb_array_elements(${trilha}) f
                            where jsonb_typeof(f -> 'entrada') = 'object' and (f -> 'entrada') ?| array[${PALAVRAS_DA_PESSOA[0]}::text, ${PALAVRAS_DA_PESSOA[1]}::text]))
        returning id`),
    );
    const fora = linhas(await this.db.execute(sql`delete from mister_pergunta where criado_em < now() - interval '90 days' returning id`));
    return semTexto.length + fora.length;
  }
}
