import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { dataNoFuso, somarDias } from '../../common/data';
import { FUSO_SQL } from '../../common/fuso-sql';
import { ehServidorLocal } from '../../common/modo';
import { instanteDeSaoPaulo } from '../../common/pedido-agendado';
import { podeAcessar } from '../../auth/permissoes';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { EscopoDoMister, MisterFerramentasService } from './mister-ferramentas.service';
import { MisterNumeroService } from './mister-numero.service';
import {
  CALADO_DIAS,
  DIAS_OLHADOS,
  DadosDoPadrao,
  MINIMO_DE_AVISOS_SEM_RESPOSTA,
  PREFIXO_DO_PADRAO,
  AtrasosDaHora,
  ParadaDaImpressora,
  TEMPO_PADRAO_DO_PEDIDO_MIN,
  TEXTOS_DOS_PADROES,
  TipoDoPadrao,
  botoesDoPadrao,
  lerBotaoDoPadrao,
  nomeDaImpressora,
  padraoDosAtrasos,
  padroesDaImpressora,
  recadoDaImpressora,
  regraDoPadrao,
  textoDaSugestao,
} from './mister-padroes';
import { botaoDoRecado, ondeVai, textoDoRecado } from './mister-recado';
import { MisterRecadosService } from './mister-recados.service';
import { MisterRegrasService } from './mister-regras.service';
import { pessoaVale } from './mister-vinculo.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS PADRÕES E AS SUGESTÕES DO MISTER (versão 6, M6f parte 2; mig 478; `mister-padroes.ts` tem as regras puras). Uma volta
// por hora, das 9h às 20h de São Paulo, só na nuvem e só com `MISTER_PADROES=1` (nasce DESLIGADA — a regra do dono: o que
// é novo e manda mensagem nasce desligado; quem liga é ele). Cada volta olha as pessoas DENTRO da janela de 24 horas da
// Meta (a sugestão é texto com botões, sem custo; fora da janela ela espera a pessoa voltar a falar com o Mister) que ainda
// não receberam uma sugestão hoje, acha os padrões até ontem e manda UMA sugestão por pessoa. Pelo Evolution (QR Code) não
// há botões: a sugestão não sai (o recado também não sai por lá).

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => ['42P01', '42703'].includes(e?.code) || ['42P01', '42703'].includes(e?.cause?.code);
const TEMPOS_DO_PEDIDO = new Set([15, 20, 30]);

/** A volta dos padrões está ligada nesta instalação (a variável do EasyPanel; nasce desligada). */
export const padroesNaInstalacao = (): boolean => process.env.MISTER_PADROES === '1';

interface Pessoa {
  tenantId: string;
  colaboradorId: string;
  telefone: string;
  nivel: string;
  unidadeId: string | null;
}

interface Candidato {
  tipo: TipoDoPadrao;
  chave: string;
  unidadeId: string | null;
  dados: DadosDoPadrao;
}

export interface ResultadoDaVoltaDosPadroes {
  pessoas: number;
  achados: number;
  enviados: number;
}

@Injectable()
export class MisterPadroesService implements OnModuleInit {
  private readonly logger = new Logger('MisterPadroes');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ferramentas: MisterFerramentasService,
    private readonly regras: MisterRegrasService,
    private readonly numero: MisterNumeroService,
    @Optional() private readonly recados?: MisterRecadosService,
    @Optional() private readonly entrada?: MisterEntradaService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  onModuleInit(): void {
    this.entrada?.registrarBotao(PREFIXO_DO_PADRAO, (botaoId, quem) => this.tocou(botaoId, quem));
  }

  // De hora em hora, das 9h às 20h: a pessoa que voltou a falar com o Mister à tarde ainda recebe a do dia. A última vez de
  // cada pessoa fica no banco (`enviado_em`), então o deploy no meio do dia não repete nem perde o dia (V104).
  @Cron('0 9-20 * * *', { timeZone: 'America/Sao_Paulo' })
  async rotina(): Promise<void> {
    if (ehServidorLocal() || !padroesNaInstalacao()) return;
    try {
      const r = await this.volta();
      if (r.enviados) this.logger.log(`padrões: ${r.enviados} sugestão(ões) para ${r.pessoas} pessoa(s)`);
    } catch (e: any) {
      if (!semTabela(e)) this.logger.error(`a volta dos padrões falhou: ${String(e?.message ?? e).slice(0, 300)}`, e?.stack);
    }
  }

