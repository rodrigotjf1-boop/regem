import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { exigirBooleano } from '../../common/exigir';
import { CANAIS, CanalDaPonte, quemResponde, type PonteCandidata, VIVA_POR_MS } from './lideranca';
import { MotivoDoAviso, TEXTO_MAX, TEXTO_PADRAO, temContatoProibido } from './texto-do-chat';
import { MODOS_DO_ROBO_NO_CHAT, type ModoDoRoboNoChat, modoDaLinha } from './robo-do-chat';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS AJUSTES DA PONTE DO CHAT (Delivery › Configurações › Operação › Atendimento › "iFood e 99 · chat pela ponte" —
// protótipo `mockups/regem-central-atendimento.html` v3) e a SITUAÇÃO que a faixa da tela Atendimento mostra.
//  • ligar/desligar a ponte (nasce desligada) e os três avisos automáticos ("saiu", "chegando", "obrigado"), com o texto
//    de cada um (vazio = o padrão) — em `robo_config.chat_*` da empresa; grava SÓ as colunas que vieram (V16, V82);
//  • onde a ponte roda: "Automático" (todas as pontes da loja no papel automático) ou "Escolher os PCs" (uma principal e
//    uma reserva — `chat_ponte.papel`). A 99 aceita um login só: a reserva vale para o iFood.
//  • QUEM responde no chat com o robô ligado (F5, mig 383 — `roboModo`): "Frases prontas" (nasce assim) ou "Atendente
//    virtual" (o robô com IA, com a trava da plataforma — `atendente-no-chat.ts`).

export const MOTIVOS: readonly MotivoDoAviso[] = ['saiu', 'chegando', 'obrigado'];
const COLUNAS: Record<MotivoDoAviso, { ligado: string; texto: string }> = {
  saiu: { ligado: 'chat_aviso_saiu', texto: 'chat_aviso_saiu_texto' },
  chegando: { ligado: 'chat_aviso_chegando', texto: 'chat_aviso_chegando_texto' },
  obrigado: { ligado: 'chat_aviso_obrigado', texto: 'chat_aviso_obrigado_texto' },
};
/** Sem linha em robo_config, os padrões da mig 366. */
const PADRAO_LIGADO: Record<MotivoDoAviso, boolean> = { saiu: true, chegando: true, obrigado: false };
const NOME_DO_AVISO: Record<MotivoDoAviso, string> = {
  saiu: '"saiu para entrega"',
  chegando: '"o entregador está chegando"',
  obrigado: 'de agradecimento',
};

export type AvisoDaPonte = { ligado: boolean; texto: string | null };
export type ParcialDaPonte = {
  ligada?: boolean;
  /** O robô responde no chat (Etapa 3; `robo_config.chat_robo_responde`, nasce desligado). */
  roboResponde?: boolean;
  /** QUEM responde no chat (F5, mig 383; `robo_config.chat_robo_modo`): o robô por regras (nasce assim) ou o atendente virtual. */
  roboModo?: ModoDoRoboNoChat;
  avisos?: Partial<Record<MotivoDoAviso, Partial<AvisoDaPonte>>>;
  onde?: 'auto' | 'escolher';
  principalId?: string | null;
  reservaId?: string | null;
};

const ehUuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

/**
 * O que a tela mandou para a ponte, conferido ANTES de gravar qualquer grupo (V15: liga/desliga só com booleano; V16:
 * ausente fica de fora). O texto do aviso: até 300 letras, vazio = o padrão, e sem telefone, WhatsApp, Instagram ou link
 * (o iFood e a 99 proíbem — termo do iFood 3.3).
 */
export function lerAjusteDaPonte(dto: unknown): ParcialDaPonte {
  const d = (dto ?? {}) as any;
  const p: ParcialDaPonte = {};
  if (d.ligada !== undefined) p.ligada = exigirBooleano(d.ligada, 'ligada');
  if (d.roboResponde !== undefined) p.roboResponde = exigirBooleano(d.roboResponde, 'roboResponde');
  if (d.roboModo !== undefined) {
    if (!(MODOS_DO_ROBO_NO_CHAT as readonly unknown[]).includes(d.roboModo))
      throw new BadRequestException('Quem responde no chat: escolha "Frases prontas" ou "Atendente virtual".');
    p.roboModo = d.roboModo;
  }
  if (d.onde !== undefined) {
    if (d.onde !== 'auto' && d.onde !== 'escolher') throw new BadRequestException('Onde a ponte roda: escolha "Automático" ou "Escolher os PCs".');
    p.onde = d.onde;
  }
  for (const k of ['principalId', 'reservaId'] as const) {
    if (d[k] === undefined) continue;
    if (d[k] !== null && d[k] !== '' && !ehUuid(d[k])) throw new BadRequestException('Escolha o PC da ponte na lista.');
    p[k] = d[k] ? String(d[k]) : null;
  }
  if (p.principalId && p.principalId === p.reservaId) throw new BadRequestException('A principal e a reserva têm de ser PCs diferentes.');
  if (d.avisos !== undefined) {
    if (!d.avisos || typeof d.avisos !== 'object') throw new BadRequestException('Avisos inválidos.');
    p.avisos = {};
    for (const m of MOTIVOS) {
      const a = d.avisos[m];
      if (a === undefined) continue;
      const v: Partial<AvisoDaPonte> = {};
      if (a?.ligado !== undefined) v.ligado = exigirBooleano(a.ligado, `avisos.${m}.ligado`);
      if (a?.texto !== undefined) {
        if (a.texto !== null && typeof a.texto !== 'string') throw new BadRequestException(`O texto do aviso ${NOME_DO_AVISO[m]} é inválido.`);
        const t = typeof a.texto === 'string' ? a.texto.replace(/\s+/g, ' ').trim() : '';
        if (t.length > TEXTO_MAX) throw new BadRequestException(`O texto do aviso ${NOME_DO_AVISO[m]} tem no máximo ${TEXTO_MAX} letras.`);
        if (t && temContatoProibido(t))
          throw new BadRequestException(`O iFood e a 99 proíbem telefone, WhatsApp, Instagram ou link no chat: tire isso do aviso ${NOME_DO_AVISO[m]}.`);
        v.texto = t || null;
      }
      p.avisos[m] = v;
    }
  }
  return p;
}

const linhas = (r: any): any[] => (r?.rows ?? r) as any[];

@Injectable()
export class AjustesDaPonteService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // Quem mudou o ajuste fica na auditoria. Opcional: os testes montam o serviço sem ela.
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** As pontes da loja em uso (ou de todas, sem loja escolhida), ativas e não revogadas, na ordem do pareamento. */
  async pontesDaLoja(tenantId: string, unidade: string | null) {
    return linhas(await this.db.execute(sql`
      select e.id, e.nome, e.unidade_id as "unidadeId", coalesce(cp.papel, 'auto') as papel, cp.maquina, cp.visto_em as "vistoEm",
             coalesce((cp.plataformas -> 'ifood' ->> 'logado')::boolean, false) as "ifood",
             coalesce((cp.plataformas -> '99food' ->> 'logado')::boolean, false) as "n99",
             coalesce((cp.plataformas -> '99food' ->> 'lendo')::boolean, false) as "n99Lendo",
             e.created_at as "criadaEm", cp.pausada_em as "pausadaEm",
             coalesce(cp.visto_em > now() - make_interval(secs => ${VIVA_POR_MS / 1000}), false) as viva
        from equipamento e
        left join chat_ponte cp on cp.equipamento_id = e.id
       where e.tenant_id = ${tenantId}::uuid and e.tipo = 'ponte_chat' and e.ativo and e.revogado_em is null
         and (${unidade}::uuid is null or e.unidade_id is null or e.unidade_id = ${unidade}::uuid)
       order by e.created_at, e.id`));
  }

  /** Os ajustes da ponte (sem linha em robo_config, os padrões) e as pontes da loja. */
  async ajustes(tenantId: string, unidade: string | null) {
    const [rc] = linhas(await this.db.execute(sql`
      select chat_ponte_ligada, chat_robo_responde, chat_aviso_saiu, chat_aviso_saiu_texto, chat_aviso_chegando,
             chat_aviso_chegando_texto, chat_aviso_obrigado, chat_aviso_obrigado_texto,
             -- QUEM responde (mig 383) pelo to_jsonb: num banco sem a 383 a leitura não falha (vale 'regras')
             to_jsonb(rc) ->> 'chat_robo_modo' as chat_robo_modo
        from robo_config rc where rc.tenant_id = ${tenantId}::uuid`));
    const avisos = {} as Record<MotivoDoAviso, AvisoDaPonte>;
    for (const m of MOTIVOS) {
      const ligado = rc?.[COLUNAS[m].ligado];
      avisos[m] = { ligado: typeof ligado === 'boolean' ? ligado : PADRAO_LIGADO[m], texto: rc?.[COLUNAS[m].texto] ?? null };
    }
    const pontes = await this.pontesDaLoja(tenantId, unidade);
    const principal = pontes.find((p) => p.papel === 'principal');
    const reserva = pontes.find((p) => p.papel === 'reserva');
    return {
      ligada: rc?.chat_ponte_ligada === true,
      roboResponde: rc?.chat_robo_responde === true,
      roboModo: modoDaLinha(rc?.chat_robo_modo),
      avisos,
      padroes: TEXTO_PADRAO,
      onde: principal || reserva ? ('escolher' as const) : ('auto' as const),
      principalId: principal?.id ?? null,
      reservaId: reserva?.id ?? null,
      pontes: pontes.map((p) => ({ id: p.id, nome: p.nome, maquina: p.maquina ?? null, vistoEm: p.vistoEm ?? null, viva: p.viva === true, pausadaEm: p.pausadaEm ?? null, logado: { ifood: p.ifood === true, '99food': p.n99 === true } })),
    };
  }

  /**
   * Confere TUDO o que o `salvar` recusaria — o texto (sem banco) e o papel dos PCs (lê as pontes) — sem gravar nada.
   * O controlador chama antes de gravar qualquer grupo: um salvar com vários grupos não grava um e recusa o outro.
   */
  async conferir(user: AuthUser, unidade: string | null, dto: unknown): Promise<void> {
    const p = lerAjusteDaPonte(dto);
    await this.planoDosPapeis(user, unidade, p, await this.ajustes(user.tenantId, unidade));
  }

  /** Salva o que veio (só as colunas que vieram — V82) e o papel das pontes da loja; cada mudança vai à auditoria. */
  async salvar(user: AuthUser, unidade: string | null, dto: unknown) {
    const p = lerAjusteDaPonte(dto);
    const antes = await this.ajustes(user.tenantId, unidade);
    // O papel é conferido ANTES de gravar os avisos: a recusa ("Escolha o PC principal") não deixa meio salvo.
    const plano = await this.planoDosPapeis(user, unidade, p, antes);
    const sets: { coluna: string; valor: unknown }[] = [];
    if (p.ligada !== undefined && p.ligada !== antes.ligada) sets.push({ coluna: 'chat_ponte_ligada', valor: p.ligada });
    if (p.roboResponde !== undefined && p.roboResponde !== antes.roboResponde) sets.push({ coluna: 'chat_robo_responde', valor: p.roboResponde });
    if (p.roboModo !== undefined && p.roboModo !== antes.roboModo) sets.push({ coluna: 'chat_robo_modo', valor: p.roboModo });
    for (const m of MOTIVOS) {
      const a = p.avisos?.[m];
      if (!a) continue;
      if (a.ligado !== undefined && a.ligado !== antes.avisos[m].ligado) sets.push({ coluna: COLUNAS[m].ligado, valor: a.ligado });
      if (a.texto !== undefined && a.texto !== antes.avisos[m].texto) sets.push({ coluna: COLUNAS[m].texto, valor: a.texto });
    }
    if (sets.length) {
      const colunas = sql.join(sets.map((s) => sql.raw(s.coluna)), sql`, `);
      const valores = sql.join(sets.map((s) => sql`${s.valor}`), sql`, `);
      const atualizar = sql.join(sets.map((s) => sql`${sql.raw(s.coluna)} = excluded.${sql.raw(s.coluna)}`), sql`, `);
      await this.db.execute(sql`
        insert into robo_config (tenant_id, ${colunas}, atualizado_por)
        values (${user.tenantId}::uuid, ${valores}, ${user.colaboradorId}::uuid)
        on conflict (tenant_id) do update
           set ${atualizar}, atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
      await this.auditoria?.registrar({
        tenantId: user.tenantId,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria,
        tipo: 'config',
        acao: 'ponte_do_chat_ajustada',
        entidadeTipo: 'robo_config',
        entidadeId: user.tenantId,
        detalhe: Object.fromEntries(sets.map((s) => [s.coluna, s.valor])),
      });
    }
    if (plano) await this.gravarPapeis(user, unidade, plano);
    return this.ajustes(user.tenantId, unidade);
  }

  /**
   * O papel das pontes, conferido e SEM gravar: `null` = nada muda. "Automático": todas no papel automático. "Escolher os
   * PCs": a principal (obrigatória) e a reserva (opcional), da MESMA loja — e só as pontes dessa loja são regravadas: sem
   * loja escolhida (presidente em "todas as lojas"; ou a empresa de loja única), a lista traz as pontes de todas, e
   * escolher na loja A não pode desfazer a escolha da loja B.
   */
  private async planoDosPapeis(
    user: AuthUser,
    unidade: string | null,
    p: ParcialDaPonte,
    antes: { principalId: string | null; reservaId: string | null },
  ): Promise<{ ids: string[]; principal: string | null; reserva: string | null } | null> {
    const auto = p.onde === 'auto';
    if (!auto && p.onde === undefined && p.principalId === undefined && p.reservaId === undefined) return null;
    const todas = await this.pontesDaLoja(user.tenantId, unidade);
    const principal = auto ? null : p.principalId !== undefined ? p.principalId : antes.principalId;
    const reserva = auto ? null : p.reservaId !== undefined ? p.reservaId : antes.reservaId;
    for (const id of [principal, reserva]) if (id && !todas.some((x) => x.id === id)) throw new BadRequestException('Este PC não é uma ponte desta loja. Escolha na lista.');
    if (principal && principal === reserva) throw new BadRequestException('A principal e a reserva têm de ser PCs diferentes.');
    if (!auto && !principal)
      throw new BadRequestException(
        todas.length ? 'Escolha o PC principal da ponte.' : 'Nenhum PC está cadastrado como ponte nesta loja: cadastre e pareie em Configurações › Equipamentos.',
      );
    const lojaDe = (id: string | null) => (id ? (todas.find((x) => x.id === id)?.unidadeId ?? null) : undefined);
    if (principal && reserva && lojaDe(principal) !== lojaDe(reserva)) throw new BadRequestException('A principal e a reserva têm de ser PCs da mesma loja.');
    if (principal === antes.principalId && reserva === antes.reservaId) return null;
    const ids = (auto ? todas : todas.filter((x) => (x.unidadeId ?? null) === lojaDe(principal))).map((x) => x.id as string);
    return ids.length ? { ids, principal, reserva } : null;
  }

  /** Grava o plano: uma linha por ponte (a que ainda não deu sinal também ganha o papel), numa gravação só. */
  private async gravarPapeis(user: AuthUser, unidade: string | null, plano: { ids: string[]; principal: string | null; reserva: string | null }) {
    const { ids, principal, reserva } = plano;
    const papeis = ids.map((id) => ({ id, papel: id === principal ? 'principal' : id === reserva ? 'reserva' : 'auto' }));
    await this.db.execute(sql`
      insert into chat_ponte (equipamento_id, tenant_id, unidade_id, papel)
      select x.id, e.tenant_id, e.unidade_id, x.papel
        from jsonb_to_recordset(${JSON.stringify(papeis)}::jsonb) as x(id uuid, papel text)
        join equipamento e on e.id = x.id and e.tenant_id = ${user.tenantId}::uuid
      on conflict (equipamento_id) do update set papel = excluded.papel, atualizado_em = now()`);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'ponte_do_chat_papel',
      entidadeTipo: 'chat_ponte',
      entidadeId: principal ?? user.tenantId,
      detalhe: { principal, reserva, unidade },
    });
  }

  /**
   * A FAIXA da tela Atendimento: a ponte está ligada? Por canal conectado (iFood, 99): qual PC responde agora (a regra
   * única de `quemResponde`) e os NOMES das que ficam de reserva (vivas e logadas no canal — a faixa diz "reserva:
   * Servidor da loja"); quando chegou a última mensagem do chat. A ponte PAUSADA no PC (mig 368) não responde nem é
   * reserva: vem em `pausadas` (as com sinal), para a faixa dizer onde retomar.
   */
  async situacao(tenantId: string, unidade: string | null) {
    const [rc] = linhas(await this.db.execute(sql`select chat_ponte_ligada from robo_config where tenant_id = ${tenantId}::uuid`));
    const ligada = rc?.chat_ponte_ligada === true;
    if (!ligada) return { ligada: false as const };
    const conectados = linhas(await this.db.execute(sql`
      select distinct canal from integracao where tenant_id = ${tenantId}::uuid and ativo and canal in ('ifood', '99food')`)).map((x) => x.canal as CanalDaPonte);
    const pontes = await this.pontesDaLoja(tenantId, unidade);
    const agora = Date.now();
    // `lendo` (4a): as pontes vivas que só LEEM o chat do canal (a 99, enquanto o envio por ela não chega) — o que o
    // cliente escreve entra aqui, mas a resposta é pelo portal da plataforma
    const canais: Record<string, { responde: { nome: string; maquina: string | null } | null; reservas: string[]; lendo: string[] }> = {};
    for (const c of CANAIS.filter((x) => conectados.includes(x))) {
      const candidatas: PonteCandidata[] = pontes.map((p) => ({
        id: p.id,
        papel: p.papel,
        vistoEm: p.vistoEm ? new Date(p.vistoEm).getTime() : 0,
        logada: !p.pausadaEm && (c === 'ifood' ? p.ifood === true : p.n99 === true),
        criadaEm: new Date(p.criadaEm).getTime(),
      }));
      const quem = quemResponde(candidatas, agora);
      const vivas = new Set(candidatas.filter((x) => x.logada && agora - x.vistoEm <= VIVA_POR_MS).map((x) => x.id));
      const p = pontes.find((x) => x.id === quem);
      canais[c] = {
        responde: p ? { nome: p.nome, maquina: p.maquina ?? null } : null,
        reservas: pontes.filter((x) => vivas.has(x.id) && x.id !== quem).map((x) => x.nome),
        lendo: pontes
          .filter((x) => c === '99food' && x.n99Lendo === true && !x.pausadaEm && x.viva === true && !vivas.has(x.id))
          .map((x) => x.nome as string),
      };
    }
    const [ult] = linhas(await this.db.execute(sql`
      select max(criado_em) as em from chat_plataforma_msg
       where tenant_id = ${tenantId}::uuid and direcao = 'entrada'
         and (${unidade}::uuid is null or unidade_id is null or unidade_id = ${unidade}::uuid)
         and criado_em > now() - interval '1 day'`));
    const pausadas = pontes.filter((p) => p.pausadaEm && p.viva === true).map((p) => p.nome as string);
    return { ligada: true as const, pontes: pontes.length, canais, pausadas, ultimaMensagemEm: ult?.em ?? null };
  }
}
