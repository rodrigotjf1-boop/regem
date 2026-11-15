import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { hojeISO } from '../../common/data';
import { ehServidorLocal } from '../../common/modo';
import { buscarUrlPublica } from '../../common/ssrf-guard';
import { INTEGRACOES_EM_USO } from '../../common/integracoes-em-uso';
import { hojeNaUf, statusIbpt } from '../fiscal/ibpt/ibpt-tabela';
import { Achado, FONTES_VIGIADAS, FonteVigiada, achadosDaFonte, hashDoTrecho, linhasQueMudaram, trechoDaFonte } from './dependencias-fontes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A VIGILÂNCIA DAS DEPENDÊNCIAS (F3, parte 2; mig 423 `@cloud-only`). Só na nuvem, da distribuição.
//  • Todo dia às 06:07 lê as fontes oficiais (`dependencias-fontes.ts`), guarda o trecho vigiado (só a tabela) e o que
//    ele diz das versões e dos modelos em uso. Trecho diferente do guardado = "a conferir", com o antes e o depois, até
//    alguém decidir no console. Fonte que não responde = "não verificada desde" a última leitura certa — nunca "em dia".
//  • Nada se atualiza sozinho: a vigilância só mostra. A troca de versão segue o processo de sempre (PR, CI, merge).
//  • A busca passa pela guarda de endereço público (`buscarUrlPublica`, V68): só as URLs do código, sem redirecionar
//    para a rede interna.

export type SituacaoDaDependencia = 'a_conferir' | 'vencida' | 'nao_verificada' | 'em_dia' | 'manual' | 'nunca_lida';

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';
const DECISOES = ['conferida', 'nao_se_aplica'] as const;
const MAX_CORPO = 3_000_000;

export type RespostaDaFonte = { status: number; texto: string } | null;

@Injectable()
export class DependenciasService {
  private readonly logger = new Logger('Dependencias');

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** Lê uma fonte (os testes trocam). Nunca lança: falha de rede = null. */
  protected async buscar(url: string): Promise<RespostaDaFonte> {
    try {
      const r = await buscarUrlPublica(url, { headers: { 'user-agent': 'Regem-vigilancia-de-dependencias/1.0', accept: 'text/html,text/markdown,text/plain' }, signal: AbortSignal.timeout(20_000) });
      if (!r) return null;
      const texto = (await r.text()).slice(0, MAX_CORPO);
      return { status: r.status, texto };
    } catch {
      return null;
    }
  }

