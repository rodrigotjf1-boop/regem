/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuthUser } from '../../auth/auth-user';
import { decifrar } from '../../common/cifra-segredo';
import { exigirBooleano } from '../../common/exigir';
import { ehServidorLocal } from '../../common/modo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { recadoDoCasoNovo } from '../atendimento/horario-da-equipe';
import { jeitoDoAtendente, perfisDaEmpresa } from '../cardapio/perfis-do-atendente';
import { cursorDe, lerCursor, podeComentarios, traduzirErroDaMeta, type EventoDoComentario } from './comentarios';
import { daLoja } from './comentarios.service';
import { IaDasMarcacoes } from './ia-das-marcacoes';
import type { EventoDoDirect } from './instagram';
import { nomeDoCliente } from './instagram';
import * as meta from './instagram-graph';
import type { InstagramService } from './instagram.service';
import {
  DIAS_DA_LISTA_DAS_MARCACOES,
  MARCACOES_POR_PAGINA,
  decidirStory,
  ehMencaoNoStory,
  mencionaALoja,
  resumoDoCasoDoStory,
  textoDaMarcacao,
  type AnaliseDaMarcacao,
  type TipoDaMarcacao,
} from './marcacoes';

// AS MARCAÇÕES DO INSTAGRAM (mig 387 — protótipo `mockups/regem-central-atendimento.html` versão 18; as regras puras em
// `marcacoes.ts`). Dois caminhos, os dois só na NUVEM:
//   • A MENÇÃO NO STORY (chega no Direct): com "Agradecer quem marca a loja no story" ligado, a mensagem NÃO vai ao robô do
//     n8n — a marcação cuida dela: conversa com alguém (caso aberto, ou a loja respondeu pelo app há pouco) → nada; senão a
//     IA olha a foto e o atendente virtual agradece no Direct (vídeo, sem a IA ou a imagem não baixou → o texto padrão);
//     parece reclamação → caso na fila, com o que a IA viu, sem agradecer.
//   • O @ DA LOJA NO POST OU NO COMENTÁRIO DE OUTRA PESSOA (chega no aviso `comments`): sai do caminho dos comentários (o robô
//     dos comentários responde só nos posts DA LOJA) e entra na lista "Marcações"; com "Sugerir comentário nas marcações"
//     ligado, a IA escreve a sugestão. Nada sai sozinho: a gestão publica (`POST /{conta}/mentions`) ou ignora.
// A imagem é analisada e descartada; nada do que a pessoa postou vai para o registro (V11 — só o motivo).

export const QUEM_CUIDA_DAS_MARCACOES = ['presidente', 'gerente'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const linhas = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const minutosDaPausa = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 60;
};
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';

/** O story que espera a análise (gravado na transação do Direct; tratado depois dela). */
export type StoryPendente = {
  marcacaoId: string;
  tenantId: string;
  igUserId: string;
  igsid: string;
  mid: string | null;
  midiaUrl: string | null;
  usuario: string | null;
  nome: string | null;
  cardapioId: string | null;
};

export type ItemDaMarcacao = {
  id: string;
  tipo: TipoDaMarcacao;
  usuario: string | null;
  marcadoEm: string;
  link: string | null;
  legenda: string | null;
  texto: string | null;
  viu: string | null;
  clima: 'positivo' | 'neutro' | 'negativo' | null;
  sugestao: string | null;
  estado: string;
  resposta: { texto: string; por: 'robo' | 'padrao' | 'equipe'; em: string | null; quem: string | null } | null;
  chamadoId: string | null;
  erro: string | null;
};

function itemDaLinha(l: any): ItemDaMarcacao {
  return {
    id: String(l.id),
    tipo: l.tipo,
    usuario: l.autor_usuario ?? null,
    marcadoEm: new Date(l.marcado_em).toISOString(),
    link: l.midia_link ?? null,
    legenda: l.legenda ?? null,
    texto: l.texto ?? null,
    viu: l.ia_viu ?? null,
    clima: l.ia_clima ?? null,
    sugestao: l.estado === 'sugerida' ? (l.sugestao ?? null) : null,
    estado: String(l.estado),
    resposta: l.resposta_texto ? { texto: String(l.resposta_texto), por: l.resposta_por, em: l.respondido_em ? new Date(l.respondido_em).toISOString() : null, quem: l.quem ?? null } : null,
    chamadoId: l.chamado_id ? String(l.chamado_id) : null,
    erro: l.erro ?? null,
  };
}

