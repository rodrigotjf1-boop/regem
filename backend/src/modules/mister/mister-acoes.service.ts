import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { uuidDeChave } from '../../common/id-deterministico';
import { hojeISO, horaNoFuso } from '../../common/data';
import { pausaVigenteDoCanal, type CanalDaPausa } from '../../common/pausa-do-canal';
import { pode, podeAcessar, type Permissoes } from '../../auth/permissoes';
import type { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { DeliveryService } from '../delivery/delivery.service';
import { PausaDoCanalService } from '../delivery/pausa-do-canal.service';
import { ProdutoService } from '../produto/produto.service';
import { TarefaInstanciaService } from '../tarefa/tarefa-instancia.service';
import { TarefaDefService } from '../tarefa/tarefa-def.service';
import { pedidoComoNoQuadro } from './mister-agente.regras';
import {
  ACOES,
  AcaoDoMister,
  CanalDoProduto,
  BOTOES_DA_IMAGEM,
  BOTOES_DO_DADO,
  TIPO_DO_DADO,
  ehDadoInformado,
  textoDoDadoGuardado,
  type AcaoDeDadoInformado,
  ParametrosDaAcao,
  type ProporcaoDaImagem,
  TEXTOS_DAS_ACOES,
  canaisDoProduto,
  conferirAcao,
  ehAcaoDoMister,
  imagemLigada,
  mesmaUnidade,
  quantidadeBr,
  resumoDoMovimento,
  resumoDoPreco,
  reaisDaAcao,
  canaisComOPreco,
  type MudancaDePreco,
  resumoDoHorario,
  type MudancaDeHorario,
  linhaDaConta,
  resumoDaBaixa,
  textoDaBaixaFeita,
  type BaixaDeConta,
  type DefinicaoDaAcao,
  type FormaDaBaixa,
  sigaDaAcao,
  nomeDoEstadoDaTarefa,
  nomesDosCanais,
  ondeOProduto,
  pedidoAndou,
  pedidoServe,
  produtoFicou,
  resumoDoPedido,
  ehCadastro,
  ehDaLoja,
} from './mister-acoes';
import { resumoDaConta, descontoDoCupom, reaisBr, resumoDoProduto, resumoDoFornecedor, resumoDaTroca, resumoDaFolga, diaComSemana, type ParametrosDaLoja } from './mister-acoes-loja';
import { EscalaService } from '../escala/escala.service';
import { resumoDaClassificacao, type ParametrosDaClassificacao } from './mister-acoes-banco';
import { resumoDaContagem, type ParametrosDaContagem } from './mister-acoes-contagem';
import { MOTIVO_MINIMO, nomeDoCaixa, resumoDaSangria, resumoDoFechamento, type ParametrosDoCaixa } from './mister-acoes-caixa';
import { acharEntregador, recusaDoAcerto, resumoDoPagamento, type LinhaDoAcerto, type ParametrosDoEntregador } from './mister-acoes-entregador';
import { marcacoesDoDia, resumoDoPonto, type ParametrosDoPonto } from './mister-acoes-ponto';
import { agendadosParaDepois, pendenciasDoTurno } from '../delivery/pendencias-turno';
import { ModuleRef } from '@nestjs/core';
import type { ParametrosDeCadastro } from './mister-acoes-cadastro';
import { EscopoDoMister, MisterFerramentasService, ResultadoDaFerramenta } from './mister-ferramentas.service';
import { FornecedorService } from '../fornecedor/fornecedor.service';
import { ComprasService } from '../compras/compras.service';
import { FUSO_SQL } from '../../common/fuso-sql';
import { MisterNumeroService } from './mister-numero.service';
import { botoesDaProposta } from './mister-procedimentos';
import { MisterPropostasService, type PropostaPendente } from './mister-propostas.service';
import { GraphImagemService } from '../graph/graph-imagem.service';
import { EstoqueService } from '../estoque/estoque.service';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { sqlUnidade } from '../../common/filtro-unidade';
import { acharCampanha, gravarDadoInformado } from './mister-indicadores.leitura';
import { ifoodPeloOrzuniLigado } from '../../common/ifood-pelo-orzuni';
import { precosNa99Ligado } from '../../common/precos-na-99';
import {
  NOMES_DOS_DIAS,
  gravarHorariosDosDias,
  mesmaJanela,
  recusaDoHorario,
  situacaoDoDia,
  textoDaJanela,
  type ColunaDoHorario,
  type JanelaDoDia,
} from '../../common/horarios-da-loja';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS AÇÕES DO MISTER (versão 6, M6j; `mister-acoes.ts` tem o catálogo e as conferências). A ferramenta `propor_acao` confere
// a ação, a permissão do perfil (a MESMA da rota da tela) e o alvo, e grava a proposta de botão (`mister_proposta`, a mesma
// das F4.x) com QUEM pediu; o "Autorizar" dessa pessoa executa pelo MESMO serviço da tela e o efeito é conferido na hora,
// pelo estado que ficou. Sem migration: o procedimento da proposta é texto, e as ações entram no catálogo do código.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => ['42P01', '42703'].includes(e?.code) || ['42P01', '42703'].includes(e?.cause?.code);
const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });
type AcaoDePedido = 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido';
/** O padrão do `ilike` (o mesmo da busca das regras: o texto sem `%`, `_` e barra). */
const comoTexto = (texto: string) => `%${texto.replace(/[%_\\]/g, '')}%`;
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** Da busca, um só: o nome igual (sem acento e maiúscula) vence; senão, o único achado; senão, a pessoa escolhe. */
function escolherUm<T>(achados: any[], dito: string, nome: (a: any) => string, nenhum: string, varios: (nomes: string) => string, montar: (a: any) => T): T | { erro: string } {
  if (!achados.length) return { erro: nenhum };
  const iguais = achados.filter((a) => semAcento(nome(a)) === semAcento(dito));
  if (iguais.length === 1) return montar(iguais[0]);
  if (achados.length === 1) return montar(achados[0]);
  return { erro: varios(achados.map((a) => `"${nome(a)}"`).join(', ')) };
}
/** A frase de quem não tem a permissão da ação (a mesma da rota da tela). */
const semPermissaoDe = (p: DefinicaoDaAcao['permissao']) =>
  p === 'financeiro'
    ? TEXTOS_DAS_ACOES.semPermissaoConta
    : p === 'estoque'
    ? TEXTOS_DAS_ACOES.semPermissaoEstoque
    : p === 'cupons'
    ? TEXTOS_DAS_ACOES.semPermissaoCupons
    : p === 'cadastros'
    ? TEXTOS_DAS_ACOES.semPermissaoCadastros
    : p === 'escalas'
    ? TEXTOS_DAS_ACOES.semPermissaoEscalas
    : p === 'pdv'
    ? TEXTOS_DAS_ACOES.semPermissaoCaixa
    : p === 'ponto'
    ? TEXTOS_DAS_ACOES.semPermissaoPonto
    : p === 'meu_dia'
    ? TEXTOS_DAS_ACOES.semPermissaoTarefas
    : p === 'loja'
      ? TEXTOS_DAS_ACOES.semPermissaoLoja
      : p === 'checklist'
        ? TEXTOS_DAS_ACOES.semPermissaoChecklist
        : TEXTOS_DAS_ACOES.semPermissao;
/** A MESMA conta do `PermissoesGuard`: o estoque e a escala são CRUD (as rotas pedem `criar`/`editar`), os outros são chaves simples. */
const temAPermissao = (perm: Permissoes | undefined | null, p: DefinicaoDaAcao['permissao'], crud: DefinicaoDaAcao['crud'] = 'editar') =>
  // As chaves com ações (ver, criar, editar, excluir) conferem a ação da rota; as outras, o acesso. O ponto entrou na etapa 5
  // (24/11): incluir pede ponto.criar e desconsiderar, ponto.editar — sem isso, quem só vê o ponto ajustava pela conversa.
  p === 'estoque' || p === 'escalas' || p === 'ponto' ? pode(perm, p, crud ?? 'editar') : podeAcessar(perm, p);
/** A permissão da ação: a da rota e, no preço, "Ver valores em R$" (o `exigirVerValores` da rota). O presidente pode tudo. */
const podeFazer = (e: { nivel: string; permissoes?: Permissoes | null }, def: (typeof ACOES)[AcaoDoMister]) =>
  e.nivel === 'presidente' || (temAPermissao(e.permissoes, def.permissao, def.crud) && (!def.pedeVerValores || !!e.permissoes?.ver_financeiro));
const NOME_DA_SITUACAO: Record<string, string> = { novo: 'aguardando aceite', confirmado: 'em preparo', pronto: 'pronto', despachado: 'a caminho', concluido: 'concluído', entregue: 'entregue', cancelado: 'cancelado' };

/** A ação conferida, pronta para virar proposta (`propor_acao`) ou um passo do plano (V7c). */
export interface AcaoPreparada {
  acao: AcaoDoMister;
  def: DefinicaoDaAcao;
  unidadeId: string | null;
  parametros: Record<string, unknown>;
  resumo: string;
  /** A chave do alvo: a mesma ação no mesmo alvo é a mesma proposta. */
  alvo: string;
}

