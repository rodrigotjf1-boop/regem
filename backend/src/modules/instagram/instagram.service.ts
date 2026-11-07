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
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { ehServidorLocal } from '../../common/modo';
import { chaveSegredosDisponivel, cifrar, decifrar } from '../../common/cifra-segredo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  assinarEstado,
  frase,
  janela,
  lerAviso,
  lerEstado,
  nomeDoCliente,
  textoDaResposta,
  urlDeAutorizacao,
  type EventoDoDirect,
} from './instagram';
import * as meta from './instagram-graph';

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

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private appId = () => String(process.env.INSTAGRAM_APP_ID ?? '').trim();
  private segredo = () => String(process.env.INSTAGRAM_APP_SECRET ?? '').trim();

  /** A distribuição liberou o Instagram (o app da Meta e o cofre configurados) e isto é a nuvem. */
  disponivel(): boolean {
    return !ehServidorLocal() && !!this.appId() && !!this.segredo() && chaveSegredosDisponivel();
  }

  // ───────────────────────── a conta ─────────────────────────

  /** O grupo "Instagram Direct" dos ajustes: se dá para conectar e a conta conectada (nunca o acesso). */
  async ajuste(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select c.usuario, c.nome, c.fila_ligada as "filaLigada", c.conectado_em as "conectadoEm", c.token_vence_em as "venceEm",
             c.erro, c.erro_em as "erroEm", col.nome as "conectadoPor"
        from instagram_conta c left join colaborador col on col.id = c.conectado_por and col.tenant_id = c.tenant_id
       where c.tenant_id = ${tenantId}`);
    const c = (r.rows ?? r)[0] ?? null;
    return { disponivel: this.disponivel(), conta: c };
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

  /** O aviso da Meta (já com a assinatura conferida). Nunca lança: cada mensagem é tratada sozinha. */
  async processar(body: any): Promise<void> {
    for (const ev of lerAviso(body)) {
      try {
        await this.umaMensagem(ev);
      } catch (e: any) {
        this.logger.error(`aviso do Instagram (conta ${ev.conta}): ${e?.message ?? e}`);
      }
    }
  }

  private async umaMensagem(ev: EventoDoDirect) {
    const aviso: { evento: string; dados: any } | null = await this.db.transaction(async (tx: any) => {
      // A trava da conta: dois avisos do mesmo cliente ao mesmo tempo — um decide, o outro espera e já vê o caso.
      const [conta] = ((await tx.execute(sql`
        select id, tenant_id as "tenantId", fila_ligada as "filaLigada" from instagram_conta where ig_user_id = ${ev.conta} for update`)) as any).rows ?? [];
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
      if (!msg) return null; // aviso repetido, ou o eco da resposta que o Regem mandou
      if (ev.eco || !conta.filaLigada) return null;
      const [contato] = ((await tx.execute(sql`
        select nome, usuario from instagram_contato where tenant_id = ${conta.tenantId} and igsid = ${ev.igsid}`)) as any).rows ?? [];
      const [aberto] = ((await tx.execute(sql`
        select id, aguardando_desde as "aguardava" from atendimento_chamado
         where tenant_id = ${conta.tenantId} and tipo = 'instagram' and status = 'aberto' and detalhe #>> '{instagram,igsid}' = ${ev.igsid}
         order by criado_em desc limit 1`)) as any).rows ?? [];
      if (aberto) {
        await tx.execute(sql`
          update atendimento_chamado
             set mensagem = ${texto}, aguardando_desde = null,
                 detalhe = coalesce(detalhe, '{}'::jsonb)
                           || jsonb_build_object('instagram', coalesce(detalhe -> 'instagram', '{}'::jsonb) || jsonb_build_object('ultimaEm', ${ev.em.toISOString()}::text))
           where id = ${aberto.id}`);
        await tx.execute(sql`update instagram_mensagem set chamado_id = ${aberto.id} where id = ${msg.id}`);
        return { evento: 'atendimento.mudou', dados: { tenantId: conta.tenantId, id: aberto.id, motivo: 'instagram_mensagem' } };
      }
      const detalhe = { plataforma: 'instagram', instagram: { igsid: ev.igsid, usuario: contato?.usuario ?? null, nome: contato?.nome ?? null, ultimaEm: ev.em.toISOString() } };
      const [novo] = ((await tx.execute(sql`
        insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, mensagem, prioridade, detalhe)
        values (${conta.tenantId}, null, 'instagram', 'instagram', ${nomeDoCliente(contato)}, ${texto}, 'normal', ${JSON.stringify(detalhe)}::jsonb)
        returning *`)) as any).rows ?? [];
      await tx.execute(sql`update instagram_mensagem set chamado_id = ${novo.id} where id = ${msg.id}`);
      return { evento: 'atendimento.novo', dados: { tenantId: conta.tenantId, chamado: novo } };
    });
    if (aviso) this.events.emit(aviso.evento, aviso.dados);
    if (!ev.eco) void this.lerPerfil(ev.conta, ev.igsid);
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

  private async pelaNuvem(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<any> {
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
      if (res.status === 409) throw new ConflictException(msg);
      if (res.status === 404) throw new NotFoundException(msg);
      if (res.status === 403) throw new ForbiddenException(msg);
      if (res.status === 400) throw new BadRequestException(msg);
      throw new BadGatewayException(msg);
    }
    return j;
  }
}
