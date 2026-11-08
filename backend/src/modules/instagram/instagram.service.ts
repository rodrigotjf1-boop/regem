/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { ehServidorLocal } from '../../common/modo';
import { chaveSegredosDisponivel, cifrar, decifrar } from '../../common/cifra-segredo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { assinarConversaDoDirect, lerConversaDoDirect } from '../../common/conversa-do-robo';
import { uuidDeChave } from '../../common/id-deterministico';
import { entregarJuntando } from '../whatsapp/juntar-mensagens';
import { juntarMensagem, posicaoNaFila } from '../atendimento/abrir-chamado';
import {
  type Recado,
  inicioDoCasoSql,
  lerRecado,
  recadoAtivoSql,
  recadoDoCasoNovo,
  respostaDoRecado,
  situacaoDaEquipe,
} from '../atendimento/horario-da-equipe';
import { resumoDoRobo } from '../atendimento/resumo-do-robo';
import { recadoParaOResponsavel, respostaParaOResponsavel, resumoComORecado, responsavelNaEsperaSql } from '../cardapio/assuntos-do-atendente';
import {
  SEM_RESPOSTA_MS,
  assinarEstado,
  chaveDaConta,
  chaveDoCliente,
  frase,
  idDaChave,
  janela,
  lerAviso,
  lerEstado,
  nomeDoCliente,
  partirTexto,
  quemRespondeNoDirect,
  textoDaResposta,
  textoParaORobo,
  urlDeAutorizacao,
  type EventoDoDirect,
} from './instagram';
import * as meta from './instagram-graph';
import { ComentariosDoInstagram } from './comentarios.service';

/** O cardápio que o robô do Direct usa (o horário, a taxa, o link e os textos do robô da loja). */
export type CardapioDoRobo = {
  id: string;
  token: string;
  ativo: boolean;
  aberto: boolean;
  nomePublico: string | null;
  roboSaudacao: string | null;
  roboAusencia: string | null;
  roboPrompt: string | null;
  roboMensagens: any;
  site: string | null;
  instagram: string | null;
};

/** Para quem o robô manda a resposta no Direct (conferido na hora da resposta — V87). */
export type AlvoDoRobo =
  | { ligado: true; tenantId: string; igUserId: string; igsid: string; cardapio: CardapioDoRobo }
  | { ligado: false; motivo: 'robo_desligado' };

const minutosDaPausa = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 60;
};

// INSTAGRAM DIRECT NA FILA (item 6 da Central; protótipo versão 7; mig 377). A loja conecta a conta profissional (entra
// no Instagram e autoriza); o acesso fica cifrado na nuvem, com a distribuição. O aviso de mensagem da Meta chega na
// nuvem: cada conversa nova vira caso (um aberto por cliente), a resposta da equipe sai pelo Direct da loja dentro da
// janela de 24 h, e o que a loja responde no próprio app do Instagram aparece na conversa (o eco). No servidor da loja a
// conversa e a resposta vão à nuvem pelo token do servidor (V37).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Quem responde no Direct: a gestão (como no WhatsApp e no chat da plataforma). */
export const QUEM_RESPONDE = ['presidente', 'gerente', 'supervisao'] as const;
/** Renova o acesso (vale 60 dias) quando ele passa desta idade. */
const RENOVAR_DEPOIS_DE_DIAS = 20;
/** O perfil do cliente é lido de novo depois disto. */
const PERFIL_VELHO_DIAS = 7;

const doApp = () => String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');
const retornoPadrao = () => String(process.env.INSTAGRAM_REDIRECT_URI || 'https://api.dmsregem.com/api/v1/publico/instagram/retorno');
const ajustesDoApp = (situacao: string) => `${doApp()}/delivery/configuracoes?aba=atendimento&instagram=${encodeURIComponent(situacao)}`;

@Injectable()
export class InstagramService {
  private readonly logger = new Logger('Instagram');
  /**
   * Os COMENTÁRIOS dos posts (F6, mig 384 — `comentarios.service.ts`): o webhook, a resposta do robô (`cm:`), o "chamar
   * atendente" do cardápio e as rotas da tela usam esta instância (uma classe simples, sem mudar a injeção dos módulos).
   */
  readonly comentarios: ComentariosDoInstagram;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {
    this.comentarios = new ComentariosDoInstagram(db, events, this, auditoria);
  }

  private appId = () => String(process.env.INSTAGRAM_APP_ID ?? '').trim();
  private segredo = () => String(process.env.INSTAGRAM_APP_SECRET ?? '').trim();

  /** A distribuição liberou o Instagram (o app da Meta e o cofre configurados) e isto é a nuvem. */
  disponivel(): boolean {
    return !ehServidorLocal() && !!this.appId() && !!this.segredo() && chaveSegredosDisponivel();
  }

  // ───────────────────────── a conta ─────────────────────────

  /**
   * O robô do Direct pode rodar (a distribuição): a nuvem, o endereço do fluxo ÚNICO do robô (`N8N_ROBO_WEBHOOK_URL` — o
   * fluxo antigo da API oficial não conhece a chave `ig:`) e a senha do robô (assina a ficha do Direct). Sem isso, quem
   * ligou o robô recebe a conversa como caso (V88: resposta que não sai não é resposta dada).
   */
  roboDisponivel(): boolean {
    return !ehServidorLocal() && !!String(process.env.N8N_ROBO_WEBHOOK_URL ?? '').trim() && !!String(process.env.BOT_RESOLVER_SECRET ?? '').trim();
  }

  /** O grupo "Instagram Direct" dos ajustes: se dá para conectar, a conta conectada (nunca o acesso) e o robô do Direct. */
  async ajuste(tenantId: string) {
    const [r, cards]: any[] = await Promise.all([
      this.db.execute(sql`
        select c.usuario, c.nome, c.fila_ligada as "filaLigada", c.robo_responde as "roboResponde", c.cardapio_id as "cardapioId",
               c.conectado_em as "conectadoEm", c.token_vence_em as "venceEm", c.erro, c.erro_em as "erroEm", col.nome as "conectadoPor",
               c.permissoes, (to_jsonb(c) ->> 'comentarios_robo')::boolean as "comentariosRobo",
               (to_jsonb(c) ->> 'comentarios_fila')::boolean as "comentariosFila"
          from instagram_conta c left join colaborador col on col.id = c.conectado_por and col.tenant_id = c.tenant_id
         where c.tenant_id = ${tenantId}`),
      this.db.execute(sql`
        select cc.id, coalesce(nullif(trim(cc.nome_publico), ''), u.nome, 'Cardápio') as nome, cc.ativo
          from cardapio_config cc left join unidade u on u.id = cc.unidade_id and u.tenant_id = cc.tenant_id
         where cc.tenant_id = ${tenantId}
         order by 2 limit 50`),
    ]);
    const linha = (r.rows ?? r)[0] ?? null;
    const cardapios = ((cards.rows ?? cards) as any[]).map((x) => ({ id: String(x.id), nome: String(x.nome), ativo: x.ativo === true }));
    // Os COMENTÁRIOS (F6, mig 384): `permitido` = a conta conectada com a permissão dos comentários (a de antes da F6 pede
    // "Reconectar"); o robô e a fila deles. As permissões e as colunas novas não vão na `conta` (lidas por `to_jsonb`: num
    // banco sem a 384, o robô desligado e a fila ligada).
    const { permissoes, comentariosRobo, comentariosFila, ...conta } = linha ?? ({} as any);
    const comentarios = this.comentarios.comentariosDoAjuste(linha ? { permissoes, comentariosRobo, comentariosFila } : null);
    return { disponivel: this.disponivel(), roboDisponivel: this.roboDisponivel(), cardapios, conta: linha ? conta : null, comentarios };
  }

