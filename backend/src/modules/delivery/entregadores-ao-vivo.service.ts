import { Inject, Injectable, Logger } from '@nestjs/common';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { AoVivo, centroDaLoja, consultarAoVivo } from './entregadores-ao-vivo';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type AoVivoResposta = AoVivo & {
  /** O servidor da loja não conseguiu falar com a nuvem — o mapa mostra "sem conexão". */
  semConexao?: boolean;
};

// Quanto uma resposta da nuvem vale no servidor da loja. Várias telas de KDS e o painel pedem a
// cada 15 s: com isto, a loja faz no máximo UMA chamada à nuvem a cada 10 s, não uma por tela.
const CACHE_MS = 10_000;
// Nuvem fora: não tenta de novo a cada tela — espera um pouco (a tela já mostra "sem conexão").
const CACHE_FALHA_MS = 5_000;

/**
 * Entregadores ao vivo para as telas da LOJA (Mapa ao vivo do delivery e o mapa no KDS).
 *
 *  • NUVEM: consulta direto (a posição do entregador só existe lá).
 *  • SERVIDOR DA LOJA: pede à nuvem pela rota do token de sync (`/delivery/entregadores-ao-vivo/
 *    loja`) — a nuvem responde só os entregadores da loja do token. Sem internet, devolve o mapa
 *    centrado na loja, vazio, com `semConexao` (a tela avisa e volta sozinha). Antes o Mapa ao vivo
 *    no servidor da loja chamava uma rota que lá não existe: aparecia vazio e ainda dizia que a
 *    loja estava sem coordenadas.
 */
@Injectable()
export class EntregadoresAoVivoService {
  private readonly log = new Logger('EntregadoresAoVivo');
  // Cache de LEITURA por loja (não é estado de requisição): o pedido em andamento é
  // compartilhado, então telas que chegam juntas esperam a MESMA chamada à nuvem.
  private readonly cache = new Map<string, { ate: number; dados: Promise<AoVivoResposta> }>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly delivery: DeliveryService,
  ) {}

  /** A chave da loja (mig 293): o gestor liga o mapa no KDS em Delivery → Configurações. */
  async mapaNoKdsLigado(tenantId: string, unidadeId: string | null): Promise<boolean> {
    const cfg: any = await this.delivery.getConfig(tenantId, unidadeId);
    return cfg?.kdsMapaEntregadores === true;
  }

  async daLoja(tenantId: string, unidadeId: string | null): Promise<AoVivoResposta> {
    if (!ehServidorLocal()) return consultarAoVivo(this.db, tenantId, unidadeId);
    const chave = `${tenantId}|${unidadeId ?? ''}`;
    const agora = Date.now();
    const c = this.cache.get(chave);
    if (c && c.ate > agora) return c.dados;
    const dados = this.daNuvem(tenantId, unidadeId);
    const item = { ate: agora + CACHE_MS, dados };
    this.cache.set(chave, item);
    dados.then((d) => {
      if (d.semConexao) item.ate = Date.now() + CACHE_FALHA_MS;
    }, () => undefined);
    return dados;
  }

  // Nunca rejeita: qualquer falha vira `semConexao` com o motivo no log (o erro é esperado —
  // loja sem internet — e a tela tem de continuar de pé).
  private async daNuvem(tenantId: string, unidadeId: string | null): Promise<AoVivoResposta> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    let motivo = 'sem CLOUD_API/SYNC_TOKEN no servidor da loja';
    if (nuvem && token) {
      try {
        const res = await fetch(`${nuvem}/delivery/entregadores-ao-vivo/loja`, {
          headers: { 'x-sync-token': token },
          signal: AbortSignal.timeout(8_000),
        });
        if (res.ok) {
          const j: any = await res.json();
          // A nuvem responde a empresa do TOKEN; a tela é de um usuário desta empresa. Se não
          // bater (servidor reaproveitado de outra loja), não mostra nada de ninguém.
          if (j?.tenantId === tenantId && Array.isArray(j?.entregadores)) {
            return { centro: j.centro ?? null, entregadores: j.entregadores };
          }
          motivo = 'a nuvem respondeu por outra empresa';
        } else {
          motivo = `HTTP ${res.status}`;
        }
      } catch (e: any) {
        motivo = e?.cause?.code ?? e?.name ?? e?.message ?? String(e);
      }
    }
    this.log.warn(`Mapa dos entregadores sem a nuvem (${motivo}) — a tela mostra "sem conexão".`);
    const centro = await centroDaLoja(this.db, tenantId, unidadeId).catch(() => null);
    return { centro, entregadores: [], semConexao: true };
  }
}
