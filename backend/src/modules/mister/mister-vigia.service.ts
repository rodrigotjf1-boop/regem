import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { FUSO_SQL } from '../../common/fuso-sql';
import { ehServidorLocal } from '../../common/modo';
import { ModuloService } from '../modulo/modulo.service';
import { dentroDaJanelaDoWhatsapp } from './mister-avisos.regras';
import { MisterConversaConfigService } from './mister-conversa-config.service';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { acharPeloTrecho } from './mister-memoria';
import { MODELO_DO_AVISO } from './mister-modelos';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { pessoaVale } from './mister-vinculo.service';
import { PausaDoCanalService } from '../delivery/pausa-do-canal.service';
import {
  AlvoDoOlho,
  LEMBRETES_MAX,
  OLHOS_MAX,
  SITUACOES_FINAIS_DO_PEDIDO,
  canalDaReferencia,
  conferirTextoDoLembrete,
  estadoFinal,
  fimDaNoite,
  lerQuando,
  quandoNaConversa,
  referenciaDoPedido,
  textoDaMudanca,
  textoDoLembreteNaHora,
} from './mister-vigia';
import { horaNoFuso } from '../../common/data';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O "FICA DE OLHO" E O LEMBRETE (versão 4, fase M4d, mig 452). O padrão "heartbeat" do Hermes: a volta de cada minuto olha
// o que cada pessoa pediu e só fala quando muda.
//  • Pela conversa (as ferramentas `ficar_de_olho` e `lembrete`): só com o ajuste da empresa ligado (Mister › "Jeito e
//    memória", nasce desligado). Os tetos (3 e 10 ativos por pessoa) são conferidos e a linha gravada na MESMA transação,
//    com a trava da empresa (V98).
//  • A volta: o lembrete na hora (marca "feito" ANTES de mandar — no máximo uma vez); o pedido que mudou de situação (a
//    gravação condicional pelo estado de antes garante uma mensagem por mudança); o "fica de olho" que venceu às 06:00
//    sai calado. Empresa que desligou o ajuste ou o módulo: os ativos dela são cancelados.
//  • A entrega: pelo número do Mister ao telefone da pessoa; fora das 24 horas, o modelo aprovado ("Ver o que fazer") e o
//    toque traz o texto. O resultado fica na linha (nunca o telefone).

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';
const TRAVA_DO_VIGIA = 452;
const MODULO = 'mister';

/** Quem pede pela conversa: a pessoa e a empresa (o servidor decide — nunca o modelo). */
export type QuemPedeVigia = { tenantId: string; colaboradorId: string };
type Resultado<T> = ({ ok: true } & T) | { ok: false; erro: string };

/** Um "fica de olho" ativo com a situação de agora do alvo (`agora` null = não li nesta volta). */
type Olhado = { id: string; tenantId: string; colaboradorId: string; alvo: AlvoDoOlho; rotulo: string; estado: string | null; sumiu: boolean; agora: string | null; hora: string | null };

export interface ResultadoDaVoltaDoVigia {
  lembretes: number;
  mudancas: number;
  vencidos: number;
  cancelados: number;
}

