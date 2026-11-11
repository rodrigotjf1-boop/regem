import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ClienteDmsId, ClienteMcp, ErroMcp } from '../../dms/integracao-dms';
import { ehServidorLocal } from '../../common/modo';
import { versaoNoAr } from '../integracao-api/hub.regras';
import { ligacaoDaLoja } from './ligacao-da-loja';
import { lerConfigOrzuni, type ConfigOrzuni } from './orzuni.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A permissão da LEITURA do cardápio (contrato da porta do Orzuni): pedida num cliente próprio, só ela. */
export const PERMISSOES_DA_LEITURA: readonly string[] = ['catalogo.ler'];

/** O que a leitura trouxe: as duas respostas do Orzuni (o formato é decidido em `conferencia.regras.ts`), ou a recusa. */
export type LeituraDoIfood =
  | { ok: true; cardapio: unknown; complementos: unknown }
  | { ok: false; repetir: boolean; erro: string };

/**
 * A LEITURA DO CARDÁPIO DO iFOOD PELO ORZUNI ("Conferir com os apps", R3 F4a): `cardapio_listar` e `complementos_listar`
 * da porta MCP (2 chamadas, sem paginação; contrato em `Orzuni/docs/porta-mcp.md`), com a ligação da loja e a régua de
 * "acesso vale" (V75, `ligacaoDaLoja`). Só NUVEM. Nunca rejeita: a recusa volta com a frase para a tela.
 */
@Injectable()
export class OrzuniLeituraService {
  private readonly log = new Logger('OrzuniLeitura');
  /** O fetch das duas pontas (DMS ID e porta) — os testes trocam por um falso. */
  buscar: typeof fetch = fetch;
  private dmsId: { chave: string; cliente: ClienteDmsId } | null = null;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** O iFood pelo Orzuni pode ser usado nesta instalação (nuvem, `ORZUNI_LIGADO`, credencial do DMS ID completa). */
  ligadoNaInstalacao(): boolean {
    return !ehServidorLocal() && lerConfigOrzuni().envioLigado;
  }

  /** A loja pode ler o iFood pelo Orzuni agora? (sem chamar o Orzuni) — o motivo é a frase da tela. */
  async disponivel(tenantId: string, unidadeId: string): Promise<{ ok: true } | { ok: false; motivo: string }> {
    if (!this.ligadoNaInstalacao()) return { ok: false, motivo: 'O iFood pelo Orzuni não está ligado nesta instalação.' };
    const lig = await ligacaoDaLoja(this.db, tenantId, unidadeId, this.log);
    return 'motivo' in lig ? { ok: false, motivo: lig.motivo } : { ok: true };
  }

  private cliente(cfg: ConfigOrzuni, segredo: string): ClienteMcp {
    const chave = `${cfg.emissor}|${cfg.aplicativo}`;
    if (!this.dmsId || this.dmsId.chave !== chave)
      this.dmsId = { chave, cliente: new ClienteDmsId({ emissor: cfg.emissor, aplicativo: cfg.aplicativo, segredo: cfg.segredo, buscar: this.buscar }) };
    return new ClienteMcp({
      endereco: cfg.endereco,
      recurso: cfg.recurso,
      permissoes: PERMISSOES_DA_LEITURA,
      dmsId: this.dmsId.cliente,
      ligacao: segredo,
      cliente: { nome: 'regem', versao: versaoNoAr() },
      buscar: this.buscar,
      tentativas: 2,
    });
  }

  /** Lê o cardápio e os complementos da loja no iFood. */
  async lerCardapio(tenantId: string, unidadeId: string): Promise<LeituraDoIfood> {
    const cfg = lerConfigOrzuni();
    if (ehServidorLocal() || !cfg.envioLigado) return { ok: false, repetir: false, erro: 'O iFood pelo Orzuni não está ligado nesta instalação.' };
    const lig = await ligacaoDaLoja(this.db, tenantId, unidadeId, this.log);
    if ('motivo' in lig) return { ok: false, repetir: false, erro: lig.motivo };
    const mcp = this.cliente(cfg, lig.segredo);
    try {
      // Uma depois da outra: o limite da porta é por ligação (120/min) e são só duas.
      const cardapio = await mcp.chamar('cardapio_listar', {}, { leitura: true });
      const complementos = await mcp.chamar('complementos_listar', {}, { leitura: true });
      return { ok: true, cardapio, complementos };
    } catch (e: any) {
      return this.recusa(e);
    }
  }

  private recusa(e: any): LeituraDoIfood {
    if (!(e instanceof ErroMcp)) {
      this.log.warn(`leitura do cardápio: ${e?.message ?? e}`);
      return { ok: false, repetir: true, erro: 'O Orzuni não respondeu agora. Nada foi mudado; tente de novo em instantes.' };
    }
    switch (e.tipo) {
      case 'ferramenta': {
        const d: any = e.dados && typeof e.dados === 'object' ? e.dados : {};
        const frase = e.frase.trim().startsWith('{') ? '' : e.frase.trim();
        return { ok: false, repetir: d.pode_repetir === true || e.podeRepetir, erro: frase || 'O Orzuni recusou a leitura do cardápio.' };
      }
      case 'permissao':
        return { ok: false, repetir: false, erro: 'A chave da loja no Orzuni não tem a permissão de ler o cardápio (catalogo.ler).' };
      case 'ligacao':
        return { ok: false, repetir: false, erro: 'O Orzuni não reconhece mais a ligação da loja — a distribuição registra a chave de novo.' };
      case 'recusada':
        return { ok: false, repetir: true, erro: 'A conta da loja no Orzuni está suspensa ou sem iFood agora.' };
      case 'limite':
        return { ok: false, repetir: true, erro: 'O Orzuni está no limite de leituras agora. Tente de novo em um minuto.' };
      case 'indisponivel':
      case 'sem-resposta':
      case 'token':
        return { ok: false, repetir: true, erro: 'O Orzuni não respondeu agora. Nada foi mudado; tente de novo em instantes.' };
      default:
        this.log.error(`leitura do cardápio: ${e.message}`);
        return { ok: false, repetir: false, erro: 'O Orzuni recusou a leitura do cardápio.' };
    }
  }
}