export class MarcacoesDoInstagram {
  private readonly logger = new Logger('InstagramMarcacoes');
  private readonly tarefas = new Set<Promise<void>>();
  /** A IA (à parte: o teste troca a chamada ao modelo). */
  ia = new IaDasMarcacoes();

  constructor(
    private readonly db: any,
    private readonly events: { emit: (evento: string, dados: any) => unknown },
    private readonly dono: InstagramService,
    private readonly auditoria?: AuditoriaService,
  ) {}

  private avisar(tenantId: string, id: string, motivo: string) {
    this.events.emit('instagram.marcacao', { tenantId, id, motivo });
  }

  /** Em segundo plano, guardado (o teste espera); nunca rejeita (V3). */
  private segundoPlano(nome: string, f: () => Promise<void>): void {
    const t = f().catch((e: any) => this.logger.warn(`${nome}: ${e?.message ?? e}`));
    this.tarefas.add(t);
    void t.finally(() => this.tarefas.delete(t));
  }

  /** Só para teste: espera o que está em andamento (a análise, o agradecimento, a sugestão). */
  async esperar(): Promise<void> {
    while (this.tarefas.size) await Promise.all([...this.tarefas]);
  }

  /** A conta da loja, da empresa viva, com os ajustes da 387 lidos por `to_jsonb` (banco sem a 387: desligados). */
  private async conta(tx: any, por: { igUserId?: string; tenantId?: string }, travar = false) {
    const onde = por.igUserId ? sql`c.ig_user_id = ${por.igUserId}` : sql`c.tenant_id = ${por.tenantId}`;
    const [c] = linhas(
      await tx.execute(sql`
        select c.tenant_id as "tenantId", c.ig_user_id as "igUserId", c.token_cifrado as token, c.permissoes, c.usuario,
               c.cardapio_id as "cardapioId",
               coalesce((to_jsonb(c) ->> 'marcacao_story')::boolean, false) as story,
               coalesce((to_jsonb(c) ->> 'marcacao_post')::boolean, false) as post
          from instagram_conta c join empresa e on e.id = c.tenant_id and e.deleted_at is null
         where ${onde} ${travar ? sql`for update of c` : sql``}`),
    );
    return (c ?? null) as null | {
      tenantId: string;
      igUserId: string;
      token: string;
      permissoes: string | null;
      usuario: string | null;
      cardapioId: string | null;
      story: boolean;
      post: boolean;
    };
  }

  /** O nome da loja para a IA: o do cardápio do robô (ou o único da empresa); sem cardápio, nenhum. */
  private async nomeDaLoja(tenantId: string, cardapioId: string | null): Promise<string | null> {
    try {
      const c = await this.dono.cardapioDoRobo(this.db, tenantId, cardapioId);
      return c?.nomePublico ?? null;
    } catch {
      return null;
    }
  }

  // ───────────────────────── a menção no story (o Direct) ─────────────────────────