  /**
   * Confere o grupo "Instagram Direct" do salvar ANTES de gravar qualquer grupo (V86): liga/desliga só com booleano (V15),
   * o cardápio do robô é um cardápio DESTA empresa (ou vazio = o único), e o robô só liga com a conta conectada. O que não
   * veio fica como está (V16). Devolve o que gravar.
   */
  async conferirAjuste(
    tenantId: string,
    dto: any,
  ): Promise<{ filaLigada?: boolean; roboResponde?: boolean; cardapioId?: string | null; comentarios?: { roboResponde?: boolean; naFila?: boolean } }> {
    if (!dto || typeof dto !== 'object') throw new BadRequestException('Instagram Direct: ajuste inválido.');
    const saida: { filaLigada?: boolean; roboResponde?: boolean; cardapioId?: string | null; comentarios?: { roboResponde?: boolean; naFila?: boolean } } = {};
    // Os COMENTÁRIOS (F6, mig 384): conferidos aqui, com o resto do grupo, antes de gravar qualquer coisa (V86).
    if (dto.comentarios !== undefined) saida.comentarios = await this.comentarios.conferirAjuste(tenantId, dto.comentarios);
    for (const k of ['filaLigada', 'roboResponde'] as const) {
      if (dto[k] === undefined) continue;
      if (typeof dto[k] !== 'boolean') throw new BadRequestException('Instagram Direct: escolha ligado ou desligado.');
      saida[k] = dto[k];
    }
    if (dto.cardapioId !== undefined) {
      if (dto.cardapioId === null || dto.cardapioId === '') saida.cardapioId = null;
      else if (typeof dto.cardapioId !== 'string' || !UUID_RE.test(dto.cardapioId)) throw new BadRequestException('Instagram Direct: escolha o cardápio do robô.');
      else {
        const [ok] = ((await this.db.execute(sql`select 1 from cardapio_config where id = ${dto.cardapioId} and tenant_id = ${tenantId}`)) as any).rows ?? [];
        if (!ok) throw new BadRequestException('Instagram Direct: este cardápio não é desta empresa.');
        saida.cardapioId = dto.cardapioId;
      }
    }
    if (saida.roboResponde === true) {
      const [c] = ((await this.db.execute(sql`select 1 from instagram_conta where tenant_id = ${tenantId}`)) as any).rows ?? [];
      if (!c) throw new BadRequestException('Conecte o Instagram da loja antes de ligar o robô no Direct.');
    }
    return saida;
  }

  /** Grava o que `conferirAjuste` devolveu, só nas colunas que vieram, e cada mudança fica na auditoria. */
  async salvarAjuste(
    user: AuthUser,
    a: { filaLigada?: boolean; roboResponde?: boolean; cardapioId?: string | null; comentarios?: { roboResponde?: boolean; naFila?: boolean } },
  ) {
    if (a.comentarios) await this.comentarios.salvarAjuste(user, a.comentarios);
    if (a.filaLigada !== undefined) await this.salvarFila(user, a.filaLigada);
    if (a.roboResponde !== undefined) {
      const r: any = await this.db.execute(sql`
        update instagram_conta set robo_responde = ${a.roboResponde}, atualizado_em = clock_timestamp()
         where tenant_id = ${user.tenantId} and robo_responde is distinct from ${a.roboResponde} returning id`);
      if ((r.rows ?? r)[0])
        await this.auditoria?.registrar({
          tenantId: user.tenantId,
          atorId: user.colaboradorId,
          atorPerfil: user.categoria,
          tipo: 'config',
          acao: a.roboResponde ? 'robo_no_direct_ligado' : 'robo_no_direct_desligado',
          entidadeTipo: 'instagram_conta',
          entidadeId: user.tenantId,
          detalhe: {},
        });
    }
    if (a.cardapioId !== undefined) {
      const r: any = await this.db.execute(sql`
        update instagram_conta set cardapio_id = ${a.cardapioId}, atualizado_em = clock_timestamp()
         where tenant_id = ${user.tenantId} and cardapio_id is distinct from ${a.cardapioId}::uuid returning id`);
      if ((r.rows ?? r)[0])
        await this.auditoria?.registrar({
          tenantId: user.tenantId,
          atorId: user.colaboradorId,
          atorPerfil: user.categoria,
          tipo: 'config',
          acao: 'cardapio_do_robo_no_direct',
          entidadeTipo: 'instagram_conta',
          entidadeId: user.tenantId,
          detalhe: { cardapioId: a.cardapioId },
        });
    }
  }

  /**
   * O cardápio que o robô do Direct usa: o escolhido, se for desta empresa; sem escolha, o ÚNICO cardápio da empresa;
   * com mais de um e nenhum escolhido, nenhum (o robô não liga). Com os textos do robô da loja (saudação, ausência…).
   */
  async cardapioDoRobo(db: any, tenantId: string, cardapioId: string | null): Promise<CardapioDoRobo | null> {
    const r: any = await db.execute(sql`
      select id, token, ativo, aberto, nome_publico as "nomePublico", robo_saudacao as "roboSaudacao", robo_ausencia as "roboAusencia",
             robo_prompt as "roboPrompt", robo_mensagens as "roboMensagens", site, instagram
        from cardapio_config
       where tenant_id = ${tenantId} and (${cardapioId}::uuid is null or id = ${cardapioId}::uuid)
       order by id limit 2`);
    const linhas = (r.rows ?? r) as CardapioDoRobo[];
    if (cardapioId) return linhas[0] ?? null;
    return linhas.length === 1 ? linhas[0] : null;
  }

  /** O endereço do login do Instagram, com o "state" assinado (empresa, pessoa, 15 min). */
  conectar(user: AuthUser) {
    if (!this.disponivel()) throw new BadGatewayException('A Regem ainda está liberando o Instagram com a Meta. Tente de novo mais tarde.');
    const estado = assinarEstado(user.tenantId, user.colaboradorId, this.segredo());
    return { url: urlDeAutorizacao({ appId: this.appId(), redirect: retornoPadrao(), estado, base: process.env.INSTAGRAM_LOGIN_URL }) };
  }

