import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CHAT OFICIAL DO iFOOD NA CENTRAL (Onda 1, PR 5 — decisão do dono de 02/11/2026: "oficial agora, ponte depois").
// O iFood não deixa um sistema ler nem escrever no chat do pedido; o caminho oficial é o WIDGET (Portal do
// Desenvolvedor › Widgets; doc "Widget", conferida em 02/11/2026): um script do iFood que mostra o chat entre a loja e o
// cliente, com as notificações e o acompanhamento do pedido, para até 10 lojas do iFood.
//   • O widget é da DISTRIBUIÇÃO: a Regem o cadastra no Portal do Desenvolvedor e põe o id em `IFOOD_WIDGET_ID` (env da
//     nuvem). Sem ele, o chat não aparece — nasce desligado. A loja não cria app nem manuseia credencial: na primeira vez,
//     cada computador autoriza com um usuário "Dono(a)" ou "Administrador(a)" do iFood (regra do iFood).
//   • As lojas do iFood (`merchantIds`) saem da integração da empresa (uma por empresa — índice único por empresa e
//     canal; o campo aceita mais de uma id separada por vírgula, como o `x-polling-merchants`), até 10.
//   • A integração mora só na nuvem (SO_NUVEM): no servidor da loja, a configuração vem de lá (V37); a tela separa
//     "não tem chat" de "não consegui ler agora".

export type ConfigDoChatIfood =
  | { disponivel: true; widgetId: string; merchantIds: string[] }
  | { disponivel: false; motivo: 'sem_widget' | 'sem_ifood' | 'sem_nuvem' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O limite do widget (doc: "de 1 a 10 merchants em uma sessão"). */
export const LOJAS_NO_WIDGET = 10;

@Injectable()
export class ChatIfoodService {
  private readonly logger = new Logger('ChatIfood');
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** O id do widget que a distribuição cadastrou no Portal do Desenvolvedor do iFood. Vazio = chat desligado. */
  static widgetId(): string {
    const v = String(process.env.IFOOD_WIDGET_ID ?? '').trim();
    return UUID.test(v) ? v : '';
  }

  /** A tela pede a configuração (na nuvem, daqui; no servidor da loja, à nuvem). */
  async config(tenantId: string): Promise<ConfigDoChatIfood> {
    if (ehServidorLocal()) return this.pelaNuvem();
    return this.montar(tenantId);
  }

  /** Na nuvem: o widget da distribuição e as lojas do iFood da integração da empresa (até 10). */
  async montar(tenantId: string): Promise<ConfigDoChatIfood> {
    const widgetId = ChatIfoodService.widgetId();
    if (!widgetId) return { disponivel: false, motivo: 'sem_widget' };
    const r: any = await this.db.execute(sql`
      select merchant_id as "merchantId" from integracao
       where tenant_id = ${tenantId} and canal = 'ifood' and ativo and coalesce(trim(merchant_id), '') <> ''`);
    const merchantIds = [
      ...new Set(((r.rows ?? r) as Array<{ merchantId: string }>).flatMap((x) => String(x.merchantId).split(/[\s,;]+/)).filter((m) => UUID.test(m))),
    ].slice(0, LOJAS_NO_WIDGET);
    if (!merchantIds.length) return { disponivel: false, motivo: 'sem_ifood' };
    return { disponivel: true, widgetId, merchantIds };
  }

  /** No servidor da loja: a configuração vem da nuvem (token do servidor). Sem resposta, "sem_nuvem" — nunca "sem chat". */
  private async pelaNuvem(): Promise<ConfigDoChatIfood> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) return { disponivel: false, motivo: 'sem_nuvem' };
    const res = await fetch(`${nuvem}/atendimento/chat-ifood-da-loja`, {
      headers: { 'x-sync-token': token },
      signal: AbortSignal.timeout(15_000),
    }).catch((e) => {
      this.logger.warn(`configuração do chat do iFood: a nuvem não respondeu (${e?.message ?? e})`);
      return null;
    });
    if (!res?.ok) {
      if (res) this.logger.warn(`configuração do chat do iFood: a nuvem respondeu ${res.status}`);
      return { disponivel: false, motivo: 'sem_nuvem' };
    }
    const j: any = await res.json().catch(() => null);
    if (j?.disponivel === true && typeof j.widgetId === 'string' && Array.isArray(j.merchantIds))
      return { disponivel: true, widgetId: j.widgetId, merchantIds: j.merchantIds.filter((m: unknown) => typeof m === 'string' && UUID.test(m)).slice(0, LOJAS_NO_WIDGET) };
    if (j?.disponivel === false && ['sem_widget', 'sem_ifood'].includes(j.motivo)) return { disponivel: false, motivo: j.motivo };
    return { disponivel: false, motivo: 'sem_nuvem' };
  }
}
