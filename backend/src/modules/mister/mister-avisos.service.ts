import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { EDGE_JANELA_MIN } from '../../common/edge-ativo';
import { uuidDeChave } from '../../common/id-deterministico';
import { ehServidorLocal } from '../../common/modo';
import { MAX_TENTATIVAS_CONSULTA_DA_NOTA } from '../fiscal/fiscal.service';
import { AlertaKdsService } from '../kds/alerta-kds.service';
import { ModuloService } from '../modulo/modulo.service';
import { PREPARO_DA_ENCOMENDA_MIN } from './mister-agente.regras';
import { FUSO_SQL } from '../../common/fuso-sql';
import { MisterAvisosConfigService } from './mister-avisos-config.service';
import {
  AVISOS_DA_DISTRIBUICAO,
  Destino,
  MARCOS_DO_CERTIFICADO,
  PEDIDO_PARADO_JANELA_H,
  SEGREDO_ABERTO_H,
  ehAvisoDaDistribuicao,
  situacaoDoSegredo,
  RegraDoAviso,
  TEMPOS_DO_PEDIDO_PARADO,
  Situacao,
  TipoDeAviso,
  dentroDaJanelaDoWhatsapp,
  deveEscalar,
  mudouDeMarco,
  situacaoDa99SemLogin,
  situacaoDaChave,
  situacaoDaNotaSemResposta,
  situacaoDoCaixa,
  situacaoDoCertificadoDaLoja,
  situacaoDoChatSemResposta,
  situacaoDoIfoodSemResposta,
  situacaoDoPedidoParado,
  situacaoDoVigia,
  textoDoAviso,
  textoDoDesfecho,
  textoDoLembrete,
} from './mister-avisos.regras';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { MODELO_DO_AVISO, parametrosDoAviso } from './mister-modelos';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { MisterPropostasService } from './mister-propostas.service';
import { pessoaVale } from './mister-vinculo.service';
import { ChatSemResposta, chatsDoIfoodSemResposta } from '../ponte-chat/chat-sem-resposta';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ROTINA DOS AVISOS DO MISTER (mig 419; F1.2 do `docs/plano-mister.md`; versão 2 do protótipo, aprovada em 14/11/2026).
//
// A cada minuto, só na NUVEM e só com `MISTER_AVISOS_LIGADOS=1` (nasce DESLIGADA — quem liga é o dono, no EasyPanel):
//  1. vê as situações de agora, de todas as empresas numa consulta por fonte: os incidentes abertos do vigia (impressora,
//     servidor sem sinal com pedido esperando, os técnicos), os caixas abertos há mais de 24 horas, a chave de IA parada e,
//     na parte 2 (fiscal), o certificado da nota perto de vencer e a nota que gastou todas as reconsultas;
//  2. aplica a regra de cada empresa (o que ela escolheu em Avisos e relatórios, ou o padrão aprovado) e o módulo Mister;
//  3. ABRE o episódio novo e entrega aos destinos; o que continua aberto e passou do tempo do "se ninguém resolver" ESCALA
//     (uma vez); o que sumiu FECHA e quem recebeu pelo WhatsApp recebe o desfecho.
//
// Entregas: WhatsApp do presidente e do gerente (pelo número do Mister; fora da janela de 24 horas da Meta, pelo modelo
// aprovado — F1.2d), KDS (o aviso do KDS, que desce da nuvem ao servidor da loja como o do Farol), caso urgente no
// Atendimento (fecha sozinho quando o aviso resolve), "Tela do Regem na loja" (a faixa e a gaveta de todos que estão
// logados na loja — `avisos-na-tela.service.ts`, F1.4, com o tempo real) e "Suporte da DMS" (o console da distribuição).
//
// Concorrência: quem abre é o índice único parcial (a réplica a mais cai no `on conflict` e não entrega); quem escala e
// quem fecha é a gravação condicional (`where escalado_em is null` / `where situacao = 'aberto'`) — só quem gravou entrega.
// Nada daqui lança para a rotina: cada falha vira log e a volta segue.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.code === '42703';
const MODULO = 'mister';
/** Pedido "esperando" para o aviso do servidor sem sinal: aceito ou por aceitar, das últimas 3 horas. */
const PEDIDO_ESPERANDO_H = 3;

export const avisosLigados = (): boolean => ['1', 'true'].includes(String(process.env.MISTER_AVISOS_LIGADOS ?? '').trim().toLowerCase());

/** `lembrou`: o aviso continua aberto e chegou a outro marco (o certificado a 30, 15, 7 dias…) — só pelo WhatsApp. */
export type Fase = 'abriu' | 'escalou' | 'lembrou' | 'resolveu';
export interface Entrega {
  destino: Destino;
  fase: Fase;
  em: string;
  ok: boolean;
  motivo?: string;
  /** Os 4 últimos dígitos de quem recebeu pelo WhatsApp (nunca o telefone inteiro). */
  final?: string;
  /** O caso aberto no Atendimento (para fechar junto). */
  casoId?: string;
  /** Saiu pelo modelo aprovado da Meta (fora da janela de 24 h): o texto inteiro vai quando a pessoa toca no botão. */
  via?: 'modelo';
}

interface AvisoAberto {
  id: string;
  tenantId: string;
  unidadeId: string | null;
  tipo: TipoDeAviso;
  chave: string;
  titulo: string;
  detalhe: string | null;
  abertoEm: Date;
  escaladoEm: Date | null;
  entregas: Entrega[];
  dados?: Record<string, unknown>;
}

export interface ResultadoDaVoltaDosAvisos {
  situacoes: number;
  abertos: number;
  escalados: number;
  lembrados: number;
  resolvidos: number;
  calados: number;
  entregas: number;
}

