import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { exigirBooleano } from '../../common/exigir';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';

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
  | { disponivel: false; motivo: 'sem_widget' | 'sem_ifood' | 'sem_nuvem' | 'desligado' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O limite do widget (doc: "de 1 a 10 merchants em uma sessão"). */
export const LOJAS_NO_WIDGET = 10;

// OS AJUSTES DO iFOOD NA CENTRAL (protótipo, grupo "iFood · disputas e chat"): mostrar o chat do iFood na tela
// Atendimento; avisar o gerente quando chega uma disputa (no app e no computador de quem é gerente ou presidente); avisar
// de novo quando faltarem 1, 2 ou 3 minutos, se ninguém respondeu. Moram na integração do iFood da empresa
// (`integracao.config.atendimentoIfood`, só na nuvem), gravados por chave (V82). Sem ajuste, os padrões.
// `avaliacoes` (06/11/2026): "Avaliações do iFood na fila" — a rotina da nuvem traz as avaliações que pedem uma pessoa
// como caso (`integracoes/ifood/ifood-avaliacao.ts`). Nasce DESLIGADO: precisa do módulo de avaliações liberado no iFood.
export type AjusteIfood = { chat: boolean; avisarDisputa: boolean; avisarDeNovoMin: number; avaliacoes: boolean };
export const AJUSTE_IFOOD_PADRAO: AjusteIfood = { chat: true, avisarDisputa: true, avisarDeNovoMin: 2, avaliacoes: false };
export const MINUTOS_DE_NOVO = [1, 2, 3] as const;

/** O que a tela mandou para o grupo do iFood, conferido (V15: liga/desliga só com booleano; V16: ausente fica de fora). */
export function lerAjusteIfood(dto: unknown): Partial<AjusteIfood> {
  const d = (dto ?? {}) as Record<string, unknown>;
  const parcial: Partial<AjusteIfood> = {};
  if (d.chat !== undefined) parcial.chat = exigirBooleano(d.chat, 'chat');
  if (d.avisarDisputa !== undefined) parcial.avisarDisputa = exigirBooleano(d.avisarDisputa, 'avisarDisputa');
  if (d.avaliacoes !== undefined) parcial.avaliacoes = exigirBooleano(d.avaliacoes, 'avaliacoes');
  if (d.avisarDeNovoMin !== undefined) {
    const m = typeof d.avisarDeNovoMin === 'number' ? d.avisarDeNovoMin : NaN;
    if (!(MINUTOS_DE_NOVO as readonly number[]).includes(m)) throw new BadRequestException('Avisar de novo: escolha 1, 2 ou 3 minutos.');
    parcial.avisarDeNovoMin = m;
  }
  return parcial;
}

/** O ajuste gravado, com o padrão no que falta (e no que veio torto). */
function ajusteDe(bruto: unknown): AjusteIfood {
  const a = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  return {
    chat: typeof a.chat === 'boolean' ? a.chat : AJUSTE_IFOOD_PADRAO.chat,
    avisarDisputa: typeof a.avisarDisputa === 'boolean' ? a.avisarDisputa : AJUSTE_IFOOD_PADRAO.avisarDisputa,
    avisarDeNovoMin: (MINUTOS_DE_NOVO as readonly number[]).includes(a.avisarDeNovoMin as number) ? (a.avisarDeNovoMin as number) : AJUSTE_IFOOD_PADRAO.avisarDeNovoMin,
    avaliacoes: typeof a.avaliacoes === 'boolean' ? a.avaliacoes : AJUSTE_IFOOD_PADRAO.avaliacoes,
  };
}

@Injectable()
export class ChatIfoodService {
  private readonly logger = new Logger('ChatIfood');
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // Quem mudou o ajuste fica na auditoria. Opcional: os testes montam o serviço só com o banco.
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** A integração do iFood da empresa (uma por empresa e canal): a config e se está ligada. Só na nuvem. */
  private async integracao(tenantId: string): Promise<{ ativo: boolean; config: any } | null> {
    const r: any = await this.db.execute(sql`
      select ativo, config from integracao where tenant_id = ${tenantId} and canal = 'ifood' order by ativo desc limit 1`);
    return (r.rows ?? r)[0] ?? null;
  }

  /** Os ajustes do grupo do iFood (a tela de ajustes). Sem a integração, `conectadoIfood: false`. */
  async ajustes(tenantId: string): Promise<{ conectadoIfood: boolean; ajusteIfood: AjusteIfood | null; minutosDeNovo: readonly number[] }> {
    const ig = await this.integracao(tenantId);
    return { conectadoIfood: !!ig?.ativo, ajusteIfood: ig?.ativo ? ajusteDe(ig.config?.atendimentoIfood) : null, minutosDeNovo: MINUTOS_DE_NOVO };
  }

  /** Grava SÓ a chave `atendimentoIfood`, mesclando no banco (V82): o token e o resto da config ficam. */
  async salvarAjustes(user: AuthUser, dto: unknown) {
    const parcial = lerAjusteIfood(dto);
    const antes = await this.ajustes(user.tenantId);
    if (!Object.keys(parcial).length) return antes;
    if (!antes.conectadoIfood) throw new BadRequestException('O iFood não está conectado nesta empresa.');
    await this.db.execute(sql`
      update integracao
         set config = coalesce(config, '{}'::jsonb)
                      || jsonb_build_object('atendimentoIfood', coalesce(config -> 'atendimentoIfood', '{}'::jsonb) || ${JSON.stringify(parcial)}::jsonb)
       where tenant_id = ${user.tenantId} and canal = 'ifood' and ativo`);
    const depois = await this.ajustes(user.tenantId);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId ?? null,
      atorPerfil: user.categoria ?? null,
      tipo: 'atendimento',
      acao: 'ajustou_atendimento_ifood',
      entidadeTipo: 'integracao',
      detalhe: { de: antes.ajusteIfood, para: depois.ajusteIfood },
      origem: 'web',
    });
    return depois;
  }

  /**
   * Os avisos da disputa para quem atende (a fila os leva ao app e ao computador). No servidor da loja a integração não
   * existe: os padrões.
   */
  async avisos(tenantId: string): Promise<{ disputa: { avisar: boolean; deNovoMin: number } }> {
    let a = AJUSTE_IFOOD_PADRAO;
    if (!ehServidorLocal()) {
      try {
        const ig = await this.integracao(tenantId);
        if (ig?.ativo) a = ajusteDe(ig.config?.atendimentoIfood);
      } catch (e: any) {
        this.logger.warn(`avisos da disputa: ${e?.message ?? e} — valem os padrões`);
      }
    }
    return { disputa: { avisar: a.avisarDisputa, deNovoMin: a.avisarDeNovoMin } };
  }

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
      select merchant_id as "merchantId", config from integracao
       where tenant_id = ${tenantId} and canal = 'ifood' and ativo and coalesce(trim(merchant_id), '') <> ''`);
    const linhas = (r.rows ?? r) as Array<{ merchantId: string; config: any }>;
    const merchantIds = [
      ...new Set(linhas.flatMap((x) => String(x.merchantId).split(/[\s,;]+/)).filter((m) => UUID.test(m))),
    ].slice(0, LOJAS_NO_WIDGET);
    if (!merchantIds.length) return { disponivel: false, motivo: 'sem_ifood' };
    // A loja desligou o chat na tela Atendimento (ajuste "Chat oficial do iFood na tela Atendimento").
    if (linhas.some((x) => !ajusteDe(x.config?.atendimentoIfood).chat)) return { disponivel: false, motivo: 'desligado' };
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
    if (j?.disponivel === false && ['sem_widget', 'sem_ifood', 'desligado'].includes(j.motivo)) return { disponivel: false, motivo: j.motivo };
    return { disponivel: false, motivo: 'sem_nuvem' };
  }
}
