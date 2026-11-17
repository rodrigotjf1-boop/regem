import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { ehServidorLocal } from '../../common/modo';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * EMPRESA INATIVA HÁ 2 MESES É DESLIGADA — a loja e as integrações (decisão do dono, 16/11/2026: "caso conclua 2 meses
 * inativo, desligar loja e integrações por inatividade").
 *
 * De onde veio: uma empresa sem ninguém usando o Regem havia 89 dias (teste vencido, sem assinatura, sem aparelho, sem
 * servidor) seguia com a integração de um canal ligada. A rotina do canal trazia os pedidos, ninguém aceitava, e 617
 * ficaram em "novo" — eram eles que tomavam o lote do aceite dos outros (ERR-493).
 *
 * NASCE DESLIGADA: só age com `DESLIGAR_INATIVAS=1` na nuvem (o dono liga). Sem a variável, não lê nem grava nada.
 *
 * QUEM é inativa — NENHUM destes sinais há `DIAS_DE_INATIVIDADE` dias (e a empresa existe há mais tempo que isso):
 *  · ação de uma PESSOA na auditoria da empresa (o que a integração faz sozinha não conta);
 *  · batida do servidor da loja;
 *  · sinal ou uso de um aparelho (KDS, terminal de ponto, impressora, PDV);
 *  · venda criada ou mexida (o pedido de canal ACEITO vira venda; o que só chega e fica em "novo", não);
 *  · ação da distribuição sobre a empresa (liberar a licença, suporte, plano): quem a Regem acabou de religar ou está
 *    atendendo não é desligada de novo pela rotina.
 * Quem PAGA (assinatura ativa, em teste da assinatura ou em atraso) nunca é desligada por aqui, nem a própria Regem.
 *
 * O QUE faz, numa instrução só (ou tudo, ou nada — e uma segunda rotina ao mesmo tempo não repete):
 *  · a empresa passa a `bloqueado` — o MESMO estado do "Revogar" do console (o `LicenseInterceptor` corta a escrita e
 *    a sincronização), e volta pelo MESMO "Liberar";
 *  · as integrações ligadas dela passam a desligadas (`ativo = false`; credencial e configuração ficam como estão,
 *    para religar sem refazer a conexão) — as rotinas dos canais só olham as ligadas;
 *  · fica o registro na auditoria da distribuição (`desligou_por_inatividade`), com os dias, o último sinal e QUAIS
 *    integrações estavam ligadas — é o que o console mostra e o que se usa para religar.
 * Nada é apagado: pedidos, vendas e cadastros ficam onde estão.
 */
export const DIAS_DE_INATIVIDADE = 60;

/** Assinatura que vale como "paga" — a mesma lista do `LicencaService.statusConta`. */
const ASSINATURAS_VIVAS = ['active', 'trialing', 'past_due'] as const;

export interface EmpresaInativa {
  id: string;
  /** O sinal de uso mais recente; `null` = nunca houve. */
  ultimoSinal: string | null;
}
export interface EmpresaDesligada extends EmpresaInativa {
  /** Os canais das integrações que estavam ligadas e foram desligadas. */
  integracoes: string[];
}

@Injectable()
export class InatividadeProcessor {
  private readonly logger = new Logger('Inatividade');

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** A regra só existe na nuvem (as tabelas da distribuição e a batida do servidor são de lá) e só com a variável. */
  static ligada(): boolean {
    return !ehServidorLocal() && process.env.DESLIGAR_INATIVAS === '1';
  }

  /** `soEmpresas` restringe a busca (o teste roda num banco dividido com outros testes); vazio = nenhuma. */
  private criterio(dias: number, soEmpresas?: string[]) {
    const so = soEmpresas
      ? soEmpresas.length
        ? sql`and e.id in (${sql.join(soEmpresas.map((id) => sql`${id}::uuid`), sql`, `)})`
        : sql`and false`
      : sql``;
    const vivas = sql.join(ASSINATURAS_VIVAS.map((a) => sql`${a}`), sql`, `);
    // Cada sinal é o MAIOR instante por empresa, lido pelo índice que começa na empresa (auditoria: empresa + data;
    // venda: o do sync, empresa + mexida; batida: empresa + loja + data; aparelho: poucos por empresa). A auditoria da
    // distribuição não tem índice pela empresa: o corte pela data (que tem) vem antes.
    return sql`
      select e.id, u.ultimo
        from empresa e
       cross join lateral (
         select greatest(
           (select max(a.created_at) from audit_log a
             where a.tenant_id = e.id and a.actor_tipo in ('usuario', 'colaborador')),
           (select max(s.recebido_em) from edge_status s where s.tenant_id = e.id),
           (select max(greatest(q.ultimo_ping, q.ultimo_uso_em)) from equipamento q where q.tenant_id = e.id),
           (select max(c.updated_at) from comanda c where c.tenant_id = e.id),
           (select max(d.criado_em) from distribuicao_auditoria d
             where d.criado_em > now() - make_interval(days => ${dias}::int)
               and d.alvo = e.id::text and d.acao <> 'desligou_por_inatividade')
         ) as ultimo
       ) u
       where e.deleted_at is null
         and coalesce(e.is_distribuidor, false) = false
         and e.status = 'ativo'
         and coalesce(e.assinatura_status, '') not in (${vivas})
         and e.created_at < now() - make_interval(days => ${dias}::int)
         and (u.ultimo is null or u.ultimo < now() - make_interval(days => ${dias}::int))
         ${so}`;
  }

  /** Só LÊ: quem a regra desligaria agora. */
  async inativas(dias = DIAS_DE_INATIVIDADE, soEmpresas?: string[]): Promise<EmpresaInativa[]> {
    const r: any = await this.db.execute(sql`
      select i.id, i.ultimo as "ultimoSinal" from (${this.criterio(dias, soEmpresas)}) i order by i.id`);
    return ((r.rows ?? r) as any[]).map((l) => ({ id: l.id, ultimoSinal: instante(l.ultimoSinal) }));
  }

  /**
   * Desliga as inativas e devolve o que foi FEITO. A gravação é condicional (`status = 'ativo'`): a empresa que o console
   * acabou de bloquear ou liberar entre a leitura e a gravação não é tocada, e rodar de novo não faz nada.
   */
  async desligar(dias = DIAS_DE_INATIVIDADE, soEmpresas?: string[]): Promise<EmpresaDesligada[]> {
    const r: any = await this.db.execute(sql`
      with inativas as (${this.criterio(dias, soEmpresas)}),
      desligadas as (
        update empresa e
           set status = 'bloqueado', updated_at = now()
          from inativas i
         where e.id = i.id and e.status = 'ativo'
        returning e.id
      ),
      integracoes as (
        update integracao g
           set ativo = false, updated_at = now()
          from desligadas d
         where g.tenant_id = d.id and g.ativo = true
        returning g.tenant_id, g.canal
      ),
      feito as (
        select d.id, i.ultimo,
               coalesce((select jsonb_agg(distinct g.canal) from integracoes g where g.tenant_id = d.id), '[]'::jsonb) as canais
          from desligadas d
          join inativas i on i.id = d.id
      ),
      registro as (
        insert into distribuicao_auditoria (usuario_nome, perfil, acao, alvo, detalhe)
        select 'Regem (rotina)', 'sistema', 'desligou_por_inatividade', f.id::text,
               jsonb_build_object('dias', ${dias}::int, 'ultimoSinal', f.ultimo, 'integracoes', f.canais)
          from feito f
        returning alvo
      )
      select f.id, f.ultimo as "ultimoSinal", f.canais as integracoes
        from feito f
       order by f.id`);
    return ((r.rows ?? r) as any[]).map((l) => ({
      id: l.id,
      ultimoSinal: instante(l.ultimoSinal),
      integracoes: Array.isArray(l.integracoes) ? [...l.integracoes].sort() : [],
    }));
  }

  // ONDE RODA: só na NUVEM, e só com `DESLIGAR_INATIVAS=1` — as tabelas da distribuição e a batida do servidor da
  // loja são de lá; no servidor da loja a empresa é a dele e quem o bloqueia é a licença que desce da nuvem.
  @Cron('30 11 * * *') // uma vez por dia, de manhã (com o relógio em UTC ou em Brasília, a loja está fechada)
  async tick(): Promise<void> {
    if (!InatividadeProcessor.ligada()) return;
    try {
      const feitas = await this.desligar();
      for (const e of feitas) {
        this.logger.warn(
          `empresa ${e.id.slice(0, 8)} desligada por inatividade (${DIAS_DE_INATIVIDADE} dias; último sinal: ` +
            `${e.ultimoSinal ?? 'nenhum'}); integrações desligadas: ${e.integracoes.join(', ') || 'nenhuma'}`,
        );
      }
    } catch (e: any) {
      // V11: a falha fica no log com o motivo; a rotina de amanhã tenta de novo (nada ficou pela metade — uma instrução só).
      this.logger.error(`não desligou as inativas: ${e?.message ?? e}`);
    }
  }
}

function instante(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
