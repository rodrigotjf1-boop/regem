import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { EventEmitter } from 'events';
import { Client } from 'pg';
import { DRIZZLE, DrizzleDB, resolverSsl } from '../../db/drizzle.module';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Sinal de "entrou job na fila" para a ESPERA LONGA do agente de impressão (nuvem).
 *
 * O agente consultava a fila a cada 3 s: 20 requisições por minuto por agente — com 5 mil
 * lojas, 1.667 por segundo, ~10× todo o tráfego do sync. Agora a requisição fica aberta até
 * ~25 s e volta NA HORA quando um job da empresa entra.
 *
 * De onde vem o "na hora": o gatilho `trg_impressao_nova` (mig 092) já faz
 * `pg_notify('impressao_nova', id)` em todo insert — é o mesmo que o servidor local escuta.
 * Aqui UM cliente LISTEN por processo recebe o id, descobre a empresa (uma leitura pela chave)
 * e acorda só as esperas dela. O aviso chega no COMMIT, então o job já está visível.
 *
 * Sem LISTEN (conexão por pooler em modo transação, queda do banco) nada quebra: a espera
 * reconsulta a fila a cada 5 s por conta própria — pior caso, 5 s de atraso.
 * No servidor local (EDGE_MODE) não sobe: lá quem imprime é o impressao-daemon.
 */
@Injectable()
export class ImpressaoSinalService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ImpressaoSinal');
  private readonly eventos = new EventEmitter();
  private cliente: Client | null = null;
  private parado = false;
  private falhas = 0;
  // CONTADOR de avisos por empresa: quem vai esperar lê o contador ANTES de consultar a fila; se
  // ele andou até a espera começar (job entrou entre a consulta vazia e a espera), volta na hora
  // — senão o job esperaria a espera inteira. Contador e não horário: dois fatos no mesmo
  // milissegundo não se confundem.
  private readonly avisos = new Map<string, number>();
  // Até quando vale a pena descobrir a empresa de cada aviso: algum agente esperou no último minuto.
  // Sem agente nenhum neste processo, cada job gravado na nuvem custaria uma leitura à toa.
  private esperasAte = 0;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly config: ConfigService,
  ) {
    this.eventos.setMaxListeners(0); // uma espera por agente conectado
  }

  onModuleInit() {
    if (String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true') return;
    if (process.env.NODE_ENV === 'test') return;
    void this.conectar();
  }

  async onModuleDestroy() {
    this.parado = true;
    await this.cliente?.end().catch(() => {});
  }

  /** O LISTEN está de pé? Sem ele, quem espera precisa reconsultar por conta própria. */
  get ouvindo(): boolean {
    return !!this.cliente;
  }

  /** Marca do contador de avisos da empresa — ler ANTES de consultar a fila. */
  marca(tenantId: string): number {
    return this.avisos.get(tenantId) ?? 0;
  }

  /**
   * Espera um job novo da empresa ou o tempo acabar. Nunca rejeita.
   * `desde`: marca lida antes da consulta; se chegou aviso depois dela, volta na hora.
   */
  esperar(tenantId: string, ms: number, desde?: number): Promise<void> {
    this.esperasAte = Date.now() + 60_000 + Math.max(0, ms);
    if (desde != null && this.marca(tenantId) > desde) return Promise.resolve();
    return new Promise((resolve) => {
      const fim = () => {
        clearTimeout(timer);
        this.eventos.off(tenantId, fim);
        resolve();
      };
      const timer = setTimeout(fim, Math.max(0, ms));
      this.eventos.on(tenantId, fim);
    });
  }

  /** Acorda as esperas da empresa (também usado por quem enfileira neste processo). */
  avisar(tenantId: string) {
    this.marcar(tenantId);
    this.eventos.emit(tenantId);
  }

  private marcar(tenantId: string) {
    // Sem limpeza: uma entrada por empresa que já recebeu job neste processo (número pequeno).
    this.avisos.set(tenantId, this.marca(tenantId) + 1);
  }

  private async conectar() {
    if (this.parado) return;
    const connectionString = this.config.get<string>('DATABASE_URL');
    const ssl = resolverSsl(connectionString);
    const c = new Client({ connectionString, ...(ssl ? { ssl } : {}) });
    const cair = (motivo: string) => {
      if (this.cliente !== c) return;
      this.cliente = null;
      c.end().catch(() => {});
      this.reagendar(motivo);
    };
    c.on('error', (e: any) => cair(e?.code ?? e?.message ?? String(e)));
    c.on('end', () => cair('conexão encerrada'));
    c.on('notification', (n) => void this.aoNotificar(n.payload));
    try {
      await c.connect();
      await c.query('LISTEN impressao_nova');
      this.cliente = c;
      if (this.falhas) this.log.log('LISTEN impressao_nova restabelecido');
      this.falhas = 0;
    } catch (e: any) {
      c.end().catch(() => {});
      this.reagendar(e?.message ?? String(e));
    }
  }

  private reagendar(motivo: string) {
    if (this.parado) return;
    this.falhas++;
    const espera = Math.min(60_000, 2_000 * 2 ** Math.min(this.falhas - 1, 5));
    // Loga a 1ª falha e depois só de vez em quando (a espera longa segue funcionando sem isto).
    if (this.falhas === 1 || this.falhas % 10 === 0)
      this.log.warn(`LISTEN indisponível (${motivo}) — a fila segue por reconsulta a cada 5 s; nova tentativa em ${espera / 1000}s`);
    setTimeout(() => void this.conectar(), espera);
  }

  private async aoNotificar(id?: string) {
    if (!id || Date.now() > this.esperasAte) return; // nenhum agente por aqui: nem consulta
    try {
      const r: any = await this.db.execute(sql`select tenant_id from impressao_job where id = ${id}`);
      const t = (r.rows ?? r)[0]?.tenant_id;
      if (t) this.avisar(String(t));
    } catch {
      /* a espera reconsulta sozinha em até 5 s */
    }
  }
}
