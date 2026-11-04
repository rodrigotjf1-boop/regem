import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { versaoInformada } from '../equipamento/presenca.service';
import { CANAIS, CanalDaPonte, PonteCandidata, ehCanalDaPonte, quemResponde, VIVA_POR_MS } from './lideranca';
import type { PonteCtx } from './ponte-chat.guard';

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
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** A ponte está ligada nos ajustes da empresa? Sem linha em robo_config = desligada (nasce desligada). */
  async ligada(tenantId: string): Promise<boolean> {
    const r = linhas(await this.db.execute(sql`select chat_ponte_ligada from robo_config where tenant_id = ${tenantId}::uuid`));
    return r[0]?.chat_ponte_ligada === true;
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
   */
  async receber(p: PonteCtx, dto: any): Promise<{ recebidas: number; repetidas: number; recusadas: number }> {
    const lista: any[] = Array.isArray(dto?.mensagens) ? dto.mensagens : [];
    if (lista.length > LOTE_ENTRADA) throw new BadRequestException(`No máximo ${LOTE_ENTRADA} mensagens por vez.`);
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
    const r = linhas(await this.db.execute(sql`
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
      returning id`));
    return { recebidas: r.length, repetidas: validas.length - r.length, recusadas };
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
   * como "mensagem da loja" — o eco —, o eco sai e fica o envio). Enviada vale mesmo depois do prazo: marcar "enviada"
   * evita mandar de novo. Não enviada: só a ponte que pegou; volta para a fila, ou falha (3ª vez ou falha definitiva,
   * como o chat do pedido já fechado).
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
                 and estado in ('enviando', 'pendente')
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
    if (!r.length) throw new ConflictException('Esta mensagem não está mais com esta ponte (já saiu, venceu o prazo ou foi cancelada).');
    return { ok: true, estado: r[0].estado };
  }
}
