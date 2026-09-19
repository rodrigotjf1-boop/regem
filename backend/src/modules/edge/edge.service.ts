import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Bonjour } from 'bonjour-service';
import { hostname } from 'os';
import { sql } from 'drizzle-orm';
import { comandosDoServidor } from '../../common/edge-comando';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { MIN_CLIENT_VERSION, MIN_SERVER_VERSION } from './versao';
import { TelemetriaBridge } from '../../common/telemetria-bridge';
import { exigirBooleano } from '../../common/exigir';
import {
  ReleaseLinha,
  compararVersao,
  escolherRelease,
  versaoRecolhida,
} from './release-selecao';

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

  private static cacheReleases: { em: number; rels: ReleaseLinha[] } | null = null;

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
    fase: string;
    estagio: string;
    pct: number;
    versao: string | null;
    baixadoMb: number | null;
    totalMb: number | null;
    erro: string | null;
    acaoFinal: string | null;
    ts: string | null;
  } | null {
    try {
      const f = join(process.cwd(), 'logs', 'update-status.json');
      if (!existsSync(f)) return null;
      // O PowerShell 5.1 grava UTF-8 COM BOM: sem tirar, o JSON.parse falhava e a barra de
      // progresso nunca aparecia (ERR-055).
      const j = JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
      const estagio = String(j.estagio ?? '');
      // `fase` deriva do estágio (compat com pacotes antigos que não a gravam):
      // baixando → download; ok/erro → terminal; o resto → instalação.
      const fase =
        j.fase ??
        (estagio === 'baixando'
          ? 'baixando'
          : estagio === 'ok' || estagio === 'erro'
            ? estagio
            : 'instalando');
      return {
        fase: String(fase),
        estagio,
        pct: Number(j.pct ?? 0),
        versao: j.versao ?? null,
        baixadoMb: j.baixadoMb != null ? Number(j.baixadoMb) : null,
        totalMb: j.totalMb != null ? Number(j.totalMb) : null,
        erro: j.erro ?? null,
        acaoFinal: j.acaoFinal ?? null,
        ts: j.ts ?? null,
      };
    } catch {
      return null;
    }
  }

  // Estado conhecido (última verificação do daemon) + progresso da instalação + o que a tela
  // precisa para decidir (agendada? versão revertida/recolhida? loja em operação?).
  async statusAtualizacao() {
    this.garanteEdge();
    const disp = await this.getState('update_disponivel');
    const revertida = this.versaoRevertida();
    return {
      atual: process.env.APP_VERSION ?? '1',
      disponivel: !!disp,
      ultima: disp || null,
      notas: (await this.getState('update_notas')) || null,
      agendadaPara: (await this.getState('update_agendado_para')) || null,
      // O gestor reverteu ESTA versão antes — instalar de novo exige confirmação.
      revertida: !!disp && revertida === disp,
      // A distribuição RECOLHEU a versão que este servidor roda (a tela avisa).
      versaoAtualRecolhida: (await this.getState('update_atual_recolhida')) === '1',
      emOperacao: await this.operacaoEmAndamento(),
      progresso: this.lerProgresso(),
    };
  }

  // A loja está operando? (caixa aberto nas últimas 16 h ou pedido em produção nas últimas
  // 3 h, desta loja ou "da rede"). Instalar reinicia os serviços por 1–2 min — como as travas
  // de atualização do balena (updates.lock), a instalação espera a operação terminar; o gestor
  // pode forçar ou agendar. Caixa esquecido aberto há dias NÃO trava para sempre (janela de 16 h).
  async operacaoEmAndamento(): Promise<{ caixasAbertos: number; pedidosEmProducao: number }> {
    const loja = process.env.EDGE_UNIDADE_ID || null;
    try {
      const r: any = await this.db.execute(sql`
        select
          (select count(*)::int from caixa_sessao
            where status = 'aberta' and aberta_em > now() - interval '16 hours'
              and (${loja}::uuid is null or unidade_id = ${loja}::uuid or unidade_id is null)) as caixas,
          (select count(*)::int from producao_pedido
            where status in ('recebido', 'preparo') and created_at > now() - interval '3 hours'
              and (${loja}::uuid is null or unidade_id = ${loja}::uuid or unidade_id is null)) as pedidos`);
      const row = (r.rows ?? r)[0] ?? {};
      return { caixasAbertos: Number(row.caixas ?? 0), pedidosEmProducao: Number(row.pedidos ?? 0) };
    } catch (e: any) {
      this.logger.warn(`operacaoEmAndamento: ${e?.message ?? e}`);
      return { caixasAbertos: 0, pedidosEmProducao: 0 };
    }
  }

  // Versão que o gestor REVERTEU por último (o reverter.ps1 grava logs/update-revertida.txt;
  // o atualizar.ps1 apaga ao instalar outra com sucesso).
  private versaoRevertida(): string | null {
    try {
      const f = join(process.cwd(), 'logs', 'update-revertida.txt');
      return existsSync(f) ? readFileSync(f, 'utf8').replace(/^\uFEFF/, '').trim() || null : null;
    } catch {
      return null;
    }
  }

  // Uma instalação/reversão está rodando AGORA? (status gravado pelo atualizar.ps1 nos
  // últimos 20 min e ainda não terminou). Evita o clique duplo matar a execução em curso.
  private atualizacaoEmCurso(): boolean {
    const p = this.lerProgresso();
    if (!p || p.fase === 'ok' || p.fase === 'erro') return false;
    const ts = p.ts ? Date.parse(p.ts) : NaN;
    return Number.isFinite(ts) && Date.now() - ts < 20 * 60 * 1000;
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
    // Falha de instalação/atualização do edge (postada por instalar-tudo.ps1 /
    // atualizar.ps1). PERSISTE no store da telemetria (aparece no console da
    // distribuição) e dispara o alerta — reusa registrarTelemetria, que também redige
    // PII. tenantId só entra se for um UUID válido; senão NULL (erro global da nuvem).
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const tenantId =
      typeof dto?.tenantId === 'string' && uuidRe.test(dto.tenantId) ? dto.tenantId : null;
    await this.registrarTelemetria(tenantId, {
      origem: 'update',
      nivel: dto?.tipo === 'install_falha' ? 'fatal' : 'error',
      tipo: dto?.tipo ?? 'erro',
      mensagem: dto?.erro ?? 'erro',
      stack: dto?.logTail ?? null,
      versao: dto?.versaoNova ?? dto?.versaoAtual ?? null,
      contexto: { fingerprint: dto?.fingerprint ?? null, modo: dto?.modo ?? null },
    }).catch((e: any) =>
      this.logger.warn(`telemetriaErro: falha ao persistir: ${e?.message ?? e}`),
    );
    return { ok: true };
  }

  // Verifica AO VIVO na nuvem agora (botão "Verificar atualização"). Manda o token do
  // servidor: a nuvem decide se ESTA loja já está na fatia do release (distribuição escalonada).
  async verificarAtualizacao() {
    this.garanteEdge();
    const cloud = (process.env.CLOUD_API ?? '').replace(/\/$/, '');
    if (!cloud)
      throw new InternalServerErrorException('CLOUD_API não configurada no servidor local.');
    const atual = process.env.APP_VERSION ?? '1';
    const token = process.env.SYNC_TOKEN ?? '';
    let info: any;
    try {
      const res = await fetch(`${cloud}/edge/update-check?versao=${encodeURIComponent(atual)}`, {
        headers: token ? { 'x-sync-token': token } : {},
      });
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
    await this.setState('update_atual_recolhida', info.versaoAtualRecolhida ? '1' : '');
    return {
      ok: true,
      atual,
      disponivel: !!info.atualizar,
      ultima: info.ultima ?? null,
      notas: info.notas ?? null,
      versaoAtualRecolhida: !!info.versaoAtualRecolhida,
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
      // Progresso (linhas aplicadas até agora) + último erro — p/ a UI mostrar barra e
      // feedback em vez de ficar caixa-preta (o daemon grava restore_progresso/restore_erro).
      progresso: Number((await this.getState('restore_progresso')) || 0),
      erro: (await this.getState('restore_erro')) || null,
    };
  }

  // Dispara a instalação (a tarefa SYSTEM faz o trabalho pesado com rollback) ou AGENDA.
  //   { forcar?: boolean, agendarPara?: ISO | null }
  //   • instalação/reversão já em curso → 409 (antes o clique duplo fazia /end e matava a que
  //     estava rodando — ERR-052);
  //   • versão que o gestor já reverteu → 409 com revertida:true (confirmar com forcar);
  //   • loja operando (caixa aberto / pedido em produção) → 409 com emOperacao (forcar ou agendar);
  //   • agendarPara → grava; o sync-daemon dispara na hora, se a loja estiver parada.
  async aplicarAtualizacao(dto: any = {}) {
    this.garanteEdge();
    const disp = await this.getState('update_disponivel');
    if (!disp)
      throw new BadRequestException('Não há atualização disponível. Verifique primeiro.');
    if (this.atualizacaoEmCurso())
      throw new ConflictException({ message: 'Uma atualização já está em andamento. Acompanhe o progresso.', details: { emCurso: true } });

    const forcar = dto?.forcar === undefined ? false : exigirBooleano(dto.forcar, 'forcar');
    if (dto?.agendarPara !== undefined) {
      if (dto.agendarPara === null || dto.agendarPara === '') {
        await this.setState('update_agendado_para', '');
        return { agendadaPara: null };
      }
      const t = Date.parse(String(dto.agendarPara));
      const agora = Date.now();
      if (!Number.isFinite(t) || t < agora - 60_000 || t > agora + 7 * 86400_000)
        throw new BadRequestException('Escolha um horário entre agora e os próximos 7 dias.');
      const iso = new Date(t).toISOString();
      await this.setState('update_agendado_para', iso);
      return { agendadaPara: iso, versao: disp };
    }

    if (!forcar) {
      const revertida = this.versaoRevertida();
      if (revertida && revertida === disp)
        throw new ConflictException({
          message: `Você reverteu a versão ${disp} antes. Confirme para instalar de novo.`,
          details: { revertida: true, versao: disp },
        });
      const op = await this.operacaoEmAndamento();
      if (op.caixasAbertos || op.pedidosEmProducao)
        throw new ConflictException({
          message: 'A loja está em operação: a instalação reinicia os serviços por 1–2 minutos. Agende para depois do fechamento ou confirme para instalar agora.',
          details: { emOperacao: op },
        });
    }
    await this.setState('update_agendado_para', '');
    // Só uma execução PRESA (status parado há mais de 20 min, ou sem status) é encerrada antes
    // do novo disparo; uma em curso nunca chega aqui (409 acima).
    try {
      await pExecFile('schtasks', ['/end', '/tn', 'RegemEdgeUpdate']);
    } catch {
      /* sem execução presa — segue */
    }
    try {
      await pExecFile('schtasks', ['/run', '/tn', 'RegemEdgeUpdate']);
      return { iniciada: true, versao: disp };
    } catch (e: any) {
      throw new InternalServerErrorException(
        `Não consegui iniciar a atualização: ${e.message}`,
      );
    }
  }

  // Dispara o ROLLBACK manual (tarefa SYSTEM RegemEdgeRollback → reverter.ps1 devolve o
  // conjunto inteiro da versão anterior). Nunca junto com uma instalação em curso.
  async reverterAtualizacao() {
    this.garanteEdge();
    if (this.atualizacaoEmCurso())
      throw new ConflictException({ message: 'Uma atualização está em andamento. Aguarde terminar para reverter.', details: { emCurso: true } });
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
  async registrarTelemetria(tenantId: string | null, dto: any): Promise<{ ok: true }> {
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
        values (${tenantId ?? null}, ${unidadeId}, ${origem}, ${nivel}, ${tipo}, ${mensagem}, ${hash}, ${stack}, ${JSON.stringify(contexto)}::jsonb, ${versao}, ${fingerprint})
        on conflict (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), hash) do update
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
  // Só os comandos DESTE servidor (mig 269) + os antigos sem destino.
  async comandosPendentes(tenantId: string, equipamentoId?: string | null) {
    return comandosDoServidor(this.db, tenantId, equipamentoId);
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

  // Handshake de compatibilidade (Fase 1.3): versão do servidor + faixas aceitas.
  handshake() {
    return {
      server: process.env.APP_VERSION ?? '0.0.0',
      minClient: MIN_CLIENT_VERSION, // cliente mais antigo aceito por este servidor
      minServer: MIN_SERVER_VERSION, // servidor mais antigo que o cliente deve aceitar
      api: 'v1',
    };
  }

  // Releases publicados, com cache de 30 s (o heartbeat de TODAS as lojas passa por aqui a
  // cada minuto). Sem a migration 270 (42703) lê as colunas antigas — tudo em 100%. No servidor
  // local a tabela não existe (42P01) → lista vazia → env.
  private async carregarReleases(): Promise<ReleaseLinha[]> {
    const agora = Date.now();
    const c = EdgeService.cacheReleases;
    if (c && agora - c.em < 30_000) return c.rels;
    let rels: ReleaseLinha[] = [];
    try {
      const r: any = await this.db.execute(
        sql`select versao, url, sha256, assinatura, assinatura_v2, expira_em, notas, percentual,
                   lojas_piloto, pausado, recolhido, publicado_em
              from edge_release order by publicado_em desc limit 50`,
      );
      rels = (r.rows ?? r) as ReleaseLinha[];
    } catch (e: any) {
      if (e?.code === '42703' || e?.cause?.code === '42703') {
        try {
          const r: any = await this.db.execute(
            sql`select versao, url, sha256, assinatura, notas, publicado_em
                  from edge_release order by publicado_em desc limit 50`,
          );
          rels = (r.rows ?? r) as ReleaseLinha[];
        } catch {
          /* segue para o env */
        }
      }
    }
    EdgeService.cacheReleases = { em: agora, rels };
    return rels;
  }

  // O edge pergunta "tem versão nova?". Sem segredo → público. Responde com o release que
  // ESTA loja deve receber (distribuição escalonada — release-selecao.ts): quem manda o token do
  // servidor (x-sync-token) entra no piloto/percentual; sem token (servidores na 1.29.x) só vê
  // release em 100%. A aplicação em si (baixar/trocar/reiniciar) é do atualizar.ps1 no PC.
  async atualizacao(versaoCliente?: string, tenantId: string | null = null) {
    // Prioridade: os releases publicados pelo console (tabela edge_release); sem nenhum,
    // cai no env (EDGE_LATEST_VERSION/URL/SHA/NOTAS) — compat.
    const rels = await this.carregarReleases();
    const atual = versaoCliente || '0';
    const rel = rels.length ? escolherRelease(rels, tenantId) : null;
    const expira = rel?.expira_em ? new Date(rel.expira_em as any).toISOString() : null;
    const ultima =
      rel?.versao ??
      (rels.length ? atual : (process.env.EDGE_LATEST_VERSION ?? process.env.APP_VERSION ?? '1'));
    const doEnv = !rels.length;
    return {
      atual,
      ultima,
      atualizar: compararVersao(ultima, atual) > 0,
      url: rel?.url ?? (doEnv ? process.env.EDGE_UPDATE_URL ?? null : null),
      sha256: rel?.sha256 ?? (doEnv ? process.env.EDGE_UPDATE_SHA256 ?? null : null),
      // v1 = Ed25519 de "versao|sha256|url" (servidores na versão anterior conferem esta);
      // v2 = de "regem-edge-v2|versao|sha256|url|expiraEm" (com validade). Ver verify-update.mjs.
      assinatura: rel?.assinatura ?? (doEnv ? process.env.EDGE_UPDATE_SIG ?? null : null),
      assinaturaV2: rel?.assinatura_v2 ?? null,
      expiraEm: rel?.assinatura_v2 ? expira : null,
      notas: rel?.notas ?? (doEnv ? process.env.EDGE_UPDATE_NOTAS ?? null : null),
      // A versão que a loja roda foi RECOLHIDA pela distribuição (a tela avisa o gestor).
      versaoAtualRecolhida: versaoRecolhida(rels, versaoCliente),
      ts: new Date().toISOString(),
    };
  }

  onApplicationBootstrap() {
    if (!EdgeService.ehEdge) {
      // Nuvem: arma o sink da telemetria — o logger e o filtro global de exceção
      // (criados antes do DI) passam a gravar os erros DIRETO no store, sem HTTP.
      // Assim a distribuição vê também as falhas da NUVEM (não só as do edge).
      TelemetriaBridge.registrar((tenantId, dto) => {
        void this.registrarTelemetria(tenantId, dto).catch(() => {});
      });
      return; // nuvem não anuncia mDNS
    }
    try {
      const porta = Number(process.env.PORT) || 3001;
      this.bonjour = new Bonjour();
      // Nome da INSTÂNCIA único por máquina: com o nome fixo 'Regem Edge', dois servidores na
      // mesma rede (ex.: Matriz e Filial no mesmo prédio, ou um reserva) colidem e o segundo
      // DESISTE de anunciar — a biblioteca só escreve no console. Os apps procuram pelo TIPO
      // (_regem._tcp), que não muda.
      const nome = `Regem Edge ${hostname()}`.slice(0, 63);
      const svc: any = this.bonjour.publish({
        name: nome,
        type: 'regem',
        port: porta,
        host: 'regem.local',
        txt: { versao: process.env.APP_VERSION ?? '1', unidade: process.env.EDGE_UNIDADE_ID ?? '' },
      });
      // Antes logava "publicado" ANTES de saber: com conflito, o log dizia publicado e o servidor
      // ficava invisível para o KDS/Ponto. Agora só confirma no 'up'; sem 'up' em 15 s, avisa.
      let anunciado = false;
      svc?.on?.('up', () => {
        anunciado = true;
        this.logger.log(`mDNS publicado: "${nome}" _regem._tcp em regem.local:${porta}`);
      });
      setTimeout(() => {
        if (!anunciado)
          this.logger.warn(`mDNS NÃO anunciado em 15 s ("${nome}") — nome em uso na rede ou mDNS bloqueado; KDS/Ponto não acharão o servidor sozinhos`);
      }, 15_000).unref();
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
