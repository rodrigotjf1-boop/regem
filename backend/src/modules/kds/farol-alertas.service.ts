import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { uuidDeChave } from '../../common/id-deterministico';
import { lojaLigadaAoCliente } from '../integracao-api/validar-token-integracao';
import { avisoDoFarol } from './alerta-kds';
import { AlertaKdsService } from './alerta-kds.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** O resultado que volta ao Farol: "chegou" e "mandei" são fatos diferentes — só diz entregue o que ficou guardado. */
export type ResultadoDoEnvio = { entregue: true } | { entregue: false; erro: string };

/** Quanto o transporte espera depois de cada tipo de falha (a credencial recusada não se resolve sozinha). */
const ESPERA_CREDENCIAL_MS = 5 * 60_000;
const ESPERA_FALHA_MS = 30_000;
const PRAZO_DA_CHAMADA_MS = 10_000;

/**
 * O FAROL NA COZINHA (auditoria do KDS de 11/11/2026, onda 3 — mig 412; contrato `docs/transporte-dos-alertas.md` e
 * `contratos/transporte-dos-alertas.json` do Farol). O Regem é um TRANSPORTE dos alertas do Farol: a cada 10 s, na NUVEM,
 * busca os envios de KDS (`POST /v1/envios/reivindicar`, `{ limite: 20, tipos: ["kds"] }`, com o token `fart_` da
 * distribuição), guarda cada um como aviso da cozinha da loja do Regem ligada (`alerta.loja.regem_loja_id`) e devolve o
 * resultado (`POST /v1/envios/:id/resultado`) — em até 2 minutos, senão o Farol manda de novo com o MESMO id (o id do
 * aviso sai do id do envio: o repetido não aparece duas vezes).
 *  • Só entra alerta de loja VIVA e LIGADA ao Farol (a mesma régua da porta de integração — V75): a loja de outra empresa
 *    ou que desligou o Farol volta como "não entregue", com o motivo.
 *  • A loja com servidor recebe pela sincronização (`entregar_na_loja`); em quais telas aparece decide cada KDS (o aviso
 *    "Farol" da aba Avisos).
 *  • Desligado enquanto faltar a configuração da distribuição: `FAROL_ALERTAS_URL` (a API do Farol) e
 *    `FAROL_ALERTAS_TOKEN` (o `fart_…` emitido por `npm run provisionar -- transporte regem kds` no Farol).
 */
@Injectable()
export class FarolAlertasService {
  private readonly logger = new Logger('FarolAlertas');
  private rodando = false;
  private esperarAte = 0;
  private avisouSemConfiguracao = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly alertas: AlertaKdsService,
  ) {}

  /** A configuração da distribuição, ou nulo (desligado). */
  static configuracao(env: NodeJS.ProcessEnv = process.env): { url: string; token: string } | null {
    const url = String(env.FAROL_ALERTAS_URL ?? '').trim().replace(/\/+$/, '');
    const token = String(env.FAROL_ALERTAS_TOKEN ?? '').trim();
    if (!/^https?:\/\//i.test(url) || !token.startsWith('fart_')) return null;
    return { url, token };
  }

  @Interval(10_000)
  async tick() {
    if (ehServidorLocal() || this.rodando || Date.now() < this.esperarAte) return;
    this.rodando = true;
    try {
      await this.umaVolta();
    } finally {
      this.rodando = false;
    }
  }

  /** Uma volta: busca, guarda e devolve o resultado de cada envio. Devolve o que fez (para o log e o teste). */
  async umaVolta(): Promise<{ levados: number; entregues: number; recusados: number } | null> {
    const cfg = FarolAlertasService.configuracao();
    if (!cfg) {
      if (!this.avisouSemConfiguracao) {
        this.avisouSemConfiguracao = true;
        this.logger.log('alertas do Farol no KDS desligados: falta FAROL_ALERTAS_URL ou FAROL_ALERTAS_TOKEN (fart_…).');
      }
      return null;
    }
    let envios: any[];
    try {
      const r = await this.chamar(cfg, '/v1/envios/reivindicar', { limite: 20, tipos: ['kds'] });
      envios = Array.isArray(r?.envios) ? r.envios : [];
    } catch (e: any) {
      const credencial = e?.status === 401 || e?.status === 403;
      this.esperarAte = Date.now() + (credencial ? ESPERA_CREDENCIAL_MS : ESPERA_FALHA_MS);
      this.logger.warn(
        credencial
          ? `o Farol recusou a credencial do transporte (FAROL_ALERTAS_TOKEN) — status ${e.status}; tenta de novo em 5 min`
          : `buscar os alertas do Farol falhou (tenta de novo em 30 s): ${e?.message ?? e}`,
      );
      return null;
    }
    let entregues = 0;
    let recusados = 0;
    for (const envio of envios) {
      const resultado = await this.entregar(envio);
      if (resultado.entregue) entregues++;
      else {
        recusados++;
        this.logger.warn(`alerta do Farol ${String(envio?.id ?? '?').slice(0, 8)} não entregue: ${resultado.erro}`);
      }
      try {
        await this.chamar(cfg, `/v1/envios/${encodeURIComponent(String(envio?.id ?? ''))}/resultado`, resultado);
      } catch (e: any) {
        // O Farol manda o envio de novo em 2 min, com o mesmo id: o aviso não se repete na tela (o id é o do envio).
        this.logger.warn(`resultado do alerta ${String(envio?.id ?? '?').slice(0, 8)} não chegou ao Farol (ele reenvia): ${e?.message ?? e}`);
      }
    }
    return { levados: envios.length, entregues, recusados };
  }

  /** Um envio → o aviso guardado da loja ligada, ou o motivo de não entregar. */
  async entregar(envio: any): Promise<ResultadoDoEnvio> {
    const a = avisoDoFarol(envio);
    if (!a.ok) return { entregue: false, erro: a.erro };
    let loja: { tenantId: string } | null;
    try {
      loja = await lojaLigadaAoCliente(this.db, 'farol', a.regemLojaId);
    } catch (e: any) {
      return { entregue: false, erro: `o Regem não conseguiu conferir a loja agora: ${e?.message ?? e}` };
    }
    if (!loja) return { entregue: false, erro: 'esta loja do Regem não existe mais ou não está ligada ao Farol' };
    const r = await this.alertas.guardarEMostrar(
      {
        id: uuidDeChave('farol-envio:', String(envio.id)),
        tenantId: loja.tenantId,
        unidadeId: a.regemLojaId,
        tipo: 'farol',
        titulo: a.titulo,
        detalhe: a.detalhe,
        prioridade: a.prioridade,
        fica: a.fica,
        duracaoSeg: a.duracaoSeg,
        origem: a.origem,
        ref: a.ref,
        naLoja: true,
      },
      { soNovo: true },
    );
    if (r.situacao === 'sem_gravar') return { entregue: false, erro: 'o Regem não conseguiu guardar o aviso agora' };
    return { entregue: true };
  }

  private async chamar(cfg: { url: string; token: string }, caminho: string, corpo: unknown): Promise<any> {
    const resp = await fetch(cfg.url + caminho, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      redirect: 'manual',
      signal: AbortSignal.timeout(PRAZO_DA_CHAMADA_MS),
    });
    if (!resp.ok) {
      const erro: any = new Error(`HTTP ${resp.status}`);
      erro.status = resp.status;
      throw erro;
    }
    const texto = await resp.text();
    return texto ? JSON.parse(texto) : {};
  }
}
