import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { Permissoes, perfilPadrao, podeAcessar } from '../../auth/permissoes';
import { FUSO_OPERACAO, hojeISO, horaAgora, horaNoFuso, somarDias } from '../../common/data';
import { brutoPedido, comandaEhDeCanal } from '../../common/faturamento';
import { sqlUnidade, sqlUnidadeOuRede } from '../../common/filtro-unidade';
import { FUSO_SQL, noPeriodo } from '../../common/fuso-sql';
import { DashboardService } from '../dashboard/dashboard.service';
import { DeliveryService } from '../delivery/delivery.service';
import { EscalaService } from '../escala/escala.service';
import { EstoqueService } from '../estoque/estoque.service';
import { LicencaService } from '../licenca/licenca.service';
import { ModuloService } from '../modulo/modulo.service';
import { PontoService } from '../ponto/ponto.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { RelatoriosService } from '../relatorios/relatorios.service';
import { VendasService } from '../vendas/vendas.service';
import { pessoaVale } from './mister-vinculo.service';
import {
  ConversaDoMister,
  NivelDoMister,
  NomeDaFerramenta,
  diaDaFerramenta,
  diaMes,
  ehFerramenta,
  lojaPedida,
  periodoDaFerramenta,
  semAcento,
} from './mister-agente.regras';
import { primeiroNome } from './mister.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS FERRAMENTAS DO MISTER (mig 418): o que o agente consegue LER, e de quem.
//
//  • Cada ferramenta chama o serviço que já alimenta uma tela do Regem (o Painel, Relatórios de vendas, o quadro do
//    Delivery, a fila da cozinha, o Estoque, o Servidor local). O número do Mister é o da tela — nenhuma conta nova aqui.
//  • O ESCOPO vem do servidor, nunca do modelo: a empresa e a pessoa são as do telefone ligado; a loja segue a MESMA
//    régua do `@UnidadeAtual()` das rotas (empresa de uma loja só = sem filtro; pessoa de uma loja = só a dela;
//    presidente = a loja que ele nomear ou todas; qualquer outro sem loja = nada). O modelo só consegue NOMEAR uma loja,
//    e o nome é procurado entre as lojas que a pessoa consulta.
//  • As PERMISSÕES são as do perfil da pessoa, as mesmas das rotas: quem não abre a tela não recebe o dado pelo Mister,
//    e quem não vê valores em reais recebe os valores nulos, com o aviso.
//  • Só leitura. Uma ferramenta que falha devolve "não consegui ler" (com o motivo no log) — nunca um dado pela metade.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.code === '42703';
const MODULO = 'mister';
const SEM_VALORES = 'O perfil desta pessoa no Regem não mostra valores em reais: os valores vêm vazios.';
const SEM_PERMISSAO = 'O perfil desta pessoa no Regem não dá acesso a esta informação. Quem muda o perfil é o presidente.';
const SEM_LOJA = 'O cadastro desta pessoa não está ligado a uma loja. Ela precisa pedir ao presidente para acertar o cadastro no Regem.';

/** De quem é a conversa — resolvido no servidor a cada pergunta. O modelo nunca escreve nada disto. */
export interface EscopoDoMister {
  tenantId: string;
  colaboradorId: string;
  empresa: string;
  nome: string;
  nivel: NivelDoMister;
  /** As lojas que a pessoa consulta: as da empresa (presidente) ou só a dela. */
  lojas: { id: string; nome: string }[];
  /** A empresa tem uma loja só: nenhum filtro de loja, como nas rotas. */
  lojaUnica: boolean;
  /** A loja a que a pessoa está presa — ou null. */
  presa: string | null;
  /** Não é presidente e não tem loja, numa empresa de várias: não enxerga nada. */
  semLoja: boolean;
  permissoes: Permissoes;
  verValores: boolean;
}

export interface ResultadoDaFerramenta {
  ok: boolean;
  /** O que volta para o modelo (vira JSON). Com `ok: false`, `{ erro }`. */
  dados: Record<string, unknown>;
}

const reais = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const inteiro = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};
const quantidade = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
};
const minutosDesde = (quando: unknown, agora: number): number | null => {
  const t = quando instanceof Date ? quando.getTime() : Date.parse(String(quando ?? ''));
  return Number.isFinite(t) ? Math.max(0, Math.floor((agora - t) / 60_000)) : null;
};
/** Um instante como "13/11 23:37", no relógio da loja — ou null quando não há. */
const dataHoraCurta = (v: unknown): string | null => {
  const d = v instanceof Date ? v : new Date(String(v ?? ''));
  if (Number.isNaN(d.getTime())) return null;
  // A hora sai pelo ajudante da casa: pedir hora e data juntas com `hour12: false` escreve "24:10" à meia-noite em algumas versões.
  return `${d.toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACAO, day: '2-digit', month: '2-digit' })} ${horaNoFuso(d)}`;
};
/** Minutos como "7h 30min". */
const duracao = (minutos: unknown): string => {
  const m = Math.max(0, inteiro(minutos));
  return m < 60 ? `${m}min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}min`;
};
/** O motivo do cancelamento, curto; vazio vira "sem motivo anotado". `a` é o apelido da tabela na consulta (fixo no código). */
const motivoDe = (a: 'pe' | 'c') => sql.raw(`coalesce(nullif(left(trim(${a}.motivo_cancelamento), 80), ''), 'sem motivo anotado')`);
const FALTA: Record<string, string> = { falta_justificada: 'falta justificada', falta_injustificada: 'falta sem justificativa' };
const PRESENCA: Record<string, string> = { prevista: 'prevista', presente: 'presente', ...FALTA };
/** Uma coluna `date` chega como Date (meia-noite do servidor) ou como texto: nos dois casos, dd/mm. */
const diaDaLinha = (v: unknown): string => {
  if (v instanceof Date) return `${String(v.getDate()).padStart(2, '0')}/${String(v.getMonth() + 1).padStart(2, '0')}`;
  const t = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? diaMes(t) : t;
};
const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });

const SITUACAO_DO_DELIVERY: Record<string, string> = { novo: 'aguardando aceite', confirmado: 'em preparo', pronto: 'pronto', despachado: 'a caminho' };
const SITUACAO_DA_COZINHA: Record<string, string> = { recebido: 'na fila', preparo: 'em preparo', pronto: 'pronto' };
const PROBLEMA_DO_VIGIA: Record<string, string> = {
  servidor_sem_sinal: 'servidor da loja sem sinal',
  servico_parado: 'serviço do servidor parado',
  disco_baixo: 'pouco espaço em disco no servidor',
  backup_atrasado: 'cópia de segurança atrasada',
  banco_em_risco: 'banco de dados do servidor pede manutenção',
  relogio_desviado: 'relógio do servidor desviado',
  sync_falhando: 'sincronização com a nuvem falhando',
  impressora_parada: 'impressora parada',
};

@Injectable()
export class MisterFerramentasService {
  private readonly logger = new Logger(MisterFerramentasService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly modulos: ModuloService,
    private readonly dashboard: DashboardService,
    private readonly relatorios: RelatoriosService,
    private readonly estoque: EstoqueService,
    private readonly delivery: DeliveryService,
    private readonly producao: ProducaoPedidoService,
    private readonly licenca: LicencaService,
    private readonly vendas: VendasService,
    private readonly escala: EscalaService,
    private readonly ponto: PontoService,
  ) {}

  // ───────────────────────────── de quem é a conversa ─────────────────────────────

  /**
   * O escopo da pessoa AGORA — ou null quando ela não fala mais com o Mister por este telefone (desligou, saiu, foi
   * rebaixada, a empresa saiu ou o módulo foi desligado). É a mesma régua da entrada, conferida de novo na hora de
   * responder: entre a pergunta e a resposta o acesso pode ter mudado (V75).
   */
  async escopo(tenantId: string, colaboradorId: string, telefone: string): Promise<EscopoDoMister | null> {
    const [p] = linhas(
      await this.db.execute(sql`
        select c.nome, emp.nome as empresa, coalesce(p.nivel, f.categoria::text) as nivel, c.unidade_id as "unidadeId", p.permissoes
          from mister_vinculo g
          join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = g.tenant_id
         where g.tenant_id = ${tenantId}::uuid and g.colaborador_id = ${colaboradorId}::uuid
           and g.telefone = ${telefone} and g.ligado_em is not null and ${pessoaVale()}`),
    );
    if (!p || (p.nivel !== 'presidente' && p.nivel !== 'gerente')) return null;
    const unidadeId: string | null = p.unidadeId ?? null;
    if (!(await this.modulos.ativo(tenantId, unidadeId, MODULO))) return null;

    const todas = linhas(await this.db.execute(sql`select id, nome from unidade where tenant_id = ${tenantId}::uuid and deleted_at is null order by nome, id`)) as {
      id: string;
      nome: string;
    }[];
    const nivel = p.nivel as NivelDoMister;
    const lojaUnica = todas.length <= 1;
    const minha = unidadeId ? todas.find((l) => l.id === unidadeId) : undefined;
    // A régua do `@UnidadeAtual()`: uma loja só = sem filtro; com loja = presa a ela; presidente = todas; o resto = nada.
    const presa = !lojaUnica && minha ? minha.id : null;
    const semLoja = !lojaUnica && !presa && (nivel !== 'presidente' || !!unidadeId);
    const permissoes = (p.permissoes ?? perfilPadrao(nivel).permissoes) as Permissoes;
    return {
      tenantId,
      colaboradorId,
      empresa: String(p.empresa ?? ''),
      nome: String(p.nome ?? ''),
      nivel,
      lojas: semLoja ? [] : presa ? [minha!] : todas,
      lojaUnica,
      presa,
      semLoja,
      permissoes,
      // Presidente tem tudo por padrão (como no guarda das permissões); os outros, o que o perfil diz.
      verValores: nivel === 'presidente' || !!permissoes?.ver_financeiro,
    };
  }

