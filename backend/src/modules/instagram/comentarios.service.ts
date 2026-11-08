/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuthUser } from '../../auth/auth-user';
import { ehServidorLocal } from '../../common/modo';
import { decifrar } from '../../common/cifra-segredo';
import { exigirBooleano } from '../../common/exigir';
import { uuidDeChave } from '../../common/id-deterministico';
import { ehChaveDoComentario, idDaChaveDoComentario } from '../../common/conversa-do-robo';
import { entregarAoRobo } from '../whatsapp/entregar-ao-robo';
import { linkDoCardapioDaLoja, soLinksDaLoja } from '../whatsapp/links-do-robo';
import { juntarMensagem, posicaoNaFila } from '../atendimento/abrir-chamado';
import { type Recado, lerRecado, recadoAtivo, recadoDoCasoNovo, respostaDoRecado, situacaoDaEquipe } from '../atendimento/horario-da-equipe';
import { resumoDoRobo } from '../atendimento/resumo-do-robo';
import type { AuditoriaService } from '../auditoria/auditoria.service';
import { comOrigemDoDirect, nomeDoCliente, partirTexto, textoDaResposta } from './instagram';
import {
  DIAS_DA_LISTA,
  ESPERA_DO_ROBO_MIN,
  ITENS_POR_PAGINA,
  LIMITE_DO_ROBO_POR_HORA,
  NOME_DO_MOTIVO_DO_COMENTARIO,
  type FiltroDosComentarios,
  comentarioSemTexto,
  cursorDe,
  filtroDaLista,
  lerComentarios,
  lerCursor,
  mensagemDoComentarioParaORobo,
  podeComentarios,
  privadaPadrao,
  textoDaEquipe,
  travaDoComentario,
  traduzirErroDaMeta,
  vaiAoRobo,
  type EventoDoComentario,
} from './comentarios';
import * as meta from './instagram-graph';
import type { CardapioDoRobo, InstagramService } from './instagram.service';

// OS COMENTÁRIOS DOS POSTS DO INSTAGRAM (F6 do atendente virtual, mig 384 — protótipo `mockups/regem-central-atendimento.html`).
// Uma classe simples (não é provedor do Nest): o `InstagramService` cria e expõe em `instagram.comentarios` — o webhook, a
// resposta do robô (`publico/bot/responder` com `cm:`), o "chamar atendente" do cardápio e as rotas da tela usam a MESMA
// instância, sem mexer na injeção de dependências dos módulos que já recebem o `InstagramService`.
//
//  • A ENTRADA (o aviso `comments`, no mesmo `POST publico/instagram/webhook`): grava o comentário (o aviso repetido não faz
//    nada), ignora o da própria loja e a conta sem a permissão; lê o post uma vez; com "Robô responde nos comentários"
//    ligado, entrega ao robô DEPOIS de gravar — marcando `robo_entregue_em` antes (a entrega que falha apaga a marca).
//  • A RESPOSTA DO ROBÔ (`cm:`): publica no post, UMA por comentário (reserva antes de chamar a Meta), pela trava.
//  • O "CHAMAR ATENDENTE" (`cm:`): o caso `instagram_comentario` (com a fila dos comentários ligada) e a resposta PRIVADA.
//  • A TELA (gestão): a lista, a resposta da equipe, a privada e esconder/mostrar. No servidor da loja, pela nuvem (V37).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Quem cuida dos comentários na tela (responder em público, privada, esconder e a lista): a gestão — presidente e gerente. */
export const QUEM_CUIDA_DOS_COMENTARIOS = ['presidente', 'gerente'] as const;

const linhas = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
/** A reserva de uma resposta ainda vale (a Meta não confirmou e passou menos de 2 min)? Em SQL, sobre `x`. */
const RESERVA_VENCIDA = (col: string) => sql.raw(`${col} < now() - interval '2 minutes'`);

/** O comentário do Instagram como a tela recebe (a lista e o caso). */
export type ItemDoComentario = {
  id: string;
  comentarioId: string;
  paiId: string | null;
  autorUsuario: string | null;
  texto: string;
  comentadoEm: string;
  midia: { id: string; tipo: string | null; link: string | null; legenda: string | null };
  resposta: { texto: string; por: 'robo' | 'equipe'; em: string } | null;
  privada: { texto: string; em: string } | null;
  podePrivada: boolean;
  escondido: boolean;
  casoId: string | null;
  erro: string | null;
};

/** A conta da conversa da chave `cm:`: a empresa e a conta CONECTADA (a de agora) de um comentário dessa conversa. */
export type ConversaDoComentario = { tenantId: string; igUserId: string; conversa: string };

/**
 * A conversa da chave `cm:<comentário de cima>`: SÓ pela linha de um comentário dela (o de cima ou uma resposta) cuja conta
 * é a CONECTADA na empresa (viva) — a empresa vem dela (ig_user_id é único em `instagram_conta`: no máximo uma empresa).
 * Forma inválida, comentário desconhecido, conta desconectada ou banco sem a 384 → null (quem chama recusa).
 */
export async function comentarioDaChave(db: any, chave: unknown): Promise<ConversaDoComentario | null> {
  const conversa = idDaChaveDoComentario(chave);
  if (!conversa) return null;
  let r: any;
  try {
    r = await db.execute(sql`
      select x.tenant_id as "tenantId", x.ig_user_id as "igUserId"
        from instagram_comentario x
        join instagram_conta c on c.tenant_id = x.tenant_id and c.ig_user_id = x.ig_user_id
        join empresa e on e.id = x.tenant_id and e.deleted_at is null
       where x.comentario_id = ${conversa} or x.pai_id = ${conversa}
       limit 1`);
  } catch (e: any) {
    if (e?.code === '42P01' || e?.cause?.code === '42P01') return null;
    throw e;
  }
  const [l] = linhas(r);
  return l ? { tenantId: String(l.tenantId), igUserId: String(l.igUserId), conversa } : null;
}

/**
 * O comentário é da PRÓPRIA loja (a resposta que o robô ou a equipe publicou, ou o que a loja escreveu pelo app): o autor é a
 * conta (o id do aviso) ou tem o @ da conta conectada.
 */
export function daLoja(c: { autorId?: string | null; autorUsuario?: string | null }, conta: { igUserId: string; usuario?: string | null }): boolean {
  if (c.autorId && c.autorId === conta.igUserId) return true;
  const u = String(conta.usuario ?? '').trim().replace(/^@/, '').toLowerCase();
  return !!u && String(c.autorUsuario ?? '').trim().replace(/^@/, '').toLowerCase() === u;
}

/** SQL: a conversa `conversa` (o de cima e as respostas) da empresa, sobre `x`. */
const daConversa = (tenantId: string, conversa: string) => sql`x.tenant_id = ${tenantId} and (x.comentario_id = ${conversa} or x.pai_id = ${conversa})`;