  /**
   * Dentro da transação do Direct (a conta travada), para a mensagem NOVA do cliente: é a menção no story com o agradecimento
   * ligado? Grava a marcação (o aviso repetido não entra — o único da origem) e decide o que dá para decidir já: com o caso
   * aberto da conversa, soma a mensagem a ele e não faz nada; com a loja respondendo pelo app há pouco, nada. O resto fica
   * PENDENTE para depois da transação (a imagem e a IA não rodam com a conta travada). `null` = não é marcação (o Direct segue).
   */
  async storyNaTransacao(
    tx: any,
    o: { conta: { tenantId: string; story: boolean; cardapioId: string | null }; ev: EventoDoDirect; msgId: string },
  ): Promise<{ aviso: { evento: string; dados: any } | null; pendente: StoryPendente | null } | null> {
    const { ev, conta } = o;
    if (!conta.story || !ehMencaoNoStory(ev)) return null;
    const [contato] = linhas(await tx.execute(sql`select nome, usuario from instagram_contato where tenant_id = ${conta.tenantId} and igsid = ${ev.igsid}`));
    const [m] = linhas(
      await tx.execute(sql`
        insert into instagram_marcacao (tenant_id, ig_user_id, tipo, origem_id, autor_id, autor_usuario, estado, marcado_em)
        values (${conta.tenantId}, ${ev.conta}, 'story', ${ev.mid ?? o.msgId}, ${ev.igsid}, ${contato?.usuario ?? null}, 'sem_acao', ${ev.em.toISOString()})
        on conflict (tenant_id, tipo, origem_id) do nothing
        returning id`),
    );
    if (!m) return { aviso: null, pendente: null }; // repetido: nem o robô, nem nada
    const [aberto] = linhas(
      await tx.execute(sql`
        select id from atendimento_chamado
         where tenant_id = ${conta.tenantId} and tipo = 'instagram' and status = 'aberto' and detalhe #>> '{instagram,igsid}' = ${ev.igsid}
         order by criado_em desc limit 1`),
    );
    if (aberto) {
      // A conversa está com alguém: a menção soma ao caso (como qualquer mensagem) e o atendente virtual não agradece.
      await tx.execute(sql`
        update atendimento_chamado
           set mensagem = '📸 Marcou a loja no story', aguardando_desde = null,
               detalhe = coalesce(detalhe, '{}'::jsonb)
                         || jsonb_build_object('instagram', coalesce(detalhe -> 'instagram', '{}'::jsonb) || jsonb_build_object('ultimaEm', ${ev.em.toISOString()}::text))
         where id = ${aberto.id}`);
      await tx.execute(sql`update instagram_mensagem set chamado_id = ${aberto.id} where id = ${o.msgId}`);
      await tx.execute(sql`update instagram_marcacao set chamado_id = ${aberto.id}, atualizado_em = clock_timestamp() where id = ${m.id}`);
      return { aviso: { evento: 'atendimento.mudou', dados: { tenantId: conta.tenantId, id: aberto.id, motivo: 'instagram_mensagem' } }, pendente: null };
    }
    const [q] = linhas(
      await tx.execute(sql`
        select (select max(x.criado_em) from instagram_mensagem x
                 where x.tenant_id = ${conta.tenantId} and x.igsid = ${ev.igsid} and x.autor = 'loja') as "ultimaDaLojaEm",
               (select pausa_minutos from robo_config where tenant_id = ${conta.tenantId}) as minutos, now() as agora`),
    );
    const ultima = q?.ultimaDaLojaEm ? new Date(q.ultimaDaLojaEm).getTime() : NaN;
    const agora = q?.agora ? new Date(q.agora).getTime() : Date.now();
    if (Number.isFinite(ultima) && agora - ultima < minutosDaPausa(q?.minutos) * 60_000) return { aviso: null, pendente: null }; // a loja está respondendo pelo app
    return {
      aviso: null,
      pendente: {
        marcacaoId: String(m.id),
        tenantId: conta.tenantId,
        igUserId: ev.conta,
        igsid: ev.igsid,
        mid: ev.mid,
        midiaUrl: ev.midiaUrl,
        usuario: contato?.usuario ?? null,
        nome: contato?.nome ?? null,
        cardapioId: conta.cardapioId ?? null,
      },
    };
  }

  /** Depois da transação: a análise e o agradecimento (ou o caso) em segundo plano. */
  tratarStoryDepois(p: StoryPendente): void {
    this.segundoPlano('menção no story', () => this.tratarStory(p));
  }

