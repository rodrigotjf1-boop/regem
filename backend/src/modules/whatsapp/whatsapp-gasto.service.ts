import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SQL, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { FUSO_OPERACAO, dataNoFuso, somarDias } from '../../common/data';
import {
  DIAS_DE_HISTORICO_DE_MODELO,
  HORAS_ENTRE_LEITURAS_DE_MODELO,
  MESES_DE_HISTORICO,
  MINUTOS_ENTRE_LEITURAS,
  LinhaDoGasto,
  LinhaDoModelo,
  LinhaSomada,
  arredondar2,
  erroDaMeta,
  finalDoNumero,
  franquiaPorNumero,
  grupoDaCategoria,
  inicioDoDiaEmSegundos,
  linhasDeModeloPorDia,
  linhasPorDia,
  mesesAntes,
  nomeDoModelo,
  papelDoNumero,
  periodoDaConsulta,
  pontosDoModelo,
  pontosDoPreco,
  primeiroDoMes,
  projecaoDoMes,
  resumoDasLinhas,
  soDigitos,
} from './whatsapp-gasto';

/* eslint-disable @typescript-eslint/no-explicit-any */

const GRAPH = 'https://graph.facebook.com/v25.0';
/** Uma chamada à Meta não espera mais que isto (a rotina segue para a próxima conta). */
const PRAZO_DA_META_MS = 20_000;
/** A HALF_HOUR é lida em pedaços de uma semana (a Meta não diz o limite do intervalo). */
const DIAS_POR_PEDACO = 7;
/** "Tentar de novo" da tela: não lê de novo se a última tentativa foi há menos que isto. */
const MINUTOS_ENTRE_TENTATIVAS_DA_TELA = 2;

type Conta = { tenantId: string; wabaId: string };
type Resposta = { status: number; json: any };

/**
 * O GASTO DO WHATSAPP OFICIAL (G1 do protótipo `mockups/regem-whatsapp-gasto.html`, aprovado em 18/11/2026; mig 445).
 *
 * A ROTINA (só na NUVEM, a cada 30 minutos): para cada conta oficial (WABA) de empresa viva — uma consulta para todas —,
 * lê na Meta a consulta de preço (`pricing_analytics`, de meia em meia hora, desde a meia-noite de ontem no fuso da loja)
 * e reescreve esses dias em `whatsapp_gasto` (apaga o intervalo e grava de novo, com `on conflict` — duas réplicas lendo
 * juntas não duplicam nem quebram). Na primeira vez, a carga: o mês corrente de meia em meia hora e os 12 meses anteriores
 * por dia. De 3 em 3 horas, o gasto por modelo (`template_analytics`, o "De onde veio"). A situação de cada leitura fica
 * em `whatsapp_gasto_leitura`; a rotina nunca derruba nada — a falha vira o motivo, e a próxima volta tenta de novo.
 *
 * A TELA (WhatsApp › Uso e gasto, só o presidente — a rota confere): lê só o que foi guardado, nunca a Meta ao vivo.
 */
@Injectable()
export class WhatsappGastoService {
  private readonly logger = new Logger('WhatsappGasto');
  private rodando = false;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private token(): string {
    return process.env.WA_CLOUD_TOKEN ?? '';
  }

