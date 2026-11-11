import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ehServidorLocal } from '../../common/modo';
import { hojeISO } from '../../common/data';
import { noPeriodo } from '../../common/fuso-sql';
import { comandaEhDeCanal, faturamentoComanda, faturamentoPedido, pedidoVale } from '../../common/faturamento';
import { completarTaxas, conferirTaxas, type Taxas } from './taxas.regras';
import { QUEM_CONFERE, type Ator } from './conferencia.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O período dos números da loja (itens por pedido, pagos na entrega). */
export const DIAS_DAS_VENDAS = 90;

/** Os números das vendas que a calculadora usa quando a loja não digita os dela (decisão 8 do protótipo). */
export type VendasDaLoja = {
  /** Faturamento da EMPRESA nos últimos 12 meses (Simples) — só ao presidente; `null` com o motivo para os outros. */
  rbt12: number | null;
  rbt12Motivo: string | null;
  /** Itens de um pedido médio do delivery desta loja (90 dias); `null` sem pedidos. */
  itensPorPedido: number | null;
  pedidos: number;
  /** % dos pedidos de cada app pagos na entrega (90 dias); `null` sem pedidos daquele app. */
  parteNaEntrega: Record<'ifood' | '99food', { pct: number | null; pedidos: number }>;
  dias: number;
};

export type RespostaDasTaxas = {
  loja: { id: string; nome: string };
  taxas: Taxas;
  /** A loja já guardou as dela (senão, os valores de referência). */
  salvas: boolean;
  atualizadoEm: string | null;
  vendas: VendasDaLoja;
};

/**
 * "％ TAXAS E MARGEM" DE CADA LOJA (R3 F5; mig 407): as taxas que a calculadora de preço usa e os números das vendas
 * (decisão 8). NUVEM: lê e grava (tabela só da nuvem); SERVIDOR DA LOJA: pede à nuvem pela rota do token de sync, com quem
 * pediu (o faturamento da empresa só vai ao presidente — a nuvem confere o nível de quem agiu).
 */
