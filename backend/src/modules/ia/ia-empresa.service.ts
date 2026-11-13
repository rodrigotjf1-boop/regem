import Anthropic from '@anthropic-ai/sdk';
import { BadGatewayException, BadRequestException, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { chaveSegredosDisponivel, cifrar, decifrar } from '../../common/cifra-segredo';
import { hojeISO } from '../../common/data';
import { ehServidorLocal } from '../../common/modo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  FALHA_QUE_MARCA_A_CHAVE,
  MotivoDaFalha,
  OrigemDaChave,
  PRECOS_LIDOS_EM,
  PROVEDORES_ACEITOS,
  ProvedorDeIa,
  SituacaoDaChave,
  USO_ZERO,
  UsoDaChamada,
  classificarFalha,
  custoEstimadoUsd,
  ehProvedorAceito,
  finalDaChave,
  lerUso,
  motivoDaChaveInvalida,
  periodoDoUso,
} from './ia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A IA DA EMPRESA (mig 415): a porta ÚNICA por onde o Regem fala com um modelo de IA em nome de uma empresa.
//  • De quem é a chave: a da PRÓPRIA empresa, se o presidente cadastrou uma (decisão do dono de 12/11/2026: cada lojista
//    configura a sua e paga os seus créditos); senão, a da distribuição (`ANTHROPIC_API_KEY`), enquanto ela existir e
//    `IA_CHAVE_DA_DISTRIBUICAO_DESLIGADA` não for 1. Empresa com chave própria NUNCA cai para a da distribuição quando a
//    dela falha: o custo não muda de dono em silêncio — a recusa aparece.
//  • A chave do lojista fica cifrada com a `SEGREDOS_CHAVE` desta nuvem, em tabela que não sincroniza; não volta pela API,
//    não vai para o log e não vai para o servidor da loja. Só o presidente cadastra, troca ou apaga (o controlador).
//  • Antes de guardar, a chave é PROVADA no provedor (uma chamada mínima): chave recusada não é guardada.
//  • Toda chamada soma no medidor (`ia_uso_dia`), com a origem da chave — é o número que vai decidir, ao fim dos testes,
//    quem paga a IA. O medidor nunca derruba a chamada.
//  • Só na nuvem: no servidor da loja não há acesso (a tabela nem existe lá).

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.code === '42703'; // banco sem a 415
const PRAZO_PADRAO_MS = 20_000;
const MODELO_DA_PROVA = 'claude-haiku-5-5';

/** A chamada não aconteceu ou não voltou: o motivo, de quem era a chave e o status do provedor (nunca a chave nem o texto). */
export class FalhaDaIa extends Error {
  constructor(
    readonly motivo: MotivoDaFalha,
    readonly origem: OrigemDaChave | null,
    readonly status: number | null = null,
  ) {
    super(`IA: ${motivo}`);
    this.name = 'FalhaDaIa';
  }
}

export interface AcessoDeIa {
  provedor: ProvedorDeIa;
  chave: string;
  origem: OrigemDaChave;
}

export interface PedidoDeIa {
  /** Quem pede (vira a coluna `recurso` do medidor): copiloto, e depois o Mister. */
  recurso: string;
  modelo: string;
  maxTokens: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: any }>;
  prazoMs?: number;
}

export interface RespostaDaIa {
  texto: string;
  /** O modelo se recusou a responder (o texto vem vazio). */
  recusou: boolean;
  origem: OrigemDaChave;
  uso: UsoDaChamada;
}

/** O mínimo que se usa do cliente do provedor (o teste troca por um de mentira). */
export type ClienteDeIa = { messages: { create(pedido: any, opcoes?: any): Promise<any> } };

@Injectable()
export class IaEmpresaService {
  private readonly logger = new Logger('IaDaEmpresa');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  // ───────────────────────────── de quem é a chave ─────────────────────────────

  /** A chave da distribuição, se ela ainda atende quem não tem chave própria. */
  private chaveDaDistribuicao(): string {
    if (process.env.IA_CHAVE_DA_DISTRIBUICAO_DESLIGADA === '1') return '';
    return String(process.env.ANTHROPIC_API_KEY ?? '').trim();
  }