/** As colunas do item (a lista e o caso), sobre `x`; `permitido` = a conta conectada com a permissão (a privada depende). */
const colunasDoItem = (permitido: boolean) => sql`
  x.id, x.comentario_id as "comentarioId", x.pai_id as "paiId", x.autor_usuario as "autorUsuario", x.texto,
  x.comentado_em as "comentadoEm", x.midia_id as "midiaId", x.midia_tipo as "midiaTipo", x.midia_link as "midiaLink",
  x.midia_legenda as "midiaLegenda", x.resposta_id as "respostaId", x.resposta_texto as "respostaTexto",
  x.resposta_por as "respostaPor", x.respondido_em as "respondidoEm", x.privada_texto as "privadaTexto",
  x.privada_em as "privadaEm", x.privada_igsid as "privadaIgsid", x.escondido, x.chamado_id as "casoId", x.erro,
  (${permitido}::boolean and x.privada_igsid is null and (x.privada_em is null or ${RESERVA_VENCIDA('x.privada_em')})
   and x.comentado_em > now() - interval '7 days') as "podePrivada"`;

const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : '');

function item(l: any): ItemDoComentario {
  return {
    id: String(l.id),
    comentarioId: String(l.comentarioId),
    paiId: l.paiId ?? null,
    autorUsuario: l.autorUsuario ?? null,
    texto: String(l.texto ?? ''),
    comentadoEm: iso(l.comentadoEm),
    midia: { id: String(l.midiaId), tipo: l.midiaTipo ?? null, link: l.midiaLink ?? null, legenda: l.midiaLegenda ?? null },
    resposta: l.respostaId ? { texto: String(l.respostaTexto ?? ''), por: l.respostaPor === 'robo' ? 'robo' : 'equipe', em: iso(l.respondidoEm) } : null,
    privada: l.privadaIgsid != null ? { texto: String(l.privadaTexto ?? ''), em: iso(l.privadaEm) } : null,
    podePrivada: l.podePrivada === true,
    escondido: l.escondido === true,
    casoId: l.casoId ?? null,
    erro: l.erro ?? null,
  };
}

/** SQL do filtro da lista, sobre `x` ("sem resposta" = sem resposta pública, sem privada e não escondido). */
function sqlDoFiltro(f: FiltroDosComentarios) {
  if (f === 'sem-resposta') return sql`(x.resposta_id is null and x.privada_igsid is null and not x.escondido)`;
  if (f === 'respondidos') return sql`((x.resposta_id is not null or x.privada_igsid is not null) and not x.escondido)`;
  if (f === 'escondidos') return sql`x.escondido`;
  return sql`true`;
}

export class ComentariosDoInstagram {
  private readonly logger = new Logger('InstagramComentarios');
  private readonly entregas = new Set<Promise<void>>();

  constructor(
    private readonly db: any,
    private readonly events: { emit: (evento: string, dados: any) => unknown },
    private readonly dono: InstagramService,
    private readonly auditoria?: AuditoriaService,
  ) {}

  private avisar(tenantId: string, id: string, motivo: string) {
    this.events.emit('instagram.comentario', { tenantId, id, motivo });
  }

  /**
   * A conta conectada (pelo id do Instagram ou pela empresa), da empresa viva, com as colunas da 384 lidas por `to_jsonb`
   * (num banco sem a 384: robô desligado, fila ligada — quem não aplicou não quebra).
   */
  private async conta(tx: any, por: { igUserId?: string; tenantId?: string }, travar: boolean) {
    const onde = por.igUserId ? sql`c.ig_user_id = ${por.igUserId}` : sql`c.tenant_id = ${por.tenantId}`;
    const [c] = linhas(
      await tx.execute(sql`
        select c.tenant_id as "tenantId", c.ig_user_id as "igUserId", c.token_cifrado as token, c.permissoes,
               c.cardapio_id as "cardapioId", c.usuario,
               coalesce((to_jsonb(c) ->> 'comentarios_robo')::boolean, false) as robo,
               coalesce((to_jsonb(c) ->> 'comentarios_fila')::boolean, true) as fila
          from instagram_conta c join empresa e on e.id = c.tenant_id and e.deleted_at is null
         where ${onde} ${travar ? sql`for update of c` : sql``}`),
    );
    return (c ?? null) as null | {
      tenantId: string;
      igUserId: string;
      token: string;
      permissoes: string | null;
      cardapioId: string | null;
      usuario: string | null;
      robo: boolean;
      fila: boolean;
    };
  }

  /** O robô dos comentários pode responder por esta conta agora: ligado, a permissão, a distribuição pronta e o cardápio ativo. */
  private async roboDaConta(tx: any, c: { tenantId: string; robo: boolean; permissoes: string | null; cardapioId: string | null }): Promise<CardapioDoRobo | null> {
    if (!c.robo || !podeComentarios(c.permissoes) || !this.dono.roboDisponivel()) return null;
    const cardapio = await this.dono.cardapioDoRobo(tx, c.tenantId, c.cardapioId);
    return cardapio?.ativo ? cardapio : null;
  }

  // ───────────────────────── a entrada (o aviso `comments`) ─────────────────────────

  /** Os comentários do aviso (já com a assinatura conferida). Nunca lança: um que falha não derruba os outros (V11). */
  async processar(body: any): Promise<void> {
    for (const ev of lerComentarios(body)) {
      try {
        await this.umComentario(ev);
      } catch (e: any) {
        this.logger.error(`comentário do Instagram (conta ${ev.conta}, comentário ${ev.comentarioId}): ${e?.message ?? e}`);
      }
    }
  }

