import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ehServidorLocal } from '../../common/modo';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { BoletimDoRamo, DIAS_DE_BOLETIM, RAMO_DA_EMPRESA_COM_BOLETIM, RAMO_DO_REGEM } from '../pulso/pulso.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// NOTÍCIAS DO RAMO (fase N1; protótipo `mockups/regem-noticias-do-ramo.html`, aprovado em 22/11/2026). A tela lê a cópia que
// a nuvem guarda do boletim do Pulso (mig 494). No servidor da loja a tabela não existe: ele pede à nuvem com o token do
// sincronismo, e sem internet a resposta diz `semNuvem` (a tela separa "não li" de "não tem", V37). É dado público, igual
// para todas as lojas; só a empresa de bares e restaurantes tem boletim (decisão N3).

export type RespostaDoBoletim = {
  semNuvem: boolean;
  dia: string | null;
  /** Os dias que têm boletim, do mais novo para o mais velho. */
  dias: string[];
  boletim: BoletimDoRamo | null;
};

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** O dia pedido, conferido no calendário de verdade (2026-02-31 não existe). Sem dia: o mais recente. */
export function diaDoPedido(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !DIA.test(v)) throw new BadRequestException('Escolha um dia válido.');
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new BadRequestException('Escolha um dia válido.');
  return v;
}

@Injectable()
export class NoticiasRamoService {
  private readonly logger = new Logger(NoticiasRamoService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private rows(r: any): any[] {
    return r?.rows ?? r ?? [];
  }

  /** Só empresa de bares e restaurantes: as outras nem sabem que a rota existe. */
  private async conferirRamo(tenantId: string): Promise<void> {
    const [e] = this.rows(await this.db.execute(sql`select ramo from empresa where id = ${tenantId}::uuid`));
    if (e?.ramo !== RAMO_DA_EMPRESA_COM_BOLETIM) throw new NotFoundException('Não há boletim para o ramo desta empresa.');
  }

  /** O que a tela pede: no servidor da loja vem da nuvem; na nuvem, da cópia. */
  async daTela(tenantId: string, diaPedido?: unknown): Promise<RespostaDoBoletim> {
    const dia = diaDoPedido(diaPedido);
    await this.conferirRamo(tenantId);
    return ehServidorLocal() ? this.daNuvem(dia) : this.daCopia(dia);
  }

  /** A rota que o servidor da loja chama na nuvem: a empresa vem do token do sincronismo. */
  async paraOServidorDaLoja(tenantId: string, diaPedido?: unknown): Promise<RespostaDoBoletim> {
    const dia = diaDoPedido(diaPedido);
    await this.conferirRamo(tenantId);
    return this.daCopia(dia);
  }

  private async daCopia(dia: string | null): Promise<RespostaDoBoletim> {
    const linhas = this.rows(await this.db.execute(sql`
      select dia::text as dia from pulso_boletim where ramo = ${RAMO_DO_REGEM} order by dia desc limit ${DIAS_DE_BOLETIM}`));
    const dias = linhas.map((l) => String(l.dia));
    const alvo = dia ?? dias[0] ?? null;
    if (!alvo) return { semNuvem: false, dia: null, dias, boletim: null };
    const [b] = this.rows(await this.db.execute(sql`
      select corpo from pulso_boletim where ramo = ${RAMO_DO_REGEM} and dia = ${alvo}::date`));
    return { semNuvem: false, dia: alvo, dias, boletim: (b?.corpo as BoletimDoRamo) ?? null };
  }

  /** Nunca rejeita por falta de internet: a loja sem nuvem é o caso esperado e a tela explica. */
  protected async daNuvem(dia: string | null): Promise<RespostaDoBoletim> {
    const semNuvem: RespostaDoBoletim = { semNuvem: true, dia, dias: [], boletim: null };
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) {
      this.logger.warn('notícias do ramo sem CLOUD_API/SYNC_TOKEN no servidor da loja');
      return semNuvem;
    }
    try {
      const consulta = dia ? `?dia=${encodeURIComponent(dia)}` : '';
      const res = await fetch(`${nuvem}/noticias-do-ramo/loja${consulta}`, { headers: { 'x-sync-token': token }, signal: AbortSignal.timeout(8_000) });
      if (res.status === 404) throw new NotFoundException('Não há boletim para o ramo desta empresa.');
      if (!res.ok) {
        this.logger.warn(`notícias do ramo: a nuvem respondeu ${res.status}`);
        return semNuvem;
      }
      const j: any = await res.json();
      if (!Array.isArray(j?.dias)) {
        this.logger.warn('notícias do ramo: a nuvem respondeu sem a lista de dias');
        return semNuvem;
      }
      return { semNuvem: false, dia: j.dia ?? null, dias: j.dias.map(String), boletim: j.boletim ?? null };
    } catch (e: any) {
      if (e instanceof NotFoundException) throw e;
      this.logger.warn(`notícias do ramo sem a nuvem: ${e?.cause?.code ?? e?.name ?? e?.message ?? e}`);
      return semNuvem;
    }
  }
}
