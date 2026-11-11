import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ClienteDmsId, ClienteMcp, ErroMcp, montarChaveIdempotencia } from '../../dms/integracao-dms';
import { ehServidorLocal } from '../../common/modo';
import { ligacaoDaLoja } from './ligacao-da-loja';
import { versaoNoAr } from '../integracao-api/hub.regras';
import { lerConfigOrzuni, type ConfigOrzuni } from './orzuni.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * As permissões da PAUSA DA LOJA no iFood (contrato 1.1.0 da porta do Orzuni). Pedidas num cliente PRÓPRIO: as
 * `PERMISSOES_ORZUNI` do preço e da situação dos itens ficam como estão (uma ligação sem `loja.escrever` não quebra o envio
 * de preço por causa da pausa).
 */
export const PERMISSOES_DA_PAUSA: readonly string[] = ['loja.ler', 'loja.escrever'];

/** A pausa que já vale no iFood (a recusa `interrupcao_sobreposta` traz). */
export type PausaNoIfood = { id: string; inicio: string | null; fim: string | null; descricao: string | null };

/** O resultado de uma ida ao iFood: feito (com o id da pausa criada), ou a recusa — e se repetir mais tarde pode dar certo. */
export type ResultadoNoIfood =
  | { ok: true; id: string | null }
  | { ok: false; repetir: boolean; erro: string; sobreposta?: PausaNoIfood };

/**
 * A PAUSA DA LOJA NO iFOOD PELO ORZUNI (F5 da pausa por canal): `interrupcao_criar` e `interrupcao_remover` da porta MCP,
 * com a ligação da loja (`orzuni_ligacao`) e a régua de "acesso vale" (V75: empresa viva, loja viva e da empresa, o direito
 * `ifood_pelo_orzuni` ligado, a ligação viva). Só NUVEM. Quem decide QUANDO pausar e reabrir é a rotina da pausa nos canais
 * (`delivery/pausa-nos-canais.service.ts`); aqui só a ida à porta, que nunca rejeita.
 */
@Injectable()
export class OrzuniPausaService {
  private readonly log = new Logger('OrzuniPausa');
  /** O fetch das duas pontas (DMS ID e porta) — os testes trocam por um falso. */
  buscar: typeof fetch = fetch;
  private dmsId: { chave: string; cliente: ClienteDmsId } | null = null;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** O iFood pelo Orzuni pode ser usado nesta instalação (nuvem, `ORZUNI_LIGADO`, credencial do DMS ID completa). */
  ligadoNaInstalacao(): boolean {
    return !ehServidorLocal() && lerConfigOrzuni().envioLigado;
  }

  /** As lojas da empresa com a ligação viva e o direito ligado (as que podem pausar o iFood pelo Regem). */
  async lojasLigadas(tenantId: string): Promise<string[]> {
    if (!this.ligadoNaInstalacao()) return [];
    const r: any = await this.db.execute(sql`
      select l.unidade_id from orzuni_ligacao l
        join unidade u on u.id = l.unidade_id and u.tenant_id = l.tenant_id and u.deleted_at is null
       where l.tenant_id = ${tenantId}::uuid and l.revogada_em is null
         and exists (select 1 from entitlement e where e.tenant_id = l.tenant_id and e.modulo = 'ifood_pelo_orzuni' and e.ativo)
         and exists (select 1 from empresa emp where emp.id = l.tenant_id and emp.deleted_at is null)`);
    return ((r.rows ?? r) as any[]).map((x) => String(x.unidade_id));
  }

  /** A ligação viva da loja, lida NA HORA (V75); `null` com o motivo quando não vale. */
  private ligacao(tenantId: string, unidadeId: string): Promise<{ segredo: string } | { motivo: string }> {
    return ligacaoDaLoja(this.db, tenantId, unidadeId, this.log);
  }

  private cliente(cfg: ConfigOrzuni, segredo: string): ClienteMcp {
    const chave = `${cfg.emissor}|${cfg.aplicativo}`;
    if (!this.dmsId || this.dmsId.chave !== chave)
      this.dmsId = { chave, cliente: new ClienteDmsId({ emissor: cfg.emissor, aplicativo: cfg.aplicativo, segredo: cfg.segredo, buscar: this.buscar }) };
    return new ClienteMcp({
      endereco: cfg.endereco,
      recurso: cfg.recurso,
      permissoes: PERMISSOES_DA_PAUSA,
      dmsId: this.dmsId.cliente,
      ligacao: segredo,
      cliente: { nome: 'regem', versao: versaoNoAr() },
      buscar: this.buscar,
      tentativas: 2,
    });
  }