  private async tratarStory(p: StoryPendente): Promise<void> {
    // A foto do story (vídeo não baixa: o agradecimento padrão), analisada e descartada.
    const imagem = this.ia.disponivel() ? await this.ia.baixar(p.midiaUrl) : null;
    let analise: AnaliseDaMarcacao | null = null;
    if (imagem) {
      const [loja, perfis] = await Promise.all([this.nomeDaLoja(p.tenantId, p.cardapioId), perfisDaEmpresa(this.db, p.tenantId).catch(() => null)]);
      analise = await this.ia.analisar({ tipo: 'story', loja, jeito: perfis ? jeitoDoAtendente(perfis, 'direct', true) : '', usuario: p.usuario, texto: null, imagem });
    }
    const ia = { viu: analise?.viu ?? null, clima: analise?.clima ?? null, modelo: analise ? this.ia.modelo() : null };
    // A decisão de novo com a conta travada: alguém pode ter assumido a conversa enquanto a IA olhava.
    const r = await this.db.transaction(async (tx: any) => {
      const conta = await this.conta(tx, { igUserId: p.igUserId }, true);
      if (!conta || conta.tenantId !== p.tenantId) return null;
      const [aberto] = linhas(
        await tx.execute(sql`
          select id from atendimento_chamado
           where tenant_id = ${p.tenantId} and tipo = 'instagram' and status = 'aberto' and detalhe #>> '{instagram,igsid}' = ${p.igsid} limit 1`),
      );
      const d = decidirStory({ conversaComAlguem: !!aberto, analise });
      if (d.acao === 'nada') {
        await tx.execute(sql`
          update instagram_marcacao set ia_viu = ${ia.viu}, ia_clima = ${ia.clima}, ia_modelo = ${ia.modelo}, chamado_id = ${aberto?.id ?? null},
                 atualizado_em = clock_timestamp() where id = ${p.marcacaoId}`);
        return { tipo: 'nada' as const };
      }
      if (d.acao === 'caso') {
        const fora = await recadoDoCasoNovo(this.db, p.tenantId, { cardapioId: p.cardapioId });
        const detalhe = {
          plataforma: 'instagram',
          instagram: { igsid: p.igsid, usuario: p.usuario, nome: p.nome, ultimaEm: new Date().toISOString() },
          robo: { ...resumoDoCasoDoStory(ia.viu), em: new Date().toISOString() },
          marcacao: { id: p.marcacaoId },
          ...(fora ? { recado: fora.recado } : {}),
        };
        const [novo] = linhas(
          await tx.execute(sql`
            insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, mensagem, prioridade, detalhe)
            values (${p.tenantId}, null, 'instagram', 'instagram', ${nomeDoCliente({ nome: p.nome, usuario: p.usuario })}, '📸 Marcou a loja no story',
                    'normal', ${JSON.stringify(detalhe)}::jsonb)
            returning *`),
        );
        if (p.mid) await tx.execute(sql`update instagram_mensagem set chamado_id = ${novo.id} where tenant_id = ${p.tenantId} and mid = ${p.mid}`);
        await tx.execute(sql`
          update instagram_marcacao set estado = 'caso', chamado_id = ${novo.id}, ia_viu = ${ia.viu}, ia_clima = ${ia.clima}, ia_modelo = ${ia.modelo},
                 atualizado_em = clock_timestamp() where id = ${p.marcacaoId}`);
        return { tipo: 'caso' as const, novo };
      }
      return { tipo: 'agradecer' as const, texto: d.texto, padrao: d.padrao, token: conta.token };
    });
    if (!r) return;
    if (r.tipo === 'caso') this.events.emit('atendimento.novo', { tenantId: p.tenantId, chamado: r.novo });
    if (r.tipo === 'agradecer') await this.agradecer(p, r.texto, r.padrao, r.token, ia);
    this.avisar(p.tenantId, p.marcacaoId, r.tipo === 'caso' ? 'virou_caso' : r.tipo === 'agradecer' ? 'agradecida' : 'sem_acao');
  }

  /** O agradecimento no Direct (a janela está aberta: a menção é a mensagem do cliente). Falhou → `falhou`, com o motivo. */
  private async agradecer(p: StoryPendente, texto: string, padrao: boolean, token: string, ia: { viu: string | null; clima: string | null; modelo: string | null }) {
    let mid: string | null = null;
    try {
      mid = (await meta.enviarTexto(p.igUserId, decifrar(token), p.igsid, texto)).mid;
    } catch (e: any) {
      // O motivo para a tela, sem o texto de ninguém (a tradução dos comentários falaria da permissão deles — aqui é o Direct).
      const erro = e instanceof meta.ErroDaMeta && e.status === 0 ? 'O Instagram não respondeu: o agradecimento não saiu.' : 'O Instagram não aceitou o agradecimento no Direct.';
      await this.db.execute(sql`
        update instagram_marcacao set estado = 'falhou', erro = ${erro}, ia_viu = ${ia.viu}, ia_clima = ${ia.clima}, ia_modelo = ${ia.modelo},
               atualizado_em = clock_timestamp() where id = ${p.marcacaoId}`);
      this.logger.warn(`agradecimento da menção no story (empresa ${p.tenantId}): ${e?.message ?? e}`);
      return;
    }
    // O eco da Meta pode chegar ANTES desta gravação: com o mesmo id, ela vira a fala do atendente virtual ("Corrigir").
    await this.db.execute(sql`
      insert into instagram_mensagem (tenant_id, ig_user_id, igsid, direcao, autor, tipo, texto, mid, estado)
      values (${p.tenantId}, ${p.igUserId}, ${p.igsid}, 'saida', 'robo', 'texto', ${texto}, ${mid}, 'enviada')
      on conflict (tenant_id, mid) where mid is not null do update set autor = 'robo'`);
    await this.db.execute(sql`
      update instagram_marcacao
         set estado = 'agradecida', resposta_texto = ${texto}, resposta_id = ${mid}, resposta_por = ${padrao ? 'padrao' : 'robo'},
             respondido_em = clock_timestamp(), ia_viu = ${ia.viu}, ia_clima = ${ia.clima}, ia_modelo = ${ia.modelo}, erro = null,
             atualizado_em = clock_timestamp()
       where id = ${p.marcacaoId}`);
  }