  /** Uma chamada GET à Meta (à parte para o teste trocar pela resposta pronta). Nunca rejeita por status: devolve. */
  protected async getMeta(caminho: string): Promise<Resposta> {
    const res = await fetch(`${GRAPH}/${caminho}`, {
      headers: { Authorization: `Bearer ${this.token()}` },
      signal: AbortSignal.timeout(PRAZO_DA_META_MS),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  /** Liga as métricas da conta (idempotente; a Meta exige antes do `template_analytics`). Falha não impede a leitura. */
  protected async ligarMetricas(wabaId: string): Promise<void> {
    await fetch(`${GRAPH}/${wabaId}?is_enabled_for_insights=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token()}` },
      signal: AbortSignal.timeout(PRAZO_DA_META_MS),
    }).catch(() => null);
  }

  // ───────────────────────────── a rotina ─────────────────────────────

  @Interval(MINUTOS_ENTRE_LEITURAS * 60_000)
  async rotina(): Promise<number> {
    if (ehServidorLocal() || this.rodando || !this.token()) return 0;
    this.rodando = true;
    try {
      let n = 0;
      for (const c of await this.contasParaLer(new Date())) {
        await this.lerConta(c.tenantId, c.wabaId);
        n++;
      }
      return n;
    } catch (e: any) {
      this.logger.warn(`gasto do WhatsApp oficial: a volta falhou — ${e?.message ?? e}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }

  /** As contas oficiais de todas as empresas vivas cuja última tentativa já passou do intervalo. Uma consulta só. */
  async contasParaLer(agora: Date): Promise<Conta[]> {
    const limite = new Date(agora.getTime() - (MINUTOS_ENTRE_LEITURAS - 5) * 60_000);
    const r: any = await this.db.execute(sql`
      select x.tenant_id, x.waba_id
        from (${WhatsappGastoService.sqlContas()}) x
        join empresa e on e.id = x.tenant_id and e.deleted_at is null and coalesce(e.status, 'ativo') = 'ativo'
        left join whatsapp_gasto_leitura l on l.tenant_id = x.tenant_id and l.waba_id = x.waba_id
       where l.tentou_em is null or l.tentou_em < ${limite.toISOString()}::timestamptz
       order by l.tentou_em nulls first, x.tenant_id, x.waba_id
       limit 500`);
    return (r?.rows ?? r ?? []).map((x: any) => ({ tenantId: String(x.tenant_id), wabaId: String(x.waba_id) }));
  }

  /** As contas oficiais (WABA) por empresa: as dos números da API oficial e a da configuração do cardápio. */
  static sqlContas(tenantId?: string): SQL {
    const so = tenantId ? sql` and tenant_id = ${tenantId}::uuid` : sql``;
    return sql`
      select tenant_id, waba_id from whatsapp_numero
       where provedor = 'cloud' and unidade_id is null and coalesce(waba_id, '') <> ''${so}
      union
      select tenant_id, wa_cloud_waba_id from cardapio_config
       where provedor = 'cloud' and unidade_id is null and coalesce(wa_cloud_waba_id, '') <> ''${so}`;
  }

  /**
   * Lê uma conta: a consulta de preço (o que mudou desde ontem; na primeira vez, a carga dos 12 meses) e, de 3 em 3 horas,
   * o gasto por modelo. Grava e anota a situação. Nunca rejeita: a falha vira o motivo da leitura.
   */
  async lerConta(tenantId: string, wabaId: string, agora: Date = new Date()): Promise<{ ok: boolean; erro?: string }> {
    const hoje = dataNoFuso(agora);
    const fim = Math.floor(agora.getTime() / 1000);
    const [lei]: any[] = (
      (await this.db.execute(sql`select lido_em, historico_ate, modelos_lidos_em from whatsapp_gasto_leitura
         where tenant_id = ${tenantId}::uuid and waba_id = ${wabaId}`)) as any
    ).rows ?? [];
    try {
      // 1) De meia em meia hora: desde a meia-noite de ontem; na primeira leitura, desde o dia 1º do mês de ontem (o dia
      //    1º lê inteiro o mês que acabou de fechar).
      const deDia = lei?.lido_em ? somarDias(hoje, -1) : primeiroDoMes(somarDias(hoje, -1));
      let moeda: string | null = null;
      const linhas: LinhaDoGasto[] = [];
      for (let d = deDia; d <= hoje; d = somarDias(d, DIAS_POR_PEDACO)) {
        const ini = inicioDoDiaEmSegundos(d);
        const ate = Math.min(fim, inicioDoDiaEmSegundos(somarDias(d, DIAS_POR_PEDACO)));
        if (ate <= ini) break;
        const r = await this.consultaDePreco(wabaId, ini, ate, 'HALF_HOUR');
        moeda = r.moeda ?? moeda;
        linhas.push(...r.linhas);
      }
      await this.gravarDias(tenantId, wabaId, deDia, hoje, linhas.filter((l) => l.dia >= deDia && l.dia <= hoje));

      // 2) A carga dos meses anteriores, uma vez, por dia (o ponto diário da Meta é em UTC: na virada do mês, horas de
      //    diferença). A Meta guarda um ano: começa no mais novo entre 12 meses antes e 364 dias atrás. Se falhar, a
      //    leitura do mês vale do mesmo jeito e a carga tenta de novo na próxima volta.
      let historicoOk = !!lei?.historico_ate;
      if (!historicoOk) {
        try {
          const ateHist = somarDias(primeiroDoMes(hoje), -1);
          const umAno = somarDias(hoje, -364);
          const deHist = mesesAntes(hoje, MESES_DE_HISTORICO) > umAno ? mesesAntes(hoje, MESES_DE_HISTORICO) : umAno;
          if (deHist <= ateHist) {
            const r = await this.consultaDePreco(wabaId, Date.parse(`${deHist}T00:00:00Z`) / 1000, Date.parse(`${primeiroDoMes(hoje)}T00:00:00Z`) / 1000, 'DAILY');
            moeda = r.moeda ?? moeda;
            // O mês de ontem (quando hoje é dia 1º) já veio de meia em meia hora no passo 1: a carga não o reescreve.
            const ateCarga = ateHist < deDia ? ateHist : somarDias(deDia, -1);
            if (deHist <= ateCarga) await this.gravarDias(tenantId, wabaId, deHist, ateCarga, r.linhas.filter((l) => l.dia >= deHist && l.dia <= ateCarga));
          }
          historicoOk = true;
        } catch (e: any) {
          this.logger.warn(`a carga dos meses anteriores da conta ${wabaId} (empresa ${tenantId}) falhou: ${e?.message ?? e}`);
        }
      }

      // 3) O gasto por modelo, de 3 em 3 horas (o que der errado aqui não derruba a leitura do preço).
      const modelosVencidos =
        !lei?.modelos_lidos_em || new Date(lei.modelos_lidos_em).getTime() < agora.getTime() - HORAS_ENTRE_LEITURAS_DE_MODELO * 3_600_000;
      let modelosOk = false;
      if (modelosVencidos) {
        try {
          const deModelo = lei?.modelos_lidos_em ? primeiroDoMes(somarDias(hoje, -1)) : somarDias(hoje, -(DIAS_DE_HISTORICO_DE_MODELO - 1));
          await this.lerModelos(tenantId, wabaId, deModelo, hoje, fim);
          modelosOk = true;
        } catch (e: any) {
          this.logger.warn(`gasto por modelo da conta ${wabaId} (empresa ${tenantId}): ${e?.message ?? e}`);
        }
      }

      await this.db.execute(sql`
        insert into whatsapp_gasto_leitura (tenant_id, waba_id, lido_em, tentou_em, erro, moeda, historico_ate, modelos_lidos_em)
        values (${tenantId}::uuid, ${wabaId}, ${agora.toISOString()}::timestamptz, ${agora.toISOString()}::timestamptz, null, ${moeda},
                ${historicoOk ? hoje : null}::date, ${modelosOk ? agora.toISOString() : null}::timestamptz)
        on conflict (tenant_id, waba_id) do update set
          lido_em = excluded.lido_em, tentou_em = excluded.tentou_em, erro = null,
          moeda = coalesce(excluded.moeda, whatsapp_gasto_leitura.moeda),
          historico_ate = coalesce(whatsapp_gasto_leitura.historico_ate, excluded.historico_ate),
          modelos_lidos_em = coalesce(excluded.modelos_lidos_em, whatsapp_gasto_leitura.modelos_lidos_em)`);
      return { ok: true };
    } catch (e: any) {
      const erro = String(e?.name === 'TimeoutError' ? 'A Meta não respondeu a tempo.' : (e?.message ?? e)).slice(0, 300);
      this.logger.warn(`gasto do WhatsApp oficial da conta ${wabaId} (empresa ${tenantId}): ${erro}`);
      await this.db
        .execute(sql`
          insert into whatsapp_gasto_leitura (tenant_id, waba_id, tentou_em, erro)
          values (${tenantId}::uuid, ${wabaId}, ${agora.toISOString()}::timestamptz, ${erro})
          on conflict (tenant_id, waba_id) do update set tentou_em = excluded.tentou_em, erro = excluded.erro`)
        .catch((g: any) => this.logger.warn(`a situação da leitura não foi gravada: ${g?.message ?? g}`));
      return { ok: false, erro };
    }
  }

  /** A consulta de preço de um intervalo. Status diferente de 200: erro com a mensagem da Meta. */
  private async consultaDePreco(wabaId: string, inicio: number, fim: number, granularidade: 'HALF_HOUR' | 'DAILY') {
    const campos =
      `currency,pricing_analytics.start(${Math.floor(inicio)}).end(${Math.floor(fim)}).granularity(${granularidade})` +
      `.metric_types(COST,VOLUME).dimensions(PRICING_CATEGORY,PRICING_TYPE,PHONE)`;
    const r = await this.getMeta(`${wabaId}?fields=${encodeURIComponent(campos)}`);
    if (r.status !== 200) throw new Error(erroDaMeta(r.status, r.json));
    const moeda = typeof r.json?.currency === 'string' && r.json.currency ? String(r.json.currency) : null;
    return { moeda, linhas: linhasPorDia(pontosDoPreco(r.json), FUSO_OPERACAO) };
  }

  /** Reescreve os dias `de`…`ate` da conta: apaga e grava, numa transação (o `on conflict` cobre a outra réplica). */
  async gravarDias(tenantId: string, wabaId: string, de: string, ate: string, linhas: LinhaDoGasto[]): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      await tx.execute(sql`delete from whatsapp_gasto where tenant_id = ${tenantId}::uuid and waba_id = ${wabaId}
                             and dia >= ${de}::date and dia <= ${ate}::date`);
      if (!linhas.length) return;
      const valores = sql.join(
        linhas.map((l) => sql`(${tenantId}::uuid, ${wabaId}, ${l.numero}, ${l.dia}::date, ${l.categoria}, ${l.tipo}, ${l.mensagens}, ${l.custo})`),
        sql`, `,
      );
      await tx.execute(sql`
        insert into whatsapp_gasto (tenant_id, waba_id, numero, dia, categoria, tipo, mensagens, custo)
        values ${valores}
        on conflict (tenant_id, waba_id, numero, dia, categoria, tipo) do update set
          mensagens = excluded.mensagens, custo = excluded.custo, lido_em = now()`);
    });
  }

  /** O gasto por modelo de `de` a hoje: a lista dos modelos da conta, o `template_analytics` de 10 em 10 e a gravação. */
  private async lerModelos(tenantId: string, wabaId: string, de: string, ate: string, fim: number): Promise<void> {
    const modelos = new Map<string, { nome: string; categoria: string | null }>();
    let caminho: string | null = `${wabaId}/message_templates?fields=${encodeURIComponent('id,name,category')}&limit=250`;
    for (let pagina = 0; caminho && pagina < 8; pagina++) {
      const r = await this.getMeta(caminho);
      if (r.status !== 200) throw new Error(erroDaMeta(r.status, r.json));
      for (const t of Array.isArray(r.json?.data) ? r.json.data : []) {
        if (t?.id) modelos.set(String(t.id), { nome: String(t?.name ?? t.id), categoria: t?.category ? String(t.category).toUpperCase() : null });
      }
      const prox = r.json?.paging?.next ? String(r.json.paging.next) : '';
      caminho = prox.startsWith(`${GRAPH}/`) ? prox.slice(GRAPH.length + 1) : null;
    }
    const ids = [...modelos.keys()];
    const linhas: LinhaDoModelo[] = [];
    if (ids.length) {
      await this.ligarMetricas(wabaId);
      const ini = inicioDoDiaEmSegundos(de);
      for (let i = 0; i < ids.length; i += 10) {
        const lote = ids.slice(i, i + 10);
        let pag: string | null =
          `${wabaId}/template_analytics?start=${ini}&end=${fim}&granularity=DAILY` +
          `&template_ids=${encodeURIComponent(JSON.stringify(lote))}&metric_types=${encodeURIComponent(JSON.stringify(['DELIVERED', 'COST']))}`;
        for (let pagina = 0; pag && pagina < 20; pagina++) {
          const r = await this.getMeta(pag);
          if (r.status !== 200) throw new Error(erroDaMeta(r.status, r.json));
          linhas.push(...linhasDeModeloPorDia(pontosDoModelo(r.json), FUSO_OPERACAO));
          const prox = r.json?.paging?.next ? String(r.json.paging.next) : '';
          pag = prox.startsWith(`${GRAPH}/`) ? prox.slice(GRAPH.length + 1) : null;
        }
      }
    }
    // O mesmo modelo e dia podem vir em duas páginas: soma antes de gravar.
    const somadas = new Map<string, LinhaDoModelo>();
    for (const l of linhas.filter((x) => x.dia >= de && x.dia <= ate)) {
      const k = `${l.dia}|${l.modeloId}`;
      const s = somadas.get(k) ?? { ...l, mensagens: 0, custo: 0 };
      s.mensagens += l.mensagens;
      s.custo += l.custo;
      somadas.set(k, s);
    }
    await this.db.transaction(async (tx: any) => {
      await tx.execute(sql`delete from whatsapp_gasto_modelo where tenant_id = ${tenantId}::uuid and waba_id = ${wabaId}
                             and dia >= ${de}::date and dia <= ${ate}::date`);
      const lista = [...somadas.values()].filter((l) => l.mensagens > 0 || l.custo > 0);
      if (!lista.length) return;
      const valores = sql.join(
        lista.map((l) => {
          const m = modelos.get(l.modeloId);
          return sql`(${tenantId}::uuid, ${wabaId}, ${l.dia}::date, ${l.modeloId}, ${m?.nome ?? l.modeloId}, ${m?.categoria ?? null}, ${l.mensagens}, ${l.custo})`;
        }),
        sql`, `,
      );
      await tx.execute(sql`
        insert into whatsapp_gasto_modelo (tenant_id, waba_id, dia, modelo_id, modelo_nome, categoria, mensagens, custo)
        values ${valores}
        on conflict (tenant_id, waba_id, dia, modelo_id) do update set
          modelo_nome = excluded.modelo_nome, categoria = excluded.categoria,
          mensagens = excluded.mensagens, custo = excluded.custo, lido_em = now()`);
    });
  }

  // ───────────────────────────── a tela ─────────────────────────────

  /** "Tentar de novo": lê agora as contas da empresa (não se a última tentativa foi há menos de 2 minutos). */
  async lerAgora(tenantId: string, q: any, agora: Date = new Date()) {
    const contas = await this.contasDaEmpresa(tenantId);
    if (!contas.length) return this.resumo(tenantId, q, agora);
    const r: any = await this.db.execute(sql`select max(tentou_em) as t from whatsapp_gasto_leitura where tenant_id = ${tenantId}::uuid`);
    const ultima = (r?.rows ?? r ?? [])[0]?.t;
    if (ultima && new Date(ultima).getTime() > agora.getTime() - MINUTOS_ENTRE_TENTATIVAS_DA_TELA * 60_000)
      throw new BadRequestException('O Regem acabou de ler o gasto na Meta. Tente de novo em 2 minutos.');
    if (!this.token()) throw new BadRequestException('A leitura do gasto não está disponível agora.');
    for (const c of contas) await this.lerConta(tenantId, c.wabaId, agora);
    return this.resumo(tenantId, q, agora);
  }

  private async contasDaEmpresa(tenantId: string): Promise<{ wabaId: string }[]> {
    const r: any = await this.db.execute(sql`select distinct waba_id from (${WhatsappGastoService.sqlContas(tenantId)}) x order by waba_id`);
    return (r?.rows ?? r ?? []).map((x: any) => ({ wabaId: String(x.waba_id) }));
  }

  /** O resumo da tela, do que foi guardado. Sem conta oficial: `{ oficial: false }` (a loja na conexão por QR Code). */
  async resumo(tenantId: string, q: any, agora: Date = new Date()) {
    const hoje = dataNoFuso(agora);
    const periodo = periodoDaConsulta(q ?? {}, hoje);
    const contas = await this.contasDaEmpresa(tenantId);
    if (!contas.length) return { oficial: false as const };
    const linhasDe = async (s: SQL) => {
      const r: any = await this.db.execute(s);
      return (r?.rows ?? r ?? []) as any[];
    };

    const nums = await linhasDe(sql`select papel, numero, waba_id from whatsapp_numero
      where tenant_id = ${tenantId}::uuid and provedor = 'cloud' and unidade_id is null order by papel`);
    const leituras = await linhasDe(sql`select waba_id, lido_em, tentou_em, erro, moeda from whatsapp_gasto_leitura
      where tenant_id = ${tenantId}::uuid`);

    // O filtro de número: só um número que a empresa tem (pelo final) — senão, todos.
    const pedido = soDigitos(q?.numero ?? '');
    const filtroNumero = pedido && papelDoNumero(pedido, nums) ? pedido : '';
    const wabaDoFiltro = filtroNumero ? (nums.find((n) => papelDoNumero(filtroNumero, [n]))?.waba_id ?? null) : null;
    const soNumero = filtroNumero ? sql` and right(numero, 8) = ${finalDoNumero(filtroNumero)}` : sql``;

    const linhas = (await linhasDe(sql`
      select numero, dia::text as dia, categoria, tipo, sum(mensagens)::int as mensagens, sum(custo)::float8 as custo
        from whatsapp_gasto
       where tenant_id = ${tenantId}::uuid and dia >= ${periodo.de}::date and dia <= ${periodo.ate}::date${soNumero}
       group by 1, 2, 3, 4`)) as LinhaSomada[];
    // A franquia é sempre a do mês corrente (vale em qualquer período escolhido).
    const doMes: LinhaSomada[] = (
      await linhasDe(sql`
        select numero, sum(mensagens)::int as mensagens from whatsapp_gasto
         where tenant_id = ${tenantId}::uuid and dia >= ${primeiroDoMes(hoje)}::date and dia <= ${hoje}::date and categoria = 'SERVICE'
         group by 1`)
    ).map((l) => ({ numero: String(l.numero), dia: hoje, categoria: 'SERVICE', tipo: 'TODOS', mensagens: Number(l.mensagens) || 0, custo: 0 }));
    const meses = await linhasDe(sql`
      select to_char(dia, 'YYYY-MM') as mes, sum(custo)::float8 as custo,
             (sum(mensagens) filter (where tipo = 'REGULAR'))::int as cobradas, sum(mensagens)::int as mensagens
        from whatsapp_gasto
       where tenant_id = ${tenantId}::uuid and dia >= ${mesesAntes(hoje, MESES_DE_HISTORICO)}::date and dia < ${primeiroDoMes(hoje)}::date${soNumero}
       group by 1 order by 1 desc`);
    const soConta = wabaDoFiltro ? sql` and waba_id = ${wabaDoFiltro}` : sql``;
    const modelos = await linhasDe(sql`
      select modelo_nome, max(categoria) as categoria, sum(mensagens)::int as mensagens, sum(custo)::float8 as custo
        from whatsapp_gasto_modelo
       where tenant_id = ${tenantId}::uuid and dia >= ${periodo.de}::date and dia <= ${periodo.ate}::date${soConta}
       group by 1 having sum(custo) > 0 or sum(mensagens) > 0
       order by sum(custo) desc, sum(mensagens) desc limit 15`);
    // As campanhas do período que usaram cada modelo (o "campanha de 14/11" do "De onde veio").
    const nomes = modelos.map((m) => String(m.modelo_nome));
    const campanhas = nomes.length
      ? await linhasDe(sql`
          select template_nome, max(criado_em) as em, count(*)::int as n from campanha
           where tenant_id = ${tenantId}::uuid and template_nome in (${sql.join(nomes.map((n) => sql`${n}`), sql`, `)})
             and criado_em >= (${periodo.de}::date - 1)::timestamptz
           group by 1`)
      : [];

    const resumo = resumoDasLinhas(linhas, periodo);
    const papel = (numero: string) => papelDoNumero(numero, nums);
    const atendimento = resumo.tipos.find((t) => t.grupo === 'atendimento');
    const deOndeVeio = [
      ...modelos.map((m) => {
        const c = campanhas.find((x) => x.template_nome === m.modelo_nome);
        const grupo = grupoDaCategoria(m.categoria);
        const quando = c ? dataNoFuso(new Date(c.em)).split('-').reverse().slice(0, 2).join('/') : '';
        return {
          nome: nomeDoModelo(m.modelo_nome),
          apoio: c ? (c.n > 1 ? `${c.n} campanhas · a última em ${quando}` : `campanha de ${quando}`) : grupo === 'utilidade' ? 'aviso do pedido' : 'modelo',
          grupo,
          mensagens: Number(m.mensagens) || 0,
          custo: arredondar2(Number(m.custo) || 0),
        };
      }),
      ...(atendimento && atendimento.mensagens > 0
        ? [{ nome: 'Respostas do robô e da equipe', apoio: `${atendimento.gratis} grátis · ${atendimento.cobradas} cobradas`, grupo: 'atendimento', mensagens: atendimento.mensagens, custo: atendimento.custo }]
        : []),
    ];

    // A leitura das contas que a empresa tem HOJE (uma conta que saiu não segura o "lido às").
    const dasContas = leituras.filter((l) => contas.some((c) => c.wabaId === String(l.waba_id)));
    const lidos = contas.map((c) => {
      const l = dasContas.find((x) => String(x.waba_id) === c.wabaId);
      return l?.lido_em ? new Date(l.lido_em).getTime() : 0;
    });
    const comErro = dasContas.find((l) => l.erro);
    const numeroDaConta = (waba: string) => {
      const n = nums.find((x) => x.waba_id === waba);
      return n ? { papel: n.papel as string, final: soDigitos(n.numero).slice(-4) } : null;
    };
    return {
      oficial: true as const,
      periodo,
      leitura: {
        // A leitura mais antiga das contas (o número só está em dia quando TODAS estão); nenhuma lida: null.
        lidoEm: lidos.every((x) => x > 0) ? new Date(Math.min(...lidos)).toISOString() : null,
        algumaLida: lidos.some((x) => x > 0),
        tentouEm: dasContas.some((l) => l.tentou_em) ? new Date(Math.max(...dasContas.map((l) => (l.tentou_em ? new Date(l.tentou_em).getTime() : 0)))).toISOString() : null,
        erro: comErro ? { motivo: String(comErro.erro), conta: numeroDaConta(String(comErro.waba_id)) } : null,
        moeda: dasContas.find((l) => l.moeda)?.moeda ?? null,
        minutos: MINUTOS_ENTRE_LEITURAS,
      },
      total: resumo.total,
      projecao: periodo.mesCorrente ? projecaoDoMes(resumo.total.custo, agora) : null,
      tipos: resumo.tipos,
      dias: resumo.dias,
      franquia: franquiaPorNumero(doMes).map((f) => ({ ...f, papel: papel(f.numero), final: f.numero.slice(-4) })),
      numeros: nums
        .filter((n) => soDigitos(n.numero))
        .map((n) => ({ numero: soDigitos(n.numero), papel: String(n.papel), final: soDigitos(n.numero).slice(-4) })),
      filtroNumero: filtroNumero || null,
      meses: meses.map((m) => ({ mes: String(m.mes), custo: arredondar2(Number(m.custo) || 0), cobradas: Number(m.cobradas) || 0, mensagens: Number(m.mensagens) || 0 })),
      deOndeVeio,
    };
  }
}
