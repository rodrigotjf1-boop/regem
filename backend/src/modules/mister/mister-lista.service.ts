import { BadRequestException, Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { Conversao } from '../../common/conversao-unidade';
import { ehServidorLocal } from '../../common/modo';
import { pode } from '../../auth/permissoes';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ComprasService } from '../compras/compras.service';
import { EstoqueService } from '../estoque/estoque.service';
import { lerTabela } from '../estoque/produtos-planilha';
import { normalizarUnidade } from '../estoque/unidades';
import { MidiaDoMister, MisterEntradaService, QuemMandou, QuemTocou } from './mister-entrada.service';
import { EscopoDoMister, MisterFerramentasService, ResultadoDaFerramenta } from './mister-ferramentas.service';
import {
  InsumoDaLista,
  LEITURA_VALE_H,
  LISTA_VALE_H,
  LinhaDaLista,
  ListaLida,
  PREFIXO_DA_LISTA,
  PedidoDaLinha,
  TEXTOS_DA_LISTA,
  aplicarFator,
  duvidaDoFator,
  ehParteDaLeitura,
  lerBotaoDaLista,
  lerPedidos,
  ligarAoInsumo,
  marcaDoTexto,
  montarLinha,
  pedidosDaPlanilha,
  perguntaDaLinha,
  perguntaDoFornecedor,
  proximaPendencia,
  quantidadeNoEstoque,
  resumoDaLista,
  textoDaLeitura,
} from './mister-lista';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { lerRespostaDoFator, simOuNao } from './resposta-do-fator';

/* eslint-disable @typescript-eslint/no-explicit-any */

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const MAX_INSUMOS = 3000;
/** A mensagem que ficou sem conclusão: depois deste tempo o processo já não está nela, e até este ainda vale retomar. */
const RETOMA_DEPOIS_S = 120;
const RETOMA_ATE_MIN = 30;
type Mensagem = { texto: string; botoes?: { id: string; titulo: string }[]; antes?: string[] };

/** A mensagem na ordem de envio: a lista grande antes, e o texto com os botões por último. */
const emMensagens = (m: Mensagem): { texto: string; botoes?: { id: string; titulo: string }[] }[] => [
  ...(m.antes ?? []).map((texto) => ({ texto })),
  m.botoes?.length ? { texto: m.texto, botoes: m.botoes } : { texto: m.texto },
];

/**
 * A LISTA DE COMPRAS PELA CONVERSA (versão 6, M6g; mig 475; protótipo `mockups/regem-mister-v6.html`, "Ações e
 * apresentação"). Quem pode: presidente ou gerente com "criar" no Estoque (a MESMA permissão da tela de Pedidos), no escopo
 * da loja dele. Entra pela ferramenta `lista_de_compras` (texto, áudio, a foto de uma lista lida pelo Graph, "abaixo do
 * mínimo") ou pela planilha (lida aqui, sem IA). Cada linha vai a um insumo; o que tiver dúvida (o insumo, a unidade, a
 * marca, o fornecedor) é perguntado com botões, uma coisa por vez; no fim, o resumo e "Criar o pedido" — pelo MESMO
 * `ComprasService.createLista` da tela. Uma lista aberta por pessoa: a nova descarta a anterior pela metade.
 */
@Injectable()
export class MisterListaService implements OnModuleInit {
  private readonly logger = new Logger('MisterLista');
  private retomando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ferramentas: MisterFerramentasService,
    private readonly numero: MisterNumeroService,
    private readonly compras: ComprasService,
    private readonly estoque: EstoqueService,
    @Optional() private readonly entrada?: MisterEntradaService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  onModuleInit(): void {
    this.ferramentas.registrarLista((e, en) => this.ferramenta(e, en));
    this.entrada?.registrarBotao(PREFIXO_DA_LISTA, (botaoId, quem) => this.tocou(botaoId, quem));
    this.entrada?.registrarPlanilha((quem, midia, wamid) => this.planilha(quem, midia, wamid));
    this.entrada?.registrarTextoDaLista((quem, texto) => this.texto(quem, texto));
    this.entrada?.registrarListaLida((quem, lida) => this.guardarLida(quem, lida));
  }

  // ───────────────────────────── quem pode ─────────────────────────────