  // ───────────────────────── o @ da loja em comentário (o aviso `comments`) ─────────────────────────

  /**
   * O comentário é uma MARCAÇÃO (o @ da loja num comentário ou post de OUTRA pessoa)? Então grava na lista "Marcações" (e,
   * com a sugestão ligada, a IA escreve) e devolve `true` — o caminho dos comentários para aqui. O comentário no post DA
   * LOJA que cita o @ dela continua comentário (`false`). Só lê a mídia à Meta quando o texto marca a loja.
   */
  async doComentario(ev: EventoDoComentario): Promise<boolean> {
    const conta = await this.conta(this.db, { igUserId: ev.conta });
    if (!conta || !podeComentarios(conta.permissoes) || !mencionaALoja(ev.texto, conta.usuario)) return false;
    if (daLoja(ev, conta)) return false; // a própria loja citando o @ dela: o caminho dos comentários descarta
    let midia: Awaited<ReturnType<typeof meta.midiaDaMarcacao>> | null = null;
    try {
      midia = await meta.midiaDaMarcacao(ev.midiaId, decifrar(conta.token));
    } catch (e: any) {
      // A mídia de outra pessoa pode não abrir com o acesso da loja: conta como marcação (o formato vai ao registro).
      this.logger.log(`marcação em comentário: a mídia não abriu com o acesso da loja (empresa ${conta.tenantId}, código ${e?.codigo ?? e?.status ?? '?'})`);
    }
    if (midia?.dono && conta.usuario && midia.dono.toLowerCase() === String(conta.usuario).replace(/^@/, '').toLowerCase()) return false; // post da loja
    let novo: any;
    try {
      [novo] = linhas(
        await this.db.execute(sql`
          insert into instagram_marcacao (tenant_id, ig_user_id, tipo, origem_id, midia_id, midia_produto, midia_link, legenda,
                                          autor_id, autor_usuario, texto, estado, marcado_em)
          values (${conta.tenantId}, ${ev.conta}, 'comentario', ${ev.comentarioId}, ${ev.midiaId}, ${ev.midiaTipo ?? midia?.produto ?? null},
                  ${midia?.link ?? null}, ${midia?.legenda ?? null}, ${ev.autorId}, ${ev.autorUsuario}, ${ev.texto}, 'sugerida', ${ev.em.toISOString()})
          on conflict (tenant_id, tipo, origem_id) do nothing
          returning id`),
      );
    } catch (e: any) {
      if (semTabela(e)) return false; // banco sem a 387: segue como comentário
      throw e;
    }
    if (!novo) return true; // repetido
    this.avisar(conta.tenantId, String(novo.id), 'nova');
    if (conta.post && this.ia.disponivel()) {
      const id = String(novo.id);
      this.segundoPlano('sugestão da marcação', async () => {
        const imagem = await this.ia.baixar(midia?.imagem ?? null);
        const [loja, perfis] = await Promise.all([this.nomeDaLoja(conta.tenantId, conta.cardapioId), perfisDaEmpresa(this.db, conta.tenantId).catch(() => null)]);
        const contexto = midia?.legenda ? `${ev.texto}\n(Legenda do post: ${midia.legenda.slice(0, 300)})` : ev.texto;
        const a = await this.ia.analisar({
          tipo: 'comentario',
          loja,
          jeito: perfis ? jeitoDoAtendente(perfis, 'comentarios', true) : '',
          usuario: ev.autorUsuario,
          texto: contexto,
          imagem,
        });
        if (!a) return;
        await this.db.execute(sql`
          update instagram_marcacao set ia_viu = ${a.viu}, ia_clima = ${a.clima}, ia_modelo = ${this.ia.modelo()}, sugestao = ${a.resposta},
                 atualizado_em = clock_timestamp()
           where id = ${id} and estado = 'sugerida'`);
        this.avisar(conta.tenantId, id, 'sugestao');
      });
    }
    return true;
  }