  private async umComentario(ev: EventoDoComentario) {
    const r = await this.db.transaction(async (tx: any) => {
      // A trava da conta: dois avisos ao mesmo tempo contam o limite do robô um depois do outro.
      const conta = await this.conta(tx, { igUserId: ev.conta }, true);
      if (!conta) return null; // conta que não está (mais) conectada, ou empresa apagada (V75)
      if (!podeComentarios(conta.permissoes)) return null; // conectada antes da F6: só depois de reconectar
      if (daLoja(ev, conta)) return null; // a própria loja (o robô, a equipe ou o app do Instagram)
      // O post já lido em outro comentário (o link e a legenda): não pede de novo à Meta.
      const [midia] = linhas(
        await tx.execute(sql`
          select midia_link as link, midia_legenda as legenda, midia_tipo as tipo from instagram_comentario
           where tenant_id = ${conta.tenantId} and midia_id = ${ev.midiaId} and midia_link is not null limit 1`),
      );
      const cardapio = await this.roboDaConta(tx, conta);
      const [n] = cardapio
        ? linhas(
            await tx.execute(sql`
              select count(*)::int as n from instagram_comentario
               where tenant_id = ${conta.tenantId} and comentado_em > now() - interval '1 day' -- o índice da lista (o robô só pega o recente)
                 and (robo_entregue_em > now() - interval '1 hour' or (resposta_por = 'robo' and respondido_em > now() - interval '1 hour'))`),
          )
        : [{ n: 0 }];
      const vai = vaiAoRobo({ roboLigado: !!cardapio, semTexto: comentarioSemTexto(ev.texto), jaRespondido: false, entreguesNaHora: Number(n?.n ?? 0) });
      if (cardapio && !vai && Number(n?.n ?? 0) >= LIMITE_DO_ROBO_POR_HORA)
        this.logger.warn(`comentários do Instagram: limite de ${LIMITE_DO_ROBO_POR_HORA} respostas do robô por hora (empresa ${conta.tenantId}) — fica sem resposta`);
      const id = uuidDeChave('instagram-comentario', conta.tenantId, ev.comentarioId);
      const [novo] = linhas(
        await tx.execute(sql`
          insert into instagram_comentario (id, tenant_id, ig_user_id, comentario_id, pai_id, midia_id, midia_tipo, midia_link, midia_legenda,
                                            autor_id, autor_usuario, texto, comentado_em, robo_entregue_em)
          values (${id}, ${conta.tenantId}, ${ev.conta}, ${ev.comentarioId}, ${ev.paiId}, ${ev.midiaId}, ${ev.midiaTipo ?? midia?.tipo ?? null},
                  ${midia?.link ?? null}, ${midia?.legenda ?? null}, ${ev.autorId}, ${ev.autorUsuario}, ${ev.texto}, ${ev.em.toISOString()},
                  ${vai ? sql`clock_timestamp()` : null})
          on conflict (tenant_id, comentario_id) do nothing
          returning id`),
      );
      // Aviso repetido (a Meta reentrega): nada mais — nem o post, nem o robô (o efeito só quando a gravação diz "novo").
      if (!novo) return null;
      return { id, tenantId: conta.tenantId, token: conta.token, midia: midia ?? null, cardapio: vai ? cardapio : null };
    });
    if (!r) return;
    this.avisar(r.tenantId, r.id, 'novo');
    // O post (o link e a legenda) uma vez, fora da trava da conta: falha fica nula e não derruba nada.
    let legenda: string | null = r.midia?.legenda ?? null;
    let tipo: string | null = ev.midiaTipo ?? r.midia?.tipo ?? null;
    if (!r.midia) {
      try {
        const d = await meta.dadosDaMidia(ev.midiaId, decifrar(r.token));
        legenda = d.legenda;
        tipo = tipo ?? d.tipo;
        await this.db.execute(sql`
          update instagram_comentario set midia_link = ${d.link}, midia_legenda = ${d.legenda}, midia_tipo = coalesce(midia_tipo, ${d.tipo}),
                 atualizado_em = clock_timestamp()
           where tenant_id = ${r.tenantId} and midia_id = ${ev.midiaId} and midia_link is null`);
      } catch (e: any) {
        this.logger.warn(`o post do comentário do Instagram não foi lido (empresa ${r.tenantId}): ${e?.message ?? e}`);
      }
    }
    if (r.cardapio)
      this.entregar(
        r.id,
        mensagemDoComentarioParaORobo({
          tenantId: r.tenantId,
          comentarioId: ev.comentarioId,
          paiId: ev.paiId,
          autorUsuario: ev.autorUsuario,
          texto: ev.texto,
          em: ev.em,
          midiaTipo: tipo,
          legenda,
          cardapio: r.cardapio,
        }),
      );
  }

  /** Entrega ao robô em segundo plano; a que ele não recebeu perde a marca (fica "sem resposta"). Nunca rejeita (V3). */
  private entregar(id: string, mensagem: any): void {
    const tarefa = (async () => {
      if (await entregarAoRobo(mensagem)) return;
      this.logger.warn(`comentário do Instagram: o robô não recebeu (empresa ${mensagem.tenantId}) — fica sem resposta`);
      await this.db.execute(sql`update instagram_comentario set robo_entregue_em = null, atualizado_em = clock_timestamp() where id = ${id} and robo_entregue_em is not null`);
    })().catch((e: any) => this.logger.warn(`comentário do Instagram ao robô: ${e?.message ?? e}`));
    this.entregas.add(tarefa);
    void tarefa.finally(() => this.entregas.delete(tarefa));
  }

  /** Só para teste: espera as entregas ao robô em andamento (e o que elas fizerem ao falhar). */
  async esperarEntregas(): Promise<void> {
    while (this.entregas.size) await Promise.all([...this.entregas]);
  }

  // ───────────────────────── o robô (as consultas, a resposta e o "chamar atendente") ─────────────────────────

  /**
   * O cardápio que as consultas do robô usam na conversa do comentário (loja, cardápio, taxa e instruções — chave `cm:`): só
   * com a conta conectada, o robô dos comentários ligado, a distribuição pronta e o cardápio ativo; senão null (404).
   */
  async cardapioDaChave(chave: unknown): Promise<CardapioDoRobo | null> {
    const c = await comentarioDaChave(this.db, chave);
    if (!c) return null;
    const conta = await this.conta(this.db, { tenantId: c.tenantId }, false);
    return conta ? this.roboDaConta(this.db, conta) : null;
  }