  @Cron('7 6 * * *') // 06:07 todo dia — SÓ na nuvem
  async vigiarTodoDia(): Promise<void> {
    if (ehServidorLocal()) return;
    try {
      await this.vigiar();
    } catch (e: any) {
      this.logger.warn(`a vigilância das dependências falhou: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }

  /** Lê as fontes e grava a leitura de cada uma. Devolve o que aconteceu com cada fonte. */
  async vigiar(fontes: FonteVigiada[] = FONTES_VIGIADAS): Promise<Array<{ fonte: string; leu: boolean; mudou: boolean; falha: string | null }>> {
    const hoje = hojeISO();
    const feito: Array<{ fonte: string; leu: boolean; mudou: boolean; falha: string | null }> = [];
    for (const f of fontes) {
      const r = await this.buscar(f.url);
      const trecho = r && r.status === 200 ? trechoDaFonte(f, r.texto) : null;
      if (!r || r.status !== 200 || !trecho) {
        const falha = !r ? 'a fonte não respondeu' : r.status !== 200 ? `a fonte respondeu ${r.status}` : 'a tabela não veio na página (o formato mudou?)';
        await this.db.execute(sql`
          insert into dependencia_leitura (fonte, lida_em, status_http, falha, atualizado_em)
          values (${f.id}, now(), ${r?.status ?? null}, ${falha}, now())
          on conflict (fonte) do update set lida_em = now(), status_http = excluded.status_http, falha = excluded.falha, atualizado_em = now()`);
        feito.push({ fonte: f.id, leu: false, mudou: false, falha });
        continue;
      }
      const hash = hashDoTrecho(trecho);
      const achados = achadosDaFonte(f, r.texto, hoje);
      // Trecho diferente do guardado: guarda o antigo como "antes", marca quando mudou e zera a decisão (a mudança nova
      // precisa de alguém olhar). A primeira leitura não é "mudança".
      const [g] = linhas(
        await this.db.execute(sql`
          insert into dependencia_leitura (fonte, lida_em, conferida_em, status_http, falha, trecho, hash, achados, atualizado_em)
          values (${f.id}, now(), now(), ${r.status}, null, ${trecho}, ${hash}, ${JSON.stringify(achados)}::jsonb, now())
          on conflict (fonte) do update set
            lida_em = now(), conferida_em = now(), status_http = excluded.status_http, falha = null,
            trecho_anterior = case when dependencia_leitura.hash is not null and dependencia_leitura.hash <> excluded.hash then dependencia_leitura.trecho else dependencia_leitura.trecho_anterior end,
            hash_anterior = case when dependencia_leitura.hash is not null and dependencia_leitura.hash <> excluded.hash then dependencia_leitura.hash else dependencia_leitura.hash_anterior end,
            mudou_em = case when dependencia_leitura.hash is not null and dependencia_leitura.hash <> excluded.hash then now() else dependencia_leitura.mudou_em end,
            decisao = case when dependencia_leitura.hash is not null and dependencia_leitura.hash <> excluded.hash then null else dependencia_leitura.decisao end,
            decidida_em = case when dependencia_leitura.hash is not null and dependencia_leitura.hash <> excluded.hash then null else dependencia_leitura.decidida_em end,
            decidida_por = case when dependencia_leitura.hash is not null and dependencia_leitura.hash <> excluded.hash then null else dependencia_leitura.decidida_por end,
            nota = case when dependencia_leitura.hash is not null and dependencia_leitura.hash <> excluded.hash then null else dependencia_leitura.nota end,
            trecho = excluded.trecho, hash = excluded.hash, achados = excluded.achados, atualizado_em = now()
          returning (mudou_em is not null and mudou_em = now()) as mudou`),
      );
      feito.push({ fonte: f.id, leu: true, mudou: g?.mudou === true, falha: null });
    }
    return feito;
  }

  /** A lista do console: cada integração do inventário, com a situação dela, e a tabela do IBPT por estado. */
  async lista() {
    let leituras: any[] = [];
    let semMigration = false;
    try {
      leituras = linhas(
        await this.db.execute(sql`
          select fonte, lida_em as "lidaEm", conferida_em as "conferidaEm", status_http as "statusHttp", falha, trecho, trecho_anterior as "trechoAnterior",
                 mudou_em as "mudouEm", achados, decisao, decidida_em as "decididaEm", decidida_por as "decididaPor", nota
            from dependencia_leitura`),
      );
    } catch (e: any) {
      if (!semTabela(e)) throw e;
      semMigration = true;
    }
    const daFonte = new Map(leituras.map((l) => [String(l.fonte), l]));
    const itens = INTEGRACOES_EM_USO.map((i) => {
      const fonte = FONTES_VIGIADAS.find((f) => f.integracoes.includes(i.id)) ?? null;
      const l = fonte ? daFonte.get(fonte.id) : null;
      const achados = ((l?.achados ?? []) as Achado[]).filter((a) => a.integracao === i.id);
      const falhouDepois = !!l?.lidaEm && (!l?.conferidaEm || new Date(l.lidaEm).getTime() > new Date(l.conferidaEm).getTime());
      const mudancaAberta = !!l?.mudouEm && !l?.decisao;
      const situacao: SituacaoDaDependencia = !fonte
        ? 'manual'
        : !l?.conferidaEm
          ? l?.falha
            ? 'nao_verificada'
            : 'nunca_lida'
          : falhouDepois
            ? 'nao_verificada'
            : achados.some((a) => a.situacao === 'vencendo')
              ? 'vencida'
              : mudancaAberta || achados.some((a) => a.situacao === 'a_conferir')
                ? 'a_conferir'
                : 'em_dia';
      return {
        id: i.id,
        nome: i.nome,
        tipo: i.tipo,
        usamos: i.usamos,
        versao: i.versao ?? null,
        modelos: i.modelos ?? null,
        situacao,
        achados,
        fonte: fonte ? { id: fonte.id, nome: fonte.nome, url: fonte.url } : null,
        conferidaEm: l?.conferidaEm ?? null,
        lidaEm: l?.lidaEm ?? null,
        falha: falhouDepois ? (l?.falha ?? null) : null,
        mudanca: l?.mudouEm ? { mudouEm: l.mudouEm, ...linhasQueMudaram(l.trechoAnterior ?? null, l.trecho ?? null) } : null,
        decisao: l?.decisao ? { decisao: String(l.decisao), em: l.decididaEm, por: l.decididaPor ?? null, nota: l.nota ?? null } : null,
      };
    });
    // A tabela do IBPT (já vigiada pela distribuição): uma linha por estado com loja fiscal.
    const ibpt = (await statusIbpt(this.db, hojeNaUf(null))).filter((s) => s.lojas > 0);
    const ruins = ibpt.filter((s) => s.situacao !== 'ok');
    itens.push({
      id: 'ibpt',
      nome: 'IBPT · tabela por estado',
      tipo: 'fiscal',
      usamos: 'o valor aproximado dos tributos na NFC-e (Lei 12.741)',
      versao: null,
      modelos: null,
      // "vencida" aqui é a situação "vencidas ou vencendo" da tela: vencida, sem tabela ou vencendo sem a próxima.
      situacao: ruins.length ? 'vencida' : 'em_dia',
      achados: ibpt.map((s) => ({
        integracao: 'ibpt',
        usamos: s.uf,
        situacao: s.situacao === 'ok' ? 'em_dia' : 'vencendo',
        texto:
          s.situacao === 'vencida'
            ? `${s.uf}: vencida — envie a nova em Atualizações.`
            : s.situacao === 'sem_tabela'
              ? `${s.uf}: sem tabela — envie em Atualizações.`
              : s.situacao === 'vence_logo'
                ? `${s.uf}: vence em ${s.diasParaVencer} dias e a próxima não foi enviada.`
                : `${s.uf}: em dia até ${String(s.vigente?.vigenciaFim ?? '').split('-').reverse().join('/')}.`,
        data: s.vigente?.vigenciaFim ?? null,
      })) as Achado[],
      fonte: null,
      conferidaEm: null,
      lidaEm: null,
      falha: null,
      mudanca: null,
      decisao: null,
    });
    return { semMigration, itens };
  }

  /** A decisão sobre a mudança vista numa fonte ("conferida" ou "não se aplica"), com a nota. */
  async decidir(fonteId: unknown, decisaoBruta: unknown, notaBruta: unknown, por: string | null) {
    const fonte = FONTES_VIGIADAS.find((f) => f.id === fonteId);
    if (!fonte) throw new BadRequestException('Fonte desconhecida.');
    const decisao = DECISOES.find((d) => d === decisaoBruta);
    if (!decisao) throw new BadRequestException('Decisão inválida: use "conferida" ou "nao_se_aplica".');
    const nota = typeof notaBruta === 'string' ? notaBruta.trim().slice(0, 300) : '';
    if (decisao === 'nao_se_aplica' && !nota) throw new BadRequestException('Diga por que não se aplica ao Regem.');
    const [r] = linhas(
      await this.db.execute(sql`
        update dependencia_leitura set decisao = ${decisao}, decidida_em = now(), decidida_por = ${por}, nota = ${nota || null}, atualizado_em = now()
         where fonte = ${fonte.id} and conferida_em is not null
        returning fonte`),
    );
    if (!r) throw new BadRequestException('Esta fonte ainda não foi lida.');
    return { ok: true, fonte: fonte.id, decisao };
  }
}
