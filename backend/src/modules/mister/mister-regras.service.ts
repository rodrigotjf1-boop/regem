import { Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { FUSO_OPERACAO, hojeISO, somarDias } from '../../common/data';
import { FUSO_SQL } from '../../common/fuso-sql';
import { ehServidorLocal } from '../../common/modo';
import { podeAcessar } from '../../auth/permissoes';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { pedidoComoNoQuadro } from './mister-agente.regras';
import { dentroDaJanelaDoWhatsapp, ehTipoDeAviso } from './mister-avisos.regras';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { EscopoDoMister, MisterFerramentasService, ResultadoDaFerramenta } from './mister-ferramentas.service';
import { MODELO_DO_AVISO } from './mister-modelos';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import {
  AVISOS_QUE_NAO_SE_CALAM,
  Agora,
  EstadoDaRegra,
  FONTES_DA_REGRA,
  LIMITES_DA_REGRA,
  LinhaDaFonte,
  NomeDaFonte,
  PREFIXO_DA_REGRA,
  QuemFazARegra,
  Regra,
  TEXTOS_DAS_REGRAS,
  avaliarRegra,
  botoesDaProposta,
  botoesDoApagar,
  conferirRegra,
  descreverRegra,
  fonteDaRegra,
  lerBotaoDaRegra,
  olhaAgora,
  textoDoDisparo,
} from './mister-regra';
import { pessoaVale } from './mister-vinculo.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS REGRAS DE CADA PESSOA (versão 6, M6e; mig 472): a ferramenta `regras` da conversa (propor, confirmar, buscar,
// listar, apagar, pausar, retomar), os botões (Confirmar, Mudar, Apagar, Deixar) e o MOTOR — a cada minuto, só na nuvem,
// lê cada fonte UMA vez para todas as regras ativas das empresas (em lote), avalia cada regra no escopo da pessoa dona dela
// (a mesma régua da conversa, conferida a cada volta — V75) e manda pelo número do Mister: dentro das 24 horas, o texto;
// fora, o modelo aprovado com "Ver o que fazer". Cada aviso é reservado pela chave antes de sair (V42).
// A trava de emergência: `MISTER_REGRAS_DESLIGADAS=1` na API para o motor (as regras continuam guardadas).

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => ['42P01', '42703'].includes(e?.code) || ['42P01', '42703'].includes(e?.cause?.code);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** No máximo estas regras ativas por volta (a volta seguinte pega o resto). */
export const REGRAS_POR_VOLTA = 2000;
/** No máximo estas linhas por fonte e volta. */
const LINHAS_POR_FONTE = 3000;

const SITUACAO_DO_PEDIDO: Record<string, string> = {
  novo: 'aguardando_aceite',
  confirmado: 'em_preparo',
  pronto: 'pronto',
  despachado: 'a_caminho',
  entregue: 'entregue',
  concluido: 'entregue',
  cancelado: 'cancelado',
};
const CANAL_DO_PEDIDO = (c: unknown) => {
  const v = String(c ?? '').toLowerCase();
  if (v === '99food' || v === 'food99' || v === '99') return '99';
  return ['cardapio', 'ifood', 'whatsapp'].includes(v) ? v : 'outro';
};
const TIPO_DO_PEDIDO = (t: unknown) => (['entrega', 'retirada'].includes(String(t ?? '')) ? String(t) : 'outro');
const NOME_DO_CANAL: Record<string, string> = { cardapio: 'Cardápio digital', ifood: 'iFood', '99': '99' };
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v) * 100) / 100);
const minutosInteiros = (v: unknown) => (v === null || v === undefined ? null : Math.max(0, Math.floor(Number(v))));

/** Agora, no relógio da loja. */
export function agoraNaLoja(instante: Date = new Date()): Agora {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_OPERACAO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const dias = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { instante, dia: `${v('year')}-${v('month')}-${v('day')}`, diaDaSemana: Math.max(0, dias.indexOf(v('weekday'))), hora: `${v('hour')}:${v('minute')}` };
}

/** O horário de atendimento da loja vale agora? (`cardapio_config.horarios`: [{dia 0–6, abre, fecha, ativo}]; vazio = sempre.) */
export function dentroDoHorarioDaLoja(horarios: unknown, agora: Agora): boolean {
  if (!Array.isArray(horarios) || !horarios.length) return true;
  const m = (h: unknown) => (/^\d{2}:\d{2}/.test(String(h)) ? Number(String(h).slice(0, 2)) * 60 + Number(String(h).slice(3, 5)) : null);
  const agoraMin = m(agora.hora)!;
  const ontem = (agora.diaDaSemana + 6) % 7;
  for (const h of horarios as any[]) {
    if (h?.ativo === false) continue;
    const abre = m(h?.abre);
    const fecha = m(h?.fecha);
    if (abre === null || fecha === null) continue;
    const dia = Number(h?.dia);
    if (fecha > abre && dia === agora.diaDaSemana && agoraMin >= abre && agoraMin <= fecha) return true;
    // a janela que passa da meia-noite: a parte de hoje e a sobra de ontem
    if (fecha <= abre && ((dia === agora.diaDaSemana && agoraMin >= abre) || (dia === ontem && agoraMin <= fecha))) return true;
  }
  return false;
}

type Leitura = (tenants: string[], agora: Agora) => Promise<Array<LinhaDaFonte & { tenantId: string }>>;

@Injectable()
export class MisterRegrasService implements OnModuleInit {
  private readonly logger = new Logger('MisterRegras');
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ferramentas: MisterFerramentasService,
    @Optional() private readonly dashboard?: DashboardService,
    @Optional() private readonly numero?: MisterNumeroService,
    @Optional() private readonly entrada?: MisterEntradaService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  onModuleInit(): void {
    this.ferramentas.registrarRegras((e, en) => this.ferramenta(e, en));
    this.entrada?.registrarBotao(PREFIXO_DA_REGRA, (botaoId, quem) => this.tocou(botaoId, quem));
    this.entrada?.registrarToque('regra', (id, quem) => this.mostrarPeloToque(id, quem));
  }

