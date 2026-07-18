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
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
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

  // Progresso da instalação em curso: o atualizar.ps1 grava logs/update-status.json
  // a cada estágio (a tela mostra a barra e reconecta no reinício dos serviços).
  private lerProgresso(): {
    estagio: string;
    pct: number;
    versao: string | null;
    erro: string | null;
    ts: string | null;
  } | null {
    try {
      const f = join(process.cwd(), 'logs', 'update-status.json');
      if (!existsSync(f)) return null;
      const j = JSON.parse(readFileSync(f, 'utf8'));
      return {
        estagio: String(j.estagio ?? ''),
        pct: Number(j.pct ?? 0),
        versao: j.versao ?? null,
        erro: j.erro ?? null,
        ts: j.ts ?? null,
      };
    } catch {
      return null;
    }
  }

  // Estado conhecido (última verificação do daemon) + progresso da instalação.
  async statusAtualizacao() {
    this.garanteEdge();
    const disp = await this.getState('update_disponivel');
    return {
      atual: process.env.APP_VERSION ?? '1',
      disponivel: !!disp,
      ultima: disp || null,
      notas: (await this.getState('update_notas')) || null,
      progresso: this.lerProgresso(),
    };
  }

  // Disponibilidade do instalador (.exe). Roda na NUVEM: faz um HEAD no
  // EDGE_INSTALLER_URL server-side (evita CORS no navegador). A tela sempre mostra
  // o botão; ao clicar, decide baixar ou avisar "sem arquivo, contate a distribuição".
  async instalador(): Promise<{ disponivel: boolean; url: string | null }> {
    const url = (process.env.EDGE_INSTALLER_URL ?? '').trim();
    if (!url) return { disponivel: false, url: null };
    try {
      const res = await fetch(url, { method: 'HEAD' });
      return { disponivel: res.ok, url };
    } catch {
      return { disponivel: false, url };
    }
  }

  // Telemetria de FALHA de atualização, postada pelo edge (atualizar.ps1) para a
  // NUVEM. Não é do edge (sem garanteEdge). Registra o erro + fim do log e, se
  // DIST_ALERT_WEBHOOK estiver configurado, encaminha p/ a distribuição (n8n/etc.).
  async telemetriaErro(dto: any): Promise<{ ok: true }> {
    const tenantId = dto?.tenantId ?? 'desconhecido';
    const versao = dto?.versaoNova ?? dto?.versaoAtual ?? '?';
    this.logger.error(
      `[telemetria] ${dto?.tipo ?? 'erro'} tenant=${tenantId} versao=${versao}: ${dto?.erro ?? ''}`,
    );
    if (dto?.logTail) this.logger.error(`[telemetria] log:\n${String(dto.logTail).slice(0, 4000)}`);
    const hook = (process.env.DIST_ALERT_WEBHOOK ?? '').trim();
    if (hook) {
      try {
        await fetch(hook, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ origem: 'regem-edge', ...dto, recebidoEm: new Date().toISOString() }),
        });
      } catch (e: any) {
        this.logger.warn(`telemetria: falha ao encaminhar p/ distribuição: ${e?.message ?? e}`);
      }
    }
    return { ok: true };
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

  // ===== Restauração (voltar ao modo local após operar na nuvem) =====
  // Grava a flag; o sync-daemon executa os 2 tempos (empurra pendente → puxa a
  // nuvem) no próximo ciclo. Aditivo (upsert por id) — não apaga dado local.
  async solicitarRestauracao() {
    this.garanteEdge();
    if ((await this.getState('restaurando')) === '1')
      return { ok: true, jaEmAndamento: true };
    await this.setState('restaurar_solicitado', '1');
    return { ok: true };
  }

  async statusRestauracao() {
    this.garanteEdge();
    return {
      solicitado: (await this.getState('restaurar_solicitado')) === '1',
      restaurando: (await this.getState('restaurando')) === '1',
      restauradoEm: (await this.getState('restaurado_em')) || null,
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

  // Dispara o ROLLBACK manual (tarefa SYSTEM RegemEdgeRollback → reverter.ps1
  // restaura o dist/web do último backup). Só o gestor decide, e só faz sentido se
  // houve atualização recente que causou problema.
  async reverterAtualizacao() {
    this.garanteEdge();
    try {
      await pExecFile('schtasks', ['/run', '/tn', 'RegemEdgeRollback']);
      return { iniciada: true };
    } catch (e: any) {
      throw new InternalServerErrorException(
        `Não consegui iniciar o rollback: ${e.message}`,
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