  /** A linha da empresa (sem abrir a chave); banco sem a 415 = sem chave própria. */
  private async linha(tenantId: string): Promise<any | null> {
    try {
      const [l] = linhas(
        await this.db.execute(sql`
          select provedor, chave_cifrada as "chaveCifrada", final, situacao,
                 to_char(conferida_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "conferidaEm",
                 to_char(salva_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "salvaEm"
            from ia_credencial where tenant_id = ${tenantId}::uuid`),
      );
      return l ?? null;
    } catch (e: any) {
      if (semTabela(e)) return null;
      throw e;
    }
  }

  /** Há IA para esta empresa agora (a chave dela ou a da distribuição)? Não abre a chave. */
  async temAcesso(tenantId: string): Promise<boolean> {
    if (ehServidorLocal()) return false;
    return !!(await this.linha(tenantId)) || !!this.chaveDaDistribuicao();
  }

  /** A chave que atende esta empresa — ou null (sem chave, ou a dela não abre neste servidor). */
  async acesso(tenantId: string): Promise<AcessoDeIa | null> {
    if (ehServidorLocal()) return null;
    const l = await this.linha(tenantId);
    if (l) {
      if (!ehProvedorAceito(l.provedor)) return null;
      try {
        return { provedor: l.provedor, chave: decifrar(String(l.chaveCifrada)), origem: 'lojista' };
      } catch {
        // Outra SEGREDOS_CHAVE ou dado alterado. Não cai para a chave da distribuição: o defeito tem de aparecer (V11).
        this.logger.error('a chave de IA da empresa não abriu neste servidor (SEGREDOS_CHAVE diferente ou dado alterado)');
        return null;
      }
    }
    const daDistribuicao = this.chaveDaDistribuicao();
    return daDistribuicao ? { provedor: 'anthropic', chave: daDistribuicao, origem: 'distribuicao' } : null;
  }

  /** O cliente do provedor para uma chave (à parte: o teste troca). Um por chamada: nada de estado entre empresas. */
  protected criarCliente(chave: string): ClienteDeIa {
    return new Anthropic({ apiKey: chave, timeout: PRAZO_PADRAO_MS, maxRetries: 1 });
  }

  // ───────────────────────────── a chamada ─────────────────────────────

  /**
   * Uma pergunta ao modelo, com a chave que atende a empresa. Soma no medidor (também a falha) e, se a chave é do
   * lojista, guarda o que a chamada disse dela. Lança `FalhaDaIa` com o motivo — quem chama escolhe a frase da tela.
   */
  async pedir(tenantId: string, p: PedidoDeIa): Promise<RespostaDaIa> {
    const acesso = await this.acesso(tenantId);
    if (!acesso) throw new FalhaDaIa('sem_chave', null);
    let r: any;
    try {
      r = await this.criarCliente(acesso.chave).messages.create(
        { model: p.modelo, max_tokens: p.maxTokens, ...(p.system ? { system: p.system } : {}), messages: p.messages },
        { timeout: p.prazoMs ?? PRAZO_PADRAO_MS },
      );
    } catch (e: any) {
      const falha = lerFalha(e);
      const motivo = classificarFalha(falha);
      const passageira = motivo === 'limite_por_minuto' || motivo === 'indisponivel';
      // V11: o motivo fica no log; a chave e o que foi perguntado, nunca.
      this.logger[passageira ? 'warn' : 'error'](`${p.recurso}: o provedor não atendeu (${motivo}, status ${falha.status ?? 'sem'}, chave ${acesso.origem})`);
      await this.registrarUso(tenantId, p.recurso, acesso, p.modelo, USO_ZERO, true);
      if (acesso.origem === 'lojista' && FALHA_QUE_MARCA_A_CHAVE.includes(motivo)) await this.marcar(tenantId, motivo as SituacaoDaChave);
      throw new FalhaDaIa(motivo, acesso.origem, falha.status);
    }
    const uso = lerUso(r?.usage);
    await this.registrarUso(tenantId, p.recurso, acesso, p.modelo, uso, false);
    if (acesso.origem === 'lojista') await this.marcar(tenantId, 'ok');
    const partes: string[] = [];
    for (const b of r?.content ?? []) if (b?.type === 'text') partes.push(String(b.text ?? ''));
    return { texto: partes.join('\n').trim(), recusou: r?.stop_reason === 'refusal', origem: acesso.origem, uso };
  }