@Injectable()
export class TaxasService {
  private readonly log = new Logger('TaxasDaLoja');
  buscarNaNuvem: typeof fetch = fetch;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async rows(q: any): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return (r.rows ?? r) as any[];
  }

  private async loja(tenantId: string, unidade: string | null) {
    if (unidade) {
      if (!UUID.test(unidade)) throw new BadRequestException('Loja inválida.');
      const [l] = await this.rows(sql`select id, nome from unidade where id = ${unidade} and tenant_id = ${tenantId} and deleted_at is null`);
      if (!l) throw new NotFoundException('Loja não encontrada.');
      return { id: String(l.id), nome: String(l.nome) };
    }
    const lojas = await this.rows(sql`select id, nome from unidade where tenant_id = ${tenantId} and deleted_at is null order by nome limit 2`);
    if (lojas.length === 1) return { id: String(lojas[0].id), nome: String(lojas[0].nome) };
    if (!lojas.length) throw new ConflictException('A empresa não tem loja cadastrada.');
    throw new ConflictException({ statusCode: 409, code: 'ESCOLHA_A_LOJA', message: 'As taxas são por loja: escolha a loja no topo da tela.' });
  }

  /** As taxas da loja (completadas com as de referência) e os números das vendas. */
  async ler(tenantId: string, unidade: string | null, ator: Ator): Promise<RespostaDasTaxas> {
    if (ehServidorLocal()) return this.pelaNuvem(tenantId, 'GET', unidade, ator);
    const loja = await this.loja(tenantId, unidade);
    const [linha] = await this.rows(sql`select taxas, atualizado_em from catalogo_taxas where tenant_id = ${tenantId} and unidade_id = ${loja.id}`);
    return {
      loja,
      taxas: completarTaxas(linha?.taxas),
      salvas: !!linha,
      atualizadoEm: linha?.atualizado_em ? new Date(linha.atualizado_em).toISOString() : null,
      vendas: await this.vendas(tenantId, loja.id, ator.perfil === 'presidente'),
    };
  }

  /** Grava as taxas da loja (o que não veio fica como estava — V16), com auditoria do que mudou. */
  async salvar(tenantId: string, unidade: string | null, dto: any, ator: Ator): Promise<RespostaDasTaxas> {
    if (ehServidorLocal()) return this.pelaNuvem(tenantId, 'PUT', unidade, ator, dto);
    const loja = await this.loja(tenantId, unidade);
    const [linha] = await this.rows(sql`select taxas from catalogo_taxas where tenant_id = ${tenantId} and unidade_id = ${loja.id}`);
    const antes = completarTaxas(linha?.taxas);
    let depois: Taxas;
    try {
      depois = conferirTaxas(dto?.taxas ?? dto, antes);
    } catch (e: any) {
      throw new BadRequestException(e?.message ?? 'Taxas inválidas.');
    }
    await this.db.execute(sql`
      insert into catalogo_taxas (tenant_id, unidade_id, taxas, atualizado_em, atualizado_por)
      values (${tenantId}, ${loja.id}, ${JSON.stringify(depois)}::jsonb, clock_timestamp(), ${ator.id})
      on conflict (unidade_id) do update
         set taxas = excluded.taxas, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`);
    if (JSON.stringify(antes) !== JSON.stringify(depois) || !linha)
      await this.auditoria.registrar({
        tenantId,
        unidadeId: loja.id,
        atorId: ator.id,
        atorPerfil: ator.perfil,
        tipo: 'cadastro',
        acao: 'salvou_taxas_e_margem',
        entidadeTipo: 'catalogo_taxas',
        entidadeId: null,
        origem: 'gestao_do_catalogo',
        detalhe: { loja: loja.nome, de: antes, para: depois },
      });
    return this.ler(tenantId, loja.id, ator);
  }

  /** Os números das vendas (decisão 8): faturamento de 12 meses da empresa, itens por pedido e pagos na entrega (90 dias). */
  private async vendas(tenantId: string, lojaId: string, presidente: boolean): Promise<VendasDaLoja> {
    const hoje = hojeISO();
    const desde = (dias: number) => {
      const d = new Date(`${hoje}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - dias);
      return `${d.toISOString().slice(0, 10)} 00:00:00`;
    };
    const fim = `${hoje} 23:59:59`;
    const ini90 = desde(DIAS_DAS_VENDAS);
    const [pedidos, apps] = await Promise.all([
      this.rows(sql`
        select count(*)::int as pedidos, avg(i.itens)::float as media
          from pedido_externo pe
          join lateral (select coalesce(sum(ci.quantidade), 0) as itens from comanda_item ci
                         where ci.comanda_id = pe.comanda_id and ci.produto_id is not null) i on true
         where pe.tenant_id = ${tenantId} and pe.unidade_id = ${lojaId} and ${pedidoVale('pe')}
           and pe.comanda_id is not null and ${noPeriodo('pe.criado_em', ini90, fim)}`),
      this.rows(sql`
        select pe.canal, count(*)::int as pedidos, count(*) filter (where not pe.pago_online)::int as na_entrega
          from pedido_externo pe
         where pe.tenant_id = ${tenantId} and pe.unidade_id = ${lojaId} and ${pedidoVale('pe')}
           and pe.canal in ('ifood', '99food') and ${noPeriodo('pe.criado_em', ini90, fim)}
         group by pe.canal`),
    ]);
    const parte = (canal: 'ifood' | '99food') => {
      const a = apps.find((x) => x.canal === canal);
      const n = Number(a?.pedidos ?? 0);
      return { pct: n ? Math.round((Number(a.na_entrega) / n) * 1000) / 10 : null, pedidos: n };
    };
    let rbt12: number | null = null;
    let rbt12Motivo: string | null = null;
    if (presidente) {
      const ini365 = desde(365);
      const [f] = await this.rows(sql`
        select coalesce((select sum(${faturamentoComanda('c')}) from comanda c
                          where c.tenant_id = ${tenantId} and c.status = 'fechada' and not ${comandaEhDeCanal('c')}
                            and ${noPeriodo('c.fechada_em', ini365, fim)}), 0)
             + coalesce((select sum(${faturamentoPedido('pe')}) from pedido_externo pe
                          where pe.tenant_id = ${tenantId} and ${pedidoVale('pe')}
                            and ${noPeriodo('pe.criado_em', ini365, fim)}), 0) as total`);
      rbt12 = Math.round(Number(f?.total ?? 0) * 100) / 100;
    } else {
      rbt12Motivo = 'O faturamento da empresa só aparece para o presidente: digite o número do contador.';
    }
    const p = pedidos[0] ?? {};
    const n = Number(p.pedidos ?? 0);
    return {
      rbt12,
      rbt12Motivo,
      itensPorPedido: n && p.media != null ? Math.round(Number(p.media) * 10) / 10 : null,
      pedidos: n,
      parteNaEntrega: { ifood: parte('ifood'), '99food': parte('99food') },
      dias: DIAS_DAS_VENDAS,
    };
  }

  // ── servidor da loja → nuvem ─────────────────────────────────────────────────────────────────────────────

  /** O mesmo, vindo do servidor da loja (na nuvem): quem pediu é conferido aqui (ativo e da gestão). */
  async vindoDaLoja(tenantId: string, lojaDoToken: string | null, metodo: 'GET' | 'PUT', dados: any) {
    const ator = await this.atorDaLoja(tenantId, dados?.atorId);
    const pedida = typeof dados?.unidade === 'string' && UUID.test(dados.unidade) ? dados.unidade : null;
    if (lojaDoToken && pedida && pedida !== lojaDoToken) throw new ForbiddenException('O servidor desta loja não vê as taxas de outra loja.');
    const unidade = lojaDoToken ?? pedida;
    const r = metodo === 'GET' ? await this.ler(tenantId, unidade, ator) : await this.salvar(tenantId, unidade, dados, ator);
    return { tenantId, ...r };
  }

  private async atorDaLoja(tenantId: string, atorId: unknown): Promise<Ator> {
    const id = typeof atorId === 'string' && UUID.test(atorId) ? atorId : null;
    const [quem] = id
      ? await this.rows(sql`
          select c.id, coalesce(p.nivel, f.categoria::text) as nivel
            from colaborador c left join funcao f on f.id = c.funcao_id left join perfil_acesso p on p.id = c.perfil_acesso_id
           where c.id = ${id} and c.tenant_id = ${tenantId} and c.status = 'ativo' and c.deleted_at is null`)
      : [];
    if (!quem || !(QUEM_CONFERE as readonly string[]).includes(String(quem.nivel))) throw new ForbiddenException('As taxas e a margem são da gestão.');
    return { id: String(quem.id), perfil: String(quem.nivel) };
  }

  private async pelaNuvem(tenantId: string, metodo: 'GET' | 'PUT', unidade: string | null, ator: Ator, dto?: any): Promise<RespostaDasTaxas> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) throw new ServiceUnavailableException('Sem conexão com a nuvem agora: as taxas ficam na nuvem. Tente de novo quando a internet voltar.');
    const corpo = { ...(dto && typeof dto === 'object' ? dto : {}), unidade, atorId: ator.id };
    let res: Response;
    try {
      res = await this.buscarNaNuvem(`${nuvem}/catalogo/taxas/loja${metodo === 'GET' ? '/ler' : ''}`, {
        method: 'POST',
        headers: { 'x-sync-token': token, 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e: any) {
      this.log.warn(`taxas sem a nuvem (${e?.cause?.code ?? e?.name ?? e?.message ?? e})`);
      throw new ServiceUnavailableException('Sem conexão com a nuvem agora: as taxas ficam na nuvem. Tente de novo quando a internet voltar.');
    }
    const j: any = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) throw new HttpException(j ?? { message: `HTTP ${res.status}` }, res.status);
      throw new ServiceUnavailableException('A nuvem não respondeu agora: tente de novo em instantes.');
    }
    if (j?.tenantId !== tenantId) throw new ServiceUnavailableException('A nuvem respondeu por outra empresa: nada foi feito.');
    const { tenantId: _t, ...resto } = j;
    return resto as RespostaDasTaxas;
  }
}