  /**
   * A resposta do robô no comentário (`publico/bot/responder` com `cm:` na instância ou no `para` — as que são `cm:` têm de
   * ser a MESMA conversa). Publica no post, respondendo o comentário da conversa que foi entregue a ele (o mais novo nos
   * últimos 30 min), UMA resposta por comentário (reservada antes de chamar a Meta; a da equipe também conta). A trava:
   * numa linha, até 300 letras; link, telefone, WhatsApp, e-mail ou `@` → não publica (o motivo fica em `erro`; o
   * comentário fica sem resposta). Opções não existem no comentário (o texto vai sem elas); voz não sai.
   */
  async responderDoRobo(chaves: unknown[], bruto: string, temAudio: boolean): Promise<{ ok: true; enviado: boolean; motivo?: string; enviados?: string[] }> {
    const ids = chaves.filter(ehChaveDoComentario).map(idDaChaveDoComentario);
    if (!ids.length || ids.some((id) => !id) || new Set(ids).size !== 1) throw new BadRequestException('Conversa do comentário inválida.');
    const c = await comentarioDaChave(this.db, `cm:${ids[0]}`);
    if (!c) throw new NotFoundException('Comentário do Instagram não encontrado.');
    if (!bruto.trim()) return { ok: true, enviado: false, motivo: temAudio ? 'sem_voz_no_comentario' : 'sem_texto' };
    const trava = travaDoComentario(bruto);
    const d = await this.db.transaction(async (tx: any) => {
      const conta = await this.conta(tx, { tenantId: c.tenantId }, true);
      // Reconferido na hora (V87): desligado, sem a permissão ou sem o cardápio depois da entrega = nada sai.
      if (!conta || conta.igUserId !== c.igUserId || !(await this.roboDaConta(tx, conta))) return { pode: false as const, motivo: 'robo_desligado' };
      const [alvo] = linhas(
        await tx.execute(sql`
          select x.id, x.comentario_id as "comentarioId", x.escondido from instagram_comentario x
           where ${daConversa(c.tenantId, c.conversa)}
             and x.robo_entregue_em > now() - make_interval(mins => ${ESPERA_DO_ROBO_MIN}::int)
           order by x.comentado_em desc, x.id desc limit 1
           for update`),
      );
      if (!alvo) return { pode: false as const, motivo: 'nada_a_responder' };
      if (!trava.ok) {
        await tx.execute(sql`update instagram_comentario set erro = ${NOME_DO_MOTIVO_DO_COMENTARIO[trava.motivo]}, atualizado_em = clock_timestamp() where id = ${alvo.id}`);
        // "SEM RESPOSTA" = o robô decidiu não responder (ofensivo, spam): nada sai, e a equipe vê o porquê na lista.
        return { pode: false as const, motivo: trava.motivo === 'silencio' ? 'robo_nao_respondeu' : `barrada_${trava.motivo}`, tenantId: c.tenantId };
      }
      if (alvo.escondido) return { pode: false as const, motivo: 'comentario_escondido' };
      const [reservou] = linhas(
        await tx.execute(sql`
          update instagram_comentario
             set resposta_por = 'robo', resposta_texto = ${trava.texto}, respondido_em = clock_timestamp(), respondido_por = null,
                 erro = null, atualizado_em = clock_timestamp()
           where id = ${alvo.id} and resposta_id is null and (resposta_por is null or ${RESERVA_VENCIDA('respondido_em')})
           returning id`),
      );
      if (!reservou) return { pode: false as const, motivo: 'ja_respondido' };
      return { pode: true as const, alvo: { id: String(alvo.id), comentarioId: String(alvo.comentarioId) }, token: conta.token, texto: trava.texto };
    });
    if (!d.pode) {
      if (d.motivo.startsWith('barrada_')) this.logger.warn(`resposta do robô no comentário barrada pela trava (${d.motivo}) empresa=${c.tenantId}`);
      else this.logger.log(`resposta do robô no comentário segurada (${d.motivo}) empresa=${c.tenantId}`);
      return { ok: true, enviado: false, motivo: d.motivo };
    }
    if (trava.ok && trava.cortado) this.logger.warn(`resposta do robô no comentário passou de 300 letras — o resto ficou de fora (empresa ${c.tenantId})`);
    let respostaId: string;
    try {
      respostaId = (await meta.responderComentario(d.alvo.comentarioId, decifrar(d.token), d.texto)).id;
    } catch (e: any) {
      const t = traduzirErroDaMeta(e);
      await this.desfazerResposta(d.alvo.id, t.message);
      this.logger.warn(`resposta do robô no comentário (empresa ${c.tenantId}): ${e?.message ?? e}`);
      throw new BadGatewayException({ statusCode: 502, code: t.code, message: t.message });
    }
    await this.db.execute(sql`
      update instagram_comentario set resposta_id = ${respostaId}, robo_entregue_em = null, atualizado_em = clock_timestamp() where id = ${d.alvo.id}`);
    this.avisar(c.tenantId, d.alvo.id, 'robo_respondeu');
    return { ok: true, enviado: true, enviados: ['texto'] };
  }

  /** A Meta recusou a resposta pública: a reserva sai (fica sem resposta) e o motivo fica em `erro`. */
  private async desfazerResposta(id: string, erro: string) {
    await this.db.execute(sql`
      update instagram_comentario set resposta_por = null, resposta_texto = null, respondido_em = null, respondido_por = null,
             erro = ${erro}, atualizado_em = clock_timestamp()
       where id = ${id} and resposta_id is null`);
  }