  /**
   * A volta do login do Instagram (rota pública): confere o "state", troca o código pelo acesso longo, descobre a conta,
   * liga o aviso de mensagens e grava — o acesso cifrado. Devolve para onde a tela volta, com a situação.
   */
  async retorno(q: { code?: unknown; state?: unknown; error?: unknown }): Promise<string> {
    const e = lerEstado(q?.state, this.segredo());
    if (!e) return ajustesDoApp('expirou');
    if (q?.error) return ajustesDoApp('cancelado');
    const codigo = typeof q?.code === 'string' ? q.code.replace(/#_$/, '') : '';
    if (!codigo || !this.disponivel()) return ajustesDoApp('erro');
    // Quem pediu ainda é gestão e está ativo na empresa (a régua da porta na hora da volta — V75).
    const [quem] = ((await this.db.execute(sql`
      select c.id, c.nome, coalesce(p.nivel, f.categoria::text) as nivel
        from colaborador c left join funcao f on f.id = c.funcao_id left join perfil_acesso p on p.id = c.perfil_acesso_id
       where c.id = ${e.c} and c.tenant_id = ${e.t} and c.status = 'ativo' and c.deleted_at is null`)) as any).rows ?? [];
    if (!quem || !['presidente', 'gerente'].includes(String(quem.nivel))) return ajustesDoApp('sem-permissao');
    try {
      const curto = await meta.trocarCodigo({ appId: this.appId(), segredo: this.segredo(), redirect: retornoPadrao(), codigo });
      const longo = await meta.acessoLongo(curto.token, this.segredo());
      const conta = await meta.minhaConta(longo.token);
      await meta.assinarAvisos(conta.igUserId, longo.token);
      await this.db.execute(sql`
        insert into instagram_conta (tenant_id, ig_user_id, usuario, nome, token_cifrado, token_vence_em, token_renovado_em,
                                     permissoes, conectado_por, conectado_em, erro, erro_em, atualizado_em)
        values (${e.t}, ${conta.igUserId}, ${conta.usuario}, ${conta.nome}, ${cifrar(longo.token)}, ${longo.venceEm.toISOString()},
                clock_timestamp(), ${curto.permissoes}, ${e.c}, clock_timestamp(), null, null, clock_timestamp())
        on conflict (tenant_id) do update
           set ig_user_id = excluded.ig_user_id, usuario = excluded.usuario, nome = excluded.nome,
               token_cifrado = excluded.token_cifrado, token_vence_em = excluded.token_vence_em,
               token_renovado_em = excluded.token_renovado_em, permissoes = excluded.permissoes,
               conectado_por = excluded.conectado_por, conectado_em = excluded.conectado_em, erro = null, erro_em = null,
               atualizado_em = clock_timestamp()`);
      await this.auditoria?.registrar({
        tenantId: e.t,
        atorId: e.c,
        atorPerfil: String(quem.nivel),
        tipo: 'config',
        acao: 'conectou_instagram',
        entidadeTipo: 'instagram_conta',
        entidadeId: e.t,
        detalhe: { usuario: conta.usuario },
      });
      return ajustesDoApp('conectado');
    } catch (err: any) {
      // A mesma conta do Instagram já conectada em outra empresa (o índice único — V24).
      if (err?.code === '23505') return ajustesDoApp('em-outra-empresa');
      this.logger.warn(`conectar o Instagram (empresa ${e.t}): ${err?.message ?? err}`);
      return ajustesDoApp('erro');
    }
  }

  /** Desconecta: desliga o aviso na Meta (se der) e apaga a conta — o acesso some junto. Os casos ficam. */
  async desconectar(user: AuthUser) {
    const r: any = await this.db.execute(sql`delete from instagram_conta where tenant_id = ${user.tenantId} returning ig_user_id, token_cifrado, usuario`);
    const c = (r.rows ?? r)[0];
    if (!c) return { ok: true };
    try {
      await meta.desligarAvisos(c.ig_user_id, decifrar(c.token_cifrado));
    } catch (e: any) {
      this.logger.warn(`desconectar o Instagram (empresa ${user.tenantId}): a Meta não desligou o aviso (${e?.message ?? e})`);
    }
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'desconectou_instagram',
      entidadeTipo: 'instagram_conta',
      entidadeId: user.tenantId,
      detalhe: { usuario: c.usuario },
    });
    return { ok: true };
  }

  /** "Mensagens do Direct na fila" (o ajuste da conta). Sem conta conectada, não há o que ligar. */
  async salvarFila(user: AuthUser, ligada: boolean) {
    const r: any = await this.db.execute(sql`
      update instagram_conta set fila_ligada = ${ligada}, atualizado_em = clock_timestamp()
       where tenant_id = ${user.tenantId} and fila_ligada is distinct from ${ligada} returning id`);
    if ((r.rows ?? r)[0])
      await this.auditoria?.registrar({
        tenantId: user.tenantId,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria,
        tipo: 'config',
        acao: ligada ? 'instagram_na_fila_ligado' : 'instagram_na_fila_desligado',
        entidadeTipo: 'instagram_conta',
        entidadeId: user.tenantId,
        detalhe: {},
      });
  }

  // ───────────────────────── o aviso de mensagem ─────────────────────────

  /**
   * O aviso da Meta (já com a assinatura conferida). Nunca lança: cada mensagem é tratada sozinha. Os COMENTÁRIOS dos posts
   * (F6, mig 384 — `entry[].changes[]` com `field: 'comments'`) vêm no MESMO aviso: cada um também sozinho.
   */
  async processar(body: any): Promise<void> {
    for (const ev of lerAviso(body)) {
      try {
        await this.umaMensagem(ev);
      } catch (e: any) {
        this.logger.error(`aviso do Instagram (conta ${ev.conta}): ${e?.message ?? e}`);
      }
    }
    await this.comentarios.processar(body);
  }

  private async umaMensagem(ev: EventoDoDirect) {
    let paraORobo: any = null;
    const aviso: { evento: string; dados: any } | null = await this.db.transaction(async (tx: any) => {
      // A trava da conta: dois avisos do mesmo cliente ao mesmo tempo — um decide, o outro espera e já vê o caso.
      const [conta] = ((await tx.execute(sql`
        select id, tenant_id as "tenantId", fila_ligada as "filaLigada", robo_responde as "roboResponde", cardapio_id as "cardapioId"
          from instagram_conta where ig_user_id = ${ev.conta} for update`)) as any).rows ?? [];
      if (!conta) return null; // conta que não está (mais) conectada: nada a fazer
      if (ev.apagada) {
        if (ev.mid) await tx.execute(sql`update instagram_mensagem set estado = 'apagada' where tenant_id = ${conta.tenantId} and mid = ${ev.mid}`);
        return null;
      }
      const texto = frase(ev);
      const ins: any = await tx.execute(sql`
        insert into instagram_mensagem (tenant_id, ig_user_id, igsid, direcao, autor, tipo, texto, midia_url, mid, estado, criado_em)
        values (${conta.tenantId}, ${ev.conta}, ${ev.igsid}, ${ev.eco ? 'saida' : 'entrada'}, ${ev.eco ? 'loja' : 'cliente'}, ${ev.tipo},
                ${ev.texto}, ${ev.midiaUrl}, ${ev.mid}, ${ev.eco ? 'enviada' : 'recebida'}, ${ev.em.toISOString()})
        on conflict (tenant_id, mid) where mid is not null do nothing
        returning id`);
      const msg = (ins.rows ?? ins)[0];
      // Aviso repetido, ou o eco da resposta que o Regem mandou: nada mais — nem caso, nem o robô (V79/ERR-319: o efeito só
      // quando a gravação idempotente diz que a mensagem é NOVA).
      if (!msg) return null;
      if (ev.eco) return null; // a loja escreveu pelo app do Instagram: fica na conversa (e cala o robô — quemRespondeNoDirect)
      // O robô do Direct (mig 378): ligado pela loja, a distribuição pronta e um cardápio ativo para ele falar da loja.
      const querRobo = conta.roboResponde === true;
      const cardapio = querRobo ? await this.cardapioDoRobo(tx, conta.tenantId, conta.cardapioId) : null;
      const roboLigado = querRobo && this.roboDisponivel() && !!cardapio?.ativo;
      // V88: quem ligou o robô e ele não pode responder recebe a conversa como CASO, mesmo com a fila desligada.
      const filaLigada = conta.filaLigada === true || (querRobo && !roboLigado);
      if (!filaLigada && !roboLigado) return null;
      const [contato] = ((await tx.execute(sql`
        select nome, usuario from instagram_contato where tenant_id = ${conta.tenantId} and igsid = ${ev.igsid}`)) as any).rows ?? [];
      // O caso da conversa: o comum antes do recado para o responsável que espera alguém (mig 381); depois, o mais novo.
      const [aberto] = ((await tx.execute(sql`
        select id, aguardando_desde as "aguardava", ${inicioDoCasoSql('atendimento_chamado')} as "criadoEm",
               responsavel_id as "responsavelId", ${recadoAtivoSql('atendimento_chamado')} as recado,
               ${responsavelNaEsperaSql('atendimento_chamado')} as "paraOResponsavel"
          from atendimento_chamado
         where tenant_id = ${conta.tenantId} and tipo = 'instagram' and status = 'aberto' and detalhe #>> '{instagram,igsid}' = ${ev.igsid}
         order by ${responsavelNaEsperaSql('atendimento_chamado')}, criado_em desc limit 1`)) as any).rows ?? [];
      const [quieto] = roboLigado
        ? (((await tx.execute(sql`
            select (select max(m.criado_em) from instagram_mensagem m
                     where m.tenant_id = ${conta.tenantId} and m.igsid = ${ev.igsid} and m.autor = 'loja') as "ultimaDaLojaEm",
                   (select pausa_minutos from robo_config where tenant_id = ${conta.tenantId}) as minutos,
                   now() as agora`)) as any).rows ?? [])
        : [null];
      const decisao = quemRespondeNoDirect({
        roboLigado,
        filaLigada,
        caso: aberto ?? null,
        ultimaDaLojaEm: quieto?.ultimaDaLojaEm ?? null,
        minutos: minutosDaPausa(quieto?.minutos),
        agora: quieto?.agora ? new Date(quieto.agora).getTime() : Date.now(),
      });
      if (decisao.robo && cardapio)
        paraORobo = this.mensagemParaORobo({ tenantId: conta.tenantId, igUserId: ev.conta, ev, contato, cardapio });
      if (aberto && decisao.anexar) {
        await tx.execute(sql`
          update atendimento_chamado
             set mensagem = ${texto}, aguardando_desde = null,
                 detalhe = coalesce(detalhe, '{}'::jsonb)
                           || jsonb_build_object('instagram', coalesce(detalhe -> 'instagram', '{}'::jsonb) || jsonb_build_object('ultimaEm', ${ev.em.toISOString()}::text))
           where id = ${aberto.id}`);
        await tx.execute(sql`update instagram_mensagem set chamado_id = ${aberto.id} where id = ${msg.id}`);
        return { evento: 'atendimento.mudou', dados: { tenantId: conta.tenantId, id: aberto.id, motivo: 'instagram_mensagem' } };
      }
      if (!decisao.abrir) return null; // o robô responde (ou a loja está respondendo pelo app do Instagram)
      const semRobo = querRobo && !roboLigado ? 'robo_indisponivel' : null;
      // Fora do HORÁRIO DA EQUIPE (mig 379), pelo horário do cardápio do robô: o caso nasce como recado para a abertura
      // (não toca). No Direct o robô não vê pedido — vale só o horário. Lido fora da transação (não a derruba).
      const fora = await recadoDoCasoNovo(this.db, conta.tenantId, { cardapioId: cardapio?.id ?? conta.cardapioId ?? null });
      const detalhe = {
        plataforma: 'instagram',
        instagram: { igsid: ev.igsid, usuario: contato?.usuario ?? null, nome: contato?.nome ?? null, ultimaEm: ev.em.toISOString(), ...(semRobo ? { semRobo } : {}) },
        ...(fora ? { recado: fora.recado } : {}),
      };
      const [novo] = ((await tx.execute(sql`
        insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, mensagem, prioridade, detalhe)
        values (${conta.tenantId}, null, 'instagram', 'instagram', ${nomeDoCliente(contato)}, ${texto}, 'normal', ${JSON.stringify(detalhe)}::jsonb)
        returning *`)) as any).rows ?? [];
      await tx.execute(sql`update instagram_mensagem set chamado_id = ${novo.id} where id = ${msg.id}`);
      return { evento: 'atendimento.novo', dados: { tenantId: conta.tenantId, chamado: novo } };
    });
    if (aviso) this.events.emit(aviso.evento, aviso.dados);
    // Ao robô só DEPOIS de gravar (a resposta dele confere o caso e a janela no banco). Nunca rejeita (V3).
    if (paraORobo) void entregarJuntando(paraORobo).catch((e: any) => this.logger.warn(`Direct ao robô: ${e?.message ?? e}`));
    if (!ev.eco) void this.lerPerfil(ev.conta, ev.igsid);
  }

  /**
   * A mensagem do Direct no formato que o robô (n8n) recebe — o MESMO da API oficial e da Evolution (`MsgNormalizada`):
   * a loja na chave `instancia` (`ig:<conta>`), o cliente em `de` (`ig:<igsid>`), a ficha do Direct em `conversa`. O
   * `tipo` é sempre texto: no Direct o robô não ouve áudio (o texto diz o que veio) e não responde em voz.
   */
  mensagemParaORobo(o: { tenantId: string; igUserId: string; ev: EventoDoDirect; contato: any; cardapio: CardapioDoRobo }) {
    const { ev, cardapio } = o;
    return {
      provedor: 'instagram',
      tenantId: o.tenantId,
      cardapioToken: cardapio.token,
      phoneNumberId: null,
      instancia: chaveDaConta(o.igUserId),
      jid: null,
      loja: { nome: cardapio.nomePublico ?? null, aberto: cardapio.aberto !== false },
      de: chaveDoCliente(ev.igsid),
      nome: (o.contato?.nome || o.contato?.usuario || null) as string | null,
      tipo: 'text',
      texto: textoParaORobo(ev),
      mensagemId: ev.mid ?? '',
      timestamp: Math.floor(ev.em.getTime() / 1000),
      midiaId: null,
      opcaoId: null,
      roboSaudacao: cardapio.roboSaudacao ?? null,
      roboAusencia: cardapio.roboAusencia ?? null,
      roboPrompt: cardapio.roboPrompt ?? null,
      roboMensagens: Array.isArray(cardapio.roboMensagens) ? cardapio.roboMensagens : [],
      conversa: assinarConversaDoDirect(o.tenantId, ev.igsid),
    };
  }

  /** O perfil do cliente (nome, @, se segue a loja): na primeira mensagem e depois de uma semana. Nunca lança (V3). */
  private async lerPerfil(igUserId: string, igsid: string): Promise<void> {
    try {
      const [c] = ((await this.db.execute(sql`
        select c.tenant_id as "tenantId", c.token_cifrado as token, ct.atualizado_em as "lidoEm"
          from instagram_conta c left join instagram_contato ct on ct.tenant_id = c.tenant_id and ct.igsid = ${igsid}
         where c.ig_user_id = ${igUserId}`)) as any).rows ?? [];
      if (!c) return;
      if (c.lidoEm && Date.now() - new Date(c.lidoEm).getTime() < PERFIL_VELHO_DIAS * 86_400_000) return;
      const p = await meta.perfilDoCliente(igsid, decifrar(c.token));
      await this.db.execute(sql`
        insert into instagram_contato (tenant_id, igsid, usuario, nome, segue_a_loja, atualizado_em)
        values (${c.tenantId}, ${igsid}, ${p.usuario}, ${p.nome}, ${p.segue}, clock_timestamp())
        on conflict (tenant_id, igsid) do update
           set usuario = excluded.usuario, nome = excluded.nome, segue_a_loja = excluded.segue_a_loja, atualizado_em = clock_timestamp()`);
      // O caso aberto que nasceu sem o nome ganha o nome do perfil.
      const r: any = await this.db.execute(sql`
        update atendimento_chamado
           set cliente = ${nomeDoCliente(p)},
               detalhe = detalhe || jsonb_build_object('instagram', (detalhe -> 'instagram') || jsonb_build_object('usuario', ${p.usuario}::text, 'nome', ${p.nome}::text))
         where tenant_id = ${c.tenantId} and tipo = 'instagram' and status = 'aberto' and detalhe #>> '{instagram,igsid}' = ${igsid}
           and (detalhe #>> '{instagram,usuario}') is null
         returning id`);
      for (const l of (r.rows ?? r) as any[]) this.events.emit('atendimento.mudou', { tenantId: c.tenantId, id: l.id, motivo: 'instagram_perfil' });
    } catch (e: any) {
      this.logger.warn(`perfil do cliente do Instagram: ${e?.message ?? e}`);
    }
  }

  // ───────────────────────── a conversa e a resposta ─────────────────────────

  private async casoDoInstagram(tenantId: string, id: string) {
    if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException('Caso não encontrado.');
    const [c] = ((await this.db.execute(sql`
      select id, status, responsavel_id as "responsavelId", detalhe #>> '{instagram,igsid}' as igsid
        from atendimento_chamado where tenant_id = ${tenantId} and id = ${id} and tipo = 'instagram'`)) as any).rows ?? [];
    if (!c || !c.igsid) throw new NotFoundException('Caso do Instagram não encontrado.');
    return c;
  }

  /** A conversa do caso: as últimas 60 mensagens, o perfil do cliente, a conta da loja e a janela do Instagram. */
  async conversa(tenantId: string, id: string) {
    if (ehServidorLocal()) return this.pelaNuvem('GET', `instagram-da-loja?chamado=${encodeURIComponent(String(id ?? ''))}`);
    const c = await this.casoDoInstagram(tenantId, id);
    const [msgs, perfil, conta, ultima] = await Promise.all([
      this.db.execute(sql`
        select * from (
          select id, direcao, autor, tipo, texto, midia_url as "midiaUrl", estado, erro, criado_em as "criadoEm",
                 (select nome from colaborador where id = m.autor_id) as "autorNome"
            from instagram_mensagem m where tenant_id = ${tenantId} and igsid = ${c.igsid}
           order by criado_em desc limit 60) x order by "criadoEm"`),
      this.db.execute(sql`select usuario, nome, segue_a_loja as "segue" from instagram_contato where tenant_id = ${tenantId} and igsid = ${c.igsid}`),
      this.db.execute(sql`select usuario from instagram_conta where tenant_id = ${tenantId}`),
      this.db.execute(sql`select max(criado_em) as em from instagram_mensagem where tenant_id = ${tenantId} and igsid = ${c.igsid} and autor = 'cliente'`),
    ]);
    const linhas = (r: any) => (r.rows ?? r) as any[];
    return {
      mensagens: linhas(msgs),
      perfil: linhas(perfil)[0] ?? null,
      conta: linhas(conta)[0]?.usuario ?? null,
      conectada: !!linhas(conta)[0],
      janela: janela(linhas(ultima)[0]?.em ?? null),
    };
  }

  /**
   * A resposta da equipe no Direct: a gestão, dentro da janela de 24 h, com a conta conectada. Sai pela Meta e fica na
   * conversa (com o id da Meta: o eco que vier depois não entra de novo). Responder pega o caso para quem respondeu.
   */
  async responder(user: AuthUser, id: string, dto: any) {
    if (!(QUEM_RESPONDE as readonly string[]).includes(user.categoria)) throw new ForbiddenException('Quem responde no Instagram é a gestão.');
    const t = textoDaResposta(dto?.texto);
    if (!t.ok) throw new BadRequestException(t.erro);
    if (ehServidorLocal())
      return this.pelaNuvem('POST', 'instagram-da-loja', { chamadoId: id, texto: t.texto, atorId: user.colaboradorId, atorPerfil: user.categoria });
    return this.enviar(user.tenantId, id, t.texto, { id: user.colaboradorId, perfil: user.categoria });
  }

  /** A resposta vinda do servidor da loja: quem respondeu é colaborador ativo da empresa e da gestão (conferido aqui). */
  async responderVindoDaLoja(tenantId: string, dto: any) {
    const t = textoDaResposta(dto?.texto);
    if (!t.ok) throw new BadRequestException(t.erro);
    const atorId = typeof dto?.atorId === 'string' && UUID_RE.test(dto.atorId) ? dto.atorId : null;
    const [quem] = atorId
      ? ((await this.db.execute(sql`
          select c.id, coalesce(p.nivel, f.categoria::text) as nivel from colaborador c left join funcao f on f.id = c.funcao_id left join perfil_acesso p on p.id = c.perfil_acesso_id
           where c.id = ${atorId} and c.tenant_id = ${tenantId} and c.status = 'ativo' and c.deleted_at is null`)) as any).rows ?? []
      : [];
    if (!quem || !(QUEM_RESPONDE as readonly string[]).includes(String(quem.nivel))) throw new ForbiddenException('Quem responde no Instagram é a gestão.');
    return this.enviar(tenantId, String(dto?.chamadoId ?? ''), t.texto, { id: quem.id, perfil: String(quem.nivel) });
  }

  private async enviar(tenantId: string, id: string, texto: string, quem: { id: string; perfil: string }) {
    const c = await this.casoDoInstagram(tenantId, id);
    const [conta] = ((await this.db.execute(sql`select ig_user_id as "igUserId", token_cifrado as token from instagram_conta where tenant_id = ${tenantId}`)) as any).rows ?? [];
    if (!conta) throw new ConflictException('O Instagram da loja não está conectado: conecte em Delivery › Configurações › Atendimento.');
    const [u] = ((await this.db.execute(sql`
      select max(criado_em) as em from instagram_mensagem where tenant_id = ${tenantId} and igsid = ${c.igsid} and autor = 'cliente'`)) as any).rows ?? [];
    if (!janela(u?.em ?? null).aberta)
      throw new ConflictException('Passaram 24 h da última mensagem do cliente: o Instagram não deixa a loja responder agora. Quando ele escrever de novo, a conversa abre.');
    let mid: string | null = null;
    try {
      mid = (await meta.enviarTexto(conta.igUserId, decifrar(conta.token), c.igsid, texto)).mid;
    } catch (e: any) {
      await this.db.execute(sql`
        insert into instagram_mensagem (tenant_id, ig_user_id, igsid, direcao, autor, tipo, texto, chamado_id, autor_id, estado, erro)
        values (${tenantId}, ${conta.igUserId}, ${c.igsid}, 'saida', 'equipe', 'texto', ${texto}, ${c.id}, ${quem.id}, 'falhou', ${String(e?.message ?? e).slice(0, 300)})`);
      this.logger.warn(`resposta no Instagram (empresa ${tenantId}): ${e?.message ?? e}`);
      throw new BadGatewayException(`O Instagram não aceitou a mensagem${e?.message ? `: ${String(e.message).slice(0, 200)}` : '.'}`);
    }
    // O eco da Meta pode chegar ANTES desta gravação: com o mesmo id, quem chegar depois não entra (o índice do `mid`).
    await this.db.execute(sql`
      insert into instagram_mensagem (tenant_id, ig_user_id, igsid, direcao, autor, tipo, texto, mid, chamado_id, autor_id, estado)
      values (${tenantId}, ${conta.igUserId}, ${c.igsid}, 'saida', 'equipe', 'texto', ${texto}, ${mid}, ${c.id}, ${quem.id}, 'enviada')
      on conflict (tenant_id, mid) where mid is not null do update set autor = 'equipe', autor_id = excluded.autor_id, chamado_id = excluded.chamado_id`);
    await this.db.execute(sql`
      update atendimento_chamado set responsavel_id = coalesce(responsavel_id, ${quem.id}), pego_em = coalesce(pego_em, now())
       where id = ${c.id} and status = 'aberto'`);
    await this.auditoria?.registrar({
      tenantId,
      atorId: quem.id,
      atorPerfil: quem.perfil,
      tipo: 'atendimento',
      acao: 'respondeu_instagram',
      entidadeTipo: 'atendimento_chamado',
      entidadeId: c.id,
      detalhe: {},
    });
    this.events.emit('atendimento.mudou', { tenantId, id: c.id, motivo: 'respondeu_instagram' });
    return { ok: true, mid };
  }

  // ───────────────────────── o robô no Direct (mig 378) ─────────────────────────

  /**
   * Para quem vai a resposta do robô (`publico/bot/responder` com a chave `ig:`), RECONFERIDO na hora (V87): a conta
   * conectada, o robô do Direct ligado e a distribuição pronta, o cardápio dele ativo. O cliente é o `ig:<igsid>` que o
   * robô recebeu em `de`. 400 para chave que não é do Direct; 404 para conta que não está conectada.
   */
  /**
   * O cardápio que as consultas do robô usam no Direct (loja, cardápio, taxa e as instruções — chave `ig:<conta>`): só
   * com a conta conectada, o robô do Direct ligado, a distribuição pronta e o cardápio ativo; senão `null` (404).
   */
  async cardapioDaConta(instancia: unknown): Promise<CardapioDoRobo | null> {
    const igUserId = idDaChave(instancia);
    if (!igUserId || !this.roboDisponivel()) return null;
    const [c] = ((await this.db.execute(sql`
      select tenant_id as "tenantId", robo_responde as "roboResponde", cardapio_id as "cardapioId" from instagram_conta where ig_user_id = ${igUserId}`)) as any).rows ?? [];
    if (!c || c.roboResponde !== true) return null;
    const cardapio = await this.cardapioDoRobo(this.db, c.tenantId, c.cardapioId);
    return cardapio?.ativo ? cardapio : null;
  }

  async alvoDoRobo(instancia: unknown, para: unknown): Promise<AlvoDoRobo> {
    const igUserId = idDaChave(instancia);
    const igsid = idDaChave(para);
    if (!igUserId || !igsid) throw new BadRequestException('Conversa do Direct inválida.');
    const [c] = ((await this.db.execute(sql`
      select tenant_id as "tenantId", robo_responde as "roboResponde", cardapio_id as "cardapioId" from instagram_conta where ig_user_id = ${igUserId}`)) as any).rows ?? [];
    if (!c) throw new NotFoundException('Instagram não conectado a uma loja.');
    if (c.roboResponde !== true || !this.roboDisponivel()) return { ligado: false, motivo: 'robo_desligado' };
    const cardapio = await this.cardapioDoRobo(this.db, c.tenantId, c.cardapioId);
    if (!cardapio?.ativo) return { ligado: false, motivo: 'robo_desligado' };
    return { ligado: true, tenantId: c.tenantId, igUserId, igsid, cardapio };
  }

  /**
   * A resposta do robô no Direct (o texto já pronto: links da loja e opções numeradas — robo-resposta.service). Na trava
   * da conta: SEGURA quando a conversa está com alguém (a mesma régua da entrada — quemRespondeNoDirect), salvo UMA vez o
   * "já chamei a equipe" que o handoff liberou (V83, decidido ANTES de o caso abrir); segura também fora da janela de 24 h.
   * Sai em até 3 mensagens de 1.000 bytes; cada uma fica na conversa como `robo`, com o id da Meta (o eco não entra de
   * novo e não cala o robô). Falha da Meta fica na conversa e volta 502.
   */
  async enviarDoRobo(alvo: Extract<AlvoDoRobo, { ligado: true }>, texto: string): Promise<{ ok: true; enviado: boolean; motivo?: string; enviados?: string[] }> {
    const { tenantId, igUserId, igsid } = alvo;
    const partes = partirTexto(texto);
    if (!partes.length) throw new BadRequestException('Nada para enviar.');
    const decisao = await this.db.transaction(async (tx: any) => {
      const [conta] = ((await tx.execute(sql`
        select token_cifrado as token from instagram_conta where tenant_id = ${tenantId} and ig_user_id = ${igUserId} for update`)) as any).rows ?? [];
      if (!conta) return { pode: false as const, motivo: 'robo_desligado' };
      const [l] = ((await tx.execute(sql`
        select (select row_to_json(x) from (
                  select a.id, ${inicioDoCasoSql('a')} as "criadoEm", a.responsavel_id as "responsavelId",
                         ${recadoAtivoSql('a')} as recado, ${responsavelNaEsperaSql('a')} as "paraOResponsavel",
                         (a.detalhe #>> '{instagram,avisoLiberado}') = 'true' as "avisoLiberado"
                    from atendimento_chamado a
                   where a.tenant_id = ${tenantId} and a.tipo = 'instagram' and a.status = 'aberto' and a.detalhe #>> '{instagram,igsid}' = ${igsid}
                   order by ${responsavelNaEsperaSql('a')}, a.criado_em desc limit 1) x) as caso,
               (select max(m.criado_em) from instagram_mensagem m where m.tenant_id = ${tenantId} and m.igsid = ${igsid} and m.autor = 'loja') as "ultimaDaLojaEm",
               (select max(m.criado_em) from instagram_mensagem m where m.tenant_id = ${tenantId} and m.igsid = ${igsid} and m.autor = 'cliente') as "ultimaDoCliente",
               (select pausa_minutos from robo_config where tenant_id = ${tenantId}) as minutos,
               now() as agora`)) as any).rows ?? [];
      if (!janela(l?.ultimaDoCliente ?? null).aberta) return { pode: false as const, motivo: 'fora_da_janela' };
      const caso = l?.caso ?? null;
      const r = quemRespondeNoDirect({
        roboLigado: true,
        filaLigada: false,
        caso,
        ultimaDaLojaEm: l?.ultimaDaLojaEm ?? null,
        minutos: minutosDaPausa(l?.minutos),
        agora: l?.agora ? new Date(l.agora).getTime() : Date.now(),
      });
      if (!r.robo) {
        // O "já chamei" do handoff: liberado uma vez só, consumido aqui (vale com várias instâncias da API).
        if (!caso?.avisoLiberado) return { pode: false as const, motivo: 'conversa_pausada' };
        const usado: any = await tx.execute(sql`
          update atendimento_chamado
             set detalhe = detalhe || jsonb_build_object('instagram', (detalhe -> 'instagram') || jsonb_build_object('avisoLiberado', false))
           where id = ${caso.id} and status = 'aberto' and (detalhe #>> '{instagram,avisoLiberado}') = 'true'
           returning id`);
        if (!(usado.rows ?? usado)[0]) return { pode: false as const, motivo: 'conversa_pausada' };
      }
      return { pode: true as const, token: conta.token as string, chamadoId: (caso?.id as string) ?? null };
    });
    if (!decisao.pode) {
      this.logger.log(`resposta do robô no Direct segurada (${decisao.motivo}) empresa=${tenantId}`);
      return { ok: true, enviado: false, motivo: decisao.motivo };
    }
    const enviados: string[] = [];
    for (const parte of partes) {
      let mid: string | null = null;
      try {
        mid = (await meta.enviarTexto(igUserId, decifrar(decisao.token), igsid, parte)).mid;
      } catch (e: any) {
        await this.db.execute(sql`
          insert into instagram_mensagem (tenant_id, ig_user_id, igsid, direcao, autor, tipo, texto, chamado_id, estado, erro)
          values (${tenantId}, ${igUserId}, ${igsid}, 'saida', 'robo', 'texto', ${parte}, ${decisao.chamadoId}, 'falhou', ${String(e?.message ?? e).slice(0, 300)})`);
        this.logger.warn(`resposta do robô no Direct (empresa ${tenantId}): ${e?.message ?? e}`);
        throw new BadGatewayException(`O Instagram não aceitou a mensagem${e?.message ? `: ${String(e.message).slice(0, 200)}` : '.'}`);
      }
      // O eco da Meta pode chegar ANTES desta gravação (entrou como `loja`): pelo mesmo id, ela passa a ser do robô.
      await this.db.execute(sql`
        insert into instagram_mensagem (tenant_id, ig_user_id, igsid, direcao, autor, tipo, texto, mid, chamado_id, estado)
        values (${tenantId}, ${igUserId}, ${igsid}, 'saida', 'robo', 'texto', ${parte}, ${mid}, ${decisao.chamadoId}, 'enviada')
        on conflict (tenant_id, mid) where mid is not null do update set autor = 'robo', chamado_id = coalesce(instagram_mensagem.chamado_id, excluded.chamado_id)`);
      enviados.push('texto');
    }
    if (decisao.chamadoId) this.events.emit('atendimento.mudou', { tenantId, id: decisao.chamadoId, motivo: 'robo_respondeu_instagram' });
    return { ok: true, enviado: true, enviados };
  }

  /**
   * "CHAMAR ATENDENTE" no Direct (a ferramenta do robô, pela rota do cardápio com `telefone: ig:<igsid>`): só com a ficha
   * do Direct desta empresa e deste cliente (o robô não abre caso para outra pessoa — V79). Na trava da conta: lê ANTES se
   * a conversa já estava com alguém (V83) — se não estava, libera UMA resposta do robô (o "já chamei a equipe"); abre o
   * caso do Direct com o resumo (Motivo / Quer / Já fiz), ou soma ao que já está aberto (a prioridade só sobe). A resposta
   * traz a posição na fila (se a loja diz a posição) ou `comAlguem`.
   * HORÁRIO DA EQUIPE (mig 379): fora do horário (o do cardápio do robô), o caso novo nasce como RECADO para a abertura
   * e somar a um recado o mantém; a resposta traz `foraDoHorario`, `equipeVolta` e `paraOCliente` (sem a posição).
   * ASSUNTOS QUE NÃO SÃO PEDIDO (mig 381): `tipo` fornecedor, vaga ou parceria com o assunto em "recado" na empresa → o
   * caso do Direct (tipo `instagram`, como todo caso do Direct) nasce com `detalhe.responsavel = { assunto, em }`, prioridade
   * normal, a qualquer hora; só soma ao recado aberto do MESMO assunto, e um caso comum nunca soma nele (nem ele no comum).
   * A tela recebe só "mudou" (não toca). A resposta traz `paraOResponsavel`, `assunto` e `paraOCliente` (o texto do
   * assunto), sem a posição. O assunto em "Como hoje" (ou "não é por aqui") = o caso comum, como antes.
   */
  async abrirPeloRobo(tenantIdDoCardapio: string, dto: any) {
    const conv = lerConversaDoDirect(dto?.conversa);
    if (!conv || conv.tenantId !== tenantIdDoCardapio) throw new UnauthorizedException('Conversa do Direct inválida.');
    const igsidDoTelefone = idDaChave(dto?.telefone);
    if (igsidDoTelefone && igsidDoTelefone !== conv.igsid) throw new UnauthorizedException('Conversa do Direct inválida.');
    const { tenantId, igsid } = conv;
    // Lido fora da transação (nunca rejeita: falha = o caso comum, com o motivo no log).
    const aceito = await recadoParaOResponsavel(this.db, tenantId, dto?.tipo);
    const urgente = !aceito && (dto?.prioridade === 'urgente' || dto?.urgente === true || dto?.urgente === 'true');
    const resumo = resumoDoRobo(dto, urgente);
    const mensagem = typeof dto?.mensagem === 'string' && dto.mensagem.trim() ? dto.mensagem.trim().slice(0, 1000) : null;
    type Chamou = {
      id: string;
      novo: any;
      mudou: boolean;
      prioridade: string;
      recado: Recado | null;
      textoFora?: string | null;
      cardapioId: string | null;
      paraOResponsavel?: true;
    };
    const r = await this.db.transaction(async (tx: any): Promise<Chamou> => {
      const [conta] = ((await tx.execute(sql`
        select id, cardapio_id as "cardapioId" from instagram_conta where tenant_id = ${tenantId} for update`)) as any).rows ?? [];
      if (!conta) throw new NotFoundException('Instagram não conectado.');
      const cardapioId: string | null = conta.cardapioId ?? null;
      const doDirect = sql`a.tenant_id = ${tenantId} and a.tipo = 'instagram' and a.status = 'aberto' and a.detalhe #>> '{instagram,igsid}' = ${igsid}`;
      // `caso` = o da conversa (o comum antes do recado para o responsável que espera — decide o "já chamei", V83);
      // `alvo` = onde somar: o recado aberto do MESMO assunto, ou o caso comum mais novo (mig 381).
      const [l] = ((await tx.execute(sql`
        select (select row_to_json(x) from (
                  select a.id, a.responsavel_id as "responsavelId"
                    from atendimento_chamado a where ${doDirect}
                   order by ${responsavelNaEsperaSql('a')}, a.criado_em desc limit 1) x) as caso,
               (select row_to_json(x) from (
                  select a.id, a.prioridade, a.mensagem, a.responsavel_id as "responsavelId", a.criado_em as "criadoEm",
                         a.detalhe -> 'recado' as recado, ${recadoAtivoSql('a')} as "recadoAtivo"
                    from atendimento_chamado a
                   where ${doDirect}
                     and ${aceito ? sql`a.detalhe #>> '{responsavel,assunto}' = ${aceito.assunto}::text` : sql`(a.detalhe -> 'responsavel') is null`}
                   order by a.criado_em desc limit 1) x) as alvo,
               (select max(m.criado_em) from instagram_mensagem m where m.tenant_id = ${tenantId} and m.igsid = ${igsid} and m.autor = 'loja') as "ultimaDaLojaEm",
               (select pausa_minutos from robo_config where tenant_id = ${tenantId}) as minutos,
               (select row_to_json(ct) from (select nome, usuario from instagram_contato where tenant_id = ${tenantId} and igsid = ${igsid}) ct) as contato,
               now() as agora`)) as any).rows ?? [];
      const caso = l?.alvo ?? null;
      const minutos = minutosDaPausa(l?.minutos);
      const agora = l?.agora ? new Date(l.agora).getTime() : Date.now();
      const t = l?.ultimaDaLojaEm ? new Date(l.ultimaDaLojaEm).getTime() : NaN;
      const lojaRespondeu = Number.isFinite(t) && agora - t < (minutos > 0 ? minutos * 60_000 : 12 * 3_600_000);
      // V83: a leitura de ANTES de abrir decide o "já chamei" — com a conversa já com alguém, o robô não fala por cima.
      const liberar = !(l?.caso?.responsavelId || lojaRespondeu);
      if (aceito) {
        // O RECADO PARA O RESPONSÁVEL (mig 381): não cala o robô — não precisa liberar o "já chamei".
        const robo = { ...(resumoComORecado(resumo, mensagem) ?? {}), em: new Date(agora).toISOString() };
        if (caso) {
          await tx.execute(sql`
            update atendimento_chamado
               set mensagem = ${juntarMensagem(caso.mensagem, mensagem)}, aguardando_desde = null,
                   detalhe = coalesce(detalhe, '{}'::jsonb) || ${JSON.stringify({ robo })}::jsonb
             where id = ${caso.id}`);
          return { id: caso.id as string, novo: null, mudou: true, prioridade: caso.prioridade, recado: null, cardapioId, paraOResponsavel: true };
        }
        const detalhe = {
          plataforma: 'instagram',
          instagram: { igsid, usuario: l?.contato?.usuario ?? null, nome: l?.contato?.nome ?? null, ultimaEm: new Date(agora).toISOString(), abertoPeloRobo: true, avisoLiberado: false },
          robo,
          responsavel: { assunto: aceito.assunto, em: new Date(agora).toISOString() },
        };
        const [novo] = ((await tx.execute(sql`
          insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, mensagem, prioridade, detalhe)
          values (${tenantId}, null, 'instagram', 'instagram', ${nomeDoCliente(l?.contato)}, ${mensagem ?? 'O robô deixou um recado para o responsável'},
                  'normal', ${JSON.stringify(detalhe)}::jsonb)
          returning *`)) as any).rows ?? [];
        await tx.execute(sql`
          update instagram_mensagem set chamado_id = ${novo.id}
           where tenant_id = ${tenantId} and igsid = ${igsid} and chamado_id is null and criado_em > now() - interval '12 hours'`);
        return { id: novo.id as string, novo, mudou: false, prioridade: 'normal', recado: null, cardapioId, paraOResponsavel: true };
      }
      const robo = resumo ? { ...resumo, em: new Date(agora).toISOString() } : null;
      if (caso) {
        const subiu = urgente && caso.prioridade !== 'urgente';
        const junta = juntarMensagem(caso.mensagem, mensagem);
        const [row] = ((await tx.execute(sql`
          update atendimento_chamado
             set prioridade = ${subiu ? 'urgente' : caso.prioridade}, mensagem = ${junta}, aguardando_desde = null,
                 detalhe = coalesce(detalhe, '{}'::jsonb)
                           || ${JSON.stringify(robo ? { robo } : {})}::jsonb
                           || jsonb_build_object('instagram', coalesce(detalhe -> 'instagram', '{}'::jsonb) || jsonb_build_object('avisoLiberado', ${liberar}::boolean))
           where id = ${caso.id}
           returning *`)) as any).rows ?? [];
        // Somou a um RECADO que ainda espera a equipe (mig 379): continua recado (o `detalhe.recado` fica — a mescla só
        // toca o robô e o Direct) e a resposta repete ao robô quando a equipe volta.
        const recado = caso.recadoAtivo === true ? lerRecado({ recado: caso.recado }) : null;
        return { id: caso.id as string, novo: subiu ? row : null, mudou: !subiu, prioridade: row?.prioridade ?? caso.prioridade, recado, cardapioId };
      }
      // Fora do HORÁRIO DA EQUIPE (mig 379), pelo horário do cardápio do robô: o caso nasce como recado para a abertura.
      // No Direct o robô não vê pedido — vale só o horário. Lido fora da transação (não a derruba).
      const fora = await recadoDoCasoNovo(this.db, tenantId, { cardapioId });
      const detalhe = {
        plataforma: 'instagram',
        instagram: { igsid, usuario: l?.contato?.usuario ?? null, nome: l?.contato?.nome ?? null, ultimaEm: new Date(agora).toISOString(), abertoPeloRobo: true, avisoLiberado: liberar },
        ...(robo ? { robo } : {}),
        ...(fora ? { recado: fora.recado } : {}),
      };
      const [novo] = ((await tx.execute(sql`
        insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, mensagem, prioridade, detalhe)
        values (${tenantId}, null, 'instagram', 'instagram', ${nomeDoCliente(l?.contato)}, ${mensagem ?? 'O robô chamou a equipe no Direct'},
                ${urgente ? 'urgente' : 'normal'}, ${JSON.stringify(detalhe)}::jsonb)
        returning *`)) as any).rows ?? [];
      // As mensagens da conversa (últimas 12 h) passam a ser deste caso.
      await tx.execute(sql`
        update instagram_mensagem set chamado_id = ${novo.id}
         where tenant_id = ${tenantId} and igsid = ${igsid} and chamado_id is null and criado_em > now() - interval '12 hours'`);
      return {
        id: novo.id as string,
        novo,
        mudou: false,
        prioridade: novo.prioridade,
        recado: fora?.recado ?? null,
        textoFora: fora?.situacao.textoFora ?? null,
        cardapioId,
      };
    });
    if (r.paraOResponsavel && aceito) {
      // O recado para o responsável não toca: a tela só relê a fila (que filtra pelo perfil — o aviso não leva o caso).
      this.events.emit('atendimento.mudou', { tenantId, id: r.id, motivo: r.novo ? 'recado_para_o_responsavel' : 'robo_somou' });
      return respostaParaOResponsavel(r.id, aceito, !r.novo);
    }
    if (r.novo) this.events.emit('atendimento.novo', { tenantId, chamado: r.novo });
    else if (r.mudou) this.events.emit('atendimento.mudou', { tenantId, id: r.id, motivo: 'robo_somou' });
    if (r.recado) {
      // Fora do horário: o robô manda ao cliente `paraOCliente` como veio (quando a equipe volta), sem a posição.
      const textoFora = r.textoFora !== undefined ? r.textoFora : (await situacaoDaEquipe(this.db, tenantId, { cardapioId: r.cardapioId })).textoFora;
      return { ok: true, id: r.id, prioridade: r.prioridade, comAlguem: false, ...respostaDoRecado(r.recado, textoFora) };
    }
    const pos = await posicaoNaFila(this.db, tenantId, r.id);
    const [cfg] = ((await this.db.execute(sql`select dizer_posicao as "dizer" from robo_config where tenant_id = ${tenantId}`)) as any).rows ?? [];
    return { ok: true, id: r.id, prioridade: r.prioridade, posicao: cfg?.dizer === false ? null : pos.posicao, comAlguem: pos.comAlguem };
  }

  /**
   * O ROBÔ NÃO RESPONDEU (V88), a cada minuto, só na nuvem: a conversa do Direct com o robô ligado em que a ÚLTIMA
   * mensagem é do cliente, há mais de 3 min, sem caso aberto, vira caso para uma pessoa. A condição toda no `where` (V84);
   * as últimas 30 min, até 100 por rodada. Na trava da conta, confere de novo; o id do caso vem da mensagem (`uuidDeChave`:
   * duas rodadas ou duas instâncias = um caso — V42). O recado para o responsável que espera alguém (mig 381) não conta
   * como "caso aberto": ele não está na fila da equipe — sem resposta do robô, a conversa vira um caso comum.
   */
  @Cron('*/1 * * * *')
  async semResposta(): Promise<number> {
    if (ehServidorLocal()) return 0;
    const r: any = await this.db.execute(sql`
      select c.tenant_id as "tenantId", c.cardapio_id as "cardapioId", m.igsid, m.id as "msgId", m.texto, m.tipo
        from instagram_conta c
        join lateral (
          select distinct on (x.igsid) x.igsid, x.id, x.texto, x.tipo, x.autor, x.criado_em
            from instagram_mensagem x
           where x.tenant_id = c.tenant_id and x.criado_em > now() - interval '30 minutes' and x.estado not in ('apagada', 'falhou')
           order by x.igsid, x.criado_em desc, x.id desc) m on true
       where c.robo_responde
         and m.autor = 'cliente' and m.criado_em < now() - make_interval(secs => ${SEM_RESPOSTA_MS / 1000})
         and not exists (select 1 from atendimento_chamado a
                          where a.tenant_id = c.tenant_id and a.tipo = 'instagram' and a.status = 'aberto'
                            and a.detalhe #>> '{instagram,igsid}' = m.igsid and not ${responsavelNaEsperaSql('a')})
       limit 100`);
    let abertos = 0;
    for (const p of (r.rows ?? r) as any[]) {
      try {
        const novo = await this.db.transaction(async (tx: any) => {
          await tx.execute(sql`select 1 from instagram_conta where tenant_id = ${p.tenantId} for update`);
          const [ainda] = ((await tx.execute(sql`
            select 1 where not exists (select 1 from atendimento_chamado a
                                        where a.tenant_id = ${p.tenantId} and a.tipo = 'instagram' and a.status = 'aberto'
                                          and a.detalhe #>> '{instagram,igsid}' = ${p.igsid} and not ${responsavelNaEsperaSql('a')})
                       and (select autor from instagram_mensagem where tenant_id = ${p.tenantId} and igsid = ${p.igsid} and estado not in ('apagada', 'falhou')
                             order by criado_em desc, id desc limit 1) = 'cliente'`)) as any).rows ?? [];
          if (!ainda) return null;
          const [ct] = ((await tx.execute(sql`select nome, usuario from instagram_contato where tenant_id = ${p.tenantId} and igsid = ${p.igsid}`)) as any).rows ?? [];
          // Fora do HORÁRIO DA EQUIPE (mig 379): o caso nasce como recado para a abertura — o "3 min sem resposta" não
          // toca de madrugada; a conversa fica guardada para quando a equipe começar.
          const fora = await recadoDoCasoNovo(this.db, p.tenantId, { cardapioId: p.cardapioId ?? null });
          const detalhe = {
            plataforma: 'instagram',
            instagram: { igsid: p.igsid, usuario: ct?.usuario ?? null, nome: ct?.nome ?? null, ultimaEm: new Date().toISOString(), semResposta: true },
            ...(fora ? { recado: fora.recado } : {}),
          };
          const [c] = ((await tx.execute(sql`
            insert into atendimento_chamado (id, tenant_id, unidade_id, tipo, canal, cliente, mensagem, prioridade, detalhe)
            values (${uuidDeChave('instagram-sem-resposta', p.tenantId, p.msgId)}, ${p.tenantId}, null, 'instagram', 'instagram', ${nomeDoCliente(ct)},
                    ${frase({ texto: p.texto, tipo: p.tipo as any })}, 'normal', ${JSON.stringify(detalhe)}::jsonb)
            on conflict (id) do nothing
            returning *`)) as any).rows ?? [];
          if (!c) return null;
          await tx.execute(sql`
            update instagram_mensagem set chamado_id = ${c.id}
             where tenant_id = ${p.tenantId} and igsid = ${p.igsid} and chamado_id is null and criado_em > now() - interval '12 hours'`);
          return c;
        });
        if (novo) {
          abertos++;
          this.logger.log(`Direct sem resposta do robô virou caso (empresa ${p.tenantId}).`);
          this.events.emit('atendimento.novo', { tenantId: p.tenantId, chamado: novo });
        }
      } catch (e: any) {
        this.logger.warn(`Direct sem resposta (empresa ${p.tenantId}): ${e?.message ?? e}`);
      }
    }
    return abertos;
  }

  // ───────────────────────── a renovação do acesso ─────────────────────────

  /** Todo dia, só na nuvem: renova o acesso que passou de 20 dias (vale 60). Falha fica na conta ("Reconecte"). */
  @Cron('17 4 * * *')
  async renovarAcessos(): Promise<number> {
    if (ehServidorLocal() || !chaveSegredosDisponivel()) return 0;
    const r: any = await this.db.execute(sql`
      select tenant_id as "tenantId", token_cifrado as token from instagram_conta
       where token_renovado_em < now() - make_interval(days => ${RENOVAR_DEPOIS_DE_DIAS})
         and (token_vence_em is null or token_vence_em > now())
       order by token_renovado_em limit 200`);
    let feitas = 0;
    for (const c of (r.rows ?? r) as any[]) {
      try {
        const novo = await meta.renovarAcesso(decifrar(c.token));
        await this.db.execute(sql`
          update instagram_conta set token_cifrado = ${cifrar(novo.token)}, token_vence_em = ${novo.venceEm.toISOString()},
                 token_renovado_em = clock_timestamp(), erro = null, erro_em = null, atualizado_em = clock_timestamp()
           where tenant_id = ${c.tenantId}`);
        feitas++;
      } catch (e: any) {
        this.logger.warn(`renovar o acesso do Instagram (empresa ${c.tenantId}): ${e?.message ?? e}`);
        await this.db.execute(sql`
          update instagram_conta set erro = 'Não deu para renovar o acesso ao Instagram: reconecte a conta.', erro_em = clock_timestamp()
           where tenant_id = ${c.tenantId}`);
      }
    }
    return feitas;
  }

  // ───────────────────────── servidor da loja → nuvem ─────────────────────────

  /** O pedido do servidor da loja à nuvem (token do servidor). A recusa da nuvem volta com o mesmo código HTTP (e o `code`). */
  async pelaNuvem(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<any> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) throw new BadGatewayException('Este servidor não está ligado à nuvem: o Instagram da loja fala com ela.');
    let res: Response;
    try {
      res = await fetch(`${nuvem}/atendimento/${caminho}`, {
        method: metodo,
        headers: { 'x-sync-token': token, ...(corpo ? { 'content-type': 'application/json' } : {}) },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e: any) {
      this.logger.warn(`Instagram (${metodo} ${caminho.split('?')[0]}): a nuvem não respondeu (${e?.cause?.code ?? e?.message ?? e})`);
      throw new BadGatewayException('A nuvem não respondeu agora. Tente de novo em instantes.');
    }
    const j: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = typeof j?.message === 'string' ? j.message : `a nuvem recusou (HTTP ${res.status})`;
      // O `code` da recusa (ex.: JA_RESPONDIDO nos comentários) segue até a tela do servidor da loja.
      const corpoDoErro = (status: number) => (typeof j?.code === 'string' ? { statusCode: status, code: j.code, message: msg } : msg);
      if (res.status === 409) throw new ConflictException(corpoDoErro(409));
      if (res.status === 404) throw new NotFoundException(corpoDoErro(404));
      if (res.status === 403) throw new ForbiddenException(corpoDoErro(403));
      if (res.status === 400) throw new BadRequestException(corpoDoErro(400));
      throw new BadGatewayException(corpoDoErro(502));
    }
    return j;
  }
}