  /** O bloco "Esta conversa" que vai ao modelo. */
  conversa(e: EscopoDoMister): ConversaDoMister {
    const dia = new Date().toLocaleDateString('pt-BR', { timeZone: FUSO_OPERACAO, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    return {
      empresa: e.empresa,
      nome: primeiroNome(e.nome),
      nivel: e.nivel,
      lojas: e.lojas.length ? e.lojas.map((l) => l.nome) : [e.empresa],
      presaAUmaLoja: !!e.presa,
      semLoja: e.semLoja,
      verValores: e.verValores,
      agora: `${dia}, ${horaAgora()}`,
      noiteDe: Number(horaAgora().slice(0, 2)) < 6 ? diaMes(somarDias(hojeISO(), -1)) : null,
    };
  }

  private pode(e: EscopoDoMister, chave: keyof Permissoes): boolean {
    return e.nivel === 'presidente' || podeAcessar(e.permissoes, chave);
  }

  /** A loja da consulta: o filtro que vai ao serviço (`null` = sem filtro) e o nome para a resposta. */
  private loja(e: EscopoDoMister, pedida: unknown): { atual: string | null; nome: string } | { erro: string } {
    const pediu = pedida !== undefined && pedida !== null && String(pedida).trim() !== '';
    if (e.lojaUnica) return { atual: null, nome: e.lojas[0]?.nome ?? e.empresa };
    if (e.presa) {
      const minha = e.lojas[0];
      if (pediu && lojaPedida(pedida, [minha.nome]) === null) return { erro: `Esta pessoa só consulta a loja ${minha.nome}.` };
      return { atual: e.presa, nome: minha.nome };
    }
    if (!pediu) return { atual: null, nome: 'todas as lojas' };
    const i = lojaPedida(
      pedida,
      e.lojas.map((l) => l.nome),
    );
    if (i === null) return { erro: `Não achei essa loja. As lojas são: ${e.lojas.map((l, n) => `${n + 1}. ${l.nome}`).join('; ')}.` };
    return { atual: e.lojas[i].id, nome: e.lojas[i].nome };
  }

  // ───────────────────────────── a porta das ferramentas ─────────────────────────────

  /** Executa uma ferramenta pedida pelo modelo, dentro do escopo da pessoa. Nunca lança. */
  async executar(e: EscopoDoMister, nome: unknown, entrada: unknown): Promise<ResultadoDaFerramenta> {
    if (!ehFerramenta(nome)) return recusa('Essa consulta não existe.');
    if (e.semLoja) return recusa(SEM_LOJA);
    const en = (entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>;
    const loja = this.loja(e, en.loja);
    if ('erro' in loja) return recusa(loja.erro);
    try {
      return await this.rodar(nome, e, en, loja);
    } catch (err: any) {
      // V11: o motivo fica no log deste servidor; para o modelo vai só "não li" (nunca o texto do erro).
      this.logger.error(`ferramenta ${nome} falhou: ${String(err?.message ?? err).slice(0, 300)}`, err?.stack);
      return recusa('Não consegui ler este dado agora.');
    }
  }

  private rodar(nome: NomeDaFerramenta, e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    switch (nome) {
      case 'resumo_do_dia':
        return this.resumoDoDia(e, en, loja);
      case 'vendas_do_periodo':
        return this.vendasDoPeriodo(e, en, loja);
      case 'produtos_mais_vendidos':
        return this.produtosMaisVendidos(e, en, loja);
      case 'pedidos_em_andamento':
        return this.pedidosEmAndamento(e, loja);
      case 'estoque_em_alerta':
        return this.estoqueEmAlerta(e, en, loja);
      case 'servidor_e_incidentes':
        return this.servidorEIncidentes(e, loja);
      case 'cancelamentos':
        return this.cancelamentos(e, en, loja);
      case 'caixas_e_sangrias':
        return this.caixasESangrias(e, en, loja);
      case 'equipe_do_dia':
        return this.equipeDoDia(e, en, loja);
    }
  }

  // ───────────────────────────── cada ferramenta ─────────────────────────────

  /** O Painel (`GET /dashboard`): um dia. */
  private async resumoDoDia(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (!this.pode(e, 'dashboard')) return recusa(SEM_PERMISSAO);
    const hoje = hojeISO();
    const d = diaDaFerramenta(en.dia, hoje);
    if ('erro' in d) return recusa(d.erro);
    const r: any = await this.dashboard.resumo(e.tenantId, d.dia, e.verValores, loja.atual);
    const c = r?.comercial ?? null;
    return {
      ok: true,
      dados: {
        loja: loja.nome,
        dia: d.rotulo,
        ...(d.dia === hoje ? { lidoAs: horaAgora() } : {}),
        numeroDeVendas: inteiro(r?.vendas?.total),
        faturamento: c ? reais(c.faturado) : null,
        faturamentoDoBalcao: c ? reais(c.balcaoFaturado) : null,
        faturamentoDoDelivery: c ? reais(c.deliveryFaturado) : null,
        ticketMedio: c ? reais(c.ticketMedio) : null,
        gorjeta: c ? reais(c.gorjeta) : null,
        ...(e.verValores ? { observacao: 'A gorjeta não entra no faturamento.' } : { aviso: SEM_VALORES }),
        // Como o Painel separa (a consulta do `DashboardService.resumo`): pelo pedido ter chegado por um canal.
        comoOPainelSepara: 'Delivery = os pedidos que chegaram pelos canais (cardápio online, iFood, 99 e outros), inclusive os de retirada pedidos por eles. Balcão = as vendas lançadas na própria loja (balcão e mesas).',
        pedidosDeDeliveryEmAberto: inteiro(r?.deliveryPendentes),
        itensDeEstoqueAbaixoDoMinimo: inteiro(r?.estoqueAbaixoMinimo),
        tarefas: { total: inteiro(r?.tarefas?.total), feitas: inteiro(r?.tarefas?.feitas), pendentes: inteiro(r?.tarefas?.pendentes), naoFeitas: inteiro(r?.tarefas?.naoFeitas) },
        escala: { vagas: inteiro(r?.escala?.vagas), preenchidas: inteiro(r?.escala?.preenchidas) },
      },
    };
  }

  /** Relatórios de vendas (`GET /relatorios/vendas`): as comandas fechadas do período. */
  private async vendasDoPeriodo(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (!this.pode(e, 'relatorios_vendas')) return recusa(SEM_PERMISSAO);
    const p = periodoDaFerramenta(en, hojeISO());
    if ('erro' in p) return recusa(p.erro);
    const r: any = await this.relatorios.vendas(e.tenantId, p.de, p.ate, e.verValores, loja.atual);
    const porDia = (r?.porDia ?? []) as any[];
    return {
      ok: true,
      dados: {
        loja: loja.nome,
        periodo: p.rotulo,
        numeroDeVendas: inteiro(r?.resumo?.vendas),
        faturamento: reais(r?.resumo?.faturado),
        ticketMedio: reais(r?.resumo?.ticketMedio),
        gorjeta: reais(r?.resumo?.gorjeta),
        vendasCanceladas: inteiro(r?.resumo?.canceladas),
        ...(e.verValores ? { observacao: 'A gorjeta não entra no faturamento.' } : { aviso: SEM_VALORES }),
        // Como este relatório separa os canais (a consulta do `RelatoriosService.vendas`): pela mesa e pelo pagamento online.
        comoORelatorioSeparaOsCanais: 'Mesa = venda de mesa. Delivery/app = venda com pagamento online (pelo aplicativo ou pelo cardápio online). Balcão = todas as outras, o que inclui a retirada e o pedido de entrega pago na hora.',
        porFormaDePagamento: ((r?.porForma ?? []) as any[]).map((f) => ({ forma: String(f.forma ?? ''), vendas: inteiro(f.qtd), total: reais(f.total) })),
        porCanal: ((r?.porCanal ?? []) as any[]).map((c) => ({ canal: String(c.canal ?? ''), vendas: inteiro(c.qtd), total: reais(c.total) })),
        // Por dia só em período curto: num ano inteiro seriam centenas de linhas para o modelo ler.
        ...(porDia.length <= 31 ? { porDia: porDia.map((d) => ({ dia: diaDaLinha(d.dia), vendas: inteiro(d.qtd), total: reais(d.total) })) } : {}),
      },
    };
  }

  /** O ranking de produtos (`GET /relatorios/ranking-produtos`). */
  private async produtosMaisVendidos(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (!this.pode(e, 'relatorios_vendas')) return recusa(SEM_PERMISSAO);
    const p = periodoDaFerramenta(en, hojeISO());
    if ('erro' in p) return recusa(p.erro);
    const quantos = Math.min(15, Math.max(1, inteiro(en.quantos) || 5));
    const ordem = en.ordem === undefined || en.ordem === null || en.ordem === '' ? 'quantidade' : String(en.ordem).trim().toLowerCase();
    if (ordem !== 'quantidade' && ordem !== 'faturamento') return recusa('A ordem é "quantidade" ou "faturamento".');
    if (ordem === 'faturamento') {
      // Por faturamento a lista é a da curva de produtos dos relatórios (`GET /relatorios/produtos`): TODOS os produtos
      // do período, já na ordem do faturamento. Reordenar os mais vendidos por quantidade deixaria de fora o produto
      // caro que vendeu pouco.
      if (!e.verValores) return recusa('O perfil desta pessoa no Regem não mostra valores em reais: não dá para ordenar por faturamento.');
      const curva: any = await this.relatorios.produtos(e.tenantId, p.de, p.ate, true, loja.atual);
      const todos = (curva?.itens ?? []) as any[];
      return {
        ok: true,
        dados: {
          loja: loja.nome,
          periodo: p.rotulo,
          ordenadoPor: 'faturamento',
          produtosVendidosNoPeriodo: todos.length,
          produtos: todos.slice(0, quantos).map((i, n) => ({ posicao: n + 1, produto: String(i.descricao ?? ''), quantidade: quantidade(i.qtd), faturamento: reais(i.faturamento) })),
        },
      };
    }
    const r: any = await this.relatorios.rankingProdutos(e.tenantId, p.de, p.ate, e.verValores, loja.atual);
    const itens = ((r?.itens ?? []) as any[]).slice(0, quantos);
    return {
      ok: true,
      dados: {
        loja: loja.nome,
        periodo: p.rotulo,
        ordenadoPor: 'quantidade',
        ...(e.verValores ? {} : { aviso: SEM_VALORES }),
        produtos: itens.map((i, n) => ({
          posicao: n + 1,
          produto: String(i.descricao ?? ''),
          quantidade: quantidade(i.qtd),
          faturamento: reais(i.faturamento),
          noDelivery: quantidade(i.qtdDelivery),
          noBalcao: quantidade(i.qtdBalcao),
        })),
      },
    };
  }

  /** O quadro do Delivery (`GET /delivery/pedidos`) e a fila da cozinha (`GET /producao-pedido/fila`), agora. */
  private async pedidosEmAndamento(e: EscopoDoMister, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    const agora = Date.now();
    const dados: Record<string, unknown> = { loja: loja.nome, lidoAs: horaAgora() };

    if (this.pode(e, 'delivery')) {
      const pedidos = ((await this.delivery.listar(e.tenantId, loja.atual)) as any[]).filter((p) => SITUACAO_DO_DELIVERY[String(p.status)]);
      // Encomenda marcada para depois não é pedido parado: conta à parte e não entra no "espera há mais tempo".
      const marcado = (p: any) => {
        const t = p.agendamento instanceof Date ? p.agendamento.getTime() : Date.parse(String(p.agendamento ?? ''));
        return Number.isFinite(t) && t > agora;
      };
      const deAgora = pedidos.filter((p) => !marcado(p));
      const porSituacao: Record<string, number> = {};
      const porPlataforma: Record<string, number> = {};
      for (const p of deAgora) {
        const s = SITUACAO_DO_DELIVERY[String(p.status)];
        porSituacao[s] = (porSituacao[s] ?? 0) + 1;
        const canal = String(p.canal ?? 'outro');
        porPlataforma[canal] = (porPlataforma[canal] ?? 0) + 1;
      }
      // Quem ainda está NA LOJA (não saiu para entrega), o mais antigo primeiro.
      const naLoja = deAgora.filter((p) => p.status !== 'despachado').sort((a, b) => new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime());
      const antigo = naLoja[0];
      dados.delivery = {
        emAndamento: deAgora.length,
        porSituacao,
        porPlataforma,
        marcadosParaDepois: pedidos.length - deAgora.length,
        esperaHaMaisTempo: antigo
          ? { plataforma: String(antigo.canal ?? ''), numero: antigo.displayId ? String(antigo.displayId) : null, situacao: SITUACAO_DO_DELIVERY[String(antigo.status)], haMinutos: minutosDesde(antigo.criadoEm, agora) }
          : null,
      };
    } else dados.delivery = { aviso: SEM_PERMISSAO };

    const fila: any = await this.producao.filaKds(e.tenantId, { unidadeId: loja.atual ?? undefined, canal: 'todos' });
    const cartoes = ((fila?.pedidos ?? []) as any[]).filter((c) => SITUACAO_DA_COZINHA[String(c.status)]);
    // Um pedido pode ter um cartão por estação: conta-se o PEDIDO, na situação mais atrasada dele.
    const ORDEM = ['recebido', 'preparo', 'pronto'];
    const porPedido = new Map<string, any>();
    for (const c of cartoes) {
      const chave = String(c.comandaId ?? c.id);
      const visto = porPedido.get(chave);
      if (!visto || ORDEM.indexOf(String(c.status)) < ORDEM.indexOf(String(visto.status))) porPedido.set(chave, c);
    }
    const naCozinha: Record<string, number> = {};
    for (const c of porPedido.values()) {
      const s = SITUACAO_DA_COZINHA[String(c.status)];
      naCozinha[s] = (naCozinha[s] ?? 0) + 1;
    }
    const fazendo = [...porPedido.values()].filter((c) => c.status !== 'pronto').sort((a, b) => new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime())[0];
    dados.cozinha = {
      pedidos: porPedido.size,
      porSituacao: naCozinha,
      maisAntigoSemFicarPronto: fazendo
        ? {
            origem: String(fazendo.plataforma || fazendo.origem || ''),
            senha: fazendo.senha != null ? `${fazendo.senhaPrefixo ?? ''}${fazendo.senha}` : fazendo.senhaPlataforma ? String(fazendo.senhaPlataforma) : null,
            situacao: SITUACAO_DA_COZINHA[String(fazendo.status)],
            haMinutos: minutosDesde(fazendo.criadoEm, agora),
          }
        : null,
      ...(fila?.nuvemComServidor ? { observacao: 'A fila da cozinha vem do servidor da loja e pode ter alguns segundos de atraso.' } : {}),
    };
    return { ok: true, dados };
  }

  /** O Estoque: abaixo do mínimo (`GET /estoque/itens`) e validades (`GET /estoque/validades`). */
  private async estoqueEmAlerta(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (!this.pode(e, 'estoque')) return recusa(SEM_PERMISSAO);
    // Sem valores em R$: aqui só interessam o saldo e o mínimo.
    const itens = ((await this.estoque.listItens(e.tenantId, false, loja.atual)) as any[]).filter((i) => i.abaixoMinimo);
    // A lista inteira não cabe numa mensagem: sai em páginas de 15, e dá para procurar pelo nome.
    const busca = semAcento(en.busca);
    const achados = busca ? itens.filter((i) => semAcento(i.nome).includes(busca)) : itens;
    const paginas = Math.max(1, Math.ceil(achados.length / 15));
    const pagina = Math.min(paginas, Math.max(1, inteiro(en.pagina) || 1));
    const lotes = ((await this.estoque.validades(e.tenantId, loja.atual)) as any[]).filter((l) => l.status === 'vencido' || l.status === 'critico' || l.status === 'atencao');
    const conta = (s: string) => lotes.filter((l) => l.status === s).length;
    return {
      ok: true,
      dados: {
        loja: loja.nome,
        abaixoDoMinimo: {
          total: itens.length,
          ...(busca ? { comOQueFoiProcurado: achados.length } : {}),
          pagina,
          paginas,
          itens: achados.slice((pagina - 1) * 15, pagina * 15).map((i) => ({ item: String(i.nome ?? ''), saldo: quantidade(i.saldo), minimo: quantidade(i.estoqueMinimo), unidade: String(i.unidadeMedida ?? '') })),
          ...(paginas > 1 ? { observacao: `Em ordem alfabética, 15 por página: esta é a página ${pagina} de ${paginas}.` } : {}),
        },
        validades: {
          vencidos: conta('vencido'),
          vencemEmAte2Dias: conta('critico'),
          vencemEmAte5Dias: conta('atencao'),
          lotes: lotes.slice(0, 12).map((l) => ({
            item: String(l.itemNome ?? ''),
            validade: diaDaLinha(l.validade),
            diasParaVencer: inteiro(l.diasParaVencer),
            quantidade: quantidade(l.quantidade),
            unidade: String(l.unidadeMedida ?? ''),
          })),
          ...(lotes.length > 12 ? { observacao: `Lista com os 12 lotes que vencem primeiro, de ${lotes.length}.` } : {}),
        },
      },
    };
  }

  /** O Servidor local (só o presidente, como a rota) e os problemas em aberto do vigia que são da loja. */
  private async servidorEIncidentes(e: EscopoDoMister, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    const dados: Record<string, unknown> = { loja: loja.nome, lidoAs: horaAgora() };
    if (e.nivel === 'presidente') {
      const s: any = await this.licenca.minhaLojaServidor(e.tenantId);
      dados.servidor = !s?.instalado
        ? { instalado: false, observacao: 'A empresa não tem servidor instalado na loja: o Regem roda só na nuvem.' }
        : {
            instalado: true,
            comSinalAgora: !!s.online,
            versao: s.versao ? String(s.versao) : null,
            ultimaSincronizacaoHaMinutos: minutosDesde(s.ultimoSync, Date.now()),
            copiaDeSeguranca: s.backup ? { emDia: !!s.backup.ok, haHoras: s.backup.horas ?? null } : null,
            precisaDeManutencao: !!s.precisaManutencao,
            ...(e.lojaUnica ? {} : { observacao: 'A empresa tem mais de uma loja: esta é a situação do servidor instalado mais recente.' }),
          };
    } else dados.servidor = { aviso: 'A situação do servidor é mostrada só ao presidente.' };

    try {
      // Só o que é da loja resolver (o que é da distribuição não aparece para a loja). Loja escolhida: a dela e o que
      // não tem loja marcada (V4).
      const daLoja = loja.atual ? sql`and (unidade_id = ${loja.atual}::uuid or unidade_id is null)` : sql``;
      const abertos = linhas(
        await this.db.execute(sql`
          select regra, gravidade, vezes, to_char(primeira_em at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as desde, count(*) over ()::int as total
            from vigia_incidente
           where tenant_id = ${e.tenantId}::uuid and situacao = 'aberto' and publico in ('loja', 'ambos') ${daLoja}
           order by case gravidade when 'critico' then 0 else 1 end, primeira_em
           limit 20`),
      );
      dados.problemasEmAberto = {
        total: abertos.length ? inteiro(abertos[0].total) : 0,
        lista: abertos.map((i) => ({ problema: PROBLEMA_DO_VIGIA[String(i.regra)] ?? String(i.regra), gravidade: i.gravidade === 'critico' ? 'crítico' : 'atenção', desde: String(i.desde), vezesVisto: inteiro(i.vezes) })),
      };
    } catch (err: any) {
      if (!semTabela(err)) throw err;
      // Vazio é diferente de "não li" (V37): banco sem a tabela do vigia não é "nenhum problema".
      dados.problemasEmAberto = { aviso: 'Não consegui ler os problemas em aberto agora.' };
    }
    return { ok: true, dados };
  }

  /**
   * Os cancelamentos de um período, com o motivo. Não há uma tela só com isto, então cada parte segue a permissão da
   * tela onde o dado aparece: os pedidos dos canais cancelados (o quadro do Delivery só mostra as últimas horas), as
   * vendas canceladas na loja (a lista de cupons) e os itens removidos de comandas ("Cancelamentos de itens",
   * `GET /vendas/remocoes`). O período é o da OPERAÇÃO (`noPeriodo`), pelo momento do cancelamento.
   */
  private async cancelamentos(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    const verPedidos = this.pode(e, 'delivery');
    const verVendas = this.pode(e, 'cupons') || this.pode(e, 'relatorios_vendas');
    const verItens = this.pode(e, 'cancelamentos');
    if (!verPedidos && !verVendas && !verItens) return recusa(SEM_PERMISSAO);
    const p = periodoDaFerramenta(en, hojeISO(), 'hoje');
    if ('erro' in p) return recusa(p.erro);
    const ini = `${p.de} 00:00:00`;
    const fim = `${p.ate} 23:59:59`;
    const dinheiro = (v: unknown) => (e.verValores ? reais(v) : null);
    const dados: Record<string, unknown> = { loja: loja.nome, periodo: p.rotulo, ...(e.verValores ? {} : { aviso: SEM_VALORES }) };

    if (verPedidos) {
      const quando = 'coalesce(pe.cancelado_em, pe.criado_em)';
      const base = sql`from pedido_externo pe
        where pe.tenant_id = ${e.tenantId}::uuid and pe.status = 'cancelado' and pe.deleted_at is null
          ${sqlUnidadeOuRede('pe.unidade_id', loja.atual)} and ${noPeriodo(quando, ini, fim)}`;
      const [total] = linhas(await this.db.execute(sql`select count(*)::int as qtd, coalesce(sum(${brutoPedido('pe')}), 0) as valor ${base}`));
      const porCanal = linhas(await this.db.execute(sql`select pe.canal, count(*)::int as qtd ${base} group by 1 order by 2 desc, 1`));
      const porMotivo = linhas(await this.db.execute(sql`select ${motivoDe('pe')} as motivo, count(*)::int as qtd ${base} group by 1 order by 2 desc, 1 limit 8`));
      const ultimos = linhas(
        await this.db.execute(sql`
          select pe.canal, pe.display_id as numero, ${motivoDe('pe')} as motivo, ${brutoPedido('pe')} as valor,
                 to_char(${sql.raw(quando)} at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as quando
            ${base}
           order by ${sql.raw(quando)} desc
           limit 10`),
      );
      dados.pedidosDosCanais = {
        cancelados: inteiro(total?.qtd),
        valor: dinheiro(total?.valor),
        porCanal: Object.fromEntries(porCanal.map((c) => [String(c.canal ?? 'outro'), inteiro(c.qtd)])),
        porMotivo: porMotivo.map((m) => ({ motivo: String(m.motivo), pedidos: inteiro(m.qtd) })),
        ultimos: ultimos.map((u) => ({ canal: String(u.canal ?? ''), numero: u.numero ? String(u.numero) : null, quando: String(u.quando), motivo: String(u.motivo), valor: dinheiro(u.valor) })),
      };
    } else dados.pedidosDosCanais = { aviso: SEM_PERMISSAO };

    if (verVendas) {
      // Só a venda lançada na loja: a do pedido de canal já está na parte de cima.
      const quando = 'coalesce(c.cancelada_em, c.created_at)';
      const onde = sql`c.tenant_id = ${e.tenantId}::uuid and c.status = 'cancelada' ${sqlUnidade('c.unidade_id', loja.atual)}
          and ${noPeriodo(quando, ini, fim)} and not ${comandaEhDeCanal('c')}`;
      const [total] = linhas(await this.db.execute(sql`select count(*)::int as qtd, coalesce(sum(c.total), 0) as valor from comanda c where ${onde}`));
      const porMotivo = linhas(await this.db.execute(sql`select ${motivoDe('c')} as motivo, count(*)::int as qtd from comanda c where ${onde} group by 1 order by 2 desc, 1 limit 8`));
      const ultimas = linhas(
        await this.db.execute(sql`
          select ${motivoDe('c')} as motivo, c.total as valor, col.nome as quem,
                 to_char(${sql.raw(quando)} at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as quando
            from comanda c
            left join colaborador col on col.id = c.cancelada_por_id and col.tenant_id = c.tenant_id
           where ${onde}
           order by ${sql.raw(quando)} desc
           limit 10`),
      );
      dados.vendasCanceladasNaLoja = {
        canceladas: inteiro(total?.qtd),
        valor: dinheiro(total?.valor),
        porMotivo: porMotivo.map((m) => ({ motivo: String(m.motivo), vendas: inteiro(m.qtd) })),
        ultimas: ultimas.map((u) => ({ quando: String(u.quando), quemCancelou: u.quem ? String(u.quem) : null, motivo: String(u.motivo), valor: dinheiro(u.valor) })),
      };
    } else dados.vendasCanceladasNaLoja = { aviso: SEM_PERMISSAO };

    if (verItens) {
      const itens = ((await this.vendas.remocoesItens(e.tenantId, p.de, p.ate, loja.atual)) as any[]).sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
      dados.itensRemovidosDeComandas = {
        removidos: itens.length,
        ...(itens.length >= 300 ? { observacao: 'A lista do Regem para em 300 itens: pode haver mais no período.' } : {}),
        ultimos: itens.slice(0, 10).map((i) => ({
          quando: dataHoraCurta(i.data),
          quemRemoveu: String(i.ator ?? ''),
          item: String(i.descricao ?? '').slice(0, 80),
          justificativa: String(i.justificativa ?? '').trim().slice(0, 120) || 'sem justificativa',
        })),
      };
    } else dados.itensRemovidosDeComandas = { aviso: SEM_PERMISSAO };
    return { ok: true, dados };
  }

  /** Os caixas: Relatórios › Turnos (`GET /relatorios/turnos`) e as operações de caixa (`GET /relatorios/operacoes-caixa`). */
  private async caixasESangrias(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (!this.pode(e, 'relatorios_vendas')) return recusa(SEM_PERMISSAO);
    const hoje = hojeISO();
    const p = periodoDaFerramenta(en, hoje, 'hoje');
    if ('erro' in p) return recusa(p.erro);
    const agora = Date.now();
    const turno = (t: any) => {
      const aberto = t.status === 'aberta';
      const minutos = minutosDesde(t.abertaEm, agora);
      return {
        caixa: t.origem === 'delivery' ? 'delivery' : 'balcão',
        abertoPor: String(t.abertaPor ?? ''),
        abertoEm: dataHoraCurta(t.abertaEm),
        ...(aberto ? { abertoHaHoras: minutos === null ? null : Math.round(minutos / 6) / 10 } : { fechadoPor: String(t.fechadaPor ?? ''), fechadoEm: dataHoraCurta(t.fechadaEm) }),
        abertura: reais(t.abertura),
        vendas: reais(t.vendas),
        sangrias: reais(t.sangrias),
        suprimentos: reais(t.suprimentos),
        ...(aberto ? {} : { esperado: reais(t.esperado), informado: reais(t.informado), diferenca: reais(t.diferenca) }),
      };
    };
    // Abertos AGORA: o relatório lista o turno pelo dia em que ABRIU, então a janela olha 35 dias para trás (caixa que
    // ficou aberto de um dia para o outro tem de aparecer).
    const recentes: any = await this.relatorios.turnos(e.tenantId, somarDias(hoje, -35), hoje, e.verValores, loja.atual);
    const abertos = ((recentes?.turnos ?? []) as any[]).filter((t) => t.status === 'aberta');
    const doPeriodo: any = await this.relatorios.turnos(e.tenantId, p.de, p.ate, e.verValores, loja.atual);
    const turnos = (doPeriodo?.turnos ?? []) as any[];
    const fechados = turnos.filter((t) => t.status !== 'aberta');
    const operacoes: any = await this.relatorios.operacoesCaixa(e.tenantId, p.de, p.ate, e.verValores, loja.atual);
    return {
      ok: true,
      dados: {
        loja: loja.nome,
        periodo: p.rotulo,
        lidoAs: horaAgora(),
        ...(e.verValores ? {} : { aviso: SEM_VALORES }),
        abertosAgora: abertos.map(turno),
        turnosAbertosNoPeriodo: {
          total: turnos.length,
          fechados: fechados.length,
          fechadosComDiferenca: e.verValores ? fechados.filter((t) => Math.abs(Number(t.diferenca) || 0) >= 0.01).length : null,
          lista: turnos.slice(0, 10).map(turno),
          ...(turnos.length > 10 ? { observacao: `Lista com 10 de ${turnos.length} turnos.` } : {}),
        },
        sangriasESuprimentos: {
          sangrias: reais(operacoes?.movimentosTotal?.sangrias),
          suprimentos: reais(operacoes?.movimentosTotal?.suprimentos),
          porOperador: ((operacoes?.movimentos ?? []) as any[]).map((m) => ({
            operador: String(m.operador ?? ''),
            sangrias: reais(m.sangrias),
            quantasSangrias: inteiro(m.qtdSangrias),
            suprimentos: reais(m.suprimentos),
            quantosSuprimentos: inteiro(m.qtdSuprimentos),
          })),
        },
      },
    };
  }

  /**
   * A equipe de um dia: a escala (`GET /escala`) e o ponto gerencial (`GET /ponto/pessoas`). Vai ao modelo só o que a
   * tela mostra ao gestor para esta conta: o nome, o setor, o horário e a presença — nunca CPF, telefone, foto ou salário.
   */
  private async equipeDoDia(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    const verEscala = this.pode(e, 'escalas');
    const verPonto = this.pode(e, 'ponto_gerencial');
    if (!verEscala && !verPonto) return recusa(SEM_PERMISSAO);
    const hoje = hojeISO();
    const d = diaDaFerramenta(en.dia, hoje);
    if ('erro' in d) return recusa(d.erro);
    const dados: Record<string, unknown> = { loja: loja.nome, dia: d.rotulo, ...(d.dia === hoje ? { lidoAs: horaAgora() } : {}) };
    const hhmm = (v: unknown) => String(v ?? '').slice(0, 5);
    let escalados: any[] = [];

    if (verEscala) {
      const todas = (await this.escala.findAll(e.tenantId, d.dia, loja.atual ?? undefined)) as any[];
      escalados = todas.filter((l) => l.colaboradorId).sort((a, b) => hhmm(a.turnoInicio).localeCompare(hhmm(b.turnoInicio)) || String(a.colaboradorNome).localeCompare(String(b.colaboradorNome)));
      const porSetor: Record<string, number> = {};
      for (const l of escalados) {
        const setor = String(l.setorNome ?? 'sem setor');
        porSetor[setor] = (porSetor[setor] ?? 0) + 1;
      }
      dados.escala = {
        escalados: escalados.length,
        vagasSemPessoa: todas.length - escalados.length,
        porSetor,
        faltasAnotadas: escalados.filter((l) => FALTA[String(l.presenca)]).map((l) => ({ nome: String(l.colaboradorNome ?? ''), setor: String(l.setorNome ?? ''), falta: FALTA[String(l.presenca)] })),
        pessoas: escalados.slice(0, 40).map((l) => ({
          nome: String(l.colaboradorNome ?? ''),
          setor: String(l.setorNome ?? ''),
          horario: hhmm(l.turnoInicio) && hhmm(l.turnoFim) ? `${hhmm(l.turnoInicio)} às ${hhmm(l.turnoFim)}` : null,
          presenca: PRESENCA[String(l.presenca)] ?? String(l.presenca ?? ''),
        })),
        ...(escalados.length > 40 ? { observacao: `Lista com 40 de ${escalados.length} pessoas.` } : {}),
      };
    } else dados.escala = { aviso: SEM_PERMISSAO };

    if (verPonto) {
      const pessoas = (await this.ponto.pessoas(e.tenantId, d.dia, loja.atual)) as any[];
      dados.ponto = {
        bateramPonto: pessoas.length,
        trabalhandoAgora: pessoas.filter((p) => p.status === 'trabalhando').length,
        pessoas: pessoas.slice(0, 40).map((p) => ({
          nome: String(p.nome ?? ''),
          entrada: p.primeiraEntrada ? horaNoFuso(new Date(p.primeiraEntrada)) : null,
          situacao: p.status === 'trabalhando' ? 'trabalhando' : 'fora',
          trabalhado: duracao(p.trabalhadoMin),
        })),
        ...(pessoas.length > 40 ? { observacao: `Lista com 40 de ${pessoas.length} pessoas.` } : {}),
      };
      // Escalado para um horário que já começou, sem falta anotada e sem ponto no dia. Só para hoje, e só com as duas telas.
      if (verEscala && d.dia === hoje) {
        const comPonto = new Set(pessoas.map((p) => String(p.colaboradorId)));
        const agoraHHMM = horaAgora();
        dados.escaladosSemPontoAteAgora = escalados
          .filter((l) => hhmm(l.turnoInicio) && hhmm(l.turnoInicio) <= agoraHHMM && !FALTA[String(l.presenca)] && !comPonto.has(String(l.colaboradorId)))
          .map((l) => ({ nome: String(l.colaboradorNome ?? ''), setor: String(l.setorNome ?? ''), horarioComecouAs: hhmm(l.turnoInicio) }));
      }
    } else dados.ponto = { aviso: SEM_PERMISSAO };
    return { ok: true, dados };
  }
}
