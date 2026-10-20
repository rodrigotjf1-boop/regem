import { ForbiddenException, Inject, Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { hostname, networkInterfaces } from 'node:os';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { PresencaService } from '../equipamento/presenca.service';
import {
  HistoricoIp,
  RedeLocal,
  escolherPrincipal,
  historicoDoIp,
  interfacesIPv4,
  lerRotaPadrao,
  montarRede,
} from './rede-local';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** De quanto em quanto tempo o servidor da loja mede o próprio endereço. */
export const MEDIR_REDE_A_CADA_MS = 5 * 60_000;

// O ENDEREÇO DO SERVIDOR DA LOJA NA REDE (conexão PC ↔ servidor, parte 1). SÓ NO SERVIDOR DA LOJA.
//
// Mede ao subir e a cada 5 min: o IP da rota padrão (o que os PCs usam), o roteador, o MAC e o nome do
// PC; guarda em `sync_state` (`rede_info`), de onde o sync-daemon o manda na saúde da batida — é assim
// que a tela "Servidor local" da NUVEM mostra o IP (o dono vê pelo celular numa emergência). Também
// guarda o histórico do IP (`rede_ip_hist`): quando o roteador troca o IP, a tela diz qual era e desde
// quando é o novo. Nunca derruba nada: falha de leitura deixa a última medição valendo.
@Injectable()
export class RedeLocalService implements OnApplicationBootstrap {
  private readonly log = new Logger('RedeLocal');
  private ultima: RedeLocal | null = null;
  private historicoEmMemoria: HistoricoIp | null = null;
  private medindo: Promise<RedeLocal | null> | null = null;
  private avisoGravar = 0;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // Opcional: os testes montam o serviço só com o banco.
    @Optional() private readonly presenca?: PresencaService,
  ) {}

  onApplicationBootstrap() {
    if (ehServidorLocal()) void this.medir();
  }

  /** A última medição (memória), para quem precisa dela a cada chamada (a presença do PC). */
  get atual(): RedeLocal | null {
    return this.ultima;
  }

  @Interval(MEDIR_REDE_A_CADA_MS)
  async medirNoIntervalo(): Promise<void> {
    await this.medir();
  }

  private portas() {
    return { app: Number(process.env.EDGE_WEB_PORT) || 3001, api: Number(process.env.PORT) || 3002 };
  }

  private async lerEstado<T>(chave: string): Promise<T | null> {
    try {
      const r: any = await this.db.execute(sql`select valor from sync_state where chave = ${chave} limit 1`);
      const v = (r.rows ?? r)[0]?.valor;
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  }

  private async gravarEstado(chave: string, valor: unknown) {
    await this.db.execute(sql`
      insert into sync_state (chave, valor) values (${chave}, ${JSON.stringify(valor)})
      on conflict (chave) do update set valor = excluded.valor`);
  }

  /** Mede, guarda e devolve. Uma medição por vez; nunca rejeita (V3) — falha mantém a anterior. */
  medir(agora: Date = new Date()): Promise<RedeLocal | null> {
    if (!ehServidorLocal()) return Promise.resolve(null);
    if (this.medindo) return this.medindo;
    this.medindo = (async () => {
      let rede: RedeLocal;
      let historico: HistoricoIp;
      let antes: HistoricoIp | null = null;
      try {
        let rota: { gateway: string; ip: string } | null;
        [rota, antes] = await Promise.all([lerRotaPadrao(), this.lerEstado<HistoricoIp>('rede_ip_hist')]);
        const interfaces = interfacesIPv4(networkInterfaces());
        const principal = escolherPrincipal(interfaces, rota);
        // Sem o histórico guardado (servidor sem o `sync_state`), compara com a medição desta execução.
        historico = historicoDoIp(antes ?? this.historicoEmMemoria, principal?.ip ?? null, agora);
        rede = montarRede({ maquina: hostname(), interfaces, rota, historico, portas: this.portas(), agora });
      } catch (e: any) {
        this.log.warn(`endereço do servidor na rede não medido agora: ${e?.message ?? e} — vale a medição anterior`);
        this.medindo = null;
        return this.ultima;
      }
      // A medição vale mesmo se guardar falhar: guardar é só para a batida levar à nuvem.
      this.ultima = rede;
      this.historicoEmMemoria = historico;
      const anteriorIp = (antes ?? null)?.ip;
      if (anteriorIp && historico.ip && anteriorIp !== historico.ip) {
        this.log.warn(`o IP do servidor da loja mudou: ${anteriorIp} → ${historico.ip} (o roteador deu outro IP)`);
      }
      try {
        if (JSON.stringify(historico) !== JSON.stringify(antes)) await this.gravarEstado('rede_ip_hist', historico);
        await this.gravarEstado('rede_info', rede);
      } catch (e: any) {
        if (Date.now() - this.avisoGravar > 3_600_000) {
          this.avisoGravar = Date.now();
          this.log.warn(`endereço do servidor medido, mas não guardado para a nuvem: ${e?.message ?? e}`);
        }
      } finally {
        this.medindo = null;
      }
      return rede;
    })();
    return this.medindo;
  }

  /**
   * `GET /edge/rede`: o que a tela "Servidor local" mostra no servidor da loja. Medição de até 10 min
   * vale; mais velha (ou nenhuma), mede agora. Junta quantos PCs falaram com o servidor nos últimos
   * 3 min. Na nuvem a mesma informação vem pela saúde da batida (`minha-loja/servidor`).
   */
  async ler(tenantId: string): Promise<RedeLocal & { pcsConectados: number }> {
    if (!ehServidorLocal()) throw new ForbiddenException('Disponível apenas no servidor da loja.');
    const fresca = this.ultima && Date.now() - Date.parse(this.ultima.medidoEm) < 10 * 60_000;
    const rede = (fresca ? this.ultima : await this.medir()) ?? (await this.lerEstado<RedeLocal>('rede_info'));
    const vazia: RedeLocal = {
      nome: 'regem.local',
      maquina: hostname() || null,
      ip: null,
      interface: null,
      mac: null,
      gateway: null,
      outros: [],
      portas: this.portas(),
      desde: null,
      anterior: null,
      medidoEm: new Date().toISOString(),
    };
    return { ...(rede ?? vazia), pcsConectados: this.presenca?.pcsConectados(tenantId) ?? 0 };
  }
}