  // ───────────────────────── a tela (gestão) ─────────────────────────

  private exigirGestao(user: AuthUser) {
    if (!(QUEM_CUIDA_DAS_MARCACOES as readonly string[]).includes(user.categoria)) throw new ForbiddenException('Quem cuida das marcações do Instagram é a gestão.');
  }

  /** A lista da tela. No servidor da loja, pela nuvem (V37). */
  async listarPara(user: AuthUser, q: { antes?: unknown }) {
    this.exigirGestao(user);
    if (ehServidorLocal()) {
      const p = new URLSearchParams();
      if (typeof q?.antes === 'string') p.set('antes', q.antes);
      return this.dono.pelaNuvem('GET', `instagram-marcacoes-da-loja?${p.toString()}`);
    }
    return this.listar(user.tenantId, q);
  }

  /**
   * As marcações dos últimos 30 dias, da mais nova à mais velha, 50 por página (cursor `antes` = data + id da última), com
   * a contagem no `where` (V39) e os ajustes (a tela diz o que está ligado e se a IA da distribuição existe).
   */
  async listar(tenantId: string, q: { antes?: unknown }) {
    const cursor = lerCursor(q?.antes);
    const conta = await this.conta(this.db, { tenantId });
    const ajustes = { story: !!conta?.story, post: !!conta?.post, ia: this.ia.disponivel(), permitido: !!conta && podeComentarios(conta.permissoes) };
    const janela = sql`x.tenant_id = ${tenantId} and x.marcado_em > now() - make_interval(days => ${DIAS_DA_LISTA_DAS_MARCACOES}::int)`;
    let rows: any[];
    let contagem: any;
    try {
      [rows, [contagem]] = await Promise.all([
        this.db
          .execute(sql`
            select x.*, col.nome as quem from instagram_marcacao x
              left join colaborador col on col.id = x.respondido_por and col.tenant_id = x.tenant_id
             where ${janela}
               ${cursor ? sql`and (x.marcado_em, x.id) < (${cursor.em}::timestamptz, ${cursor.id}::uuid)` : sql``}
             order by x.marcado_em desc, x.id desc
             limit ${MARCACOES_POR_PAGINA + 1}`)
          .then(linhas),
        this.db
          .execute(sql`
            select count(*) filter (where x.estado = 'sugerida')::int as "aDecidir", count(*)::int as todas
              from instagram_marcacao x where ${janela}`)
          .then(linhas),
      ]);
    } catch (e: any) {
      if (semTabela(e)) return { itens: [], contagem: { aDecidir: 0, todas: 0 }, proximo: null, ajustes };
      throw e;
    }
    const pagina = rows.slice(0, MARCACOES_POR_PAGINA).map(itemDaLinha);
    return {
      itens: pagina,
      contagem: { aDecidir: Number(contagem?.aDecidir ?? 0), todas: Number(contagem?.todas ?? 0) },
      proximo: rows.length > MARCACOES_POR_PAGINA && pagina.length ? cursorDe({ comentadoEm: pagina[pagina.length - 1].marcadoEm, id: pagina[pagina.length - 1].id }) : null,
      ajustes,
    };
  }

  private async umaDaEmpresa(tenantId: string, id: string) {
    if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException('Marcação não encontrada.');
    const [l] = linhas(await this.db.execute(sql`select x.* from instagram_marcacao x where x.tenant_id = ${tenantId} and x.id = ${id}`));
    if (!l) throw new NotFoundException('Marcação não encontrada.');
    return l;
  }

  private async itemPorId(tenantId: string, id: string): Promise<ItemDaMarcacao> {
    const [l] = linhas(
      await this.db.execute(sql`
        select x.*, col.nome as quem from instagram_marcacao x
          left join colaborador col on col.id = x.respondido_por and col.tenant_id = x.tenant_id
         where x.tenant_id = ${tenantId} and x.id = ${id}`),
    );
    return itemDaLinha(l);
  }

