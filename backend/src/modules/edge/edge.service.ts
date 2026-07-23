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
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';

const pExecFile = promisify(execFile);

// LGPD: redige dados pessoais (e-mail/CPF/CNPJ/telefone) de textos de telemetria.
function redigirPII(s: string | null): string | null {
  if (!s) return s;
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '<cnpj>')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '<cpf>')
    .replace(/\b(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, '<tel>');
}

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

  // Telemetria de erro do edge (Frente A). Roda na NUVEM: persiste com DEDUP por
  // hash (mesmo erro só soma ocorrências), alerta a distribuição (DIST_ALERT_WEBHOOK)
  // na 1ª ocorrência ou em `fatal`. tenantId vem do sync token (rota autenticada).
  async registrarTelemetria(tenantId: string, dto: any): Promise<{ ok: true }> {
    const origem = String(dto?.origem ?? 'outro').slice(0, 20);
    const tipo = dto?.tipo ? String(dto.tipo).slice(0, 60) : null;
    const nivel = ['warn', 'error', 'fatal'].includes(dto?.nivel) ? dto.nivel : 'error';
    // LGPD: redige PII (e-mail/CPF/CNPJ/telefone) antes de persistir — o técnico
    // vê o erro técnico, não dado pessoal do cliente da loja.
    const mensagem = redigirPII(String(dto?.mensagem ?? dto?.erro ?? 'erro').slice(0, 2000)) ?? 'erro';
    const stack = dto?.stack
      ? redigirPII(String(dto.stack).slice(0, 8000))
      : dto?.logTail
        ? redigirPII(String(dto.logTail).slice(0, 8000))
        : null;
    const versao = dto?.versao ?? dto?.versaoNova ?? null;
    const fingerprint = dto?.fingerprint ?? null;
    const unidadeId = dto?.unidadeId ?? null;
    const contexto = dto?.contexto && typeof dto.contexto === 'object' ? dto.contexto : {};
    // Dedup: normaliza a mensagem (tira ids/números que variam) e faz o hash.
    const norm = mensagem
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>')
      .replace(/\d+/g, '#');
    const hash = createHash('sha256').update(`${origem}|${tipo}|${norm}`).digest('hex').slice(0, 32);

    let primeira = false;
    try {
      const r: any = await this.db.execute(sql`
        insert into telemetria_evento (tenant_id, unidade_id, origem, nivel, tipo, mensagem, hash, stack, contexto, versao, fingerprint)
        values (${tenantId}, ${unidadeId}, ${origem}, ${nivel}, ${tipo}, ${mensagem}, ${hash}, ${stack}, ${JSON.stringify(contexto)}::jsonb, ${versao}, ${fingerprint})
        on conflict (tenant_id, hash) do update
          set ocorrencias = telemetria_evento.ocorrencias + 1, ultimo_em = now(), resolvido = false,
              versao = coalesce(excluded.versao, telemetria_evento.versao),
              stack = coalesce(excluded.stack, telemetria_evento.stack)
        returning (xmax = 0) as inserido`);
      primeira = (r.rows ?? r)[0]?.inserido === true;
    } catch (e: any) {
      this.logger.warn(`telemetria: falha ao persistir: ${e?.message ?? e}`);
    }
    this.logger.error(`[telemetria] ${nivel}/${origem} tenant=${tenantId} v=${versao}: ${mensagem}`);
    const hook = (process.env.DIST_ALERT_WEBHOOK ?? '').trim();
    if (hook && (primeira || nivel === 'fatal')) {
      fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origem: 'regem-edge', tenantId, unidadeId, nivel, origemErro: origem, tipo, mensagem, versao, primeira, recebidoEm: new Date().toISOString() }),
      }).catch(() => {});
    }
    return { ok: true };
  }

  // Erro do FRONTEND (navegador). No edge, encaminha pra nuvem com o sync token
  // (tenant derivado lá); na nuvem, registra direto se vier tenantId. Dedup 5 min.
  private static frontEnviados = new Map<string, number>();
  async encaminharErroCliente(dto: any): Promise<{ ok: true }> {
    const msg = String(dto?.mensagem ?? dto?.message ?? 'erro no navegador').slice(0, 800);
    const hash = createHash('sha256').update(msg.replace(/\d+/g, '#')).digest('hex').slice(0, 16);
    const agora = Date.now();
    if (agora - (EdgeService.frontEnviados.get(hash) ?? 0) < 5 * 60 * 1000) return { ok: true };
    EdgeService.frontEnviados.set(hash, agora);
    const evento = {
      origem: 'frontend',
      nivel: 'error',
      tipo: 'front',
      mensagem: msg,
      stack: dto?.stack ? String(dto.stack).slice(0, 4000) : null,
      versao: dto?.versao ?? process.env.APP_VERSION ?? null,
      contexto: { url: dto?.url ?? null, userAgent: dto?.userAgent ?? null },
    };
    const cloud = (process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (EdgeService.ehEdge && cloud && token) {
      fetch(`${cloud}/edge/telemetria`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sync-token': token },
        body: JSON.stringify(evento),
      }).catch(() => {});
    } else if (dto?.tenantId) {
      await this.registrarTelemetria(String(dto.tenantId), evento).catch(() => {});
    } else {
      this.logger.warn(`[front] ${msg}`);
    }
    return { ok: true };
  }

  // Envia o log RECENTE do servidor local (arquivos ./logs/*.log, cauda) pra
  // distribuição, sob demanda do gestor. A PII é redigida na nuvem (registrarTelemetria).
  async enviarLogs(): Promise<{ ok: boolean; tamanho: number }> {
    this.garanteEdge();
    const cloud = (process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!cloud || !token)
      throw new BadRequestException('Nuvem não configurada no servidor local (CLOUD_API/SYNC_TOKEN).');
    const dir = join(process.cwd(), 'logs');
    const arquivos = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.log')) : [];
    let dump = '';
    // Prioriza os .err.log (erros). Cauda de ~10KB por arquivo.
    for (const f of [...arquivos].sort((a) => (a.includes('.err.') ? -1 : 1)).slice(0, 6)) {
      try {
        const c = readFileSync(join(dir, f), 'utf8');
        dump += `\n===== ${f} (fim) =====\n${c.slice(-10000)}`;
      } catch {
        /* ignora arquivo ilegível */
      }
    }
    if (!dump.trim()) throw new BadRequestException('Nenhum log encontrado em ./logs.');
    const res = await fetch(`${cloud}/edge/telemetria`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-token': token },
      body: JSON.stringify({
        origem: 'logdump',
        nivel: 'warn',
        tipo: 'log_recente',
        mensagem: 'Log recente enviado sob demanda pelo gestor',
        stack: dump.slice(0, 8000),
        versao: process.env.APP_VERSION ?? null,
      }),
    }).catch(() => null);
    return { ok: !!res && res.ok, tamanho: dump.length };
  }

  // ===== Comandos remotos (Fase 4) — o edge busca e confirma =====
  // O daemon do edge chama isto (x-sync-token) e executa o comando localmente.
  async comandosPendentes(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select id, comando from edge_comando
      where tenant_id = ${tenantId} and status = 'pendente'
      order by criado_em asc limit 10`);
    return r.rows ?? r;
  }
  async ackComando(tenantId: string, id: string, ok: boolean, resultado?: string) {
    await this.db.execute(sql`
      update edge_comando set status = ${ok ? 'executado' : 'erro'},
        resultado = ${resultado ?? null}, executado_em = now()
      where id = ${id} and tenant_id = ${tenantId}`);
    return { ok: true };
  }

  // Lista os eventos de telemetria do tenant (para o C&O ver os erros do seu edge).
  async listarTelemetria(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select id, origem, nivel, tipo, mensagem, ocorrencias, versao,
             primeiro_em as "primeiroEm", ultimo_em as "ultimoEm", resolvido
      from telemetria_evento where tenant_id = ${tenantId}
      order by resolvido asc, ultimo_em desc limit 100`);
    return r.rows ?? r;
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
  async atualizacao(versaoCliente?: string) {
    // Prioridade: o ÚLTIMO release publicado pelo console (tabela edge_release);
    // se não houver, cai no env (EDGE_LATEST_VERSION/URL/SHA/NOTAS) — compat.
    let rel: any = null;
    try {
      const r: any = await this.db.execute(
        sql`select versao, url, sha256, notas from edge_release order by publicado_em desc limit 1`,
      );
      rel = (r.rows ?? r)[0] ?? null;
    } catch {
      /* tabela pode não existir em edge — usa env */
    }
    const ultima = rel?.versao ?? process.env.EDGE_LATEST_VERSION ?? process.env.APP_VERSION ?? '1';
    const atual = versaoCliente || '0';
    return {
      atual,
      ultima,
      atualizar: EdgeService.maior(ultima, atual),
      url: rel?.url ?? process.env.EDGE_UPDATE_URL ?? null,
      sha256: rel?.sha256 ?? process.env.EDGE_UPDATE_SHA256 ?? null,
      notas: rel?.notas ?? process.env.EDGE_UPDATE_NOTAS ?? null,
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
