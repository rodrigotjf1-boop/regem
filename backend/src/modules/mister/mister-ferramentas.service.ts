import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { Permissoes, perfilPadrao, podeAcessar } from '../../auth/permissoes';
import { FUSO_OPERACAO, hojeISO, horaAgora } from '../../common/data';
import { FUSO_SQL } from '../../common/fuso-sql';
import { DashboardService } from '../dashboard/dashboard.service';
import { DeliveryService } from '../delivery/delivery.service';
import { EstoqueService } from '../estoque/estoque.service';
import { LicencaService } from '../licenca/licenca.service';
import { ModuloService } from '../modulo/modulo.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { RelatoriosService } from '../relatorios/relatorios.service';
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
        return this.estoqueEmAlerta(e, loja);
      case 'servidor_e_incidentes':
        return this.servidorEIncidentes(e, loja);
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
  private async estoqueEmAlerta(e: EscopoDoMister, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (!this.pode(e, 'estoque')) return recusa(SEM_PERMISSAO);
    // Sem valores em R$: aqui só interessam o saldo e o mínimo.
    const itens = ((await this.estoque.listItens(e.tenantId, false, loja.atual)) as any[]).filter((i) => i.abaixoMinimo);
    const lotes = ((await this.estoque.validades(e.tenantId, loja.atual)) as any[]).filter((l) => l.status === 'vencido' || l.status === 'critico' || l.status === 'atencao');
    const conta = (s: string) => lotes.filter((l) => l.status === s).length;
    return {
      ok: true,
      dados: {
        loja: loja.nome,
        abaixoDoMinimo: {
          total: itens.length,
          itens: itens.slice(0, 15).map((i) => ({ item: String(i.nome ?? ''), saldo: quantidade(i.saldo), minimo: quantidade(i.estoqueMinimo), unidade: String(i.unidadeMedida ?? '') })),
          ...(itens.length > 15 ? { observacao: `Lista com os 15 primeiros de ${itens.length}, em ordem alfabética.` } : {}),
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
}
