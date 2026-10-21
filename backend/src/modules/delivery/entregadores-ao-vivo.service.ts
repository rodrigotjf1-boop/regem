import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { setor } from '../../db/schema';
import { ehServidorLocal } from '../../common/modo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import type { AtorKds } from '../producao-pedido/kds-auditoria';
import { AoVivo, centroDaLoja, consultarAoVivo } from './entregadores-ao-vivo';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type AoVivoResposta = AoVivo & {
  /** O servidor da loja não conseguiu falar com a nuvem — o mapa mostra "sem conexão". */
  semConexao?: boolean;
};

/** Uma tela de KDS no "Mostrar num KDS" do Mapa ao vivo. `mapa` = o painel mandou ela mostrar o mapa. */
export type TelaDoMapa = { id: string; nome: string; escopo: string; setor: string | null; mapa: boolean };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    private readonly producao: ProducaoPedidoService,
    private readonly auditoria: AuditoriaService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /** A chave da loja (mig 293): o gestor liga o mapa no KDS em Delivery → Configurações. */
  async mapaNoKdsLigado(tenantId: string, unidadeId: string | null): Promise<boolean> {
    const cfg: any = await this.delivery.getConfig(tenantId, unidadeId);
    return cfg?.kdsMapaEntregadores === true;
  }

  /**
   * "Mostrar num KDS" (cozinha em estações, entrega 5): as telas de KDS da loja — as MESMAS do "Este KDS" da cozinha —,
   * com o setor e se o painel já mandou o mapa para cada uma. `ligado` = a chave da loja: desligada, o KDS marcado
   * mostra os pedidos até o gestor ligar (a tela do painel avisa).
   */
  async telasDoMapa(tenantId: string, unidadeId: string | null): Promise<{ ligado: boolean; telas: TelaDoMapa[] }> {
    const [ligado, telas] = await Promise.all([this.mapaNoKdsLigado(tenantId, unidadeId), this.producao.telasDeKds(tenantId, unidadeId)]);
    const setorIds = [...new Set(telas.map((t) => t.setorId).filter((x): x is string => !!x))];
    const setores = setorIds.length
      ? await this.db.select({ id: setor.id, nome: setor.nome }).from(setor).where(and(eq(setor.tenantId, tenantId), inArray(setor.id, setorIds)))
      : [];
    const nomeDoSetor = new Map(setores.map((s) => [s.id, s.nome]));
    return {
      ligado,
      telas: telas.map((t) => ({
        id: t.id,
        nome: t.nome,
        escopo: t.escopo,
        setor: (t.setorId && nomeDoSetor.get(t.setorId)) || null,
        mapa: t.mapa === true,
      })),
    };
  }

  /**
   * Grava QUAIS telas de KDS mostram o mapa: a lista inteira — a marcada passa a mostrar, a desmarcada volta aos pedidos
   * (lista vazia = "Tirar de todos"). Só escreve as que mudaram, numa ida ao banco: o carimbo do sync anda só nelas. Vale
   * dos dois lados (nuvem e servidor da loja); a escolha viaja pelo sync (`kds_tela_ajuste`, mig 338) e, no mesmo
   * servidor, o KDS troca na hora pelo aviso em tempo real.
   */
  async mostrarNosKds(tenantId: string, unidadeId: string | null, kdsIds: unknown, ator: AtorKds) {
    if (!Array.isArray(kdsIds)) throw new BadRequestException('Mande a lista dos KDS que vão mostrar o mapa.');
    if (kdsIds.some((x) => typeof x !== 'string' || !UUID_RE.test(x))) throw new BadRequestException('A lista tem um item que não é KDS.');
    const marcados = new Set(kdsIds as string[]);
    const telas = await this.producao.telasDeKds(tenantId, unidadeId);
    const daLoja = new Set(telas.map((t) => t.id));
    if ([...marcados].some((id) => !daLoja.has(id))) {
      throw new BadRequestException('Algum KDS da lista não é desta loja ou foi desligado. Abra a lista de novo.');
    }
    const entraram = telas.filter((t) => marcados.has(t.id) && t.mapa !== true);
    const sairam = telas.filter((t) => !marcados.has(t.id) && t.mapa === true);
    const mudar = [...entraram.map((t) => ({ id: t.id, mapa: true })), ...sairam.map((t) => ({ id: t.id, mapa: false }))];
    if (mudar.length) {
      await this.db.execute(sql`
        insert into kds_tela_ajuste (id, tenant_id, mostra_mapa)
        values ${sql.join(mudar.map((m) => sql`(${m.id}::uuid, ${tenantId}::uuid, ${m.mapa})`), sql`, `)}
        on conflict (id) do update set mostra_mapa = excluded.mostra_mapa
         where kds_tela_ajuste.tenant_id = excluded.tenant_id`);
      await this.auditoria.registrar({
        tenantId,
        unidadeId,
        atorId: ator?.id ?? null,
        atorPerfil: ator?.perfil ?? null,
        tipo: 'config',
        acao: 'mostrou_mapa_nos_kds',
        origem: 'delivery',
        entidadeTipo: 'kds',
        detalhe: { entraram: entraram.map((t) => t.nome), sairam: sairam.map((t) => t.nome) },
      });
      // O KDS ligado neste servidor relê a lista das telas e troca na hora (o de outro servidor, pelo sync).
      this.events?.emit('kds.telas.mudou', { tenantId });
    }
    return {
      ...(await this.telasDoMapa(tenantId, unidadeId)),
      entraram: entraram.map((t) => t.nome),
      sairam: sairam.map((t) => t.nome),
    };
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
