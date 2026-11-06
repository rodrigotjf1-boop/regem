import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { ifoodPeloOrzuniLigado } from '../../common/ifood-pelo-orzuni';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { registroDoGogem, tokenDoGogem } from '../gogem/credencial-gogem';
import { GogemPublishService } from '../gogem/gogem-publish.service';
import { lerConfigOrzuni } from '../orzuni/orzuni.regras';
import {
  ESCOPOS_DO_CARDAPIO,
  type FilaIfood,
  type LeitorDaPorta,
  type LinhaIntegracao,
  linhaDoGogem,
  linhaDoGogemPublicado,
  linhaDoIfood,
  linhaDoLeitor,
  linhaNaoLida,
  ordenarLinhas,
  podePublicar,
  type ProblemaIfood,
  resumoDoPublicar,
  type SituacaoIntegracoes,
} from './publicar-integracoes.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ResultadoPublicar = SituacaoIntegracoes & { resumo: string };
export type Ator = { id: string | null; perfil: string; nome?: string | null };

const linhas = (r: any): any[] => (r?.rows ?? r) as any[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Publicar nas integrações" (Cadastros › Cardápio). A situação e o envio moram na NUVEM — a fila do iFood, os
 * registros de aviso e a credencial do GoGeM só existem lá (ERR-108) —; o servidor da loja pede à nuvem com o token
 * de sync dele (V37) e diz "sem conexão" quando não alcança. A loja é a loja em uso (`@UnidadeAtual()`); sem loja
 * ("todas", ou a empresa de loja única), vale a empresa toda.
 */
@Injectable()
export class PublicarIntegracoesService {
  private readonly log = new Logger(PublicarIntegracoesService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly gogem: GogemPublishService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ── Portas da tela ──────────────────────────────────────────────────────────────────

  async situacaoDaTela(tenantId: string, unidadeId: string | null): Promise<SituacaoIntegracoes> {
    if (ehServidorLocal()) return this.pelaNuvem<SituacaoIntegracoes>(tenantId, unidadeId, 'GET');
    return this.situacao(tenantId, unidadeId);
  }

  async publicarDaTela(tenantId: string, unidadeId: string | null, ator: Ator): Promise<ResultadoPublicar> {
    const r = ehServidorLocal()
      ? await this.pelaNuvem<ResultadoPublicar>(tenantId, unidadeId, 'POST')
      : await this.publicar(tenantId, unidadeId);
    if (r.semConexao)
      throw new ServiceUnavailableException('Sem conexão com a nuvem agora: publique de novo quando a internet voltar.');
    // A auditoria fica onde a pessoa clicou (no servidor da loja, sobe pelo sincronismo).
    await this.auditoria.registrar({
      tenantId,
      unidadeId,
      atorId: ator.id,
      atorPerfil: ator.perfil,
      tipo: 'integracao',
      acao: 'publicou_nas_integracoes',
      entidadeTipo: 'cardapio',
      entidadeId: null,
      detalhe: { resultados: r.linhas.map((l) => ({ integracao: l.chave, tom: l.tom })) },
    });
    return r;
  }

  // ── Na nuvem ────────────────────────────────────────────────────────────────────────

  /**
   * As três fontes, cada uma por si: a que falha vira uma linha "não deu para ler" (com o motivo no log) e as outras
   * seguem — a tela separa "não tem" de "não li" (V37).
   */
  private async fontes(tenantId: string, unidadeId: string | null) {
    const seguro = async <T>(nome: string, p: Promise<T>): Promise<T | 'erro'> => {
      try {
        return await p;
      } catch (e: any) {
        this.log.warn(`publicar nas integrações — ${nome} não lido (empresa ${tenantId}): ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
        return 'erro';
      }
    };
    const [ifood, gogem, leitores] = await Promise.all([
      seguro('iFood', this.filaDoIfood(tenantId, unidadeId)),
      seguro('GoGeM', this.gogemLigado(tenantId, unidadeId)),
      seguro('porta', this.leitoresDaPorta(tenantId, unidadeId)),
    ]);
    const ls: LinhaIntegracao[] = [];
    if (ifood === 'erro') ls.push(linhaNaoLida('ifood', 'iFood'));
    else if (ifood) ls.push(linhaDoIfood(ifood));
    if (gogem === 'erro') ls.push(linhaNaoLida('gogem-erro', 'GoGeM (totem)'));
    if (leitores === 'erro') ls.push(linhaNaoLida('porta-erro', 'Integrações pela porta'));
    return { ls, gogemLigado: gogem === true, leitores: leitores === 'erro' ? [] : leitores };
  }

  /** O que cada integração que usa o cardápio recebe, nesta loja. Só leitura. */
  async situacao(tenantId: string, unidadeId: string | null): Promise<SituacaoIntegracoes> {
    const { ls, gogemLigado, leitores } = await this.fontes(tenantId, unidadeId);
    if (gogemLigado) ls.push(linhaDoGogem());
    for (const l of leitores) ls.push(linhaDoLeitor(l));
    return { linhas: ordenarLinhas(ls), podePublicar: podePublicar(ls, leitores), semConexao: false };
  }

  /**
   * Publica: o GoGeM na hora, e quem lê pela porta recebe o pedido de ler de novo (a MESMA fila dos gatilhos da 316 —
   * o job carimba e avisa, respeitando o intervalo de 1 minuto). O iFood não muda: já vai sozinho.
   */
  async publicar(tenantId: string, unidadeId: string | null): Promise<ResultadoPublicar> {
    const { ls, gogemLigado, leitores } = await this.fontes(tenantId, unidadeId);

    if (gogemLigado) {
      try {
        ls.push(linhaDoGogemPublicado(await this.gogem.publicar(tenantId, unidadeId)));
      } catch (e: any) {
        // O serviço do GoGeM já diz o motivo em palavras (e loga a causa de rede — ERR-239).
        const msg = e instanceof BadRequestException ? String((e.getResponse() as any)?.message ?? e.message) : 'Não foi possível publicar no GoGeM agora.';
        if (!(e instanceof BadRequestException)) this.log.warn(`publicar no GoGeM (empresa ${tenantId}): ${e?.message ?? e}`);
        ls.push(linhaDoGogemPublicado({ erro: msg }));
      }
    }

    const comAviso = leitores.filter((l) => l.comAviso);
    let pedido = false;
    if (comAviso.length) {
      try {
        await this.pedirLeituraDeNovo(tenantId, unidadeId);
        pedido = true;
      } catch (e: any) {
        this.log.warn(`pedido de leitura do cardápio (empresa ${tenantId}): ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
      }
    }
    for (const l of leitores) ls.push(linhaDoLeitor(l, pedido && l.comAviso));

    const ordenadas = ordenarLinhas(ls);
    return { linhas: ordenadas, podePublicar: podePublicar(ordenadas, leitores), semConexao: false, resumo: resumoDoPublicar(ordenadas) };
  }

  /** A loja informada pelo servidor da loja é desta empresa (e viva)? Sem loja = a empresa toda. */
  async lojaDaEmpresa(tenantId: string, unidadeId: string | null): Promise<boolean> {
    if (unidadeId == null) return true;
    if (!UUID.test(unidadeId)) return false;
    const r: any = await this.db.execute(sql`
      select 1 from unidade where id = ${unidadeId}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null`);
    return linhas(r).length > 0;
  }

  // ── As três fontes ──────────────────────────────────────────────────────────────────

  /**
   * A fila do iFood desta loja — só com o envio ligado (`ORZUNI_LIGADO`), o direito da empresa e uma ligação viva.
   * Sem isso, `null` (a linha não aparece). Uma linha por item × tipo × loja (mig 370): a contagem é pequena, e o
   * filtro pela loja usa o índice dela.
   */
  async filaDoIfood(tenantId: string, unidadeId: string | null): Promise<FilaIfood | null> {
    if (!lerConfigOrzuni().envioLigado) return null;
    if (!(await ifoodPeloOrzuniLigado(this.db, tenantId))) return null;
    const lojas = sql`(select u.id from unidade u where u.tenant_id = ${tenantId}::uuid and u.deleted_at is null
                         and (${unidadeId}::uuid is null or u.id = ${unidadeId}::uuid))`;
    const lig: any = await this.db.execute(sql`
      select 1 from orzuni_ligacao l
       where l.tenant_id = ${tenantId}::uuid and l.revogada_em is null and l.unidade_id in ${lojas}
       limit 1`);
    if (!linhas(lig).length) return null;
    const problema = sql`(e.situacao = 'desistiu' or (e.situacao = 'feito' and e.resultado in ('nao_encontrado', 'recusado', 'parcial')))`;
    const [cont, probs]: any[] = await Promise.all([
      this.db.execute(sql`
        select count(*) filter (where e.situacao in ('pendente', 'enviando'))::int as a_caminho,
               count(*) filter (where ${problema})::int as com_problema
          from orzuni_envio e
         where e.tenant_id = ${tenantId}::uuid and e.unidade_id in ${lojas}`),
      this.db.execute(sql`
        select coalesce(p.nome, o.nome) as nome, e.situacao, e.resultado, e.tipo
          from orzuni_envio e
          left join produto p on e.tipo in ('preco_item', 'status_item') and p.id = e.ref_id
          left join opcao o on e.tipo in ('preco_opcao', 'status_opcao') and o.id = e.ref_id
         where e.tenant_id = ${tenantId}::uuid and e.unidade_id in ${lojas} and ${problema}
         order by coalesce(e.enviado_em, e.marcado_em) desc
         limit 5`),
    ]);
    const c = linhas(cont)[0] ?? {};
    const problemas: ProblemaIfood[] = linhas(probs).map((p) => ({
      nome: p.nome ?? null,
      situacao: p.situacao,
      resultado: p.resultado ?? null,
      oQue: String(p.tipo).startsWith('preco') ? 'preco' : 'pausa',
    }));
    return { aCaminho: Number(c.a_caminho ?? 0), comProblema: Number(c.com_problema ?? 0), problemas };
  }

  /** O GoGeM se identificou para a empresa (o token marcado) ou registrou aviso para esta loja. */
  async gogemLigado(tenantId: string, unidadeId: string | null): Promise<boolean> {
    if (await tokenDoGogem(this.db, tenantId, unidadeId)) return true;
    return (await registroDoGogem(this.db, tenantId, unidadeId)) != null;
  }

  /**
   * Quem lê cardápio ou fichas pela porta, nesta loja: token vivo com um desses escopos (a mesma régua da porta — V75:
   * token não revogado nem vencido, empresa e loja vivas), com o registro de aviso dele, se houver. Um por cliente.
   */
  async leitoresDaPorta(tenantId: string, unidadeId: string | null): Promise<LeitorDaPorta[]> {
    const escopos = sql.join(ESCOPOS_DO_CARDAPIO.map((e) => sql`${e}`), sql`, `);
    const r: any = await this.db.execute(sql`
      select t.cliente,
             bool_or(w.token_id is not null and w.pausado_em is null) as com_aviso,
             bool_or(w.pausado_em is not null) as pausado,
             max(w.ultimo_envio_em) as ultimo_aviso
        from integracao_token_loja t
        left join integracao_webhook w on w.token_id = t.id
       where t.tenant_id = ${tenantId}::uuid
         and t.cliente <> 'gogem'
         and t.revogado_em is null and (t.expira_em is null or t.expira_em > now())
         and t.escopos && array[${escopos}]::text[]
         and exists (select 1 from empresa e where e.id = t.tenant_id and e.deleted_at is null)
         and (t.unidade_id is null
              or exists (select 1 from unidade u where u.id = t.unidade_id and u.tenant_id = t.tenant_id and u.deleted_at is null))
         and (${unidadeId}::uuid is null or t.unidade_id is null or t.unidade_id = ${unidadeId}::uuid)
       group by t.cliente
       order by t.cliente`);
    return linhas(r).map((l) => ({
      cliente: String(l.cliente),
      comAviso: l.com_aviso === true,
      pausado: l.pausado === true,
      ultimoAviso: l.ultimo_aviso ?? null,
    }));
  }

  /** "Leia de novo": a mesma anotação que os gatilhos da 316 fazem; o job dos avisos carimba e manda. */
  async pedirLeituraDeNovo(tenantId: string, unidadeId: string | null): Promise<void> {
    await this.db.execute(sql`
      insert into integracao_retrato_mudanca (tenant_id, unidade_id, recurso)
      values (${tenantId}::uuid, ${unidadeId}::uuid, 'catalogo'), (${tenantId}::uuid, ${unidadeId}::uuid, 'fichas')`);
  }

  // ── Servidor da loja → nuvem ────────────────────────────────────────────────────────

  /** Pede à nuvem (token de sync). Sem alcançar: `semConexao`, com o motivo no log — nunca "nenhuma integração". */
  async pelaNuvem<T extends SituacaoIntegracoes>(
    tenantId: string,
    unidadeId: string | null,
    metodo: 'GET' | 'POST',
    buscar: typeof fetch = fetch,
  ): Promise<T> {
    const sem = (motivo: string): T => {
      this.log.warn(`publicar nas integrações sem a nuvem (${motivo})`);
      return { linhas: [], podePublicar: false, semConexao: true, resumo: '' } as unknown as T;
    };
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) return sem('sem CLOUD_API/SYNC_TOKEN no servidor da loja');
    const q = unidadeId ? `?unidade=${encodeURIComponent(unidadeId)}` : '';
    try {
      const res = await buscar(`${nuvem}/integracoes/loja/publicar${q}`, {
        method: metodo,
        headers: { 'x-sync-token': token, ...(metodo === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(metodo === 'POST' ? { body: '{}' } : {}),
        // O GoGeM tem até 15 s para responder; a nuvem, um pouco mais.
        signal: AbortSignal.timeout(metodo === 'POST' ? 25_000 : 8_000),
      });
      if (!res.ok) return sem(`HTTP ${res.status}`);
      const j: any = await res.json();
      if (j?.tenantId !== tenantId) return sem('a nuvem respondeu por outra empresa');
      if (!Array.isArray(j?.linhas)) return sem('a nuvem respondeu sem as linhas');
      const resto = { ...j };
      delete resto.tenantId;
      return { ...resto, semConexao: false } as T;
    } catch (e: any) {
      return sem(e?.cause?.code ?? e?.name ?? e?.message ?? String(e));
    }
  }
}
