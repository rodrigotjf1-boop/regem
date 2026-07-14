import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Bonjour } from 'bonjour-service';
import { sql } from 'drizzle-orm';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';

const pExecFile = promisify(execFile);

/* eslint-disable @typescript-eslint/no-explicit-any */
// Descoberta do servidor local na LAN. SÓ roda no edge (EDGE_MODE=true) — a
// nuvem não anuncia mDNS. Publica `_regem._tcp` + hostname `regem.local` para
// os clientes (KDS/PDV/Ponto) acharem o servidor sem configurar IP.
@Injectable()
export class EdgeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Edge');
  private bonjour?: InstanceType<typeof Bonjour>;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  static get ehEdge(): boolean {
    return String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';
  }

  // ===== Atualização do servidor local (só no edge) =====
  // A VERIFICAÇÃO automática é feita pelo sync-daemon nas janelas de abertura da
  // loja e grava o estado em `sync_state`. Aqui o app (gestor) lê esse estado,
  // pode forçar uma verificação ao vivo e DISPARAR a instalação — que roda pela
  // tarefa SYSTEM `RegemEdgeUpdate` (atualizar.ps1, com backup + rollback).
  private garanteEdge() {
    if (!EdgeService.ehEdge)
      throw new ForbiddenException('Disponível apenas no servidor local (edge).');
  }

  private async getState(chave: string): Promise<string | null> {
    try {
      const r: any = await this.db.execute(
        sql`select valor from sync_state where chave = ${chave} limit 1`,
      );
      return (r.rows ?? r)[0]?.valor ?? null;
    } catch {
      return null;
    }
  }
  private async setState(chave: string, valor: string) {
    await this.db.execute(
      sql`insert into sync_state (chave, valor) values (${chave}, ${valor})
          on conflict (chave) do update set valor = ${valor}`,
    );
  }

  // Estado conhecido (última verificação do daemon).
  async statusAtualizacao() {
    this.garanteEdge();
    const disp = await this.getState('update_disponivel');
    return {
      atual: process.env.APP_VERSION ?? '1',
      disponivel: !!disp,
      ultima: disp || null,
      notas: (await this.getState('update_notas')) || null,
    };
  }

  // Verifica AO VIVO na nuvem agora (botão "Verificar atualização").
  async verificarAtualizacao() {
    this.garanteEdge();
    const cloud = (process.env.CLOUD_API ?? '').replace(/\/$/, '');
    if (!cloud)
      throw new InternalServerErrorException('CLOUD_API não configurada no servidor local.');
    const atual = process.env.APP_VERSION ?? '1';
    let info: any;
    try {
      const res = await fetch(
        `${cloud}/edge/update-check?versao=${encodeURIComponent(atual)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      info = await res.json();
    } catch (e: any) {
      return { ok: false, atual, disponivel: false, erro: `Sem resposta da nuvem: ${e.message}` };
    }
    if (info.atualizar) {
      await this.setState('update_disponivel', info.ultima ?? '');
      await this.setState('update_url', info.url ?? '');
      await this.setState('update_notas', info.notas ?? '');
    } else {
      await this.setState('update_disponivel', '');
    }
    return {
      ok: true,
      atual,
      disponivel: !!info.atualizar,
      ultima: info.ultima ?? null,
      notas: info.notas ?? null,
    };
  }

  // Dispara a instalação (a tarefa SYSTEM faz o trabalho pesado com rollback).
  async aplicarAtualizacao() {
    this.garanteEdge();
    const disp = await this.getState('update_disponivel');
    if (!disp)
      throw new BadRequestException('Não há atualização disponível. Verifique primeiro.');
    try {
      await pExecFile('schtasks', ['/run', '/tn', 'RegemEdgeUpdate']);
      return { iniciada: true, versao: disp };
    } catch (e: any) {
      throw new InternalServerErrorException(
        `Não consegui iniciar a atualização: ${e.message}`,
      );
    }
  }

  info() {
    return {
      regem: true,
      edge: EdgeService.ehEdge,
      versao: process.env.APP_VERSION ?? '1',
      unidadeId: process.env.EDGE_UNIDADE_ID ?? null,
      ts: new Date().toISOString(),
    };
  }

  // Compara "1.4.2" > "1.4.0" numericamente por segmento (não string).
  private static maior(a: string, b: string): boolean {
    const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] ?? 0;
      const y = pb[i] ?? 0;
      if (x !== y) return x > y;
    }
    return false;
  }

  // O edge pergunta "tem versão nova?". A nuvem responde com a última publicada
  // (env EDGE_LATEST_VERSION) + url do pacote assinado + notas. Sem segredo → público.
  // A aplicação em si (baixar/trocar/reiniciar) é feita pelo daemon/instalador no PC.
  atualizacao(versaoCliente?: string) {
    const ultima = process.env.EDGE_LATEST_VERSION ?? process.env.APP_VERSION ?? '1';
    const atual = versaoCliente || '0';
    return {
      atual,
      ultima,
      atualizar: EdgeService.maior(ultima, atual),
      url: process.env.EDGE_UPDATE_URL ?? null,
      sha256: process.env.EDGE_UPDATE_SHA256 ?? null,
      notas: process.env.EDGE_UPDATE_NOTAS ?? null,
      ts: new Date().toISOString(),
    };
  }

  onApplicationBootstrap() {
    if (!EdgeService.ehEdge) return; // nuvem não anuncia
    try {
      const porta = Number(process.env.PORT) || 3001;
      this.bonjour = new Bonjour();
      this.bonjour.publish({
        name: 'Regem Edge',
        type: 'regem',
        port: porta,
        host: 'regem.local',
        txt: { versao: process.env.APP_VERSION ?? '1', unidade: process.env.EDGE_UNIDADE_ID ?? '' },
      });
      this.logger.log(`mDNS publicado: _regem._tcp em regem.local:${porta}`);
    } catch (e: any) {
      this.logger.warn(`mDNS não pôde publicar: ${e?.message ?? e}`);
    }
  }

  onModuleDestroy() {
    try {
      this.bonjour?.unpublishAll();
      this.bonjour?.destroy();
    } catch {
      /* ignore */
    }
  }
}