  /** Uma volta: acha os padrões de quem pode receber agora e manda até UMA sugestão por pessoa. `soEmpresas` = os testes. */
  async volta(soEmpresas?: string[], agora: Date = new Date()): Promise<ResultadoDaVoltaDosPadroes> {
    const res: ResultadoDaVoltaDosPadroes = { pessoas: 0, achados: 0, enviados: 0 };
    if (await this.numero.semJanela()) return res;
    const hoje = dataNoFuso(agora);
    const inicioDeHoje = instanteDeSaoPaulo(`${hoje}T00:00`)!;
    const inicioDeOntem = instanteDeSaoPaulo(`${somarDias(hoje, -1)}T00:00`)!;
    const inicioDoPeriodo = instanteDeSaoPaulo(`${somarDias(hoje, -DIAS_OLHADOS)}T00:00`)!;
    const so = soEmpresas?.length ? sql`and g.tenant_id in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;

    // As pessoas: ligadas, valendo, sem pausa, presidente ou gerente, dentro da janela (23 h, com folga) e sem sugestão hoje.
    const pessoas: Pessoa[] = linhas(
      await this.db.execute(sql`
        select g.tenant_id::text as "tenantId", g.colaborador_id::text as "colaboradorId", g.telefone,
               coalesce(p.nivel, f.categoria::text) as nivel, c.unidade_id::text as "unidadeId"
          from mister_vinculo g
          join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = g.tenant_id
         where g.ligado_em is not null and g.telefone is not null and g.pausado_em is null and ${pessoaVale()}
           and coalesce(p.nivel, f.categoria::text) in ('presidente', 'gerente')
           and g.ultima_entrada_em > ${agora}::timestamptz - interval '23 hours'
           and not exists (select 1 from mister_padrao x
                            where x.tenant_id = g.tenant_id and x.colaborador_id = g.colaborador_id and x.enviado_em >= ${inicioDeHoje}::timestamptz)
           ${so}`),
    ).map((l) => ({ ...l, unidadeId: l.unidadeId ?? null }));
    if (!pessoas.length) return res;
    res.pessoas = pessoas.length;
    const tenants = [...new Set(pessoas.map((p) => p.tenantId))];
    const em = (col: string) => sql`${sql.raw(col)} in (${sql.join(tenants.map((t) => sql`${t}::uuid`), sql`, `)})`;

    // O tempo do pedido parado de cada empresa (o do aviso; sem escolha, 20 min).
    const tempoDe = new Map<string, number>();
    for (const r of linhas(await this.db.execute(sql`select tenant_id::text as t, parametro from mister_aviso_regra where ${em('tenant_id')} and tipo = 'pedido_parado'`)))
      if (TEMPOS_DO_PEDIDO.has(Number(r.parametro))) tempoDe.set(r.t, Number(r.parametro));
    const tempo = (t: string) => tempoDe.get(t) ?? TEMPO_PADRAO_DO_PEDIDO_MIN;

    const porLoja = new Map<string, Candidato[]>(); // `${tenant}|${loja}` → os padrões da loja
    const daLoja = (t: string, u: string | null, c: Candidato) => {
      const k = `${t}|${u ?? ''}`;
      porLoja.set(k, [...(porLoja.get(k) ?? []), c]);
    };

    // 1) A impressora desligada antes do fechamento: as paradas dos últimos 14 dias × o horário do cardápio da loja.
    const paradas = linhas(
      await this.db.execute(sql`
        select i.tenant_id::text as "tenantId", i.unidade_id::text as "unidadeId", i.chave, i.evidencia, i.primeira_em as inicio,
               case when i.situacao <> 'aberto' then coalesce(i.fechado_em, i.ultima_em) end as voltou
          from vigia_incidente i
         where ${em('i.tenant_id')} and i.regra = 'impressora_parada'
           and i.primeira_em >= ${inicioDoPeriodo}::timestamptz and i.primeira_em < ${inicioDeHoje}::timestamptz
         limit 5000`),
    );
    if (paradas.length) {
      const horarios = new Map<string, unknown>();
      for (const h of linhas(await this.db.execute(sql`select tenant_id::text as t, unidade_id::text as u, horarios from cardapio_config where ${em('tenant_id')}`)))
        horarios.set(`${h.t}|${h.u ?? ''}`, h.horarios);
      const grupos = new Map<string, { t: string; u: string | null; lista: ParadaDaImpressora[] }>();
      for (const p of paradas) {
        const k = `${p.tenantId}|${p.unidadeId ?? ''}`;
        const g = grupos.get(k) ?? { t: p.tenantId, u: p.unidadeId ?? null, lista: [] as ParadaDaImpressora[] };
        g.lista.push({ chave: String(p.chave), nome: nomeDaImpressora(p.evidencia), inicio: new Date(p.inicio), voltou: p.voltou ? new Date(p.voltou) : null });
        grupos.set(k, g);
      }
      for (const [k, g] of grupos) {
        const h = (horarios.get(k) ?? horarios.get(`${g.t}|`)) as any;
        for (const x of padroesDaImpressora(g.lista, h, hoje))
          daLoja(g.t, g.u, { tipo: 'impressora_antes_do_fechamento', chave: `impressora:${x.chave}`, unidadeId: g.u, dados: { tipo: 'impressora_antes_do_fechamento', nome: x.nome, dias: x.dias, de: x.de, ate: x.ate } });
      }
    }

    // 3) Os atrasos na mesma faixa: os pedidos que levaram mais que o tempo do pedido parado do aceite até ficar pronto, por
    //    dia e hora de São Paulo (o agendado fica de fora: ele começa depois, de propósito).
    const atrasos = linhas(
      await this.db.execute(sql`
        select pe.tenant_id::text as "tenantId", pe.unidade_id::text as "unidadeId",
               to_char(pe.confirmado_em at time zone ${FUSO_SQL}, 'YYYY-MM-DD') as dia,
               extract(hour from pe.confirmado_em at time zone ${FUSO_SQL})::int as hora, count(*)::int as n
          from pedido_externo pe
          left join mister_aviso_regra r on r.tenant_id = pe.tenant_id and r.tipo = 'pedido_parado'
         where ${em('pe.tenant_id')} and pe.deleted_at is null and pe.agendamento is null
           and pe.criado_em >= ${inicioDoPeriodo}::timestamptz - interval '1 day' and pe.criado_em < ${inicioDeHoje}::timestamptz
           and pe.confirmado_em >= ${inicioDoPeriodo}::timestamptz and pe.confirmado_em < ${inicioDeHoje}::timestamptz
           and pe.pronto_em is not null
           and pe.pronto_em - pe.confirmado_em > make_interval(mins => case when r.parametro in (15, 20, 30) then r.parametro else ${TEMPO_PADRAO_DO_PEDIDO_MIN}::int end)
         group by 1, 2, 3, 4`),
    );
    const atrasosPorLoja = new Map<string, { t: string; u: string | null; l: AtrasosDaHora[] }>();
    for (const a of atrasos) {
      const k = `${a.tenantId}|${a.unidadeId ?? ''}`;
      const g = atrasosPorLoja.get(k) ?? { t: a.tenantId, u: a.unidadeId ?? null, l: [] as AtrasosDaHora[] };
      g.l.push({ dia: String(a.dia), hora: Number(a.hora), n: Number(a.n) });
      atrasosPorLoja.set(k, g);
    }
    for (const g of atrasosPorLoja.values()) {
      const x = padraoDosAtrasos(g.l);
      if (x) daLoja(g.t, g.u, { tipo: 'atrasos_na_faixa', chave: `atrasos:${g.u ?? 'empresa'}`, unidadeId: g.u, dados: { tipo: 'atrasos_na_faixa', parametro: tempo(g.t), ...x } });
    }

    // 2) Os avisos de pedido parado de ontem sem resposta: quantos chegaram a cada telefone (pelo final gravado na trilha,
    //    que só vale quando é único na empresa) e se a pessoa mandou alguma mensagem ao Mister depois do primeiro.
    const semResposta = new Map<string, number>(); // `${tenant}|${colaborador}` → avisos
    const recebidos = linhas(
      await this.db.execute(sql`
        select a.tenant_id::text as "tenantId", e->>'final' as final, count(*)::int as n, min((e->>'em')::timestamptz) as primeiro
          from mister_aviso a
          cross join lateral jsonb_array_elements(a.entregas) e
         where ${em('a.tenant_id')} and a.tipo = 'pedido_parado'
           and a.aberto_em >= ${inicioDeOntem}::timestamptz and a.aberto_em < ${inicioDeHoje}::timestamptz
           and e->>'fase' = 'abriu' and e->>'ok' = 'true' and e->>'destino' in ('presidente', 'gerente') and coalesce(e->>'final', '') <> ''
         group by 1, 2
        having count(*) >= ${MINIMO_DE_AVISOS_SEM_RESPOSTA}::int`),
    );
    if (recebidos.length) {
      const finais = new Map<string, number>();
      for (const v of linhas(
        await this.db.execute(sql`
          select tenant_id::text as t, right(telefone, 4) as final, count(*)::int as n
            from mister_vinculo where ${em('tenant_id')} and telefone is not null and ligado_em is not null group by 1, 2`),
      ))
        finais.set(`${v.t}|${v.final}`, Number(v.n));
      const alvo: { chave: string; telefone: string; desde: string; n: number }[] = [];
      for (const r of recebidos) {
        if (finais.get(`${r.tenantId}|${r.final}`) !== 1) continue;
        const p = pessoas.find((x) => x.tenantId === r.tenantId && x.telefone.endsWith(String(r.final)));
        if (p) alvo.push({ chave: `${p.tenantId}|${p.colaboradorId}`, telefone: p.telefone, desde: new Date(r.primeiro).toISOString(), n: Number(r.n) });
      }
      if (alvo.length) {
        const responderam = new Set(
          linhas(
            await this.db.execute(sql`
              select x->>'chave' as chave
                from jsonb_array_elements(${JSON.stringify(alvo)}::jsonb) x
               where exists (select 1 from mister_mensagem m
                              where m.recebida_em >= (x->>'desde')::timestamptz and m.recebida_em < ${inicioDeHoje}::timestamptz
                                and m.telefone = x->>'telefone')`),
          ).map((l) => String(l.chave)),
        );
        for (const a of alvo) if (!responderam.has(a.chave)) semResposta.set(a.chave, a.n);
      }
    }

    // As decisões que já existem (o padrão calado ou já sugerido nos últimos 30 dias não volta) e as regras que já cobrem.
    const bloqueados = new Set(
      linhas(
        await this.db.execute(sql`
          select tenant_id::text || '|' || colaborador_id::text || '|' || tipo || '|' || chave as k
            from mister_padrao where ${em('tenant_id')} and proxima_em > clock_timestamp()`),
      ).map((l) => String(l.k)),
    );
    const cobertos = new Set(
      linhas(
        await this.db.execute(sql`
          select distinct tenant_id::text || '|' || colaborador_id::text || '|' ||
                 case when fonte = 'equipamentos' then 'impressora_antes_do_fechamento' else 'avisos_sem_resposta' end as k
            from mister_regra
           where ${em('tenant_id')} and situacao in ('ativa', 'pausada')
             and (fonte = 'equipamentos' or 'pedido_parado' = any(substitui))`),
      ).map((l) => String(l.k)),
    );

    for (const p of pessoas) {
      const lista: Candidato[] = [];
      for (const [k, cs] of porLoja) {
        const [t, u] = k.split('|');
        // O gerente: a loja dele (o gerente sem loja vale para todas; o padrão sem loja vale para todos).
        if (t === p.tenantId && (p.nivel === 'presidente' || !p.unidadeId || !u || u === p.unidadeId)) lista.push(...cs);
      }
      const avisos = semResposta.get(`${p.tenantId}|${p.colaboradorId}`);
      if (avisos) lista.push({ tipo: 'avisos_sem_resposta', chave: 'aviso:pedido_parado', unidadeId: null, dados: { tipo: 'avisos_sem_resposta', avisos, parametro: tempo(p.tenantId) } });
      const livres = lista.filter((c) => !bloqueados.has(`${p.tenantId}|${p.colaboradorId}|${c.tipo}|${c.chave}`) && !cobertos.has(`${p.tenantId}|${p.colaboradorId}|${c.tipo}`));
      res.achados += livres.length;
      if (!livres.length) continue;
      const e = await this.ferramentas.escopo(p.tenantId, p.colaboradorId, p.telefone);
      if (!e) continue;
      for (const c of livres) {
        if (!this.regras.cabe(e, regraDoPadrao(c.dados))) continue; // a pessoa não poderia aceitar (o perfil não lê a fonte)
        if (await this.sugerir(p, e, c, inicioDeHoje)) res.enviados++;
        break; // uma sugestão por pessoa por dia
      }
    }
    return res;
  }

  /** Grava a sugestão (só se o padrão está livre e a pessoa não recebeu outra hoje) e manda. Devolve se saiu. */
  private async sugerir(p: Pessoa, e: EscopoDoMister, c: Candidato, hoje: Date): Promise<boolean> {
    const [r] = linhas(
      await this.db.execute(sql`
        insert into mister_padrao (tenant_id, colaborador_id, unidade_id, tipo, chave, dados, situacao, proxima_em)
        select ${p.tenantId}::uuid, ${p.colaboradorId}::uuid, ${c.unidadeId}::uuid, ${c.tipo}, ${c.chave}, ${JSON.stringify(c.dados)}::jsonb, 'enviado',
               clock_timestamp() + make_interval(days => ${CALADO_DIAS}::int)
         where not exists (select 1 from mister_padrao x
                            where x.tenant_id = ${p.tenantId}::uuid and x.colaborador_id = ${p.colaboradorId}::uuid and x.enviado_em >= ${hoje}::timestamptz)
        on conflict (tenant_id, colaborador_id, tipo, chave) do update
           set unidade_id = excluded.unidade_id, dados = excluded.dados, situacao = 'enviado', enviado_em = clock_timestamp(),
               respondido_em = null, proxima_em = excluded.proxima_em
         where mister_padrao.proxima_em <= clock_timestamp()
        returning id::text as id`),
    );
    if (!r) return false;
    const comRecado = c.tipo === 'impressora_antes_do_fechamento' && !!this.recados && (e.nivel === 'presidente' || podeAcessar(e.permissoes, 'mural'));
    try {
      await this.numero.enviar(p.telefone, { texto: textoDaSugestao(c.dados, comRecado), botoes: botoesDoPadrao(c.tipo, r.id, comRecado) });
      return true;
    } catch (err: any) {
      // Não saiu: tenta de novo amanhã (a pessoa pode ter saído da janela entre a leitura e o envio).
      await this.db.execute(sql`
        update mister_padrao set situacao = 'falhou', proxima_em = clock_timestamp() + interval '1 day' where id = ${r.id}::uuid`);
      this.logger.warn(`a sugestão ${r.id} (${c.tipo}) não saiu — ${String(err?.motivo ?? err?.message ?? err).slice(0, 200)}`);
      return false;
    }
  }

  // ───────────────────────────── os botões ─────────────────────────────

  /** O toque em "Avisar na hora"/"Quero", "Escrever o recado" ou "Não, deixa assim". `false` = não é botão daqui. */
  async tocou(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const b = lerBotaoDoPadrao(botaoId);
    if (!b || !quem.vinculos.length) return false;
    const [r] = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", colaborador_id::text as "colaboradorId", unidade_id::text as "unidadeId",
               tipo, chave, dados, situacao
          from mister_padrao
         where id = ${b.padraoId}::uuid and tenant_id in (${sql.join(quem.vinculos.map((v) => sql`${v.tenantId}::uuid`), sql`, `)})`),
    );
    if (!r) return false;
    // Só quem recebeu a sugestão responde por ela.
    if (!quem.vinculos.some((v) => v.tenantId === r.tenantId && v.colaboradorId === r.colaboradorId)) {
      await this.dizer(quem.telefone, TEXTOS_DOS_PADROES.naoDisponivel);
      return true;
    }
    // A resposta toma a sugestão (o segundo toque, ou o de outro aparelho, encontra "já respondida").
    const situacao = b.acao === 'nao' ? 'calado' : b.acao === 'rec' ? 'recado' : 'regra';
    const [tomada] = linhas(
      await this.db.execute(sql`
        update mister_padrao set situacao = ${situacao}, respondido_em = clock_timestamp(),
               proxima_em = clock_timestamp() + make_interval(days => ${CALADO_DIAS}::int)
         where id = ${r.id}::uuid and situacao = 'enviado' returning id`),
    );
    if (!tomada) {
      await this.dizer(quem.telefone, TEXTOS_DOS_PADROES.jaRespondido);
      return true;
    }
    const devolver = () => this.db.execute(sql`update mister_padrao set situacao = 'enviado', respondido_em = null where id = ${r.id}::uuid and situacao = ${situacao}`);
    if (b.acao === 'nao') {
      await this.auditar(r.tenantId, r.colaboradorId, 'mister_padrao_calado', r.id, { tipo: r.tipo, dias: CALADO_DIAS });
      await this.dizer(quem.telefone, TEXTOS_DOS_PADROES.calado);
      return true;
    }
    const e = await this.ferramentas.escopo(r.tenantId, r.colaboradorId, quem.telefone);
    if (!e) {
      await devolver();
      await this.dizer(quem.telefone, TEXTOS_DOS_PADROES.naoDisponivel);
      return true;
    }
    const dados = r.dados as DadosDoPadrao;
    if (b.acao === 'regra') {
      const p = await this.regras.proporDoPadrao(e, regraDoPadrao(dados));
      if (!p.ok) {
        await devolver();
        await this.dizer(quem.telefone, String((p.dados as any)?.erro ?? TEXTOS_DOS_PADROES.falhou));
        return true;
      }
      await this.numero.enviar(quem.telefone, { texto: TEXTOS_DOS_PADROES.confirme(String((p.dados as any)?.oQueVouFazer ?? '')), botoes: p.botoes ?? [] });
      return true;
    }
    // O recado da impressora: o Mister escreve; quem publica é a pessoa, pelo "Publicar" (o mesmo do recado da conversa).
    const recado = await this.escreverRecado(e, r.unidadeId ?? null, dados);
    if ('erro' in recado) {
      await devolver();
      await this.dizer(quem.telefone, recado.erro);
      return true;
    }
    await this.numero.enviar(quem.telefone, {
      texto: TEXTOS_DOS_PADROES.recadoAntes(recado.texto, ondeVai(recado.lojaNome)),
      botoes: [botaoDoRecado('pub', recado.id), botaoDoRecado('mudar', recado.id)],
    });
    return true;
  }

  private async escreverRecado(e: EscopoDoMister, unidadeId: string | null, d: DadosDoPadrao): Promise<{ id: string; texto: string; lojaNome: string } | { erro: string }> {
    if (d.tipo !== 'impressora_antes_do_fechamento' || !this.recados) return { erro: TEXTOS_DOS_PADROES.falhou };
    if (e.nivel !== 'presidente' && !podeAcessar(e.permissoes, 'mural')) return { erro: 'O seu perfil no Regem não abre o Mural & clima: o recado não sai por aqui.' };
    // A loja do padrão (a do servidor da impressora); sem ela, a única loja da empresa ou todas.
    const loja = unidadeId ? e.lojas.find((l) => l.id === unidadeId) : e.lojaUnica ? e.lojas[0] : undefined;
    if (unidadeId && !loja) return { erro: TEXTOS_DOS_PADROES.naoDisponivel };
    const t = textoDoRecado(recadoDaImpressora(d.nome));
    if ('erro' in t) return { erro: t.erro };
    const lojaNome = loja ? loja.nome : 'todas as lojas';
    const r = await this.recados.criar(e, { unidadeId: loja?.id ?? null, lojaNome, texto: t.texto });
    return 'erro' in r ? r : { id: r.id, texto: t.texto, lojaNome };
  }

  private async dizer(telefone: string, texto: string): Promise<void> {
    await this.numero.enviar(telefone, { texto }).catch((e: any) => this.logger.warn(`a resposta do padrão não saiu — ${e?.message ?? e}`));
  }

  private async auditar(tenantId: string, atorId: string, acao: string, padraoId: string, detalhe: Record<string, unknown>): Promise<void> {
    await this.auditoria?.registrar({ tenantId, atorId, tipo: 'config', acao, entidadeTipo: 'mister_padrao', entidadeId: padraoId, origem: 'whatsapp', detalhe });
  }
}