  /** A ação da tela: `publicar` (o comentário da equipe) ou `ignorar`. No servidor da loja, pela nuvem (quem agiu vai junto). */
  async agirPara(user: AuthUser, acao: 'publicar' | 'ignorar', id: string, dto: any) {
    this.exigirGestao(user);
    if (acao === 'publicar') this.texto(dto?.texto); // conferido aqui também (o servidor da loja não manda o que a nuvem recusaria)
    if (ehServidorLocal()) return this.dono.pelaNuvem('POST', 'instagram-marcacoes-da-loja', { acao, id, texto: dto?.texto, atorId: user.colaboradorId });
    return this.agir(user.tenantId, acao, id, dto, { id: user.colaboradorId, perfil: user.categoria });
  }

  /** A ação vinda do servidor da loja: quem agiu é colaborador ativo da empresa e da gestão (conferido aqui — V75). */
  async agirVindoDaLoja(tenantId: string, dto: any) {
    const acao = dto?.acao;
    if (acao !== 'publicar' && acao !== 'ignorar') throw new BadRequestException('Ação inválida.');
    const atorId = typeof dto?.atorId === 'string' && UUID_RE.test(dto.atorId) ? dto.atorId : null;
    const [quem] = atorId
      ? linhas(
          await this.db.execute(sql`
            select c.id, coalesce(p.nivel, f.categoria::text) as nivel from colaborador c left join funcao f on f.id = c.funcao_id left join perfil_acesso p on p.id = c.perfil_acesso_id
             where c.id = ${atorId} and c.tenant_id = ${tenantId} and c.status = 'ativo' and c.deleted_at is null`),
        )
      : [];
    if (!quem || !(QUEM_CUIDA_DAS_MARCACOES as readonly string[]).includes(String(quem.nivel))) throw new ForbiddenException('Quem cuida das marcações do Instagram é a gestão.');
    return this.agir(tenantId, acao, String(dto?.id ?? ''), dto, { id: String(quem.id), perfil: String(quem.nivel) });
  }

  private texto(v: unknown): string {
    const t = textoDaMarcacao(v);
    if (!t.ok) throw new BadRequestException(t.erro);
    return t.texto;
  }

  private async agir(tenantId: string, acao: 'publicar' | 'ignorar', id: string, dto: any, quem: { id: string; perfil: string }) {
    return acao === 'publicar' ? this.publicar(tenantId, id, this.texto(dto?.texto), quem) : this.ignorar(tenantId, id, quem);
  }

  /**
   * O comentário da equipe na marcação: uma vez (a troca condicional `sugerida → publicada` reserva — 409 JA_DECIDIDA),
   * pela conta conectada (outra conta → 409 CONTA_TROCADA) com a permissão (409 SEM_PERMISSAO). A Meta recusou → volta a
   * `sugerida`, com o motivo, e 502 com o código.
   */
  private async publicar(tenantId: string, id: string, texto: string, quem: { id: string; perfil: string }) {
    const l = await this.umaDaEmpresa(tenantId, id);
    if (l.tipo === 'story') throw new ConflictException({ statusCode: 409, code: 'STORY_NO_DIRECT', message: 'A menção no story se responde no Direct.' });
    const conta = await this.conta(this.db, { tenantId });
    if (!conta || !podeComentarios(conta.permissoes))
      throw new ConflictException({ statusCode: 409, code: 'SEM_PERMISSAO', message: 'Conecte (ou reconecte) o Instagram da loja com a permissão dos comentários.' });
    if (conta.igUserId !== l.ig_user_id)
      throw new ConflictException({ statusCode: 409, code: 'CONTA_TROCADA', message: 'Esta marcação é de outra conta do Instagram (a loja conectou outra conta).' });
    const [reservou] = linhas(
      await this.db.execute(sql`
        update instagram_marcacao
           set estado = 'publicada', resposta_texto = ${texto}, resposta_por = 'equipe', respondido_por = ${quem.id},
               respondido_em = clock_timestamp(), erro = null, atualizado_em = clock_timestamp()
         where id = ${id} and tenant_id = ${tenantId} and estado = 'sugerida'
         returning id`),
    );
    if (!reservou) throw new ConflictException({ statusCode: 409, code: 'JA_DECIDIDA', message: 'Esta marcação já foi respondida ou ignorada.' });
    let respostaId: string;
    try {
      respostaId = (
        await meta.responderMarcacao(conta.igUserId, decifrar(conta.token), {
          midiaId: String(l.midia_id ?? ''),
          comentarioId: l.tipo === 'comentario' ? String(l.origem_id) : null,
          texto,
        })
      ).id;
    } catch (e: any) {
      const t = traduzirErroDaMeta(e);
      await this.db.execute(sql`
        update instagram_marcacao
           set estado = 'sugerida', resposta_texto = null, resposta_por = null, respondido_por = null, respondido_em = null,
               erro = ${t.message}, atualizado_em = clock_timestamp()
         where id = ${id} and estado = 'publicada' and resposta_id is null`);
      this.logger.warn(`comentário da equipe na marcação (empresa ${tenantId}): ${e?.message ?? e}`);
      throw new BadGatewayException({ statusCode: 502, code: t.code, message: t.message });
    }
    await this.db.execute(sql`update instagram_marcacao set resposta_id = ${respostaId}, atualizado_em = clock_timestamp() where id = ${id}`);
    await this.auditar(tenantId, quem, 'instagram_marcacao_publicada', id, { tipo: l.tipo });
    this.avisar(tenantId, id, 'equipe_publicou');
    return this.itemPorId(tenantId, id);
  }

