import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { Food99Service } from '../integracoes/food99/food99.service';
import { OrzuniPausaService } from '../orzuni/orzuni-pausa.service';
import {
  MOTIVOS_DA_PAUSA,
  descricaoNoIfood,
  ehPausaDoRegemNoIfood,
  pauseTimeDa99,
  recusaDa99,
  voltaDaPausa,
  type MotivoDaPausa,
} from '../../common/pausa-do-canal';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Uma linha de `pausa_canal` do iFood ou da 99, como a rotina lê. */
type Linha = {
  id: string;
  tenant_id: string;
  unidade_id: string | null;
  canal: 'ifood' | 'food99';
  ate: Date | null;
  motivo: string | null;
  motivo_texto: string | null;
  pausado_em: Date | null;
  externo_situacao: string | null;
  externo_id: string | null;
  externo_erro: string | null;
};

/**
 * O que a ida ao canal deixou: `situacao` nula = repetir (falha passageira, ou a pausa mudou no meio); `externoId`
 * ausente = não mexe na coluna; nulo = apaga.
 */
type Feito = { situacao: 'aplicada' | 'reaberta' | 'erro' | null; externoId?: string | null; erro: string | null };

/** Um canal de fora no "⏸ Pausar": se dá para pausar daqui e em que loja a pausa fica. */
export type CanalExterno = { disponivel: boolean; unidadeId: string | null; motivo: string | null };
export type CanaisExternos = { ifood: CanalExterno; food99: CanalExterno };

const LOTE = 20;
/** Depois de uma falha passageira, a próxima tentativa espera isto (a rotina roda a cada 15 s). */
const ESPERA_DEPOIS_DA_FALHA_S = 60;
/** O iFood pausa de 1 minuto a 7 dias: com menos que isto pela frente, não vale pedir. */
const MENOS_QUE_ISTO_NAO_PAUSA_MS = 70_000;
/** A 99 não tem id da pausa: a marca de que FOI o Regem que pausou lá (só então ele reabre). */
const MARCA_DA_99 = (pauseTime: number) => `pause_time:${pauseTime}`;

const isoOuNulo = (v: unknown): string | null => (v == null ? null : new Date(v as any).toISOString());

/**
 * A PAUSA NO iFOOD E NA 99 PELA API DE CADA UM (F5 da pausa por canal; protótipo `mockups/regem-pausa.html`). O gestor
 * pausa no painel (a linha de `pausa_canal`, nos dois sentidos do sync — a pausa feita no servidor da loja chega aqui pelo
 * sync); esta rotina da NUVEM (onde ficam as credenciais) leva cada mudança ao canal e anota o resultado na própria linha
 * (`externo_*`), que volta ao servidor da loja pelo sync. Quem já fez está na linha (V42): `externo_situacao` nula = a
 * fazer (pausar, estender e reabrir zeram); 'aplicada' = pausada no canal; 'reaberta' = nada mais a fazer; 'erro' = o canal
 * recusou de vez (a tela mostra o motivo; pausar de novo tenta outra vez).
 *
 *  • 99 direto (`setStatus`, doc 1949): `store_status` 3 com o `pause_time` mais perto do que falta e o código do motivo;
 *    reabrir = `store_status` 1, só se foi o Regem que pausou (a marca em `externo_id`) — nunca reabre o que a loja pausou
 *    no app da 99.
 *  • iFood pelo Orzuni (`interrupcao_criar`/`_remover`): a pausa velha sai antes da nova (estender = remover e criar); a
 *    `interrupcao_sobreposta` que é do Regem (descrição "(pelo Regem)") com o mesmo fim é adotada, com outro fim sai e entra
 *    a nova; a de fora do Regem não se toca (erro: "reabra no Gestor").
 *
 * A gravação do resultado é CONDICIONAL: se a pausa mudou enquanto a chamada saía (estendeu, reabriu), o id do canal fica
 * gravado e a situação volta a nula — a volta seguinte acerta. Só nuvem; uma volta por vez neste processo.
 */