  // ───────────────────────────── a ferramenta da conversa ─────────────────────────────

  private quemFaz(e: EscopoDoMister): QuemFazARegra {
    return { presidente: e.nivel === 'presidente', pode: (p) => podeAcessar(e.permissoes, p as any), verValores: e.verValores };
  }

  /** A ferramenta `regras`. Nunca lança: o erro vira a frase que volta à IA. */
  async ferramenta(e: EscopoDoMister, en: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });
    try {
      switch (en.acao) {
        case 'propor':
          return await this.propor(e, en);
        case 'confirmar': {
          const r = await this.ativar(String(en.regraId ?? ''), e.tenantId, e.colaboradorId, e.nivel === 'presidente');
          return 'erro' in r ? recusa(r.erro) : { ok: true, dados: { ligada: true, titulo: r.titulo } };
        }
        case 'buscar':
          return await this.buscar(e, en);
        case 'listar':
          return await this.listar(e);
        case 'apagar':
        case 'pausar':
        case 'retomar':
          return await this.mexer(e, String(en.acao), String(en.regraId ?? ''));
        default:
          return recusa('Use acao propor, confirmar, buscar, listar, apagar, pausar ou retomar.');
      }
    } catch (err: any) {
      if (semTabela(err)) return recusa('As regras de aviso ainda não estão disponíveis neste servidor.');
      this.logger.error(`a ferramenta das regras falhou: ${String(err?.message ?? err).slice(0, 300)}`, err?.stack);
      return recusa('Não consegui mexer nas regras agora.');
    }
  }

  private async propor(e: EscopoDoMister, en: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });
    const [{ n }] = linhas(
      await this.db.execute(sql`
        select count(*)::int as n from mister_regra
         where tenant_id = ${e.tenantId}::uuid and colaborador_id = ${e.colaboradorId}::uuid and situacao in ('ativa', 'pausada')`),
    );
    if (Number(n) >= LIMITES_DA_REGRA.porPessoa) return recusa(TEXTOS_DAS_REGRAS.teto(Number(n)));
    const lida = conferirRegra(en.regra, this.quemFaz(e), (t) => ehTipoDeAviso(t) && !(AVISOS_QUE_NAO_SE_CALAM as readonly string[]).includes(t));
    if ('erro' in lida) return recusa(lida.erro);
    const regra = lida.regra;
    // O alvo: o nome sai do banco, e o item precisa estar no escopo da pessoa (a IA só passou o id da busca).
    if (regra.alvo) {
      const achado = await this.alvoNoEscopo(e, regra.fonte, regra.alvo.id);
      if (!achado) return recusa('Não achei esse item entre os que esta pessoa vê. Busque de novo.');
      regra.alvo = { id: regra.alvo.id, rotulo: achado };
    }
    let antiga: string | null = null;
    if (en.substituiRegraId !== undefined && en.substituiRegraId !== null && en.substituiRegraId !== '') {
      const dona = await this.regraDaPessoa(e, String(en.substituiRegraId));
      if (!dona) return recusa('Não achei a regra antiga para trocar. Peça a lista.');
      antiga = dona.id;
    }
    const resumo = descreverRegra(regra);
    const [p] = linhas(
      await this.db.execute(sql`
        insert into mister_regra (tenant_id, colaborador_id, situacao, titulo, resumo, fonte, regra, substitui, substitui_regra_id, vence_em)
        values (${e.tenantId}::uuid, ${e.colaboradorId}::uuid, 'proposta', ${regra.titulo}, ${resumo}, ${regra.fonte}, ${JSON.stringify(regra)}::jsonb,
                -- a lista vai como JSON (o \`sql\` expande uma lista do JavaScript em vários parâmetros)
                (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(${JSON.stringify(regra.substitui ?? [])}::jsonb) x),
                ${antiga}::uuid, clock_timestamp() + make_interval(mins => ${LIMITES_DA_REGRA.propostaValeMin}::int))
        returning id::text as id`),
    );
    return {
      ok: true,
      dados: {
        id: p.id,
        titulo: regra.titulo,
        oQueVouFazer: resumo,
        ...(regra.substitui?.length ? { deixaDeReceber: regra.substitui } : {}),
        ...(antiga ? { trocaARegra: antiga } : {}),
        siga: 'Mostre o "oQueVouFazer" como veio e diga que os botões Confirmar e Mudar vão junto. Nada liga sem o Confirmar.',
      },
      botoes: botoesDaProposta(p.id),
    };
  }

  /** O nome do item escolhido (a conta, a tarefa), se ele está no escopo da pessoa — ou null. */
  private async alvoNoEscopo(e: EscopoDoMister, fonte: NomeDaFonte, id: string): Promise<string | null> {
    if (!UUID.test(id)) return null;
    const loja = e.presa ? sql`and (x.unidade_id = ${e.presa}::uuid or x.unidade_id is null)` : sql``;
    if (fonte === 'contas') {
      const [c] = linhas(
        await this.db.execute(sql`
          select x.descricao, f.nome as fornecedor from titulo_financeiro x left join fornecedor f on f.id = x.fornecedor_id
           where x.id = ${id}::uuid and x.tenant_id = ${e.tenantId}::uuid and x.tipo = 'pagar' ${loja}`),
      );
      return c ? [c.descricao, c.fornecedor].filter(Boolean).join(' · ').slice(0, 120) : null;
    }
    if (fonte === 'tarefas') {
      const [t] = linhas(
        await this.db.execute(sql`select x.titulo from tarefa_def x where x.id = ${id}::uuid and x.tenant_id = ${e.tenantId}::uuid and x.deleted_at is null ${loja}`),
      );
      return t ? String(t.titulo).slice(0, 120) : null;
    }
    return null;
  }

  private async buscar(e: EscopoDoMister, en: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    const texto = String(en.texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const como = texto ? `%${texto.replace(/[%_\\]/g, '')}%` : '%';
    const loja = (col: string) => (e.presa ? sql`and (${sql.raw(col)} = ${e.presa}::uuid or ${sql.raw(col)} is null)` : sql``);
    if (en.fonte === 'contas') {
      if (e.nivel !== 'presidente' && !podeAcessar(e.permissoes, 'financeiro' as any)) return { ok: false, dados: { erro: 'O perfil desta pessoa não dá acesso às contas a pagar.' } };
      const hoje = hojeISO();
      const itens = linhas(
        await this.db.execute(sql`
          select t.id::text as id, t.descricao, f.nome as fornecedor, to_char(t.vencimento, 'DD/MM') as vence, t.valor::float8 as valor
            from titulo_financeiro t left join fornecedor f on f.id = t.fornecedor_id
           where t.tenant_id = ${e.tenantId}::uuid and t.tipo = 'pagar' and t.status = 'aberto'
             and t.vencimento between ${somarDias(hoje, -30)}::date and ${somarDias(hoje, 60)}::date
             and (t.descricao ilike ${como} or f.nome ilike ${como}) ${loja('t.unidade_id')}
           order by t.vencimento, t.descricao limit 8`),
      );
      return {
        ok: true,
        dados: {
          itens: itens.map((i) => ({ id: i.id, rotulo: [i.descricao, i.fornecedor].filter(Boolean).join(' · '), vence: i.vence, ...(e.verValores ? { valor: num(i.valor) } : {}) })),
          ...(itens.length ? {} : { aviso: 'Nenhuma conta a pagar em aberto com esse nome.' }),
        },
      };
    }
    if (en.fonte === 'tarefas') {
      const itens = linhas(
        await this.db.execute(sql`
          select distinct on (d.id) d.id::text as id, d.titulo, to_char(d.horario, 'HH24:MI') as horario, to_char(d.horario_fim, 'HH24:MI') as fim
            from tarefa_instancia i join tarefa_def d on d.id = i.tarefa_def_id and d.deleted_at is null
           where i.tenant_id = ${e.tenantId}::uuid and i.data = ${hojeISO()}::date and d.titulo ilike ${como} ${loja('i.unidade_id')}
           order by d.id, d.horario nulls last
           limit 20`),
      ).sort((a, b) => String(a.horario ?? '99').localeCompare(String(b.horario ?? '99')));
      return {
        ok: true,
        dados: {
          itens: itens.map((i, n) => ({ numero: n + 1, id: i.id, rotulo: i.titulo, horario: i.horario, fim: i.fim })),
          ...(itens.length ? {} : { aviso: 'Nenhuma tarefa de hoje com esse nome.' }),
        },
      };
    }
    return { ok: false, dados: { erro: 'Busque em contas ou tarefas.' } };
  }

  private async listar(e: EscopoDoMister): Promise<ResultadoDaFerramenta> {
    // Decisão V6-5: o presidente vê as de todos; o gerente, só as dele.
    const deQuem = e.nivel === 'presidente' ? sql`` : sql`and r.colaborador_id = ${e.colaboradorId}::uuid`;
    const lidas = linhas(
      await this.db.execute(sql`
        select r.id::text as id, r.titulo, r.situacao, r.resumo, c.nome as dono, r.colaborador_id::text as "colaboradorId",
               to_char(r.ultimo_envio_em at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as "ultimoAviso"
          from mister_regra r join colaborador c on c.id = r.colaborador_id
         where r.tenant_id = ${e.tenantId}::uuid and r.situacao in ('ativa', 'pausada') ${deQuem}
         order by (r.colaborador_id = ${e.colaboradorId}::uuid) desc, r.situacao, r.criada_em
         limit 60`),
    );
    return {
      ok: true,
      dados: {
        regras: lidas.map((l) => ({
          id: l.id,
          titulo: l.titulo,
          situacao: l.situacao,
          oQueFaz: l.resumo,
          ...(l.colaboradorId !== e.colaboradorId ? { de: l.dono } : {}),
          ultimoAviso: l.ultimoAviso ?? 'ainda não avisou',
        })),
        ...(lidas.length ? {} : { aviso: 'Nenhuma regra ainda.' }),
      },
    };
  }

  // ───────────────────────────── a tela (M6f) ─────────────────────────────

  /**
   * Mister › Regras (versão 6, M6f): as regras ativas e pausadas — as de todos para o presidente, só as dele para o gerente
   * (decisão V6-5; a régua é a da conversa). O nome da fonte vem do catálogo; nada da regra crua (o JSON) vai à tela.
   */
  async daTela(e: EscopoDoMister): Promise<{ souPresidente: boolean; regras: any[] }> {
    const deQuem = e.nivel === 'presidente' ? sql`` : sql`and r.colaborador_id = ${e.colaboradorId}::uuid`;
    const lidas = linhas(
      await this.db.execute(sql`
        select r.id::text as id, r.titulo, r.situacao, r.resumo, r.fonte, r.substitui, c.nome as dono,
               r.colaborador_id::text as "colaboradorId",
               to_char(r.ultimo_envio_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "ultimoAviso",
               to_char(r.criada_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "criadaEm"
          from mister_regra r join colaborador c on c.id = r.colaborador_id and c.tenant_id = r.tenant_id
         where r.tenant_id = ${e.tenantId}::uuid and r.situacao in ('ativa', 'pausada') ${deQuem}
         order by (r.colaborador_id = ${e.colaboradorId}::uuid) desc, c.nome, r.criada_em
         limit 300`),
    );
    return {
      souPresidente: e.nivel === 'presidente',
      regras: lidas.map((l) => ({
        id: l.id,
        titulo: l.titulo,
        resumo: l.resumo,
        situacao: l.situacao,
        fonte: ((r) => (r ? r.charAt(0).toUpperCase() + r.slice(1) : String(l.fonte)))(FONTES_DA_REGRA.find((f) => f.nome === l.fonte)?.rotulo),
        de: String(l.dono ?? ''),
        voce: l.colaboradorId === e.colaboradorId,
        ultimoAviso: l.ultimoAviso ?? null,
        criadaEm: l.criadaEm,
        deixaDeReceber: Array.isArray(l.substitui) ? l.substitui : [],
      })),
    };
  }

  /** Pausar, retomar ou apagar pela tela — a mesma régua de quem mexe (a dele, ou qualquer uma para o presidente). */
  async mudarPelaTela(e: EscopoDoMister, id: string, acao: 'pausar' | 'retomar' | 'apagar'): Promise<{ titulo: string; situacao: string }> {
    const r = await this.regraDaPessoa(e, String(id ?? ''));
    if (!r) throw new NotFoundException(TEXTOS_DAS_REGRAS.naoAchada);
    const nova = acao === 'apagar' ? 'apagada' : acao === 'pausar' ? 'pausada' : 'ativa';
    const [m] = linhas(
      await this.db.execute(sql`
        update mister_regra set situacao = ${nova}, atualizada_em = clock_timestamp(),
               apagada_em = case when ${nova} = 'apagada' then clock_timestamp() else apagada_em end
         where id = ${r.id}::uuid and situacao in ('ativa', 'pausada') returning id`),
    );
    if (!m) throw new NotFoundException(TEXTOS_DAS_REGRAS.naoAchada);
    await this.auditoria?.registrar({
      tenantId: e.tenantId,
      atorId: e.colaboradorId,
      atorPerfil: e.nivel,
      tipo: 'config',
      acao: `mister_regra_${acao === 'apagar' ? 'apagada' : acao === 'pausar' ? 'pausada' : 'retomada'}`,
      entidadeTipo: 'mister_regra',
      entidadeId: r.id,
      origem: 'web',
      detalhe: { titulo: r.titulo },
    });
    return { titulo: r.titulo, situacao: nova };
  }

  /** A regra que esta pessoa pode mexer: a dela, ou qualquer uma da empresa se for o presidente. */
  private async regraDaPessoa(e: EscopoDoMister, id: string): Promise<{ id: string; titulo: string; situacao: string } | null> {
    if (!UUID.test(id)) return null;
    const dela = e.nivel === 'presidente' ? sql`` : sql`and colaborador_id = ${e.colaboradorId}::uuid`;
    const [r] = linhas(
      await this.db.execute(sql`
        select id::text as id, titulo, situacao from mister_regra
         where id = ${id}::uuid and tenant_id = ${e.tenantId}::uuid and situacao in ('ativa', 'pausada') ${dela}`),
    );
    return r ?? null;
  }

  private async mexer(e: EscopoDoMister, acao: string, id: string): Promise<ResultadoDaFerramenta> {
    const r = await this.regraDaPessoa(e, id);
    if (!r) return { ok: false, dados: { erro: TEXTOS_DAS_REGRAS.naoAchada } };
    if (acao === 'apagar') {
      return { ok: true, dados: { titulo: r.titulo, siga: 'Diga que o botão Apagar, que vai junto, apaga a regra.' }, botoes: botoesDoApagar(r.id) };
    }
    const nova = acao === 'pausar' ? 'pausada' : 'ativa';
    await this.db.execute(sql`update mister_regra set situacao = ${nova}, atualizada_em = clock_timestamp() where id = ${r.id}::uuid and situacao in ('ativa', 'pausada')`);
    return { ok: true, dados: { titulo: r.titulo, situacao: nova } };
  }

  /** Confirmar: a proposta que ainda vale vira ativa (e a antiga que ela troca, apagada). Gravação condicional. */
  async ativar(id: string, tenantId: string, quemConfirma: string, presidente: boolean): Promise<{ titulo: string } | { erro: string }> {
    if (!UUID.test(id)) return { erro: TEXTOS_DAS_REGRAS.naoAchada };
    const dela = presidente ? sql`` : sql`and colaborador_id = ${quemConfirma}::uuid`;
    const [r] = linhas(
      await this.db.execute(sql`
        update mister_regra set situacao = 'ativa', ativada_em = clock_timestamp(), atualizada_em = clock_timestamp(), vence_em = null
         where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and situacao = 'proposta' and vence_em > clock_timestamp() ${dela}
        returning id::text as id, titulo, fonte, colaborador_id::text as "colaboradorId", substitui_regra_id::text as antiga`),
    );
    if (!r) {
      const [v] = linhas(await this.db.execute(sql`select situacao from mister_regra where id = ${id}::uuid and tenant_id = ${tenantId}::uuid`));
      return { erro: v?.situacao === 'proposta' || v?.situacao === 'descartada' ? TEXTOS_DAS_REGRAS.venceu : v?.situacao === 'ativa' ? `A regra já está ligada.` : TEXTOS_DAS_REGRAS.naoAchada };
    }
    if (r.antiga) {
      await this.db.execute(sql`
        update mister_regra set situacao = 'apagada', apagada_em = clock_timestamp(), atualizada_em = clock_timestamp()
         where id = ${r.antiga}::uuid and tenant_id = ${tenantId}::uuid and situacao in ('ativa', 'pausada')`);
    }
    await this.auditar(tenantId, quemConfirma, 'mister_regra_ligada', r.id, { titulo: r.titulo, fonte: r.fonte, ...(r.antiga ? { trocou: r.antiga } : {}) });
    return { titulo: String(r.titulo) };
  }

  // ───────────────────────────── os botões ─────────────────────────────

  /** O toque em Confirmar, Mudar, Apagar ou Deixar. `false` = não é botão de regra. */
  async tocou(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const b = lerBotaoDaRegra(botaoId);
    if (!b || !quem.vinculos.length) return false;
    const [r] = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", colaborador_id::text as "colaboradorId", titulo, situacao
          from mister_regra
         where id = ${b.regraId}::uuid and tenant_id in (${sql.join(quem.vinculos.map((v) => sql`${v.tenantId}::uuid`), sql`, `)})`),
    );
    if (!r) return false;
    const v = quem.vinculos.find((x) => x.tenantId === r.tenantId)!;
    const dono = v.colaboradorId === r.colaboradorId;
    const presidente = v.nivel === 'presidente';
    if (!dono && !presidente) {
      await this.dizer(quem.telefone, TEXTOS_DAS_REGRAS.naoAchada);
      return true;
    }
    if (b.acao === 'sim') {
      const a = await this.ativar(r.id, r.tenantId, v.colaboradorId, presidente);
      await this.dizer(quem.telefone, 'erro' in a ? a.erro : TEXTOS_DAS_REGRAS.ligada(a.titulo));
    } else if (b.acao === 'mudar') {
      await this.db.execute(sql`update mister_regra set situacao = 'descartada', atualizada_em = clock_timestamp() where id = ${r.id}::uuid and situacao = 'proposta'`);
      await this.dizer(quem.telefone, TEXTOS_DAS_REGRAS.mudar);
    } else if (b.acao === 'apagar') {
      const [a] = linhas(
        await this.db.execute(sql`
          update mister_regra set situacao = 'apagada', apagada_em = clock_timestamp(), atualizada_em = clock_timestamp()
           where id = ${r.id}::uuid and situacao in ('ativa', 'pausada') returning id`),
      );
      if (a) await this.auditar(r.tenantId, v.colaboradorId, 'mister_regra_apagada', r.id, { titulo: r.titulo, ...(dono ? {} : { de: r.colaboradorId }) });
      await this.dizer(quem.telefone, a ? TEXTOS_DAS_REGRAS.apagada(r.titulo) : TEXTOS_DAS_REGRAS.naoAchada);
    } else {
      await this.dizer(quem.telefone, TEXTOS_DAS_REGRAS.deixada(r.titulo));
    }
    return true;
  }

  /** O toque em "Ver o que fazer" do modelo (o aviso da regra que saiu fora das 24 horas): só ao dono, só o que saiu pelo modelo. */
  async mostrarPeloToque(id: string, quem: QuemTocou): Promise<boolean> {
    const [v] = linhas(
      await this.db.execute(sql`
        select texto, tenant_id::text as "tenantId", colaborador_id::text as "colaboradorId", resultado from mister_regra_envio where id = ${id}::uuid`),
    );
    if (!v || v.resultado !== 'modelo') return false;
    if (!quem.vinculos.some((x) => x.tenantId === v.tenantId && x.colaboradorId === v.colaboradorId)) return false;
    await this.dizer(quem.telefone, String(v.texto));
    return true;
  }

  // ───────────────────────────── o motor ─────────────────────────────

  @Cron(CronExpression.EVERY_MINUTE)
  async rotina(): Promise<void> {
    if (ehServidorLocal() || this.rodando || process.env.MISTER_REGRAS_DESLIGADAS === '1') return;
    this.rodando = true;
    try {
      await this.volta();
    } catch (e: any) {
      if (!semTabela(e)) this.logger.error(`a volta das regras falhou — ${e?.message ?? e}`, e?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Uma volta: as propostas vencidas saem; cada regra ativa que olha agora é avaliada no escopo de quem a criou, com as
   * fontes lidas uma vez por empresa. Devolve o que fez (os testes conferem). `soEmpresas`: só estas.
   */
  async volta(soEmpresas?: string[], instante: Date = new Date()): Promise<{ avaliadas: number; avisos: number; concluidas: number }> {
    const so = (col: string) => (soEmpresas?.length ? sql`and ${sql.raw(col)} in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``);
    await this.db.execute(sql`
      update mister_regra set situacao = 'descartada', atualizada_em = clock_timestamp()
       where situacao = 'proposta' and vence_em <= clock_timestamp() ${so('tenant_id')}`);
    const agora = agoraNaLoja(instante);
    const ativas = linhas(
      await this.db.execute(sql`
        select r.id::text as id, r.tenant_id::text as "tenantId", r.colaborador_id::text as "colaboradorId", r.regra, r.estado
          from mister_regra r join empresa emp on emp.id = r.tenant_id and emp.deleted_at is null
         where r.situacao = 'ativa' ${so('r.tenant_id')}
         order by r.tenant_id, r.id
         limit ${REGRAS_POR_VOLTA}`),
    );
    // Quem é cada dono AGORA (a mesma régua da conversa): saiu, foi rebaixado, perdeu a permissão → a regra não olha.
    const escopos = new Map<string, EscopoDoMister | null>();
    const escopoDe = async (t: string, c: string) => {
      const k = `${t}|${c}`;
      if (!escopos.has(k)) escopos.set(k, await this.ferramentas.escopoDaTela(t, c).catch(() => null));
      return escopos.get(k) ?? null;
    };
    const aOlhar: Array<{ id: string; tenantId: string; colaboradorId: string; regra: Regra; estado: EstadoDaRegra; escopo: EscopoDoMister }> = [];
    let concluidas = 0;
    for (const a of ativas) {
      const regra = a.regra as Regra;
      const estado = (a.estado ?? {}) as EstadoDaRegra;
      const fonte = fonteDaRegra(regra?.fonte);
      if (!fonte) continue;
      // A de um dia só que já passou se encerra (sem avisar: o dia dela acabou).
      if (regra.quando?.data && regra.quando.data < agora.dia) {
        concluidas += await this.concluir(a.id);
        continue;
      }
      if (!olhaAgora(regra, estado, agora)) continue;
      const e = await escopoDe(a.tenantId, a.colaboradorId);
      if (!e || e.semLoja) continue;
      if (fonte.permissao && e.nivel !== 'presidente' && !podeAcessar(e.permissoes, fonte.permissao as any)) continue;
      aOlhar.push({ id: a.id, tenantId: a.tenantId, colaboradorId: a.colaboradorId, regra, estado, escopo: e });
    }
    // As fontes: uma leitura por fonte para todas as empresas que precisam dela (as vendas, por dono: são do Painel).
    const precisa = new Map<NomeDaFonte, Set<string>>();
    for (const x of aOlhar) if (x.regra.fonte !== 'vendas') (precisa.get(x.regra.fonte) ?? precisa.set(x.regra.fonte, new Set()).get(x.regra.fonte)!).add(x.tenantId);
    const lidas = new Map<NomeDaFonte, Array<LinhaDaFonte & { tenantId: string }>>();
    for (const [fonte, tenants] of precisa) {
      try {
        lidas.set(fonte, await this.leitura(fonte)([...tenants], agora));
      } catch (e: any) {
        if (!semTabela(e)) this.logger.warn(`a fonte ${fonte} das regras não foi lida — ${e?.message ?? e}`);
        lidas.set(fonte, []);
      }
    }
    let avisos = 0;
    for (const x of aOlhar) {
      const daLoja = (l: { unidadeId: string | null }) => !x.escopo.presa || !l.unidadeId || l.unidadeId === x.escopo.presa;
      const linhasDaRegra =
        x.regra.fonte === 'vendas' ? await this.vendas(x.tenantId, x.escopo, agora) : (lidas.get(x.regra.fonte) ?? []).filter((l) => l.tenantId === x.tenantId && daLoja(l));
      const { disparos, estado } = avaliarRegra(x.regra, linhasDaRegra, x.estado, agora);
      for (const d of disparos) if (await this.avisar(x, textoDoDisparo(x.regra, d), d.chave, instante)) avisos++;
      await this.db.execute(sql`
        update mister_regra set estado = ${JSON.stringify(estado)}::jsonb, atualizada_em = clock_timestamp(),
               ultimo_envio_em = case when ${disparos.length > 0} then clock_timestamp() else ultimo_envio_em end
         where id = ${x.id}::uuid and situacao = 'ativa'`);
      // A de uma vez só: olhou (avisando ou não), acabou.
      if (x.regra.vezes === 'uma_vez' && estado.olhouEm === agora.dia) concluidas += await this.concluir(x.id);
    }
    return { avaliadas: aOlhar.length, avisos, concluidas };
  }

  private async concluir(id: string): Promise<number> {
    const r = linhas(
      await this.db.execute(sql`update mister_regra set situacao = 'concluida', atualizada_em = clock_timestamp() where id = ${id}::uuid and situacao = 'ativa' returning id`),
    );
    return r.length;
  }

  /** Reserva o aviso pela chave e manda à pessoa. `true` = saiu (pelo texto ou pelo modelo). */
  private async avisar(x: { id: string; tenantId: string; colaboradorId: string; regra: Regra }, texto: string, chave: string, agora: Date): Promise<boolean> {
    const [envio] = linhas(
      await this.db.execute(sql`
        insert into mister_regra_envio (regra_id, tenant_id, colaborador_id, chave, texto)
        values (${x.id}::uuid, ${x.tenantId}::uuid, ${x.colaboradorId}::uuid, ${chave.slice(0, 500)}, ${texto})
        on conflict (regra_id, chave) do nothing returning id::text as id`),
    );
    if (!envio) return false;
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
           where g.tenant_id = ${x.tenantId}::uuid and g.colaborador_id = ${x.colaboradorId}::uuid
             and g.ligado_em is not null and g.telefone is not null and g.pausado_em is null and ${pessoaVale()}`),
      );
      if (!l || !this.numero) resultado = 'sem o WhatsApp ligado';
      else if ((await this.numero.semJanela()) || dentroDaJanelaDoWhatsapp(l.ultimaEntrada ? new Date(l.ultimaEntrada) : null, agora.getTime())) {
        await this.numero.enviar(String(l.telefone), { texto });
        resultado = 'enviado';
      } else {
        await this.numero.enviarModelo(String(l.telefone), MODELO_DO_AVISO, [String(l.empresa ?? '').slice(0, 60), x.regra.titulo.slice(0, 120)], { tipo: 'regra', id: envio.id });
        resultado = 'modelo';
      }
    } catch (e: any) {
      resultado = `falhou: ${e instanceof FalhaDoEnvioDoMister ? e.motivo : 'erro'}`;
      this.logger.warn(`regra ${x.id}: o aviso não saiu — ${e?.message ?? e}`);
    }
    await this.db.execute(sql`update mister_regra_envio set resultado = ${resultado} where id = ${envio.id}::uuid`);
    return resultado === 'enviado' || resultado === 'modelo';
  }

  // ───────────────────────────── as fontes ─────────────────────────────

  private leitura(fonte: NomeDaFonte): Leitura {
    const em = (tenants: string[], col: string) => sql`${sql.raw(col)} in (${sql.join(tenants.map((t) => sql`${t}::uuid`), sql`, `)})`;
    switch (fonte) {
      case 'pedidos':
        return async (tenants) =>
          linhas(
            await this.db.execute(sql`
              select pe.id::text as id, pe.tenant_id::text as "tenantId", pe.unidade_id::text as "unidadeId", pe.numero, pe.canal,
                     pe.display_id as "displayId", pe.status, pe.tipo, pe.agendamento is not null as agendado, pe.total::float8 as valor,
                     extract(epoch from (clock_timestamp() - pe.criado_em)) / 60 as chegada,
                     case when pe.confirmado_em is not null then extract(epoch from (clock_timestamp() - pe.confirmado_em)) / 60 end as aceite,
                     case when pe.confirmado_em is not null and pe.pronto_em is not null then extract(epoch from (pe.pronto_em - pe.confirmado_em)) / 60
                          when pe.confirmado_em is not null and pe.status = 'confirmado' then extract(epoch from (clock_timestamp() - pe.confirmado_em)) / 60 end as ate_pronto,
                     case when pe.confirmado_em is not null and pe.despachado_em is not null then extract(epoch from (pe.despachado_em - pe.confirmado_em)) / 60
                          when pe.confirmado_em is not null and pe.status in ('confirmado', 'pronto') then extract(epoch from (clock_timestamp() - pe.confirmado_em)) / 60 end as ate_saida
                from pedido_externo pe
               where ${em(tenants, 'pe.tenant_id')} and pe.deleted_at is null and pe.criado_em > clock_timestamp() - interval '12 hours'
               order by pe.criado_em desc
               limit ${LINHAS_POR_FONTE}`),
          ).map((p) => ({
            id: p.id,
            alvoId: p.id,
            tenantId: p.tenantId,
            unidadeId: p.unidadeId ?? null,
            rotulo: pedidoComoNoQuadro(p),
            campos: {
              numero: p.numero === null ? null : Number(p.numero),
              canal: CANAL_DO_PEDIDO(p.canal),
              situacao: SITUACAO_DO_PEDIDO[String(p.status)] ?? String(p.status),
              tipo: TIPO_DO_PEDIDO(p.tipo),
              min_desde_chegada: minutosInteiros(p.chegada),
              min_desde_aceite: minutosInteiros(p.aceite),
              min_aceite_ate_pronto: minutosInteiros(p.ate_pronto),
              min_aceite_ate_saida: TIPO_DO_PEDIDO(p.tipo) === 'entrega' || p.ate_saida === null ? minutosInteiros(p.ate_saida) : null,
              agendado: p.agendado === true,
              valor: num(p.valor),
            },
          }));
      case 'contas':
        return async (tenants, agora) =>
          linhas(
            await this.db.execute(sql`
              select t.id::text as id, t.tenant_id::text as "tenantId", t.unidade_id::text as "unidadeId", t.descricao, f.nome as fornecedor,
                     t.valor::float8 as valor, to_char(t.vencimento, 'YYYY-MM-DD') as vencimento, (t.vencimento - ${agora.dia}::date)::int as dias
                from titulo_financeiro t left join fornecedor f on f.id = t.fornecedor_id
               where ${em(tenants, 't.tenant_id')} and t.tipo = 'pagar' and t.status = 'aberto'
                 and t.vencimento between ${somarDias(agora.dia, -30)}::date and ${somarDias(agora.dia, 60)}::date
               limit ${LINHAS_POR_FONTE}`),
          ).map((c) => ({
            id: c.id,
            alvoId: c.id,
            tenantId: c.tenantId,
            unidadeId: c.unidadeId ?? null,
            rotulo: [c.descricao, c.fornecedor].filter(Boolean).join(' · ') || 'conta a pagar',
            campos: { descricao: c.descricao, fornecedor: c.fornecedor ?? '', valor: num(c.valor), vencimento: c.vencimento, dias_para_vencer: Number(c.dias) },
          }));
      case 'tarefas':
        return async (tenants, agora) =>
          linhas(
            await this.db.execute(sql`
              select i.id::text as id, d.id::text as "alvoId", i.tenant_id::text as "tenantId", i.unidade_id::text as "unidadeId", d.titulo,
                     i.estado::text as situacao, c.nome as quem,
                     case when d.horario_fim is not null
                          then extract(epoch from (clock_timestamp() - ((i.data + d.horario_fim) at time zone ${FUSO_SQL}))) / 60 end as apos
                from tarefa_instancia i
                join tarefa_def d on d.id = i.tarefa_def_id and d.deleted_at is null
                left join colaborador c on c.id = i.colaborador_resolvido_id
               where ${em(tenants, 'i.tenant_id')} and i.data = ${agora.dia}::date
               limit ${LINHAS_POR_FONTE}`),
          ).map((t) => ({
            id: t.id,
            alvoId: t.alvoId,
            tenantId: t.tenantId,
            unidadeId: t.unidadeId ?? null,
            rotulo: String(t.titulo),
            campos: { titulo: t.titulo, situacao: t.situacao, min_apos_o_fim: t.apos === null ? null : Math.floor(Number(t.apos)), quem: t.quem ?? '' },
          }));
      case 'equipamentos':
        return async (tenants, agora) => {
          const incidentes = linhas(
            await this.db.execute(sql`
              select i.id::text as id, i.tenant_id::text as "tenantId", i.unidade_id::text as "unidadeId", i.regra, i.evidencia,
                     extract(epoch from (clock_timestamp() - i.primeira_em)) / 60 as parado
                from vigia_incidente i
               where ${em(tenants, 'i.tenant_id')} and i.situacao = 'aberto' and i.regra in ('impressora_parada', 'servidor_sem_sinal')
               limit ${LINHAS_POR_FONTE}`),
          );
          if (!incidentes.length) return [];
          const horarios = new Map<string, unknown>();
          for (const h of linhas(
            await this.db.execute(sql`select tenant_id::text as t, unidade_id::text as u, horarios from cardapio_config where ${em(tenants, 'tenant_id')}`),
          ))
            horarios.set(`${h.t}|${h.u ?? ''}`, h.horarios);
          return incidentes.map((i) => {
            const impressora = i.regra === 'impressora_parada';
            const nome = impressora ? String(i.evidencia?.impressora ?? i.evidencia?.nome ?? 'impressora').trim() : 'servidor da loja';
            const h = horarios.get(`${i.tenantId}|${i.unidadeId ?? ''}`) ?? horarios.get(`${i.tenantId}|`);
            return {
              id: i.id,
              alvoId: i.id,
              tenantId: i.tenantId,
              unidadeId: i.unidadeId ?? null,
              rotulo: impressora ? `Impressora ${nome}` : 'Servidor da loja',
              campos: { tipo: impressora ? 'impressora' : 'servidor', nome, parado_ha_min: minutosInteiros(i.parado), no_expediente: dentroDoHorarioDaLoja(h, agora) },
            };
          });
        };
      case 'caixas':
        return async (tenants) =>
          linhas(
            await this.db.execute(sql`
              select s.id::text as id, s.tenant_id::text as "tenantId", s.unidade_id::text as "unidadeId", u.nome as loja,
                     to_char(s.aberta_em at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as desde, extract(epoch from (clock_timestamp() - s.aberta_em)) / 3600 as horas
                from caixa_sessao s left join unidade u on u.id = s.unidade_id
               where ${em(tenants, 's.tenant_id')} and s.status = 'aberta'
               limit ${LINHAS_POR_FONTE}`),
          ).map((c) => ({
            id: c.id,
            alvoId: c.id,
            tenantId: c.tenantId,
            unidadeId: c.unidadeId ?? null,
            rotulo: `Caixa${c.loja ? ` da ${c.loja}` : ''} aberto em ${c.desde}`,
            campos: { aberto_ha_horas: Math.floor(Number(c.horas)) },
          }));
      case 'canais':
        return async (tenants) =>
          linhas(
            await this.db.execute(sql`
              select p.id::text as id, p.tenant_id::text as "tenantId", p.unidade_id::text as "unidadeId", p.canal, coalesce(p.motivo_texto, p.motivo) as motivo,
                     extract(epoch from (clock_timestamp() - p.pausado_em)) / 60 as ha, extract(epoch from (p.ate - clock_timestamp())) / 60 as falta
                from pausa_canal p
               where ${em(tenants, 'p.tenant_id')} and p.ate > clock_timestamp()
               limit ${LINHAS_POR_FONTE}`),
          ).map((c) => {
            const canal = CANAL_DO_PEDIDO(c.canal) === 'outro' ? String(c.canal) : CANAL_DO_PEDIDO(c.canal);
            return {
              id: c.id,
              alvoId: c.id,
              tenantId: c.tenantId,
              unidadeId: c.unidadeId ?? null,
              rotulo: `${NOME_DO_CANAL[canal] ?? canal} pausado${c.motivo ? ` (${String(c.motivo).slice(0, 60)})` : ''}`,
              campos: { canal, pausado_ha_min: minutosInteiros(c.ha), min_para_reabrir: minutosInteiros(c.falta) },
            };
          });
      default:
        return async () => [];
    }
  }

  /** As vendas de hoje, as mesmas do Painel, na loja da pessoa (ou de todas, para o presidente). Uma linha. */
  private async vendas(tenantId: string, e: EscopoDoMister, agora: Agora): Promise<LinhaDaFonte[]> {
    if (!this.dashboard) return [];
    const r: any = await this.dashboard.resumo(tenantId, agora.dia, e.verValores, e.presa);
    const c = r?.comercial ?? null;
    const loja = e.presa ? (e.lojas[0]?.nome ?? 'a loja') : e.lojaUnica ? (e.lojas[0]?.nome ?? e.empresa) : 'todas as lojas';
    return [
      {
        id: `vendas:${tenantId}:${e.presa ?? 'todas'}:${agora.dia}`,
        alvoId: `vendas:${tenantId}`,
        unidadeId: e.presa,
        rotulo: `Vendas de hoje até ${agora.hora} (${loja})`,
        campos: {
          faturamento: c ? num(c.faturado) : null,
          vendas: Number(r?.vendas?.total ?? 0),
          ticket_medio: c ? num(c.ticketMedio) : null,
          faturamento_delivery: c ? num(c.deliveryFaturado) : null,
          faturamento_balcao: c ? num(c.balcaoFaturado) : null,
        },
      },
    ];
  }

  // ───────────────────────────── ajudantes ─────────────────────────────

  private async dizer(telefone: string, texto: string): Promise<void> {
    try {
      await this.numero?.enviar(telefone, { texto });
    } catch (e: any) {
      this.logger.warn(`a resposta da regra não saiu — ${e instanceof FalhaDoEnvioDoMister ? e.motivo : (e?.message ?? e)}`);
    }
  }

  private async auditar(tenantId: string, atorId: string, acao: string, regraId: string, detalhe: Record<string, unknown>): Promise<void> {
    await this.auditoria?.registrar({ tenantId, atorId, tipo: 'config', acao, entidadeTipo: 'mister_regra', entidadeId: regraId, origem: 'whatsapp', detalhe });
  }
}

/** As fontes que o motor sabe ler (a spec confere que o catálogo e a leitura andam juntos). */
export const FONTES_LIDAS: readonly NomeDaFonte[] = ['pedidos', 'contas', 'tarefas', 'equipamentos', 'caixas', 'canais', 'vendas'];
export { FONTES_DA_REGRA };
