import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';

// PRESENÇA DOS PCs DA LOJA (conexão PC ↔ servidor, parte 1 — plano do dono de 20/10/2026).
//
// O "último uso" do terminal só marca quando o caixa faz uma operação: um PC ligado e parado aparecia
// como "nunca usado", e o dono revogou o terminal de um PC que estava conectado (18/10). Agora o app
// aberto avisa o servidor a cada 30 s (`POST /edge/presenca`) e a estação de impressão, na batida de
// cada minuto. Cada aviso diz o IP do PC e por onde ele chega ao servidor (`regem.local` ou um IP).
//
// SÓ NO SERVIDOR DA LOJA, e em memória de propósito: é o "agora" (refaz-se em 30 s depois de um
// reinício), e gravar a cada 30 s por PC só geraria escrita e sincronismo à toa. O servidor da loja é
// UM processo; na nuvem nada é anotado (lá a presença chega pela saúde da batida). Para a nuvem vai um
// resumo por minuto em `sync_state` (chave `presenca`), que o sync-daemon põe na saúde da batida.

/** Terminal de PDV, sub-PDV do salão (o tablet do garçom pareia igual) e estação de impressão. */
export type TipoPresente = 'pdv' | 'salao' | 'estacao_impressao';
export const TIPOS_PRESENTES: readonly TipoPresente[] = ['pdv', 'salao', 'estacao_impressao'];

export type Presenca = {
  id: string;
  tenantId: string;
  tipo: TipoPresente;
  /** O IP do PC na rede da loja. */
  ip: string | null;
  /** Por onde o PC chega ao servidor: `regem.local` ou um IP. */
  endereco: string | null;
  /** O nome do PC no Windows (a estação manda; o navegador não sabe). */
  maquina: string | null;
  versao: string | null;
  vistoEm: string;
};

/** Visto há mais que isto: some do "agora" (e do resumo para a nuvem). */
export const JANELA_PRESENCA_MS = 10 * 60_000;

/** O IP do PC como o Express o entrega ("::ffff:192.168.0.23" → "192.168.0.23"). */
export function ipDoPc(bruto: unknown): string | null {
  const s = String(bruto ?? '').trim().replace(/^::ffff:/i, '');
  if (!s || s.length > 64) return null;
  return /^[0-9a-f.:]+$/i.test(s) ? s : null;
}

/** O endereço que o PC usou para chegar ao servidor, sem a porta ("regem.local:3002" → "regem.local"). */
export function enderecoDoHost(host: unknown): string | null {
  const s = String(host ?? '').trim().toLowerCase();
  if (!s || s.length > 255) return null;
  const semPorta = s.startsWith('[') ? s.slice(1, s.indexOf(']') > 0 ? s.indexOf(']') : undefined) : s.replace(/:\d+$/, '');
  return /^[a-z0-9.\-:]+$/.test(semPorta) ? semPorta.slice(0, 120) : null;
}

@Injectable()
export class PresencaService {
  private readonly log = new Logger('Presenca');
  private readonly mapa = new Map<string, Presenca>();
  private ultimoAviso = 0;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** Anota que o PC falou agora. Fora do servidor da loja não anota nada. */
  notar(p: Omit<Presenca, 'vistoEm'>, agora: Date = new Date()): void {
    if (!ehServidorLocal() || !p?.id || !p.tenantId) return;
    this.mapa.set(p.id, { ...p, vistoEm: agora.toISOString() });
  }

  /** Os PCs desta empresa vistos na janela, do mais recente ao mais antigo. */
  doTenant(tenantId: string, agoraMs: number = Date.now()): Presenca[] {
    return [...this.mapa.values()]
      .filter((p) => p.tenantId === tenantId && agoraMs - Date.parse(p.vistoEm) <= JANELA_PRESENCA_MS)
      .sort((a, b) => Date.parse(b.vistoEm) - Date.parse(a.vistoEm));
  }

  /** Quantos PCs (IPs diferentes) falaram com o servidor no último `dentroDeMs`. */
  pcsConectados(tenantId: string, dentroDeMs = 3 * 60_000, agoraMs: number = Date.now()): number {
    const ips = new Set<string>();
    for (const p of this.doTenant(tenantId, agoraMs)) {
      if (agoraMs - Date.parse(p.vistoEm) <= dentroDeMs) ips.add(p.ip ?? `sem-ip:${p.id}`);
    }
    return ips.size;
  }

  /**
   * O resumo que a nuvem recebe: a cada minuto, os PCs vistos na janela vão para `sync_state` e o
   * sync-daemon os manda na saúde da batida. Nunca rejeita (V3); sem a tabela (servidor ainda sem o
   * sync-daemon), só avisa uma vez por hora.
   */
  @Interval(60_000)
  async gravarResumo(agoraMs: number = Date.now()): Promise<void> {
    if (!ehServidorLocal()) return;
    try {
      for (const [id, p] of this.mapa) if (agoraMs - Date.parse(p.vistoEm) > JANELA_PRESENCA_MS) this.mapa.delete(id);
      const pcs = [...this.mapa.values()].map((p) => ({
        id: p.id,
        tipo: p.tipo,
        ip: p.ip,
        endereco: p.endereco,
        maquina: p.maquina,
        versao: p.versao,
        vistoEm: p.vistoEm,
      }));
      const valor = JSON.stringify({ em: new Date(agoraMs).toISOString(), pcs });
      await this.db.execute(sql`
        insert into sync_state (chave, valor) values ('presenca', ${valor})
        on conflict (chave) do update set valor = excluded.valor`);
    } catch (e: any) {
      if (agoraMs - this.ultimoAviso > 3_600_000) {
        this.ultimoAviso = agoraMs;
        this.log.warn(`resumo da presença dos PCs não gravado: ${e?.message ?? e} — a nuvem fica sem ele até a próxima vez`);
      }
    }
  }
}