  /**
   * "CHAMAR ATENDENTE" no comentário (a ferramenta do robô, pela rota do cardápio com `telefone: cm:<conversa>`, depois da
   * senha do robô): só a conversa de comentário da empresa do token do cardápio (outra empresa = 401). Na trava da conta:
   * com "o comentário vira caso na fila" ligado, abre (ou soma) o caso `instagram_comentario` da conversa — id pela chave do
   * comentário (V42), urgente se o robô disser (somar só SOBE), o recado da abertura fora do horário (F1) —, e reserva a
   * resposta PRIVADA do comentário que o robô atendia (uma só, até 7 dias). Depois de gravar, manda a privada (o
   * `paraOCliente` do robô pelas regras do Direct — só os links da loja, até 1.000 bytes; fora do horário, o recado) e a
   * grava em `instagram_mensagem` para a conversa do Direct seguir quando a pessoa responder. Devolve a forma do chamado
   * do robô e `privada: { enviada, motivo? }`.
   */
  async chamarPeloRobo(tenantIdDoCardapio: string, dto: any) {
    const c = await comentarioDaChave(this.db, dto?.telefone);
    if (!c || c.tenantId !== tenantIdDoCardapio) throw new UnauthorizedException('Conversa do comentário inválida.');
    const { tenantId, conversa } = c;
    const urgente = dto?.prioridade === 'urgente' || dto?.urgente === true || dto?.urgente === 'true';
    const resumo = resumoDoRobo(dto, urgente);
    const mensagem = typeof dto?.mensagem === 'string' && dto.mensagem.trim() ? dto.mensagem.trim().slice(0, 1000) : null;
    const pedidoDoRobo = typeof dto?.paraOCliente === 'string' && dto.paraOCliente.trim() ? dto.paraOCliente.trim() : null;
    type Chamou = {
      caso: any | null;
      novo: boolean;
      subiu: boolean;
      recado: Recado | null;
      privada: { id: string; comentarioId: string; texto: string } | { motivo: string };
      conta: { igUserId: string; token: string; cardapioId: string | null };
      alvoId: string;
    };
    // Lidos fora da transação (nunca a derrubam): a conta (para o cardápio do horário) e a situação da equipe.
    const conta0 = await this.conta(this.db, { tenantId }, false);
    if (!conta0 || conta0.igUserId !== c.igUserId) throw new NotFoundException('Instagram não conectado.');
    const cardapio = await this.dono.cardapioDoRobo(this.db, tenantId, conta0.cardapioId);
    const fora = await recadoDoCasoNovo(this.db, tenantId, { cardapioId: cardapio?.id ?? conta0.cardapioId ?? null });
    const r: Chamou = await this.db.transaction(async (tx: any): Promise<Chamou> => {
      const conta = await this.conta(tx, { tenantId }, true);
      if (!conta || conta.igUserId !== c.igUserId) throw new NotFoundException('Instagram não conectado.');
      // O comentário que o robô atendia: o entregue a ele mais novo da conversa; senão, o mais novo.
      const [alvo] = linhas(
        await tx.execute(sql`
          select x.id, x.comentario_id as "comentarioId", x.midia_id as "midiaId", x.midia_link as "midiaLink",
                 x.autor_usuario as "autorUsuario", x.texto
            from instagram_comentario x
           where ${daConversa(tenantId, conversa)}
           order by (x.robo_entregue_em > now() - make_interval(mins => ${ESPERA_DO_ROBO_MIN}::int)) desc nulls last, x.comentado_em desc, x.id desc
           limit 1 for update`),
      );
      if (!alvo) throw new UnauthorizedException('Conversa do comentário inválida.');
      let caso: any = null;
      let novo = false;
      let subiu = false;
      if (conta.fila) {
        const robo = resumo ? { ...resumo, em: new Date().toISOString() } : null;
        const [aberto] = linhas(
          await tx.execute(sql`
            select id, prioridade, mensagem from atendimento_chamado
             where tenant_id = ${tenantId} and tipo = 'instagram_comentario' and status = 'aberto' and detalhe #>> '{comentario,conversa}' = ${conversa}
             order by criado_em desc limit 1`),
        );
        if (aberto) {
          // Somar: o resumo novo vai junto, a mensagem junta e a prioridade só SOBE (mesclado no banco — V82).
          [caso] = linhas(
            await tx.execute(sql`
              update atendimento_chamado
                 set prioridade = case when ${urgente}::boolean then 'urgente' else prioridade end,
                     mensagem = ${juntarMensagem(aberto.mensagem, mensagem)}, aguardando_desde = null,
                     detalhe = coalesce(detalhe, '{}'::jsonb) || ${JSON.stringify(robo ? { robo } : {})}::jsonb
               where id = ${aberto.id}
              returning *`),
          );
          subiu = aberto.prioridade !== 'urgente' && caso?.prioridade === 'urgente';
        } else {
          const detalhe = {
            plataforma: 'instagram',
            comentario: {
              id: String(alvo.id),
              comentarioId: String(alvo.comentarioId),
              midiaId: String(alvo.midiaId),
              midiaLink: alvo.midiaLink ?? null,
              autorUsuario: alvo.autorUsuario ?? null,
              texto: String(alvo.texto ?? '').slice(0, 1000),
              conversa,
            },
            ...(robo ? { robo } : {}),
            ...(fora ? { recado: fora.recado } : {}),
          };
          const valores = (id: string) => sql`
            insert into atendimento_chamado (id, tenant_id, unidade_id, tipo, canal, cliente, mensagem, prioridade, detalhe)
            values (${id}, ${tenantId}, null, 'instagram_comentario', 'instagram', ${nomeDoCliente({ usuario: alvo.autorUsuario })},
                    ${mensagem ?? `Comentário no Instagram: ${String(alvo.texto ?? '').slice(0, 300)}`}, ${urgente ? 'urgente' : 'normal'},
                    ${JSON.stringify(detalhe)}::jsonb)
            on conflict (id) do nothing
            returning *`;
          // O id pela chave do comentário (V42): duas chamadas = um caso. O caso desse comentário já resolvido (o robô chamou
          // de novo depois) ganha um id novo, também pela chave (com a hora em que o outro foi resolvido).
          [caso] = linhas(await tx.execute(valores(uuidDeChave('instagram-comentario-caso', tenantId, String(alvo.comentarioId)))));
          if (!caso) {
            const [velho] = linhas(
              await tx.execute(sql`
                select resolvido_em as "resolvidoEm" from atendimento_chamado
                 where id = ${uuidDeChave('instagram-comentario-caso', tenantId, String(alvo.comentarioId))}`),
            );
            [caso] = linhas(
              await tx.execute(valores(uuidDeChave('instagram-comentario-caso', tenantId, String(alvo.comentarioId), iso(velho?.resolvidoEm) || 'de-novo'))),
            );
          }
          novo = !!caso;
        }
        if (caso) await tx.execute(sql`update instagram_comentario set chamado_id = ${caso.id}, atualizado_em = clock_timestamp() where id = ${alvo.id}`);
      }
      // A resposta PRIVADA: reservada aqui (uma só por comentário, até 7 dias), enviada depois de gravar.
      const recado = caso && recadoAtivo(caso.detalhe) ? lerRecado(caso.detalhe) : null;
      const [p] = linhas(
        await tx.execute(sql`
          select (privada_igsid is not null or (privada_em is not null and not ${RESERVA_VENCIDA('privada_em')})) as feita,
                 comentado_em <= now() - interval '7 days' as vencida
            from instagram_comentario where id = ${alvo.id}`),
      );
      let privada: Chamou['privada'];
      if (p?.feita) privada = { motivo: 'ja_respondido_no_direct' };
      else if (p?.vencida) privada = { motivo: 'prazo_vencido' };
      else {
        const textoFora = recado ? (fora?.situacao.textoFora ?? (await situacaoDaEquipe(this.db, tenantId, { cardapioId: conta.cardapioId })).textoFora) : null;
        const bruto = recado ? respostaDoRecado(recado, textoFora).paraOCliente : (pedidoDoRobo ?? privadaPadrao(alvo.autorUsuario));
        const texto = this.textoDaPrivadaDoRobo(bruto, cardapio);
        if (!texto) privada = { motivo: 'sem_texto' };
        else {
          const [reservou] = linhas(
            await tx.execute(sql`
              update instagram_comentario set privada_em = clock_timestamp(), privada_texto = ${texto}, privada_por = null, atualizado_em = clock_timestamp()
               where id = ${alvo.id} and privada_igsid is null and (privada_em is null or ${RESERVA_VENCIDA('privada_em')})
                 and comentado_em > now() - interval '7 days'
              returning id`),
          );
          privada = reservou ? { id: String(alvo.id), comentarioId: String(alvo.comentarioId), texto } : { motivo: 'ja_respondido_no_direct' };
        }
      }
      return { caso, novo, subiu, recado, privada, conta: { igUserId: conta.igUserId, token: conta.token, cardapioId: conta.cardapioId }, alvoId: String(alvo.id) };
    });
    if (r.caso) {
      if (r.novo || r.subiu) this.events.emit('atendimento.novo', { tenantId, chamado: r.caso });
      else this.events.emit('atendimento.mudou', { tenantId, id: r.caso.id, motivo: 'robo_somou' });
    }
    const enviada = 'id' in r.privada ? await this.mandarPrivada(tenantId, r.conta, r.privada, null) : { enviada: false, motivo: r.privada.motivo };
    this.avisar(tenantId, r.alvoId, 'robo_chamou');
    const privada = enviada.enviada ? { enviada: true } : { enviada: false, motivo: enviada.motivo };
    if (!r.caso) return { ok: true, id: null, prioridade: null, posicao: null, comAlguem: false, privada };
    if (r.recado) {
      const textoFora = fora?.situacao.textoFora ?? (await situacaoDaEquipe(this.db, tenantId, { cardapioId: r.conta.cardapioId })).textoFora;
      return { ok: true, id: r.caso.id, prioridade: r.caso.prioridade, comAlguem: false, ...respostaDoRecado(r.recado, textoFora), privada };
    }
    const pos = await posicaoNaFila(this.db, tenantId, r.caso.id);
    const [cfg] = linhas(await this.db.execute(sql`select dizer_posicao as "dizer" from robo_config where tenant_id = ${tenantId}`));
    return { ok: true, id: r.caso.id, prioridade: r.caso.prioridade, posicao: cfg?.dizer === false ? null : pos.posicao, comAlguem: pos.comAlguem, privada };
  }