  /** Soma a chamada na linha do dia (uma gravação). Nunca lança: o medidor não derruba quem chamou (V3). */
  private async registrarUso(tenantId: string, recurso: string, acesso: AcessoDeIa, modelo: string, uso: UsoDaChamada, falhou: boolean): Promise<void> {
    try {
      await this.db.execute(sql`
        insert into ia_uso_dia (tenant_id, dia, recurso, provedor, modelo, origem, chamadas, falhas,
                                tokens_entrada, tokens_cache_escrita, tokens_cache_leitura, tokens_saida)
        values (${tenantId}::uuid, ${hojeISO()}::date, ${recurso}, ${acesso.provedor}, ${modelo}, ${acesso.origem}, 1, ${falhou ? 1 : 0},
                ${uso.entrada}, ${uso.cacheEscrita}, ${uso.cacheLeitura}, ${uso.saida})
        on conflict (tenant_id, dia, recurso, provedor, modelo, origem) do update
           set chamadas = ia_uso_dia.chamadas + 1,
               falhas = ia_uso_dia.falhas + excluded.falhas,
               tokens_entrada = ia_uso_dia.tokens_entrada + excluded.tokens_entrada,
               tokens_cache_escrita = ia_uso_dia.tokens_cache_escrita + excluded.tokens_cache_escrita,
               tokens_cache_leitura = ia_uso_dia.tokens_cache_leitura + excluded.tokens_cache_leitura,
               tokens_saida = ia_uso_dia.tokens_saida + excluded.tokens_saida,
               atualizado_em = now()`);
    } catch (e: any) {
      this.logger.warn(`o medidor de uso da IA não gravou (${e?.code ?? 'sem código'}): ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }

  /** Guarda o que a chamada disse da chave do lojista — só grava quando MUDA. Nunca lança. */
  private async marcar(tenantId: string, situacao: SituacaoDaChave): Promise<void> {
    try {
      await this.db.execute(sql`
        update ia_credencial
           set situacao = ${situacao}, ultimo_motivo = ${situacao === 'ok' ? null : situacao}, conferida_em = now(), atualizado_em = now()
         where tenant_id = ${tenantId}::uuid and situacao is distinct from ${situacao}`);
    } catch (e: any) {
      this.logger.warn(`a situação da chave de IA não foi gravada (${e?.code ?? 'sem código'})`);
    }
  }

  /** A prova da chave: uma chamada mínima ao provedor (frações de centavo), que confere a chave E o crédito. */
  private async provar(tenantId: string, acesso: AcessoDeIa): Promise<'ok' | MotivoDaFalha> {
    try {
      const r = await this.criarCliente(acesso.chave).messages.create(
        { model: MODELO_DA_PROVA, max_tokens: 16, messages: [{ role: 'user', content: 'ok' }] },
        { timeout: 15_000 },
      );
      await this.registrarUso(tenantId, 'prova', acesso, MODELO_DA_PROVA, lerUso(r?.usage), false);
      return 'ok';
    } catch (e: any) {
      const falha = lerFalha(e);
      const motivo = classificarFalha(falha);
      this.logger.warn(`prova da chave de IA: ${motivo} (status ${falha.status ?? 'sem'})`);
      await this.registrarUso(tenantId, 'prova', acesso, MODELO_DA_PROVA, USO_ZERO, true);
      return motivo;
    }
  }

  // ───────────────────────────── o cadastro da chave (presidente) ─────────────────────────────

  /** O que a tela mostra: nunca a chave, nem a forma cifrada dela. */
  async situacao(tenantId: string) {
    const l = ehServidorLocal() ? null : await this.linha(tenantId);
    return {
      provedoresAceitos: [...PROVEDORES_ACEITOS],
      /** De onde vem a IA desta empresa: a chave dela, a que a Regem inclui, ou nenhuma. */
      origem: l ? ('propria' as const) : this.chaveDaDistribuicao() && !ehServidorLocal() ? ('incluida' as const) : null,
      chave: l
        ? { provedor: String(l.provedor), final: String(l.final ?? ''), situacao: String(l.situacao) as SituacaoDaChave, conferidaEm: l.conferidaEm ?? null, salvaEm: l.salvaEm ?? null }
        : null,
    };
  }

  /** Cadastra ou troca a chave da empresa. Toda recusa vem ANTES da gravação (V86); chave recusada não é guardada. */
  async salvar(user: AuthUser, dto: unknown) {
    const d = (dto ?? {}) as { provedor?: unknown; chave?: unknown };
    const provedor = String(d.provedor ?? 'anthropic').trim().toLowerCase();
    if (!ehProvedorAceito(provedor)) throw new BadRequestException('Esta empresa de IA ainda não é aceita. Hoje o Regem funciona com a Anthropic.');
    const chave = typeof d.chave === 'string' ? d.chave.trim() : '';
    const invalida = motivoDaChaveInvalida(provedor, chave);
    if (invalida) throw new BadRequestException(invalida);
    if (!chaveSegredosDisponivel()) throw new ServiceUnavailableException('O Regem não está pronto para guardar a chave agora. Avise o suporte.');

    const prova = await this.provar(user.tenantId, { provedor, chave, origem: 'lojista' });
    if (prova === 'chave_recusada') throw new BadRequestException('A Anthropic recusou esta chave. Confira se ela está ativa e se foi copiada inteira.');
    if (prova !== 'ok' && prova !== 'sem_credito' && prova !== 'teto_atingido')
      throw new BadGatewayException('Não deu para conferir a chave com a Anthropic agora. Tente de novo em instantes.');

    const situacao: SituacaoDaChave = prova;
    await this.db.execute(sql`
      insert into ia_credencial (tenant_id, provedor, chave_cifrada, final, situacao, ultimo_motivo, conferida_em, salva_por)
      values (${user.tenantId}::uuid, ${provedor}, ${cifrar(chave)}, ${finalDaChave(chave)}, ${situacao}, ${situacao === 'ok' ? null : situacao}, now(), ${user.colaboradorId}::uuid)
      on conflict (tenant_id) do update
         set provedor = excluded.provedor, chave_cifrada = excluded.chave_cifrada, final = excluded.final, situacao = excluded.situacao,
             ultimo_motivo = excluded.ultimo_motivo, conferida_em = excluded.conferida_em, salva_por = excluded.salva_por,
             salva_em = now(), atualizado_em = now()`);
    await this.auditar(user, 'ia_chave_salva', { provedor, final: finalDaChave(chave), situacao });
    return this.situacao(user.tenantId);
  }

  /** Prova de novo a chave guardada e atualiza a situação dela. */
  async testar(user: AuthUser) {
    const l = await this.linha(user.tenantId);
    if (!l) throw new BadRequestException('Não há chave de IA cadastrada nesta empresa.');
    const acesso = await this.acesso(user.tenantId);
    if (!acesso || acesso.origem !== 'lojista') throw new ServiceUnavailableException('A chave guardada não pôde ser aberta. Cadastre a chave de novo.');
    const prova = await this.provar(user.tenantId, acesso);
    if (prova === 'ok' || prova === 'chave_recusada' || prova === 'sem_credito' || prova === 'teto_atingido') await this.marcar(user.tenantId, prova);
    else throw new BadGatewayException('Não deu para conferir a chave com a Anthropic agora. Tente de novo em instantes.');
    return this.situacao(user.tenantId);
  }

  /** Apaga a chave da empresa (o segredo sai do banco). A empresa volta para a IA incluída, se houver. */
  async remover(user: AuthUser) {
    const apagadas = linhas(await this.db.execute(sql`delete from ia_credencial where tenant_id = ${user.tenantId}::uuid returning provedor, final`));
    if (apagadas.length) await this.auditar(user, 'ia_chave_removida', { provedor: apagadas[0].provedor, final: apagadas[0].final });
    return this.situacao(user.tenantId);
  }

  private async auditar(user: AuthUser, acao: string, detalhe: Record<string, unknown>): Promise<void> {
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao,
      entidadeTipo: 'ia_credencial',
      entidadeId: user.tenantId,
      detalhe,
    });
  }

  // ───────────────────────────── o medidor ─────────────────────────────

  /** O uso da IA da empresa no período, por recurso, modelo e origem da chave, com o custo estimado em US$. */
  async uso(tenantId: string, de?: unknown, ate?: unknown) {
    const periodo = periodoDoUso(de, ate, hojeISO());
    if ('erro' in periodo) throw new BadRequestException(periodo.erro);
    let lidas: any[] = [];
    try {
      lidas = linhas(
        await this.db.execute(sql`
          select recurso, provedor, modelo, origem,
                 sum(chamadas)::int as chamadas, sum(falhas)::int as falhas,
                 sum(tokens_entrada)::float8 as entrada, sum(tokens_cache_escrita)::float8 as "cacheEscrita",
                 sum(tokens_cache_leitura)::float8 as "cacheLeitura", sum(tokens_saida)::float8 as saida
            from ia_uso_dia
           where tenant_id = ${tenantId}::uuid and dia between ${periodo.de}::date and ${periodo.ate}::date
           group by recurso, provedor, modelo, origem
           order by recurso, modelo, origem`),
      );
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }
    const itens = lidas.map((l) => {
      const tokens: UsoDaChamada = { entrada: Number(l.entrada) || 0, cacheEscrita: Number(l.cacheEscrita) || 0, cacheLeitura: Number(l.cacheLeitura) || 0, saida: Number(l.saida) || 0 };
      return {
        recurso: String(l.recurso),
        provedor: String(l.provedor),
        modelo: String(l.modelo),
        origem: String(l.origem) as OrigemDaChave,
        chamadas: Number(l.chamadas) || 0,
        falhas: Number(l.falhas) || 0,
        tokens,
        custoEstimadoUsd: custoEstimadoUsd(String(l.modelo), tokens),
      };
    });
    const somar = (origem: OrigemDaChave) => Math.round(itens.filter((i) => i.origem === origem).reduce((s, i) => s + (i.custoEstimadoUsd ?? 0), 0) * 1_000_000) / 1_000_000;
    return {
      de: periodo.de,
      ate: periodo.ate,
      precosLidosEm: PRECOS_LIDOS_EM,
      itens,
      /** Estimativa: a conta de verdade é a do console do provedor. */
      custoEstimadoUsd: { lojista: somar('lojista'), distribuicao: somar('distribuicao') },
      /** Modelos usados que não estão na tabela de preços (ficam fora da estimativa). */
      semPreco: [...new Set(itens.filter((i) => i.custoEstimadoUsd === null).map((i) => i.modelo))],
    };
  }
}

/** O que o erro do SDK da Anthropic traz (status, tipo, mensagem, código do detalhe) — sem nada do pedido. */
function lerFalha(e: any): { status: number | null; tipo: string | null; mensagem: string | null; codigo: string | null } {
  if (e instanceof Anthropic.APIError) {
    const corpo = (e.error ?? {}) as any;
    const interno = corpo?.error ?? corpo;
    return {
      status: typeof e.status === 'number' ? e.status : null,
      tipo: (e.type as string | null) ?? interno?.type ?? null,
      mensagem: String(interno?.message ?? e.message ?? '').slice(0, 300),
      codigo: interno?.details?.error_code ?? null,
    };
  }
  // O cliente de mentira dos testes lança um objeto simples com os mesmos campos.
  return { status: Number(e?.status) || null, tipo: e?.tipo ?? e?.type ?? null, mensagem: String(e?.mensagem ?? e?.message ?? '').slice(0, 300), codigo: e?.codigo ?? null };
}