@Injectable()
export class PausaNosCanaisService {
  private readonly log = new Logger('PausaNosCanais');
  private rodando = false;
  private deNovo = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() @Inject(forwardRef(() => Food99Service)) private readonly food99?: Food99Service,
    @Optional() private readonly orzuni?: OrzuniPausaService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  @Cron('*/15 * * * * *')
  rotina() {
    if (ehServidorLocal() || process.env.NODE_ENV === 'test') return;
    void this.acordar();
  }

  /** Leva ao canal agora (o painel da nuvem chama depois de pausar, estender ou reabrir). Nunca rejeita (V3). */
  async acordar(): Promise<void> {
    if (ehServidorLocal()) return;
    if (this.rodando) {
      this.deNovo = true;
      return;
    }
    this.rodando = true;
    try {
      for (let voltas = 0; voltas < 10; voltas++) {
        this.deNovo = false;
        const n = await this.processar();
        if (n < LOTE && !this.deNovo) break;
      }
    } catch (e: any) {
      this.log.error(`pausa no iFood e na 99: a volta falhou — ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Uma volta: as linhas que têm algo a fazer — a fazer (sem falha recente) ou pausadas no canal com o tempo acabado ou
   * reabertas no painel. `tenantIds` restringe às empresas dadas (testes: o CI divide o banco — V32). Devolve quantas viu.
   */
  async processar(o: { tenantIds?: string[]; agora?: Date } = {}): Promise<number> {
    if (ehServidorLocal()) return 0;
    const agora = o.agora ?? new Date();
    const escopo = o.tenantIds?.length ? sql`and p.tenant_id in (${sql.join(o.tenantIds.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;
    const r: any = await this.db.execute(sql`
      select p.id, p.tenant_id, p.unidade_id, p.canal, p.ate, p.motivo, p.motivo_texto, p.pausado_em,
             p.externo_situacao, p.externo_id, p.externo_erro
        from pausa_canal p
       where p.canal in ('ifood', 'food99') ${escopo}
         and ((p.externo_situacao is null
               and (p.externo_erro is null
                    or p.updated_at < ${agora.toISOString()}::timestamptz - make_interval(secs => ${ESPERA_DEPOIS_DA_FALHA_S})))
           or (p.externo_situacao = 'aplicada' and (p.ate is null or p.ate <= ${agora.toISOString()}::timestamptz)))
       order by p.updated_at
       limit ${LOTE}`);
    const linhas = (r.rows ?? r) as Linha[];
    for (const l of linhas) await this.reconciliar(l, agora);
    return linhas.length;
  }

  private async reconciliar(l: Linha, agora: Date): Promise<void> {
    const vigente = !!l.ate && new Date(l.ate).getTime() > agora.getTime();
    let f: Feito;
    try {
      f = l.canal === 'food99' ? await this.na99(l, vigente, agora) : await this.noIfood(l, vigente, agora);
    } catch (e: any) {
      this.log.error(`pausa ${l.id} (${l.canal}): ${e?.message ?? e}`);
      f = { situacao: null, erro: 'O Regem não conseguiu falar com o canal agora — tenta de novo.' };
    }
    try {
      await this.gravar(l, f);
    } catch (e: any) {
      this.log.error(`pausa ${l.id} (${l.canal}): o resultado não foi gravado — ${e?.message ?? e}`);
      return;
    }
    if (f.situacao === 'aplicada' || f.situacao === 'erro' || (f.situacao === 'reaberta' && l.externo_id))
      await this.auditar(l, f).catch((e: any) => this.log.warn(`auditoria da pausa ${l.id}: ${e?.message ?? e}`));
  }

  // ── 99 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async na99(l: Linha, vigente: boolean, agora: Date): Promise<Feito> {
    if (!this.food99) return { situacao: 'erro', erro: 'A 99 não está disponível nesta instalação.' };
    if (vigente) {
      const pauseTime = pauseTimeDa99(new Date(l.ate as Date), agora);
      const motivo = MOTIVOS_DA_PAUSA[l.motivo as MotivoDaPausa]?.codigo99 ?? MOTIVOS_DA_PAUSA.outro.codigo99;
      const r = await this.food99.situacaoDaLoja(l.tenant_id, { pausar: { pauseTime, motivo } });
      if (r.ok) return { situacao: 'aplicada', externoId: MARCA_DA_99(pauseTime), erro: null };
      const x = recusaDa99(r.errno, r.errmsg);
      return { situacao: x.repetir ? null : 'erro', erro: x.erro };
    }
    // Reabrir só o que o Regem pausou: sem a marca, a 99 nunca foi pausada por aqui (ou já reabriu).
    if (!l.externo_id) return { situacao: 'reaberta', erro: null };
    const r = await this.food99.situacaoDaLoja(l.tenant_id, { reabrir: true });
    if (r.ok) return { situacao: 'reaberta', externoId: null, erro: null };
    const x = recusaDa99(r.errno, r.errmsg);
    return { situacao: x.repetir ? null : 'erro', erro: x.erro };
  }

  // ── iFood (pelo Orzuni) ─────────────────────────────────────────────────────────────────────────────────────────

  private async noIfood(l: Linha, vigente: boolean, agora: Date): Promise<Feito> {
    if (!this.orzuni) return { situacao: 'erro', erro: 'O iFood pelo Orzuni não está disponível nesta instalação.' };
    if (!l.unidade_id) return { situacao: 'erro', erro: 'Escolha a loja no topo da tela para pausar o iFood dela.' };
    const u = l.unidade_id;
    // A pausa velha sai antes de tudo (reabrir, estender ou pausar de novo).
    let removeu = false;
    if (l.externo_id) {
      const rm = await this.orzuni.remover(l.tenant_id, u, l.externo_id);
      if (!rm.ok) return { situacao: rm.repetir ? null : 'erro', erro: rm.erro };
      removeu = true;
    }
    if (!vigente) return { situacao: 'reaberta', externoId: null, erro: null };
    const fim = new Date(l.ate as Date);
    if (fim.getTime() - agora.getTime() < MENOS_QUE_ISTO_NAO_PAUSA_MS)
      return { situacao: 'erro', ...(removeu ? { externoId: null } : {}), erro: 'Falta menos de um minuto: o iFood não pausa por tão pouco.' };
    const descricao = descricaoNoIfood(l.motivo, l.motivo_texto);
    const base = [l.id, isoOuNulo(l.pausado_em) ?? '', fim.toISOString()];
    let r = await this.orzuni.criar(l.tenant_id, u, { inicio: agora, fim, descricao, chave: base });
    if (!r.ok && r.sobreposta && ehPausaDoRegemNoIfood(r.sobreposta.descricao)) {
      const s = r.sobreposta;
      // A pausa é do Regem (uma criação cuja resposta se perdeu, ou uma pausa antiga): com o mesmo fim, vale ela.
      if (s.fim && Math.abs(Date.parse(s.fim) - fim.getTime()) < 90_000) return { situacao: 'aplicada', externoId: s.id, erro: null };
      const rm = await this.orzuni.remover(l.tenant_id, u, s.id);
      if (!rm.ok) return { situacao: rm.repetir ? null : 'erro', ...(removeu ? { externoId: null } : {}), erro: rm.erro };
      // Outra chave: o Orzuni devolveria a recusa guardada para a mesma chave e o mesmo pedido.
      r = await this.orzuni.criar(l.tenant_id, u, { inicio: agora, fim, descricao, chave: [...base, 'de-novo'] });
    }
    if (r.ok) return { situacao: 'aplicada', externoId: r.id, erro: null };
    if (r.sobreposta) {
      const ate = r.sobreposta.fim ? ` até ${voltaDaPausa(new Date(r.sobreposta.fim), agora).texto.replace(/^às /, '')}` : '';
      return {
        situacao: 'erro',
        ...(removeu ? { externoId: null } : {}),
        erro: `O iFood já tem uma pausa feita fora do Regem${ate} — reabra no Gestor de Pedidos e pause de novo.`,
      };
    }
    return { situacao: r.repetir ? null : 'erro', ...(removeu ? { externoId: null } : {}), erro: r.erro };
  }

  // ── o resultado na linha ────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Grava o que a ida ao canal deixou. O id do canal grava sempre (é um fato de lá); a situação só se a pausa ainda é a que
   * foi lida — mudou no meio (estendeu, reabriu, pausou de novo): fica nula e a volta seguinte acerta. Milissegundos: o
   * `ate` e o `pausado_em` vêm do relógio do serviço (ms), e o `pg` lê com ms.
   */
  private async gravar(l: Linha, f: Feito): Promise<void> {
    const id = f.externoId !== undefined ? sql`${f.externoId}` : sql`externo_id`;
    await this.db.execute(sql`
      update pausa_canal set
        externo_id = ${id},
        externo_erro = ${f.erro},
        externo_situacao = case
          when date_trunc('milliseconds', ate) is not distinct from ${isoOuNulo(l.ate)}::timestamptz
           and date_trunc('milliseconds', pausado_em) is not distinct from ${isoOuNulo(l.pausado_em)}::timestamptz
           and externo_situacao is not distinct from ${l.externo_situacao}
          then ${f.situacao} else null end
       where id = ${l.id}::uuid and tenant_id = ${l.tenant_id}::uuid`);
  }

  private async auditar(l: Linha, f: Feito) {
    if (!this.auditoria) return;
    await this.auditoria.registrar({
      tenantId: l.tenant_id,
      unidadeId: l.unidade_id,
      atorId: null,
      atorPerfil: 'sistema',
      tipo: 'delivery',
      acao: f.situacao === 'aplicada' ? 'pausou_no_canal' : f.situacao === 'reaberta' ? 'reabriu_no_canal' : 'canal_recusou_a_pausa',
      entidadeTipo: 'pausa_canal',
      entidadeId: l.id,
      origem: l.canal === 'ifood' ? 'orzuni' : '99food',
      detalhe: { canal: l.canal, ate: isoOuNulo(l.ate), erro: f.erro },
    });
  }

  // ── o que dá para pausar daqui ──────────────────────────────────────────────────────────────────────────────────

  /**
   * O iFood e a 99 no "⏸ Pausar" da loja em uso: dá para pausar quando a empresa tem o canal ligado PARA esta loja (a 99:
   * a integração ativa — da loja ou da empresa toda; o iFood: a ligação viva da loja com o Orzuni e o direito ligado). A
   * pausa fica na loja da integração. Só nuvem (o servidor da loja pergunta pela rota da loja — `canaisExternosDaLoja`).
   */
  /**
   * A rota da loja (`GET /delivery/pausas/canais/loja`): a empresa vem do TOKEN do servidor; a loja que a tela pediu só vale
   * se for desta empresa (V86 — a do cabeçalho é conferida); sem ela, a do token. A resposta leva a empresa, que o
   * servidor da loja confere.
   */
  async canaisExternosParaALoja(tenantId: string, unidadePedida: unknown, unidadeDoToken: string | null) {
    const pedida = typeof unidadePedida === 'string' && /^[0-9a-f-]{36}$/i.test(unidadePedida) ? unidadePedida : null;
    let unidade = unidadeDoToken;
    if (pedida) {
      const r: any = await this.db.execute(sql`
        select 1 from unidade where id = ${pedida}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null`);
      if ((r.rows ?? r).length) unidade = pedida;
    }
    return { tenantId, ...(await this.canaisExternos(tenantId, unidade)) };
  }

  async canaisExternos(tenantId: string, unidadeAtual: string | null): Promise<CanaisExternos> {
    const nao = (motivo: string | null): CanalExterno => ({ disponivel: false, unidadeId: null, motivo });
    let food99: CanalExterno = nao(null);
    const ig = await this.food99?.integracaoDoTenant(tenantId).catch(() => null);
    if (ig) {
      const daLoja = !unidadeAtual || !ig.unidadeId || ig.unidadeId === unidadeAtual;
      food99 = daLoja ? { disponivel: true, unidadeId: ig.unidadeId ?? null, motivo: null } : nao('A 99 desta empresa é de outra loja.');
    }
    let ifood: CanalExterno = nao(null);
    const lojas = (await this.orzuni?.lojasLigadas(tenantId).catch(() => [] as string[])) ?? [];
    if (unidadeAtual) ifood = lojas.includes(unidadeAtual) ? { disponivel: true, unidadeId: unidadeAtual, motivo: null } : nao(null);
    else if (lojas.length === 1) ifood = { disponivel: true, unidadeId: lojas[0], motivo: null };
    else if (lojas.length > 1) ifood = nao('Escolha a loja no topo da tela para pausar o iFood dela.');
    return { ifood, food99 };
  }
}