  /** O texto da privada do robô pelas regras do Direct: só os links da loja (com a origem do Direct), uma mensagem de até 1.000 bytes. */
  private textoDaPrivadaDoRobo(bruto: string, cardapio: CardapioDoRobo | null): string {
    let texto = String(bruto ?? '').trim();
    if (cardapio?.token) {
      const link = linkDoCardapioDaLoja(cardapio.token);
      texto = comOrigemDoDirect(soLinksDaLoja(texto, link, [cardapio.site, cardapio.instagram ? 'instagram.com' : null]).texto, link);
    }
    return partirTexto(texto, undefined, 1)[0] ?? '';
  }

  /**
   * Manda a privada já reservada. Sucesso: o cliente no Direct (`privada_igsid`) e a linha em `instagram_mensagem` (saída, o
   * id da Meta — o eco que vier depois não entra de novo; sem caso: o caso do Direct, quando nascer, pega a mensagem).
   * Falha: a reserva sai e o motivo fica em `erro`.
   */
  private async mandarPrivada(
    tenantId: string,
    conta: { igUserId: string; token: string },
    p: { id: string; comentarioId: string; texto: string },
    quem: { id: string; perfil: string } | null,
  ): Promise<{ enviada: true; igsid: string | null } | { enviada: false; motivo: string; erro: { code: string; message: string } }> {
    let r: { igsid: string | null; mid: string | null };
    try {
      r = await meta.respostaPrivada(conta.igUserId, decifrar(conta.token), p.comentarioId, p.texto);
    } catch (e: any) {
      const t = traduzirErroDaMeta(e);
      await this.db.execute(sql`
        update instagram_comentario set privada_em = null, privada_texto = null, privada_por = null, erro = ${t.message}, atualizado_em = clock_timestamp()
         where id = ${p.id} and privada_igsid is null`);
      this.logger.warn(`resposta privada do comentário (empresa ${tenantId}): ${e?.message ?? e}`);
      return { enviada: false, motivo: 'meta_recusou', erro: t };
    }
    await this.db.execute(sql`
      update instagram_comentario set privada_igsid = ${r.igsid ?? ''}, erro = null, atualizado_em = clock_timestamp() where id = ${p.id}`);
    if (r.igsid) {
      const autor = quem ? 'equipe' : 'robo';
      await this.db.execute(sql`
        insert into instagram_mensagem (tenant_id, ig_user_id, igsid, direcao, autor, tipo, texto, mid, autor_id, estado)
        values (${tenantId}, ${conta.igUserId}, ${r.igsid}, 'saida', ${autor}, 'texto', ${p.texto}, ${r.mid}, ${quem?.id ?? null}, 'enviada')
        on conflict (tenant_id, mid) where mid is not null do update set autor = excluded.autor, autor_id = excluded.autor_id`);
    }
    return { enviada: true, igsid: r.igsid };
  }

  // ───────────────────────── a tela (a gestão) ─────────────────────────

  /** O grupo "Comentários" dos ajustes: a conta conectada com a permissão, o robô e a fila. Num banco sem a 384, desligado. */
  comentariosDoAjuste(conta: { permissoes?: string | null; comentariosRobo?: unknown; comentariosFila?: unknown } | null) {
    return {
      permitido: !!conta && podeComentarios(conta.permissoes ?? null),
      roboResponde: conta?.comentariosRobo === true,
      naFila: conta ? conta.comentariosFila !== false : true,
    };
  }