@Injectable()
export class MisterVigiaService implements OnModuleInit {
  private readonly logger = new Logger('MisterVigia');
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly numero: MisterNumeroService,
    private readonly modulos: ModuloService,
    private readonly conversa: MisterConversaConfigService,
    @Optional() private readonly entrada?: MisterEntradaService,
    // M4d parte 2: o canal pausado é lido pela MESMA regra do "Pausar" do Delivery. Sem ele, o canal não é olhado.
    @Optional() private readonly pausa?: PausaDoCanalService,
  ) {}

  /** O toque em "Ver o que fazer" (fora das 24 horas) chega pela entrada do WhatsApp: ela chama este serviço. */
  onModuleInit(): void {
    this.entrada?.registrarToque('vigia', (id, quem) => this.mostrarPeloToque(id, quem));
  }

  /** O ajuste da empresa está ligado? Sem a 452 (ou sem a linha), desligado. */
  async ligado(tenantId: string): Promise<boolean> {
    return (await this.conversa.daEmpresa(tenantId)).ficaDeOlho;
  }

  // ───────────────────────────── pela conversa ─────────────────────────────

  /** Fica de olho num pedido do canal (já achado e conferido pela ferramenta): avisa quando ele mudar de situação. */
  async olharPedido(q: QuemPedeVigia, pedido: { id: string; rotulo: string; status: string }, agora = new Date()): Promise<Resultado<{ rotulo: string; ate: string; jaEstava?: true }>> {
    if (SITUACOES_FINAIS_DO_PEDIDO.includes(pedido.status)) return { ok: false, erro: `O ${pedido.rotulo} já está ${pedido.status === 'cancelado' ? 'cancelado' : 'entregue'}: não há mais o que olhar.` };
    return this.olhar(q, { alvo: 'pedido', referencia: referenciaDoPedido(pedido.id), rotulo: pedido.rotulo, estado: pedido.status }, agora);
  }

  /**
   * Fica de olho em qualquer alvo já achado e conferido pela ferramenta (o pedido, o caixa aberto, a impressora parada, o
   * canal pausado), até as 06:00 da loja. O mesmo alvo duas vezes = uma linha; o teto de 3 com a trava da empresa.
   */
  async olhar(q: QuemPedeVigia, a: { alvo: AlvoDoOlho; referencia: string; rotulo: string; estado: string }, agora = new Date()): Promise<Resultado<{ rotulo: string; ate: string; jaEstava?: true }>> {
    const ate = fimDaNoite(agora);
    const { referencia } = a;
    const pedido = { rotulo: a.rotulo, status: a.estado };
    try {
      return await this.db.transaction(async (tx: any) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${q.tenantId}), ${TRAVA_DO_VIGIA})`);
        const ativos = await this.ativosDaPessoa(tx, q, 'olho');
        if (ativos.some((a) => a.referencia === referencia)) return { ok: true as const, rotulo: pedido.rotulo, ate: '06:00', jaEstava: true as const };
        if (ativos.length >= OLHOS_MAX)
          return { ok: false as const, erro: `Você já tem ${OLHOS_MAX} "fica de olho" ativos (${ativos.map((a) => a.rotulo).join('; ')}). Diga qual parar.` };
        await tx.execute(sql`
          insert into mister_vigia (tenant_id, colaborador_id, tipo, alvo, referencia, rotulo, estado, quando)
          values (${q.tenantId}::uuid, ${q.colaboradorId}::uuid, 'olho', ${a.alvo}, ${referencia}, ${pedido.rotulo.slice(0, 200)}, ${pedido.status}, ${ate.toISOString()}::timestamptz)`);
        return { ok: true as const, rotulo: pedido.rotulo, ate: '06:00' };
      });
    } catch (e: any) {
      if (semTabela(e)) return { ok: false, erro: 'O "fica de olho" ainda não está disponível.' };
      throw e;
    }
  }

  /** Um lembrete na hora marcada (o "quando" na hora da loja, até 30 dias). */
  async lembrar(q: QuemPedeVigia, texto: unknown, quandoPedido: unknown, agora = new Date()): Promise<Resultado<{ texto: string; quando: string }>> {
    const t = conferirTextoDoLembrete(texto);
    if ('erro' in t) return { ok: false, erro: t.erro };
    const w = lerQuando(quandoPedido, agora);
    if ('erro' in w) return { ok: false, erro: w.erro };
    try {
      return await this.db.transaction(async (tx: any) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${q.tenantId}), ${TRAVA_DO_VIGIA})`);
        const ativos = await this.ativosDaPessoa(tx, q, 'lembrete');
        if (ativos.length >= LEMBRETES_MAX) return { ok: false as const, erro: `Você já tem ${LEMBRETES_MAX} lembretes marcados. Cancele um para marcar outro.` };
        await tx.execute(sql`
          insert into mister_vigia (tenant_id, colaborador_id, tipo, rotulo, quando)
          values (${q.tenantId}::uuid, ${q.colaboradorId}::uuid, 'lembrete', ${t.texto}, ${w.quando.toISOString()}::timestamptz)`);
        return { ok: true as const, texto: t.texto, quando: quandoNaConversa(w.quando, agora) };
      });
    } catch (e: any) {
      if (semTabela(e)) return { ok: false, erro: 'O lembrete ainda não está disponível.' };
      throw e;
    }
  }

  /** O que a pessoa tem marcado agora (os dois tipos, ou um). */
  async listar(q: QuemPedeVigia, tipo?: 'olho' | 'lembrete', agora = new Date()): Promise<{ tipo: string; rotulo: string; quando: string }[]> {
    try {
      const ativos = await this.ativosDaPessoa(this.db, q, tipo);
      return ativos.map((a) => ({ tipo: a.tipo === 'olho' ? 'fica de olho' : 'lembrete', rotulo: a.rotulo, quando: a.tipo === 'olho' ? 'até as 06:00' : quandoNaConversa(new Date(a.quando), agora) }));
    } catch (e: any) {
      if (semTabela(e)) return [];
      throw e;
    }
  }

  /** Para (cancela) um "fica de olho" ou um lembrete da pessoa, pelo trecho do que está marcado. */
  async cancelar(q: QuemPedeVigia, tipo: 'olho' | 'lembrete', trecho: unknown): Promise<Resultado<{ rotulo: string }>> {
    try {
      const ativos = await this.ativosDaPessoa(this.db, q, tipo);
      const achado = acharPeloTrecho(ativos.map((a) => ({ ...a, texto: a.rotulo })), trecho);
      if ('erro' in achado) return { ok: false, erro: achado.erro.replace('anotado', 'marcado').replace('anotação', 'marcação') };
      const r = linhas(
        await this.db.execute(sql`
          update mister_vigia set situacao = 'cancelado', resultado = 'cancelado pela pessoa', atualizado_em = clock_timestamp()
           where id = ${achado.id}::uuid and tenant_id = ${q.tenantId}::uuid and colaborador_id = ${q.colaboradorId}::uuid and situacao = 'ativo'
           returning id`),
      );
      return r.length ? { ok: true, rotulo: achado.rotulo } : { ok: false, erro: 'Isso já não estava mais marcado.' };
    } catch (e: any) {
      if (semTabela(e)) return { ok: false, erro: 'Não há nada marcado.' };
      throw e;
    }
  }

  private async ativosDaPessoa(db: any, q: QuemPedeVigia, tipo?: 'olho' | 'lembrete') {
    return linhas(
      await db.execute(sql`
        select id::text as id, tipo, referencia, rotulo, to_char(quando at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as quando
          from mister_vigia
         where tenant_id = ${q.tenantId}::uuid and colaborador_id = ${q.colaboradorId}::uuid and situacao = 'ativo'
           ${tipo ? sql`and tipo = ${tipo}` : sql``}
         order by quando, criado_em`),
    ) as { id: string; tipo: string; referencia: string | null; rotulo: string; quando: string }[];
  }

  // ───────────────────────────── a volta de cada minuto ─────────────────────────────

  @Cron(CronExpression.EVERY_MINUTE)
  async rotina(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      await this.volta();
    } catch (e: any) {
      if (!semTabela(e)) this.logger.error(`a volta do "fica de olho" falhou — ${e?.message ?? e}`, e?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /** Uma volta: vence os olhos passados das 06:00, manda os lembretes da hora e as mudanças dos pedidos olhados. */
  async volta(agora = new Date(), soEmpresas?: string[]): Promise<ResultadoDaVoltaDoVigia> {
    const res: ResultadoDaVoltaDoVigia = { lembretes: 0, mudancas: 0, vencidos: 0, cancelados: 0 };
    const so = soEmpresas?.length ? sql`and v.tenant_id in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;
    const instante = sql`${agora.toISOString()}::timestamptz`;

    // 1) O "fica de olho" que passou das 06:00 sai calado.
    res.vencidos = linhas(
      await this.db.execute(sql`
        update mister_vigia v set situacao = 'vencido', atualizado_em = clock_timestamp()
         where v.situacao = 'ativo' and v.tipo = 'olho' and v.quando <= ${instante} ${so}
         returning v.id`),
    ).length;

    // A empresa que desligou o ajuste ou o módulo: os ativos dela são cancelados (uma leitura por empresa nesta volta).
    const vale = new Map<string, boolean>();
    const empresaVale = async (tenantId: string) => {
      if (!vale.has(tenantId))
        vale.set(tenantId, (await this.ligado(tenantId).catch(() => false)) && (await this.modulos.ativo(tenantId, null, MODULO).catch(() => false)));
      return vale.get(tenantId)!;
    };
    const cancelarDesligado = async (id: string) => {
      const r = linhas(await this.db.execute(sql`update mister_vigia set situacao = 'cancelado', resultado = 'desligado', atualizado_em = clock_timestamp() where id = ${id}::uuid and situacao = 'ativo' returning id`));
      res.cancelados += r.length;
    };

    // 2) Os lembretes da hora: marca "feito" ANTES de mandar (no máximo uma vez, mesmo com duas voltas ao mesmo tempo).
    const devidos = linhas(
      await this.db.execute(sql`
        select v.id::text as id, v.tenant_id::text as "tenantId", v.colaborador_id::text as "colaboradorId", v.rotulo
          from mister_vigia v
         where v.situacao = 'ativo' and v.tipo = 'lembrete' and v.quando <= ${instante} ${so}
         order by v.quando
         limit 100`),
    );
    for (const l of devidos) {
      if (!(await empresaVale(l.tenantId))) {
        await cancelarDesligado(l.id);
        continue;
      }
      const meu = linhas(await this.db.execute(sql`update mister_vigia set situacao = 'feito', avisado_em = clock_timestamp(), atualizado_em = clock_timestamp() where id = ${l.id}::uuid and situacao = 'ativo' returning id`));
      if (!meu.length) continue;
      await this.entregar(l, textoDoLembreteNaHora(String(l.rotulo)), `lembrete: ${l.rotulo}`, agora);
      res.lembretes++;
    }

    // 3) O que está sendo olhado (o pedido, o caixa, a impressora, o canal): a situação de agora contra a última vista.
    const olhados: Olhado[] = [...(await this.pedidosOlhados(so)), ...(await this.caixasOlhados(so)), ...(await this.impressorasOlhadas(so)), ...(await this.canaisOlhados(so, agora))];
    for (const l of olhados) {
      if (!(await empresaVale(l.tenantId))) {
        await cancelarDesligado(l.id);
        continue;
      }
      if (l.sumiu) {
        const r = linhas(await this.db.execute(sql`update mister_vigia set situacao = 'cancelado', resultado = 'o que estava sendo olhado não existe mais', atualizado_em = clock_timestamp() where id = ${l.id}::uuid and situacao = 'ativo' returning id`));
        res.cancelados += r.length;
        continue;
      }
      // Não li agora (o canal sem a leitura da pausa): fica para a próxima volta — nunca "mudou" por falta de leitura.
      if (l.agora === null || l.agora === String(l.estado ?? '')) continue;
      const final = estadoFinal(l.alvo, l.agora);
      // Gravação condicional pelo estado de antes: duas voltas ao mesmo tempo mandam UMA mensagem por mudança.
      const meu = linhas(
        await this.db.execute(sql`
          update mister_vigia set estado = ${l.agora}, situacao = ${final ? 'feito' : 'ativo'}, avisado_em = clock_timestamp(), atualizado_em = clock_timestamp()
           where id = ${l.id}::uuid and situacao = 'ativo' and estado is not distinct from ${l.estado ?? null}
           returning id`),
      );
      if (!meu.length) continue;
      await this.entregar(l, textoDaMudanca(l.alvo, String(l.rotulo), l.agora, l.hora), `o ${l.rotulo} mudou`, agora);
      res.mudancas++;
    }
    return res;
  }

  // ── a situação de agora de cada alvo (o `case` só converte a referência bem formada) ──

  private async pedidosOlhados(so: ReturnType<typeof sql>): Promise<Olhado[]> {
    return linhas(
      await this.db.execute(sql`
        select v.id::text as id, v.tenant_id::text as "tenantId", v.colaborador_id::text as "colaboradorId", v.rotulo, v.estado,
               (pe.id is null or pe.deleted_at is not null) as sumiu, pe.status as agora,
               to_char(case pe.status
                         when 'confirmado' then pe.confirmado_em when 'pronto' then pe.pronto_em when 'despachado' then pe.despachado_em
                         when 'entregue' then pe.entregue_em when 'concluido' then pe.concluido_em when 'cancelado' then pe.cancelado_em
                       end at time zone ${FUSO_SQL}, 'HH24:MI') as hora
          from mister_vigia v
          left join pedido_externo pe
            on pe.tenant_id = v.tenant_id
           and pe.id = case when v.referencia ~ '^pe:[0-9a-fA-F-]{36}$' then substring(v.referencia from 4)::uuid end
         where v.situacao = 'ativo' and v.tipo = 'olho' and v.alvo = 'pedido' ${so}`),
    ).map((l) => ({ ...l, alvo: 'pedido' as const }));
  }

  /** O caixa aberto: olha até fechar. */
  private async caixasOlhados(so: ReturnType<typeof sql>): Promise<Olhado[]> {
    return linhas(
      await this.db.execute(sql`
        select v.id::text as id, v.tenant_id::text as "tenantId", v.colaborador_id::text as "colaboradorId", v.rotulo, v.estado,
               s.id is null as sumiu, s.status as agora, to_char(s.fechada_em at time zone ${FUSO_SQL}, 'HH24:MI') as hora
          from mister_vigia v
          left join caixa_sessao s
            on s.tenant_id = v.tenant_id
           and s.id = case when v.referencia ~ '^cx:[0-9a-fA-F-]{36}$' then substring(v.referencia from 4)::uuid end
         where v.situacao = 'ativo' and v.tipo = 'olho' and v.alvo = 'caixa' ${so}`),
    ).map((l) => ({ ...l, alvo: 'caixa' as const }));
  }

  /**
   * A impressora parada (o incidente do vigia): olha até voltar a responder. Banco sem a tabela do vigia (414, só nuvem):
   * nenhuma — a falta dela não pode parar a volta dos outros alvos (V37).
   */
  private async impressorasOlhadas(so: ReturnType<typeof sql>): Promise<Olhado[]> {
    try {
      return linhas(
        await this.db.execute(sql`
          select v.id::text as id, v.tenant_id::text as "tenantId", v.colaborador_id::text as "colaboradorId", v.rotulo, v.estado,
                 i.id is null as sumiu, i.situacao as agora, to_char(i.fechado_em at time zone ${FUSO_SQL}, 'HH24:MI') as hora
            from mister_vigia v
            left join vigia_incidente i
              on i.tenant_id = v.tenant_id
             and i.id = case when v.referencia ~ '^vi:[0-9a-fA-F-]{36}$' then substring(v.referencia from 4)::uuid end
           where v.situacao = 'ativo' and v.tipo = 'olho' and v.alvo = 'impressora' ${so}`),
      ).map((l) => ({ ...l, alvo: 'impressora' as const }));
    } catch (e: any) {
      if (semTabela(e)) return [];
      throw e;
    }
  }

  /** O canal pausado: pela MESMA regra do "Pausar" do Delivery (uma leitura por empresa e loja nesta volta). */
  private async canaisOlhados(so: ReturnType<typeof sql>, agora: Date): Promise<Olhado[]> {
    const rows = linhas(
      await this.db.execute(sql`
        select v.id::text as id, v.tenant_id::text as "tenantId", v.colaborador_id::text as "colaboradorId", v.rotulo, v.estado, v.referencia
          from mister_vigia v
         where v.situacao = 'ativo' and v.tipo = 'olho' and v.alvo = 'canal' ${so}`),
    );
    const lidos = new Map<string, any>();
    const fora: Olhado[] = [];
    for (const l of rows) {
      const ref = canalDaReferencia(l.referencia);
      if (!ref) {
        fora.push({ ...l, alvo: 'canal', sumiu: true, agora: null, hora: null });
        continue;
      }
      const chave = `${l.tenantId}:${ref.unidadeId ?? 'rede'}`;
      if (!lidos.has(chave)) lidos.set(chave, this.pausa ? await this.pausa.estado(l.tenantId, ref.unidadeId, agora).catch(() => null) : null);
      const estado = lidos.get(chave);
      const agoraDoCanal = estado ? (estado.canais?.find((c: any) => c.canal === ref.canal)?.pausa ? 'pausado' : 'aberto') : null;
      fora.push({ ...l, alvo: 'canal', sumiu: false, agora: agoraDoCanal, hora: agoraDoCanal ? horaNoFuso(agora) : null });
    }
    return fora;
  }

  /**
   * Manda à pessoa (pelo número do Mister): dentro das 24 horas, o texto; fora, o modelo aprovado com "Ver o que fazer".
   * O resultado fica na linha — nunca o telefone. Não lança.
   */
  private async entregar(v: { id: string; tenantId: string; colaboradorId: string }, texto: string, assunto: string, agora: Date): Promise<void> {
    let resultado: string;
    try {
      const [l] = linhas(
        await this.db.execute(sql`
          select g.telefone, g.ultima_entrada_em as "ultimaEntrada", emp.nome as empresa
            from mister_vinculo g
            join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id
            left join funcao f on f.id = c.funcao_id
            left join perfil_acesso p on p.id = c.perfil_acesso_id
            join empresa emp on emp.id = g.tenant_id
           where g.tenant_id = ${v.tenantId}::uuid and g.colaborador_id = ${v.colaboradorId}::uuid
             and g.ligado_em is not null and g.telefone is not null and g.pausado_em is null and ${pessoaVale()}`),
      );
      if (!l) resultado = 'sem o WhatsApp ligado';
      else if ((await this.numero.semJanela()) || dentroDaJanelaDoWhatsapp(l.ultimaEntrada ? new Date(l.ultimaEntrada) : null, agora.getTime())) {
        await this.numero.enviar(String(l.telefone), { texto });
        resultado = 'enviado';
      } else {
        await this.numero.enviarModelo(String(l.telefone), MODELO_DO_AVISO, [String(l.empresa ?? '').slice(0, 60), assunto.slice(0, 120)], { tipo: 'vigia', id: v.id });
        resultado = 'modelo';
      }
    } catch (e: any) {
      resultado = `falhou: ${e instanceof FalhaDoEnvioDoMister ? e.motivo : 'erro'}`;
      this.logger.warn(`vigia ${v.id}: a entrega falhou — ${e?.message ?? e}`);
    }
    await this.db.execute(sql`update mister_vigia set resultado = ${resultado} where id = ${v.id}::uuid`);
  }

  /**
   * O toque em "Ver o que fazer": o lembrete ou a mudança saiu pelo modelo, fora das 24 horas. Só mostra a quem a marcação
   * é (a pessoa e a empresa de um dos vínculos deste telefone) e só o que saiu pelo modelo.
   */
  async mostrarPeloToque(id: string, quem: QuemTocou): Promise<boolean> {
    const [v] = linhas(
      await this.db.execute(sql`
        select tipo, alvo, rotulo, estado, tenant_id::text as "tenantId", colaborador_id::text as "colaboradorId", resultado
          from mister_vigia where id = ${id}::uuid`),
    );
    if (!v || v.resultado !== 'modelo') return false;
    if (!quem.vinculos.some((x) => x.tenantId === v.tenantId && x.colaboradorId === v.colaboradorId)) return false;
    const texto = v.tipo === 'lembrete' ? textoDoLembreteNaHora(String(v.rotulo)) : textoDaMudanca(String(v.alvo), String(v.rotulo), String(v.estado ?? ''), null);
    await this.numero.enviar(quem.telefone, { texto });
    return true;
  }
}