  private async ignorar(tenantId: string, id: string, quem: { id: string; perfil: string }) {
    await this.umaDaEmpresa(tenantId, id);
    const [ok] = linhas(
      await this.db.execute(sql`
        update instagram_marcacao set estado = 'ignorada', respondido_por = ${quem.id}, respondido_em = clock_timestamp(), atualizado_em = clock_timestamp()
         where id = ${id} and tenant_id = ${tenantId} and estado = 'sugerida' returning id`),
    );
    if (!ok) throw new ConflictException({ statusCode: 409, code: 'JA_DECIDIDA', message: 'Esta marcação já foi respondida ou ignorada.' });
    await this.auditar(tenantId, quem, 'instagram_marcacao_ignorada', id, {});
    this.avisar(tenantId, id, 'ignorada');
    return this.itemPorId(tenantId, id);
  }

  private async auditar(tenantId: string, quem: { id: string; perfil: string }, acao: string, id: string, detalhe: any) {
    await this.auditoria?.registrar({ tenantId, atorId: quem.id, atorPerfil: quem.perfil, tipo: 'atendimento', acao, entidadeTipo: 'instagram_marcacao', entidadeId: id, detalhe });
  }

  // ───────────────────────── os ajustes ─────────────────────────

  /** O que a tela de ajustes mostra (lido junto do Instagram — `InstagramService.ajuste`). */
  marcacoesDoAjuste(linha: { story?: unknown; post?: unknown; permissoes?: unknown } | null) {
    return {
      story: linha?.story === true,
      post: linha?.post === true,
      ia: this.ia.disponivel(),
      // O @ no post de outra pessoa chega com os comentários (a mesma permissão); o story chega no Direct.
      postPermitido: !!linha && podeComentarios(typeof linha.permissoes === 'string' ? linha.permissoes : null),
    };
  }

  /**
   * Confere o grupo `marcacoes` do salvar (antes de gravar qualquer grupo — V86): liga/desliga com `exigirBooleano` (V15), o
   * que não veio fica (V16); o agradecimento só liga com a conta conectada; a sugestão, também com a permissão dos comentários.
   */
  async conferirAjuste(tenantId: string, dto: unknown): Promise<{ story?: boolean; post?: boolean }> {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) throw new BadRequestException('Marcações do Instagram: ajuste inválido.');
    const d = dto as any;
    const saida: { story?: boolean; post?: boolean } = {};
    if (d.story !== undefined) saida.story = exigirBooleano(d.story, 'instagram.marcacoes.story');
    if (d.post !== undefined) saida.post = exigirBooleano(d.post, 'instagram.marcacoes.post');
    if (saida.story === true || saida.post === true) {
      const conta = await this.conta(this.db, { tenantId });
      if (!conta) throw new BadRequestException('Conecte o Instagram da loja antes de ligar as marcações.');
      if (saida.post === true && !podeComentarios(conta.permissoes))
        throw new BadRequestException('A conta do Instagram foi conectada antes dos comentários: reconecte o Instagram para as marcações em posts.');
    }
    return saida;
  }

  /** Grava o que `conferirAjuste` devolveu, só o que veio e mudou, cada mudança na auditoria. */
  async salvarAjuste(user: AuthUser, a: { story?: boolean; post?: boolean }) {
    const campos = [
      { v: a.story, col: 'marcacao_story', liga: 'marcacao_story_ligado', desliga: 'marcacao_story_desligado' },
      { v: a.post, col: 'marcacao_post', liga: 'marcacao_post_ligado', desliga: 'marcacao_post_desligado' },
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
}