@Injectable()
export class MisterAvisosService implements OnModuleInit {
  private readonly logger = new Logger('MisterAvisos');
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly config: MisterAvisosConfigService,
    private readonly numero: MisterNumeroService,
    private readonly modulos: ModuloService,
    @Optional() private readonly kds?: AlertaKdsService,
    @Optional() private readonly events?: EventEmitter2,
    @Optional() private readonly entrada?: MisterEntradaService,
    // As propostas (F4.1, mig 428): o aviso que um procedimento do catálogo resolve vai ao presidente com "Autorizar".
    @Optional() private readonly propostas?: MisterPropostasService,
  ) {}

  /** O toque em "Ver o que fazer" chega pela entrada do WhatsApp, que mora no módulo de baixo: ela chama este serviço. */
  onModuleInit(): void {
    this.entrada?.registrarToque('aviso', (id, quem) => this.mostrarPeloToque(id, quem));
  }

  /**
   * O toque em "Ver o que fazer": o aviso saiu pelo modelo, fora das 24 horas, e agora a janela abriu. Só mostra a quem
   * recebeu:
   *  • o aviso é de uma empresa deste telefone;
   *  • a trilha tem a entrega pelo modelo para o final deste telefone;
   *  • a pessoa ainda recebe aquele aviso (presidente, ou gerente da loja dele).
   * Aberto, vai o texto inteiro com o que fazer; já resolvido, o desfecho. Devolve false quando não acha.
   */
  async mostrarPeloToque(id: string, quem: QuemTocou): Promise<boolean> {
    const empresas = quem.vinculos.map((v) => v.tenantId);
    if (!empresas.length) return false;
    const [a] = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", unidade_id::text as "unidadeId", tipo, chave, titulo, detalhe, situacao, entregas,
               aberto_em as "abertoEm", resolvido_em as "resolvidoEm"
          from mister_aviso
         where id = ${id}::uuid and tenant_id in (${sql.join(empresas.map((t) => sql`${t}::uuid`), sql`, `)})`),
    );
    if (!a) return false;
    const final = quem.telefone.slice(-4);
    const foi = ((a.entregas ?? []) as Entrega[]).some((e) => e.ok && e.via === 'modelo' && e.final === final);
    const v = quem.vinculos.find((x) => x.tenantId === a.tenantId);
    const recebe = !!v && (v.nivel === 'presidente' || !a.unidadeId || !v.unidadeId || v.unidadeId === a.unidadeId);
    if (!foi || !recebe) return false;
    const fim = a.resolvidoEm ? new Date(a.resolvidoEm).getTime() : Date.now();
    const texto =
      a.situacao === 'aberto' ? textoDoAviso(a) : textoDoDesfecho(a, Math.max(1, Math.round((fim - new Date(a.abertoEm).getTime()) / 60_000)));
    // A proposta (F4.1): o aviso ainda aberto vai ao presidente com a pergunta e os botões (a vencida sem resposta renova).
    const proposta = a.situacao === 'aberto' && v!.nivel === 'presidente' && this.propostas ? await this.propostas.propor(a) : null;
    try {
      await this.numero.enviar(quem.telefone, proposta ? { texto: `${texto}\n\n${proposta.pergunta}`, botoes: proposta.botoes } : { texto });
    } catch (e: any) {
      // Achou o aviso; o envio é que falhou. Fica no log com o motivo, e a entrada não diz "não achei".
      this.logger.warn(`o aviso ${a.id} não saiu no toque — ${e instanceof FalhaDoEnvioDoMister ? e.motivo : (e?.message ?? e)}`);
    }
    return true;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async rotina(): Promise<void> {
    if (ehServidorLocal() || !avisosLigados() || this.rodando) return;
    this.rodando = true;
    try {
      await this.volta();
    } catch (e: any) {
      if (!semTabela(e)) this.logger.error(`a volta dos avisos falhou — ${e?.message ?? e}`, e?.stack);
    } finally {
      this.rodando = false;
    }
  }

  // ───────────────────────────── as situações de agora ─────────────────────────────

  /** As situações de agora, de todas as empresas (ou só das pedidas, nos testes). Uma consulta por fonte. */
  async situacoes(soEmpresas?: string[], agora: Date = new Date()): Promise<Situacao[]> {
    const so = (col: string) =>
      soEmpresas?.length ? sql`and ${sql.raw(col)} in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;
    const fora: Situacao[] = [];

    // 1) O vigia. O servidor sem sinal só vira aviso com pedido esperando — e, depois de aberto, segue até o servidor voltar
    //    (senão o aviso "resolveria" quando os pedidos acabam, com o servidor ainda fora).
    const doVigia = await this.incidentesDoVigia(soEmpresas);
    for (const i of doVigia) {
      if (i.regra === 'servidor_sem_sinal' && !(Number(i.esperando) > 0) && !i.jaAberto) continue;
      const s = situacaoDoVigia({ ...i, evidencia: { ...(i.evidencia ?? {}), pedidosEsperando: i.esperando ?? null } }, String(i.loja ?? ''));
      if (s) fora.push(s);
    }

    // 2) O caixa aberto há mais de 24 horas.
    const caixas = linhas(
      await this.db.execute(sql`
        select s.id::text as id, s.tenant_id::text as "tenantId", s.unidade_id::text as "unidadeId", s.origem,
               floor(extract(epoch from (now() - s.aberta_em)) / 3600)::int as horas, col.nome as "abertoPor",
               coalesce(u.nome, emp.nome) as loja
          from caixa_sessao s
          join empresa emp on emp.id = s.tenant_id and emp.deleted_at is null
          left join unidade u on u.id = s.unidade_id and u.tenant_id = s.tenant_id
          left join colaborador col on col.id = s.aberta_por_id and col.tenant_id = s.tenant_id
         where s.status = 'aberta' and s.aberta_em < now() - interval '24 hours' ${so('s.tenant_id')}`),
    );
    for (const c of caixas) fora.push(situacaoDoCaixa({ ...c, horas: Number(c.horas) || 24, abertoPor: c.abertoPor ?? null }, String(c.loja ?? '')));

    // 3) A chave de IA da empresa parada (banco sem a 415: nada).
    try {
      const chaves = linhas(
        await this.db.execute(sql`
          select ic.tenant_id::text as "tenantId", ic.situacao from ia_credencial ic
            join empresa emp on emp.id = ic.tenant_id and emp.deleted_at is null
           where ic.situacao in ('sem_credito', 'teto_atingido', 'chave_recusada') ${so('ic.tenant_id')}`),
      );
      for (const k of chaves) {
        const s = situacaoDaChave(k);
        if (s) fora.push(s);
      }
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }

    // 3b) O segredo tirado da resposta do Mister nas últimas 24 horas (aviso SÓ da distribuição → suporte da DMS). Um por
    //     pergunta; fecha sozinho quando passa das 24 horas. Nunca o segredo: a hora e as consultas daquela resposta.
    try {
      const notas = sql`case when jsonb_typeof(p.conferencia) = 'array' then p.conferencia else '[]'::jsonb end`;
      const trilha = sql`case when jsonb_typeof(p.ferramentas) = 'array' then p.ferramentas else '[]'::jsonb end`;
      const segredos = linhas(
        await this.db.execute(sql`
          select p.id::text as id, p.tenant_id::text as "tenantId", to_char(p.criado_em at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as quando,
                 (select coalesce(jsonb_agg(distinct f ->> 'nome'), '[]'::jsonb) from jsonb_array_elements(${trilha}) f where (f ->> 'ok')::boolean) as consultas
            from mister_pergunta p
            join empresa emp on emp.id = p.tenant_id and emp.deleted_at is null
           where p.criado_em > now() - make_interval(hours => ${SEGREDO_ABERTO_H}::int) and ${notas} ? 'segredo' ${so('p.tenant_id')}
           order by p.criado_em desc
           limit 200`),
      );
      for (const s of segredos)
        fora.push(situacaoDoSegredo({ tenantId: s.tenantId, perguntaId: s.id, quando: String(s.quando), consultas: Array.isArray(s.consultas) ? s.consultas : [] }));
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }

    // 4) O certificado digital da nota perto de vencer, só onde a emissão está LIGADA. A mesma régua do fiscal: a
    //    configuração da loja (senão a da empresa — `configRaw`) e o certificado da loja (senão o da empresa —
    //    `obterCredencial`). O mesmo certificado em várias lojas vira um aviso só (a chave é a do certificado).
    const certificados = linhas(
      await this.db.execute(sql`
        with lojas as (
          select u.tenant_id, u.id as unidade_id from unidade u
            join empresa emp on emp.id = u.tenant_id and emp.deleted_at is null
           where u.deleted_at is null ${so('u.tenant_id')}
          union all
          select emp.id, null::uuid from empresa emp where emp.deleted_at is null ${so('emp.id')}
        )
        select distinct on (cred.id) l.tenant_id::text as "tenantId", cred.unidade_id::text as "unidadeId",
               cred.id::text as "credencialId", cred.cert_valido_ate as "validoAte", coalesce(uc.nome, emp.nome) as loja
          from lojas l
          join empresa emp on emp.id = l.tenant_id
          join lateral (
            select f.ativo from fiscal_config f
             where f.tenant_id = l.tenant_id and (f.unidade_id = l.unidade_id or f.unidade_id is null)
             order by (f.unidade_id is null) limit 1) cfg on cfg.ativo
          join lateral (
            select c.id, c.unidade_id, c.cert_valido_ate from fiscal_credencial c
             where c.tenant_id = l.tenant_id and (c.unidade_id is not distinct from l.unidade_id or c.unidade_id is null)
             order by (c.unidade_id is null) limit 1) cred on true
          left join unidade uc on uc.id = cred.unidade_id and uc.tenant_id = l.tenant_id
         where cred.cert_valido_ate is not null
           and cred.cert_valido_ate < now() + make_interval(days => ${MARCOS_DO_CERTIFICADO[0] + 1})
         order by cred.id`),
    );
    for (const c of certificados) {
      const s = situacaoDoCertificadoDaLoja({ ...c, unidadeId: c.unidadeId ?? null, validoAte: new Date(c.validoAte) }, String(c.loja ?? ''), agora);
      if (s) fora.push(s);
    }

    // 5) A nota fiscal que gastou todas as reconsultas (o MESMO número do fiscal) e segue sem resposta. O índice parcial das
    //    pendentes (`idx_nota_pendente_consulta`) faz a consulta ler só as pendentes.
    const notas = linhas(
      await this.db.execute(sql`
        select n.id::text as id, n.tenant_id::text as "tenantId", n.unidade_id::text as "unidadeId", n.numero, n.serie,
               n.tentativas_consulta as tentativas, n.emitida_em as "emitidaEm", coalesce(u.nome, emp.nome) as loja
          from nota_fiscal n
          join empresa emp on emp.id = n.tenant_id and emp.deleted_at is null
          left join unidade u on u.id = n.unidade_id and u.tenant_id = n.tenant_id
         where n.status = 'pendente' and coalesce(n.simulada, false) = false and n.chave is not null
           and n.tentativas_consulta >= ${MAX_TENTATIVAS_CONSULTA_DA_NOTA} ${so('n.tenant_id')}`),
    );
    for (const n of notas) {
      fora.push(
        situacaoDaNotaSemResposta(
          { ...n, unidadeId: n.unidadeId ?? null, numero: Number(n.numero), serie: Number(n.serie), tentativas: Number(n.tentativas), emitidaEm: n.emitidaEm ? new Date(n.emitidaEm) : null },
          String(n.loja ?? ''),
        ),
      );
    }

    // 6) O canal desconectado: o iFood sem responder à busca de pedidos (marcado pela própria busca — `IfoodService.anotarSaude`)
    //    e a 99 com o login recusado (o código que a 99 devolveu, gravado pelo serviço da 99). A tabela é pequena (uma linha
    //    por canal por empresa) e só da nuvem.
    const canais = linhas(
      await this.db.execute(sql`
        select i.id::text as "integracaoId", i.tenant_id::text as "tenantId", i.unidade_id::text as "unidadeId", i.canal,
               i.config ->> 'semRespostaDesde' as desde, i.config ->> 'semRespostaMotivo' as motivo,
               i.config ->> 'lastAuthErrno' as errno, coalesce(u.nome, emp.nome) as loja
          from integracao i
          join empresa emp on emp.id = i.tenant_id and emp.deleted_at is null
          left join unidade u on u.id = i.unidade_id and u.tenant_id = i.tenant_id
         where i.ativo and i.canal in ('ifood', '99food')
           and ((i.canal = 'ifood' and jsonb_exists(coalesce(i.config, '{}'::jsonb), 'semRespostaDesde'))
                or (i.canal = '99food' and i.config ->> 'lastAuthErrno' is not null)) ${so('i.tenant_id')}`),
    );
    for (const c of canais) {
      const base = { tenantId: c.tenantId, unidadeId: c.unidadeId ?? null, integracaoId: c.integracaoId };
      const s =
        c.canal === 'ifood'
          ? situacaoDoIfoodSemResposta({ ...base, desde: new Date(c.desde), motivo: c.motivo ?? null }, String(c.loja ?? ''), agora)
          : situacaoDa99SemLogin({ ...base, errno: Number(c.errno) }, String(c.loja ?? ''));
      if (s) fora.push(s);
    }

    // 6b) O CHAT do iFood sem ninguém respondendo: a ponte do chat ligada nos ajustes e nenhum PC respondendo pelo iFood (o
    //     Gestor da ponte caiu para o login, ou a ponte parou de dar sinal). Só ABRE com pedido do iFood em andamento — a
    //     ponte desligada de madrugada não incomoda ninguém — e, depois de aberto, segue até alguém voltar a responder
    //     (senão "resolveria" quando os pedidos acabam, com o chat ainda sem resposta).
    const chats = await this.chatsSemResposta(soEmpresas);
    if (chats.length) {
      const jaAbertos = new Set(
        linhas(
          await this.db.execute(sql`
            select a.tenant_id::text || '|' || a.chave as k from mister_aviso a
             where a.situacao = 'aberto' and a.chave like 'chat:ifood:%' ${so('a.tenant_id')}`),
        ).map((x) => String(x.k)),
      );
      for (const c of chats) {
        const s = situacaoDoChatSemResposta(c, c.loja);
        if (c.pedidos > 0 || jaAbertos.has(`${s.tenantId}|${s.chave}`)) fora.push(s);
      }
    }

    // 7) O pedido parado. Nasce DESLIGADO: só nas empresas que ligaram, com o tempo que escolheram.
    fora.push(...(await this.pedidosParados(so)));
    return fora;
  }

  /**
   * Os pedidos parados numa etapa além do tempo da empresa (`situacaoDoPedidoParado`). Duas leituras:
   *  1. ABRIR: nas empresas que ligaram, o pedido de até 6 horas parado além do tempo. O relógio de cada etapa: a chegada
   *     (novo), o aceite (confirmado), o pronto (entrega). A encomenda só começa a contar 30 min antes do horário, a mesma
   *     régua do KDS. Loja com servidor instalado e SEM SINAL não abre: lá quem anda os pedidos é o servidor, e a
   *     situação na nuvem está velha (o aviso "servidor sem sinal" já cuida). Banco sem a tabela dos servidores = sem servidor.
   *  2. CONTINUAR: o aviso já aberto segue enquanto o pedido estiver na MESMA etapa — mesmo com o servidor sem sinal, depois
   *     das 6 horas ou com o tipo desligado (aí a volta fecha calado). Assim ninguém recebe "✅ Resolvido" de um pedido que
   *     não andou: o aviso só resolve quando o pedido anda (ou é cancelado, concluído ou apagado). O título fica com o
   *     tempo com que o aviso abriu, mesmo que a empresa mude o tempo depois.
   */
  private async pedidosParados(so: (col: string) => ReturnType<typeof sql>): Promise<Situacao[]> {
    let lidos: any[];
    let continuam: any[];
    try {
      continuam = linhas(
        await this.db.execute(sql`
          select p.id::text as id, p.tenant_id::text as "tenantId", p.unidade_id::text as "unidadeId", p.canal, p.numero,
                 p.display_id as "displayId", p.status, coalesce((a.dados ->> 'parametro')::int, r.parametro) as parametro,
                 coalesce(u.nome, emp.nome) as loja
            from mister_aviso a
            join pedido_externo p on p.id = (a.dados ->> 'pedidoId')::uuid and p.tenant_id = a.tenant_id
                                 and p.status = a.dados ->> 'etapa' and p.deleted_at is null
            join empresa emp on emp.id = a.tenant_id and emp.deleted_at is null
            left join mister_aviso_regra r on r.tenant_id = a.tenant_id and r.tipo = 'pedido_parado'
            left join unidade u on u.id = p.unidade_id and u.tenant_id = p.tenant_id
           where a.tipo = 'pedido_parado' and a.situacao = 'aberto' ${so('a.tenant_id')}`),
      );
      lidos = linhas(
        await this.db.execute(sql`
          select p.id::text as id, p.tenant_id::text as "tenantId", p.unidade_id::text as "unidadeId", p.canal, p.numero,
                 p.display_id as "displayId", p.status, r.parametro, coalesce(u.nome, emp.nome) as loja
            from mister_aviso_regra r
            join empresa emp on emp.id = r.tenant_id and emp.deleted_at is null
            join pedido_externo p on p.tenant_id = r.tenant_id
            left join unidade u on u.id = p.unidade_id and u.tenant_id = p.tenant_id
           where r.tipo = 'pedido_parado' and r.ligado
             and r.parametro in (${sql.join(TEMPOS_DO_PEDIDO_PARADO.map((t) => sql`${t}`), sql`, `)})
             and p.deleted_at is null
             and p.criado_em > now() - make_interval(hours => ${PEDIDO_PARADO_JANELA_H})
             and (p.status in ('novo', 'confirmado') or (p.status = 'pronto' and p.tipo = 'entrega'))
             and greatest(
                   case p.status
                     when 'novo' then p.criado_em
                     when 'confirmado' then coalesce(p.confirmado_em, p.criado_em)
                     else coalesce(p.pronto_em, p.confirmado_em, p.criado_em)
                   end,
                   coalesce(p.agendamento - make_interval(mins => ${PREPARO_DA_ENCOMENDA_MIN}), '-infinity'::timestamptz)
                 ) < now() - make_interval(mins => r.parametro) ${so('r.tenant_id')}
           order by p.criado_em
           limit 500`),
      );
    } catch (e: any) {
      if (semTabela(e)) return [];
      throw e;
    }
    const fora: Situacao[] = [];
    const jaVistos = new Set<string>();
    for (const p of continuam) {
      const s = situacaoDoPedidoParado({ ...p, unidadeId: p.unidadeId ?? null, parametro: Number(p.parametro) || 20 }, String(p.loja ?? ''));
      jaVistos.add(s.chave);
      fora.push(s);
    }
    lidos = lidos.filter((p) => !jaVistos.has(`pedido:${p.id}:${p.status}`));
    if (!lidos.length) return fora;

    // Os servidores das empresas com pedido parado novo: a última batida de cada um.
    let servidores: Array<{ tenantId: string; unidadeId: string | null; vivo: boolean }> = [];
    try {
      const empresas = [...new Set(lidos.map((p) => p.tenantId as string))];
      servidores = linhas(
        await this.db.execute(sql`
          select tenant_id::text as "tenantId", unidade_id::text as "unidadeId",
                 max(recebido_em) >= now() - make_interval(mins => ${EDGE_JANELA_MIN}) as vivo
            from edge_status
           where tenant_id in (${sql.join(empresas.map((t) => sql`${t}::uuid`), sql`, `)})
           group by tenant_id, unidade_id`),
      ).map((s) => ({ tenantId: s.tenantId, unidadeId: s.unidadeId ?? null, vivo: s.vivo === true }));
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }
    for (const p of lidos) {
      const unidadeId = p.unidadeId ?? null;
      // O servidor que atende esta loja: o dela, o da empresa inteira (sem loja) ou, pedido sem loja, qualquer um da empresa.
      const daLoja = servidores.filter((s) => s.tenantId === p.tenantId && (!unidadeId || !s.unidadeId || s.unidadeId === unidadeId));
      if (daLoja.length && !daLoja.some((s) => s.vivo)) continue;
      fora.push(situacaoDoPedidoParado({ ...p, unidadeId, parametro: Number(p.parametro) }, String(p.loja ?? '')));
    }
    return fora;
  }

  /**
   * As lojas com o chat do iFood sem ninguém respondendo (`ponte-chat/chat-sem-resposta.ts`). Banco sem as tabelas da
   * ponte (mig 366) = nenhuma.
   */
  protected async chatsSemResposta(soEmpresas?: string[]): Promise<ChatSemResposta[]> {
    try {
      return await chatsDoIfoodSemResposta(this.db, soEmpresas);
    } catch (e: any) {
      if (semTabela(e)) return [];
      throw e;
    }
  }

  /**
   * Os incidentes ABERTOS do vigia (mig 414), com o nome da loja, os pedidos esperando (para o servidor sem sinal) e se o
   * aviso já está aberto. Banco sem a tabela do vigia = nenhum incidente.
   */
  protected async incidentesDoVigia(soEmpresas?: string[]): Promise<any[]> {
    const so = (col: string) =>
      soEmpresas?.length ? sql`and ${sql.raw(col)} in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;
    try {
      return linhas(
        await this.db.execute(sql`
      select i.tenant_id::text as "tenantId", i.unidade_id::text as "unidadeId", i.regra, i.chave, i.evidencia,
             coalesce(u.nome, emp.nome) as loja,
             case when i.regra = 'servidor_sem_sinal' then (
               select count(*)::int from pedido_externo pe
                where pe.tenant_id = i.tenant_id and pe.status in ('novo', 'confirmado')
                  and (i.unidade_id is null or pe.unidade_id = i.unidade_id or pe.unidade_id is null)
                  and pe.criado_em > now() - make_interval(hours => ${PEDIDO_ESPERANDO_H})) end as esperando,
             exists (select 1 from mister_aviso a where a.tenant_id = i.tenant_id and a.situacao = 'aberto'
                      and a.chave = 'vigia:' || i.regra || ':' || i.chave) as "jaAberto"
        from vigia_incidente i
        join empresa emp on emp.id = i.tenant_id and emp.deleted_at is null
        left join unidade u on u.id = i.unidade_id and u.tenant_id = i.tenant_id
       where i.situacao = 'aberto' ${so('i.tenant_id')}`),
      );
    } catch (e: any) {
      if (semTabela(e)) return [];
      throw e;
    }
  }

  // ───────────────────────────── a volta ─────────────────────────────

  /** Uma volta: abre, escala e fecha. Devolve o que fez (os testes conferem). */
  async volta(soEmpresas?: string[], agora: Date = new Date()): Promise<ResultadoDaVoltaDosAvisos> {
    const res: ResultadoDaVoltaDosAvisos = { situacoes: 0, abertos: 0, escalados: 0, lembrados: 0, resolvidos: 0, calados: 0, entregas: 0 };
    const todas = await this.situacoes(soEmpresas, agora);
    res.situacoes = todas.length;

    // O módulo Mister ligado (na loja do aviso) e o tipo ligado na regra da empresa.
    const regras = await this.config.regrasDe([...new Set(todas.map((s) => s.tenantId))]);
    const moduloLigado = new Map<string, boolean>();
    const vale = async (s: Situacao): Promise<RegraDoAviso | null> => {
      // O aviso só da distribuição (o segredo tirado): a regra fixa, que a empresa não muda nem desliga.
      if (ehAvisoDaDistribuicao(s.tipo)) return AVISOS_DA_DISTRIBUICAO[s.tipo];
      const k = `${s.tenantId}|${s.unidadeId ?? ''}`;
      if (!moduloLigado.has(k)) moduloLigado.set(k, await this.modulos.ativo(s.tenantId, s.unidadeId, MODULO).catch(() => false));
      const r = regras.get(s.tenantId)?.get(s.tipo);
      return moduloLigado.get(k) && r?.ligado ? r : null;
    };
    const valendo: { s: Situacao; r: RegraDoAviso }[] = [];
    const vistas = new Set<string>();
    for (const s of todas) {
      vistas.add(`${s.tenantId}|${s.tipo}|${s.chave}`);
      const r = await vale(s);
      if (r) valendo.push({ s, r });
    }
    const chaveDe = (a: { tenantId: string; tipo: string; chave: string }) => `${a.tenantId}|${a.tipo}|${a.chave}`;
    const valendoPorChave = new Map(valendo.map((v) => [chaveDe({ tenantId: v.s.tenantId, tipo: v.s.tipo, chave: v.s.chave }), v]));

    // 1) Abre o novo e renova o que continua (um comando para todos). Só quem ABRIU entrega. A renovação guarda o marco que
    //    estava (`marcoAnterior`, lido da linha ANTES da troca): marco novo num aviso aberto vira lembrete — e, como a linha
    //    fica travada na renovação, a réplica a mais já lê o marco novo e não lembra de novo.
    if (valendo.length) {
      const gravados = linhas(
        await this.db.execute(sql`
          insert into mister_aviso (tenant_id, unidade_id, tipo, chave, titulo, detalhe, dados)
          select x."tenantId", x."unidadeId", x.tipo, x.chave, x.titulo, x.detalhe, coalesce(x.dados, '{}'::jsonb)
            from jsonb_to_recordset(${JSON.stringify(valendo.map((v) => v.s))}::jsonb)
                 as x("tenantId" uuid, "unidadeId" uuid, tipo text, chave text, titulo text, detalhe text, dados jsonb)
          on conflict (tenant_id, tipo, chave) where situacao = 'aberto'
          do update set visto_em = clock_timestamp(), titulo = excluded.titulo, detalhe = excluded.detalhe,
                        -- A renovação guarda o marco anterior (o lembrete) e quem já deu "Ciente" na tela da loja (F1.4).
                        dados = excluded.dados || jsonb_build_object('marcoAnterior', mister_aviso.dados -> 'marco')
                                || case when mister_aviso.dados ? 'cientes' then jsonb_build_object('cientes', mister_aviso.dados -> 'cientes')
                                        else '{}'::jsonb end
          returning id::text as id, tenant_id::text as "tenantId", unidade_id::text as "unidadeId", tipo, chave, titulo, detalhe,
                    aberto_em as "abertoEm", escalado_em as "escaladoEm", entregas, dados, (xmax = 0) as novo`),
      ) as (AvisoAberto & { novo: boolean })[];
      for (const a of gravados) {
        const v = valendoPorChave.get(chaveDe(a));
        if (!v) continue;
        try {
          if (a.novo) {
            res.abertos++;
            res.entregas += await this.entregar(a, v.r.destinos, 'abriu', agora);
            continue;
          }
          if (mudouDeMarco(a.dados)) {
            res.lembrados++;
            res.entregas += await this.entregar(a, v.r.destinos, 'lembrou', agora);
          }
          if (deveEscalar({ abertoEm: new Date(a.abertoEm), escaladoEm: a.escaladoEm ? new Date(a.escaladoEm) : null }, v.r, agora.getTime())) {
            if (await this.marcarEscala(a.id)) {
              res.escalados++;
              res.entregas += await this.entregar(a, v.r.escalaPara, 'escalou', agora);
            }
          }
        } catch (e: any) {
          this.logger.error(`aviso ${a.id} (${a.tipo}): a entrega falhou — ${e?.message ?? e}`);
        }
      }
    }

    // 2) Fecha o que acabou. A situação sumiu = resolvido (com o desfecho a quem recebeu pelo WhatsApp); a situação continua
    //    mas o tipo ou o módulo foi desligado = fecha calado.
    const abertos = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", unidade_id::text as "unidadeId", tipo, chave, titulo, detalhe,
               aberto_em as "abertoEm", escalado_em as "escaladoEm", entregas
          from mister_aviso
         where situacao = 'aberto' ${soEmpresas?.length ? sql`and tenant_id in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``}`),
    ) as AvisoAberto[];
    for (const a of abertos) {
      if (valendoPorChave.has(chaveDe(a))) continue;
      const calado = vistas.has(chaveDe(a));
      try {
        const fechou = linhas(
          await this.db.execute(sql`
            update mister_aviso set situacao = 'resolvido', resolvido_em = clock_timestamp(),
                   dados = dados || jsonb_build_object('fechou', ${calado ? 'desligado' : 'resolvido'}::text)
             where id = ${a.id}::uuid and situacao = 'aberto' returning id`),
        );
        if (!fechou.length) continue;
        // Sumiu da tela da loja: as telas abertas relêem (o aviso some da faixa e da gaveta).
        if ((a.entregas ?? []).some((e) => e.destino === 'tela')) this.events?.emit('mister.avisos.mudou', { tenantId: a.tenantId });
        if (calado) res.calados++;
        else {
          res.resolvidos++;
          res.entregas += await this.desfecho(a, agora);
        }
        await this.fecharCasos(a);
      } catch (e: any) {
        this.logger.error(`aviso ${a.id} (${a.tipo}): o fechamento falhou — ${e?.message ?? e}`);
      }
    }
    return res;
  }

  /**
   * Marca a escala do aviso. Só UMA chamada ganha (a outra réplica não acha a linha sem `escalado_em`): só ela entrega. A
   * escala limpa os "Ciente" da tela da loja: a faixa volta para todos (decisão aprovada no protótipo da F1.4).
   */
  async marcarEscala(id: string): Promise<boolean> {
    const r = linhas(
      await this.db.execute(sql`
        update mister_aviso set escalado_em = clock_timestamp(), dados = coalesce(dados, '{}'::jsonb) - 'cientes'
         where id = ${id}::uuid and escalado_em is null and situacao = 'aberto' returning tenant_id::text as "tenantId", entregas`),
    );
    if (r[0] && (r[0].entregas ?? []).some((e: any) => e?.destino === 'tela')) this.events?.emit('mister.avisos.mudou', { tenantId: r[0].tenantId });
    return r.length > 0;
  }

  // ───────────────────────────── as entregas ─────────────────────────────

  /** Entrega o aviso aos destinos de uma fase e grava a trilha. Devolve quantas entregas saíram. */
  private async entregar(a: AvisoAberto, destinos: Destino[], fase: Fase, agora: Date): Promise<number> {
    const feitas: Entrega[] = [];
    const em = agora.toISOString();
    const texto =
      fase === 'escalou'
        ? `⏰ Sem solução há ${Math.max(1, Math.round((agora.getTime() - new Date(a.abertoEm).getTime()) / 60_000))} min. ${textoDoAviso(a)}`
        : fase === 'lembrou'
          ? textoDoLembrete(a)
          : textoDoAviso(a);

    // O WhatsApp: cada telefone recebe uma vez, mesmo que esteja em "presidente" e em "gerente".
    const pessoas = destinos.filter((d): d is 'presidente' | 'gerente' => d === 'presidente' || d === 'gerente');
    if (pessoas.length) feitas.push(...(await this.pelosWhatsapps(a, pessoas, texto, fase, em, agora)));

    // O lembrete é só pelo WhatsApp: o KDS, a tela e o Atendimento já mostram o aviso aberto.
    for (const d of fase === 'lembrou' ? [] : destinos) {
      if (d === 'kds') feitas.push(await this.noKds(a, fase, em));
      else if (d === 'atendimento' && fase === 'abriu') feitas.push(await this.noAtendimento(a, em));
      // A tela da loja e o suporte da DMS (F1.4) leem o aviso aberto pela trilha: a entrega é a linha na trilha. A tela
      // ainda recebe o aviso pelo tempo real (as telas abertas relêem na hora).
      else if (d === 'tela' || d === 'dms') feitas.push({ destino: d, fase, em, ok: true });
    }
    if (feitas.length) await this.db.execute(sql`update mister_aviso set entregas = entregas || ${JSON.stringify(feitas)}::jsonb where id = ${a.id}::uuid`);
    if (feitas.some((f) => f.destino === 'tela')) this.events?.emit('mister.avisos.mudou', { tenantId: a.tenantId });
    return feitas.filter((f) => f.ok).length;
  }

  /** Quem recebe pelo WhatsApp: os ligados que ainda valem e não pararam os avisos. Sem gerente ligado na loja, vai ao presidente. */
  private async pelosWhatsapps(a: AvisoAberto, papeis: ('presidente' | 'gerente')[], texto: string, fase: Fase, em: string, agora: Date): Promise<Entrega[]> {
    const ligados = linhas(
      await this.db.execute(sql`
        select g.telefone, g.ultima_entrada_em as "ultimaEntrada", coalesce(p.nivel, f.categoria::text) as nivel, c.unidade_id::text as "unidadeId",
               emp.nome as empresa
          from mister_vinculo g
          join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = g.tenant_id
         where g.tenant_id = ${a.tenantId}::uuid and g.ligado_em is not null and g.telefone is not null and g.pausado_em is null and ${pessoaVale()}`),
    );
    // O gerente da loja do aviso (sem loja no aviso: os gerentes da empresa; gerente sem loja vale para todas).
    const daLoja = (l: any) => !a.unidadeId || !l.unidadeId || l.unidadeId === a.unidadeId;
    const alvo = new Map<string, { destino: Destino; l: any; motivo?: string }>();
    for (const papel of papeis) {
      let quem = ligados.filter((l) => l.nivel === papel && (papel === 'presidente' || daLoja(l)));
      let motivo: string | undefined;
      if (papel === 'gerente' && !quem.length) {
        quem = ligados.filter((l) => l.nivel === 'presidente');
        motivo = 'sem_gerente_ligado_foi_ao_presidente';
      }
      if (!quem.length) alvo.set(`sem:${papel}`, { destino: papel, l: null, motivo: 'ninguem_ligado' });
      for (const l of quem) if (!alvo.has(l.telefone)) alvo.set(l.telefone, { destino: papel, l, motivo });
    }
    // A proposta (F4.1): nasce quando o aviso vai a quem pode autorizar — o presidente, até o perfil de permissões —, ao
    // abrir ou ao escalar (a vencida sem resposta renova). Só o presidente recebe a pergunta e os botões.
    const presidenteRecebe = [...alvo.values()].some((x) => x.l?.nivel === 'presidente');
    const proposta = presidenteRecebe && (fase === 'abriu' || fase === 'escalou') && this.propostas ? await this.propostas.propor(a) : null;
    const fora: Entrega[] = [];
    // Q1 (mig 436): pelo Evolution não há janela de 24 horas nem modelo — o texto inteiro vai sempre.
    const semJanela = await this.numero.semJanela();
    for (const { destino, l, motivo } of alvo.values()) {
      if (!l) {
        fora.push({ destino, fase, em, ok: false, motivo });
        continue;
      }
      const final = String(l.telefone).slice(-4);
      if (!semJanela && !dentroDaJanelaDoWhatsapp(l.ultimaEntrada ? new Date(l.ultimaEntrada) : null, agora.getTime())) {
        // Fora da janela, só o modelo aprovado chega: "Aviso do Mister para <loja>: <o quê>", com o botão "Ver o que
        // fazer". O toque abre a janela e traz o texto inteiro (`mostrarPeloToque`).
        try {
          await this.numero.enviarModelo(l.telefone, MODELO_DO_AVISO, parametrosDoAviso(a.titulo, String(l.empresa ?? '')), { tipo: 'aviso', id: a.id });
          fora.push({ destino, fase, em, ok: true, final, via: 'modelo', ...(motivo ? { motivo } : {}) });
        } catch (e: any) {
          const m = e instanceof FalhaDoEnvioDoMister ? e.motivo : 'erro';
          fora.push({ destino, fase, em, ok: false, final, motivo: m === 'modelo_nao_aprovado' ? 'fora_da_janela_e_sem_modelo' : m });
        }
        continue;
      }
      try {
        const comProposta = proposta && l.nivel === 'presidente';
        await this.numero.enviar(l.telefone, comProposta ? { texto: `${texto}\n\n${proposta.pergunta}`, botoes: proposta.botoes } : { texto });
        fora.push({ destino, fase, em, ok: true, final, ...(motivo ? { motivo } : {}) });
      } catch (e: any) {
        const m = e instanceof FalhaDoEnvioDoMister ? e.motivo : 'erro';
        fora.push({ destino, fase, em, ok: false, final, motivo: m });
      }
    }
    return fora;
  }

  /** O aviso no KDS da loja (o mesmo caminho do Farol: a linha desce ao servidor da loja). Uma vez por fase. */
  private async noKds(a: AvisoAberto, fase: Fase, em: string): Promise<Entrega> {
    if (!this.kds) return { destino: 'kds', fase, em, ok: false, motivo: 'sem_kds' };
    try {
      await this.kds.guardarEMostrar({
        tenantId: a.tenantId,
        unidadeId: a.unidadeId,
        id: uuidDeChave('mister-aviso', a.id, fase),
        titulo: a.titulo,
        detalhe: a.detalhe,
        prioridade: 'alta',
        tipo: 'gestao',
        fica: true,
        origem: 'Mister',
        ref: a.id,
        naLoja: true,
      });
      return { destino: 'kds', fase, em, ok: true };
    } catch (e: any) {
      return { destino: 'kds', fase, em, ok: false, motivo: String(e?.message ?? 'erro').slice(0, 120) };
    }
  }

  /** Um caso URGENTE no Atendimento (como o do estorno de Pix que falhou). Fecha sozinho quando o aviso resolve. */
  private async noAtendimento(a: AvisoAberto, em: string): Promise<Entrega> {
    try {
      const [caso] = linhas(
        await this.db.execute(sql`
          insert into atendimento_chamado (tenant_id, unidade_id, tipo, mensagem, prioridade)
          values (${a.tenantId}::uuid, ${a.unidadeId}::uuid, 'atendimento', ${`Aviso do Mister: ${a.titulo}.${a.detalhe ? ` ${a.detalhe}` : ''}`}, 'urgente')
          returning *`),
      );
      if (caso) this.events?.emit('atendimento.novo', { tenantId: a.tenantId, chamado: caso });
      return { destino: 'atendimento', fase: 'abriu', em, ok: !!caso, ...(caso ? { casoId: String(caso.id) } : {}) };
    } catch (e: any) {
      return { destino: 'atendimento', fase: 'abriu', em, ok: false, motivo: String(e?.message ?? 'erro').slice(0, 120) };
    }
  }

  /** O desfecho para quem recebeu pelo WhatsApp (de novo dentro da janela; fora dela, fica anotado). */
  private async desfecho(a: AvisoAberto, agora: Date): Promise<number> {
    // Quem recebeu pelo WhatsApp (o final do telefone → por qual destino recebeu).
    const receberam = new Map((a.entregas ?? []).filter((e) => e.ok && e.final && (e.destino === 'presidente' || e.destino === 'gerente')).map((e) => [e.final as string, e.destino]));
    if (!receberam.size) return 0;
    const minutos = Math.max(1, Math.round((agora.getTime() - new Date(a.abertoEm).getTime()) / 60_000));
    const texto = textoDoDesfecho(a, minutos);
    const ligados = linhas(
      await this.db.execute(sql`
        select telefone, ultima_entrada_em as "ultimaEntrada" from mister_vinculo
         where tenant_id = ${a.tenantId}::uuid and ligado_em is not null and telefone is not null and pausado_em is null`),
    );
    const feitas: Entrega[] = [];
    const em = agora.toISOString();
    const semJanela = await this.numero.semJanela(); // Q1: pelo Evolution, o desfecho vai sempre
    for (const l of ligados) {
      const final = String(l.telefone).slice(-4);
      if (!receberam.has(final)) continue;
      if (!semJanela && !dentroDaJanelaDoWhatsapp(l.ultimaEntrada ? new Date(l.ultimaEntrada) : null, agora.getTime())) {
        feitas.push({ destino: receberam.get(final)!, fase: 'resolveu', em, ok: false, final, motivo: 'fora_da_janela_de_24h' });
        continue;
      }
      try {
        await this.numero.enviar(l.telefone, { texto });
        feitas.push({ destino: receberam.get(final)!, fase: 'resolveu', em, ok: true, final });
      } catch (e: any) {
        feitas.push({ destino: receberam.get(final)!, fase: 'resolveu', em, ok: false, final, motivo: e instanceof FalhaDoEnvioDoMister ? e.motivo : 'erro' });
      }
    }
    if (feitas.length) await this.db.execute(sql`update mister_aviso set entregas = entregas || ${JSON.stringify(feitas)}::jsonb where id = ${a.id}::uuid`);
    return feitas.filter((f) => f.ok).length;
  }

  /** Fecha o caso do Atendimento que o aviso abriu (se ainda estiver aberto). */
  private async fecharCasos(a: AvisoAberto): Promise<void> {
    const casos = (a.entregas ?? []).filter((e) => e.destino === 'atendimento' && e.casoId).map((e) => e.casoId as string);
    for (const id of casos) {
      const r = linhas(
        await this.db.execute(sql`
          update atendimento_chamado set status = 'resolvido', resolvido_em = now()
           where id = ${id}::uuid and tenant_id = ${a.tenantId}::uuid and status <> 'resolvido' returning id`),
      );
      if (r.length) this.events?.emit('atendimento.mudou', { tenantId: a.tenantId, id, motivo: 'aviso_do_mister_resolvido' });
    }
  }

  /** A limpeza diária: o aviso resolvido há mais de 90 dias sai. */
  @Cron('50 4 * * *')
  async limpar(): Promise<number> {
    if (ehServidorLocal()) return 0;
    try {
      return linhas(await this.db.execute(sql`delete from mister_aviso where situacao = 'resolvido' and resolvido_em < now() - interval '90 days' returning id`)).length;
    } catch (e: any) {
      if (!semTabela(e)) this.logger.warn(`a limpeza dos avisos falhou — ${e?.message ?? e}`);
      return 0;
    }
  }
}