  /** O motivo de não poder (ou null): a permissão de criar no Estoque e a loja do gerente. */
  private motivoDeNaoPoder(e: EscopoDoMister): string | null {
    if (!pode(e.permissoes, 'estoque', 'criar')) return TEXTOS_DA_LISTA.soQuemPode;
    if (e.semLoja) return TEXTOS_DA_LISTA.semLoja;
    return null;
  }

  /** A loja da lista: a do gerente; a única da empresa; ou nenhuma (a rede, como a tela do presidente em "todas"). */
  private lojaDa(e: EscopoDoMister): string | null {
    return e.presa ?? (e.lojaUnica && e.lojas.length === 1 ? e.lojas[0].id : null);
  }

  // ───────────────────────────── a ferramenta ─────────────────────────────

  private async ferramenta(e: EscopoDoMister, en: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });
    const motivo = this.motivoDeNaoPoder(e);
    if (motivo) return recusa(motivo);
    const loja = this.lojaDa(e);
    let pedidos: PedidoDaLinha[];
    let origem: 'conversa' | 'minimo';
    let prontas: LinhaDaLista[] | null = null;
    let lida: { id: string; lista: ListaLida } | null = null;
    let parcial: string | null = null;
    if (en.acao === 'do_minimo') {
      origem = 'minimo';
      const sug: any[] = await this.compras.sugerir(e.tenantId, loja);
      if (!sug.length) return { ok: true, dados: { vazia: true, mensagem: TEXTOS_DA_LISTA.nadaNoMinimo } };
      prontas = sug.slice(0, 40).map((s) => {
        const marcas: string[] = Array.isArray(s.marcas) ? s.marcas.filter(Boolean) : [];
        return {
          texto: String(s.nomeComercial || s.nome),
          quantidade: Math.round(Number(s.sugerido) * 1000) / 1000,
          unidade: null,
          itemId: String(s.itemId),
          itemNome: String(s.nome),
          unidadeDoEstoque: String(s.unidadeMedida),
          fator: 1,
          marcas,
          marca: marcas.length === 1 ? marcas[0] : null,
          opcoes: [],
          estado: marcas.length >= 2 ? 'marca' : 'ligado',
        } satisfies LinhaDaLista;
      });
      pedidos = [];
    } else if (en.acao === 'da_leitura') {
      // As linhas guardadas do arquivo: a IA não copia nenhuma (ERR-584).
      origem = 'conversa';
      lida = await this.ultimaLida(e);
      if (!lida) return recusa(TEXTOS_DA_LISTA.semLeitura);
      pedidos = lida.lista.pedidos;
      if (!pedidos.length) return recusa(TEXTOS_DA_LISTA.semLinhas);
    } else if (en.acao === 'montar') {
      origem = 'conversa';
      pedidos = lerPedidos(en.itens);
      if (!pedidos.length) return recusa(TEXTOS_DA_LISTA.semLinhas);
      // Um pedaço do arquivo lido pode ser o que a pessoa quis: fica como pediu, e ela sabe que há mais.
      const guardada = await this.ultimaLida(e).catch(() => null);
      if (guardada && ehParteDaLeitura(pedidos, guardada.lista.pedidos)) parcial = TEXTOS_DA_LISTA.parcial(pedidos.length, guardada.lista.total);
    } else {
      return recusa('acao precisa ser montar, da_leitura ou do_minimo.');
    }
    const r = await this.abrir(e, loja, origem, prontas ?? (await this.montar(e.tenantId, loja, pedidos)));
    if (lida) await this.db.execute(sql`update mister_lista_compra set situacao = 'descartada', atualizada_em = clock_timestamp() where id = ${lida.id}::uuid and situacao = 'lida'`);
    return {
      ok: true,
      dados: {
        montada: true,
        linhas: r.linhas.length,
        ligadas: r.linhas.filter((l) => l.estado === 'ligado').length,
        perguntas: r.linhas.filter((l) => l.estado !== 'ligado').length,
        ...(lida ? { linhasNoArquivo: lida.lista.total } : {}),
        orientacao: lida
          ? 'A contagem do arquivo já vai numa mensagem própria: não repita. Diga em uma frase que as dúvidas vêm a seguir, com botões. Não repita a lista.'
          : 'Diga em uma frase quantas linhas entraram e que as dúvidas vêm a seguir, com botões. Não repita a lista.',
      },
      mensagens: [...(lida ? [{ texto: textoDaLeitura(lida.lista) }] : []), ...(parcial ? [{ texto: parcial }] : []), ...emMensagens(r.mensagem)],
    };
  }

  // ───────────────────────────── a lista lida de um arquivo ─────────────────────────────

  /** Guarda as linhas lidas do arquivo (a anterior da pessoa sai). Devolve se guardou: sem isso, a conversa avisa que não leu tudo. */
  async guardarLida(quem: QuemMandou, l: ListaLida): Promise<boolean> {
    try {
      await this.db.transaction(async (tx: any) => {
        await tx.execute(sql`
          update mister_lista_compra set situacao = 'descartada', atualizada_em = clock_timestamp()
           where tenant_id = ${quem.tenantId}::uuid and colaborador_id = ${quem.colaboradorId}::uuid and situacao = 'lida'`);
        await tx.execute(sql`
          insert into mister_lista_compra (tenant_id, unidade_id, colaborador_id, origem, situacao, itens, leitura, vence_em)
          values (${quem.tenantId}::uuid, ${quem.unidadeId}::uuid, ${quem.colaboradorId}::uuid, 'conversa', 'lida', ${JSON.stringify(l.pedidos)}::jsonb,
                  ${JSON.stringify({ total: l.total, semQuantidade: l.semQuantidade })}::jsonb, clock_timestamp() + make_interval(hours => ${LEITURA_VALE_H}::int))`);
      });
      return true;
    } catch (err: any) {
      this.logger.error(`a lista lida do arquivo não foi guardada — ${err?.message ?? err}`, err?.stack);
      return false;
    }
  }

  private async ultimaLida(e: EscopoDoMister): Promise<{ id: string; lista: ListaLida } | null> {
    const [l] = linhas(
      await this.db.execute(sql`
        select id::text as id, itens, leitura from mister_lista_compra
         where tenant_id = ${e.tenantId}::uuid and colaborador_id = ${e.colaboradorId}::uuid and situacao = 'lida' and vence_em > clock_timestamp()
         order by criada_em desc limit 1`),
    );
    if (!l) return null;
    const pedidos = lerPedidos(l.itens);
    return {
      id: String(l.id),
      lista: {
        total: Number(l.leitura?.total) || pedidos.length,
        pedidos,
        semQuantidade: Array.isArray(l.leitura?.semQuantidade) ? l.leitura.semQuantidade.map(String) : [],
      },
    };
  }

  // ───────────────────────────── a mensagem interrompida ─────────────────────────────

  /**
   * A mensagem que ficou sem desfecho (o processo reiniciou no meio, ERR-584) não volta: a Meta não reenvia e o texto não fica
   * guardado. Quem tem lista aberta recebe a próxima pergunta, e a lista anda. O pedido pela metade nunca é refeito aqui.
   */
  @Cron('*/30 * * * * *')
  async retomarInterrompidas(): Promise<number> {
    if (ehServidorLocal() || this.retomando) return 0;
    this.retomando = true;
    let retomadas = 0;
    try {
      const janela = sql`m.recebida_em > clock_timestamp() - make_interval(mins => ${RETOMA_ATE_MIN}::int)
                     and m.recebida_em < clock_timestamp() - make_interval(secs => ${RETOMA_DEPOIS_S}::int)`;
      const abertas = linhas(
        await this.db.execute(sql`
          select distinct on (m.telefone) m.telefone, l.id::text as "listaId", l.situacao, l.tenant_id::text as "tenantId"
            from mister_mensagem m
            join mister_vinculo v on v.telefone = m.telefone and v.ligado_em is not null
            join mister_lista_compra l on l.tenant_id = v.tenant_id and l.colaborador_id = v.colaborador_id
             and l.atualizada_em > m.recebida_em - make_interval(mins => ${RETOMA_ATE_MIN}::int)
             and ((l.situacao in ('montando', 'confirmar') and l.vence_em > clock_timestamp())
                  or (l.situacao = 'criada' and l.compra_lista_id is null))
           where m.desfecho is null and ${janela}
           order by m.telefone, l.atualizada_em desc
           limit 50`),
      );
      for (const a of abertas) {
        // A gravação condicional escolhe uma réplica só.
        const pegou = linhas(
          await this.db.execute(sql`
            update mister_mensagem m set desfecho = 'retomada_lista', tenant_id = coalesce(m.tenant_id, ${a.tenantId}::uuid)
             where m.telefone = ${a.telefone} and m.desfecho is null and ${janela}
            returning m.wamid`),
        );
        if (!pegou.length) continue;
        retomadas++;
        if (a.situacao === 'criada') {
          await this.falar(a.telefone, { texto: TEXTOS_DA_LISTA.talvezCriada });
          continue;
        }
        await this.falar(a.telefone, { texto: TEXTOS_DA_LISTA.retomada });
        await this.falar(a.telefone, await this.seguir(a.listaId));
      }
    } catch (err: any) {
      this.logger.warn(`a retomada das listas interrompidas falhou — ${err?.message ?? err}`);
    } finally {
      this.retomando = false;
    }
    return retomadas;
  }

  // ───────────────────────────── a planilha ─────────────────────────────

  /** A planilha (xlsx ou csv) que a pessoa mandou: lida aqui, sem IA. Devolve se tratou. */
  private async planilha(quem: QuemMandou, midia: MidiaDoMister, _wamid: string | null): Promise<boolean> {
    const e = await this.ferramentas.escopo(quem.tenantId, quem.colaboradorId, quem.telefone);
    if (!e) return false;
    const motivo = this.motivoDeNaoPoder(e);
    if (motivo) {
      await this.falar(quem.telefone, { texto: motivo });
      return true;
    }
    const arquivo = await this.numero.baixarMidia(midia.id);
    if (!arquivo) {
      await this.falar(quem.telefone, { texto: 'Não consegui baixar a planilha. Mande de novo, por favor.' });
      return true;
    }
    let pedidos: PedidoDaLinha[];
    try {
      // O .xls antigo (sem "openxml" no tipo) recebe a frase do leitor ("Envie em Excel (.xlsx) ou CSV").
      const mime = midia.mime ?? arquivo.mime ?? '';
      const nome = /ms-excel/i.test(mime) && !/openxml/i.test(mime) ? 'planilha.xls' : '';
      const { tabela, decimalPonto } = lerTabela(arquivo.buffer, nome);
      pedidos = pedidosDaPlanilha(tabela, decimalPonto);
    } catch (err: any) {
      await this.falar(quem.telefone, { texto: String(err?.message ?? TEXTOS_DA_LISTA.planilhaSemLinhas) });
      return true;
    }
    if (!pedidos.length) {
      await this.falar(quem.telefone, { texto: TEXTOS_DA_LISTA.planilhaSemLinhas });
      return true;
    }
    const loja = this.lojaDa(e);
    const r = await this.abrir(e, loja, 'planilha', await this.montar(e.tenantId, loja, pedidos));
    await this.falar(quem.telefone, { texto: `Li ${r.linhas.length === 1 ? '1 linha' : `${r.linhas.length} linhas`} da planilha.` });
    await this.falar(quem.telefone, r.mensagem);
    return true;
  }

  // ───────────────────────────── as respostas ─────────────────────────────

  /** O toque num botão da lista. Só a dona da lista; devolve false quando a lista não é das empresas de quem tocou. */
  async tocou(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const b = lerBotaoDaLista(botaoId);
    if (!b || !quem.vinculos.length) return false;
    const pessoas = quem.vinculos.map((v) => v.colaboradorId);
    const empresas = quem.vinculos.map((v) => v.tenantId);
    let fim: Mensagem | null = null;
    let criar: { lista: any; linhas: LinhaDaLista[] } | null = null;
    const achou = await this.db.transaction(async (tx: any) => {
      const [l] = linhas(
        await tx.execute(sql`
          select id::text as id, tenant_id::text as "tenantId", unidade_id::text as "unidadeId", colaborador_id::text as "colaboradorId",
                 situacao, itens, fornecedor_id::text as "fornecedorId", fornecedor_escolhido as "fornecedorEscolhido",
                 opcoes_fornecedor as "opcoesFornecedor", (vence_em < clock_timestamp()) as vencida
            from mister_lista_compra
           where id = ${b.listaId}::uuid
             and tenant_id in (${sql.join(empresas.map((t) => sql`${t}::uuid`), sql`, `)})
             and colaborador_id in (${sql.join(pessoas.map((p) => sql`${p}::uuid`), sql`, `)})
           for update`),
      );
      if (!l) return false;
      if (!['montando', 'confirmar'].includes(l.situacao) || l.vencida) {
        fim = { texto: TEXTOS_DA_LISTA.jaRespondido };
        return true;
      }
      const itens: LinhaDaLista[] = Array.isArray(l.itens) ? l.itens : [];
      if (b.tipo === 'cancelar') {
        await tx.execute(sql`update mister_lista_compra set situacao = 'descartada', atualizada_em = clock_timestamp() where id = ${l.id}::uuid`);
        fim = { texto: TEXTOS_DA_LISTA.cancelada };
        return true;
      }
      if (b.tipo === 'criar') {
        if (l.situacao !== 'confirmar') {
          fim = { texto: TEXTOS_DA_LISTA.jaRespondido };
          return true;
        }
        // A passagem condicional "confirmar" → "criada" (o toque repetido não cria duas listas); o pedido sai depois.
        await tx.execute(sql`update mister_lista_compra set situacao = 'criada', atualizada_em = clock_timestamp() where id = ${l.id}::uuid`);
        criar = { lista: l, linhas: itens };
        return true;
      }
      if (b.tipo === 'fornecedor') {
        const opcoes: { id: string; nome: string }[] = Array.isArray(l.opcoesFornecedor) ? l.opcoesFornecedor : [];
        if (l.fornecedorEscolhido || (b.escolha !== 'sem' && !opcoes[b.escolha])) {
          fim = { texto: TEXTOS_DA_LISTA.jaRespondido };
          return true;
        }
        const fid = b.escolha === 'sem' ? null : opcoes[b.escolha].id;
        await tx.execute(sql`
          update mister_lista_compra set fornecedor_id = ${fid}::uuid, fornecedor_escolhido = true, atualizada_em = clock_timestamp()
           where id = ${l.id}::uuid`);
        return true;
      }
      const ln = itens[b.indice];
      if (!ln) {
        fim = { texto: TEXTOS_DA_LISTA.jaRespondido };
        return true;
      }
      if (b.tipo === 'marca') {
        const marca = ln.estado === 'marca' ? ln.marcas[b.k] : undefined;
        if (!marca) {
          fim = { texto: TEXTOS_DA_LISTA.jaRespondido };
          return true;
        }
        Object.assign(ln, { marca, estado: 'ligado' });
      } else if (b.tipo === 'fator') {
        if (ln.estado !== 'fator' || (b.acao === 'sim' && ln.fatorProposto == null)) {
          fim = { texto: TEXTOS_DA_LISTA.jaRespondido };
          return true;
        }
        if (b.acao === 'mesma') aplicarFator(ln, 1);
        else if (b.acao === 'sim') aplicarFator(ln, ln.fatorProposto as number);
        else ln.fatorProposto = null;
      } else {
        // "Deixar de fora" também vale na pergunta da unidade.
        if (ln.estado !== 'item' && !(ln.estado === 'fator' && b.escolha === 'f')) {
          fim = { texto: TEXTOS_DA_LISTA.jaRespondido };
          return true;
        }
        if (b.escolha === 'f') Object.assign(ln, { estado: 'fora', opcoes: [] });
        else if (b.escolha === 'n') {
          let novo: any;
          try {
            novo = await this.estoque.createItem(
              l.tenantId,
              { nome: ln.texto, unidadeMedida: normalizarUnidade(ln.unidade ?? '') ?? 'unidade' } as any,
              l.unidadeId ?? null,
              { colaboradorId: l.colaboradorId, categoria: quem.vinculos.find((v) => v.tenantId === l.tenantId)?.nivel ?? 'gerente' } as any,
            );
          } catch (err: any) {
            const msg = err instanceof BadRequestException ? String((err.getResponse() as any)?.message ?? err.message) : 'não deu para cadastrar';
            fim = { texto: `Não consegui cadastrar "${ln.texto}": ${msg}` };
            return true;
          }
          Object.assign(ln, ligarAoInsumo(ln, { id: novo.id, nome: novo.nome, unidadeMedida: novo.unidadeMedida, marcas: [] }, []));
        } else {
          const op = ln.opcoes[Number(b.escolha)];
          const insumo = op ? (await this.insumos(l.tenantId, l.unidadeId ?? null, [op.id], tx))[0] : undefined;
          if (!insumo) {
            fim = { texto: TEXTOS_DA_LISTA.jaRespondido };
            return true;
          }
          const conv = (await this.conversoes(l.tenantId, [insumo.id], tx)).get(insumo.id) ?? [];
          Object.assign(ln, ligarAoInsumo(ln, insumo, conv));
        }
      }
      await tx.execute(sql`
        update mister_lista_compra set itens = ${JSON.stringify(itens)}::jsonb, atualizada_em = clock_timestamp() where id = ${l.id}::uuid`);
      return true;
    });
    if (!achou) return false;
    if (fim) {
      await this.falar(quem.telefone, fim);
      return true;
    }
    if (criar) {
      await this.falar(quem.telefone, await this.criarPedido((criar as any).lista, (criar as any).linhas));
      return true;
    }
    await this.falar(quem.telefone, await this.seguir(b.listaId));
    return true;
  }

  /** O texto que responde a lista que espera: o fator ("1 caixa tem quantos kg?") ou a marca escrita. */
  async texto(quem: QuemMandou, t: string): Promise<boolean> {
    let listaId = '';
    let fim: Mensagem | null = null;
    const tratou = await this.db.transaction(async (tx: any) => {
      const [l] = linhas(
        await tx.execute(sql`
          select id::text as id, itens from mister_lista_compra
           where tenant_id = ${quem.tenantId}::uuid and colaborador_id = ${quem.colaboradorId}::uuid and situacao = 'montando'
             and vence_em > clock_timestamp()
           order by atualizada_em desc limit 1
           for update`),
      );
      const itens: LinhaDaLista[] = Array.isArray(l?.itens) ? l.itens : [];
      const pend = proximaPendencia(itens);
      if (!l || !pend || pend.tipo === 'item') return false;
      const ln = itens[pend.indice];
      if (pend.tipo === 'fator') {
        // A conta mostrada espera o "certo"; o resto é lido como resposta nova (ERR-584).
        const resposta = ln.fatorProposto != null ? simOuNao(t) : null;
        if (resposta === 'sim') aplicarFator(ln, ln.fatorProposto as number);
        else if (resposta === 'nao') ln.fatorProposto = null;
        else {
          const r = lerRespostaDoFator(t, ln.unidade, ln.unidadeDoEstoque);
          if (r.tipo === 'outro') return false;
          if (r.tipo === 'duvida') {
            fim = duvidaDoFator(l.id, pend.indice, ln);
            return true;
          }
          if (r.tipo === 'numero') aplicarFator(ln, r.fator);
          else ln.fatorProposto = r.fator;
        }
      } else {
        const marca = marcaDoTexto(ln.marcas, t);
        if (!marca) return false;
        Object.assign(ln, { marca, estado: 'ligado' });
      }
      const [mudou] = linhas(
        await tx.execute(sql`
          update mister_lista_compra set itens = ${JSON.stringify(itens)}::jsonb, atualizada_em = clock_timestamp()
           where id = ${l.id}::uuid and situacao = 'montando' returning id`),
      );
      if (!mudou) return false;
      listaId = String(l.id);
      return true;
    });
    if (!tratou) return false;
    await this.falar(quem.telefone, fim ?? (await this.seguir(listaId)));
    return true;
  }

  // ───────────────────────────── por dentro ─────────────────────────────

  /** As linhas, cada uma ligada (ou não) a um insumo da loja ou da rede. */
  private async montar(tenantId: string, loja: string | null, pedidos: PedidoDaLinha[]): Promise<LinhaDaLista[]> {
    const insumos = await this.insumos(tenantId, loja, null);
    const conversoes = await this.conversoes(tenantId, insumos.map((i) => i.id));
    return pedidos.map((p) => montarLinha(p, insumos, conversoes));
  }

  /** Grava a lista nova (a aberta de antes da pessoa é descartada) e devolve a primeira mensagem. */
  private async abrir(e: EscopoDoMister, loja: string | null, origem: 'conversa' | 'planilha' | 'minimo', itens: LinhaDaLista[]) {
    await this.db.execute(sql`
      update mister_lista_compra set situacao = 'descartada', atualizada_em = clock_timestamp()
       where tenant_id = ${e.tenantId}::uuid and colaborador_id = ${e.colaboradorId}::uuid and situacao in ('montando', 'confirmar')`);
    const [l] = linhas(
      await this.db.execute(sql`
        insert into mister_lista_compra (tenant_id, unidade_id, colaborador_id, origem, situacao, itens, vence_em)
        values (${e.tenantId}::uuid, ${loja}::uuid, ${e.colaboradorId}::uuid, ${origem}, 'montando', ${JSON.stringify(itens)}::jsonb,
                clock_timestamp() + make_interval(hours => ${LISTA_VALE_H}::int))
        returning id::text as id`),
    );
    return { id: String(l.id), linhas: itens, mensagem: await this.seguir(String(l.id)) };
  }

  /**
   * A próxima mensagem da lista: a pergunta da próxima linha; tudo respondido, o passo do fornecedor (os fornecedores dos
   * insumos: nenhum → sem; um → ele; dois ou mais → a pergunta); por fim, o resumo com "Criar o pedido".
   */
  private async seguir(listaId: string): Promise<Mensagem> {
    const [l] = linhas(
      await this.db.execute(sql`
        select m.id::text as id, m.tenant_id::text as "tenantId", m.itens, m.fornecedor_id::text as "fornecedorId",
               m.fornecedor_escolhido as "fornecedorEscolhido", f.nome as "fornecedorNome"
          from mister_lista_compra m
          left join fornecedor f on f.id = m.fornecedor_id and f.tenant_id = m.tenant_id
         where m.id = ${listaId}::uuid`),
    );
    if (!l) return { texto: TEXTOS_DA_LISTA.jaRespondido };
    const itens: LinhaDaLista[] = Array.isArray(l.itens) ? l.itens : [];
    const pend = proximaPendencia(itens);
    if (pend) return perguntaDaLinha(listaId, pend.indice, itens[pend.indice]);
    const ligadas = itens.filter((x) => x.estado === 'ligado');
    if (!ligadas.length) {
      await this.db.execute(sql`update mister_lista_compra set situacao = 'descartada', atualizada_em = clock_timestamp() where id = ${listaId}::uuid`);
      return { texto: TEXTOS_DA_LISTA.vazia };
    }
    let fornecedorNome: string | null = l.fornecedorNome ?? null;
    if (!l.fornecedorEscolhido) {
      const opcoes = await this.fornecedoresDosItens(l.tenantId, ligadas.map((x) => x.itemId as string));
      if (opcoes.length >= 2) {
        await this.db.execute(sql`
          update mister_lista_compra set opcoes_fornecedor = ${JSON.stringify(opcoes.slice(0, 2))}::jsonb, atualizada_em = clock_timestamp()
           where id = ${listaId}::uuid`);
        return perguntaDoFornecedor(listaId, opcoes.slice(0, 2));
      }
      fornecedorNome = opcoes[0]?.nome ?? null;
      await this.db.execute(sql`
        update mister_lista_compra set fornecedor_id = ${opcoes[0]?.id ?? null}::uuid, fornecedor_escolhido = true, atualizada_em = clock_timestamp()
         where id = ${listaId}::uuid`);
    }
    await this.db.execute(sql`update mister_lista_compra set situacao = 'confirmar', atualizada_em = clock_timestamp() where id = ${listaId}::uuid and situacao = 'montando'`);
    return resumoDaLista(listaId, itens, fornecedorNome);
  }

  /** "Criar o pedido": a lista pelo MESMO serviço da tela (a marca e a loja conferidas por ele). Falhou: volta a "confirmar". */
  private async criarPedido(l: any, itens: LinhaDaLista[]): Promise<Mensagem> {
    const ligadas = itens.filter((x) => x.estado === 'ligado' && x.itemId);
    const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
    const nome = `Lista do Mister · ${hoje}`;
    try {
      const r: any = await this.compras.createLista(
        l.tenantId,
        {
          nome,
          fornecedorId: l.fornecedorId ?? undefined,
          itens: ligadas.map((x) => ({ itemId: x.itemId as string, quantidade: quantidadeNoEstoque(x), ...(x.marca ? { marca: x.marca } : {}) })),
        } as any,
        l.unidadeId ?? null,
      );
      await this.db.execute(sql`update mister_lista_compra set compra_lista_id = ${r.id}::uuid, atualizada_em = clock_timestamp() where id = ${l.id}::uuid`);
      await this.auditoria
        ?.registrar({ tenantId: l.tenantId, atorId: l.colaboradorId, atorPerfil: 'mister', tipo: 'mister', acao: 'mister_lista_criada', entidadeTipo: 'compra_lista', entidadeId: r.id, detalhe: { itens: ligadas.length, lista: l.id } } as any)
        .catch(() => undefined);
      return { texto: TEXTOS_DA_LISTA.criada(nome, ligadas.length) };
    } catch (err: any) {
      await this.db.execute(sql`update mister_lista_compra set situacao = 'confirmar', atualizada_em = clock_timestamp() where id = ${l.id}::uuid and situacao = 'criada'`);
      const msg = err instanceof BadRequestException ? String((err.getResponse() as any)?.message ?? err.message) : null;
      if (!msg) this.logger.error(`lista ${l.id}: o pedido não foi criado — ${err?.message ?? err}`, err?.stack);
      return { texto: msg ? `Não consegui criar o pedido: ${msg}` : 'Não consegui criar o pedido agora. Tente de novo em instantes.' };
    }
  }

  /** Os insumos da loja ou da rede (o mesmo recorte do pedido da tela), com a unidade e as marcas. */
  private async insumos(tenantId: string, loja: string | null, so: string[] | null, executor: any = this.db): Promise<InsumoDaLista[]> {
    const daLoja = loja ? sql`and (i.unidade_id is null or i.unidade_id = ${loja}::uuid)` : sql``;
    const soEstes = so?.length ? sql`and i.id in (${sql.join(so.map((x) => sql`${x}::uuid`), sql`, `)})` : sql``;
    return linhas(
      await executor.execute(sql`
        select i.id::text as id, i.nome, i.nome_comercial as "nomeComercial", i.unidade_medida as "unidadeMedida", coalesce(i.marcas, '[]'::jsonb) as marcas
          from item_estoque i
         where i.tenant_id = ${tenantId}::uuid and i.deleted_at is null ${daLoja} ${soEstes}
         order by i.nome
         limit ${MAX_INSUMOS}`),
    ).map((x) => ({ ...x, marcas: Array.isArray(x.marcas) ? x.marcas : [] }));
  }

  /** As conversões cadastradas dos insumos (a mesma tabela da tela). */
  private async conversoes(tenantId: string, ids: string[], executor: any = this.db): Promise<Map<string, Conversao[]>> {
    const mapa = new Map<string, Conversao[]>();
    if (!ids.length) return mapa;
    // A mesma leitura do serviço das notas (M3b).
    for (const c of linhas(
      await executor.execute(sql`
        select item_id::text as "itemId", unidade_de as "unidadeDe", fator, unidade_para as "unidadePara" from item_conversao
         where tenant_id = ${tenantId}::uuid and item_id in (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})`),
    ))
      mapa.set(c.itemId, [...(mapa.get(c.itemId) ?? []), { unidadeDe: c.unidadeDe, fator: c.fator, unidadePara: c.unidadePara }]);
    return mapa;
  }

  /** Os fornecedores ligados aos insumos da lista (os mais comuns primeiro). */
  private async fornecedoresDosItens(tenantId: string, ids: string[]): Promise<{ id: string; nome: string }[]> {
    if (!ids.length) return [];
    return linhas(
      await this.db.execute(sql`
        select f.id::text as id, f.nome, count(*)::int as n
          from item_fornecedor x
          join fornecedor f on f.id = x.fornecedor_id and f.tenant_id = x.tenant_id and f.deleted_at is null
         where x.tenant_id = ${tenantId}::uuid and x.item_id in (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
         group by f.id, f.nome
         order by n desc, f.nome
         limit 5`),
    ).map((x) => ({ id: String(x.id), nome: String(x.nome) }));
  }

  private async falar(telefone: string, m: Mensagem): Promise<void> {
    try {
      for (const parte of emMensagens(m)) await this.numero.enviar(telefone, parte);
    } catch (e: any) {
      this.logger.warn(`a mensagem da lista de compras não saiu — ${e instanceof FalhaDoEnvioDoMister ? e.motivo : (e?.message ?? e)}`);
    }
  }
}
