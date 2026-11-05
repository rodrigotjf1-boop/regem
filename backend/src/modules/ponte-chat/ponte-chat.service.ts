import { BadRequestException, ConflictException, Inject, Injectable, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { versaoInformada } from '../equipamento/presenca.service';
import { CANAIS, CanalDaPonte, PonteCandidata, ehCanalDaPonte, quemResponde, VIVA_POR_MS } from './lideranca';
import type { PonteCtx } from './ponte-chat.guard';
import { MensagemDoCliente, RoboNoCaso, casosDoChat, chaveDaConversa, chaveDoMapa, conversasDoLote } from './casos-do-chat';
import { CHAMEI_A_EQUIPE, decidir, intencaoDoCliente } from './robo-do-chat';
import { DeliveryService } from '../delivery/delivery.service';
import { modoEntrega } from '../entregador/modo-entrega';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A PONTE DO CHAT do iFood e da 99 (mig 366) — o lado da NUVEM. O programa da ponte, no PC da loja, fica com o Gestor do
// iFood e o portal da 99 abertos (a pessoa entra com o login dela) e conversa com a nuvem por quatro chamadas:
//   • estado   — o sinal de vida (a cada ~30 s): em quais plataformas está logada; a resposta diz se a ponte está ligada
//                nos ajustes e, por canal, se ESTA ponte responde ou fica de reserva (`lideranca.ts`);
//   • mensagens — o que chegou no chat (do cliente, ou da loja escrito fora do Regem): entra uma vez só (canal + id da
//                mensagem na plataforma), ligado ao pedido pelo id ou pelo número do pedido na plataforma;
//   • pegar    — a vez na fila de SAÍDA (avisos, robô, equipe): só a ponte que responde pelo canal pega, e pega com
//                prazo (90 s) — duas pontes, duas réplicas da nuvem, nunca a mesma mensagem (`for update skip locked`);
//   • resultado — enviada (com o id que a plataforma deu) ou não (volta para a fila; na 3ª falha, "falhou").
// Mensagem de saída que não saiu em 30 min não sai mais (um "saiu para entrega" de meia hora atrás só confunde).

const PRAZO_ENVIO_S = 90;
const TENTATIVAS = 3;
const LOTE_SAIDA = 10;
const LOTE_ENTRADA = 50;

const linhas = (r: any): any[] => (r?.rows ?? r) as any[];
const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

export type PapelNoCanal = 'responde' | 'reserva' | 'fora';

@Injectable()
export class PonteChatService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // Avisa a tela Atendimento (tempo real) do caso que o chat abriu ou somou (Etapa 2). Opcional: os testes montam sem.
    @Optional() private readonly events?: EventEmitter2,
    // A previsão "20h15" que o robô diz (Etapa 3) — a mesma conta do aviso "saiu". Opcional: sem ela, sai sem a hora.
    @Optional() private readonly delivery?: DeliveryService,
  ) {}

  /** A ponte está ligada nos ajustes da empresa? Sem linha em robo_config = desligada (nasce desligada). */
  async ligada(tenantId: string): Promise<boolean> {
    return (await this.ajustesDoChat(tenantId)).ligada;
  }

  /** Ligada e "o robô responde no chat" (Etapa 3) — os dois nascem desligados. */
  async ajustesDoChat(tenantId: string): Promise<{ ligada: boolean; roboResponde: boolean }> {
    const [r] = linhas(await this.db.execute(sql`select chat_ponte_ligada, chat_robo_responde from robo_config where tenant_id = ${tenantId}::uuid`));
    return { ligada: r?.chat_ponte_ligada === true, roboResponde: r?.chat_robo_responde === true };
  }

  /**
   * Quem responde pelo canal na loja da ponte: as pontes da MESMA loja (ou sem loja, ambas), ativas, não revogadas, com
   * sinal há no máximo 2 min — e a regra única de `quemResponde`.
   */
  async quemRespondePeloCanal(tenantId: string, unidadeId: string | null, canal: CanalDaPonte): Promise<string | null> {
    const r = linhas(await this.db.execute(sql`
      select cp.equipamento_id as id, cp.papel,
             extract(epoch from (now() - cp.visto_em)) * 1000 as idade_ms,
             extract(epoch from (now() - e.created_at)) * 1000 as cadastro_ms,
             coalesce((cp.plataformas -> ${canal} ->> 'logado')::boolean, false) as logada
        from chat_ponte cp
        join equipamento e on e.id = cp.equipamento_id
       where cp.tenant_id = ${tenantId}::uuid
         and e.tipo = 'ponte_chat' and e.ativo and e.revogado_em is null
         and cp.unidade_id is not distinct from ${unidadeId}::uuid
         and cp.visto_em > now() - make_interval(secs => ${VIVA_POR_MS / 1000})`));
    const agora = Date.now();
    const candidatas: PonteCandidata[] = r.map((x) => ({
      id: x.id,
      papel: x.papel,
      vistoEm: agora - Number(x.idade_ms),
      logada: x.logada === true,
      criadaEm: agora - Number(x.cadastro_ms),
    }));
    return quemResponde(candidatas, agora);
  }

  /** O sinal de vida da ponte. Devolve se a ponte está ligada e, por canal, o papel DESTA ponte. */
  async estado(p: PonteCtx, dto: any): Promise<{ ligada: boolean; canais: Record<CanalDaPonte, PapelNoCanal> }> {
    const plataformas: Record<string, { logado: boolean }> = {};
    for (const c of CANAIS) {
      const v = dto?.plataformas?.[c];
      if (v && typeof v === 'object') plataformas[c] = { logado: v.logado === true };
    }
    const versao = versaoInformada(dto?.versao);
    const maquina = texto(dto?.maquina, 80);
    await this.db.execute(sql`
      insert into chat_ponte (equipamento_id, tenant_id, unidade_id, plataformas, versao, maquina, visto_em, atualizado_em)
      values (${p.id}::uuid, ${p.tenantId}::uuid, ${p.unidadeId}::uuid, ${JSON.stringify(plataformas)}::jsonb,
              ${versao}, ${maquina}, now(), now())
      on conflict (equipamento_id) do update
         set tenant_id = excluded.tenant_id, unidade_id = excluded.unidade_id, plataformas = excluded.plataformas,
             versao = excluded.versao, maquina = excluded.maquina, visto_em = now(), atualizado_em = now()`);
    const ligada = await this.ligada(p.tenantId);
    const canais = {} as Record<CanalDaPonte, PapelNoCanal>;
    for (const c of CANAIS) {
      if (!plataformas[c]?.logado) canais[c] = 'fora';
      else canais[c] = (await this.quemRespondePeloCanal(p.tenantId, p.unidadeId, c)) === p.id ? 'responde' : 'reserva';
    }
    return { ligada, canais };
  }

  /**
   * As mensagens que a ponte leu no chat. Entram de uma vez (uma consulta, set-based) e uma vez só: a mesma mensagem da
   * plataforma (canal + id dela) não entra de novo — a ponte reenvia o que não teve resposta, e duas pontes leem o mesmo
   * chat. O pedido é achado pelo id na plataforma ou, sem ele, pelo número exibido (dos últimos 2 dias).
   * Etapa 2: a mensagem NOVA do cliente abre ou soma o caso da conversa na fila do Atendimento (`casos-do-chat.ts`), na
   * mesma transação — mensagem e caso entram juntos ou nada entra (a ponte reenvia e a conta fecha). A tela é avisada
   * depois do commit.
   * Etapa 3: com "o robô responde no chat" ligado, o robô decide cada conversa ANTES (`robo-do-chat.ts`): responde o
   * "cadê meu pedido?" (sem caso), não faz nada no agradecimento, fica quieto com o caso aberto, e chama a equipe no
   * resto (o caso nasce com o resumo dele e o cliente recebe "já chamei a equipe" uma vez).
   */
  async receber(
    p: PonteCtx,
    dto: any,
  ): Promise<{
    recebidas: number;
    repetidas: number;
    recusadas: number;
    casosNovos?: number;
    casosSomados?: number;
    roboRespondeu?: number;
    desligada?: true;
  }> {
    const lista: any[] = Array.isArray(dto?.mensagens) ? dto.mensagens : [];
    if (lista.length > LOTE_ENTRADA) throw new BadRequestException(`No máximo ${LOTE_ENTRADA} mensagens por vez.`);
    // Desligada nos ajustes: o chat fica só no Gestor de cada plataforma — nada de conversa de cliente gravada aqui. A
    // resposta avisa a ponte (ela para de mandar e esvazia a fila dela).
    const ajustes = await this.ajustesDoChat(p.tenantId);
    if (!ajustes.ligada) return { recebidas: 0, repetidas: 0, recusadas: 0, desligada: true };
    const validas: any[] = [];
    let recusadas = 0;
    for (const m of lista) {
      const canal = m?.canal;
      const id = texto(m?.id, 120);
      const corpo = typeof m?.texto === 'string' ? m.texto.slice(0, 2000) : '';
      const autor = m?.autor === 'cliente' || m?.autor === 'loja' ? m.autor : null;
      if (!ehCanalDaPonte(canal) || !id || !corpo.trim() || !autor) {
        recusadas += 1;
        continue;
      }
      validas.push({
        canal,
        ext: id,
        pedext: texto(m?.pedido?.externo, 120),
        pednum: texto(m?.pedido?.numero, 40),
        cliente: texto(m?.cliente, 120),
        autor,
        texto: corpo,
      });
    }
    if (!validas.length) return { recebidas: 0, repetidas: 0, recusadas };
    const { r, casos, respondeu } = await this.db.transaction(async (tx) => {
      const r = linhas(await tx.execute(sql`
      with entrada as (
        select * from jsonb_to_recordset(${JSON.stringify(validas)}::jsonb)
          as x(canal text, ext text, pedext text, pednum text, cliente text, autor text, texto text)
      ), ligada as (
        select e.*, (
          select pe.id from pedido_externo pe
           where pe.tenant_id = ${p.tenantId}::uuid and pe.canal = e.canal
             and pe.criado_em > now() - interval '2 days'
             and ((e.pedext is not null and pe.external_id = e.pedext)
               or (e.pedext is null and e.pednum is not null and pe.display_id = e.pednum))
           order by pe.criado_em desc
           limit 1) as pedido_id
          from entrada e
      )
      insert into chat_plataforma_msg
        (tenant_id, unidade_id, canal, pedido_id, pedido_externo, pedido_numero, cliente_nome, direcao, autor, texto,
         externo_msg_id, estado, ponte_id)
      select ${p.tenantId}::uuid,
             coalesce((select pe.unidade_id from pedido_externo pe where pe.id = l.pedido_id), ${p.unidadeId}::uuid),
             l.canal, l.pedido_id, l.pedext, l.pednum, l.cliente, 'entrada', l.autor, l.texto, l.ext, 'recebida',
             ${p.id}::uuid
        from ligada l
      on conflict (tenant_id, canal, externo_msg_id) where externo_msg_id is not null do nothing
      returning id, canal, autor, pedido_id as "pedidoId", pedido_externo as "pedidoExterno", pedido_numero as "pedidoNumero",
                cliente_nome as "cliente", unidade_id as "unidadeId", texto, criado_em as "criadoEm"`));
      const doCliente: MensagemDoCliente[] = r.filter((m) => m.autor === 'cliente');
      if (!ajustes.roboResponde) return { r, casos: await casosDoChat(tx, p.tenantId, doCliente), respondeu: null };
      const robo = await this.roboNoLote(tx, p.tenantId, doCliente);
      const paraCasos = doCliente.filter((m) => !robo.semCaso.has(chaveDoMapa({ canal: m.canal, chave: chaveDaConversa(m) ?? '' })));
      const casos = await casosDoChat(tx, p.tenantId, paraCasos, robo.chamar);
      // "Já chamei a equipe" — uma vez, no caso que o robô acabou de chamar.
      const chamados = casos.novos
        .filter((n) => robo.chamar.has(chaveDoMapa({ canal: n.canal, chave: n.detalhe?.chat?.chave })))
        .map((n) => ({
          canal: n.canal,
          pedido_id: n.pedido_id ?? null,
          pedido_externo: n.detalhe?.chat?.pedidoExterno ?? null,
          pedido_numero: n.detalhe?.chat?.pedidoNumero ?? null,
          cliente: n.cliente ?? null,
          unidade_id: n.unidade_id ?? null,
          texto: CHAMEI_A_EQUIPE,
        }));
      await this.enfileirarDoRobo(tx, p.tenantId, [...robo.respostas, ...chamados]);
      return { r, casos, respondeu: robo.respostas.length };
    });
    for (const chamado of casos.novos) this.events?.emit('atendimento.novo', { tenantId: p.tenantId, chamado });
    for (const id of casos.somados) this.events?.emit('atendimento.mudou', { tenantId: p.tenantId, id, motivo: 'cliente_escreveu_no_chat' });
    return {
      recebidas: r.length,
      repetidas: validas.length - r.length,
      recusadas,
      casosNovos: casos.novos.length,
      casosSomados: casos.somados.length,
      ...(respondeu === null ? {} : { roboRespondeu: respondeu }),
    };
  }

  /**
   * O ROBÔ no lote (Etapa 3), dentro da transação e com a trava da empresa — duas pontes trazendo falas do mesmo pedido
   * não fazem o robô responder duas vezes. Uma leitura para todas as conversas: caso aberto, quantas respostas o robô já
   * deu ao pedido na última hora e o pedido (situação, saída, quem entrega). A previsão só para quem o robô vai responder.
   */
  private async roboNoLote(
    tx: any,
    tenantId: string,
    msgs: MensagemDoCliente[],
  ): Promise<{ semCaso: Set<string>; chamar: Map<string, RoboNoCaso>; respostas: any[] }> {
    const semCaso = new Set<string>();
    const chamar = new Map<string, RoboNoCaso>();
    const respostas: any[] = [];
    const conversas = conversasDoLote(msgs);
    if (!conversas.length) return { semCaso, chamar, respostas };
    await tx.execute(sql`select 1 from robo_config where tenant_id = ${tenantId}::uuid for update`);
    const dados = linhas(
      await tx.execute(sql`
        with g as (
          select * from jsonb_to_recordset(${JSON.stringify(conversas.map((c) => ({ canal: c.canal, chave: c.chave, pedido_id: c.pedido_id, pedido_externo: c.pedido_externo })))}::jsonb)
            as x(canal text, chave text, pedido_id uuid, pedido_externo text)
        )
        select g.canal, g.chave,
               exists (select 1 from atendimento_chamado a
                        where a.tenant_id = ${tenantId}::uuid and a.tipo = 'chat' and a.status = 'aberto'
                          and a.canal = g.canal and a.detalhe #>> '{chat,chave}' = g.chave) as "casoAberto",
               (select count(*)::int from chat_plataforma_msg m
                 where m.tenant_id = ${tenantId}::uuid and m.canal = g.canal and m.direcao = 'saida' and m.autor = 'robo'
                   and m.texto <> ${CHAMEI_A_EQUIPE} and m.criado_em > now() - interval '1 hour'
                   and ((g.pedido_id is not null and m.pedido_id = g.pedido_id)
                     or (g.pedido_externo is not null and m.pedido_externo = g.pedido_externo))) as "respostasNaHora",
               pe.id as "pedidoId", pe.status, pe.despachado_em as "despachadoEm", pe.cliente_nome as "clienteDoPedido",
               pe.tipo, pe.canal as "canalDoPedido", pe.raw
          from g
          left join pedido_externo pe on pe.tenant_id = ${tenantId}::uuid and pe.id = g.pedido_id`),
    );
    const porChave = new Map(dados.map((d) => [chaveDoMapa(d), d]));
    for (const c of conversas) {
      const k = chaveDoMapa(c);
      const d = porChave.get(k);
      const canal = c.canal as 'ifood' | '99food';
      const pedido = d?.pedidoId
        ? { status: String(d.status ?? ''), despachadoEm: d.despachadoEm ?? null, modo: modoEntrega({ tipo: d.tipo, canal: d.canalDoPedido, raw: d.raw }), cliente: d.clienteDoPedido ?? c.cliente, canal }
        : null;
      const intencao = intencaoDoCliente(c.texto);
      // A previsão é a mesma conta do aviso "saiu" (só quando ele pode responder e a loja entrega).
      const precisaDaHora = intencao === 'onde_esta' && !!pedido && pedido.modo !== 'logistica_canal' && pedido.modo !== 'retirada';
      const horaPrevista = precisaDaHora && this.delivery ? await this.delivery.horaPrevistaDoPedido(tenantId, d.pedidoId).catch(() => null) : null;
      const decisao = decidir({ intencao, casoAberto: d?.casoAberto === true, respostasNaHora: Number(d?.respostasNaHora ?? 0), pedido, horaPrevista, fala: c.texto, canal });
      if (decisao.acao === 'responder') {
        semCaso.add(k);
        respostas.push({ canal: c.canal, pedido_id: c.pedido_id, pedido_externo: c.pedido_externo, pedido_numero: c.pedido_numero, cliente: c.cliente, unidade_id: c.unidade_id, texto: decisao.texto });
      } else if (decisao.acao === 'nada') semCaso.add(k);
      else if (decisao.acao === 'chamar_equipe') chamar.set(k, { resumo: decisao.resumo, urgente: decisao.urgente });
      // 'quieto': segue para os casos (soma no caso aberto).
    }
    return { semCaso, chamar, respostas };
  }

  /** O que o robô diz entra na fila de saída (a ponte que responde pelo canal digita) — uma gravação para o lote todo. */
  private async enfileirarDoRobo(tx: any, tenantId: string, itens: any[]): Promise<void> {
    if (!itens.length) return;
    await tx.execute(sql`
      insert into chat_plataforma_msg
        (tenant_id, unidade_id, canal, pedido_id, pedido_externo, pedido_numero, cliente_nome, direcao, autor, texto, estado)
      select ${tenantId}::uuid, x.unidade_id, x.canal, x.pedido_id, x.pedido_externo, x.pedido_numero, x.cliente,
             'saida', 'robo', x.texto, 'pendente'
        from jsonb_to_recordset(${JSON.stringify(itens)}::jsonb)
          as x(canal text, pedido_id uuid, pedido_externo text, pedido_numero text, cliente text, unidade_id uuid, texto text)`);
  }

  /**
   * A vez na fila de saída de um canal. Só a ponte que RESPONDE pelo canal pega (as outras ouvem "reserva"); antes de
   * pegar, o que venceu o prazo volta para a fila (ou falha na 3ª vez) e o que passou de 30 min é cancelado.
   */
  async pegar(p: PonteCtx, dto: any): Promise<{ papel: PapelNoCanal | 'desligada'; itens: any[] }> {
    const canal = dto?.canal;
    if (!ehCanalDaPonte(canal)) throw new BadRequestException('Canal inválido: use "ifood" ou "99food".');
    if (!(await this.ligada(p.tenantId))) return { papel: 'desligada', itens: [] };
    const quem = await this.quemRespondePeloCanal(p.tenantId, p.unidadeId, canal);
    if (quem !== p.id) return { papel: quem ? 'reserva' : 'fora', itens: [] };
    const daLoja = sql`(m.unidade_id is null or ${p.unidadeId}::uuid is null or m.unidade_id = ${p.unidadeId}::uuid)`;
    await this.db.execute(sql`
      update chat_plataforma_msg m
         set estado = case when m.tentativas >= ${TENTATIVAS} then 'falhou' else 'pendente' end,
             erro = case when m.tentativas >= ${TENTATIVAS} then 'a ponte não confirmou o envio' else m.erro end,
             ponte_id = null, vence_em = null
       where m.tenant_id = ${p.tenantId}::uuid and m.canal = ${canal} and m.direcao = 'saida'
         and m.estado = 'enviando' and m.vence_em < now() and ${daLoja}`);
    await this.db.execute(sql`
      update chat_plataforma_msg m
         set estado = 'cancelada', erro = 'passou da hora: não saiu em 30 min'
       where m.tenant_id = ${p.tenantId}::uuid and m.canal = ${canal} and m.direcao = 'saida'
         and m.estado = 'pendente' and m.criado_em < now() - interval '30 minutes' and ${daLoja}`);
    const itens = linhas(await this.db.execute(sql`
      with alvo as (
        select m.id from chat_plataforma_msg m
         where m.tenant_id = ${p.tenantId}::uuid and m.canal = ${canal} and m.direcao = 'saida'
           and m.estado = 'pendente' and ${daLoja}
         order by m.criado_em
         limit ${LOTE_SAIDA}
         for update skip locked
      )
      update chat_plataforma_msg m
         set estado = 'enviando', ponte_id = ${p.id}::uuid, tentativas = m.tentativas + 1,
             vence_em = now() + make_interval(secs => ${PRAZO_ENVIO_S})
        from alvo
       where m.id = alvo.id
      returning m.id, m.canal, m.pedido_externo as "pedidoExterno", m.pedido_numero as "pedidoNumero",
                m.cliente_nome as "cliente", m.texto, m.motivo, m.criado_em as "criadoEm"`));
    itens.sort((a, b) => new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime());
    return { papel: 'responde', itens };
  }

  /**
   * O resultado de um envio. Enviada: guarda o id que a plataforma deu (se a ponte já tinha trazido o PRÓPRIO envio
   * como "mensagem da loja" — o eco —, o eco sai e fica o envio). Enviada vale mesmo depois do prazo — e também depois
   * de a nuvem ter dado a mensagem como falha ou cancelada (a ponte confirmou pelo eco: ela SAIU; o registro fica com a
   * verdade e nada a manda de novo). A mesma confirmação de novo não é erro (a ponte repete o que não teve resposta).
   * Não enviada: só a ponte que pegou; volta para a fila, ou falha (3ª vez ou falha definitiva, como o chat do pedido
   * já fechado).
   */
  async resultado(p: PonteCtx, id: string, dto: any): Promise<{ ok: true; estado: string }> {
    if (!/^[0-9a-f-]{36}$/i.test(String(id ?? ''))) throw new BadRequestException('Mensagem inválida.');
    const enviada = dto?.ok === true;
    const ext = texto(dto?.id, 120);
    const erro = texto(dto?.erro, 300);
    const definitivo = dto?.definitivo === true;
    const r = await this.db.transaction(async (tx) => {
      if (enviada && ext)
        await tx.execute(sql`
          delete from chat_plataforma_msg eco
           using chat_plataforma_msg envio
           where envio.id = ${id}::uuid and envio.tenant_id = ${p.tenantId}::uuid
             and eco.tenant_id = envio.tenant_id and eco.canal = envio.canal and eco.externo_msg_id = ${ext}
             and eco.direcao = 'entrada' and eco.autor = 'loja'`);
      return linhas(
        await tx.execute(
          enviada
            ? sql`
              update chat_plataforma_msg
                 set estado = 'enviada', enviado_em = now(), externo_msg_id = coalesce(${ext}, externo_msg_id),
                     erro = null, vence_em = null, ponte_id = ${p.id}::uuid
               where id = ${id}::uuid and tenant_id = ${p.tenantId}::uuid and direcao = 'saida'
                 and estado in ('enviando', 'pendente', 'falhou', 'cancelada')
              returning estado`
            : sql`
              update chat_plataforma_msg
                 set estado = case when ${definitivo} or tentativas >= ${TENTATIVAS} then 'falhou' else 'pendente' end,
                     erro = coalesce(${erro}, 'a ponte não conseguiu enviar'), vence_em = null, ponte_id = null
               where id = ${id}::uuid and tenant_id = ${p.tenantId}::uuid and direcao = 'saida'
                 and estado = 'enviando' and ponte_id = ${p.id}::uuid
              returning estado`,
        ),
      );
    });
    if (r.length) return { ok: true, estado: r[0].estado };
    // A confirmação repetida de um envio que já está como enviado: responde igual (idempotente), sem mexer em nada.
    if (enviada) {
      const [ja] = linhas(
        await this.db.execute(sql`
          select estado from chat_plataforma_msg
           where id = ${id}::uuid and tenant_id = ${p.tenantId}::uuid and direcao = 'saida' and estado = 'enviada'`),
      );
      if (ja) return { ok: true, estado: 'enviada' };
    }
    throw new ConflictException('Esta mensagem não está mais com esta ponte (já saiu, venceu o prazo ou foi cancelada).');
  }
}
