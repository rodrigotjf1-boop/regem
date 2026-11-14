import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { FUSO_SQL } from '../../common/fuso-sql';
import { MotivoSemResposta, NivelDoMister, NotaDaSaida, TETOS, TrocaDaMemoria } from './mister-agente.regras';

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
                    extract(epoch from (now() - q.criado_em))::int as "esperaS"`;

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
    const pergunta = String(texto ?? '').trim().slice(0, TETOS.pergunta);
    const novas = linhas(
      await this.db.execute(sql`
        insert into mister_pergunta (tenant_id, colaborador_id, unidade_id, nivel, telefone, chave, wamid, pergunta)
        values (${dono.tenantId}::uuid, ${dono.colaboradorId}::uuid, ${dono.unidadeId}::uuid, ${dono.nivel}, ${dono.telefone},
                ${chave || randomUUID()}, ${wamid}, ${pergunta})
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
        returning ${COLUNAS}, q.criado_em as "criadoEm"`),
    ) as (PerguntaNaFila & { criadoEm: unknown })[];
    if (!pegas.length) return null;
    return pegas
      .sort((a, b) => new Date(a.criadoEm as any).getTime() - new Date(b.criadoEm as any).getTime())
      .map(({ criadoEm: _fora, ...p }) => ({ ...p, pergunta: String(p.pergunta ?? ''), tentativas: Number(p.tentativas) || 0, esperaS: Number(p.esperaS) || 0 }));
  }

  /** Fecha as perguntas de uma pega: respondidas (a resposta fica na última) ou sem resposta (com o motivo). */
  async concluir(ids: string[], fim: { resposta?: string | null; motivo?: MotivoSemResposta | null; trilha?: Trilha; perguntaJunta?: string }): Promise<void> {
    if (!ids.length) return;
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
       )}) and situacao = 'respondendo'`);
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

  /** Quantas perguntas a pessoa e a empresa já tiveram RESPONDIDAS pela IA nas últimas 24 horas. */
  async usoEm24h(tenantId: string, colaboradorId: string): Promise<{ pessoa: number; empresa: number }> {
    const [l] = linhas(
      await this.db.execute(sql`
        select count(*) filter (where colaborador_id = ${colaboradorId}::uuid)::int as pessoa, count(*)::int as empresa
          from mister_pergunta
         where tenant_id = ${tenantId}::uuid and criado_em > now() - interval '24 hours' and chamadas > 0`),
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

  /** A limpeza diária: o texto com mais de 30 dias sai; a linha com mais de 90 também. Devolve quantas linhas mudaram. */
  async limpar(): Promise<number> {
    const semTexto = linhas(
      await this.db.execute(sql`
        update mister_pergunta set pergunta = null, resposta = null, atualizado_em = now()
         where criado_em < now() - interval '30 days' and (pergunta is not null or resposta is not null)
        returning id`),
    );
    const fora = linhas(await this.db.execute(sql`delete from mister_pergunta where criado_em < now() - interval '90 days' returning id`));
    return semTexto.length + fora.length;
  }
}