@Injectable()
export class MisterAcoesService implements OnModuleInit {
  private readonly logger = new Logger('MisterAcoes');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ferramentas: MisterFerramentasService,
    private readonly propostas: MisterPropostasService,
    @Optional() private readonly numero?: MisterNumeroService,
    @Optional() private readonly delivery?: DeliveryService,
    @Optional() private readonly pausa?: PausaDoCanalService,
    @Optional() private readonly auditoria?: AuditoriaService,
    // Lote 2: a tarefa e o produto pelos MESMOS serviços das telas (Tarefas; a pausa do produto no cadastro).
    @Optional() private readonly tarefas?: TarefaInstanciaService,
    @Optional() private readonly produtos?: ProdutoService,
    // Lote 3: a definição da tarefa (a primeira etapa do "Nova tarefa" da tela).
    @Optional() private readonly defs?: TarefaDefService,
    // M6l: a imagem pelo DMS Graph (módulo só da nuvem).
    @Optional() private readonly imagens?: GraphImagemService,
    // Lote 7: o movimento pelo MESMO serviço de Estoque › Produtos.
    @Optional() private readonly estoque?: EstoqueService,
    // Lote 10: a baixa pelo MESMO serviço de Financeiro › Contas a pagar.
    @Optional() private readonly financeiro?: FinanceiroService,
    // Versão 9, O3: o fornecedor e o pedido de compra pelos MESMOS serviços das telas.
    @Optional() private readonly fornecedores?: FornecedorService,
    @Optional() private readonly compras?: ComprasService,
    // Versão 9, O5: o serviço dos cupons é achado na hora (o módulo do cardápio não entra neste, para não fechar um ciclo).
    @Optional() private readonly moduleRef?: ModuleRef,
    // Versão 9, O5 segunda parte: trocar a pessoa de um turno e dar folga pelo MESMO serviço da Escala (as regras da CLT dele).
    @Optional() private readonly escala?: EscalaService,
  ) {}

  onModuleInit(): void {
    this.ferramentas.registrarAcoes((e, en, loja) => this.propor(e, en, loja));
    this.propostas.registrarAcao((p) => this.executar(p));
  }

  // ───────────────────────────── propor ─────────────────────────────

  /** A ferramenta `propor_acao`. Nunca lança: o erro vira a frase que volta à IA. */
  async propor(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    try {
      const pronta = await this.preparar(e, en, loja);
      if ('erro' in pronta) return recusa(pronta.erro);
      const { acao, def, unidadeId, parametros, resumo, alvo } = pronta;
      const p = await this.gravar(e, acao, unidadeId, parametros, alvo);
      if (!p) return recusa('Essa mesma ação já foi autorizada e está em andamento; o resultado chega na conversa.');
      if (def.nivel === 'pin') {
        // A de PIN sai com o link "Abrir no Regem", depois da resposta (o agente chama `enviarLinkDaProposta`), nunca com botões.
        const proposta: PropostaPendente = { id: p.id, procedimento: acao, nivel: 'pin', pergunta: TEXTOS_DAS_ACOES.linkDaAcao(resumo, horaNoFuso(new Date(p.venceEm))), botoes: [] };
        return { ok: true, dados: { oQueVouFazer: resumo, siga: sigaDaAcao(acao) }, proposta };
      }
      return {
        ok: true,
        dados: {
          oQueVouFazer: resumo,
          siga: sigaDaAcao(acao),
        },
        mensagens: [
          acao === 'criar_imagem'
            ? { texto: TEXTOS_DAS_ACOES.perguntaDaImagem(resumo, def.prazoMin), botoes: botoesDaProposta(p.id, BOTOES_DA_IMAGEM) }
            : ehDadoInformado(acao)
            ? { texto: TEXTOS_DAS_ACOES.perguntaDoDado(resumo, def.prazoMin), botoes: botoesDaProposta(p.id, BOTOES_DO_DADO) }
            : { texto: TEXTOS_DAS_ACOES.pergunta(resumo, def.prazoMin), botoes: botoesDaProposta(p.id) },
        ],
      };
    } catch (err: any) {
      if (semTabela(err)) return recusa('As ações do Mister ainda não estão disponíveis neste servidor.');
      this.logger.error(`a ação não foi proposta: ${String(err?.message ?? err).slice(0, 300)}`, err?.stack);
      return recusa('Não consegui preparar a ação agora.');
    }
  }

  /**
   * Toda a conferência da ação, sem gravar nada: o formato, a permissão do perfil, o alvo e o "o que vou fazer". É a porta
   * única: `propor_acao` passa por aqui e cada passo do plano (V7c) também, ao propor e de novo na hora de fazer. Pode lançar.
   */
  async preparar(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<AcaoPreparada | { erro: string }> {
    const recusa = (erro: string) => ({ erro });
    {
      if (e.nivel !== 'presidente' && e.nivel !== 'gerente') return recusa(TEXTOS_DAS_ACOES.soGestor);
      const c = conferirAcao(en.acao, en);
      if ('erro' in c) return recusa(c.erro);
      const def = ACOES[c.parametros.acao];
      // V7f: o dado da empresa inteira é do presidente da empresa inteira, com o PIN da sessão em dia.
      if (def.soPresidente && e.nivel !== 'presidente') return recusa(TEXTOS_DAS_ACOES.dadoSoPresidente);
      if (def.soPresidente && e.presa) return recusa(TEXTOS_DAS_ACOES.dadoEmpresaInteira);
      if (def.soPresidente && !e.verValores) return recusa(TEXTOS_DAS_ACOES.dadoPedePin);
      if (!podeFazer(e, def))
        return recusa(def.id === 'mudar_horario' ? TEXTOS_DAS_ACOES.semPermissaoHorario : def.id === 'mudar_preco' ? TEXTOS_DAS_ACOES.semPermissaoPreco : def.id === 'lancar_conta' ? TEXTOS_DAS_ACOES.semPermissaoLancarConta : semPermissaoDe(def.permissao));
      // Lote 10: quem autoriza dinheiro VÊ o valor. Com o PIN da sessão vencido, o link da sessão vai depois desta resposta.
      if ((c.parametros.acao === 'pagar_conta' || c.parametros.acao === 'lancar_conta' || c.parametros.acao === 'classificar_banco') && !e.verValores) return recusa(TEXTOS_DAS_ACOES.contaPedePin);
      // Banco e repasses é só do presidente, como a rota (V8-2): o gerente não recebe nem a contagem.
      if (c.parametros.acao === 'classificar_banco' && e.nivel !== 'presidente') return recusa(TEXTOS_DAS_ACOES.bancoSoPresidente);
      if (c.parametros.acao === 'criar_imagem' && !imagemLigada()) return recusa(TEXTOS_DAS_ACOES.imagemDesligada);
      // A de PIN vai pelo link, que também sai pela conexão por QR Code (escrito na mensagem).
      if (def.nivel === 'botao' && this.numero && (await this.numero.ler()).provedor === 'evolution') return recusa(ehDadoInformado(def.id) ? TEXTOS_DAS_ACOES.dadoSemBotao : TEXTOS_DAS_ACOES.semBotao);
      // A loja: a da conversa (o gerente, a dele); a empresa de uma loja só, ela.
      const lojas = loja.atual ? [loja.atual] : e.lojas.map((l) => l.id);
      if (!lojas.length && !e.lojaUnica) return recusa(TEXTOS_DAS_ACOES.semPermissao);
      let unidadeId: string | null = loja.atual ?? (e.lojaUnica ? (e.lojas[0]?.id ?? null) : null);
      let resumo = c.resumo;
      const parametros: Record<string, unknown> = { ...c.parametros, colaboradorId: e.colaboradorId, nivel: e.nivel };
      let alvo: string = c.parametros.acao;
      if (c.parametros.acao === 'aceitar_pedido' || c.parametros.acao === 'pedido_pronto' || c.parametros.acao === 'despachar_pedido') {
        const achado = await this.acharPedido(e.tenantId, c.parametros.numero, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in achado) return recusa(achado.erro);
        const fora = pedidoServe(c.parametros.acao, achado);
        if (fora) return recusa(fora);
        unidadeId = achado.unidadeId;
        parametros.pedidoId = achado.id;
        parametros.pedido = achado.nome;
        resumo = resumoDoPedido(c.parametros.acao, achado.nome);
        alvo = achado.id;
      } else if (c.parametros.acao === 'concluir_tarefa') {
        // Lote 2: a tarefa de HOJE (o dia da loja) pelo título, nas lojas da pessoa; a regra de foto da tela, já na pergunta.
        const t = await this.acharTarefa(e.tenantId, c.parametros.tarefa, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in t) return recusa(t.erro);
        if (t.estado === c.parametros.estado) return recusa(TEXTOS_DAS_ACOES.tarefaJaMarcada(nomeDoEstadoDaTarefa(t.estado)));
        if (this.tarefas && c.parametros.estado !== 'nao_feita') {
          const pol = await this.tarefas.politicaFoto(e.tenantId);
          if ((c.parametros.estado === 'feita' && pol.conclusao) || (c.parametros.estado === 'parcial' && pol.parcial)) return recusa(TEXTOS_DAS_ACOES.tarefaPedeFoto);
        }
        unidadeId = t.unidadeId;
        parametros.instanciaId = t.id;
        parametros.titulo = t.titulo;
        resumo = `Marcar a tarefa "${t.titulo}" como ${nomeDoEstadoDaTarefa(c.parametros.estado)}${c.parametros.justificativa ? ` (motivo: ${c.parametros.justificativa})` : ''}.`;
        alvo = t.id;
      } else if (c.parametros.acao === 'criar_tarefa') {
        // Lote 3: a loja da tarefa (a da conversa; a da empresa de uma loja só), a função pelo nome (a tela exige) e o
        // responsável, se dito, entre os ativos da loja.
        const u = loja.atual ?? (e.lojaUnica ? (e.lojas[0]?.id ?? null) : null);
        if (!u) return recusa(TEXTOS_DAS_ACOES.lojaDaTarefa);
        const f = await this.acharFuncao(e.tenantId, c.parametros.funcao);
        if ('erro' in f) return recusa(f.erro);
        let resp: { id: string; nome: string } | null = null;
        if (c.parametros.responsavel) {
          const r = await this.acharColaborador(e.tenantId, c.parametros.responsavel, u);
          if ('erro' in r) return recusa(r.erro);
          resp = r;
        }
        unidadeId = u;
        parametros.funcaoId = f.id;
        parametros.funcaoNome = f.nome;
        // `colaboradorId` é QUEM PEDIU (a régua do "Autorizar"): o responsável vai em outro campo.
        parametros.responsavelId = resp?.id ?? null;
        parametros.responsavelNome = resp?.nome ?? null;
        resumo = `Criar para hoje a tarefa "${c.parametros.titulo}"${c.parametros.horario ? ` às ${c.parametros.horario}` : ''}, da função ${f.nome}${resp ? `, para ${resp.nome}` : ', em aberto (sem responsável)'}.`;
        alvo = `${c.parametros.titulo}:${f.id}`;
      } else if (c.parametros.acao === 'pausar_produto' || c.parametros.acao === 'reativar_produto') {
        // Lote 2: o produto do cardápio pelo nome; sem canal dito, os canais em que ele está ("Pausar em todos" da tela).
        const pr = await this.acharProduto(e.tenantId, c.parametros.produto, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in pr) return recusa(pr.erro);
        const canais = c.parametros.canais ?? canaisDoProduto(pr);
        parametros.produtoId = pr.id;
        parametros.nome = pr.nome;
        parametros.canais = canais;
        resumo = `${c.parametros.acao === 'pausar_produto' ? 'Pausar' : 'Reativar'} "${pr.nome}" ${ondeOProduto(canais)}.`;
        alvo = pr.id;
      } else if ((c.parametros.acao === 'pausar_canal' || c.parametros.acao === 'reabrir_canal') && c.parametros.canais.includes('cardapio') && this.pausa) {
        // O cardápio digital é de cada loja: quem diz qual é o serviço da tela (o cadastro do cardápio), já na pergunta.
        try {
          const l = await this.pausa.lojaDoCardapio(e.tenantId, unidadeId);
          if (!l.tem) return recusa('Esta loja não tem cardápio digital para pausar.');
        } catch {
          return recusa('A empresa tem mais de um cardápio digital: diga de qual loja é a pausa.');
        }
      }
      if (c.parametros.acao === 'movimentar_estoque') {
        // Lote 7: o produto pelo nome, a unidade que a pessoa disse e a loja do lançamento (cada loja tem o próprio estoque).
        const it = await this.acharItem(e.tenantId, c.parametros.item, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in it) return recusa(it.erro);
        if (typeof en.medidaDita === 'string' && en.medidaDita.trim() && !mesmaUnidade(en.medidaDita, it.unidade))
          return recusa(TEXTOS_DAS_ACOES.estoqueOutraUnidade(it.nome, it.unidade));
        const daLoja = loja.atual ?? it.unidadeId ?? (e.lojaUnica ? (e.lojas[0]?.id ?? null) : null);
        if (!daLoja && !e.lojaUnica) return recusa(TEXTOS_DAS_ACOES.estoquePedeLoja);
        const saldo = await this.saldoDoItem(e.tenantId, it.id, daLoja);
        unidadeId = daLoja;
        parametros.itemId = it.id;
        parametros.nomeDoItem = it.nome;
        parametros.unidadeDeMedida = it.unidade;
        resumo = resumoDoMovimento(c.parametros, { nome: it.nome, unidade: it.unidade, saldo, loja: e.lojaUnica ? null : (e.lojas.find((l) => l.id === daLoja)?.nome ?? null) });
        alvo = `${it.id}:${c.parametros.tipo}:${c.parametros.quantidade ?? c.parametros.saldoContado}`;
      }
      if (c.parametros.acao === 'mudar_preco') {
        // Lote 8: uma proposta por produto. Pedir outro preço troca a anterior, e o link dela para de valer.
        const m = await this.prepararPreco(e, c.parametros, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in m) return recusa(m.erro);
        unidadeId = m.unidadeId ?? unidadeId;
        parametros.produtoId = m.id;
        parametros.mudanca = m.mudanca;
        resumo = resumoDoPreco(m.mudanca);
        alvo = m.id;
      }
      if (c.parametros.acao === 'mudar_horario') {
        // Lote 9: uma proposta por cardápio e horário. Pedir outro troca a anterior, e o link dela para de valer.
        const h = await this.prepararHorario(e, c.parametros, unidadeId);
        if ('erro' in h) return recusa(h.erro);
        unidadeId = h.unidadeDoCardapio ?? unidadeId;
        parametros.unidadeDoCardapio = h.unidadeDoCardapio;
        parametros.coluna = h.coluna;
        parametros.mudancaDeHorario = h.mudanca;
        resumo = resumoDoHorario(h.mudanca);
        alvo = `${h.unidadeDoCardapio ?? 'empresa'}:${h.coluna}`;
      }
      if (c.parametros.acao === 'pagar_conta') {
        // Lote 10: uma proposta por conta. Pedir de novo troca a anterior, e o link dela para de valer.
        const b = await this.prepararBaixa(e, c.parametros, loja.atual ?? e.presa ?? null);
        if ('erro' in b) return recusa(b.erro);
        unidadeId = b.unidadeId ?? unidadeId;
        parametros.tituloId = b.id;
        parametros.baixa = b.baixa;
        resumo = resumoDaBaixa(b.baixa);
        alvo = b.id;
      }
      if (ehDaLoja(c.parametros.acao)) {
        // Versão 9, O5: o cupom pelo código e o fornecedor da conta pelo nome, conferidos antes da pergunta.
        const r = await this.prepararDaLoja(e, c.parametros as ParametrosDaLoja, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in r) return recusa(r.erro);
        Object.assign(parametros, r.parametros);
        if (r.resumo) resumo = r.resumo;
        alvo = r.alvo;
        if (r.unidadeId !== undefined) unidadeId = r.unidadeId;
      }
      if (c.parametros.acao === 'classificar_banco') {
        // Versão 9, O5: o lançamento pelo dia e pelo valor (e um pedaço da descrição quando há dois), nas lojas da conversa.
        const x = c.parametros as ParametrosDaClassificacao;
        const doBanco = e.lojaUnica && !loja.atual ? null : lojas;
        const achados = linhas(
          await this.db.execute(sql`
            select l.id::text as id, l.unidade_id::text as "unidadeId", l.data::text as data, l.descricao, l.valor_centavos::bigint as valor
              from banco_lancamento l
             where l.tenant_id = ${e.tenantId}::uuid and l.data = ${x.dia}::date and abs(l.valor_centavos) = ${x.valorCentavos}
               ${x.trecho ? sql`and l.descricao ilike ${comoTexto(x.trecho.toUpperCase())}` : sql``}
               ${doBanco ? sql`and l.unidade_id in (${sql.join(doBanco.map((u) => sql`${u}::uuid`), sql`, `)})` : sql``}
             order by l.descricao
             limit 6`).catch((err: any) => {
            // Sem a tabela do extrato (a mig 499 ainda não entrou): nada a classificar, como sem lançamento.
            if (semTabela(err)) return [];
            throw err;
          }),
        );
        const reaisDe = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const diaBr = `${x.dia.slice(8, 10)}/${x.dia.slice(5, 7)}`;
        if (!achados.length) return recusa(TEXTOS_DAS_ACOES.lancamentoNaoAchado(reaisDe(x.valorCentavos), diaBr));
        if (achados.length > 1) return recusa(TEXTOS_DAS_ACOES.lancamentosDemais(achados.map((l) => `"${l.descricao}"`).join(', ')));
        const l = achados[0];
        Object.assign(parametros, { lancamentoId: l.id, data: l.data, descricao: String(l.descricao), valorCentavos: Number(l.valor) });
        resumo = resumoDaClassificacao({ data: l.data, descricao: String(l.descricao), valorCentavos: Number(l.valor) }, x.tipo, x.lembrar);
        alvo = `banco:${l.id}`;
        unidadeId = l.unidadeId;
      }
      if (c.parametros.acao === 'fechar_caixa' || c.parametros.acao === 'sangria') {
        // Etapa 1 (24/11): o caixa aberto das lojas da conversa (o do delivery é da empresa), de quem abriu, e as pendências do turno.
        const r = await this.prepararCaixa(e, c.parametros as ParametrosDoCaixa, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in r) return recusa(r.erro);
        Object.assign(parametros, r.parametros);
        resumo = r.resumo;
        alvo = r.alvo;
        unidadeId = r.unidadeId;
      }
      if (c.parametros.acao === 'pagar_entregador') {
        // Etapa 2 (24/11): o acerto do entregador pelo MESMO cálculo da tela (o período de cada um e as entregas sem acerto).
        const servico = await this.servicoDoEntregador();
        if (!servico) return recusa(TEXTOS_DAS_ACOES.entregadorIndisponivel);
        const achado = acharEntregador((await servico.fechamentoEntregadores(e.tenantId)) as LinhaDoAcerto[], (c.parametros as ParametrosDoEntregador).entregador);
        if ('erro' in achado) return recusa(achado.erro);
        const l = achado.linha;
        const nao = recusaDoAcerto(l);
        if (nao) return recusa(nao);
        Object.assign(parametros, { entregadorId: l.colaboradorId, nomeDoEntregador: l.nome, entregas: l.entregas, diaria: l.diaria, taxas: l.taxas, total: l.total, periodo: l.periodo });
        resumo = resumoDoPagamento(l);
        alvo = `entregador:${l.colaboradorId}`;
      }
      if (c.parametros.acao === 'incluir_marcacao' || c.parametros.acao === 'desconsiderar_marcacao') {
        // Etapa 5 (24/11): a pessoa das lojas da conversa, as marcações do dia e a marcação certa (Portaria 671: nada se apaga).
        const r = await this.prepararPonto(e, c.parametros as ParametrosDoPonto, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in r) return recusa(r.erro);
        Object.assign(parametros, r.parametros);
        resumo = r.resumo;
        alvo = r.alvo;
        unidadeId = r.unidadeId ?? unidadeId;
      }
      if (c.parametros.acao === 'contar_estoque') {
        // Versão 9, O3: a lista de Estoque › Contagem (pelo nome, ou a única) e cada insumo dito achado NELA, na unidade dele.
        const r = await this.prepararContagem(e, c.parametros as ParametrosDaContagem, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in r) return recusa(r.erro);
        Object.assign(parametros, r.parametros);
        resumo = r.resumo;
        alvo = r.alvo;
        unidadeId = r.unidadeId;
      }
      if (ehCadastro(c.parametros.acao)) {
        // Versão 9, O3: o insumo, o fornecedor e o pedido pelo nome, conferidos antes da pergunta.
        const r = await this.prepararCadastro(e, c.parametros as ParametrosDeCadastro, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in r) return recusa(r.erro);
        Object.assign(parametros, r.parametros);
        resumo = r.resumo;
        alvo = r.alvo;
        if (r.unidadeId !== undefined) unidadeId = r.unidadeId;
      }
      if (ehDadoInformado(c.parametros.acao)) {
        // V7f: é da empresa, não de uma loja. O `toque` é a chave da gravação: cada pergunta tem a sua, e repetir o mesmo toque não
        // grava de novo. Informar outro valor é outra pergunta.
        const d = c.parametros as { acao: AcaoDeDadoInformado; centavos: number; dia: string; campanha: string | null };
        let campanhaId: string | null = null;
        if (d.acao === 'informar_custo_campanha') {
          const achada = await acharCampanha(this.db, e.tenantId, d.campanha ?? '');
          if (!achada) return recusa(TEXTOS_DAS_ACOES.dadoSemCampanha);
          campanhaId = achada.id;
        }
        unidadeId = null;
        parametros.campanhaId = campanhaId;
        parametros.toque = randomUUID();
        alvo = `${d.acao}:${d.centavos}:${d.dia}:${campanhaId ?? ''}`;
      }
      // M6l: cada pedido de imagem é um alvo (o mesmo pedido repetido é a mesma proposta e não paga de novo).
      if (c.parametros.acao === 'criar_imagem') alvo = `${c.parametros.proporcao}:${c.parametros.pedido}`;
      return { acao: c.parametros.acao, def, unidadeId, parametros, resumo, alvo: `${alvo}:${unidadeId ?? 'empresa'}` };
    }
  }

  // ───────────────────────────── versão 9, O3: o cadastro pela conversa ─────────────────────────────

  /** O fornecedor pelo nome, em Cadastros › Fornecedores (o igual vence; senão o único; senão a pessoa escolhe). */
  private async acharFornecedor(tenantId: string, dito: string): Promise<{ id: string; nome: string } | { erro: string }> {
    const achados = linhas(
      await this.db.execute(sql`
        select id::text as id, nome from fornecedor
         where tenant_id = ${tenantId}::uuid and deleted_at is null and nome ilike ${comoTexto(dito)}
         order by nome limit 6`),
    );
    return escolherUm(achados, dito, (a) => String(a.nome), 'Não achei esse fornecedor em Cadastros › Fornecedores. Diga o nome como está lá, ou peça para cadastrar.', (n) => `Achei mais de um fornecedor: ${n}. Diga qual.`, (a) => ({ id: a.id, nome: String(a.nome) }));
  }

  /** Confere o cadastro antes da pergunta: o que já existe, o fornecedor, o insumo e o pedido pelo nome. */
  private async prepararCadastro(
    e: EscopoDoMister,
    x: ParametrosDeCadastro,
    lojas: string[] | null,
  ): Promise<{ parametros: Record<string, unknown>; resumo: string; alvo: string; unidadeId?: string | null } | { erro: string }> {
    const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
    const fornecedorDito = async (dito: string | null) => (dito ? await this.acharFornecedor(e.tenantId, dito) : null);
    if (x.acao === 'cadastrar_insumo') {
      const iguais = linhas(
        await this.db.execute(sql`
          select nome from item_estoque where tenant_id = ${e.tenantId}::uuid and deleted_at is null and nome ilike ${comoTexto(x.nome)} limit 20`),
      );
      if (iguais.some((a) => semAcento(String(a.nome)) === semAcento(x.nome))) return { erro: `Já existe "${x.nome}" em Estoque › Produtos. Para mudar o que está lá, é alterar_insumo.` };
      const f = await fornecedorDito(x.fornecedor);
      if (f && 'erro' in f) return f;
      const partes = [`em ${x.unidade}`, ...(x.minimo !== null ? [`mínimo de ${qtd(x.minimo)}`] : []), ...(f ? [`fornecedor ${f.nome}`] : []), ...(x.nomeComercial ? [`nome comercial "${x.nomeComercial}"`] : [])];
      return {
        parametros: { fornecedorId: f?.id ?? null, nomeDoFornecedor: f?.nome ?? null },
        resumo: `Cadastrar o insumo "${x.nome}" ${partes.join(', ')}. Ele aparece em Estoque › Produtos.`,
        alvo: `insumo:${semAcento(x.nome)}`,
      };
    }
    if (x.acao === 'alterar_insumo') {
      const it = await this.acharItem(e.tenantId, x.item, lojas);
      if ('erro' in it) return it;
      const [atual] = linhas(await this.db.execute(sql`select nome_comercial as "nomeComercial", estoque_minimo::float8 as minimo from item_estoque where id = ${it.id}::uuid and tenant_id = ${e.tenantId}::uuid`));
      if (x.novoNome && semAcento(x.novoNome) !== semAcento(it.nome)) {
        const [outro] = linhas(
          await this.db.execute(sql`
            select nome from item_estoque where tenant_id = ${e.tenantId}::uuid and deleted_at is null and id <> ${it.id}::uuid and nome ilike ${comoTexto(x.novoNome)} limit 20`),
        ).filter((a) => semAcento(String(a.nome)) === semAcento(x.novoNome!));
        if (outro) return { erro: `Já existe outro insumo chamado "${x.novoNome}". Escolha outro nome.` };
      }
      if (x.conversao && semAcento(x.conversao.unidade) === semAcento(it.unidade)) return { erro: `"${it.nome}" já é contado em ${it.unidade}: a conversão é de outra unidade (caixa, fardo…) para ${it.unidade}.` };
      const f = await fornecedorDito(x.fornecedor);
      if (f && 'erro' in f) return f;
      const linhasDoResumo = [
        ...(x.novoNome ? [`• o nome: "${it.nome}" → "${x.novoNome}"`] : []),
        ...(x.nomeComercial ? [`• o nome comercial: ${atual?.nomeComercial ? `"${atual.nomeComercial}"` : 'nenhum'} → "${x.nomeComercial}"`] : []),
        ...(x.minimo !== null ? [`• o mínimo: ${atual?.minimo != null ? qtd(Number(atual.minimo)) : 'nenhum'} → ${qtd(x.minimo)} ${it.unidade}`] : []),
        ...(x.conversao ? [`• a conversão: 1 ${x.conversao.unidade} = ${qtd(x.conversao.quantas)} ${it.unidade}`] : []),
        ...(f ? [`• o fornecedor ${f.nome} entra na lista`] : []),
      ];
      return {
        parametros: { itemId: it.id, nomeDoItem: it.nome, unidadeDoItem: it.unidade, fornecedorId: f?.id ?? null, nomeDoFornecedor: f?.nome ?? null },
        resumo: `Mudar "${it.nome}" em Estoque › Produtos:\n${linhasDoResumo.join('\n')}`,
        alvo: `insumo:${it.id}`,
      };
    }
    if (x.acao === 'cadastrar_fornecedor') {
      const achados = linhas(
        await this.db.execute(sql`
          select nome, regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') as cnpj from fornecedor
           where tenant_id = ${e.tenantId}::uuid and deleted_at is null
             and (nome ilike ${comoTexto(x.nome)} ${x.cnpj ? sql`or regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = ${x.cnpj}` : sql``})
           limit 20`),
      );
      const mesmoCnpj = x.cnpj ? achados.find((a) => a.cnpj === x.cnpj) : null;
      if (mesmoCnpj) return { erro: `Esse CNPJ já é do fornecedor "${mesmoCnpj.nome}", em Cadastros › Fornecedores.` };
      if (achados.some((a) => semAcento(String(a.nome)) === semAcento(x.nome))) return { erro: `Já existe o fornecedor "${x.nome}" em Cadastros › Fornecedores.` };
      const cnpj = x.cnpj ? `, CNPJ ${x.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}` : '';
      return {
        parametros: {},
        resumo: `Cadastrar o fornecedor "${x.nome}"${cnpj}${x.contato ? `, contato ${x.contato}` : ''}${x.telefone ? ', com o telefone' : ''}. Ele aparece em Cadastros › Fornecedores.`,
        alvo: `fornecedor:${semAcento(x.nome)}`,
      };
    }
    // O pedido de compra pelo nome ou pelo fornecedor; "06:12" no texto separa dois do mesmo nome pela hora em que foram criados.
    const hora = /\b([01]\d|2[0-3]):[0-5]\d\b/.exec(x.pedido)?.[0] ?? null;
    const dito = x.pedido.replace(/\b([01]\d|2[0-3]):[0-5]\d\b/, '').replace(/\s+/g, ' ').trim() || x.pedido;
    let achados = linhas(
      await this.db.execute(sql`
        select c.id::text as id, c.nome, c.status, f.nome as fornecedor, c.unidade_id::text as "unidadeId",
               to_char(c.created_at at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as criado,
               (select count(*)::int from compra_item i where i.lista_id = c.id and i.tenant_id = c.tenant_id) as itens
          from compra_lista c
          left join fornecedor f on f.id = c.fornecedor_id and f.tenant_id = c.tenant_id
         where c.tenant_id = ${e.tenantId}::uuid and c.deleted_at is null and c.created_at > clock_timestamp() - interval '90 days'
           ${lojas ? sql`and (c.unidade_id is null or c.unidade_id in (${sql.join(lojas.map((l) => sql`${l}::uuid`), sql`, `)}))` : sql``}
           and (c.nome ilike ${comoTexto(dito)} or f.nome ilike ${comoTexto(dito)})
         order by c.created_at desc
         limit 6`),
    );
    if (hora) achados = achados.filter((a) => String(a.criado).endsWith(hora));
    const nomeDoPedido = (a: any) => `${a.nome}${a.fornecedor ? ` (${a.fornecedor})` : ''}, criado em ${a.criado}`;
    if (achados.length > 1 && !achados.some((a) => semAcento(String(a.nome)) === semAcento(dito) && achados.filter((b) => b.nome === a.nome).length === 1))
      return { erro: `Achei mais de um pedido: ${achados.map((a) => `"${nomeDoPedido(a)}"`).join('; ')}. Diga qual, com a hora em que foi criado.` };
    const a = achados.length === 1 ? achados[0] : achados.find((b) => semAcento(String(b.nome)) === semAcento(dito));
    if (!a) return { erro: 'Não achei esse pedido em Estoque › Pedidos (dos últimos 90 dias). Diga o nome ou o fornecedor como aparece lá.' };
    if (a.status === 'recebida') return { erro: `O pedido "${a.nome}" já foi recebido: ele não se exclui pela conversa.` };
    return {
      parametros: { listaId: a.id, nomeDoPedido: a.nome },
      resumo: `Excluir o pedido "${nomeDoPedido(a)}", com ${a.itens} ${a.itens === 1 ? 'item' : 'itens'}. Ele sai de Estoque › Pedidos.`,
      alvo: `pedido:${a.id}`,
      unidadeId: a.unidadeId ?? null,
    };
  }

  // ───────────────────────────── versão 9, O5: o cupom e a conta a pagar ─────────────────────────────

  /** O serviço dos cupons (o mesmo de PDV · Balcão › Cupons), achado na hora. Os testes trocam por `cuponsDeTeste`. */
  cuponsDeTeste: { criarCupom: (t: string, u: string | null, dto: any) => Promise<any>; removerCupom: (t: string, id: string) => Promise<any> } | null = null;
  private async servicoDeCupons() {
    if (this.cuponsDeTeste) return this.cuponsDeTeste;
    if (!this.moduleRef) return null;
    const { CardapioService } = await import('../cardapio/cardapio.service');
    return this.moduleRef.get(CardapioService, { strict: false }) as any;
  }

  private async prepararDaLoja(
    e: EscopoDoMister,
    x: ParametrosDaLoja,
    lojas: string[] | null,
  ): Promise<{ parametros: Record<string, unknown>; resumo: string; alvo: string; unidadeId?: string | null } | { erro: string }> {
    if (x.acao === 'mudar_produto') {
      const pr = await this.acharProduto(e.tenantId, x.produto, lojas);
      if ('erro' in pr) return pr;
      let categoria: { id: string; nome: string } | null = null;
      if (x.categoria) {
        const achadas = linhas(
          await this.db.execute(sql`
            select id::text as id, nome from categoria_produto
             where tenant_id = ${e.tenantId}::uuid and deleted_at is null and coalesce(ativo, true) and nome ilike ${comoTexto(x.categoria)}
             order by nome limit 6`),
        );
        const r = escolherUm(achadas, x.categoria, (a) => String(a.nome), TEXTOS_DAS_ACOES.categoriaNaoAchada, TEXTOS_DAS_ACOES.categoriasDemais, (a) => ({ id: String(a.id), nome: String(a.nome) }));
        if ('erro' in r) return r;
        categoria = r;
      }
      return {
        parametros: { produtoId: pr.id, produtoNome: pr.nome, categoriaId: categoria?.id ?? null, categoriaNome: categoria?.nome ?? null },
        resumo: resumoDoProduto(pr.nome, x, categoria?.nome ?? null),
        alvo: `produto:${pr.id}`,
      };
    }
    if (x.acao === 'mudar_fornecedor') {
      const f = await this.acharFornecedor(e.tenantId, x.fornecedor);
      if ('erro' in f) return f;
      if (x.nomeNovo && x.nomeNovo.toLowerCase() !== f.nome.toLowerCase()) {
        const [ja] = linhas(await this.db.execute(sql`select nome from fornecedor where tenant_id = ${e.tenantId}::uuid and deleted_at is null and lower(nome) = lower(${x.nomeNovo}) and id <> ${f.id}::uuid limit 1`));
        if (ja) return { erro: TEXTOS_DAS_ACOES.fornecedorComEsseNome(String(ja.nome)) };
      }
      return { parametros: { fornecedorId: f.id, fornecedorNome: f.nome }, resumo: resumoDoFornecedor(f.nome, x), alvo: `fornecedor:${f.id}` };
    }
    if (x.acao === 'trocar_turno' || x.acao === 'folga_na_escala') {
      const quem = await this.acharPessoaDaLoja(e.tenantId, x.acao === 'trocar_turno' ? x.quemSai : x.quem, lojas);
      if ('erro' in quem) return quem;
      const turnos = linhas(
        await this.db.execute(sql`
          select a.id::text as id, a.unidade_id::text as "unidadeId", t.nome,
                 to_char(coalesce(a.hora_inicio_override, t.hora_inicio), 'HH24:MI') as inicio, to_char(coalesce(a.hora_fim_override, t.hora_fim), 'HH24:MI') as fim
            from escala_alocacao a
            join turno t on t.id = a.turno_id
           where a.tenant_id = ${e.tenantId}::uuid and a.colaborador_id = ${quem.id}::uuid and a.data = ${x.dia}::date and a.deleted_at is null
             ${lojas ? sql`and a.unidade_id in (${sql.join(lojas.map((l) => sql`${l}::uuid`), sql`, `)})` : sql``}
           order by coalesce(a.hora_inicio_override, t.hora_inicio)`),
      );
      if (!turnos.length) return { erro: TEXTOS_DAS_ACOES.foraDaEscala(quem.nome, diaComSemana(x.dia)) };
      const dito = x.turno ? semAcento(x.turno) : null;
      const escolhidos = turnos.length === 1 ? turnos : dito ? turnos.filter((t) => semAcento(String(t.nome)).includes(dito) || String(t.inicio).startsWith(dito.replace(/h$/, '').padStart(2, '0'))) : [];
      if (escolhidos.length !== 1)
        return { erro: TEXTOS_DAS_ACOES.turnosDemais(quem.nome, turnos.map((t) => `${t.nome} (${t.inicio}–${t.fim})`).join(', ')) };
      const a = escolhidos[0];
      const turno = { nome: String(a.nome), inicio: String(a.inicio), fim: String(a.fim) };
      if (x.acao === 'folga_na_escala')
        return { parametros: { alocacaoId: a.id, quemId: quem.id, quemNome: quem.nome, turnoNome: turno.nome }, resumo: resumoDaFolga(quem.nome, x.dia, turno), alvo: `escala:${a.id}`, unidadeId: a.unidadeId };
      const entra = await this.acharPessoaDaLoja(e.tenantId, x.quemEntra, [a.unidadeId]);
      if ('erro' in entra) return entra;
      if (entra.id === quem.id) return { erro: TEXTOS_DAS_ACOES.mesmaPessoa };
      return {
        parametros: { alocacaoId: a.id, quemId: quem.id, quemNome: quem.nome, entraId: entra.id, entraNome: entra.nome, turnoNome: turno.nome },
        resumo: resumoDaTroca(quem.nome, entra.nome, x.dia, turno),
        alvo: `escala:${a.id}`,
        unidadeId: a.unidadeId,
      };
    }
    if (x.acao === 'criar_cupom' || x.acao === 'remover_cupom') {
      const [ja] = linhas(await this.db.execute(sql`select id::text as id, ativo from cupom where tenant_id = ${e.tenantId}::uuid and upper(codigo) = ${x.codigo} limit 1`));
      if (x.acao === 'criar_cupom') {
        if (ja) return { erro: `Já existe o cupom ${x.codigo} em PDV · Balcão › Cupons. Para mudar o que ele dá, faça por lá; ou escolha outro código.` };
        return { parametros: {}, resumo: '', alvo: `cupom:${x.codigo}` };
      }
      if (!ja) return { erro: `Não achei o cupom ${x.codigo} em PDV · Balcão › Cupons.` };
      return { parametros: { cupomId: ja.id }, resumo: `Tirar o cupom ${x.codigo}: ele deixa de valer no cardápio e no balcão. Sai de PDV · Balcão › Cupons.`, alvo: `cupom:${x.codigo}` };
    }
    let fornecedorId: string | null = null;
    let nomeDoFornecedor: string | null = null;
    if (x.fornecedor) {
      const f = await this.acharFornecedor(e.tenantId, x.fornecedor);
      if ('erro' in f) return f;
      fornecedorId = f.id;
      nomeDoFornecedor = f.nome;
    }
    return { parametros: { fornecedorId, nomeDoFornecedor }, resumo: resumoDaConta(x, nomeDoFornecedor), alvo: `conta:${x.descricao}:${x.valor}:${x.vencimento}` };
  }

  private async aplicarDaLoja(
    p: { id: string; tenantId: string; unidadeId: string | null },
    x: ParametrosDaLoja & Record<string, any>,
    e: EscopoDoMister,
    quem: string,
  ): Promise<{ feita: boolean; texto: string }> {
    const indisponivel = { feita: false, texto: 'isso não está disponível agora. Nada foi feito.' };
    const motivo = (err: any) => String(err?.response?.message ?? err?.message ?? 'o serviço recusou').slice(0, 240);
    try {
      if (x.acao === 'mudar_produto') {
        if (!this.produtos) return indisponivel;
        const dto = { ...(x.nomeNovo ? { nome: x.nomeNovo } : {}), ...(x.descricao ? { descricao: x.descricao } : {}), ...(x.categoriaId ? { categoriaId: x.categoriaId } : {}) };
        await (this.produtos as any).atualizar(p.tenantId, String(x.produtoId), dto);
        const [ok] = linhas(
          await this.db.execute(sql`
            select 1 from produto where id = ${String(x.produtoId)}::uuid and tenant_id = ${p.tenantId}::uuid
               and (${x.nomeNovo ?? null}::text is null or nome = ${x.nomeNovo ?? null}::text)
               and (${x.descricao ?? null}::text is null or descricao = ${x.descricao ?? null}::text)
               and (${x.categoriaId ?? null}::uuid is null or categoria_id = ${x.categoriaId ?? null}::uuid)`),
        );
        return ok
          ? { feita: true, texto: `Mudei o produto "${x.nomeNovo ?? x.produtoNome}" em Cadastros › Cardápio.` }
          : { feita: false, texto: 'o produto não ficou como pedido. Confira em Cadastros › Cardápio.' };
      }
      if (x.acao === 'mudar_fornecedor') {
        if (!this.fornecedores) return indisponivel;
        const dto: any = { ...(x.nomeNovo ? { nome: x.nomeNovo } : {}), ...(x.contato ? { contato: x.contato } : {}), ...(x.telefone ? { telefone: x.telefone } : {}), ...(x.email ? { email: x.email } : {}) };
        await this.fornecedores.update(p.tenantId, String(x.fornecedorId), dto);
        const [ok] = linhas(
          await this.db.execute(sql`
            select 1 from fornecedor where id = ${String(x.fornecedorId)}::uuid and tenant_id = ${p.tenantId}::uuid and deleted_at is null
               and (${x.nomeNovo ?? null}::text is null or nome = ${x.nomeNovo ?? null}::text)
               and (${x.contato ?? null}::text is null or contato = ${x.contato ?? null}::text)
               and (${x.telefone ?? null}::text is null or telefone = ${x.telefone ?? null}::text)
               and (${x.email ?? null}::text is null or email = ${x.email ?? null}::text)`),
        );
        return ok ? { feita: true, texto: `Mudei o fornecedor "${x.nomeNovo ?? x.fornecedorNome}" em Fornecedores.` } : { feita: false, texto: 'o fornecedor não ficou como pedido. Confira em Fornecedores.' };
      }
      if (x.acao === 'trocar_turno' || x.acao === 'folga_na_escala') {
        if (!this.escala) return indisponivel;
        // A escala que a pessoa viu: quem estava no turno continua lá (senão, alguém mudou pela tela no meio).
        const [agora] = linhas(await this.db.execute(sql`select colaborador_id::text as c from escala_alocacao where id = ${String(x.alocacaoId)}::uuid and tenant_id = ${p.tenantId}::uuid and deleted_at is null`));
        if (!agora || agora.c !== x.quemId) return { feita: false, texto: TEXTOS_DAS_ACOES.escalaMudou };
        const novo = x.acao === 'trocar_turno' ? String(x.entraId) : null;
        await this.escala.alterar(p.tenantId, String(x.alocacaoId), { colaboradorId: novo });
        await this.auditoria
          ?.registrar({ tenantId: p.tenantId, atorId: quem, atorPerfil: e.nivel, tipo: 'escala', acao: 'alterou_alocacao', entidadeTipo: 'alocacao', entidadeId: String(x.alocacaoId), origem: 'whatsapp', detalhe: { colaboradorId: novo, pelo: 'mister' } } as any)
          .catch(() => undefined);
        const [depois] = linhas(await this.db.execute(sql`select colaborador_id::text as c from escala_alocacao where id = ${String(x.alocacaoId)}::uuid and tenant_id = ${p.tenantId}::uuid`));
        if ((depois?.c ?? null) !== novo) return { feita: false, texto: 'a escala não ficou como pedido. Confira em Escala.' };
        return x.acao === 'trocar_turno'
          ? { feita: true, texto: `Troquei: ${x.entraNome} entra no lugar de ${x.quemNome} no turno ${x.turnoNome}. Já está em Escala.` }
          : { feita: true, texto: `Feito: ${x.quemNome} está de folga no turno ${x.turnoNome}, e a vaga ficou aberta em Escala.` };
      }
      if (x.acao === 'criar_cupom' || x.acao === 'remover_cupom') {
        const cupons = await this.servicoDeCupons();
        if (!cupons) return indisponivel;
        if (x.acao === 'criar_cupom') {
          const [ja] = linhas(await this.db.execute(sql`select 1 from cupom where tenant_id = ${p.tenantId}::uuid and upper(codigo) = ${x.codigo}`));
          if (ja) return { feita: false, texto: `o cupom ${x.codigo} já existe. Nada foi mudado.` };
          // A tela de Cupons não manda a loja: o cupom vale para a empresa inteira. O Mister faz igual.
          await cupons.criarCupom(p.tenantId, null, {
            codigo: x.codigo,
            tipo: x.tipo,
            valor: x.valor,
            ...(x.minimo ? { minimo: x.minimo } : {}),
            ...(x.validoAte ? { validade: x.validoAte } : {}),
            ...(x.usosMaximos ? { maxUsos: x.usosMaximos } : {}),
            ...(x.soClientesNovos ? { somenteNovos: true } : {}),
            ...(x.nome ? { nome: x.nome } : {}),
          });
          const [ok] = linhas(await this.db.execute(sql`select codigo from cupom where tenant_id = ${p.tenantId}::uuid and upper(codigo) = ${x.codigo} and ativo`));
          return ok ? { feita: true, texto: `Criei o cupom ${x.codigo} (${descontoDoCupom(x)}). Ele já vale no cardápio e no balcão.` } : { feita: false, texto: 'o cupom não apareceu em PDV · Balcão › Cupons. Confira lá.' };
        }
        await cupons.removerCupom(p.tenantId, String(x.cupomId));
        const [ainda] = linhas(await this.db.execute(sql`select 1 from cupom where id = ${String(x.cupomId)}::uuid and tenant_id = ${p.tenantId}::uuid`));
        return ainda ? { feita: false, texto: 'o cupom continua em PDV · Balcão › Cupons. Confira lá.' } : { feita: true, texto: `Tirei o cupom ${x.codigo}: ele não vale mais.` };
      }
      if (!this.financeiro) return indisponivel;
      const t: any = await this.financeiro.criar(
        p.tenantId,
        quem,
        e.nivel,
        { tipo: 'pagar', descricao: x.descricao, valor: x.valor, vencimento: x.vencimento, ...(x.fornecedorId ? { fornecedorId: x.fornecedorId } : {}), ...(x.categoria ? { categoria: x.categoria } : {}) } as any,
        p.unidadeId ?? null,
        { origem: 'mister' },
      );
      const [ok] = linhas(await this.db.execute(sql`select status from titulo_financeiro where id = ${t?.id ?? null}::uuid and tenant_id = ${p.tenantId}::uuid`));
      return ok ? { feita: true, texto: `Lancei a conta "${x.descricao}" de ${reaisBr(x.valor)} em Financeiro › Contas a pagar, em aberto.` } : { feita: false, texto: 'a conta não apareceu em Financeiro › Contas a pagar. Confira lá.' };
    } catch (err: any) {
      return { feita: false, texto: TEXTOS_DAS_ACOES.recusado(motivo(err)) };
    } finally {
      await this.auditoria
        ?.registrar({ tenantId: p.tenantId, atorId: quem, atorPerfil: e.nivel, tipo: 'mister', acao: 'mister_acao', entidadeTipo: 'mister_proposta', entidadeId: p.id, origem: 'whatsapp', detalhe: { acao: x.acao } } as any)
        .catch(() => undefined);
    }
  }

  /** Etapa 1 (24/11): o caixa aberto (o do balcão por loja e terminal; o do delivery, um só da empresa) e o que o fechamento pede. */
  private async prepararCaixa(
    e: EscopoDoMister,
    x: ParametrosDoCaixa,
    lojas: string[] | null,
  ): Promise<{ parametros: Record<string, unknown>; resumo: string; alvo: string; unidadeId: string | null } | { erro: string }> {
    const daLoja = x.caixa === 'pdv' && lojas ? sql`and s.unidade_id in (${sql.join(lojas.map((u) => sql`${u}::uuid`), sql`, `)})` : sql``;
    let abertos = linhas(
      await this.db.execute(sql`
        select s.id::text as id, s.terminal_id::text as "terminalId", s.unidade_id::text as "unidadeId", eq.nome as terminal, c.nome as "abertoPor",
               to_char(s.aberta_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as "abertoEm",
               round(extract(epoch from (clock_timestamp() - s.aberta_em)) / 3600.0, 1)::float8 as horas
          from caixa_sessao s
          left join equipamento eq on eq.id = s.terminal_id
          left join colaborador c on c.id = s.aberta_por_id
         where s.tenant_id = ${e.tenantId}::uuid and s.status = 'aberta' and s.origem = ${x.caixa} ${daLoja}
         order by s.aberta_em
         limit 10`),
    );
    if (!abertos.length) return { erro: TEXTOS_DAS_ACOES.semCaixaAberto(x.caixa === 'delivery' ? 'do delivery' : 'do balcão') };
    if (abertos.length > 1 && x.operador) {
      const dito = semAcento(x.operador);
      abertos = abertos.filter((s) => semAcento(String(s.abertoPor ?? '')).includes(dito) || semAcento(String(s.terminal ?? '')).includes(dito));
    }
    if (abertos.length !== 1) {
      const todos = linhas(
        await this.db.execute(sql`
          select eq.nome as terminal, c.nome as "abertoPor" from caixa_sessao s
            left join equipamento eq on eq.id = s.terminal_id left join colaborador c on c.id = s.aberta_por_id
           where s.tenant_id = ${e.tenantId}::uuid and s.status = 'aberta' and s.origem = ${x.caixa} ${daLoja} order by s.aberta_em limit 10`),
      );
      return { erro: TEXTOS_DAS_ACOES.caixasDemais(todos.map((s) => `${s.terminal ?? 'sem terminal'} (de ${s.abertoPor ?? 'alguém'})`).join(', ')) };
    }
    const s = abertos[0];
    const nome = nomeDoCaixa({ caixa: x.caixa, terminal: s.terminal ?? null, abertoPor: s.abertoPor ?? null, abertoEm: String(s.abertoEm), abertoHaHoras: Number(s.horas) });
    const base = { sessaoId: s.id, terminalId: s.terminalId ?? null, nomeDoCaixa: nome };
    if (x.acao === 'sangria') return { parametros: base, resumo: resumoDaSangria(nome, x), alvo: `caixa:${s.id}:sangria:${x.valor}`, unidadeId: s.unidadeId ?? null };
    let pendencias = 0;
    if (x.caixa === 'delivery') {
      const pend = await pendenciasDoTurno(this.db, e.tenantId, null, 'delivery');
      pendencias = Number(pend?.total ?? 0);
      if (pendencias > 0 && (x.motivo ?? '').length < MOTIVO_MINIMO) return { erro: TEXTOS_DAS_ACOES.pendenciasSemMotivo(pendencias) };
      const agendados = await agendadosParaDepois(this.db, e.tenantId, null);
      if (agendados.length) return { erro: TEXTOS_DAS_ACOES.agendadosNoTurno(agendados.length) };
    }
    return { parametros: { ...base, pendencias }, resumo: resumoDoFechamento(nome, x, pendencias), alvo: `caixa:${s.id}:fechar`, unidadeId: s.unidadeId ?? null };
  }

  /** Fecha ou lança a sangria pelo MESMO serviço do PDV; o caixa da pergunta tem de estar aberto ainda. */
  private async aplicarCaixa(
    p: { id: string; tenantId: string; unidadeId: string | null },
    x: ParametrosDoCaixa & { sessaoId: string; terminalId: string | null; nomeDoCaixa: string },
    e: EscopoDoMister,
    quem: string,
  ): Promise<{ feita: boolean; texto: string }> {
    if (!this.financeiro) return { feita: false, texto: 'isso não está disponível agora. Nada foi feito.' };
    const [agora] = linhas(await this.db.execute(sql`select status from caixa_sessao where id = ${x.sessaoId}::uuid and tenant_id = ${p.tenantId}::uuid`));
    if (agora?.status !== 'aberta') return { feita: false, texto: TEXTOS_DAS_ACOES.caixaMudou };
    // O serviço do PDV acha o caixa pelo terminal (o do delivery, pela empresa): ele tem de chegar ao MESMO caixa da pergunta —
    // dois caixas do balcão sem terminal (lojas diferentes) não têm como ser escolhidos por ele, e aí a ação fica na tela.
    const peloServico = await this.financeiro.sessaoAberta(p.tenantId, x.caixa === 'delivery' ? 'delivery' : 'pdv', x.terminalId);
    if (peloServico?.id !== x.sessaoId) return { feita: false, texto: TEXTOS_DAS_ACOES.caixaSoNaTela };
    const motivo = (err: any) => String(err?.response?.message ?? err?.message ?? 'o serviço recusou').slice(0, 240);
    try {
      if (x.acao === 'sangria') {
        const antes = Number((linhas(await this.db.execute(sql`select count(*)::int as n from lancamento_caixa where sessao_id = ${x.sessaoId}::uuid and categoria = 'sangria'`))[0] ?? {}).n ?? 0);
        const feito: any = await this.financeiro.movimentarCaixa(p.tenantId, quem, e.nivel, { tipo: 'sangria', valor: x.valor, descricao: `${x.motivo} (pelo Mister)`, origem: x.caixa === 'delivery' ? 'delivery' : 'pdv', terminalId: x.terminalId });
        const papel = feito?.comprovante?.aviso ? ' O comprovante NÃO saiu na impressora do caixa: confira a impressora.' : ' O comprovante sai na impressora do caixa.';
        const depois = Number((linhas(await this.db.execute(sql`select count(*)::int as n from lancamento_caixa where sessao_id = ${x.sessaoId}::uuid and categoria = 'sangria'`))[0] ?? {}).n ?? 0);
        if (depois <= antes) return { feita: false, texto: 'a sangria não apareceu no caixa. Confira no relatório de turnos.' };
        return { feita: true, texto: `Lancei a sangria de R$ ${x.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} no ${x.nomeDoCaixa.replace(/^o /, '')}.${papel}` };
      }
      await this.financeiro.fecharSessao(p.tenantId, quem, e.nivel, {
        valoresInformados: x.semContagem ? {} : { dinheiro: x.dinheiroContado as number },
        obs: `Fechado pelo Mister (WhatsApp)${x.semContagem ? ', sem contagem' : ''}${x.motivo ? `: ${x.motivo}` : ''}`.slice(0, 300),
        origem: x.caixa === 'delivery' ? 'delivery' : 'pdv',
        terminalId: x.terminalId,
        unidadeAtual: x.caixa === 'delivery' ? null : p.unidadeId,
        ...(x.motivo ? { justificativaPendencias: x.motivo } : {}),
        agendadosMantidos: [],
      });
      const [fim] = linhas(await this.db.execute(sql`select status from caixa_sessao where id = ${x.sessaoId}::uuid`));
      if (fim?.status !== 'fechada') return { feita: false, texto: 'o caixa não ficou fechado. Confira no PDV.' };
      return { feita: true, texto: `Fechei ${x.nomeDoCaixa}${x.semContagem ? ', sem contagem' : ''}. A diferença, se houver, está no relatório de turnos.` };
    } catch (err: any) {
      return { feita: false, texto: TEXTOS_DAS_ACOES.recusado(motivo(err)) };
    }
  }

  /** As marcações de um dia (no relógio da loja), com a desconsiderada marcada. */
  private async marcacoesDoDia(tenantId: string, colaboradorId: string, dia: string) {
    return linhas(
      await this.db.execute(sql`
        select m.id::text as id, m.tipo, to_char(m.marcado_em at time zone 'America/Sao_Paulo', 'HH24:MI') as hora, m.origem,
               exists (select 1 from ponto_ajuste a where a.marcacao_id = m.id and a.tipo = 'desconsideracao') as desconsiderada
          from ponto_marcacao m
         where m.tenant_id = ${tenantId}::uuid and m.colaborador_id = ${colaboradorId}::uuid
           and (m.marcado_em at time zone 'America/Sao_Paulo')::date = ${dia}::date
         order by m.marcado_em
         limit 40`),
    ) as Array<{ id: string; tipo: string; hora: string; origem: string | null; desconsiderada: boolean }>;
  }

  /** Etapa 5 (24/11): a pessoa, as marcações do dia e, para desconsiderar, a marcação na hora dita (2 min para cada lado). */
  private async prepararPonto(
    e: EscopoDoMister,
    x: ParametrosDoPonto,
    lojas: string[] | null,
  ): Promise<{ parametros: Record<string, unknown>; resumo: string; alvo: string; unidadeId: string | null } | { erro: string }> {
    const daLoja = lojas ? sql`and (c.unidade_id is null or c.unidade_id in (${sql.join(lojas.map((u) => sql`${u}::uuid`), sql`, `)}))` : sql``;
    const gente = linhas(
      await this.db.execute(sql`
        select c.id::text as id, c.nome, c.unidade_id::text as "unidadeId" from colaborador c
         where c.tenant_id = ${e.tenantId}::uuid and c.status = 'ativo' and c.deleted_at is null ${daLoja}
         order by c.nome limit 500`),
    );
    const dito = semAcento(x.pessoa);
    const iguais = gente.filter((g) => semAcento(String(g.nome)) === dito);
    const achados = iguais.length ? iguais : gente.filter((g) => semAcento(String(g.nome)).includes(dito));
    if (!achados.length) return { erro: TEXTOS_DAS_ACOES.pessoaDoPontoNaoAchada(x.pessoa) };
    if (achados.length > 1) return { erro: TEXTOS_DAS_ACOES.pessoasDoPonto(achados.slice(0, 8).map((g) => String(g.nome)).join(', ')) };
    const pessoa = achados[0];
    const doDia = await this.marcacoesDoDia(e.tenantId, String(pessoa.id), x.dia);
    const texto = marcacoesDoDia(doDia);
    const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
    const perto = (h: string, folga: number) => Math.abs(minutos(h) - minutos(x.hora)) <= folga;
    const base = { colaboradorAlvo: String(pessoa.id), nomeDaPessoa: String(pessoa.nome), doDia: texto };
    if (x.acao === 'incluir_marcacao') {
      if (doDia.some((m) => !m.desconsiderada && m.tipo === x.tipo && perto(m.hora, 5))) return { erro: TEXTOS_DAS_ACOES.marcacaoRepetida(texto) };
      return {
        parametros: { ...base, quantasNoDia: doDia.length },
        resumo: resumoDoPonto(x, String(pessoa.nome), texto),
        alvo: `ponto:${pessoa.id}:${x.dia}:${x.hora}:${x.tipo}`,
        unidadeId: pessoa.unidadeId ?? null,
      };
    }
    const candidatas = doDia.filter((m) => !m.desconsiderada && perto(m.hora, 2) && (!x.tipo || m.tipo === x.tipo));
    if (!candidatas.length) return { erro: TEXTOS_DAS_ACOES.marcacaoNaoAchada(texto) };
    if (candidatas.length > 1) return { erro: TEXTOS_DAS_ACOES.marcacoesDemais(texto) };
    const m = candidatas[0];
    const comTipo = { ...x, tipo: m.tipo as any, hora: m.hora };
    return {
      parametros: { ...base, tipo: m.tipo, hora: m.hora, marcacaoAlvo: m.id },
      resumo: resumoDoPonto(comTipo, String(pessoa.nome), texto),
      alvo: `ponto:desconsiderar:${m.id}`,
      unidadeId: pessoa.unidadeId ?? null,
    };
  }

  /** O serviço do ponto (Gerenciamento de ponto). Os testes usam `pontoDeTeste`. */
  pontoDeTeste: { incluirMarcacao: (...a: any[]) => Promise<any>; criarAjuste: (...a: any[]) => Promise<any> } | null = null;
  private async servicoDoPonto() {
    if (this.pontoDeTeste) return this.pontoDeTeste;
    if (!this.moduleRef) return null;
    try {
      const { PontoService } = await import('../ponto/ponto.service');
      return this.moduleRef.get(PontoService, { strict: false }) as any;
    } catch {
      return null;
    }
  }

  /** Inclui ou desconsidera pelo MESMO serviço da tela; o dia tem de estar como na pergunta. */
  private async aplicarPonto(
    p: { id: string; tenantId: string; unidadeId: string | null },
    x: ParametrosDoPonto & { colaboradorAlvo: string; nomeDaPessoa: string; quantasNoDia?: number; marcacaoAlvo?: string },
    e: EscopoDoMister,
    quem: string,
  ): Promise<{ feita: boolean; texto: string }> {
    const ponto = await this.servicoDoPonto();
    if (!ponto) return { feita: false, texto: TEXTOS_DAS_ACOES.pontoIndisponivel };
    const doDia = await this.marcacoesDoDia(p.tenantId, x.colaboradorAlvo, x.dia);
    const motivo = (err: any) => String(err?.response?.message ?? err?.message ?? 'o serviço recusou').slice(0, 240);
    const nome = x.tipo ? ({ entrada: 'entrada', saida: 'saída', intervalo_inicio: 'saída para o intervalo', intervalo_fim: 'volta do intervalo' } as Record<string, string>)[x.tipo] : 'marcação';
    const quando = `${x.dia.slice(8, 10)}/${x.dia.slice(5, 7)} às ${x.hora}`;
    try {
      if (x.acao === 'incluir_marcacao') {
        if (doDia.length !== x.quantasNoDia) return { feita: false, texto: TEXTOS_DAS_ACOES.pontoMudou };
        const [{ instante }] = linhas(await this.db.execute(sql`select ((${x.dia} || ' ' || ${x.hora})::timestamp at time zone 'America/Sao_Paulo') as instante`));
        await ponto.incluirMarcacao(
          p.tenantId,
          quem,
          e.nivel,
          { colaboradorId: x.colaboradorAlvo, tipo: x.tipo, marcadoEm: new Date(instante).toISOString(), justificativa: `${x.motivo} (pelo Mister)`, unidadeId: p.unidadeId ?? undefined },
          p.unidadeId,
        );
        const [m] = linhas(
          await this.db.execute(sql`select nsr from ponto_marcacao where tenant_id = ${p.tenantId}::uuid and colaborador_id = ${x.colaboradorAlvo}::uuid and origem = 'ajuste' and tipo = ${x.tipo} and marcado_em = ${new Date(instante).toISOString()}::timestamptz order by created_at desc limit 1`),
        );
        if (!m) return { feita: false, texto: 'a marcação não apareceu no ponto. Confira em Pessoas › Gerenciamento de ponto.' };
        return { feita: true, texto: `Incluí a ${nome} de ${x.nomeDaPessoa} em ${quando} (NSR ${m.nsr}), como marcação de ajuste. As outras marcações do dia ficaram como estavam.` };
      }
      const alvo = doDia.find((m) => m.id === x.marcacaoAlvo);
      if (!alvo || alvo.desconsiderada) return { feita: false, texto: TEXTOS_DAS_ACOES.pontoMudou };
      await ponto.criarAjuste(p.tenantId, quem, e.nivel, { colaboradorId: x.colaboradorAlvo, data: x.dia, tipo: 'desconsideracao', marcacaoId: x.marcacaoAlvo, justificativa: `${x.motivo} (pelo Mister)` });
      const [a] = linhas(await this.db.execute(sql`select 1 as ok from ponto_ajuste where tenant_id = ${p.tenantId}::uuid and marcacao_id = ${x.marcacaoAlvo}::uuid and tipo = 'desconsideracao' limit 1`));
      if (!a) return { feita: false, texto: 'o ajuste não apareceu no ponto. Confira em Pessoas › Gerenciamento de ponto.' };
      return { feita: true, texto: `Desconsiderei a ${nome} de ${x.nomeDaPessoa} de ${quando}. Ela continua no registro do ponto; só deixou de contar no espelho.` };
    } catch (err: any) {
      return { feita: false, texto: TEXTOS_DAS_ACOES.recusado(motivo(err)) };
    }
  }

  /** O serviço dos entregadores (Delivery › Entregadores), achado na hora: o módulo dele não exporta o serviço. Os testes usam `entregadorDeTeste`. */
  entregadorDeTeste: { fechamentoEntregadores: (t: string) => Promise<any[]>; pagarEntregador: (t: string, ator: string | null, id: string) => Promise<any> } | null = null;
  private async servicoDoEntregador() {
    if (this.entregadorDeTeste) return this.entregadorDeTeste;
    if (!this.moduleRef) return null;
    try {
      const { EntregadorService } = await import('../entregador/entregador.service');
      return this.moduleRef.get(EntregadorService, { strict: false }) as any;
    } catch {
      return null;
    }
  }

  /** Paga pelo MESMO serviço da tela; o acerto tem de ser o da pergunta (as mesmas entregas e o mesmo valor). */
  private async aplicarEntregador(
    p: { id: string; tenantId: string; unidadeId: string | null },
    x: ParametrosDoEntregador & { entregadorId: string; nomeDoEntregador: string; entregas: number; total: number },
    quem: string,
  ): Promise<{ feita: boolean; texto: string }> {
    const servico = await this.servicoDoEntregador();
    if (!servico) return { feita: false, texto: 'isso não está disponível agora. Nada foi feito.' };
    const agora = ((await servico.fechamentoEntregadores(p.tenantId)) as LinhaDoAcerto[]).find((l) => l.colaboradorId === x.entregadorId);
    if (!agora || recusaDoAcerto(agora) || agora.total !== x.total || agora.entregas !== x.entregas) return { feita: false, texto: TEXTOS_DAS_ACOES.entregadorMudou };
    try {
      // O pagamento é UMA transação no serviço (o fechamento, a sangria e as entregas marcadas): a resposta dele com o fechamento
      // é o efeito conferido — qualquer falha no meio desfaz tudo e chega aqui como erro.
      const r: any = await servico.pagarEntregador(p.tenantId, quem, x.entregadorId);
      if (r?.ok !== true || !r?.fechamentoId) return { feita: false, texto: 'o pagamento não se confirmou. Confira em Delivery › Entregadores.' };
      const valor = `R$ ${(Number(r.total ?? x.total) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return { feita: true, texto: `Paguei ${valor} a ${x.nomeDoEntregador} (${x.entregas === 1 ? '1 entrega' : `${x.entregas} entregas`}). A sangria está no caixa de entregas e essas entregas ficaram acertadas.` };
    } catch (err: any) {
      return { feita: false, texto: TEXTOS_DAS_ACOES.recusado(String(err?.response?.message ?? err?.message ?? 'o serviço recusou').slice(0, 240)) };
    }
  }

  /** O serviço da contagem (Estoque › Contagem), achado na hora: o módulo dela não exporta o serviço. Os testes usam `contagemDeTeste`. */
  contagemDeTeste: { iniciarExecucao: (t: string, lista: string, ator: string, atual?: string | null) => Promise<any>; salvarContagem: (t: string, exec: string, ator: string, dto: any) => Promise<any> } | null = null;
  private async servicoDaContagem() {
    if (this.contagemDeTeste) return this.contagemDeTeste;
    if (!this.moduleRef) return null;
    try {
      const { ContagemService } = await import('../contagem/contagem.service');
      return this.moduleRef.get(ContagemService, { strict: false }) as any;
    } catch {
      return null;
    }
  }

  private async prepararContagem(
    e: EscopoDoMister,
    x: ParametrosDaContagem,
    lojas: string[] | null,
  ): Promise<{ parametros: Record<string, unknown>; resumo: string; alvo: string; unidadeId: string | null } | { erro: string }> {
    const daLoja = lojas ? sql`and (l.unidade_id is null or l.unidade_id in (${sql.join(lojas.map((u) => sql`${u}::uuid`), sql`, `)}))` : sql``;
    const listas = linhas(
      await this.db.execute(sql`
        select l.id::text as id, l.nome, l.unidade_id::text as "unidadeId" from contagem_lista l
         where l.tenant_id = ${e.tenantId}::uuid and l.deleted_at is null and coalesce(l.ativo, true) ${daLoja}
           ${x.lista ? sql`and l.nome ilike ${comoTexto(x.lista)}` : sql``}
         order by l.nome limit 8`),
    );
    let lista: { id: string; nome: string; unidadeId: string | null };
    if (x.lista) {
      const r = escolherUm(listas, x.lista, (a) => String(a.nome), TEXTOS_DAS_ACOES.listaDeContagemNaoAchada, TEXTOS_DAS_ACOES.listasDeContagemDemais, (a) => ({ id: String(a.id), nome: String(a.nome), unidadeId: a.unidadeId ?? null }));
      if ('erro' in r) return r;
      lista = r;
    } else if (listas.length === 1) {
      lista = { id: String(listas[0].id), nome: String(listas[0].nome), unidadeId: listas[0].unidadeId ?? null };
    } else {
      return { erro: listas.length ? TEXTOS_DAS_ACOES.qualListaDeContagem(listas.map((l) => `"${l.nome}"`).join(', ')) : TEXTOS_DAS_ACOES.semListaDeContagem };
    }
    const daLista = linhas(
      await this.db.execute(sql`
        select i.id::text as id, i.nome, i.nome_comercial as "nomeComercial", i.unidade_medida as unidade
          from contagem_lista_item li join item_estoque i on i.id = li.item_id and i.tenant_id = li.tenant_id and i.deleted_at is null
         where li.lista_id = ${lista.id}::uuid and li.tenant_id = ${e.tenantId}::uuid
         order by i.nome`),
    );
    const itens: Array<{ itemId: string; nome: string; unidade: string; contado: number; saldo: number }> = [];
    for (const c of x.contados) {
      const dito = semAcento(c.insumo);
      const iguais = daLista.filter((i) => semAcento(String(i.nome)) === dito || (i.nomeComercial && semAcento(String(i.nomeComercial)) === dito));
      const parecidos = iguais.length ? iguais : daLista.filter((i) => semAcento(String(i.nome)).includes(dito) || (i.nomeComercial && semAcento(String(i.nomeComercial)).includes(dito)));
      if (!parecidos.length) return { erro: TEXTOS_DAS_ACOES.foraDaListaDeContagem(c.insumo, lista.nome) };
      if (parecidos.length > 1) return { erro: TEXTOS_DAS_ACOES.itensDaListaDemais(c.insumo, parecidos.map((i) => `"${i.nome}"`).join(' ou ')) };
      const it = parecidos[0];
      if (c.medida && !mesmaUnidade(c.medida, String(it.unidade))) return { erro: TEXTOS_DAS_ACOES.estoqueOutraUnidade(String(it.nome), String(it.unidade)) };
      if (itens.some((x2) => x2.itemId === it.id)) return { erro: `"${it.nome}" veio duas vezes: diga a quantidade uma vez só.` };
      const saldo = await this.saldoDoItem(e.tenantId, String(it.id), lista.unidadeId);
      itens.push({ itemId: String(it.id), nome: String(it.nome), unidade: String(it.unidade), contado: c.quantidade, saldo });
    }
    return {
      parametros: { listaId: lista.id, listaNome: lista.nome, itens: itens.map(({ itemId, nome, contado }) => ({ itemId, nome, contado })) },
      resumo: resumoDaContagem(lista.nome, itens, daLista.length),
      alvo: `contagem:${lista.id}`,
      unidadeId: lista.unidadeId,
    };
  }

  /** Abre a execução e salva com o ajuste, pelo MESMO serviço da tela; confere que a contagem ficou concluída. */
  private async aplicarContagem(
    p: { id: string; tenantId: string; unidadeId: string | null },
    x: { listaId: string; listaNome: string; itens: Array<{ itemId: string; nome: string; contado: number }> },
    quem: string,
  ): Promise<{ feita: boolean; texto: string }> {
    const contagem = await this.servicoDaContagem();
    if (!contagem) return { feita: false, texto: 'isso não está disponível agora. Nada foi feito.' };
    let execId: string | null = null;
    try {
      const exec = await contagem.iniciarExecucao(p.tenantId, x.listaId, quem, p.unidadeId);
      execId = String(exec?.id ?? '');
      const r = await contagem.salvarContagem(p.tenantId, execId, quem, { itens: x.itens.map((i) => ({ itemId: i.itemId, contado: i.contado })), aplicarAjuste: true });
      const [ok] = linhas(await this.db.execute(sql`select status from contagem_execucao where id = ${execId}::uuid and tenant_id = ${p.tenantId}::uuid`));
      if (ok?.status !== 'concluida') return { feita: false, texto: TEXTOS_DAS_ACOES.contagemNaoConcluida };
      const ajustados = Number(r?.ajustados ?? 0);
      return {
        feita: true,
        texto: `Lancei a contagem "${x.listaNome}": ${x.itens.length === 1 ? '1 item contado' : `${x.itens.length} itens contados`}, ${ajustados === 0 ? 'sem ajuste no estoque' : ajustados === 1 ? '1 com ajuste no estoque' : `${ajustados} com ajuste no estoque`}. Está em Estoque › Contagem.`,
      };
    } catch (err: any) {
      return { feita: false, texto: TEXTOS_DAS_ACOES.recusado(String(err?.response?.message ?? err?.message ?? 'o serviço recusou').slice(0, 240)) };
    }
  }

  /** O serviço de Banco e repasses (só na nuvem), achado na hora. Os testes trocam por `bancoDeTeste`. */
  bancoDeTeste: { classificar: (user: any, atual: string | null, id: string, dto: { tipo?: string | null; lembrar?: boolean }) => Promise<any> } | null = null;
  private async servicoDoBanco() {
    if (this.bancoDeTeste) return this.bancoDeTeste;
    if (!this.moduleRef) return null;
    try {
      const { BancoRepassesService } = await import('../banco-repasses/banco-repasses.service');
      return this.moduleRef.get(BancoRepassesService, { strict: false }) as any;
    } catch {
      return null;
    }
  }

  /** Classifica pelo MESMO serviço da tela ("Isso é o quê?") e confere o tipo gravado. A auditoria é a do serviço. */
  private async aplicarClassificacao(
    p: { id: string; tenantId: string; unidadeId: string | null },
    x: ParametrosDaClassificacao & { lancamentoId: string; valorCentavos: number; descricao: string },
    e: EscopoDoMister,
    quem: string,
  ): Promise<{ feita: boolean; texto: string }> {
    const banco = await this.servicoDoBanco();
    if (!banco) return { feita: false, texto: 'isso não está disponível agora. Nada foi feito.' };
    // O lançamento que a pessoa viu: o mesmo valor, ainda lá.
    const [agora] = linhas(await this.db.execute(sql`select valor_centavos::bigint as v from banco_lancamento where id = ${x.lancamentoId}::uuid and tenant_id = ${p.tenantId}::uuid`));
    if (!agora || Number(agora.v) !== Number(x.valorCentavos)) return { feita: false, texto: TEXTOS_DAS_ACOES.lancamentoMudou };
    try {
      await banco.classificar({ tenantId: p.tenantId, colaboradorId: quem, categoria: e.nivel }, p.unidadeId, x.lancamentoId, { tipo: x.tipo, lembrar: x.lembrar });
    } catch (err: any) {
      return { feita: false, texto: TEXTOS_DAS_ACOES.recusado(String(err?.response?.message ?? err?.message ?? 'o serviço recusou').slice(0, 240)) };
    }
    const [ok] = linhas(await this.db.execute(sql`select tipo from banco_lancamento where id = ${x.lancamentoId}::uuid and tenant_id = ${p.tenantId}::uuid`));
    if (ok?.tipo !== x.tipo) return { feita: false, texto: 'o lançamento não ficou com esse tipo. Confira em Financeiro › Banco e repasses.' };
    return { feita: true, texto: `Classifiquei o lançamento "${x.descricao}" em Financeiro › Banco e repasses${x.lembrar ? ', e os próximos iguais já entram assim' : ''}.` };
  }

  /** A pessoa pelo nome, entre os colaboradores ativos das lojas da conversa (ou sem loja); `null` = todas as lojas da empresa. */
  private async acharPessoaDaLoja(tenantId: string, dito: string, lojas: string[] | null): Promise<{ id: string; nome: string } | { erro: string }> {
    const achados = linhas(
      await this.db.execute(sql`
        select c.id::text as id, c.nome from colaborador c
         where c.tenant_id = ${tenantId}::uuid and c.deleted_at is null and c.status = 'ativo' and c.nome ilike ${comoTexto(dito)}
           ${lojas ? sql`and (c.unidade_id is null or c.unidade_id in (${sql.join(lojas.map((l) => sql`${l}::uuid`), sql`, `)}))` : sql``}
         order by c.nome limit 6`),
    );
    return escolherUm(achados, dito, (a) => String(a.nome), TEXTOS_DAS_ACOES.pessoaNaoAchada, TEXTOS_DAS_ACOES.pessoasDemais, (a) => ({ id: String(a.id), nome: String(a.nome) }));
  }

  /** Faz o cadastro pelo MESMO serviço da tela e confere o efeito. Sem o efeito, "não deu", com o motivo do serviço. */
  private async aplicarCadastro(
    p: { id: string; tenantId: string; unidadeId: string | null },
    x: ParametrosDeCadastro & Record<string, any>,
    e: EscopoDoMister,
    quem: string,
  ): Promise<{ feita: boolean; texto: string }> {
    const indisponivel = { feita: false, texto: 'esse cadastro não está disponível agora. Nada foi feito.' };
    const ator = { colaboradorId: quem, categoria: e.nivel } as any;
    // O presidente mexe na empresa inteira; o gerente, na loja dele (a MESMA regra das rotas).
    const atual = e.nivel === 'presidente' ? null : (p.unidadeId ?? null);
    const motivo = (err: any) => String(err?.response?.message ?? err?.message ?? 'o serviço recusou').slice(0, 240);
    try {
      if (x.acao === 'cadastrar_insumo') {
        if (!this.estoque) return indisponivel;
        const novo: any = await this.estoque.createItem(
          p.tenantId,
          { nome: x.nome, unidadeMedida: x.unidade, ...(x.minimo !== null ? { estoqueMinimo: x.minimo } : {}), ...(x.nomeComercial ? { nomeComercial: x.nomeComercial } : {}), ...(x.fornecedorId ? { fornecedorIds: [x.fornecedorId] } : {}) } as any,
          atual,
          ator,
        );
        const [ok] = linhas(await this.db.execute(sql`select nome from item_estoque where id = ${novo?.id ?? null}::uuid and tenant_id = ${p.tenantId}::uuid and deleted_at is null`));
        return ok ? { feita: true, texto: `Cadastrei "${ok.nome}" em Estoque › Produtos.` } : { feita: false, texto: 'o cadastro não apareceu em Estoque › Produtos. Confira lá.' };
      }
      if (x.acao === 'alterar_insumo') {
        if (!this.estoque) return indisponivel;
        const itemId = String(x.itemId);
        const conv = x.conversao;
        const conversoes = conv
          ? [
              ...linhas(
                await this.db.execute(sql`select unidade_de as "unidadeDe", fator::float8 as fator, unidade_para as "unidadePara" from item_conversao where tenant_id = ${p.tenantId}::uuid and item_id = ${itemId}::uuid`),
              ).filter((c) => semAcento(String(c.unidadeDe)) !== semAcento(conv.unidade)),
              { unidadeDe: conv.unidade, fator: conv.quantas, unidadePara: String(x.unidadeDoItem) },
            ]
          : undefined;
        const fornecedorIds = x.fornecedorId
          ? [...new Set([...linhas(await this.db.execute(sql`select fornecedor_id::text as id from item_fornecedor where tenant_id = ${p.tenantId}::uuid and item_id = ${itemId}::uuid`)).map((f) => f.id), x.fornecedorId])]
          : undefined;
        await this.estoque.updateItem(
          p.tenantId,
          itemId,
          { ...(x.novoNome ? { nome: x.novoNome } : {}), ...(x.nomeComercial ? { nomeComercial: x.nomeComercial } : {}), ...(x.minimo !== null ? { estoqueMinimo: x.minimo } : {}), ...(conversoes ? { conversoes } : {}), ...(fornecedorIds ? { fornecedorIds } : {}) } as any,
          atual,
          ator,
        );
        const [ok] = linhas(await this.db.execute(sql`select nome, nome_comercial as "nomeComercial" from item_estoque where id = ${itemId}::uuid and tenant_id = ${p.tenantId}::uuid`));
        if (!ok || (x.novoNome && ok.nome !== x.novoNome)) return { feita: false, texto: 'a mudança não apareceu em Estoque › Produtos. Confira lá.' };
        return { feita: true, texto: `Mudei "${ok.nome}" em Estoque › Produtos.` };
      }
      if (x.acao === 'cadastrar_fornecedor') {
        if (!this.fornecedores) return indisponivel;
        const f: any = await this.fornecedores.create(p.tenantId, { nome: x.nome, ...(x.cnpj ? { cnpj: x.cnpj } : {}), ...(x.telefone ? { telefone: x.telefone } : {}), ...(x.contato ? { contato: x.contato } : {}) } as any);
        return f?.id ? { feita: true, texto: `Cadastrei o fornecedor "${f.nome}" em Cadastros › Fornecedores.` } : { feita: false, texto: 'o fornecedor não apareceu em Cadastros › Fornecedores. Confira lá.' };
      }
      if (!this.compras) return indisponivel;
      await this.compras.removerLista(p.tenantId, String(x.listaId), atual);
      const [ok] = linhas(await this.db.execute(sql`select deleted_at is not null as excluido from compra_lista where id = ${String(x.listaId)}::uuid and tenant_id = ${p.tenantId}::uuid`));
      return ok?.excluido ? { feita: true, texto: `Excluí o pedido "${x.nomeDoPedido}" de Estoque › Pedidos.` } : { feita: false, texto: 'o pedido continua em Estoque › Pedidos. Confira lá.' };
    } catch (err: any) {
      return { feita: false, texto: TEXTOS_DAS_ACOES.recusado(motivo(err)) };
    } finally {
      await this.auditoria
        ?.registrar({ tenantId: p.tenantId, atorId: quem, atorPerfil: e.nivel, tipo: 'mister', acao: 'mister_acao', entidadeTipo: 'mister_proposta', entidadeId: p.id, origem: 'whatsapp', detalhe: { acao: x.acao } } as any)
        .catch(() => undefined);
    }
  }

  /** O pedido pelo número do painel, nas lojas da pessoa, nas últimas 24 horas (a mesma busca do cancelamento). */
  private async acharPedido(tenantId: string, dito: string, lojas: string[] | null): Promise<{ id: string; unidadeId: string | null; status: string; tipo: string | null; nome: string } | { erro: string }> {
    if (!/^[A-Za-z0-9-]{1,40}$/.test(dito)) return { erro: 'Diga o número do pedido como aparece no painel do Delivery.' };
    const numeroDoDia = /^\d{1,9}$/.test(dito) ? Number(dito) : null;
    const achados = linhas(
      await this.db.execute(sql`
        select pe.id::text as id, pe.unidade_id::text as "unidadeId", pe.canal, pe.numero, pe.display_id as "displayId", pe.status, pe.tipo
          from pedido_externo pe
         where pe.tenant_id = ${tenantId}::uuid and pe.deleted_at is null
           ${lojas ? sql`and (pe.unidade_id is null or pe.unidade_id in (${sql.join(lojas.map((l) => sql`${l}::uuid`), sql`, `)}))` : sql``}
           and pe.criado_em > now() - interval '24 hours'
           and (pe.display_id = ${dito} ${numeroDoDia != null ? sql`or pe.numero = ${numeroDoDia}` : sql``})
         order by pe.criado_em desc
         limit 6`),
    );
    if (!achados.length) return { erro: TEXTOS_DAS_ACOES.naoAchado };
    const abertos = achados.filter((a) => a.status !== 'concluido');
    if (abertos.length > 1) return { erro: TEXTOS_DAS_ACOES.maisDeUm };
    const a = abertos[0] ?? achados[0];
    return { id: a.id, unidadeId: a.unidadeId ?? null, status: String(a.status), tipo: a.tipo ?? null, nome: pedidoComoNoQuadro(a) };
  }

  /**
   * Lote 2: a tarefa de HOJE (o dia da loja, `hojeISO()` — V46) pelo título, nas lojas da pessoa, sem as excluídas. O título
   * igual (sem acento e maiúscula) vence o que só contém; mais de uma, a pessoa escolhe.
   */
  private async acharTarefa(tenantId: string, dito: string, lojas: string[] | null): Promise<{ id: string; unidadeId: string | null; estado: string; titulo: string } | { erro: string }> {
    const achados = linhas(
      await this.db.execute(sql`
        select i.id::text as id, i.unidade_id::text as "unidadeId", i.estado, d.titulo
          from tarefa_instancia i
          join tarefa_def d on d.id = i.tarefa_def_id and d.tenant_id = i.tenant_id
         where i.tenant_id = ${tenantId}::uuid and i.deleted_at is null and i.data = ${hojeISO()}::date
           ${lojas ? sql`and (i.unidade_id is null or i.unidade_id in (${sql.join(lojas.map((l) => sql`${l}::uuid`), sql`, `)}))` : sql``}
           and d.titulo ilike ${comoTexto(dito)}
         order by d.titulo
         limit 6`),
    );
    return escolherUm(achados, dito, (a) => String(a.titulo), TEXTOS_DAS_ACOES.tarefaNaoAchada, TEXTOS_DAS_ACOES.tarefasDemais, (a) => ({
      id: a.id,
      unidadeId: a.unidadeId ?? null,
      estado: String(a.estado),
      titulo: String(a.titulo),
    }));
  }

  /** Lote 3: a função pelo nome (a tela exige a função da tarefa), sem as excluídas. */
  private async acharFuncao(tenantId: string, dito: string): Promise<{ id: string; nome: string } | { erro: string }> {
    const achados = linhas(
      await this.db.execute(sql`
        select f.id::text as id, f.nome from funcao f
         where f.tenant_id = ${tenantId}::uuid and f.deleted_at is null and f.nome ilike ${comoTexto(dito)}
         order by f.nome limit 6`),
    );
    return escolherUm(achados, dito, (a) => String(a.nome), TEXTOS_DAS_ACOES.funcaoNaoAchada, TEXTOS_DAS_ACOES.funcoesDemais, (a) => ({ id: a.id, nome: String(a.nome) }));
  }

  /** Lote 3: o responsável pelo nome, entre os colaboradores ativos da loja (ou sem loja). */
  private async acharColaborador(tenantId: string, dito: string, unidadeId: string): Promise<{ id: string; nome: string } | { erro: string }> {
    const achados = linhas(
      await this.db.execute(sql`
        select c.id::text as id, c.nome from colaborador c
         where c.tenant_id = ${tenantId}::uuid and c.deleted_at is null and c.status = 'ativo'
           and (c.unidade_id is null or c.unidade_id = ${unidadeId}::uuid) and c.nome ilike ${comoTexto(dito)}
         order by c.nome limit 6`),
    );
    return escolherUm(achados, dito, (a) => String(a.nome), TEXTOS_DAS_ACOES.responsavelNaoAchado, TEXTOS_DAS_ACOES.responsaveisDemais, (a) => ({ id: a.id, nome: String(a.nome) }));
  }

  /** Lote 2: o produto do cardápio pelo nome (ativo, sem os excluídos), da empresa ou das lojas da pessoa. */
  private async acharProduto(tenantId: string, dito: string, lojas: string[] | null): Promise<{ id: string; nome: string; noIfood: boolean; na99: boolean } | { erro: string }> {
    const achados = linhas(
      await this.db.execute(sql`
        select p.id::text as id, p.nome, coalesce(p.no_ifood, false) as "noIfood", coalesce(p.na_99, false) as "na99"
          from produto p
         where p.tenant_id = ${tenantId}::uuid and p.deleted_at is null and coalesce(p.ativo, true)
           ${lojas ? sql`and (p.unidade_id is null or p.unidade_id in (${sql.join(lojas.map((l) => sql`${l}::uuid`), sql`, `)}))` : sql``}
           and p.nome ilike ${comoTexto(dito)}
         order by p.nome
         limit 6`),
    );
    return escolherUm(achados, dito, (a) => String(a.nome), TEXTOS_DAS_ACOES.produtoNaoAchado, TEXTOS_DAS_ACOES.produtosDemais, (a) => ({
      id: a.id,
      nome: String(a.nome),
      noIfood: a.noIfood === true,
      na99: a.na99 === true,
    }));
  }

  /**
   * Grava a proposta de botão: uma por pessoa, ação e alvo (o "aviso" da linha é um id fixo pela chave — o índice único da 428
   * não deixa duas). Renova a que acabou (vencida, não autorizada, não deu ou feita: a mesma ação pode ser pedida de novo
   * depois); a autorizada e a executando não renovam (null).
   */
  private async gravar(e: EscopoDoMister, acao: AcaoDoMister, unidadeId: string | null, parametros: Record<string, unknown>, alvo: string): Promise<{ id: string; venceEm: string | Date } | null> {
    const def = ACOES[acao];
    const avisoId = uuidDeChave('mister:acao:', e.tenantId, ':', e.colaboradorId, ':', acao, ':', alvo);
    await this.db.execute(sql`
      insert into mister_proposta (tenant_id, unidade_id, aviso_id, procedimento, parametros, nivel, vence_em)
      values (${e.tenantId}::uuid, ${unidadeId}::uuid, ${avisoId}::uuid, ${acao}, ${JSON.stringify(parametros)}::jsonb, ${def.nivel},
              clock_timestamp() + make_interval(mins => ${def.prazoMin}::int))
      on conflict (aviso_id, procedimento) do update
        set situacao = 'proposta', criada_em = clock_timestamp(), vence_em = excluded.vence_em, parametros = excluded.parametros,
            unidade_id = excluded.unidade_id, respondida_em = null, autorizada_por = null, telefone_final = null, executada_em = null,
            conferir_ate = null, concluida_em = null, resultado = null,
            link_hash = null, link_para = null, link_criado_em = null, link_aberto_em = null, pin_erros = 0, bloqueada_em = null
        where mister_proposta.situacao in ('vencida', 'recusada', 'nao_deu', 'feita', 'proposta')`);
    const [p] = linhas(
      await this.db.execute(sql`
        select id::text as id, vence_em as "venceEm" from mister_proposta
         where aviso_id = ${avisoId}::uuid and procedimento = ${acao} and situacao = 'proposta' and vence_em > now()`),
    );
    return p ? { id: p.id, venceEm: p.venceEm } : null;
  }

  /**
   * Lote 7: o movimento pelo MESMO `createMovimento` da tela (no ajuste, a diferença é feita por ele, no banco). O "feito" só
   * com a linha gravada e o saldo lido de novo.
   */
  private async lancarEstoque(
    p: { tenantId: string; unidadeId: string | null },
    a: { tipo: string; quantidade: number | null; saldoContado: number | null; motivo: string | null; itemId?: string; nomeDoItem?: string; unidadeDeMedida?: string },
    user: AuthUser,
  ): Promise<{ feita: boolean; texto: string }> {
    if (!this.estoque || !a.itemId) return { feita: false, texto: 'o estoque não está disponível agora. Nada foi lançado.' };
    const nome = String(a.nomeDoItem ?? 'o produto');
    try {
      const r: any = await this.estoque.createMovimento(
        p.tenantId,
        {
          itemId: a.itemId,
          tipo: a.tipo,
          ...(a.tipo === 'ajuste' ? { saldoContado: a.saldoContado as number } : { quantidade: a.quantidade as number }),
          motivo: a.motivo ? `Pelo Mister: ${a.motivo}` : 'Pelo Mister',
        },
        p.unidadeId,
        { colaboradorId: user.colaboradorId, categoria: user.categoria },
      );
      if (r?.semMudanca) return { feita: true, texto: `o saldo de "${nome}" já era esse. Nada foi lançado.` };
      const [gravado] = r?.id
        ? linhas(await this.db.execute(sql`select 1 as ok from movimento_estoque where id = ${r.id}::uuid and tenant_id = ${p.tenantId}::uuid`))
        : [];
      if (!gravado) return { feita: false, texto: 'o movimento não apareceu no estoque. Confira em Estoque › Produtos.' };
      const saldo = await this.saldoDoItem(p.tenantId, a.itemId, p.unidadeId);
      return { feita: true, texto: `"${nome}" agora tem ${quantidadeBr(saldo)} ${a.unidadeDeMedida ?? ''}.`.replace(' .', '.') };
    } catch (err: any) {
      const motivo = String(err?.response?.message ?? err?.message ?? 'o serviço recusou').slice(0, 200).replace(/[.\s]+$/, '');
      this.logger.warn(`o movimento de estoque não foi lançado: ${motivo}`);
      return { feita: false, texto: `o estoque recusou: ${motivo}. Nada foi lançado.` };
    }
  }

  /**
   * Lote 8: o produto, o preço de hoje em cada canal e o que a pessoa precisa saber antes do PIN. Recusa aqui o que a tela
   * recusaria ao gravar (o canal desligado) e o que daria efeito errado (produto com variações, canal em que ele não está).
   */
  private async prepararPreco(
    e: EscopoDoMister,
    a: { produto: string; canais: CanalDoProduto[]; precoNovo: number },
    lojas: string[] | null,
  ): Promise<{ id: string; unidadeId: string | null; mudanca: MudancaDePreco } | { erro: string }> {
    const pr = await this.acharProduto(e.tenantId, a.produto, lojas);
    if ('erro' in pr) return pr;
    const [l] = linhas(
      await this.db.execute(sql`
        select p.unidade_id::text as "unidadeId", p.preco_venda::text as "precoVenda", p.preco_ifood::text as "precoIfood", p.preco_99::text as "preco99",
               p.preco_promocional::text as promocao,
               exists (select 1 from produto_variacao v where v.tenant_id = p.tenant_id and v.produto_id = p.id and v.deleted_at is null and v.ativo) as "temVariacao",
               (select count(*)::int from unidade u where u.tenant_id = p.tenant_id and u.deleted_at is null) as "quantasLojas"
          from produto p
         where p.id = ${pr.id}::uuid and p.tenant_id = ${e.tenantId}::uuid and p.deleted_at is null`),
    );
    if (!l) return { erro: TEXTOS_DAS_ACOES.produtoNaoAchado };
    if (l.temVariacao) return { erro: TEXTOS_DAS_ACOES.precoComVariacao(pr.nome) };
    if (a.canais.includes('ifood')) {
      if (!(await ifoodPeloOrzuniLigado(this.db, e.tenantId))) return { erro: TEXTOS_DAS_ACOES.precoCanalDesligado('no iFood') };
      if (!pr.noIfood) return { erro: TEXTOS_DAS_ACOES.precoForaDoCanal(pr.nome, 'no iFood') };
    }
    if (a.canais.includes('99food')) {
      if (!(await precosNa99Ligado(this.db, e.tenantId))) return { erro: TEXTOS_DAS_ACOES.precoCanalDesligado('na 99') };
      if (!pr.na99) return { erro: TEXTOS_DAS_ACOES.precoForaDoCanal(pr.nome, 'na 99') };
    }
    const hoje = (c: CanalDoProduto): number | null => {
      const v = c === 'regem' ? l.precoVenda : c === 'ifood' ? l.precoIfood : l.preco99;
      return v === null || v === undefined ? null : Number(v);
    };
    // Com o PIN da sessão vencido, o preço de hoje não aparece: nem na pergunta, nem na recusa de "já custa isso".
    if (e.verValores && canaisComOPreco(l, a.canais, a.precoNovo).length === a.canais.length) return { erro: TEXTOS_DAS_ACOES.precoIgual(pr.nome, reaisDaAcao(a.precoNovo)) };
    return {
      id: pr.id,
      unidadeId: l.unidadeId ?? null,
      mudanca: {
        nome: pr.nome,
        para: a.precoNovo,
        canais: a.canais.map((canal) => ({ canal, de: e.verValores ? hoje(canal) : null })),
        temPromocao: l.promocao !== null && l.promocao !== undefined,
        promocao: e.verValores && l.promocao !== null && l.promocao !== undefined ? Number(l.promocao) : null,
        todasAsLojas: !l.unidadeId && Number(l.quantasLojas) > 1,
      },
    };
  }

  /**
   * Lote 8: o preço pelo MESMO `ProdutoService.precoDoCanal` da Gestão do catálogo (ele audita o "de → para" e o gatilho põe o
   * app na fila), um canal por vez. O desfecho sai do que ficou gravado, canal a canal.
   */
  private async aplicarPreco(
    p: { tenantId: string },
    a: { produto: string; canais: CanalDoProduto[]; precoNovo: number; produtoId?: string; mudanca?: MudancaDePreco },
    ator: { id: string; perfil: string },
  ): Promise<{ feita: boolean; texto: string }> {
    if (!this.produtos || !a.produtoId) return { feita: false, texto: 'o cadastro dos produtos não está disponível agora. Nada foi feito.' };
    const nome = a.mudanca?.nome ?? a.produto;
    let motivo: string | null = null;
    for (const canal of a.canais) {
      try {
        await this.produtos.precoDoCanal(p.tenantId, a.produtoId, canal, a.precoNovo, ator);
      } catch (err: any) {
        motivo = String(err?.response?.message ?? err?.message ?? 'o serviço recusou').slice(0, 200).replace(/[.\s]+$/, '');
        this.logger.warn(`o preço do canal ${canal} não mudou: ${motivo}`);
        break;
      }
    }
    const [l] = linhas(
      await this.db.execute(sql`
        select preco_venda::text as "precoVenda", preco_ifood::text as "precoIfood", preco_99::text as "preco99"
          from produto where id = ${a.produtoId}::uuid and tenant_id = ${p.tenantId}::uuid and deleted_at is null`),
    );
    if (!l) return { feita: false, texto: 'o produto não foi encontrado. Nada foi feito.' };
    const certos = canaisComOPreco(l, a.canais, a.precoNovo);
    const preco = reaisDaAcao(a.precoNovo);
    if (certos.length === a.canais.length) return { feita: true, texto: TEXTOS_DAS_ACOES.precoFeito(nome, preco, ondeOProduto(a.canais), a.canais.some((c) => c !== 'regem')) };
    if (!certos.length) return { feita: false, texto: TEXTOS_DAS_ACOES.precoNaoMudou(nome, motivo) };
    return { feita: false, texto: TEXTOS_DAS_ACOES.precoEmParte(nome, preco, ondeOProduto(certos), ondeOProduto(a.canais.filter((c) => !certos.includes(c))), motivo) };
  }

  /**
   * Lote 9: o cardápio da loja (a MESMA escolha da pausa do cardápio), qual horário muda e como cada dia está hoje. Recusa aqui
   * o que daria efeito errado: a loja sem a semana cadastrada (lista vazia é "sempre aberta") e a semana sem nenhum dia aberto.
   */
  private async prepararHorario(
    e: EscopoDoMister,
    a: { dias: number[]; janela: JanelaDoDia | null; horarioDe: 'entrega' | 'retirada' | null },
    unidadeAtual: string | null,
  ): Promise<{ unidadeDoCardapio: string | null; coluna: ColunaDoHorario; mudanca: MudancaDeHorario } | { erro: string }> {
    if (!this.pausa) return { erro: 'O horário da loja não está disponível agora.' };
    let cardapio: { tem: boolean; unidadeId: string | null };
    try {
      cardapio = await this.pausa.lojaDoCardapio(e.tenantId, unidadeAtual);
    } catch {
      return { erro: TEXTOS_DAS_ACOES.horarioPedeLoja };
    }
    if (!cardapio.tem) return { erro: TEXTOS_DAS_ACOES.horarioSemCardapio };
    const [c] = linhas(
      await this.db.execute(sql`
        select cc.horarios, cc.horarios_retirada as "horariosRetirada", cc.horario_unico as "horarioUnico",
               (select count(*)::int from unidade u where u.tenant_id = cc.tenant_id and u.deleted_at is null) as "quantasLojas"
          from cardapio_config cc
         where cc.tenant_id = ${e.tenantId}::uuid
           and ${cardapio.unidadeId ? sql`cc.unidade_id = ${cardapio.unidadeId}::uuid` : sql`cc.unidade_id is null`}
         order by cc.created_at
         limit 1`),
    );
    if (!c) return { erro: TEXTOS_DAS_ACOES.horarioSemCardapio };
    const unico = c.horarioUnico !== false;
    if (!unico && !a.horarioDe) return { erro: TEXTOS_DAS_ACOES.horarioPedeQual };
    const retirada = !unico && a.horarioDe === 'retirada';
    const lista = retirada ? c.horariosRetirada : c.horarios;
    const recusou = recusaDoHorario(lista, a.dias.map((dia) => ({ dia, janela: a.janela })));
    if (recusou) return { erro: recusou };
    const dias = a.dias.map((dia) => ({ dia, de: situacaoDoDia(lista, dia).janela, para: a.janela }));
    if (dias.every((d) => mesmaJanela(d.de, d.para))) return { erro: TEXTOS_DAS_ACOES.horarioIgual };
    const hoje = new Date(`${hojeISO()}T12:00:00Z`).getUTCDay();
    return {
      unidadeDoCardapio: cardapio.unidadeId,
      coluna: retirada ? 'horarios_retirada' : 'horarios',
      mudanca: {
        dias,
        conjunto: unico ? 'unico' : retirada ? 'retirada' : 'entrega',
        loja: e.lojaUnica ? null : (e.lojas.find((l) => l.id === cardapio.unidadeId)?.nome ?? null),
        todasAsLojas: !cardapio.unidadeId && Number(c.quantasLojas) > 1,
        incluiHoje: dias.some((d) => d.dia === hoje),
      },
    };
  }

  /** Lote 9: grava só os dias pedidos (`gravarHorariosDosDias`), audita o "de → para" e confere pelo que ficou no banco. */
  private async aplicarHorario(
    p: { id: string; tenantId: string; unidadeId: string | null },
    a: { unidadeDoCardapio?: string | null; coluna?: ColunaDoHorario; mudancaDeHorario?: MudancaDeHorario },
    ator: { id: string; perfil: string },
  ): Promise<{ feita: boolean; texto: string }> {
    const m = a.mudancaDeHorario;
    if (!m || !a.coluna) return { feita: false, texto: 'a mudança de horário veio incompleta. Nada foi feito.' };
    const unidade = a.unidadeDoCardapio ?? null;
    let gravado: { id: string; lista: any[] } | { erro: string };
    try {
      gravado = await gravarHorariosDosDias(this.db, p.tenantId, unidade, a.coluna, m.dias.map((d) => ({ dia: d.dia, janela: d.para })));
    } catch (err: any) {
      this.logger.error(`o horário da proposta ${p.id} não foi gravado: ${String(err?.message ?? err).slice(0, 200)}`, err?.stack);
      return { feita: false, texto: 'não consegui gravar o horário agora. Nada foi feito.' };
    }
    if ('erro' in gravado) return { feita: false, texto: `${gravado.erro} Nada foi feito.` };
    await this.auditoria
      ?.registrar({
        tenantId: p.tenantId,
        unidadeId: unidade,
        atorId: ator.id,
        atorPerfil: ator.perfil,
        tipo: 'delivery',
        acao: 'mudou_horario_da_loja',
        entidadeTipo: 'cardapio_config',
        entidadeId: gravado.id,
        detalhe: { conjunto: m.conjunto, dias: m.dias.map((d) => ({ dia: NOMES_DOS_DIAS[d.dia], de: textoDaJanela(d.de), para: textoDaJanela(d.para) })) },
        origem: 'whatsapp',
      } as any)
      .catch(() => undefined);
    const coluna = sql.raw(a.coluna === 'horarios_retirada' ? 'horarios_retirada' : 'horarios');
    const [l] = linhas(await this.db.execute(sql`select ${coluna} as lista from cardapio_config where id = ${gravado.id}::uuid and tenant_id = ${p.tenantId}::uuid`));
    const ficou = m.dias.every((d) => mesmaJanela(situacaoDoDia(l?.lista, d.dia).janela, d.para));
    if (!ficou) return { feita: false, texto: TEXTOS_DAS_ACOES.horarioNaoFicou };
    return { feita: true, texto: TEXTOS_DAS_ACOES.horarioFeito(m.dias.map((d) => `${NOMES_DOS_DIAS[d.dia]} ${textoDaJanela(d.para)}`).join('; ')) };
  }

  /**
   * Lote 10: a conta pelo nome, entre as a pagar em aberto da loja em uso (o filtro de `contas_a_pagar_e_receber`). Mexe com
   * dinheiro: só passa com UMA conta achada (conta recorrente repete o nome, e o nome igual não decide) e com o valor dela.
   */
  private async prepararBaixa(
    e: EscopoDoMister,
    a: { conta: string; venceEm: string | null; forma: FormaDaBaixa; pagoEm: string | null; valorPago: number | null },
    atual: string | null,
  ): Promise<{ id: string; unidadeId: string | null; baixa: BaixaDeConta } | { erro: string }> {
    const achados = linhas(
      await this.db.execute(sql`
        select t.id::text as id, t.unidade_id::text as "unidadeId", t.descricao, f.nome as fornecedor, t.valor::text as valor,
               t.vencimento::text as vencimento, t.recorrencia
          from titulo_financeiro t
          left join fornecedor f on f.id = t.fornecedor_id
         where t.tenant_id = ${e.tenantId}::uuid and t.tipo = 'pagar' and t.status = 'aberto' ${sqlUnidade('t.unidade_id', atual)}
           and (t.descricao ilike ${comoTexto(a.conta)} or f.nome ilike ${comoTexto(a.conta)})
           ${a.venceEm ? sql`and to_char(t.vencimento, 'DD/MM') = ${a.venceEm}` : sql``}
         order by t.vencimento asc nulls last, t.created_at desc, t.id
         limit 6`),
    );
    if (!achados.length) return { erro: TEXTOS_DAS_ACOES.contaNaoAchada };
    if (achados.length > 1) {
      if (a.venceEm) return { erro: TEXTOS_DAS_ACOES.contaRepetida };
      const lista = achados.slice(0, 5).map((c) => linhaDaConta({ descricao: String(c.descricao).replace(/\s+/g, ' ').trim().slice(0, 60), valor: Number(c.valor), vencimento: c.vencimento ?? null }));
      return { erro: TEXTOS_DAS_ACOES.contasDemais(lista.join('; ')) };
    }
    const t = achados[0];
    const valor = Number(t.valor);
    if (!(valor > 0)) return { erro: TEXTOS_DAS_ACOES.contaSemValor };
    if (a.valorPago !== null && Math.round(a.valorPago * 100) !== Math.round(valor * 100)) return { erro: TEXTOS_DAS_ACOES.contaOutroValor(reaisDaAcao(valor)) };
    return {
      id: t.id,
      unidadeId: t.unidadeId ?? null,
      baixa: {
        descricao: String(t.descricao).replace(/\s+/g, ' ').trim().slice(0, 80),
        fornecedor: t.fornecedor ? String(t.fornecedor).slice(0, 60) : null,
        valor,
        vencimento: t.vencimento ?? null,
        forma: a.forma,
        // A data fica fixa na proposta: autorizar depois da meia-noite não muda o dia que a pessoa viu.
        pagoEm: a.pagoEm ?? hojeISO(),
        recorrente: !!t.recorrencia && t.recorrencia !== 'nenhuma',
      },
    };
  }

  /**
   * Lote 10: a baixa pelo MESMO `FinanceiroService.pagar` da tela (uma vez só, pela troca condicional; ele lança a saída, cria a
   * próxima recorrente e audita), com o valor que a pessoa viu. O "feito" só com a conta paga E a saída no caixa.
   */
  private async aplicarBaixa(
    p: { id: string; tenantId: string },
    a: { tituloId?: string; baixa?: BaixaDeConta },
    e: { nivel: string; presa?: string | null },
    quem: string,
  ): Promise<{ feita: boolean; texto: string }> {
    if (!this.financeiro || !a.tituloId || !a.baixa) return { feita: false, texto: 'o financeiro não está disponível agora. Nada foi lançado.' };
    const b = a.baixa;
    const centavos = Math.round(b.valor * 100);
    const [t] = linhas(await this.db.execute(sql`select status, valor::text as valor from titulo_financeiro where id = ${a.tituloId}::uuid and tenant_id = ${p.tenantId}::uuid`));
    if (!t || t.status !== 'aberto') return { feita: false, texto: TEXTOS_DAS_ACOES.contaNaoAberta };
    if (Math.round(Number(t.valor) * 100) !== centavos) return { feita: false, texto: TEXTOS_DAS_ACOES.contaMudouDeValor(reaisDaAcao(Number(t.valor))) };
    let proxima: string | null = null;
    try {
      const r: any = await this.financeiro.pagar(p.tenantId, quem, e.nivel, a.tituloId, { data: b.pagoEm, forma: b.forma, valor: b.valor }, e.presa ?? null);
      proxima = r?.proximoVencimento ?? null;
    } catch (err: any) {
      const motivo = String(err?.response?.message ?? err?.message ?? 'o serviço recusou').slice(0, 200).replace(/[.\s]+$/, '');
      this.logger.warn(`a baixa da proposta ${p.id} foi recusada: ${motivo}`);
      return { feita: false, texto: TEXTOS_DAS_ACOES.contaRecusada(motivo) };
    }
    const [l] = linhas(
      await this.db.execute(sql`
        select t.status,
               (select count(*)::int from lancamento_caixa c
                 where c.tenant_id = t.tenant_id and c.titulo_id = t.id and c.tipo = 'saida' and c.estorno_de is null
                   and round(c.valor * 100) = ${centavos} and c.data = ${b.pagoEm}::date and c.criado_por_id = ${quem}::uuid) as lancados
          from titulo_financeiro t where t.id = ${a.tituloId}::uuid and t.tenant_id = ${p.tenantId}::uuid`),
    );
    if (l?.status !== 'pago' || !(Number(l?.lancados) > 0)) return { feita: false, texto: TEXTOS_DAS_ACOES.contaNaoFicou };
    return { feita: true, texto: textoDaBaixaFeita(b, proxima) };
  }

  /**
   * V7f: guarda o que o presidente informou, uma vez por toque. O "feito" só com a linha lida de volta. A auditoria registra o tipo,
   * nunca o valor: saldo e folha são só do presidente.
   */
  private async guardarDado(
    p: { id: string; tenantId: string },
    a: { acao: AcaoDeDadoInformado; centavos: number; dia: string; campanhaId?: string | null; toque?: string },
    nivel: string,
    quem: string,
  ): Promise<{ feita: boolean; texto: string }> {
    if (!a.toque) return { feita: false, texto: TEXTOS_DAS_ACOES.dadoNaoGuardou };
    try {
      const ficou = await gravarDadoInformado(this.db, {
        tenantId: p.tenantId,
        tipo: TIPO_DO_DADO[a.acao],
        centavos: a.centavos,
        dia: a.dia,
        quem,
        campanhaId: a.campanhaId ?? null,
        chave: `proposta:${p.id}:${a.toque}`,
      });
      if (!ficou) return { feita: false, texto: TEXTOS_DAS_ACOES.dadoNaoGuardou };
    } catch (err: any) {
      this.logger.error(`o dado da proposta ${p.id} não foi guardado: ${String(err?.message ?? err).slice(0, 200)}`, err?.stack);
      return { feita: false, texto: TEXTOS_DAS_ACOES.dadoNaoGuardou };
    }
    await this.auditoria
      ?.registrar({ tenantId: p.tenantId, atorId: quem, atorPerfil: nivel, tipo: 'mister', acao: 'mister_dado_informado', entidadeTipo: 'mister_proposta', entidadeId: p.id, origem: 'whatsapp', detalhe: { tipo: TIPO_DO_DADO[a.acao] } } as any)
      .catch(() => undefined);
    return { feita: true, texto: textoDoDadoGuardado(a.acao, a.dia) };
  }

  /** Lote 7: o item de estoque pelo nome (o da ficha ou o comercial), da empresa ou das lojas da pessoa. */
  private async acharItem(tenantId: string, dito: string, lojas: string[] | null): Promise<{ id: string; nome: string; unidadeId: string | null; unidade: string } | { erro: string }> {
    const achados = linhas(
      await this.db.execute(sql`
        select i.id::text as id, i.nome, i.unidade_id::text as "unidadeId", i.unidade_medida as unidade
          from item_estoque i
         where i.tenant_id = ${tenantId}::uuid and i.deleted_at is null
           ${lojas ? sql`and (i.unidade_id is null or i.unidade_id in (${sql.join(lojas.map((l) => sql`${l}::uuid`), sql`, `)}))` : sql``}
           and (i.nome ilike ${comoTexto(dito)} or i.nome_comercial ilike ${comoTexto(dito)})
         order by i.nome
         limit 6`),
    );
    return escolherUm(achados, dito, (a) => String(a.nome), TEXTOS_DAS_ACOES.itemNaoAchado, TEXTOS_DAS_ACOES.itensDemais, (a) => ({
      id: a.id,
      nome: String(a.nome),
      unidadeId: a.unidadeId ?? null,
      unidade: String(a.unidade ?? 'un'),
    }));
  }

  /** Lote 7: o saldo do item na loja, pela MESMA conta do `createMovimento`. */
  private async saldoDoItem(tenantId: string, itemId: string, unidadeId: string | null): Promise<number> {
    const [s] = linhas(
      await this.db.execute(sql`
        select coalesce(sum(case m.tipo when 'entrada' then m.quantidade when 'saida' then -m.quantidade else m.quantidade end), 0)::text as saldo
          from movimento_estoque m
         where m.tenant_id = ${tenantId}::uuid and m.item_id = ${itemId}::uuid
           ${unidadeId ? sql`and m.unidade_id = ${unidadeId}::uuid` : sql``}`),
    );
    return Math.round(Number(s?.saldo ?? 0) * 1000) / 1000;
  }

  /**
   * M6l: a imagem pelo DMS Graph (a porta única do Regem, `GraphImagemService`, que nunca lança). A chave é a proposta: repetir
   * não paga de novo. Só é "feito" com a imagem ENTREGUE na conversa de quem pediu.
   */
  private async gerarImagem(
    p: { id: string; tenantId: string; autorizadaPor: string | null },
    a: { pedido: string; proporcao: ProporcaoDaImagem },
  ): Promise<{ feita: boolean; texto: string }> {
    if (!imagemLigada() || !this.imagens || !this.numero) return { feita: false, texto: 'a criação de imagem não está ligada. Nada foi gerado.' };
    const r = await this.imagens.criarImagem(p.tenantId, { descricao: a.pedido, proporcao: a.proporcao, formato: 'jpeg', chave: `mister:${p.id}` });
    if (!r.ok) return { feita: false, texto: r.mensagem.charAt(0).toLowerCase() + r.mensagem.slice(1) };
    const [v] = linhas(
      await this.db.execute(sql`
        select telefone from mister_vinculo
         where tenant_id = ${p.tenantId}::uuid and colaborador_id = ${p.autorizadaPor}::uuid and ligado_em is not null and telefone is not null`),
    );
    if (!v?.telefone) return { feita: false, texto: 'o seu WhatsApp não está mais ligado ao Mister. A imagem não foi enviada.' };
    try {
      await this.numero.enviarImagem(v.telefone, r.bytes, '', r.mimeType);
    } catch (err: any) {
      this.logger.warn(`a imagem da proposta ${p.id} não saiu pelo WhatsApp: ${String(err?.message ?? err).slice(0, 200)}`);
      return { feita: false, texto: 'a imagem foi gerada, mas não consegui mandar por aqui. Peça de novo.' };
    }
    const franquia = r.franquia ? ` São ${r.franquia.usados} de ${r.franquia.total} imagens neste mês.` : '';
    return { feita: true, texto: `A imagem está logo acima.${franquia} Para mudar, me diga o que trocar.` };
  }

  // ───────────────────────────── executar ─────────────────────────────

  /**
   * Executa a ação autorizada pelo MESMO serviço da tela, com a permissão conferida de novo (o perfil pode ter mudado desde a
   * pergunta) e confere o efeito pelo estado que ficou. Devolve o desfecho; quem grava "feita"/"não deu" e avisa a pessoa é
   * o serviço das propostas.
   */
  async executar(p: { id: string; tenantId: string; unidadeId: string | null; procedimento: string; parametros: any; autorizadaPor: string | null }): Promise<{ feita: boolean; texto: string }> {
    if (!ehAcaoDoMister(p.procedimento)) return { feita: false, texto: 'essa ação não existe mais. Nada foi feito.' };
    const quem = p.autorizadaPor;
    if (!quem || quem !== String(p.parametros?.colaboradorId ?? '')) return { feita: false, texto: 'a ação só vale com o "Autorizar" de quem pediu. Nada foi feito.' };
    const e = await this.ferramentas.escopoDaTela(p.tenantId, quem);
    const def = ACOES[p.procedimento];
    // V7f: o perfil pode ter mudado entre a pergunta e o toque.
    if (def.soPresidente && (!e || e.nivel !== 'presidente' || e.presa)) return { feita: false, texto: 'só o presidente da empresa guarda esse dado. Nada foi gravado.' };
    if (!e || !podeFazer(e, def)) {
      const a = def.id === 'mudar_horario' ? 'às configurações da loja' : def.id === 'pagar_conta' ? 'ao Financeiro' : def.pedeVerValores ? 'à mudança de preço' : def.permissao === 'meu_dia' ? 'às Tarefas' : def.permissao === 'loja' ? 'ao cadastro dos produtos' : def.permissao === 'estoque' ? 'ao lançamento do estoque' : 'ao Delivery';
      return { feita: false, texto: `o seu perfil não dá mais acesso ${a}. Nada foi feito.` };
    }
    const parametros = p.parametros as ParametrosDaAcao & { pedidoId?: string; pedido?: string; instanciaId?: string; titulo?: string; produtoId?: string; nome?: string };
    const user: AuthUser = { tenantId: p.tenantId, colaboradorId: quem, categoria: e.nivel, unidadeId: e.nivel === 'presidente' ? null : (p.unidadeId ?? null), nome: e.nome ?? null } as AuthUser;
    const motivo = (err: any) => String(err?.response?.message ?? err?.message ?? 'o serviço recusou').slice(0, 240);
    // M6l e lote 7 cuidam da própria falha: o `catch` abaixo confere pedido, canal e tarefa, que aqui não existem.
    if (parametros.acao === 'criar_imagem') {
      return this.gerarImagem(p, parametros).catch((err: any) => {
        this.logger.error(`a imagem da proposta ${p.id} falhou: ${String(err?.message ?? err).slice(0, 200)}`, err?.stack);
        return { feita: false, texto: 'não consegui gerar a imagem agora. Tente de novo.' };
      });
    }
    if (parametros.acao === 'movimentar_estoque') return this.lancarEstoque(p, parametros as any, user);
    if (parametros.acao === 'mudar_preco') return this.aplicarPreco(p, parametros as any, { id: quem, perfil: e.nivel });
    if (parametros.acao === 'mudar_horario') return this.aplicarHorario(p, parametros as any, { id: quem, perfil: e.nivel });
    if (parametros.acao === 'pagar_conta') return this.aplicarBaixa(p, parametros as any, e, quem);
    if (ehDadoInformado(parametros.acao)) return this.guardarDado(p, parametros as any, e.nivel, quem);
    if (ehCadastro(parametros.acao)) return this.aplicarCadastro(p, parametros as any, e, quem);
    if (ehDaLoja(parametros.acao)) return this.aplicarDaLoja(p, parametros as any, e, quem);
    if (parametros.acao === 'classificar_banco') return this.aplicarClassificacao(p, parametros as any, e, quem);
    if (parametros.acao === 'contar_estoque') return this.aplicarContagem(p, parametros as any, quem);
    if (parametros.acao === 'fechar_caixa' || parametros.acao === 'sangria') return this.aplicarCaixa(p, parametros as any, e, quem);
    if (parametros.acao === 'pagar_entregador') return this.aplicarEntregador(p, parametros as any, quem);
    if (parametros.acao === 'incluir_marcacao' || parametros.acao === 'desconsiderar_marcacao') return this.aplicarPonto(p, parametros as any, e, quem);
    try {
      if (parametros.acao === 'pausar_canal' || parametros.acao === 'reabrir_canal') {
        if (!this.pausa) return { feita: false, texto: 'a pausa dos canais não está disponível agora. Nada foi feito.' };
        if (parametros.acao === 'pausar_canal') {
          await this.pausa.pausar(user, p.unidadeId, {
            canais: parametros.canais,
            motivo: parametros.motivo,
            motivoTexto: parametros.motivoTexto,
            tempo: parametros.minutos !== null ? { minutos: parametros.minutos } : { ate: parametros.ate },
            tempo99: parametros.fimDoDia ? { fimDoDia: true } : { minutos: parametros.minutos },
          } as any);
        } else {
          for (const canal of parametros.canais) await this.pausa.reabrir(user, p.unidadeId, canal);
        }
        return await this.conferirCanais(p.tenantId, p.unidadeId, parametros.canais, parametros.acao === 'pausar_canal');
      }
      if (parametros.acao === 'concluir_tarefa') {
        // Lote 2: o MESMO `concluir` da tela (a regra do motivo e da foto é dele) e a MESMA auditoria do controller.
        if (!this.tarefas) return { feita: false, texto: 'as tarefas não estão disponíveis agora. Nada foi feito.' };
        const id = String(parametros.instanciaId ?? '');
        await this.tarefas.concluir(p.tenantId, id, { estado: parametros.estado, motivo: parametros.justificativa ?? undefined } as any, quem);
        await this.auditoria
          ?.registrar({ tenantId: p.tenantId, atorId: quem, atorPerfil: e.nivel, tipo: 'checklist', acao: 'concluiu_tarefa', entidadeTipo: 'tarefa_instancia', entidadeId: id, detalhe: { estado: parametros.estado }, origem: 'whatsapp' } as any)
          .catch(() => undefined);
        return await this.conferirTarefa(p.tenantId, id, parametros.estado, String(parametros.titulo ?? parametros.tarefa));
      }
      if (parametros.acao === 'criar_tarefa') {
        // Lote 3: as DUAS etapas da tela ("Nova tarefa"): a definição (`TarefaDefService.create`, com quem criou) e a tarefa
        // de hoje (`TarefaInstanciaService.instanciar`, com o responsável, se dito — senão o escalado ou em aberto).
        if (!this.defs || !this.tarefas) return { feita: false, texto: 'as tarefas não estão disponíveis agora. Nada foi feito.' };
        const x = parametros as any;
        const def: any = await this.defs.create(
          p.tenantId,
          { unidadeId: p.unidadeId, titulo: x.titulo, funcaoId: x.funcaoId, ...(x.horario ? { horario: x.horario } : {}), origem: 'avulsa' } as any,
          { id: quem, nivel: e.nivel },
        );
        await this.tarefas.instanciar(p.tenantId, { tarefaDefId: def.id, data: hojeISO(), ...(x.responsavelId ? { colaboradorResolvidoId: x.responsavelId } : {}) } as any);
        return await this.conferirTarefaCriada(p.tenantId, String(def.id), String(x.titulo));
      }
      if (parametros.acao === 'pausar_produto' || parametros.acao === 'reativar_produto') {
        // Lote 2: a MESMA pausa por canal da tela (`ProdutoService.pausaDoCanal`, que audita), um canal por vez.
        if (!this.produtos) return { feita: false, texto: 'o cadastro dos produtos não está disponível agora. Nada foi feito.' };
        const pausado = parametros.acao === 'pausar_produto';
        const canais = (parametros.canais ?? ['regem']) as CanalDoProduto[];
        for (const canal of canais) await this.produtos.pausaDoCanal(p.tenantId, String(parametros.produtoId ?? ''), canal, pausado, { id: quem, perfil: e.nivel });
        return await this.conferirProduto(p.tenantId, String(parametros.produtoId ?? ''), canais, pausado, String(parametros.nome ?? parametros.produto));
      }
      if (!this.delivery) return { feita: false, texto: 'o painel do Delivery não está disponível agora. Nada foi feito.' };
      const pedidoId = String(parametros.pedidoId ?? '');
      const pedido = String(parametros.pedido ?? 'do Mister');
      if (parametros.acao === 'aceitar_pedido') await this.delivery.aceitar(p.tenantId, quem, pedidoId);
      else if (parametros.acao === 'pedido_pronto') await this.delivery.avancar(p.tenantId, pedidoId, { de: 'confirmado' });
      else await this.delivery.despachar(p.tenantId, pedidoId);
      return await this.conferirPedido(p.tenantId, pedidoId, parametros.acao, pedido);
    } catch (err: any) {
      // A recusa do serviço (outra pessoa já mexeu, o canal não está disponível) vem antes de mudar o que ele recusa. Se o
      // efeito apareceu mesmo assim, a conferência diz o que foi FEITO.
      const depois =
        parametros.acao === 'pausar_canal' || parametros.acao === 'reabrir_canal'
          ? await this.conferirCanais(p.tenantId, p.unidadeId, parametros.canais, parametros.acao === 'pausar_canal')
          : parametros.acao === 'criar_tarefa'
            ? { feita: false, texto: '' } // a recusa da criação vem antes de gravar: o motivo dela é o desfecho
            : parametros.acao === 'concluir_tarefa'
            ? await this.conferirTarefa(p.tenantId, String(parametros.instanciaId ?? ''), parametros.estado, String(parametros.titulo ?? parametros.tarefa))
            : parametros.acao === 'pausar_produto' || parametros.acao === 'reativar_produto'
              ? await this.conferirProduto(p.tenantId, String(parametros.produtoId ?? ''), (parametros.canais ?? ['regem']) as CanalDoProduto[], parametros.acao === 'pausar_produto', String(parametros.nome ?? parametros.produto))
              : await this.conferirPedido(p.tenantId, String(parametros.pedidoId ?? ''), parametros.acao as AcaoDePedido, String(parametros.pedido ?? ''));
      if (depois.feita) return depois;
      return { feita: false, texto: TEXTOS_DAS_ACOES.recusado(motivo(err)) };
    } finally {
      await this.auditoria
        ?.registrar({ tenantId: p.tenantId, atorId: quem, atorPerfil: e.nivel, tipo: 'mister', acao: 'mister_acao', entidadeTipo: 'mister_proposta', entidadeId: p.id, origem: 'whatsapp', detalhe: { acao: p.procedimento } } as any)
        .catch(() => undefined);
    }
  }

  /** Os canais ficaram como a ação pediu? (a pausa que vale agora, da loja ou da empresa toda). */
  private async conferirCanais(tenantId: string, unidadeId: string | null, canais: CanalDaPausa[], pausados: boolean): Promise<{ feita: boolean; texto: string }> {
    const estado: { canal: CanalDaPausa; ate: Date | null }[] = [];
    for (const c of canais) {
      const v: any = await pausaVigenteDoCanal(this.db, tenantId, unidadeId, c);
      estado.push({ canal: c, ate: v?.ate ? new Date(v.ate) : null });
    }
    const certos = estado.filter((x) => (pausados ? !!x.ate : !x.ate));
    if (certos.length !== canais.length) {
      const faltam = estado.filter((x) => !certos.includes(x)).map((x) => x.canal);
      return { feita: false, texto: `${nomesDosCanais(faltam)} não ficou(aram) ${pausados ? 'pausado(s)' : 'aberto(s)'}. Confira no painel do Delivery.` };
    }
    if (!pausados) return { feita: true, texto: TEXTOS_DAS_ACOES.reaberto(nomesDosCanais(canais)) };
    const voltas = estado.map((x) => `${nomesDosCanais([x.canal])} até as ${horaNoFuso(x.ate!)}`).join('; ');
    return { feita: true, texto: `${TEXTOS_DAS_ACOES.pausado(nomesDosCanais(canais))} (${voltas}).` };
  }

  /** Lote 3: a tarefa nova está na lista de hoje? */
  private async conferirTarefaCriada(tenantId: string, defId: string, titulo: string): Promise<{ feita: boolean; texto: string }> {
    const [r] = linhas(
      await this.db.execute(sql`
        select 1 as ok from tarefa_instancia
         where tenant_id = ${tenantId}::uuid and tarefa_def_id = ${defId}::uuid and data = ${hojeISO()}::date and deleted_at is null`),
    );
    return r ? { feita: true, texto: TEXTOS_DAS_ACOES.tarefaCriada(titulo) } : { feita: false, texto: TEXTOS_DAS_ACOES.tarefaNaoCriada(titulo) };
  }

  /** Lote 2: a tarefa ficou na situação pedida? */
  private async conferirTarefa(tenantId: string, id: string, estado: string, titulo: string): Promise<{ feita: boolean; texto: string }> {
    const [r] = linhas(await this.db.execute(sql`select estado from tarefa_instancia where id = ${id}::uuid and tenant_id = ${tenantId}::uuid`));
    if (!r) return { feita: false, texto: 'a tarefa não foi encontrada. Nada foi feito.' };
    if (String(r.estado) === estado) return { feita: true, texto: TEXTOS_DAS_ACOES.tarefaFeita(titulo, nomeDoEstadoDaTarefa(estado)) };
    return { feita: false, texto: TEXTOS_DAS_ACOES.tarefaNaoFicou(titulo, nomeDoEstadoDaTarefa(String(r.estado))) };
  }

  /** Lote 2: o produto ficou pausado (ou no ar) em CADA canal pedido? */
  private async conferirProduto(tenantId: string, id: string, canais: CanalDoProduto[], pausado: boolean, nome: string): Promise<{ feita: boolean; texto: string }> {
    const [r] = linhas(
      await this.db.execute(sql`
        select coalesce(disponivel_balcao, true) as "disponivelBalcao", coalesce(disponivel_cardapio, true) as "disponivelCardapio",
               coalesce(canais_pausados, '[]'::jsonb) as "canaisPausados"
          from produto where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null`),
    );
    if (!r) return { feita: false, texto: 'o produto não foi encontrado. Nada foi feito.' };
    const certos = produtoFicou({ disponivelBalcao: r.disponivelBalcao === true, disponivelCardapio: r.disponivelCardapio === true, canaisPausados: Array.isArray(r.canaisPausados) ? r.canaisPausados : [] }, canais, pausado);
    if (certos.length === canais.length) return { feita: true, texto: TEXTOS_DAS_ACOES.produtoFeito(nome, pausado, ondeOProduto(canais)) };
    return { feita: false, texto: TEXTOS_DAS_ACOES.produtoNaoFicou(nome, ondeOProduto(canais.filter((c) => !certos.includes(c)))) };
  }

  /** O pedido andou para a situação de depois da ação? */
  private async conferirPedido(tenantId: string, pedidoId: string, acao: AcaoDePedido, pedido: string): Promise<{ feita: boolean; texto: string }> {
    const [r] = linhas(await this.db.execute(sql`select status from pedido_externo where id = ${pedidoId}::uuid and tenant_id = ${tenantId}::uuid`));
    if (!r) return { feita: false, texto: 'o pedido não foi encontrado. Nada foi feito.' };
    if (pedidoAndou(acao, String(r.status))) return { feita: true, texto: TEXTOS_DAS_ACOES.pedidoFeito(acao, pedido) };
    return { feita: false, texto: TEXTOS_DAS_ACOES.naoAndou(pedido, NOME_DA_SITUACAO[String(r.status)] ?? String(r.status)) };
  }
}