  /**
   * Pausa a loja no iFood de `inicio` a `fim`. A chave de idempotência sai da pausa do Regem E do início: o Orzuni recusa a
   * mesma chave com outro pedido (`chave_reutilizada`), e cada tentativa nova começa "agora". A repetição da MESMA chamada
   * (o cliente MCP repete a queda) leva a mesma chave; a criação repetida de verdade cai em `interrupcao_sobreposta` com a
   * pausa que já é nossa (quem chama a reconhece pela descrição).
   */
  criar(tenantId: string, unidadeId: string, p: { inicio: Date; fim: Date; descricao: string; chave: readonly (string | number)[] }) {
    const inicio = p.inicio.toISOString();
    return this.chamar(tenantId, unidadeId, 'interrupcao_criar', {
      inicio,
      fim: p.fim.toISOString(),
      descricao: p.descricao.slice(0, 200),
      chaveIdempotencia: montarChaveIdempotencia('regem-pausa-ifood', ...p.chave, inicio),
    });
  }

  /** Reabre: remove a pausa pelo id (já removida = sucesso, no contrato do Orzuni). */
  remover(tenantId: string, unidadeId: string, interrupcaoId: string) {
    return this.chamar(tenantId, unidadeId, 'interrupcao_remover', {
      interrupcao_id: interrupcaoId,
      chaveIdempotencia: montarChaveIdempotencia('regem-pausa-ifood-remover', interrupcaoId),
    });
  }

  private async chamar(tenantId: string, unidadeId: string, ferramenta: string, argumentos: Record<string, unknown>): Promise<ResultadoNoIfood> {
    const cfg = lerConfigOrzuni();
    if (ehServidorLocal() || !cfg.envioLigado)
      return { ok: false, repetir: false, erro: 'O iFood pelo Orzuni não está ligado nesta instalação.' };
    const lig = await this.ligacao(tenantId, unidadeId);
    if ('motivo' in lig) return { ok: false, repetir: false, erro: lig.motivo };
    try {
      const dados: any = await this.cliente(cfg, lig.segredo).chamar(ferramenta, argumentos);
      return { ok: true, id: dados?.interrupcao_id != null ? String(dados.interrupcao_id) : null };
    } catch (e: any) {
      return this.recusa(ferramenta, e);
    }
  }

  private recusa(ferramenta: string, e: any): ResultadoNoIfood {
    if (!(e instanceof ErroMcp)) {
      this.log.warn(`${ferramenta}: ${e?.message ?? e}`);
      return { ok: false, repetir: true, erro: 'O Orzuni não respondeu agora — o Regem tenta de novo.' };
    }
    const d: any = e.dados && typeof e.dados === 'object' ? e.dados : {};
    switch (e.tipo) {
      case 'ferramenta': {
        const codigo = String(d.codigo ?? '');
        if (codigo === 'interrupcao_sobreposta') {
          const i = d.interrupcao && typeof d.interrupcao === 'object' ? d.interrupcao : null;
          return {
            ok: false,
            repetir: false,
            erro: 'O iFood já tem uma pausa nesse horário.',
            ...(i?.id ? { sobreposta: { id: String(i.id), inicio: i.inicio ?? null, fim: i.fim ?? null, descricao: i.descricao ?? null } } : {}),
          };
        }
        if (codigo === 'interrupcao_duracao_invalida') return { ok: false, repetir: false, erro: 'O iFood pausa de 1 minuto a 7 dias.' };
        const frase = e.frase.trim().startsWith('{') ? '' : e.frase.trim();
        return { ok: false, repetir: d.pode_repetir === true || e.podeRepetir, erro: frase || `O iFood recusou (${codigo || 'sem código'}).` };
      }
      case 'permissao':
        // Sem `loja.escrever` a ferramenta nem aparece: "não encontrada" (contrato 1.1.0).
        return { ok: false, repetir: false, erro: 'A chave da loja no Orzuni não tem a permissão de pausar a loja (loja.escrever).' };
      case 'ligacao':
        return { ok: false, repetir: false, erro: 'O Orzuni não reconhece mais a ligação da loja — a distribuição registra a chave de novo.' };
      case 'recusada':
        return { ok: false, repetir: true, erro: 'A conta da loja no Orzuni está suspensa ou sem iFood agora.' };
      case 'limite':
      case 'indisponivel':
      case 'sem-resposta':
      case 'token':
        return { ok: false, repetir: true, erro: 'O Orzuni não respondeu agora — o Regem tenta de novo.' };
      default:
        this.log.error(`${ferramenta}: ${e.message}`);
        return { ok: false, repetir: false, erro: 'O Orzuni recusou o pedido de pausa.' };
    }
  }
}