  /**
   * Confere o grupo `comentarios` do salvar (antes de gravar qualquer grupo — V86): liga/desliga com `exigirBooleano` (V15),
   * o que não veio fica (V16); o robô só liga com a conta conectada com a permissão e o robô disponível.
   */
  async conferirAjuste(tenantId: string, dto: unknown): Promise<{ roboResponde?: boolean; naFila?: boolean }> {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) throw new BadRequestException('Comentários do Instagram: ajuste inválido.');
    const d = dto as any;
    const saida: { roboResponde?: boolean; naFila?: boolean } = {};
    if (d.roboResponde !== undefined) saida.roboResponde = exigirBooleano(d.roboResponde, 'instagram.comentarios.roboResponde');
    if (d.naFila !== undefined) saida.naFila = exigirBooleano(d.naFila, 'instagram.comentarios.naFila');
    if (saida.roboResponde === true) {
      const conta = await this.conta(this.db, { tenantId }, false);
      if (!conta) throw new BadRequestException('Conecte o Instagram da loja antes de ligar o robô nos comentários.');
      if (!podeComentarios(conta.permissoes))
        throw new BadRequestException('A conta do Instagram foi conectada antes dos comentários: reconecte o Instagram para dar a permissão dos comentários.');
      if (!this.dono.roboDisponivel()) throw new BadRequestException('O robô ainda não está disponível: a Regem liga o fluxo do robô antes.');
    }
    return saida;
  }

  /** Grava o que `conferirAjuste` devolveu, só o que veio e mudou, cada mudança na auditoria. */
  async salvarAjuste(user: AuthUser, a: { roboResponde?: boolean; naFila?: boolean }) {
    const campos = [
      { v: a.roboResponde, col: 'comentarios_robo', liga: 'robo_nos_comentarios_ligado', desliga: 'robo_nos_comentarios_desligado' },
      { v: a.naFila, col: 'comentarios_fila', liga: 'comentarios_na_fila_ligado', desliga: 'comentarios_na_fila_desligado' },
    ];
    for (const f of campos) {
      if (f.v === undefined) continue;
      const col = sql.raw(f.col);
      const r = linhas(
        await this.db.execute(sql`
          update instagram_conta set ${col} = ${f.v}, atualizado_em = clock_timestamp()
           where tenant_id = ${user.tenantId} and ${col} is distinct from ${f.v} returning id`),
      );
      if (r[0])
        await this.auditoria?.registrar({
          tenantId: user.tenantId,
          atorId: user.colaboradorId,
          atorPerfil: user.categoria,
          tipo: 'config',
          acao: f.v ? f.liga : f.desliga,
          entidadeTipo: 'instagram_conta',
          entidadeId: user.tenantId,
          detalhe: {},
        });
    }
  }

  private exigirGestao(user: AuthUser) {
    if (!(QUEM_CUIDA_DOS_COMENTARIOS as readonly string[]).includes(user.categoria)) throw new ForbiddenException('Quem cuida dos comentários do Instagram é a gestão.');
  }

  private async permitido(tenantId: string): Promise<boolean> {
    const conta = await this.conta(this.db, { tenantId }, false);
    return !!conta && podeComentarios(conta.permissoes);
  }

  /** A lista da tela (gestão). No servidor da loja, pela nuvem (V37). */
  async listarPara(user: AuthUser, q: { filtro?: unknown; antes?: unknown }) {
    this.exigirGestao(user);
    if (ehServidorLocal()) {
      const p = new URLSearchParams();
      if (typeof q?.filtro === 'string') p.set('filtro', q.filtro);
      if (typeof q?.antes === 'string') p.set('antes', q.antes);
      return this.dono.pelaNuvem('GET', `instagram-comentarios-da-loja?${p.toString()}`);
    }
    return this.listar(user.tenantId, q);
  }

  /**
   * Os comentários dos últimos 30 dias, do mais novo ao mais velho, 50 por página (cursor `antes` = data + id do último), com
   * o filtro e a contagem dos quatro no `where` (V39). "Sem resposta" = sem resposta pública, sem privada e não escondido.
   */
  async listar(tenantId: string, q: { filtro?: unknown; antes?: unknown }) {
    const filtro = filtroDaLista(q?.filtro);
    const cursor = lerCursor(q?.antes);
    const permitido = await this.permitido(tenantId);
    const janela = sql`x.tenant_id = ${tenantId} and x.comentado_em > now() - make_interval(days => ${DIAS_DA_LISTA}::int)`;
    let rows: any[];
    let contagem: any;
    try {
      [rows, [contagem]] = await Promise.all([
        this.db
          .execute(sql`
            select ${colunasDoItem(permitido)} from instagram_comentario x
             where ${janela} and ${sqlDoFiltro(filtro)}
               ${cursor ? sql`and (x.comentado_em, x.id) < (${cursor.em}::timestamptz, ${cursor.id}::uuid)` : sql``}
             order by x.comentado_em desc, x.id desc
             limit ${ITENS_POR_PAGINA + 1}`)
          .then(linhas),
        this.db
          .execute(sql`
            select count(*) filter (where ${sqlDoFiltro('sem-resposta')})::int as "semResposta",
                   count(*) filter (where ${sqlDoFiltro('respondidos')})::int as respondidos,
                   count(*) filter (where ${sqlDoFiltro('escondidos')})::int as escondidos,
                   count(*)::int as todos
              from instagram_comentario x where ${janela}`)
          .then(linhas),
      ]);
    } catch (e: any) {
      // Banco sem a 384: nada de comentários ainda (a tela mostra o vazio).
      if (e?.code === '42P01' || e?.cause?.code === '42P01') return { itens: [], contagem: { semResposta: 0, respondidos: 0, escondidos: 0, todos: 0 }, proximo: null, permitido };
      throw e;
    }
    const pagina = rows.slice(0, ITENS_POR_PAGINA).map(item);
    return {
      itens: pagina,
      contagem: {
        semResposta: Number(contagem?.semResposta ?? 0),
        respondidos: Number(contagem?.respondidos ?? 0),
        escondidos: Number(contagem?.escondidos ?? 0),
        todos: Number(contagem?.todos ?? 0),
      },
      proximo: rows.length > ITENS_POR_PAGINA && pagina.length ? cursorDe(pagina[pagina.length - 1]) : null,
      permitido,
    };
  }

  /** O comentário do caso (`instagram_comentario`), na forma do item da lista. No servidor da loja, pela nuvem. */
  async doCasoPara(user: AuthUser, casoId: string) {
    this.exigirGestao(user);
    if (ehServidorLocal()) return this.dono.pelaNuvem('GET', `instagram-comentario-da-loja?chamado=${encodeURIComponent(String(casoId ?? ''))}`);
    return this.doCaso(user.tenantId, casoId);
  }

  async doCaso(tenantId: string, casoId: string): Promise<ItemDoComentario> {
    if (!UUID_RE.test(String(casoId ?? ''))) throw new NotFoundException('Caso não encontrado.');
    const permitido = await this.permitido(tenantId);
    const [l] = linhas(
      await this.db.execute(sql`
        select ${colunasDoItem(permitido)} from instagram_comentario x
         where x.tenant_id = ${tenantId}
           and x.id::text = (select a.detalhe #>> '{comentario,id}' from atendimento_chamado a
                              where a.id = ${casoId} and a.tenant_id = ${tenantId} and a.tipo = 'instagram_comentario')`),
    );
    if (!l) throw new NotFoundException('Comentário do caso não encontrado.');
    return item(l);
  }

  private async umDaEmpresa(tenantId: string, id: string) {
    if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException('Comentário não encontrado.');
    const [l] = linhas(await this.db.execute(sql`select x.*, x.comentado_em <= now() - interval '7 days' as vencido from instagram_comentario x where x.tenant_id = ${tenantId} and x.id = ${id}`));
    if (!l) throw new NotFoundException('Comentário não encontrado.');
    const conta = await this.conta(this.db, { tenantId }, false);
    if (!conta || !podeComentarios(conta.permissoes))
      throw new ConflictException({ statusCode: 409, code: 'SEM_PERMISSAO', message: 'Conecte (ou reconecte) o Instagram da loja com a permissão dos comentários.' });
    if (conta.igUserId !== l.ig_user_id)
      throw new ConflictException({ statusCode: 409, code: 'CONTA_TROCADA', message: 'Este comentário é de outra conta do Instagram (a loja conectou outra conta).' });
    return { l, conta };
  }

  private async itemPorId(tenantId: string, id: string): Promise<ItemDoComentario> {
    const [l] = linhas(await this.db.execute(sql`select ${colunasDoItem(await this.permitido(tenantId))} from instagram_comentario x where x.tenant_id = ${tenantId} and x.id = ${id}`));
    return item(l);
  }

  /** A ação da tela: `responder` (em público), `privada` ou `esconder`. No servidor da loja, pela nuvem (quem agiu vai junto). */
  async agirPara(user: AuthUser, acao: 'responder' | 'privada' | 'esconder', id: string, dto: any) {
    this.exigirGestao(user);
    // Conferido aqui também (o servidor da loja não manda à nuvem o que ela recusaria).
    if (acao === 'esconder') exigirBooleano(dto?.esconder, 'esconder');
    else this.textoDaAcao(acao, dto?.texto);
    if (ehServidorLocal())
      return this.dono.pelaNuvem('POST', 'instagram-comentarios-da-loja', {
        acao,
        id,
        texto: dto?.texto,
        esconder: dto?.esconder,
        atorId: user.colaboradorId,
      });
    return this.agir(user.tenantId, acao, id, dto, { id: user.colaboradorId, perfil: user.categoria });
  }

  /** A ação vinda do servidor da loja: quem agiu é colaborador ativo da empresa e da gestão (conferido aqui — V75). */
  async agirVindoDaLoja(tenantId: string, dto: any) {
    const acao = dto?.acao;
    if (acao !== 'responder' && acao !== 'privada' && acao !== 'esconder') throw new BadRequestException('Ação inválida.');
    const atorId = typeof dto?.atorId === 'string' && UUID_RE.test(dto.atorId) ? dto.atorId : null;
    const [quem] = atorId
      ? linhas(
          await this.db.execute(sql`
            select c.id, coalesce(p.nivel, f.categoria::text) as nivel from colaborador c left join funcao f on f.id = c.funcao_id left join perfil_acesso p on p.id = c.perfil_acesso_id
             where c.id = ${atorId} and c.tenant_id = ${tenantId} and c.status = 'ativo' and c.deleted_at is null`),
        )
      : [];
    if (!quem || !(QUEM_CUIDA_DOS_COMENTARIOS as readonly string[]).includes(String(quem.nivel))) throw new ForbiddenException('Quem cuida dos comentários do Instagram é a gestão.');
    return this.agir(tenantId, acao, String(dto?.id ?? ''), dto, { id: String(quem.id), perfil: String(quem.nivel) });
  }

  private textoDaAcao(acao: 'responder' | 'privada', v: unknown): string {
    const t = acao === 'responder' ? textoDaEquipe(v) : textoDaResposta(v);
    if (!t.ok) throw new BadRequestException(t.erro);
    return t.texto;
  }

  private async agir(tenantId: string, acao: 'responder' | 'privada' | 'esconder', id: string, dto: any, quem: { id: string; perfil: string }) {
    if (acao === 'esconder') return this.esconder(tenantId, id, exigirBooleano(dto?.esconder, 'esconder'), quem);
    const texto = this.textoDaAcao(acao, dto?.texto);
    return acao === 'responder' ? this.responderPelaEquipe(tenantId, id, texto, quem) : this.privadaPelaEquipe(tenantId, id, texto, quem);
  }

  /** A resposta PÚBLICA da equipe no post: uma da loja por comentário (a do robô conta) — já respondido = 409 JA_RESPONDIDO. */
  private async responderPelaEquipe(tenantId: string, id: string, texto: string, quem: { id: string; perfil: string }) {
    const { l, conta } = await this.umDaEmpresa(tenantId, id);
    if (l.escondido) throw new ConflictException({ statusCode: 409, code: 'COMENTARIO_ESCONDIDO', message: 'O comentário está escondido: mostre de novo para responder em público.' });
    const [reservou] = linhas(
      await this.db.execute(sql`
        update instagram_comentario
           set resposta_por = 'equipe', resposta_texto = ${texto}, respondido_em = clock_timestamp(), respondido_por = ${quem.id},
               erro = null, atualizado_em = clock_timestamp()
         where id = ${id} and tenant_id = ${tenantId} and resposta_id is null and (resposta_por is null or ${RESERVA_VENCIDA('respondido_em')})
         returning id`),
    );
    if (!reservou) throw new ConflictException({ statusCode: 409, code: 'JA_RESPONDIDO', message: 'Este comentário já tem a resposta da loja.' });
    let respostaId: string;
    try {
      respostaId = (await meta.responderComentario(String(l.comentario_id), decifrar(conta.token), texto)).id;
    } catch (e: any) {
      const t = traduzirErroDaMeta(e);
      await this.desfazerResposta(id, t.message);
      this.logger.warn(`resposta da equipe no comentário (empresa ${tenantId}): ${e?.message ?? e}`);
      throw new BadGatewayException({ statusCode: 502, code: t.code, message: t.message });
    }
    await this.db.execute(sql`update instagram_comentario set resposta_id = ${respostaId}, robo_entregue_em = null, atualizado_em = clock_timestamp() where id = ${id}`);
    await this.auditar(tenantId, quem, 'instagram_comentario_respondido', id, { comentarioId: l.comentario_id });
    this.avisar(tenantId, id, 'equipe_respondeu');
    return this.itemPorId(tenantId, id);
  }

  /** A resposta PRIVADA da equipe (no Direct): uma por comentário (409 JA_RESPONDIDO_NO_DIRECT), até 7 dias (409 PRAZO_VENCIDO). */
  private async privadaPelaEquipe(tenantId: string, id: string, texto: string, quem: { id: string; perfil: string }) {
    const { l, conta } = await this.umDaEmpresa(tenantId, id);
    const [reservou] = linhas(
      await this.db.execute(sql`
        update instagram_comentario set privada_em = clock_timestamp(), privada_texto = ${texto}, privada_por = ${quem.id}, atualizado_em = clock_timestamp()
         where id = ${id} and tenant_id = ${tenantId} and privada_igsid is null and (privada_em is null or ${RESERVA_VENCIDA('privada_em')})
           and comentado_em > now() - interval '7 days'
        returning id`),
    );
    if (!reservou) {
      if (l.privada_igsid || (l.privada_em && Date.now() - new Date(l.privada_em).getTime() < 2 * 60_000))
        throw new ConflictException({ statusCode: 409, code: 'JA_RESPONDIDO_NO_DIRECT', message: 'Este comentário já tem a resposta privada (o Instagram deixa uma só).' });
      if (l.vencido === true)
        throw new ConflictException({ statusCode: 409, code: 'PRAZO_VENCIDO', message: 'Passaram 7 dias do comentário: o Instagram não deixa mais a resposta privada.' });
      throw new ConflictException({ statusCode: 409, code: 'JA_RESPONDIDO_NO_DIRECT', message: 'Este comentário já tem a resposta privada (o Instagram deixa uma só).' });
    }
    const r = await this.mandarPrivada(tenantId, conta, { id, comentarioId: String(l.comentario_id), texto }, quem);
    if (!r.enviada) throw new BadGatewayException({ statusCode: 502, code: r.erro.code, message: r.erro.message });
    await this.auditar(tenantId, quem, 'instagram_comentario_privada', id, { comentarioId: l.comentario_id });
    this.avisar(tenantId, id, 'equipe_privada');
    return this.itemPorId(tenantId, id);
  }

  /** Esconde (ou mostra de novo) o comentário no post. Já no estado pedido = nada muda (não chama a Meta). */
  private async esconder(tenantId: string, id: string, esconder: boolean, quem: { id: string; perfil: string }) {
    const { l, conta } = await this.umDaEmpresa(tenantId, id);
    if (daLoja({ autorId: l.autor_id, autorUsuario: l.autor_usuario }, conta))
      throw new ConflictException({ statusCode: 409, code: 'COMENTARIO_DA_LOJA', message: 'O comentário da própria loja não se esconde.' });
    if (l.escondido === esconder) return this.itemPorId(tenantId, id);
    try {
      await meta.esconderComentario(String(l.comentario_id), decifrar(conta.token), esconder);
    } catch (e: any) {
      const t = traduzirErroDaMeta(e);
      await this.db.execute(sql`update instagram_comentario set erro = ${t.message}, atualizado_em = clock_timestamp() where id = ${id}`);
      this.logger.warn(`esconder o comentário (empresa ${tenantId}): ${e?.message ?? e}`);
      throw new BadGatewayException({ statusCode: 502, code: t.code, message: t.message });
    }
    await this.db.execute(sql`
      update instagram_comentario set escondido = ${esconder}, escondido_em = ${esconder ? sql`clock_timestamp()` : null},
             escondido_por = ${esconder ? quem.id : null}, erro = null, atualizado_em = clock_timestamp()
       where id = ${id}`);
    await this.auditar(tenantId, quem, 'instagram_comentario_escondido', id, { comentarioId: l.comentario_id, esconder });
    this.avisar(tenantId, id, esconder ? 'escondido' : 'mostrado');
    return this.itemPorId(tenantId, id);
  }

  private async auditar(tenantId: string, quem: { id: string; perfil: string }, acao: string, id: string, detalhe: any) {
    await this.auditoria?.registrar({
      tenantId,
      atorId: quem.id,
      atorPerfil: quem.perfil,
      tipo: 'atendimento',
      acao,
      entidadeTipo: 'instagram_comentario',
      entidadeId: id,
      detalhe,
    });
  }
}
