import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { Permissoes, perfilPadrao, podeAcessar } from '../../auth/permissoes';
import { FUSO_OPERACAO, hojeISO, horaAgora, horaNoFuso, somarDias } from '../../common/data';
import { brutoPedido, comandaEhDeCanal, pedidoVale } from '../../common/faturamento';
import { sqlUnidade, sqlUnidadeOuRede } from '../../common/filtro-unidade';
import { lerEstacoes } from '../../common/fluxo-kds';
import { FUSO_SQL, noPeriodo } from '../../common/fuso-sql';
import { idadeDoTurno } from '../../common/turno';
import { DashboardService } from '../dashboard/dashboard.service';
import { CANAIS_DA_PAUSA, NOME_DO_CANAL } from '../../common/pausa-do-canal';
import { AtendimentoService } from '../atendimento/atendimento.service';
import { ConferenciaService } from '../conferencia/conferencia.service';
import { DeliveryService } from '../delivery/delivery.service';
import { PausaDoCanalService } from '../delivery/pausa-do-canal.service';
import { Food99Service } from '../integracoes/food99/food99.service';
import { WhatsappProvedorService } from '../whatsapp/whatsapp-provedor.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EscalaService } from '../escala/escala.service';
import { EstoqueService } from '../estoque/estoque.service';
import { LicencaService } from '../licenca/licenca.service';
import { IbptService } from '../fiscal/ibpt/ibpt.service';
import { hojeNaUf, statusIbpt } from '../fiscal/ibpt/ibpt-tabela';
import { ModuloService } from '../modulo/modulo.service';
import { PontoService } from '../ponto/ponto.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { RelatoriosService } from '../relatorios/relatorios.service';
import { VendasService } from '../vendas/vendas.service';
import { pessoaVale } from './mister-vinculo.service';
import {
  PedidoDoRelatorio,
  RelatorioDoInsumo,
  acharInsumo,
  comparacaoComAsSemanas,
  dadosDoRelatorio,
  deOndeSairam,
  emQuilos,
  seriePorDia,
  seriePorHora,
} from './insumo-vendido';
import { PlanoDoPdfDoInsumo, gerarPdfDoInsumo, nomeDoPdfDoInsumo, planoDoPdfDoInsumo } from './relatorio-insumo-pdf';
import { GraficoDaConversa, valeAImagem } from './grafico/grafico-do-insumo';
import { MisterNumeroService } from './mister-numero.service';
import { MisterDocumentosService } from './mister-documentos.service';
import { MisterLinkPublicoService } from './mister-link-publico.service';
import { TEXTOS_DO_LINK_PUBLICO, VALIDADE_DO_LINK_DIAS, diaMesDe } from './mister-link-publico';
import { MisterRecadosService } from './mister-recados.service';
import { MisterMemoriaService } from './mister-memoria.service';
import { MisterVigiaService } from './mister-vigia.service';
import { canalDito, referenciaDaImpressora, referenciaDoCaixa, referenciaDoCanal } from './mister-vigia';
import { TEXTOS_DO_RECADO, VALIDADE_DO_RECADO_MIN, botaoDoRecado, ondeVai, textoDoRecado } from './mister-recado';
import { ONDE_VER_O_GASTO, dentroDaJanelaDoWhatsapp, nomeDoMesDoGasto } from './mister-avisos.regras';
import { WhatsappGastoService } from '../whatsapp/whatsapp-gasto.service';
import { FRANQUIA_DO_ATENDIMENTO, FRASE_DO_ESTIMADO, LinhaSomada, mesesAntes, primeiroDoMes, projecaoDoMes, resumoDasLinhas, ultimoDoMes } from '../whatsapp/whatsapp-gasto';
import { ASSUNTOS_DO_LINK, AssuntoDoLink, TELA_DO_ASSUNTO, acharPessoa, enderecoDoApp, mensagemDoLink, resumoDaContagem } from './link-de-conferencia';
import { MisterPropostasService, PropostaPendente } from './mister-propostas.service';
import { PROCEDIMENTOS, propostaDoAviso } from './mister-procedimentos';
import {
  PROCEDIMENTOS_QUE_A_IA_PROPOE,
  CANAL_NA_TELA,
  ConversaDoMister,
  EtapaDoPedido,
  LimitesDoKds,
  PREPARO_DA_ENCOMENDA_MIN,
  atrasoNaCozinha,
  FERRAMENTA_DE_LEMBRAR,
  FERRAMENTA_DO_QUE_FALTA,
  NivelDoMister,
  NomeDaFerramenta,
  diaDaFerramenta,
  diaMes,
  ehFerramenta,
  lojaPedida,
  numeroDoPedido,
  ondeDemorou,
  pedidoComoNoQuadro,
  periodoAnterior,
  periodoDaFerramenta,
  semAcento,
  ASSUNTO_DO_CASO,
  SITUACAO_DO_CASO,
  situacaoDoCertificado,
  variacaoPct,
  CONVERSAS_ACHADAS_MAX,
  PERGUNTA_ACHADA_MAX,
  RESPOSTA_ACHADA_MAX,
  cortarTexto,
  diasDaBusca,
  ehConsulta,
  nomeDaConsulta,
  valoresEmReais,
  padraoDaPalavra,
  palavrasDaBusca,
  semValoresNoTexto,
} from './mister-agente.regras';
import { GUIA_DE_USO, SecaoDoGuia, buscarNoGuia, quemAbre } from './mister-guia-de-uso';
import { canceladoComVendaDePe, concluidoSemPagamento, pixSemEstorno, vendaComNotaComProblema, vendaDesfeitaComNota } from './mister-conciliacao';
import { primeiroNome } from './mister.regras';
import {
  ParteDoVencimento,
  ServidorLido,
  certificadoParaOMister,
  ibptParaOMister,
  instagramParaOMister,
  servidorParaOMister,
} from './mister-vencimentos';

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
/** Texto sem acento e em minúsculas, com os espaços apertados (para achar "a impressora da cozinha" por "Cozinha"). */
const semAcentoMin = (t: unknown) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** M4d: o ajuste da empresa desligado (nasce assim) — o caminho do menu da tela (V65). */
const VIGIA_DESLIGADO = 'O "fica de olho" e os lembretes estão desligados nesta empresa: o presidente liga em Mister › Jeito e memória.';

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
  /** F4.3: a proposta criada (ou ainda pendente) — NÃO vai ao modelo; o agente manda os botões depois da resposta. */
  proposta?: PropostaPendente;
  /**
   * M3c.2: o relatório que a resposta pode levar — NÃO vai ao modelo. `enviarPdf` (a pessoa pediu "em PDF"): o agente
   * manda o PDF depois da resposta; senão, o botão "PDF" no balão da resposta (só pela API oficial, que tem botão).
   */
  anexo?: { pedido: PedidoDoRelatorio; enviarPdf: boolean; grafico?: GraficoDaConversa };
  /** M3g: os botões que a resposta leva (o "Desfazer" da correção) — NÃO vão ao modelo; só pela API oficial. */
  botoes?: { id: string; titulo: string }[];
  /** M3d: a imagem da tela do "como faço" (o endereço público do PNG dos roteiros) — NÃO vai ao modelo; vai antes do texto. */
  imagens?: { url: string; legenda: string }[];
  /**
   * M3c (mig 443): o link para encaminhar a quem não tem usuário — NÃO vai ao modelo (o endereço leva o código que abre
   * o relatório sem login): o agente o escreve no fim da resposta.
   */
  linkPublico?: { url: string; vence: Date };
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

/** Os canais da pausa e o nome do canal no pedido (a 99 é `food99` na pausa e `99food` no pedido). */
const CANAL_DO_PEDIDO: Record<(typeof CANAIS_DA_PAUSA)[number], string> = { cardapio: 'cardapio', ifood: 'ifood', food99: '99food' };
/** No máximo estas lojas na resposta dos canais sem loja escolhida (uma leitura da pausa por loja). */
const MAX_LOJAS_NOS_CANAIS = 10;
const SITUACAO_DA_PAUSA_NO_APP = { pausando: 'ainda indo para o app', aplicada: 'pausado no app também', erro: 'o app não aceitou a pausa' } as const;
/** No máximo estes casos do Atendimento na resposta (as contagens são de todos). */
const CASOS_DO_ATENDIMENTO = 10;
/** A situação e o porquê de uma linha da conferência do cardápio, em português (os códigos são os da tela). */
const SITUACAO_DO_ESTORNO: Record<string, string> = {
  sem_pedido_de_estorno: 'o estorno ainda não foi pedido ao gateway',
  estorno_falhou: 'o estorno falhou (devolver à mão)',
  estorno_parado: 'o estorno está parado',
};
const SITUACAO_DA_NOTA: Record<string, string> = { rejeitada: 'recusada pela SEFAZ', denegada: 'denegada pela SEFAZ', pendente: 'sem resposta da SEFAZ' };
const SITUACAO_NA_CONFERENCIA: Record<string, string> = { soApp: 'só no app', soRegem: 'só no Regem', preco: 'preço diferente', naoLiga: 'não liga pelo código PDV' };
const MOTIVO_NA_CONFERENCIA: Record<string, string> = {
  semCodigo: 'sem código PDV no app',
  repetidoNoApp: 'código repetido no app',
  repetidoNoRegem: 'código repetido no Regem',
  semCodigoNoRegem: 'sem código no Regem',
  semPrecoNoRegem: 'sem o preço deste app no Regem',
  precoDiferente: 'preço diferente',
  precosDiferentesNosGrupos: 'preços diferentes entre os grupos do app',
};
/** O estado da conexão do Evolution, em português (o `open` é o conectado). */
const SITUACAO_DO_WHATSAPP: Record<string, string> = {
  close: 'O WhatsApp da loja está desconectado: é preciso ler o QR de novo.',
  connecting: 'O WhatsApp da loja está reconectando.',
  nao_criada: 'A loja ainda não ligou o WhatsApp.',
};

const SITUACAO_DO_DELIVERY: Record<string, string> = { novo: 'aguardando aceite', confirmado: 'em preparo', pronto: 'pronto', despachado: 'a caminho' };
const SITUACAO_DA_COZINHA: Record<string, string> = { recebido: 'na fila', preparo: 'em preparo', pronto: 'pronto' };
const SITUACAO_DO_PEDIDO: Record<string, string> = {
  novo: 'aguardando aceite',
  confirmado: 'em preparo',
  pronto: 'pronto',
  despachado: 'a caminho',
  entregue: 'entregue',
  concluido: 'concluído',
  cancelado: 'cancelado',
};
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
    // F3 (os canais e as integrações): opcionais — sem eles, o pedaço da resposta diz "não li" (os testes antigos não os montam).
    @Optional() private readonly pausa?: PausaDoCanalService,
    @Optional() private readonly food99?: Food99Service,
    @Optional() private readonly whatsapp?: WhatsappService,
    @Optional() private readonly whatsappProvedor?: WhatsappProvedorService,
    // F3, parte 2: a conferência do catálogo com os apps (a última leitura guardada).
    @Optional() private readonly conferencia?: ConferenciaService,
    // A fila do Atendimento (a mesma da tela).
    @Optional() private readonly atendimento?: AtendimentoService,
    // F3, vencimentos: a tabela do IBPT da loja (a mesma da Configuração fiscal).
    @Optional() private readonly ibpt?: IbptService,
    // F4.3: a proposta que nasce de uma pergunta (o mesmo serviço da F4.1). Sem ele, "não consigo propor agora".
    @Optional() private readonly propostas?: MisterPropostasService,
    // M3c.5: o link de conferência sai pelo número do Mister. Sem ele, "não consigo mandar agora".
    @Optional() private readonly numero?: MisterNumeroService,
    // M3g: corrigir o que o Mister lançou (o vencimento do boleto) é do serviço dos documentos.
    @Optional() private readonly documentos?: MisterDocumentosService,
    // M3c (mig 443): o link para encaminhar a quem não tem usuário. Sem ele (ou desligado), o Mister oferece o PDF.
    @Optional() private readonly linksPublicos?: MisterLinkPublicoService,
    // M3g parte 2 (mig 444): o rascunho do recado no mural (o "Publicar" é dele também).
    @Optional() private readonly recados?: MisterRecadosService,
    // Versão 4, M4b (mig 449): a memória do Mister (a ferramenta `lembrar`).
    @Optional() private readonly memoria?: MisterMemoriaService,
    // Versão 4, M4d (mig 452): o "fica de olho" e o lembrete.
    @Optional() private readonly vigia?: MisterVigiaService,
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
    return this.escopoDaPessoa(tenantId, colaboradorId, p);
  }

  /**
   * M3c.4: o MESMO escopo para quem abre a página do relatório no Regem (logado, sem telefone): a pessoa ativa, presidente
   * ou gerente, com o módulo ligado; as lojas, a loja presa e as permissões pela mesma régua da conversa.
   */
  async escopoDaTela(tenantId: string, colaboradorId: string): Promise<EscopoDoMister | null> {
    const [p] = linhas(
      await this.db.execute(sql`
        select c.nome, emp.nome as empresa, coalesce(p.nivel, f.categoria::text) as nivel, c.unidade_id as "unidadeId", p.permissoes
          from colaborador c
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = c.tenant_id
         where c.tenant_id = ${tenantId}::uuid and c.id = ${colaboradorId}::uuid and ${pessoaVale()}`),
    );
    return this.escopoDaPessoa(tenantId, colaboradorId, p);
  }

  private async escopoDaPessoa(tenantId: string, colaboradorId: string, p: any): Promise<EscopoDoMister | null> {
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
    // O guia de uso não lê dado de loja nenhuma: responde também a quem ainda está sem loja.
    if (nome === 'como_usar_o_regem') return this.comoUsarORegem(e, entrada);
    // A anotação do que falta (F5.2) também não lê dado: o tema fica na trilha da pergunta (quem grava é o agente).
    if (nome === FERRAMENTA_DO_QUE_FALTA) return { ok: true, dados: { anotado: true, siga: 'Responda agora: diga que você ainda não tem acesso a essa informação e, em uma frase, o que você consegue responder hoje.' } };
    // Versão 4: as conversas anteriores são da própria pessoa, não de uma loja — respondem também a quem está sem loja.
    if (nome === 'conversas_anteriores') return this.conversasAnteriores(e, entrada);
    // Versão 4, M4b: a memória também não depende de loja.
    if (nome === FERRAMENTA_DE_LEMBRAR) return this.lembrar(e, entrada);
    // Versão 4, M4d: o lembrete é da pessoa, não de uma loja.
    if (nome === 'lembrete') return this.lembrete(e, entrada);
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
      case 'historia_do_pedido':
        return this.historiaDoPedido(e, en, loja);
      case 'tempos_dos_pedidos':
        return this.temposDosPedidos(e, en, loja);
      case 'canais_e_integracoes':
        return this.canaisEIntegracoes(e, loja);
      case 'conferencia_do_catalogo':
        return this.conferenciaDoCatalogo(e, loja);
      case 'atendimento_agora':
        return this.atendimentoAgora(e, loja);
      case 'vencimentos_e_versoes':
        return this.vencimentosEVersoes(e, loja);
      case 'conciliacao_do_periodo':
        return this.conciliacao(e, en, loja);
      case 'como_usar_o_regem':
        return this.comoUsarORegem(e, en);
      case 'conversas_anteriores':
        return this.conversasAnteriores(e, en);
      case 'anotar_o_que_falta':
        return this.executar(e, nome, en);
      case 'propor_procedimento':
        return this.proporProcedimento(e, en, loja);
      case 'insumo_vendido':
        return this.insumoVendido(e, en, loja);
      case 'mandar_link':
        return this.mandarLink(e, en, loja);
      case 'corrigir_documento':
        return this.corrigirDocumento(e, en);
      case 'link_para_encaminhar':
        return this.linkParaEncaminhar(e, en, loja);
      case 'cancelar_links':
        return this.cancelarLinks(e);
      case 'escrever_recado':
        return this.escreverRecado(e, en, loja);
      case 'gasto_do_whatsapp':
        return this.gastoDoWhatsapp(e);
      case 'lembrar':
        return this.lembrar(e, en);
      case 'ficar_de_olho':
        return this.ficarDeOlho(e, en, loja);
      case 'lembrete':
        return this.lembrete(e, en);
    }
  }

  /**
   * "Quanto gastei de WhatsApp?" (G3 do protótipo `mockups/regem-whatsapp-gasto.html`, conversa 4): o gasto do mês na Meta,
   * do que a nuvem guardou lendo a Meta (mig 445) — os mesmos números de WhatsApp › Uso e gasto. Só o presidente (decisão 2:
   * é o dinheiro da empresa). Banco sem a 445: "não li".
   */
  private async gastoDoWhatsapp(e: EscopoDoMister): Promise<ResultadoDaFerramenta> {
    if (e.nivel !== 'presidente') return recusa('O gasto do WhatsApp oficial é do presidente: só ele vê.');
    const agora = new Date();
    const hoje = hojeISO();
    try {
      // Quem tem leitura do gasto usa a API oficial (a nuvem só lê as contas oficiais). Sem nenhuma leitura: a conexão por
      // QR Code, ou a primeira leitura que ainda não aconteceu (os números da API oficial dizem qual).
      const [lei] = linhas(
        await this.db.execute(sql`
          select count(*)::int as contas, to_char(max(lido_em) at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as lido, max(moeda) as moeda,
                 bool_or(fonte_do_custo = 'tabela') as estimado, max(erro) as erro
            from whatsapp_gasto_leitura where tenant_id = ${e.tenantId}::uuid`),
      );
      if (!Number(lei?.contas)) {
        let oficial = false;
        try {
          oficial = linhas(await this.db.execute(sql`select 1 as tem from (${WhatsappGastoService.sqlContas(e.tenantId)}) x limit 1`)).length > 0;
        } catch (err: any) {
          if (!semTabela(err)) throw err;
        }
        return oficial
          ? { ok: true, dados: { oficial: true, lido: false, explica: 'A primeira leitura do gasto na Meta ainda não aconteceu: o Regem lê a cada 30 minutos.' } }
          : { ok: true, dados: { oficial: false, explica: 'A loja usa a conexão por QR Code: a Meta não cobra por mensagem, então não há gasto para mostrar.' } };
      }
      if (!lei.lido)
        return { ok: true, dados: { oficial: true, lido: false, explica: 'A leitura do gasto na Meta ainda não deu certo: o Regem tenta de novo a cada 30 minutos.' } };
      const doMes = linhas(
        await this.db.execute(sql`
          select numero, ${hoje}::text as dia, categoria, tipo, sum(mensagens)::int as mensagens, sum(custo)::float8 as custo
            from whatsapp_gasto
           where tenant_id = ${e.tenantId}::uuid and dia >= ${primeiroDoMes(hoje)}::date and dia <= ${hoje}::date
           group by 1, 3, 4`),
      ) as LinhaSomada[];
      // O mesmo dia do mês passado (o dia 31 vira o último dia de um mês mais curto).
      const anterior = mesesAntes(hoje, 1);
      const mesmoDia = [somarDias(anterior, Number(hoje.slice(8, 10)) - 1), ultimoDoMes(anterior)].sort()[0];
      const [passado] = linhas(
        await this.db.execute(sql`
          select coalesce(sum(custo), 0)::float8 as custo from whatsapp_gasto
           where tenant_id = ${e.tenantId}::uuid and dia >= ${anterior}::date and dia <= ${mesmoDia}::date`),
      );
      const r = resumoDasLinhas(doMes, { tipo: 'mes', de: primeiroDoMes(hoje), ate: hoje, mesCorrente: true });
      // Valor em NÚMERO, não em texto: o filtro de saída só reconhece como origem o valor em número (as outras consultas
      // devolvem assim, e o modelo escreve o "R$"). Texto pronto marcava "valor sem origem" em toda resposta do gasto.
      const reais = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
      const NOME: Record<string, string> = { marketing: 'marketing', utilidade: 'avisos do pedido (utilidade)', atendimento: 'atendimento', autenticacao: 'autenticação', outros: 'outros' };
      const porNumero = new Map<string, number>();
      for (const l of doMes) if (l.categoria === 'SERVICE') porNumero.set(String(l.numero).slice(-4), (porNumero.get(String(l.numero).slice(-4)) ?? 0) + (Number(l.mensagens) || 0));
      const projecao = projecaoDoMes(r.total.custo, agora);
      return {
        ok: true,
        dados: {
          oficial: true,
          mes: `${nomeDoMesDoGasto(hoje.slice(0, 7))} de ${hoje.slice(0, 4)}`,
          moeda: lei.moeda ?? 'BRL',
          ateAgora: reais(r.total.custo),
          lidoAs: String(lei.lido),
          mensagensEntregues: r.total.mensagens,
          mensagensCobradas: r.total.cobradas,
          porTipo: r.tipos.filter((t) => t.mensagens > 0).map((t) => ({ tipo: NOME[t.grupo], gasto: reais(t.custo), mensagens: t.mensagens, gratis: t.gratis })),
          atendimentoGratis: [...porNumero].map(([final, usadas]) => ({ numeroFinal: final, usadas, de: FRANQUIA_DO_ATENDIMENTO, acabou: usadas >= FRANQUIA_DO_ATENDIMENTO })),
          projecaoDoMes: projecao !== null ? reais(Math.round(projecao)) : null,
          ateOMesmoDiaDoMesPassado: reais(Number(passado?.custo) || 0),
          onde: ONDE_VER_O_GASTO,
          aviso: lei.estimado ? FRASE_DO_ESTIMADO : 'Valores aproximados que a Meta informa; a fatura oficial é a da Meta.',
        },
      };
    } catch (err: any) {
      if (semTabela(err)) return recusa('Não consegui ler este dado agora.');
      throw err;
    }
  }

  /**
   * Versão 4, M4b — a memória pela conversa (a ferramenta `lembrar`; o padrão do Hermes). "sobre" mim = a pessoa da conversa
   * (o servidor decide quem é, nunca o modelo); empresa = vale para todos. Trocar e esquecer acham a anotação pelo trecho.
   * A conferência do texto, o limite e a permissão são do serviço (a mesma régua da tela). Nunca lança.
   */
  private async lembrar(e: EscopoDoMister, entrada: unknown): Promise<ResultadoDaFerramenta> {
    if (!this.memoria) return recusa('A memória do Mister ainda não está disponível.');
    const en = (entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>;
    const acao = en.acao;
    if (acao !== 'anotar' && acao !== 'trocar' && acao !== 'esquecer') return recusa('Diga se é para anotar, trocar ou esquecer.');
    if (en.sobre !== 'mim' && en.sobre !== 'empresa') return recusa('Diga se a anotação é sobre a pessoa ("mim") ou sobre a empresa.');
    const sobre = en.sobre === 'mim' ? e.colaboradorId : null;
    const quem = { tenantId: e.tenantId, colaboradorId: e.colaboradorId, presidente: e.nivel === 'presidente', origem: 'conversa' as const };
    try {
      const r =
        acao === 'anotar'
          ? await this.memoria.anotar(quem, sobre, en.texto)
          : acao === 'trocar'
            ? await this.memoria.trocar(quem, { sobre, trecho: en.trecho }, en.texto)
            : await this.memoria.esquecer(quem, { sobre, trecho: en.trecho });
      if (!r.ok) return recusa(r.anotadas?.length ? `${r.erro} O que está anotado: ${r.anotadas.map((t) => `"${t}"`).join('; ')}.` : r.erro);
      const feito = acao === 'anotar' ? 'anotado' : acao === 'trocar' ? 'trocado' : 'esquecido';
      return {
        ok: true,
        dados: {
          [feito]: true,
          texto: r.item.texto,
          sobre: sobre ? 'esta pessoa' : 'a empresa',
          uso: r.uso,
          siga: acao === 'esquecer' ? 'Diga em uma frase o que esqueceu ("Esqueci ✅ …").' : 'Diga em uma frase o que ficou anotado ("Anotado ✅ …").',
        },
      };
    } catch (err: any) {
      this.logger.error(`ferramenta lembrar falhou: ${String(err?.message ?? err).slice(0, 300)}`, err?.stack);
      return recusa('Não consegui mexer na memória agora.');
    }
  }

  /**
   * Versão 4, M4d — "fica de olho" num pedido dos canais (mig 452). Acha o pedido como a história do pedido acha (o
   * número do canal ou do dia, 3 dias, a loja da pessoa) e com a mesma permissão (Delivery); quem olha a cada minuto e
   * fala quando muda é o `MisterVigiaService`. "mim" é sempre a pessoa da conversa (o servidor decide).
   */
  private async ficarDeOlho(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (!this.vigia) return recusa('O "fica de olho" ainda não está disponível.');
    const q = { tenantId: e.tenantId, colaboradorId: e.colaboradorId };
    if (!(await this.vigia.ligado(e.tenantId))) return recusa(VIGIA_DESLIGADO);
    if (en.acao === 'listar') {
      const marcados = await this.vigia.listar(q, 'olho');
      return { ok: true, dados: { marcados, ...(marcados.length ? {} : { observacao: 'Nenhum "fica de olho" ativo.' }) } };
    }
    if (en.acao === 'parar') {
      const r = await this.vigia.cancelar(q, 'olho', en.trecho);
      return r.ok ? { ok: true, dados: { parou: true, pedido: r.rotulo, siga: 'Diga em uma frase que parou de olhar.' } } : recusa(r.erro);
    }
    if (en.acao !== 'comecar') return recusa('Diga se é para começar, parar ou listar.');
    // M4d parte 2: o caixa, a impressora e o canal (cada um com a permissão da consulta onde o dado aparece).
    if (en.alvo === 'caixa') return this.olharCaixa(e, en, loja);
    if (en.alvo === 'impressora') return this.olharImpressora(e, en, loja);
    if (en.alvo === 'canal') return this.olharCanal(e, en, loja);
    if (en.alvo !== undefined && en.alvo !== 'pedido') return recusa('Diga o que olhar: um pedido, um caixa, uma impressora ou um canal.');
    if (!this.pode(e, 'delivery')) return recusa(SEM_PERMISSAO);
    const n = numeroDoPedido(en.numero);
    if (!n) return recusa('Diga o número do pedido (o do canal ou o número do dia).');
    const soNumero = n.replace(/^[A-Z]/, '');
    const achados = linhas(
      await this.db.execute(sql`
        select pe.id::text as id, pe.canal, pe.display_id as "displayId", pe.numero, pe.status, pe.criado_em as "criadoEm"
          from pedido_externo pe
         where pe.tenant_id = ${e.tenantId}::uuid and pe.deleted_at is null ${sqlUnidadeOuRede('pe.unidade_id', loja.atual)}
           and pe.criado_em > now() - interval '3 days'
           and (upper(pe.display_id) = ${n} or pe.display_id = ${soNumero} or pe.numero::text = ${soNumero})
         order by pe.criado_em desc
         limit 6`),
    );
    if (!achados.length) return recusa(`Não achei pedido dos canais com o número ${n} nos últimos 3 dias em ${loja.nome}.`);
    if (achados.length > 1)
      return {
        ok: true,
        dados: {
          maisDeUmPedido: achados.map((p) => ({ comoAparece: pedidoComoNoQuadro(p), chegou: dataHoraCurta(p.criadoEm), situacao: SITUACAO_DO_PEDIDO[String(p.status)] ?? String(p.status) })),
          observacao: 'Pergunte qual deles, pelo horário em que chegou.',
        },
      };
    const pe = achados[0];
    const r = await this.vigia.olharPedido(q, { id: String(pe.id), rotulo: pedidoComoNoQuadro(pe), status: String(pe.status) });
    if (!r.ok) return recusa(r.erro);
    return {
      ok: true,
      dados: {
        combinado: true,
        pedido: r.rotulo,
        situacaoAgora: SITUACAO_DO_PEDIDO[String(pe.status)] ?? String(pe.status),
        ate: 'as 06:00',
        ...(r.jaEstava ? { observacao: 'Já estava de olho neste pedido.' } : {}),
        siga: 'Diga em uma frase que vai ficar de olho no pedido e avisar quando ele mudar.',
      },
    };
  }

  /** O que o "fica de olho" devolve ao modelo depois de marcar (o caixa, a impressora, o canal). */
  private combinado(r: { ok: true; rotulo: string; jaEstava?: true }, quando: string): ResultadoDaFerramenta {
    return {
      ok: true,
      dados: {
        combinado: true,
        oQue: r.rotulo,
        avisaQuando: quando,
        ate: 'as 06:00',
        ...(r.jaEstava ? { observacao: 'Já estava de olho nisso.' } : {}),
        siga: `Diga em uma frase que vai ficar de olho e avisar quando ${quando}.`,
      },
    };
  }

  /** M4d parte 2: o caixa aberto da loja (a permissão do relatório de turnos, como em caixas_e_sangrias), até fechar. */
  private async olharCaixa(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (!this.pode(e, 'relatorios_vendas')) return recusa(SEM_PERMISSAO);
    const qual = semAcentoMin(en.qual);
    const origem = /deliv|entreg/.test(qual) ? 'delivery' : /balc|pdv|loja|salao/.test(qual) ? 'pdv' : null;
    const abertos = linhas(
      await this.db.execute(sql`
        select s.id::text as id, s.origem, col.nome as "abertoPor", to_char(s.aberta_em at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as desde
          from caixa_sessao s
          left join colaborador col on col.id = s.aberta_por_id and col.tenant_id = s.tenant_id
         where s.tenant_id = ${e.tenantId}::uuid and s.status = 'aberta' ${sqlUnidade('s.unidade_id', loja.atual)}
           ${origem ? sql`and s.origem = ${origem}` : sql``}
         order by s.aberta_em
         limit 6`),
    );
    const nome = (c: any) => `caixa ${c.origem === 'delivery' ? 'do delivery' : 'do balcão'}${c.abertoPor ? ` (aberto por ${primeiroNome(String(c.abertoPor))})` : ''}`;
    if (!abertos.length) return recusa(`Nenhum caixa ${origem === 'delivery' ? 'do delivery ' : origem === 'pdv' ? 'do balcão ' : ''}aberto agora em ${loja.nome}: não há o que olhar.`);
    if (abertos.length > 1) return { ok: true, dados: { maisDeUmCaixa: abertos.map((c) => ({ caixa: nome(c), abertoDesde: String(c.desde) })), observacao: 'Pergunte qual deles.' } };
    const r = await this.vigia!.olhar({ tenantId: e.tenantId, colaboradorId: e.colaboradorId }, { alvo: 'caixa', referencia: referenciaDoCaixa(String(abertos[0].id)), rotulo: nome(abertos[0]), estado: 'aberta' });
    return r.ok ? this.combinado(r, 'ele fechar') : recusa(r.erro);
  }

  /** M4d parte 2: a impressora parada da loja (o incidente do vigia que a loja vê), até voltar a responder. */
  private async olharImpressora(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    const daLoja = loja.atual ? sql`and (i.unidade_id = ${loja.atual}::uuid or i.unidade_id is null)` : sql``;
    let paradas = linhas(
      await this.db.execute(sql`
        select i.id::text as id, coalesce(i.evidencia ->> 'impressora', '') as nome, to_char(i.primeira_em at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as desde
          from vigia_incidente i
         where i.tenant_id = ${e.tenantId}::uuid and i.situacao = 'aberto' and i.regra = 'impressora_parada' and i.publico in ('loja', 'ambos') ${daLoja}
         order by i.primeira_em
         limit 10`),
    );
    const qual = semAcentoMin(en.qual).replace(/^impressora( da| do)?\s*/, '').trim();
    if (qual) paradas = paradas.filter((p) => semAcentoMin(p.nome).includes(qual) || qual.includes(semAcentoMin(p.nome)));
    if (!paradas.length) return recusa(`Nenhuma impressora${qual ? ` "${String(en.qual ?? '').trim()}"` : ''} parada agora em ${loja.nome}: não há o que olhar.`);
    if (paradas.length > 1) return { ok: true, dados: { maisDeUmaImpressora: paradas.map((p) => ({ impressora: p.nome || 'sem nome', paradaDesde: String(p.desde) })), observacao: 'Pergunte qual delas.' } };
    const p = paradas[0];
    const r = await this.vigia!.olhar({ tenantId: e.tenantId, colaboradorId: e.colaboradorId }, { alvo: 'impressora', referencia: referenciaDaImpressora(String(p.id)), rotulo: `impressora ${p.nome || 'parada'}`.trim(), estado: 'aberto' });
    return r.ok ? this.combinado(r, 'ela voltar a responder') : recusa(r.erro);
  }

  /** M4d parte 2: o canal pausado da loja, pela MESMA regra do "Pausar" do Delivery, até reabrir. */
  private async olharCanal(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (!this.pode(e, 'delivery')) return recusa(SEM_PERMISSAO);
    const canal = canalDito(en.qual);
    if (!canal) return recusa('Diga qual canal: iFood, 99 ou cardápio.');
    if (!this.pausa) return recusa('Não consigo ler a pausa dos canais agora.');
    const estado: any = await this.pausa.estado(e.tenantId, loja.atual);
    const nome = NOME_DO_CANAL[canal as keyof typeof NOME_DO_CANAL] ?? canal;
    if (!estado?.canais?.find((c: any) => c.canal === canal)?.pausa) return recusa(`O ${nome} não está pausado agora em ${loja.nome}: não há o que olhar.`);
    const r = await this.vigia!.olhar({ tenantId: e.tenantId, colaboradorId: e.colaboradorId }, { alvo: 'canal', referencia: referenciaDoCanal(canal, loja.atual), rotulo: nome, estado: 'pausado' });
    return r.ok ? this.combinado(r, 'ele reabrir') : recusa(r.erro);
  }

  /** Versão 4, M4d — o lembrete na hora marcada (mig 452). O "quando" vem na hora da loja; o serviço confere. */
  private async lembrete(e: EscopoDoMister, entrada: unknown): Promise<ResultadoDaFerramenta> {
    if (!this.vigia) return recusa('O lembrete ainda não está disponível.');
    const en = (entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>;
    const q = { tenantId: e.tenantId, colaboradorId: e.colaboradorId };
    try {
      if (!(await this.vigia.ligado(e.tenantId))) return recusa(VIGIA_DESLIGADO);
      if (en.acao === 'listar') {
        const marcados = await this.vigia.listar(q, 'lembrete');
        return { ok: true, dados: { marcados, ...(marcados.length ? {} : { observacao: 'Nenhum lembrete marcado.' }) } };
      }
      if (en.acao === 'cancelar') {
        const r = await this.vigia.cancelar(q, 'lembrete', en.trecho);
        return r.ok ? { ok: true, dados: { cancelado: true, lembrete: r.rotulo, siga: 'Diga em uma frase que cancelou.' } } : recusa(r.erro);
      }
      if (en.acao !== 'criar') return recusa('Diga se é para criar, listar ou cancelar.');
      const r = await this.vigia.lembrar(q, en.texto, en.quando);
      if (!r.ok) return recusa(r.erro);
      return { ok: true, dados: { marcado: true, lembrete: r.texto, quando: r.quando, siga: `Repita em uma frase o dia e a hora ("Combinado: ${r.quando}").` } };
    } catch (err: any) {
      this.logger.error(`ferramenta lembrete falhou: ${String(err?.message ?? err).slice(0, 300)}`, err?.stack);
      return recusa('Não consegui marcar o lembrete agora.');
    }
  }

  /**
   * M3g parte 2 (mig 444) — o recado no mural (conversa 22): o Mister escreve e PERGUNTA antes; quem publica é a pessoa,
   * pelo botão "Publicar" da resposta (só a API oficial tem botão). Presidente e gerente, com o Mural & clima no perfil;
   * o gerente, na loja dele. A loja do mural: a da conversa; na empresa de uma loja, ela; sem loja, todas as lojas.
   */
  private async escreverRecado(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (e.nivel !== 'presidente' && e.nivel !== 'gerente') return recusa(TEXTOS_DO_RECADO.soGestor);
    if (!this.pode(e, 'mural')) return recusa(TEXTOS_DO_RECADO.semPermissao);
    if (!this.recados) return recusa(TEXTOS_DO_RECADO.naoDa);
    if (this.numero && (await this.numero.ler()).provedor === 'evolution') return recusa(TEXTOS_DO_RECADO.semBotao);
    const t = textoDoRecado(en.texto);
    if ('erro' in t) return recusa(t.erro);
    const unidadeId = e.lojaUnica ? (e.lojas[0]?.id ?? null) : loja.atual;
    const lojaNome = unidadeId ? loja.nome : 'todas as lojas';
    const r = await this.recados.criar(e, { unidadeId, lojaNome, texto: t.texto });
    if ('erro' in r) return recusa(r.erro);
    return {
      ok: true,
      dados: {
        comoFicou: t.texto,
        ondeVai: `Mural & clima ${ondeVai(lojaNome)}`,
        siga: `Mostre o texto de "comoFicou" entre aspas, exatamente como veio, e pergunte se publica no Mural & clima ${ondeVai(lojaNome)}. Os botões "Publicar" e "Mudar o texto" vão junto da sua resposta, pelo Regem, e valem ${VALIDADE_DO_RECADO_MIN} minutos. Não diga que publicou.`,
      },
      botoes: [botaoDoRecado('pub', r.id), botaoDoRecado('mudar', r.id)],
    };
  }

  /**
   * M3c (mig 443) — o link para encaminhar a quem NÃO tem usuário (decisão 7 da versão 3 do protótipo): só o presidente,
   * só quando ele pede. O relatório é lido no escopo dele, pela MESMA leitura da consulta, e vira uma FOTO (o plano do
   * PDF) que abre sem login por 7 dias. O endereço não volta ao modelo: o agente o escreve no fim da resposta.
   */
  private async linkParaEncaminhar(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (e.nivel !== 'presidente') return recusa(TEXTOS_DO_LINK_PUBLICO.soPresidente);
    if (!this.linksPublicos?.ligado()) return recusa(TEXTOS_DO_LINK_PUBLICO.desligado);
    const lido = await this.relatorioDaConversa(e, en, loja);
    if ('parou' in lido) return lido.parou;
    if (lido.r.total <= 0) return recusa(TEXTOS_DO_LINK_PUBLICO.semVenda);
    const plano = planoDoPdfDoInsumo(lido.r, { empresa: e.empresa, pedidoPor: e.nome, geradoEm: new Date().toISOString() });
    const criado = await this.linksPublicos.criar(e, { unidadeId: loja.atual, titulo: plano.titulo, nomeDoPdf: nomeDoPdfDoInsumo(lido.r, lido.p.de, lido.p.ate), plano });
    if ('erro' in criado) return recusa(criado.erro);
    return {
      ok: true,
      dados: {
        relatorio: plano.titulo,
        loja: lido.r.loja,
        valeAte: diaMesDe(criado.vence),
        siga: `O link vai sozinho no fim da sua resposta, pelo Regem: não escreva link. Diga em poucas linhas de que é o relatório, que o link é só para ler, que vale ${VALIDADE_DO_LINK_DIAS} dias (até a data de "valeAte"), que quem tiver o link vê o relatório como está agora (ele não atualiza) e que dá para cancelar pedindo a você.`,
      },
      linkPublico: criado,
    };
  }

  /** M3c (mig 443) — o presidente cancela os links para encaminhar que ainda valem na empresa. */
  private async cancelarLinks(e: EscopoDoMister): Promise<ResultadoDaFerramenta> {
    if (e.nivel !== 'presidente') return recusa(TEXTOS_DO_LINK_PUBLICO.soPresidente);
    if (!this.linksPublicos) return recusa('Não consigo cancelar agora.');
    const cancelados = await this.linksPublicos.cancelarTodos(e);
    return { ok: true, dados: { cancelados, siga: cancelados ? 'Diga quantos links foram cancelados e que eles já não abrem.' : 'Diga que não havia link para encaminhar valendo nesta empresa.' } };
  }

  /**
   * Versão 4 — as conversas anteriores (o padrão do Hermes de procurar nas conversas antigas): a pergunta e a resposta
   * desta pessoa, NESTA empresa, dos últimos 30 dias (o texto que `mister_pergunta` guarda), pelas palavras do assunto —
   * as que acertam mais palavras primeiro e, empatadas, as mais novas. Nunca a conversa de outra pessoa nem a de outra
   * empresa (a trava é o escopo do servidor, não o modelo). Quem não vê valores hoje recebe o texto sem os valores em reais.
   * Os valores ditos naquela resposta voltam em `valoresDitos` (o filtro de saída não acusa de "sem origem" a lembrança).
   */
  private async conversasAnteriores(e: EscopoDoMister, entrada: unknown): Promise<ResultadoDaFerramenta> {
    const en = (entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>;
    const palavras = palavrasDaBusca(en.busca);
    const dias = diasDaBusca(en.dias);
    if (!palavras.length) return recusa('Diga as palavras do assunto (por exemplo: iFood, caixa, carne).');
    try {
      const acertos = sql.join(
        palavras.map((p) => sql`(case when coalesce(pergunta, '') ilike ${padraoDaPalavra(p)} or coalesce(resposta, '') ilike ${padraoDaPalavra(p)} then 1 else 0 end)`),
        sql` + `,
      );
      const achadas = linhas(
        await this.db.execute(sql`
          select criado_em as "criadoEm", pergunta, resposta, ferramentas
            from (select criado_em, pergunta, resposta, ferramentas, ${acertos} as acertos
                    from mister_pergunta
                   where tenant_id = ${e.tenantId}::uuid and colaborador_id = ${e.colaboradorId}::uuid
                     and situacao = 'respondida' and resposta is not null
                     and criado_em > now() - make_interval(days => ${dias})) c
           where acertos > 0
           order by acertos desc, criado_em desc
           limit ${CONVERSAS_ACHADAS_MAX}`),
      );
      const conversas = achadas.map((l) => {
        const quando = new Date(l.criadoEm);
        const consultas = [...new Set((Array.isArray(l.ferramentas) ? l.ferramentas : []).filter((f: any) => f?.ok && ehConsulta(f?.nome)).map((f: any) => nomeDaConsulta(f.nome)))];
        const resposta = cortarTexto(l.resposta, RESPOSTA_ACHADA_MAX);
        const valores = e.verValores ? valoresEmReais(resposta).map((c) => c / 100) : [];
        return {
          quando: `${diaMesDe(quando)} às ${horaNoFuso(quando)}`,
          pergunta: cortarTexto(l.pergunta, PERGUNTA_ACHADA_MAX),
          resposta: e.verValores ? resposta : semValoresNoTexto(resposta),
          ...(consultas.length ? { consultasNaquelaHora: consultas } : {}),
          ...(valores.length ? { valoresDitos: valores } : {}),
        };
      });
      return {
        ok: true,
        dados: {
          busca: palavras.join(' '),
          dias,
          achadas: conversas.length,
          conversas,
          comoUsar: conversas.length
            ? 'É o que foi dito naquele dia. Diga o dia; para o número de agora, consulte de novo.'
            : `Nada com essas palavras nos últimos ${dias} dias. Diga isso à pessoa; não invente lembrança.`,
        },
      };
    } catch (err: any) {
      // V11: o motivo fica no log deste servidor; para o modelo vai só "não li".
      this.logger.error(`ferramenta conversas_anteriores falhou: ${String(err?.message ?? err).slice(0, 300)}`, err?.stack);
      return recusa('Não consegui ler as conversas anteriores agora.');
    }
  }

  /** M3g — corrigir o vencimento do boleto que o Mister lançou (conversa 22). O "Desfazer" vai como botão na resposta. */
  private async corrigirDocumento(e: EscopoDoMister, en: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    if (!this.documentos) return recusa('Não consigo corrigir agora.');
    const r = await this.documentos.corrigirVencimento(e, en.boleto, en.vencimento);
    if ('erro' in r) return recusa(r.erro);
    return { ok: true, dados: r.dados, ...(r.botoes.length ? { botoes: r.botoes } : {}) };
  }

  /**
   * M3c.5 — o link de conferência (conversa 18): o presidente pede, e o Mister manda a outra pessoa da empresa, ligada a
   * ele, o resumo e o botão "Abrir no Regem" (abre com o usuário dela). Só o presidente; só a quem ligou o WhatsApp ao
   * Mister, não pausou as mensagens e pode ver a tela; a loja é a de quem recebe (a presa) ou a da conversa. Fora da janela
   * de 24 horas da Meta não há mensagem livre: o Mister diz isso ao presidente (nenhum modelo novo).
   */
  private async mandarLink(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (e.nivel !== 'presidente') return recusa('Só o presidente manda link de conferência pelo Mister.');
    if (!this.numero) return recusa('Não consigo mandar agora.');
    const assunto = String(en.assunto ?? '') as AssuntoDoLink;
    if (!(ASSUNTOS_DO_LINK as readonly string[]).includes(assunto)) return recusa('Esse link não está no catálogo. Hoje dá para mandar: a contagem de estoque de hoje.');
    const ligados = linhas(
      await this.db.execute(sql`
        select g.colaborador_id::text as "colaboradorId", g.telefone, g.ultima_entrada_em as "ultimaEntrada", g.pausado_em as "pausadoEm", c.nome
          from mister_vinculo g
          join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = g.tenant_id
         where g.tenant_id = ${e.tenantId}::uuid and g.ligado_em is not null and g.telefone is not null
           and g.colaborador_id <> ${e.colaboradorId}::uuid and ${pessoaVale()}
         order by c.nome`),
    );
    const achado = acharPessoa(en.para, ligados);
    if (achado.tipo === 'nenhum')
      return recusa(
        ligados.length
          ? `Não achei essa pessoa entre quem ligou o WhatsApp ao Mister nesta empresa: ${ligados.map((l) => primeiroNome(String(l.nome))).join(', ')}.`
          : 'Ninguém mais desta empresa ligou o WhatsApp ao Mister. Cada um liga o seu em Mister › Pessoas.',
      );
    if (achado.tipo === 'escolher') return { ok: true, dados: { precisaEscolher: achado.opcoes, siga: 'Pergunte para qual destas pessoas, com os nomes como vieram.' } };
    const alvo = achado.pessoa;
    const nome = primeiroNome(String(alvo.nome));
    if (alvo.pausadoEm) return recusa(`${nome} pausou as mensagens do Mister (respondeu PARAR AVISOS). Peça a ${nome} para reativar em Mister › Pessoas.`);
    const deles = await this.escopo(e.tenantId, alvo.colaboradorId, alvo.telefone);
    if (!deles || deles.semLoja) return recusa(`${nome} não tem mais acesso ao Mister.`);
    const tela = TELA_DO_ASSUNTO[assunto];
    if (!this.pode(deles, tela.permissao)) return recusa(`O perfil de ${nome} no Regem não abre ${tela.onde}.`);
    // A loja do link: a de quem recebe, quando ela é presa a uma loja; senão, a da conversa.
    const lojaDoLink = deles.presa ? { atual: deles.presa, nome: deles.lojas[0]?.nome ?? loja.nome } : loja;
    const hoje = hojeISO();
    const [c] = linhas(
      await this.db.execute(sql`
        select count(ci.*)::int as itens,
               (count(*) filter (where ci.contado is not null))::int as contados,
               (count(*) filter (where ci.contado is not null and ci.contado <> ci.saldo_sistema))::int as "comDiferenca"
          from contagem_execucao x
          join contagem_lista l on l.id = x.lista_id and l.tenant_id = x.tenant_id
          join contagem_item ci on ci.execucao_id = x.id
         where x.tenant_id = ${e.tenantId}::uuid and x.data = ${hoje}::date ${sqlUnidade('l.unidade_id', lojaDoLink.atual)}`),
    );
    const naLoja = lojaDoLink.nome === 'todas as lojas' ? 'em nenhuma loja' : `na ${lojaDoLink.nome}`;
    if (!c || !Number(c.itens)) return recusa(`Ainda não tem contagem de estoque de hoje ${naLoja}. O link vai quando a contagem começar.`);
    const resumo = resumoDaContagem({ itens: Number(c.itens), contados: Number(c.contados), comDiferenca: Number(c.comDiferenca) });
    // Fora da janela de 24 horas da Meta só sai modelo aprovado: o Mister não manda e diz por quê.
    if (!(await this.numero.semJanela()) && !dentroDaJanelaDoWhatsapp(alvo.ultimaEntrada ? new Date(alvo.ultimaEntrada) : null, Date.now()))
      return recusa(
        `${nome} não escreve ao Mister há mais de 24 horas, e o WhatsApp só deixa o Mister mandar mensagem livre depois que a pessoa escreve. Peça a ${nome} para mandar um "oi" ao Mister e peça o link de novo.`,
      );
    const dia = `${hoje.slice(8, 10)}/${hoje.slice(5, 7)}`;
    try {
      await this.numero.enviar(alvo.telefone, {
        texto: mensagemDoLink({ quemPediu: e.nome, assunto, dia, loja: lojaDoLink.nome, resumo }),
        link: { titulo: 'Abrir no Regem', url: `${enderecoDoApp()}${tela.caminho}` },
      });
    } catch (err: any) {
      this.logger.warn(`mister: o link de conferência não saiu (${err?.motivo ?? err?.message ?? err})`);
      return recusa(`Não consegui mandar o link para ${nome} agora. Tente de novo em instantes.`);
    }
    return { ok: true, dados: { enviadoPara: nome, loja: lojaDoLink.nome, dia, resumo, abreEm: `${tela.onde}, com o usuário de ${nome}` } };
  }

  /**
   * F4.3 — a IA propõe um procedimento do catálogo para um aviso ABERTO que ele resolve. O servidor acha o aviso no escopo
   * da pessoa (a loja da conversa; o presidente na rede, todas), o mais recente cujo procedimento é o pedido, e cria (ou
   * renova a vencida, ou devolve a ainda pendente) pelo MESMO `propor` da F4.1. Só o presidente autoriza: para os outros,
   * a recusa diz isso (o presidente já recebe a proposta junto do aviso). Nada executa aqui.
   */
  private async proporProcedimento(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (e.nivel !== 'presidente') return recusa('Só o presidente autoriza um procedimento do Mister. Ele recebe a proposta junto do aviso.');
    if (!this.propostas) return recusa('Não consigo propor agora.');
    const procedimento = String(en.procedimento ?? '');
    if (!(PROCEDIMENTOS_QUE_A_IA_PROPOE as readonly string[]).includes(procedimento)) return recusa('Esse procedimento não está no catálogo.');
    const lojas = loja.atual ? [loja.atual] : e.lojas.map((l) => l.id);
    if (!lojas.length && !e.lojaUnica) return recusa(SEM_PERMISSAO);
    if (procedimento === 'cancelar_pedido') return this.proporCancelamento(e, en, e.lojaUnica && !loja.atual ? null : lojas);
    if (!lojas.length) return recusa(SEM_PERMISSAO);
    const avisos = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", unidade_id::text as "unidadeId", tipo, chave, titulo
          from mister_aviso
         where tenant_id = ${e.tenantId}::uuid and situacao = 'aberto'
           and (unidade_id is null or unidade_id in (${sql.join(
             lojas.map((l) => sql`${l}::uuid`),
             sql`, `,
           )}))
         order by aberto_em desc
         limit 50`),
    ) as Array<{ id: string; tenantId: string; unidadeId: string | null; tipo: string; chave: string; titulo: string }>;
    const alvo = avisos.find((a) => propostaDoAviso(a)?.procedimento === procedimento);
    if (!alvo) return { ok: true, dados: { proposta: null, motivo: 'Não há aviso aberto que este procedimento resolva nesta loja.' } };
    const p = await this.propostas.propor(alvo);
    if (!p)
      return {
        ok: true,
        dados: { proposta: null, aviso: alvo.titulo, motivo: 'A proposta desse aviso já foi respondida (autorizada ou recusada); o andamento sai no próprio aviso.' },
      };
    // F4.4: o aviso da impressora pode virar a via de teste ou o reinício do serviço — "oQue" diz qual, para a IA contar.
    return { ok: true, dados: { proposta: 'vai em seguida, com os botões Autorizar e Não agora', aviso: alvo.titulo, oQue: PROCEDIMENTOS[p.procedimento]?.nome ?? null }, proposta: p };
  }

  /**
   * F4.2b: a proposta de cancelar o pedido que a pessoa disse. O servidor acha o pedido ABERTO (nem cancelado nem
   * concluído) das últimas 24 horas, pelo número do dia ("#284") ou pelo número do canal, na loja da conversa (ou sem
   * loja, V4); `lojas` null = a empresa tem uma loja só. Nenhum ou mais de um: a frase para pedir o número como no painel.
   * A proposta (de PIN) vai depois da resposta, com o link — a IA não vê o pedido além do nome do quadro.
   */
  private async proporCancelamento(e: EscopoDoMister, en: Record<string, unknown>, lojas: string[] | null): Promise<ResultadoDaFerramenta> {
    if (!this.pode(e, 'delivery')) return recusa(SEM_PERMISSAO);
    const dito = String(en.pedido ?? '').trim().replace(/^#/, '');
    if (!/^[A-Za-z0-9-]{1,40}$/.test(dito)) return recusa('Diga o número do pedido como aparece no painel do Delivery.');
    const numeroDoDia = /^\d{1,9}$/.test(dito) ? Number(dito) : null;
    const achados = linhas(
      await this.db.execute(sql`
        select pe.id::text as id, pe.unidade_id::text as "unidadeId", pe.canal, pe.numero, pe.display_id as "displayId"
          from pedido_externo pe
         where pe.tenant_id = ${e.tenantId}::uuid
           ${lojas ? sql`and (pe.unidade_id is null or pe.unidade_id in (${sql.join(lojas.map((l) => sql`${l}::uuid`), sql`, `)}))` : sql``}
           and pe.status not in ('cancelado', 'concluido')
           and pe.criado_em > now() - interval '24 hours'
           and (pe.display_id = ${dito} ${numeroDoDia != null ? sql`or pe.numero = ${numeroDoDia}` : sql``})
         order by pe.criado_em desc
         limit 6`),
    );
    if (!achados.length) return { ok: true, dados: { proposta: null, motivo: 'Não achei pedido aberto com esse número nas últimas 24 horas nesta loja.' } };
    if (achados.length > 1) return { ok: true, dados: { proposta: null, motivo: 'Achei mais de um pedido aberto com esse número.', pedidos: achados.map(pedidoComoNoQuadro) } };
    if (!this.propostas) return recusa('Não consigo propor agora.');
    const ped = await this.propostas.lerPedido(e.tenantId, achados[0].id);
    if (!ped) return { ok: true, dados: { proposta: null, motivo: 'Não achei pedido aberto com esse número nas últimas 24 horas nesta loja.' } };
    const p = await this.propostas.proporCancelamento({ tenantId: e.tenantId, unidadeId: achados[0].unidadeId ?? null, pedidoId: ped.id }, ped);
    if (!p)
      return {
        ok: true,
        dados: { proposta: null, pedido: ped.nome, motivo: 'O cancelamento desse pedido já foi autorizado e está em andamento; o resultado chega na conversa.' },
      };
    return { ok: true, dados: { proposta: 'vai em seguida, com o link "Abrir no Regem", que pede o PIN', pedido: ped.nome }, proposta: p };
  }

  /** F4.2: a proposta de PIN sai com o link (um código novo a cada envio), para quem está na conversa. */
  async enviarLinkDaProposta(e: EscopoDoMister, p: PropostaPendente, telefone: string): Promise<boolean> {
    if (!this.propostas || p.nivel !== 'pin') return false;
    return !!(await this.propostas.enviarLink(p.id, e.colaboradorId, telefone, p.pergunta));
  }

  /**
   * A conciliação (F3.5): o que não fecha entre a venda, o dinheiro e a nota fiscal (`mister-conciliacao.ts`). Cada
   * parte segue a permissão da tela onde o dado aparece: os pedidos (o Pix, o cancelado com a venda de pé, o concluído
   * sem pagamento) a do Delivery; as notas, a de Notas fiscais. Os valores, só para quem vê valores. A parte que não pôde
   * ser lida (a tabela do estorno só existe na nuvem) diz "não li" — nunca vira zero.
   */
  private async conciliacao(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    const verPedidos = this.pode(e, 'delivery');
    const verNotas = this.pode(e, 'fiscal');
    if (!verPedidos && !verNotas) return recusa(SEM_PERMISSAO);
    const p = periodoDaFerramenta(en, hojeISO(), 'hoje');
    if ('erro' in p) return recusa(p.erro);
    const escopo = { tenantId: e.tenantId, unidade: loja.atual, ini: `${p.de} 00:00:00`, fim: `${p.ate} 23:59:59` };
    const dinheiro = (v: unknown) => (e.verValores ? reais(v) : null);
    const comoPedido = (x: any) => (x?.canal || x?.numero || x?.displayId ? pedidoComoNoQuadro(x) : null);
    const ler = async <T,>(f: () => Promise<T>, mostrar: (r: T) => Record<string, unknown>): Promise<Record<string, unknown>> => {
      try {
        return mostrar(await f());
      } catch (err: any) {
        this.logger.warn(`conciliação: uma parte não foi lida — ${String(err?.message ?? err).slice(0, 200)}`);
        return { erro: 'Não consegui ler esta parte agora.' };
      }
    };
    const exemplosDePedido = (lista: any[]) =>
      lista.map((x) => ({ comoAparece: comoPedido(x), quando: String(x.quando ?? ''), valor: dinheiro(x.valor), ...(x.forma ? { forma: String(x.forma).slice(0, 40) } : {}) }));
    const ambiente = (a: unknown) => (String(a) === '1' ? 'produção' : 'homologação (teste)');
    const dados: Record<string, unknown> = { loja: loja.nome, periodo: p.rotulo, ...(e.verValores ? {} : { aviso: SEM_VALORES }) };

    if (verPedidos) {
      dados.pixPagoEmPedidoCanceladoSemEstorno = await ler(
        () => pixSemEstorno(this.db, escopo),
        (r) => ({
          quantos: r.quantos,
          valor: dinheiro(r.valor),
          casos: r.exemplos.map((x) => ({
            comoAparece: comoPedido(x),
            canceladoEm: String(x.quando ?? ''),
            valor: dinheiro(x.valor),
            situacao: SITUACAO_DO_ESTORNO[String(x.situacao)] ?? String(x.situacao),
          })),
          ...(r.adicionaisQueFalharam ? { pixDeItemPostoDepoisQueFalhou: r.adicionaisQueFalharam, valorDesses: dinheiro(r.valorDosAdicionais) } : {}),
          ...(r.quantos || r.adicionaisQueFalharam ? { oQueFazer: 'Devolva o valor ao cliente pelo app do gateway (o Atendimento tem um caso urgente para cada estorno que falhou).' } : {}),
        }),
      );
      dados.pedidoCanceladoComAVendaDePe = await ler(
        () => canceladoComVendaDePe(this.db, escopo),
        (r) => ({ quantos: r.quantos, valor: dinheiro(r.valor), casos: exemplosDePedido(r.exemplos) }),
      );
      dados.pedidoConcluidoSemPagamentoRegistrado = await ler(
        () => concluidoSemPagamento(this.db, escopo),
        (r) => ({
          quantos: r.quantos,
          valor: dinheiro(r.valor),
          porCanal: Object.fromEntries(Object.entries(r.porCanal).map(([c, n]) => [CANAL_NA_TELA[c] ?? c, n])),
          casos: exemplosDePedido(r.exemplos),
          ...(r.quantos
            ? { comoLer: 'O recebimento não foi registrado no caixa do Regem (em geral o pago na entrega que não passou por "FINALIZAR"). O dinheiro pode ter sido recebido fora do Regem: não diga que o cliente não pagou.' }
            : {}),
        }),
      );
    } else {
      dados.pixPagoEmPedidoCanceladoSemEstorno = { aviso: SEM_PERMISSAO };
      dados.pedidoCanceladoComAVendaDePe = { aviso: SEM_PERMISSAO };
      dados.pedidoConcluidoSemPagamentoRegistrado = { aviso: SEM_PERMISSAO };
    }

    if (verNotas) {
      dados.vendaDesfeitaComNotaAutorizada = await ler(
        () => vendaDesfeitaComNota(this.db, escopo),
        (r) => ({
          quantos: r.quantos,
          valor: dinheiro(r.valor),
          casos: r.exemplos.map((x) => ({ nota: `nº ${x.notaNumero} (série ${x.notaSerie})`, ambiente: ambiente(x.ambiente), pedido: comoPedido(x), desfeitaEm: String(x.quando ?? ''), valor: dinheiro(x.valor) })),
          ...(r.quantos ? { oQueFazer: 'Cancele a nota em Notas fiscais (o prazo do cancelamento é curto) ou fale com o contador.' } : {}),
        }),
      );
      dados.vendaComNotaComProblema = await ler(
        () => vendaComNotaComProblema(this.db, escopo),
        (r) => ({
          quantos: r.quantos,
          valor: dinheiro(r.valor),
          casos: r.exemplos.map((x) => ({
            nota: x.notaNumero ? `nº ${x.notaNumero} (série ${x.notaSerie})` : null,
            situacao: SITUACAO_DA_NOTA[String(x.situacaoDaNota)] ?? String(x.situacaoDaNota),
            motivoDaSefaz: x.motivo ? String(x.motivo) : null,
            ambiente: ambiente(x.ambiente),
            pedido: comoPedido(x),
            vendaEm: String(x.quando ?? ''),
            valor: dinheiro(x.valor),
          })),
        }),
      );
    } else {
      dados.vendaDesfeitaComNotaAutorizada = { aviso: SEM_PERMISSAO };
      dados.vendaComNotaComProblema = { aviso: SEM_PERMISSAO };
    }
    return { ok: true, dados };
  }

  /**
   * O que vence ou está desatualizado (F3, vigilância de dependências — parte 1, as da loja; `mister-vencimentos.ts`):
   *  • o certificado digital da nota, cada um cadastrado (o da loja e o da empresa), MESMO com a nota desligada — o aviso
   *    só olha onde ela está ligada; aqui a pessoa pergunta. Permissão da nota fiscal (`fiscal` ou `fiscal_config`).
   *  • a tabela do IBPT do estado da loja: qual vale hoje (a da Configuração fiscal — `IbptService.situacaoDaLoja`) e a
   *    situação da tabela da DMS pela régua do verificador da distribuição (`statusIbpt`). Mesma permissão.
   *  • o servidor da loja: a licença (a MESMA regra da renovação, ERR-466) e a versão instalada × a que esta loja já
   *    poderia ter (`LicencaService.vencimentoDoServidor`). Só o presidente, como a situação do servidor.
   *  • o acesso do Instagram (presidente e gerente, como a tela).
   * Nada de segredo: só datas e situação. A parte que não pôde ser lida diz "não li" — nunca vira "em dia".
   */
  private async vencimentosEVersoes(e: EscopoDoMister, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    const verFiscal = this.pode(e, 'fiscal') || this.pode(e, 'fiscal_config');
    const verServidor = e.nivel === 'presidente';
    const verInstagram = e.nivel === 'presidente' || e.nivel === 'gerente';
    if (!verFiscal && !verServidor && !verInstagram) return recusa(SEM_PERMISSAO);
    const agora = new Date();
    const dados: Record<string, unknown> = { loja: loja.nome, lidoAs: horaAgora() };
    const atencao: string[] = [];
    const juntar = (p: ParteDoVencimento | null) => {
      if (p?.atencao) atencao.push(p.atencao);
      return p?.dados;
    };

    if (verFiscal) {
      const ligadas = linhas(
        await this.db.execute(sql`
          select coalesce(bool_or(ativo), false) as ligada from fiscal_config
           where tenant_id = ${e.tenantId}::uuid ${sqlUnidadeOuRede('unidade_id', loja.atual)}`),
      );
      const notaLigada = ligadas[0]?.ligada === true;
      // 1) Cada certificado: o da loja (ou da empresa toda) com o ajuste da nota que vale para ele (o da loja, senão o da
      //    empresa — a mesma régua do fiscal).
      const certificados = linhas(
        await this.db.execute(sql`
          select u.nome as loja, c.cert_valido_ate as "validoAte", cfg.ativo as ligada, cfg.ambiente
            from fiscal_credencial c
            left join unidade u on u.id = c.unidade_id and u.tenant_id = c.tenant_id
            left join lateral (
              select f.ativo, f.ambiente from fiscal_config f
               where f.tenant_id = c.tenant_id and (f.unidade_id is not distinct from c.unidade_id or f.unidade_id is null)
               order by (f.unidade_id is null) limit 1) cfg on true
           where c.tenant_id = ${e.tenantId}::uuid and c.cert_valido_ate is not null ${sqlUnidadeOuRede('c.unidade_id', loja.atual)}
           order by (c.unidade_id is null) desc, u.nome
           limit 10`),
      );
      dados.certificadoDigital = certificados.length
        ? certificados.map((c) => juntar(certificadoParaOMister({ loja: c.loja ?? null, validoAte: c.validoAte, ligada: c.ligada === true, ambiente: c.ambiente }, agora)))
        : { cadastrado: false, observacao: 'Nenhum certificado digital cadastrado (ele só faz falta para emitir a nota fiscal).' };

      // 2) A tabela do IBPT do estado da loja.
      if (!this.ibpt) dados.tabelaDoIbpt = { aviso: 'Não consegui ler a tabela do IBPT agora.' };
      else {
        try {
          const s: any = await this.ibpt.situacaoDaLoja(e.tenantId, loja.atual);
          const uf = s?.uf ? String(s.uf).toUpperCase() : null;
          let daDms: any = null;
          let ultimaAte: string | null = null;
          if (uf) {
            [daDms] = await statusIbpt(this.db, hojeNaUf(uf), [uf]);
            const [u] = linhas(
              await this.db.execute(sql`
                select max(vigencia_fim)::text as ate from ibpt_versao
                 where upper(uf) = ${uf} and (tenant_id is null or tenant_id = ${e.tenantId}::uuid)`),
            );
            ultimaAte = u?.ate ?? null;
          }
          dados.tabelaDoIbpt = juntar(
            ibptParaOMister({
              uf,
              emUso: s?.emUso === 'propria' || s?.emUso === 'regem' ? s.emUso : null,
              propriaAte: s?.tabelaPropria?.vigenciaFim ?? null,
              regemAte: s?.tabelaRegem?.vigenciaFim ?? null,
              situacaoDaDms: daDms?.situacao ?? null,
              diasParaVencerDaDms: daDms?.diasParaVencer ?? null,
              ultimaAte,
              notaLigada,
            }),
          );
        } catch (err: any) {
          this.logger.warn(`a tabela do IBPT não foi lida: ${String(err?.message ?? err).slice(0, 200)}`);
          dados.tabelaDoIbpt = { aviso: 'Não consegui ler a tabela do IBPT agora.' };
        }
      }
    } else {
      dados.certificadoDigital = { aviso: SEM_PERMISSAO };
      dados.tabelaDoIbpt = { aviso: SEM_PERMISSAO };
    }

    // 3) O servidor da loja: a licença e a versão (só o presidente).
    if (verServidor) {
      const partes = servidorParaOMister((await this.licenca.vencimentoDoServidor(e.tenantId)) as ServidorLido, agora);
      dados.servidorDaLoja = Object.assign({}, ...partes.map((p) => juntar(p)));
      if (!e.lojaUnica) (dados.servidorDaLoja as Record<string, unknown>).observacaoDaRede = 'A empresa tem mais de uma loja: esta é a licença da empresa e a versão do servidor que falou por último.';
    } else dados.servidorDaLoja = { aviso: 'A licença e a versão do servidor são mostradas só ao presidente.' };

    // 4) O Instagram da loja (só com a conta conectada).
    if (verInstagram) {
      try {
        const [c] = linhas(
          await this.db.execute(sql`
            select usuario, token_vence_em as "venceEm", erro from instagram_conta where tenant_id = ${e.tenantId}::uuid limit 1`),
        );
        const ig = instagramParaOMister(c ? { usuario: c.usuario ?? null, venceEm: c.venceEm ?? null, erro: c.erro ?? null } : null, agora);
        if (ig) dados.instagram = juntar(ig);
      } catch (err: any) {
        if (!semTabela(err)) throw err;
      }
    }

    dados.pedeAtencao = atencao.length ? atencao : 'Nada vencido nem para vencer logo, e o servidor está na versão que a loja pode ter.';
    return { ok: true, dados };
  }

  /**
   * O guia de uso (F2.5): as seções do guia da distribuição que respondem ao assunto, com o caminho do menu, quem abre e
   * se ESTA pessoa abre (a mesma régua do menu: o presidente abre tudo; o gerente, pela permissão do perfil — a tela só do
   * presidente, nunca). Não lê banco: o guia é igual para toda empresa. Sem nada que responda, devolve os assuntos que o
   * guia tem, para o Mister dizer o que sabe explicar.
   */
  private async comoUsarORegem(e: EscopoDoMister, entrada: unknown): Promise<ResultadoDaFerramenta> {
    const en = (entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>;
    const assunto = typeof en.assunto === 'string' ? en.assunto.trim().slice(0, 200) : '';
    if (!assunto) return recusa('Diga o assunto: o que a pessoa quer fazer ou achar no Regem.');
    const achadas = buscarNoGuia(assunto, GUIA_DE_USO);
    if (!achadas.length) {
      return { ok: true, dados: { encontrado: false, assunto, assuntosDoGuia: GUIA_DE_USO.map((s) => s.titulo) } };
    }
    const abre = (s: SecaoDoGuia): boolean => {
      if (e.nivel === 'presidente') return true;
      if (s.soPresidente) return false;
      return s.perm ? this.pode(e, s.perm) : true;
    };
    // M3d: a imagem da tela (o primeiro assunto que tem e que a pessoa abre) vai antes do texto, pelo endereço público.
    const comImagem = achadas.find((s) => s.imagem && abre(s));
    return {
      ok: true,
      ...(comImagem ? { imagens: [{ url: `${enderecoDoApp()}/como-faco/${comImagem.id}.png`, legenda: comImagem.titulo }] } : {}),
      dados: {
        encontrado: true,
        assunto,
        ...(comImagem
          ? {
              imagem: `A imagem da tela vai junto da sua resposta, com os lugares numerados: ${comImagem.imagem!.map((m, i) => `${i + 1} = ${m}`).join('; ')}. Cite os números nos passos.`,
            }
          : {}),
        secoes: achadas.map((s) => ({
          assunto: s.titulo,
          ondeFica: s.caminho.join(' › '),
          quemAbre: quemAbre(s),
          estaPessoaAbre: abre(s),
          passos: s.passos,
          ...(s.notas?.length ? { observacoes: s.notas } : {}),
          ...(s.veja?.length
            ? {
                vejaTambem: s.veja
                  .map((id) => GUIA_DE_USO.find((x) => x.id === id))
                  .filter((x): x is SecaoDoGuia => !!x)
                  .map((x) => ({ assunto: x.titulo, ondeFica: x.caminho.join(' › ') })),
              }
            : {}),
        })),
      },
    };
  }

  // ───────────────────────────── cada ferramenta ─────────────────────────────

  /**
   * Os canais de venda e as integrações AGORA (F3, a vigilância das integrações). Cada pedaço vem da regra da sua tela: a
   * pausa do "Pausar" do Delivery (`PausaDoCanalService.estado`), o login da 99 (`Food99Service.status`), o WhatsApp da
   * loja (`WhatsappProvedorService.estado` e, no Evolution, a conexão de agora por `WhatsappService.status`) e a nota
   * fiscal (o ajuste, o certificado pela conta da tela — `diasParaVencer`, aviso com 60 dias — e as notas das últimas 24
   * horas). O último pedido de cada canal sai do próprio pedido. Fica de fora a fila de avisos a outros sistemas
   * (`aviso_integracao`): ela não sincroniza, e a nuvem não veria as falhas que saíram do servidor da loja (V37).
   */
  private async canaisEIntegracoes(e: EscopoDoMister, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    const verCanais = this.pode(e, 'delivery');
    const verFiscal = this.pode(e, 'fiscal');
    if (!verCanais && !verFiscal) return recusa(SEM_PERMISSAO);
    const dados: Record<string, unknown> = { loja: loja.nome, lidoAs: horaAgora() };
    if (verCanais) {
      // Sem loja escolhida numa empresa de várias: cada loja com os seus canais (a pausa e o pedido são de uma loja).
      const lojas: { id: string | null; nome: string }[] =
        loja.atual || e.lojaUnica ? [{ id: loja.atual, nome: loja.nome }] : e.lojas.slice(0, MAX_LOJAS_NOS_CANAIS).map((l) => ({ id: l.id, nome: l.nome }));
      const porLoja: Record<string, unknown>[] = [];
      for (const l of lojas) porLoja.push({ loja: l.nome, ...(await this.canaisDaLoja(e, l.id)) });
      if (porLoja.length === 1) {
        dados.canais = porLoja[0].canais;
        if (porLoja[0].outrosCanais) dados.outrosCanais = porLoja[0].outrosCanais;
      } else dados.porLoja = porLoja;
      const da99 = await this.loginDa99(e);
      if (da99) dados.loginDa99 = da99;
      dados.whatsappDaLoja = await this.whatsappDaLoja(e);
    } else dados.canais = { aviso: SEM_PERMISSAO };
    dados.notaFiscal = verFiscal ? await this.notaFiscal(e, loja.atual) : { aviso: SEM_PERMISSAO };
    return { ok: true, dados };
  }

  /**
   * A conferência do cardápio com o iFood e a 99 (F3, parte 2): a ÚLTIMA leitura guardada pela tela "Conferir com os
   * apps", pela mesma conta dela (`ConferenciaService.resumoGuardado` — nunca lê o app daqui). A permissão é a da tela
   * (`loja`). É por loja: sem loja escolhida numa empresa de várias, pede a loja.
   */
  private async conferenciaDoCatalogo(e: EscopoDoMister, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (!this.pode(e, 'loja')) return recusa(SEM_PERMISSAO);
    const lojaId = loja.atual ?? (e.lojaUnica ? (e.lojas[0]?.id ?? null) : null);
    if (!lojaId) return recusa(`A conferência do cardápio é por loja. As lojas são: ${e.lojas.map((l, n) => `${n + 1}. ${l.nome}`).join('; ')}.`);
    if (!this.conferencia) return recusa('Não consegui ler a conferência do cardápio agora.');
    const r = await this.conferencia.resumoGuardado(e.tenantId, lojaId);
    if (!r.ligada) return { ok: true, dados: { loja: loja.nome, ligada: false, observacao: 'A conferência do cardápio com os apps não está ligada nesta empresa.' } };
    if (!r.canais) return recusa('Não achei essa loja.');
    const app = (c: any, nome: string) => ({
      app: nome,
      ...(c.ligado ? {} : { ligado: false, motivo: c.motivo }),
      lidoEm: c.lidoEm ? dataHoraCurta(c.lidoEm) : null,
      ...(c.lidoEm ? {} : { observacao: 'Nunca foi lido pela tela "Conferir com os apps".' }),
      ...(c.ultimaLeituraFalhou ? { ultimaLeituraFalhou: true } : {}),
      ...(c.aResolver === null ? {} : { aResolver: c.aResolver, porSituacao: c.porSituacao }),
      ...(c.exemplos?.length
        ? {
            exemplos: c.exemplos.map((x: any) => ({
              tipo: x.tipo,
              nome: x.nome,
              codigoPdv: x.codigoPdv,
              situacao: SITUACAO_NA_CONFERENCIA[x.situacao] ?? x.situacao,
              ...(x.motivo && MOTIVO_NA_CONFERENCIA[x.motivo] ? { porque: MOTIVO_NA_CONFERENCIA[x.motivo] } : {}),
              ...(e.verValores ? { precoNoApp: x.precoNoApp, precoNoRegem: x.precoNoRegem } : {}),
            })),
          }
        : {}),
    });
    return {
      ok: true,
      dados: {
        loja: r.loja?.nome ?? loja.nome,
        apps: [app(r.canais.ifood, 'iFood'), app(r.canais['99food'], '99')],
        ...(e.verValores ? {} : { aviso: SEM_VALORES }),
      },
    };
  }

  /**
   * O Atendimento AGORA: a MESMA fila da tela (`AtendimentoService.fila` — a ordem prazo → urgente → espera, a situação de
   * cada caso, as contagens, a régua do perfil e os recados para o responsável, que só a gestão vê). Para a IA vão o
   * assunto, a situação, a espera, o prazo, o pedido e o primeiro nome de quem está com o caso — nunca o nome, o telefone
   * nem a mensagem do cliente: a pergunta de gestão não precisa deles (LGPD, o mínimo). A permissão é a da tela (`pedidos`).
   */
  private async atendimentoAgora(e: EscopoDoMister, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (!this.pode(e, 'pedidos')) return recusa(SEM_PERMISSAO);
    if (!this.atendimento) return recusa('Não consegui ler o Atendimento agora.');
    const quem = { tenantId: e.tenantId, colaboradorId: e.colaboradorId, categoria: e.nivel, unidadeId: e.presa } as any;
    const f: any = await this.atendimento.fila(quem, loja.atual, { comRecados: true });
    const agora = Date.now();
    const todos: any[] = f?.casos ?? [];
    const c = f?.contagens ?? {};
    const casos = todos.slice(0, CASOS_DO_ATENDIMENTO).map((x) => {
      const prazo = x.prazoEm ? new Date(x.prazoEm) : null;
      const pedido = x.pedidoId || x.pedidoNaPlataforma ? pedidoComoNoQuadro({ canal: x.pedidoCanal, numero: null, displayId: x.pedidoNaPlataforma }) : x.pedidoNumero ? `pedido ${String(x.pedidoNumero).slice(0, 20)}` : null;
      return {
        assunto: ASSUNTO_DO_CASO[String(x.tipo)] ?? 'Atendimento',
        situacao: SITUACAO_DO_CASO[String(x.situacao)] ?? String(x.situacao ?? ''),
        ...(x.prioridade === 'urgente' ? { urgente: true } : {}),
        esperaHaMinutos: minutosDesde(x.criadoEm, agora),
        ...(prazo && !Number.isNaN(prazo.getTime()) ? { prazoAs: horaNoFuso(prazo), prazoEmMinutos: Math.round((prazo.getTime() - agora) / 60_000) } : {}),
        ...(pedido ? { pedido } : {}),
        ...(x.responsavelNome ? { comQuem: primeiroNome(String(x.responsavelNome)) } : {}),
      };
    });
    return {
      ok: true,
      dados: {
        loja: loja.nome,
        lidoAs: horaAgora(),
        emAberto: inteiro(c.abertos),
        naFilaSemNinguem: inteiro(c.naFila),
        comPrazo: inteiro(c.comPrazo),
        aguardandoOCliente: inteiro(c.aguardando),
        resolvidosHoje: inteiro(c.resolvidosHoje),
        ...(inteiro(c.paraAbertura) ? { recadosParaAAbertura: inteiro(c.paraAbertura) } : {}),
        ...(inteiro(c.paraOResponsavel) ? { recadosParaOResponsavel: inteiro(c.paraOResponsavel) } : {}),
        casos,
        ...(todos.length > CASOS_DO_ATENDIMENTO ? { observacao: `Os ${CASOS_DO_ATENDIMENTO} primeiros de ${todos.length} na ordem da fila.` } : {}),
        ...(f?.equipe && f.equipe.atendendo === false ? { equipeForaDoHorario: true, ...(f.equipe.voltaTexto ? { equipeVolta: String(f.equipe.voltaTexto) } : {}) } : {}),
      },
    };
  }

  /** Os três canais da pausa numa loja (a pausa de agora e o último pedido) e os outros canais com pedido hoje. */
  private async canaisDaLoja(e: EscopoDoMister, unidadeId: string | null): Promise<Record<string, unknown>> {
    let estado: any = null;
    if (this.pausa) {
      try {
        estado = await this.pausa.estado(e.tenantId, unidadeId);
      } catch (err: any) {
        this.logger.warn(`a pausa dos canais não foi lida: ${String(err?.message ?? err).slice(0, 200)}`);
      }
    }
    const pedidos = linhas(
      await this.db.execute(sql`
        select coalesce(canal, 'outro') as canal,
               count(*) filter (where ${noPeriodo('criado_em', `${hojeISO()} 00:00:00`, `${hojeISO()} 23:59:59`)})::int as hoje,
               to_char(max(criado_em) at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as ultimo,
               floor(extract(epoch from (now() - max(criado_em))) / 60)::int as ha_min
          from pedido_externo
         where tenant_id = ${e.tenantId}::uuid and deleted_at is null and criado_em > now() - interval '30 days'
           ${sqlUnidadeOuRede('unidade_id', unidadeId)}
         group by 1`),
    );
    const doPedido = (canal: string) => pedidos.find((p) => p.canal === canal);
    const canais = CANAIS_DA_PAUSA.map((c) => {
      const noPainel = estado?.canais?.find((x: any) => x.canal === c);
      const p = doPedido(CANAL_DO_PEDIDO[c]);
      const pz = noPainel?.pausa;
      return {
        canal: NOME_DO_CANAL[c],
        pausa: !estado
          ? { aviso: 'Não consegui ler a pausa agora.' }
          : pz
            ? {
                pausado: true,
                volta: String(pz.volta?.texto ?? ''),
                motivo: String(pz.rotulo ?? ''),
                ...(pz.pausadoPorNome ? { pausadoPor: primeiroNome(String(pz.pausadoPorNome)) } : {}),
                ...(pz.externo ? { noApp: SITUACAO_DA_PAUSA_NO_APP[pz.externo.situacao as keyof typeof SITUACAO_DA_PAUSA_NO_APP] ?? null } : {}),
              }
            : { pausado: false },
        ultimoPedido: p ? String(p.ultimo) : null,
        ultimoPedidoHaMinutos: p ? inteiro(p.ha_min) : null,
        pedidosHoje: p ? inteiro(p.hoje) : 0,
      };
    });
    const daPausa = new Set(Object.values(CANAL_DO_PEDIDO));
    const outros = pedidos
      .filter((p) => !daPausa.has(String(p.canal)) && inteiro(p.hoje) > 0)
      .map((p) => ({ canal: CANAL_NA_TELA[String(p.canal)] ?? String(p.canal), pedidosHoje: inteiro(p.hoje), ultimoPedido: String(p.ultimo) }));
    return { canais, ...(outros.length ? { outrosCanais: outros } : {}) };
  }

  /** O login da 99 (a mesma saúde da tela: o token vigente, não só a ligação) — ou null quando a empresa não usa a 99. */
  private async loginDa99(e: EscopoDoMister): Promise<Record<string, unknown> | null> {
    if (!this.food99) return { aviso: 'Não consegui ler o login da 99 agora.' };
    try {
      const s: any = await this.food99.status(e.tenantId);
      if (!s?.conectado) return null;
      return s.autenticado
        ? { emDia: true }
        : { emDia: false, observacao: 'O login da 99 venceu ou foi recusado: os pedidos da 99 podem não chegar até a conexão ser refeita.' };
    } catch (err: any) {
      this.logger.warn(`o login da 99 não foi lido: ${String(err?.message ?? err).slice(0, 200)}`);
      return { aviso: 'Não consegui ler o login da 99 agora.' };
    }
  }

  /** O WhatsApp da loja (o dos clientes, não o do Mister): o provedor e, no Evolution, se está conectado agora. */
  private async whatsappDaLoja(e: EscopoDoMister): Promise<Record<string, unknown>> {
    if (!this.whatsappProvedor) return { aviso: 'Não consegui ler o WhatsApp da loja agora.' };
    try {
      const est: any = await this.whatsappProvedor.estado(e.tenantId);
      if (est?.provedor === 'cloud') {
        return { conexao: 'API oficial da Meta', ligado: !!est.cloud?.vinculado, ...(est.cloud?.vinculado ? {} : { observacao: 'O número da API oficial não está ligado.' }) };
      }
      if (!est?.evolution?.vinculado) return { conexao: 'WhatsApp pelo QR', ligado: false, observacao: 'A loja ainda não ligou o WhatsApp.' };
      if (!this.whatsapp) return { conexao: 'WhatsApp pelo QR', ligado: true, conectadoAgora: null, observacao: 'Não consegui confirmar a conexão agora.' };
      const s: any = await this.whatsapp.status(e.tenantId);
      const situacao = SITUACAO_DO_WHATSAPP[String(s?.estado ?? '')] ?? null;
      return {
        conexao: 'WhatsApp pelo QR',
        ligado: true,
        conectadoAgora: s?.estado === 'open' ? true : situacao ? false : null,
        ...(s?.estado === 'open' ? {} : { observacao: situacao ?? 'Não consegui confirmar a conexão agora.' }),
      };
    } catch (err: any) {
      if (err instanceof NotFoundException) return { ligado: false, observacao: 'A loja ainda não configurou o WhatsApp.' };
      this.logger.warn(`o WhatsApp da loja não foi lido: ${String(err?.message ?? err).slice(0, 200)}`);
      return { aviso: 'Não consegui ler o WhatsApp da loja agora.' };
    }
  }

  /**
   * A nota fiscal: o ajuste de cada loja (ligada, em teste ou valendo), o certificado digital (o da loja, senão o da empresa)
   * e as notas das últimas 24 horas — recusadas (com o motivo da SEFAZ), sem resposta há mais de 10 minutos e em
   * contingência. Nota simulada (o teste da tela) fica de fora.
   */
  private async notaFiscal(e: EscopoDoMister, unidadeId: string | null): Promise<Record<string, unknown>> {
    const ajustes = linhas(
      await this.db.execute(sql`
        select fc.unidade_id, u.nome as loja, fc.ativo, fc.ambiente,
               (select c.cert_valido_ate from fiscal_credencial c
                 where c.tenant_id = fc.tenant_id and (c.unidade_id = fc.unidade_id or c.unidade_id is null) and c.cert_valido_ate is not null
                 order by (c.unidade_id is null), c.updated_at desc limit 1) as cert_ate
          from fiscal_config fc
          left join unidade u on u.id = fc.unidade_id
         where fc.tenant_id = ${e.tenantId}::uuid ${sqlUnidadeOuRede('fc.unidade_id', unidadeId)}
         order by (fc.unidade_id is null) desc, u.nome`),
    );
    if (!ajustes.some((a) => a.ativo)) return { ligada: false, observacao: 'A nota fiscal não está ligada no Regem.' };
    const agora = new Date();
    const lojas = ajustes
      .filter((a) => a.ativo)
      .map((a) => ({
        ...(a.unidade_id ? { loja: String(a.loja ?? '') } : { loja: 'a empresa toda' }),
        ambiente: String(a.ambiente) === '1' ? 'valendo (produção)' : 'em teste (homologação)',
        certificado: situacaoDoCertificado(a.cert_ate, agora) ?? { aviso: 'Sem certificado digital cadastrado.' },
      }));
    const vale = sql`tenant_id = ${e.tenantId}::uuid and simulada = false and created_at > now() - interval '24 hours' ${sqlUnidadeOuRede('unidade_id', unidadeId)}`;
    const [cont] = linhas(
      await this.db.execute(sql`
        select count(*) filter (where status = 'autorizada')::int as autorizadas,
               count(*) filter (where status = 'rejeitada')::int as recusadas,
               count(*) filter (where status = 'pendente' and created_at < now() - interval '10 minutes')::int as sem_resposta,
               count(*) filter (where status = 'contingencia')::int as em_contingencia
          from nota_fiscal where ${vale}`),
    );
    const recusadas = linhas(
      await this.db.execute(sql`
        select numero, serie, coalesce(nullif(motivo, ''), 'sem motivo informado') as motivo, to_char(created_at at time zone ${FUSO_SQL}, 'DD/MM HH24:MI') as quando
          from nota_fiscal where ${vale} and status = 'rejeitada'
         order by created_at desc limit 5`),
    );
    return {
      ligada: true,
      lojas,
      ultimas24h: {
        autorizadas: inteiro(cont?.autorizadas),
        recusadas: inteiro(cont?.recusadas),
        semRespostaDaSefaz: inteiro(cont?.sem_resposta),
        emContingencia: inteiro(cont?.em_contingencia),
      },
      ...(recusadas.length
        ? { ultimasRecusadas: recusadas.map((n) => ({ numero: `${inteiro(n.serie)}-${inteiro(n.numero)}`, motivo: String(n.motivo).slice(0, 200), quando: String(n.quando) })) }
        : {}),
    };
  }

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
    // O relatório de Delivery (`GET /relatorios/faturamento-delivery`): só para quem vê valores em reais, como a rota.
    const dl: any = e.verValores ? await this.relatorios.faturamentoDelivery(e.tenantId, p.de, p.ate, loja.atual) : null;
    const porHora = ((r?.porHora ?? []) as any[]).map((h) => ({ hora: `${String(inteiro(h.hora)).padStart(2, '0')}h`, vendas: inteiro(h.qtd), total: reais(h.total) }));
    const pico = porHora.reduce<{ hora: string; vendas: number } | null>((m, h) => (!m || h.vendas > m.vendas ? h : m), null);
    // A comparação: o período anterior de mesmo tamanho, pelos mesmos relatórios.
    let comparacao: Record<string, unknown> | undefined;
    if (en.comparar === true) {
      const ant = periodoAnterior(p);
      const ra: any = await this.relatorios.vendas(e.tenantId, ant.de, ant.ate, e.verValores, loja.atual);
      const da: any = e.verValores ? await this.relatorios.faturamentoDelivery(e.tenantId, ant.de, ant.ate, loja.atual) : null;
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      comparacao = {
        periodo: ant.rotulo,
        numeroDeVendas: inteiro(ra?.resumo?.vendas),
        faturamento: reais(ra?.resumo?.faturado),
        ticketMedio: reais(ra?.resumo?.ticketMedio),
        ...(da ? { delivery: { pedidos: inteiro(da.pedidos), faturamento: reais(da.total), ticketMedio: reais(da.ticketMedio) } } : {}),
        variacaoPct: {
          vendas: variacaoPct(inteiro(r?.resumo?.vendas), inteiro(ra?.resumo?.vendas)),
          faturamento: variacaoPct(n(r?.resumo?.faturado), n(ra?.resumo?.faturado)),
          ticketMedio: variacaoPct(n(r?.resumo?.ticketMedio), n(ra?.resumo?.ticketMedio)),
          ...(dl && da ? { pedidosDoDelivery: variacaoPct(inteiro(dl.pedidos), inteiro(da.pedidos)), faturamentoDoDelivery: variacaoPct(n(dl.total), n(da.total)) } : {}),
        },
        comoComparar: 'O período anterior tem o mesmo número de dias (a semana até hoje contra a semana passada até o mesmo dia). Variação nula = o período anterior não teve nada para comparar.',
      };
    }
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
        porHora,
        horarioDePico: pico && pico.vendas > 0 ? pico.hora : null,
        ...(comparacao ? { comparacao } : {}),
        delivery: dl
          ? {
              comoORelatorioDeDeliveryConta: 'Os pedidos que chegaram pelos canais (cardápio online, iFood, 99 e outros) e foram aceitos, sem os cancelados, pela hora em que chegaram. É o número certo para o ticket do delivery.',
              pedidos: inteiro(dl.pedidos),
              faturamento: reais(dl.total),
              ticketMedio: reais(dl.ticketMedio),
              porPlataforma: ((dl.porPlataforma ?? []) as any[]).map((x) => ({ plataforma: String(x.plataforma ?? ''), pedidos: inteiro(x.pedidos), faturamento: reais(x.total), ticketMedio: reais(x.ticketMedio) })),
            }
          : { aviso: SEM_VALORES },
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
    if (ordem !== 'quantidade' && ordem !== 'faturamento' && ordem !== 'lucro') return recusa('A ordem é "quantidade", "faturamento" ou "lucro".');
    if (ordem === 'faturamento' || ordem === 'lucro') {
      // Por faturamento a lista é a da curva de produtos dos relatórios (`GET /relatorios/produtos`): TODOS os produtos
      // do período, já na ordem do faturamento. Reordenar os mais vendidos por quantidade deixaria de fora o produto
      // caro que vendeu pouco.
      if (!e.verValores) return recusa(`O perfil desta pessoa no Regem não mostra valores em reais: não dá para ordenar por ${ordem}.`);
      const curva: any = await this.relatorios.produtos(e.tenantId, p.de, p.ate, true, loja.atual);
      const daCurva = (curva?.itens ?? []) as any[];
      // Por lucro: o produto sem custo (sem ficha técnica) vai para o fim — não dá para saber o lucro dele.
      const todos = ordem === 'lucro' ? [...daCurva].sort((a, b) => (b.lucro ?? -Infinity) - (a.lucro ?? -Infinity)) : daCurva;
      const semCusto = daCurva.filter((i) => i.lucro === null || i.lucro === undefined).length;
      return {
        ok: true,
        dados: {
          loja: loja.nome,
          periodo: p.rotulo,
          ordenadoPor: ordem,
          produtosVendidosNoPeriodo: todos.length,
          ...(semCusto ? { semCusto: `${semCusto} produto(s) sem custo cadastrado (sem ficha técnica): ficam sem lucro e margem${ordem === 'lucro' ? ', no fim da lista' : ''}.` } : {}),
          comoLerAClasse: 'Classe A = os produtos que somam os primeiros 80% do faturamento; B = até 95%; C = o resto.',
          produtos: todos.slice(0, quantos).map((i, n) => ({
            posicao: n + 1,
            produto: String(i.descricao ?? ''),
            quantidade: quantidade(i.qtd),
            faturamento: reais(i.faturamento),
            custo: reais(i.custo),
            lucro: reais(i.lucro),
            margemPct: i.margemPct ?? null,
            classe: i.classe ?? null,
          })),
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

  /**
   * M3c — o que a venda baixou de UM insumo no período (conversas 15 e 16 da versão 3 do protótipo; decisão 10). O total
   * é o que a venda REALMENTE baixou: a saída de venda de cada comanda fechada no período, menos o que voltou no estorno —
   * a MESMA definição de venda dos relatórios (comanda fechada, pela hora do fechamento, no fuso da loja). "De onde saiu"
   * é a ficha de cada produto vendido, explodida pela mesma conta da baixa (`VendasService.consumoPorUnidade`); o que a
   * ficha não explica fica em "outros". Um dia → por hora (e, sendo hoje, a comparação com o mesmo dia das 4 semanas
   * anteriores até a mesma hora); mais de um → por dia.
   */
  private async insumoVendido(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    const lido = await this.relatorioDaConversa(e, en, loja);
    if ('parou' in lido) return lido.parou;
    const { r, insumo, p, p2 } = lido;
    const querPdf = en.pdf === true || en.pdf === 'true';
    // M3c.3: a imagem do gráfico vai na conversa junto da resposta (o MESMO plano do PDF), quando há o que mostrar.
    const plano = planoDoPdfDoInsumo(r, { empresa: e.empresa, pedidoPor: e.nome, geradoEm: new Date().toISOString() });
    const grafico: GraficoDaConversa = { titulo: plano.titulo, numeros: plano.numeros, grafico: plano.grafico, cabecalho: plano.cabecalho };
    const comImagem = valeAImagem(grafico);
    return {
      ok: true,
      dados: {
        ...dadosDoRelatorio(r),
        ...(comImagem ? { grafico: 'A imagem do gráfico vai junto da sua resposta, pelo Regem: não descreva as barras uma a uma, diga só o que importa.' } : {}),
        ...(querPdf ? { pdf: 'O PDF deste relatório vai logo depois da sua resposta, pelo Regem: diga que ele vai em seguida.' } : {}),
      },
      anexo: {
        pedido: { insumoId: insumo.id, de: p.de, ate: p.ate, loja: loja.atual, compararDe: p2?.de ?? null, compararAte: p2?.ate ?? null },
        enviarPdf: querPdf,
        ...(comImagem ? { grafico } : {}),
      },
    };
  }

  /**
   * O relatório de um insumo como a CONVERSA o pede (o insumo pelo nome que a pessoa disse, o período e a comparação): a
   * permissão, as datas e o insumo conferidos no escopo de quem pergunta. A consulta (`insumo_vendido`) e o link para
   * encaminhar leem por aqui — os dois mostram os mesmos números. `parou` = a recusa ou a pergunta de volta ("qual insumo?").
   */
  private async relatorioDaConversa(
    e: EscopoDoMister,
    en: Record<string, unknown>,
    loja: { atual: string | null; nome: string },
  ): Promise<
    | { r: RelatorioDoInsumo; insumo: { id: string; nome: string; unidade: string }; p: { de: string; ate: string; rotulo: string }; p2: { de: string; ate: string; rotulo: string } | null }
    | { parou: ResultadoDaFerramenta }
  > {
    if (!this.pode(e, 'estoque') && !this.pode(e, 'relatorios_vendas')) return { parou: recusa(SEM_PERMISSAO) };
    const hoje = hojeISO();
    const p = periodoDaFerramenta(en, hoje, 'hoje');
    if ('erro' in p) return { parou: recusa(p.erro) };
    // M3c.2: "compara com outubro" — o outro período, pelas duas datas.
    let p2: { de: string; ate: string; rotulo: string } | null = null;
    if (en.compararDe !== undefined || en.compararAte !== undefined) {
      const c = periodoDaFerramenta({ de: en.compararDe, ate: en.compararAte ?? en.compararDe }, hoje);
      if ('erro' in c) return { parou: recusa(`O período da comparação: ${c.erro}`) };
      p2 = c;
    }
    const insumos = linhas(
      await this.db.execute(sql`
        select id::text as id, nome, nome_comercial as "nomeComercial", unidade_medida as "unidade" from item_estoque
         where tenant_id = ${e.tenantId}::uuid and deleted_at is null
         order by nome limit 2000`),
    );
    const achado = acharInsumo(en.insumo, insumos);
    if (achado.tipo === 'nenhum') return { parou: recusa(`Não achei esse insumo no estoque. Pergunte o nome como está em Estoque › Produtos.`) };
    if (achado.tipo === 'escolher')
      return { parou: { ok: true, dados: { precisaEscolher: achado.opcoes, siga: 'Pergunte qual destes insumos a pessoa quis dizer, com os nomes como vieram, e consulte de novo com o escolhido.' } } };
    const achadoNoEstoque = insumos.find((i) => i.id === achado.id)!;
    // Como vieram do cadastro (a mesma leitura de antes de a consulta e o link dividirem este caminho).
    const insumo: { id: string; nome: string; unidade: string } = { id: achadoNoEstoque.id, nome: achadoNoEstoque.nome, unidade: achadoNoEstoque.unidade };
    return { r: await this.lerRelatorioDoInsumo(e, insumo, p, loja, p2), insumo, p, p2 };
  }

  /**
   * A leitura do relatório de um insumo (M3c): a MESMA para a resposta da conversa, o PDF e o toque em "PDF". O total é o
   * que a venda REALMENTE baixou (a saída de venda de cada comanda fechada no período, menos o estorno — a definição de
   * venda dos relatórios: comanda fechada, pela hora do fechamento, no fuso da loja). "De onde saiu" é a ficha de cada
   * produto vendido, pela mesma conta da baixa (`VendasService.consumoPorUnidade`); o resto vai em "outros".
   */
  private async lerRelatorioDoInsumo(
    e: EscopoDoMister,
    insumo: { id: string; nome: string; unidade: string },
    p: { de: string; ate: string; rotulo: string },
    loja: { atual: string | null; nome: string },
    p2: { de: string; ate: string; rotulo: string } | null,
  ): Promise<RelatorioDoInsumo> {
    const hoje = hojeISO();
    const umDia = p.de === p.ate;
    const ehHoje = umDia && p.de === hoje;
    const agora = horaAgora();
    const ate = ehHoje ? `${hoje} ${agora}:59` : `${p.ate} 23:59:59`;

    // O consumo líquido do insumo por comanda fechada (a saída da venda menos o estorno), agrupado.
    const consumo = (de: string, fim: string, grupo: 'hora' | 'dia' | 'total') =>
      this.db.execute(sql`
        select ${grupo === 'hora' ? sql`extract(hour from c.fechada_em at time zone ${FUSO_SQL})::int` : grupo === 'dia' ? sql`to_char(c.fechada_em at time zone ${FUSO_SQL}, 'YYYY-MM-DD')` : sql`0`} as g,
               coalesce(sum(s.quantidade::numeric - coalesce(est.q, 0)), 0)::float as q
          from comanda c
          join movimento_estoque s
            on s.tenant_id = c.tenant_id and s.ref_tipo = 'venda' and s.ref_id = c.id and s.item_id = ${insumo.id}::uuid and s.tipo = 'saida'
          left join lateral (
            select sum(x.quantidade::numeric) as q from movimento_estoque x
             where x.tenant_id = c.tenant_id and x.ref_tipo = 'estorno' and x.ref_id = c.id and x.item_id = ${insumo.id}::uuid and x.tipo = 'entrada'
          ) est on true
         where c.tenant_id = ${e.tenantId}::uuid and c.status = 'fechada' ${sqlUnidade('c.unidade_id', loja.atual)}
           and ${noPeriodo('c.fechada_em', de, fim)}
         group by 1 order by 1`);
    const grupos = linhas(await consumo(`${p.de} 00:00:00`, ate, umDia ? 'hora' : 'dia'));
    const total = quantidade(grupos.reduce((a, l) => a + Number(l.q || 0), 0));

    // Os produtos vendidos no período (produto e variação) e o consumo de uma unidade de cada, pela ficha.
    const vendidos = linhas(
      await this.db.execute(sql`
        select ci.produto_id::text as "produtoId", ci.variacao_id::text as "variacaoId",
               coalesce(p.nome, min(ci.descricao)) || coalesce(' · ' || v.nome, '') as nome, sum(ci.quantidade::numeric)::float as q
          from comanda_item ci
          join comanda c on c.id = ci.comanda_id
          left join produto p on p.id = ci.produto_id and p.tenant_id = c.tenant_id
          left join produto_variacao v on v.id = ci.variacao_id and v.tenant_id = c.tenant_id
         where c.tenant_id = ${e.tenantId}::uuid and c.status = 'fechada' ${sqlUnidade('c.unidade_id', loja.atual)}
           and ${noPeriodo('c.fechada_em', `${p.de} 00:00:00`, ate)} and ci.produto_id is not null
         group by ci.produto_id, ci.variacao_id, p.nome, v.nome
         order by q desc limit 80`),
    );
    const porUnidade = total > 0 ? await this.vendas.consumoPorUnidade(e.tenantId, vendidos.map((v) => ({ produtoId: v.produtoId, variacaoId: v.variacaoId ?? null }))) : new Map();
    const origem = deOndeSairam(
      total,
      vendidos.map((v) => ({ produto: String(v.nome ?? ''), vendidos: Number(v.q) || 0, porUnidade: porUnidade.get(`${v.produtoId}|${v.variacaoId ?? ''}`)?.get(insumo.id) ?? 0 })),
    );

    // O total em quilos (pela conversão do cadastro) e, num dia, o mesmo dia das 4 semanas anteriores (até a mesma hora, hoje).
    const conversoes = linhas(
      await this.db.execute(sql`
        select unidade_de as "unidadeDe", fator, unidade_para as "unidadePara" from item_conversao
         where tenant_id = ${e.tenantId}::uuid and item_id = ${insumo.id}::uuid`),
    );
    const quilos = emQuilos(total, insumo.unidade, conversoes, insumo.nome);
    let semanas: RelatorioDoInsumo['semanas'] = null;
    if (umDia) {
      const anteriores: number[] = [];
      for (const k of [1, 2, 3, 4]) {
        const dia = somarDias(p.de, -7 * k);
        const [l] = linhas(await consumo(`${dia} 00:00:00`, ehHoje ? `${dia} ${agora}:59` : `${dia} 23:59:59`, 'total'));
        anteriores.push(Number(l?.q ?? 0));
      }
      const c = comparacaoComAsSemanas(total, anteriores);
      const nomeDoDia = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'][new Date(`${p.de}T12:00:00Z`).getUTCDay()];
      if (c) semanas = { media: c.media, diferencaPct: c.diferencaPct, contra: `${nomeDoDia} anteriores${ehHoje ? ', até a mesma hora' : ''}` };
    }
    // "compara com outubro": o total do outro período (inteiro: um período fechado no passado).
    let comparado: RelatorioDoInsumo['comparado'] = null;
    if (p2) {
      const [l] = linhas(await consumo(`${p2.de} 00:00:00`, `${p2.ate} 23:59:59`, 'total'));
      const total2 = quantidade(Number(l?.q ?? 0));
      const dias = Math.round((Date.parse(`${p2.ate}T12:00:00Z`) - Date.parse(`${p2.de}T12:00:00Z`)) / 86_400_000) + 1;
      comparado = { periodo: p2.rotulo, total: total2, dias, diferencaPct: total2 > 0 ? Math.round(((total - total2) / total2) * 100) : null };
    }
    return {
      loja: loja.nome,
      periodo: p.rotulo,
      ateAs: ehHoje ? agora : null,
      insumo,
      total,
      kg: quilos.kg,
      cercaDeUnidades: quilos.cercaDeUnidades,
      serie: umDia
        ? { por: 'hora', pontos: seriePorHora(grupos.map((l) => ({ hora: Number(l.g), quantidade: Number(l.q) || 0 }))) }
        : { por: 'dia', pontos: seriePorDia(grupos.map((l) => ({ dia: String(l.g), quantidade: Number(l.q) || 0 })), p.de, p.ate) },
      deOndeSaiu: origem.produtos,
      outros: origem.outros,
      semanas,
      comparado,
    };
  }

  /**
   * M3c.2 — o PDF do relatório de um insumo, refeito NO ESCOPO de quem pede (o toque em "PDF" ou o "manda em PDF"): a
   * permissão, a loja e as datas são conferidas de novo; o insumo tem de ser da empresa da pessoa. Nunca lança por dado
   * torto: devolve a frase para a conversa.
   */
  async pdfDoInsumo(e: EscopoDoMister, pedido: PedidoDoRelatorio): Promise<{ pdf: Buffer; nome: string; legenda: string } | { erro: string }> {
    const r = await this.relatorioDoPedido(e, pedido);
    if ('erro' in r) return r;
    return { pdf: await gerarPdfDoInsumo(r.plano, r.nome), nome: r.nome, legenda: r.plano.titulo };
  }

  /**
   * M3c.4 — a página do relatório no Regem ("Ver no Regem"): o MESMO plano do PDF (os textos, os números e as barras),
   * refeito no escopo de quem abre, com as mesmas conferências do PDF.
   */
  async relatorioDoPedido(e: EscopoDoMister, pedido: PedidoDoRelatorio): Promise<{ plano: PlanoDoPdfDoInsumo; nome: string; relatorio: RelatorioDoInsumo } | { erro: string }> {
    if (e.semLoja) return { erro: SEM_LOJA };
    if (!this.pode(e, 'estoque') && !this.pode(e, 'relatorios_vendas')) return { erro: SEM_PERMISSAO };
    // A loja do pedido tem de ser uma que a pessoa consulta (a presa, ou uma das lojas dela; a loja única = sem filtro).
    let loja: { atual: string | null; nome: string };
    if (e.lojaUnica) loja = { atual: null, nome: e.lojas[0]?.nome ?? e.empresa };
    else if (e.presa) {
      if (pedido.loja && pedido.loja !== e.presa) return { erro: 'Este relatório é de uma loja que você não consulta.' };
      loja = { atual: e.presa, nome: e.lojas[0]?.nome ?? e.empresa };
    } else if (!pedido.loja) loja = { atual: null, nome: 'todas as lojas' };
    else {
      const l = e.lojas.find((x) => x.id === pedido.loja);
      if (!l) return { erro: 'Este relatório é de uma loja que você não consulta.' };
      loja = { atual: l.id, nome: l.nome };
    }
    const hoje = hojeISO();
    const p = periodoDaFerramenta({ de: pedido.de, ate: pedido.ate }, hoje);
    if ('erro' in p) return { erro: p.erro };
    let p2: { de: string; ate: string; rotulo: string } | null = null;
    if (pedido.compararDe) {
      const c = periodoDaFerramenta({ de: pedido.compararDe, ate: pedido.compararAte ?? pedido.compararDe }, hoje);
      if ('erro' in c) return { erro: c.erro };
      p2 = c;
    }
    const [insumo] = linhas(
      await this.db.execute(sql`
        select id::text as id, nome, unidade_medida as "unidade" from item_estoque
         where id = ${pedido.insumoId}::uuid and tenant_id = ${e.tenantId}::uuid and deleted_at is null`),
    );
    if (!insumo) return { erro: 'Este insumo não está mais no estoque.' };
    const r = await this.lerRelatorioDoInsumo(e, insumo, p, loja, p2);
    const plano = planoDoPdfDoInsumo(r, { empresa: e.empresa, pedidoPor: e.nome, geradoEm: new Date().toISOString() });
    return { plano, nome: nomeDoPdfDoInsumo(r, p.de, p.ate), relatorio: r };
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
          ? { comoAparece: pedidoComoNoQuadro(antigo), plataforma: String(antigo.canal ?? ''), numero: antigo.displayId ? String(antigo.displayId) : null, situacao: SITUACAO_DO_DELIVERY[String(antigo.status)], haMinutos: minutosDesde(antigo.criadoEm, agora) }
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
    // Atrasados pela MESMA regra do KDS (o vermelho ou o tempo de preparo do próprio pedido), um por pedido.
    const limitesDoKds: LimitesDoKds = { verdeAteMin: Number(fila?.cores?.verdeAteMin) || 5, amareloAteMin: Number(fila?.cores?.amareloAteMin) || 10 };
    const atrasados = [...porPedido.values()]
      .map((c) => ({ c, atraso: c.status === 'pronto' ? null : atrasoNaCozinha(c, agora, limitesDoKds) }))
      .filter((x) => x.atraso)
      .sort((a, b) => b.atraso!.minutos - a.atraso!.minutos);
    const senhaDe = (c: any) => (c.senha != null ? `${c.senhaPrefixo ?? ''}${c.senha}` : c.senhaPlataforma ? String(c.senhaPlataforma) : null);
    // O pedido do canal ligado a cada cartão (pela comanda), para citar como o quadro do Delivery mostra. Venda do balcão
    // não tem pedido de canal: fica a senha.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const comandas = [...new Set([fazendo, ...atrasados.slice(0, 5).map((x) => x.c)].map((c) => c?.comandaId).filter((id) => typeof id === 'string' && UUID.test(id)))];
    const doQuadro = new Map<string, string>(
      comandas.length
        ? linhas(
            await this.db.execute(sql`
              select distinct on (comanda_id) comanda_id::text as comanda, canal, numero, display_id as "displayId"
                from pedido_externo
               where tenant_id = ${e.tenantId}::uuid and comanda_id in (${sql.join(
                 comandas.map((id) => sql`${id}::uuid`),
                 sql`, `,
               )})
               order by comanda_id, criado_em desc`),
          ).map((x) => [String(x.comanda), pedidoComoNoQuadro(x)])
        : [],
    );
    const comoAparece = (c: any) => (c?.comandaId && doQuadro.get(String(c.comandaId))) || (c?.origem === 'delivery' ? null : `venda do balcão, senha ${senhaDe(c) ?? '—'}`);
    dados.cozinha = {
      pedidos: porPedido.size,
      porSituacao: naCozinha,
      maisAntigoSemFicarPronto: fazendo
        ? {
            comoAparece: comoAparece(fazendo),
            origem: String(fazendo.plataforma || fazendo.origem || ''),
            senhaNaCozinha: senhaDe(fazendo),
            situacao: SITUACAO_DA_COZINHA[String(fazendo.status)],
            haMinutos: minutosDesde(fazendo.criadoEm, agora),
          }
        : null,
      atrasadosAgora: {
        total: atrasados.length,
        regra: `Pela regra do KDS desta loja: verde até ${limitesDoKds.verdeAteMin} min, amarelo até ${limitesDoKds.amareloAteMin} min, depois vermelho; ou passou do tempo de preparo do próprio pedido.`,
        pedidos: atrasados.slice(0, 5).map(({ c, atraso }) => ({
          comoAparece: comoAparece(c),
          origem: String(c.plataforma || c.origem || ''),
          senhaNaCozinha: senhaDe(c),
          situacao: SITUACAO_DA_COZINHA[String(c.status)],
          haMinutos: atraso!.minutos,
          porque: atraso!.motivo === 'passou_do_preparo' ? `passou do tempo de preparo (${atraso!.limiteMin} min)` : `passou do vermelho do KDS (${atraso!.limiteMin} min)`,
        })),
      },
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
   * Os tempos dos pedidos de um período, para "o delivery está demorando?" e "quanto tempo leva a cozinha?": do aceite,
   * até ficar pronto, até sair e até entregar (os pedidos dos canais) e a fila e o preparo na cozinha — a média e o tempo
   * dos 10% mais lentos. Não há tela com isto: a consulta é do Mister, sobre os horários que o pedido e o cartão já
   * guardam. Encomenda fica de fora (o tempo dela não é espera); tempo negativo ou acima de 12 horas é dado torto.
   */
  private async temposDosPedidos(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    const p = periodoDaFerramenta(en, hojeISO(), 'hoje');
    if ('erro' in p) return recusa(p.erro);
    const ini = `${p.de} 00:00:00`;
    const fim = `${p.ate} 23:59:59`;
    /** As três colunas de uma medida (média, os 10% mais lentos, quantos) sobre a coluna de minutos `m` e a de válido `v`. */
    const medida = (nome: string) =>
      sql.raw(`round((avg(m_${nome}) filter (where v_${nome}))::numeric, 1)::float8 as "${nome}Media",
        round((percentile_cont(0.9) within group (order by m_${nome}) filter (where v_${nome}))::numeric, 1)::float8 as "${nome}Lentos",
        (count(*) filter (where v_${nome}))::int as "${nome}N"`);
    const entre = (nome: string, de: string, ate: string, onde = 'true') =>
      sql.raw(`extract(epoch from (${ate} - ${de})) / 60.0 as m_${nome},
        (${ate} is not null and ${ate} >= ${de} and ${ate} - ${de} < interval '12 hours' and ${onde}) as v_${nome}`);
    const tres = (l: any, nome: string) => ({ mediaMin: l?.[`${nome}Media`] ?? null, osMaisLentosMin: l?.[`${nome}Lentos`] ?? null, pedidos: Number(l?.[`${nome}N`]) || 0 });
    const dados: Record<string, unknown> = {
      loja: loja.nome,
      periodo: p.rotulo,
      comoLer: '"osMaisLentosMin" é o tempo a partir do qual estão os 10% de pedidos mais lentos; "pedidos" é quantos entraram na conta. Encomendas ficam de fora.',
    };

    if (this.pode(e, 'delivery')) {
      const porCanal = linhas(
        await this.db.execute(sql`
          select canal, count(*)::int as pedidos, ${medida('aceite')}, ${medida('pronto')}, ${medida('saiu')}, ${medida('entregue')}
            from (
              select coalesce(pe.canal, 'outro') as canal,
                     ${entre('aceite', 'pe.criado_em', 'pe.confirmado_em')},
                     ${entre('pronto', 'pe.criado_em', 'pe.pronto_em')},
                     ${entre('saiu', 'pe.criado_em', 'pe.despachado_em', "pe.tipo <> 'retirada'")},
                     ${entre('entregue', 'pe.criado_em', 'coalesce(pe.entregue_em, pe.concluido_em)', "pe.tipo <> 'retirada'")}
                from pedido_externo pe
               where pe.tenant_id = ${e.tenantId}::uuid and pe.deleted_at is null and pe.agendamento is null and ${pedidoVale('pe')}
                 ${sqlUnidadeOuRede('pe.unidade_id', loja.atual)} and ${noPeriodo('pe.criado_em', ini, fim)}
            ) x
           group by grouping sets ((canal), ())
           order by canal nulls first`),
      );
      const total = porCanal.find((l) => l.canal === null);
      dados.pedidosDosCanais = {
        pedidos: Number(total?.pedidos) || 0,
        doAceite: tres(total, 'aceite'),
        ateFicarPronto: tres(total, 'pronto'),
        ateSairParaEntrega: tres(total, 'saiu'),
        ateEntregar: tres(total, 'entregue'),
        porCanal: porCanal
          .filter((l) => l.canal !== null)
          .map((l) => ({ canal: CANAL_NA_TELA[String(l.canal)] ?? String(l.canal), pedidos: Number(l.pedidos) || 0, ateFicarPronto: tres(l, 'pronto'), ateEntregar: tres(l, 'entregue') })),
      };
    } else dados.pedidosDosCanais = { aviso: SEM_PERMISSAO };

    // A cozinha: o tempo na fila (até começar) e o preparo (até ficar pronto), pelo cartão de cada estação.
    const cozinha = linhas(
      await this.db.execute(sql`
        select onde, count(*)::int as cartoes, ${medida('fila')}, ${medida('preparo')}, ${medida('total')}
          from (
            select case when pp.origem = 'delivery' then 'delivery' else 'balcão e mesas' end as onde,
                   ${entre('fila', 'pp.criado_em', 'pp.iniciado_em')},
                   ${entre('preparo', 'pp.iniciado_em', 'pp.pronto_em')},
                   ${entre('total', 'pp.criado_em', 'pp.pronto_em')}
              from producao_pedido pp
             where pp.tenant_id = ${e.tenantId}::uuid and pp.destino_tipo = 'kds' and pp.status <> 'cancelado'
               ${sqlUnidade('pp.unidade_id', loja.atual)} and ${noPeriodo('pp.criado_em', ini, fim)}
               and not exists (select 1 from pedido_externo ag where ag.tenant_id = pp.tenant_id and ag.comanda_id = pp.comanda_id and ag.agendamento is not null)
          ) x
         group by grouping sets ((onde), ())
         order by onde nulls first`),
    );
    const daCozinha = cozinha.find((l) => l.onde === null);
    dados.cozinha = {
      cartoes: Number(daCozinha?.cartoes) || 0,
      naFilaAteComecar: tres(daCozinha, 'fila'),
      preparando: tres(daCozinha, 'preparo'),
      daEntradaAtePronto: tres(daCozinha, 'total'),
      porOrigem: cozinha.filter((l) => l.onde !== null).map((l) => ({ origem: String(l.onde), cartoes: Number(l.cartoes) || 0, daEntradaAtePronto: tres(l, 'total') })),
      ...(daCozinha && Number(daCozinha.cartoes) > 0 ? {} : { observacao: 'Nenhum cartão no KDS neste período: a cozinha não usa o KDS ou não houve pedido.' }),
    };
    return { ok: true, dados };
  }

  /**
   * A história de um pedido, para "por que o pedido X atrasou": os horários de cada etapa (chegou, aceito, entrou na
   * cozinha, começou, pronto, saiu, entregue), as estações da cozinha por onde passou e onde demorou. Procura nos
   * últimos 3 dias da loja, pelo número do canal, pelo número do dia ou pela senha da cozinha (B12, D12).
   */
  private async historiaDoPedido(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    const n = numeroDoPedido(en.numero);
    if (!n) return recusa('Diga o número do pedido (o do canal, o número do dia ou a senha da cozinha, como D12).');
    const soNumero = n.replace(/^[A-Z]/, '');
    const recentes = sql`> now() - interval '3 days'`;
    // 1) O pedido dos canais: pelo número do canal (display_id) ou pelo número do dia.
    const doCanal = linhas(
      await this.db.execute(sql`
        select pe.id, pe.canal, pe.display_id as "displayId", pe.numero, pe.tipo, pe.status, pe.comanda_id as "comandaId",
               pe.criado_em as "criadoEm", pe.confirmado_em as "confirmadoEm", pe.pronto_em as "prontoEm",
               pe.despachado_em as "despachadoEm", pe.entregue_em as "entregueEm", pe.concluido_em as "concluidoEm",
               pe.cancelado_em as "canceladoEm", pe.agendamento, left(pe.motivo_cancelamento, 120) as motivo
          from pedido_externo pe
         where pe.tenant_id = ${e.tenantId}::uuid and pe.deleted_at is null ${sqlUnidadeOuRede('pe.unidade_id', loja.atual)}
           and pe.criado_em ${recentes}
           and (upper(pe.display_id) = ${n} or pe.display_id = ${soNumero} or pe.numero::text = ${soNumero})
         order by pe.criado_em desc
         limit 6`),
    );
    // 2) Sem pedido de canal: o cartão da cozinha pela senha (a venda do balcão e da mesa não tem pedido de canal).
    const cartoesPelaSenha = doCanal.length
      ? []
      : linhas(
          await this.db.execute(sql`
            select distinct on (coalesce(pp.comanda_id, pp.id)) pp.comanda_id as "comandaId", pp.id, pp.origem, pp.plataforma, pp.criado_em as "criadoEm",
                   coalesce(pp.senha_prefixo, '') || coalesce(pp.senha::text, '') as senha
              from producao_pedido pp
             where pp.tenant_id = ${e.tenantId}::uuid ${sqlUnidade('pp.unidade_id', loja.atual)} and pp.criado_em ${recentes}
               and (upper(coalesce(pp.senha_prefixo, '') || coalesce(pp.senha::text, '')) = ${n} or pp.senha::text = ${n} or upper(pp.senha_plataforma) = ${n})
             order by coalesce(pp.comanda_id, pp.id), pp.criado_em desc
             limit 6`),
        );
    const achados = doCanal.length || cartoesPelaSenha.length;
    if (!achados) return recusa(`Não achei pedido com o número ${n} nos últimos 3 dias em ${loja.nome}.`);
    if (achados > 1) {
      // Mais de um com o mesmo número (o número do dia volta a 1 todo dia): a pessoa escolhe.
      const lista = doCanal.length
        ? doCanal.map((p) => ({ comoAparece: pedidoComoNoQuadro(p), canal: String(p.canal ?? ''), numero: String(p.displayId ?? p.numero ?? ''), chegou: dataHoraCurta(p.criadoEm), situacao: SITUACAO_DO_PEDIDO[String(p.status)] ?? String(p.status) }))
        : cartoesPelaSenha.map((c) => ({ origem: String(c.plataforma || c.origem || ''), senha: String(c.senha ?? ''), chegou: dataHoraCurta(c.criadoEm) }));
      return { ok: true, dados: { loja: loja.nome, maisDeUmPedido: lista, observacao: 'Pergunte qual deles, pelo horário em que chegou.' } };
    }

    const pe = doCanal[0] ?? null;
    if (pe && !this.pode(e, 'delivery')) return recusa(SEM_PERMISSAO);
    const comandaId: string | null = pe ? (pe.comandaId ?? null) : (cartoesPelaSenha[0].comandaId ?? null);
    const cartaoSolto: string | null = pe ? null : comandaId ? null : String(cartoesPelaSenha[0].id);

    // Os cartões da cozinha do pedido (um por estação), com o nome da estação em que está e das que já passou.
    const cartoes =
      comandaId || cartaoSolto
        ? linhas(
            await this.db.execute(sql`
              select pp.id, pp.status, pp.criado_em as "criadoEm", pp.iniciado_em as "iniciadoEm", pp.pronto_em as "prontoEm",
                     pp.entregue_em as "entregueEm", pp.tempo_preparo_min as "tempoPreparoMin", pp.estacoes,
                     coalesce(pp.senha_prefixo, '') || coalesce(pp.senha::text, '') as senha,
                     eq.nome as estacao, st.nome as setor
                from producao_pedido pp
                left join equipamento eq on eq.id = pp.destino_equipamento_id and eq.tenant_id = pp.tenant_id
                left join setor st on st.id = pp.setor_id and st.tenant_id = pp.tenant_id
               where pp.tenant_id = ${e.tenantId}::uuid and pp.destino_tipo = 'kds'
                 and ${comandaId ? sql`pp.comanda_id = ${comandaId}::uuid` : sql`pp.id = ${cartaoSolto}::uuid`}
               order by pp.criado_em`),
          )
        : [];
    const idsDasEstacoes = [...new Set(cartoes.flatMap((c) => lerEstacoes(c.estacoes).map((x) => x.kds)))];
    const nomes = idsDasEstacoes.length
      ? new Map(
          linhas(
            await this.db.execute(sql`select id::text as id, nome from equipamento where tenant_id = ${e.tenantId}::uuid and id in (${sql.join(
              idsDasEstacoes.map((i) => sql`${i}::uuid`),
              sql`, `,
            )})`),
          ).map((x) => [String(x.id), String(x.nome)]),
        )
      : new Map<string, string>();
    const limites = (await this.producao.getCores(e.tenantId, loja.atual)) as LimitesDoKds;
    const agora = Date.now();
    const encomendaPara = pe?.agendamento ?? null;
    const quando = (v: unknown) => (v ? dataHoraCurta(v) : null);
    const data = (v: unknown): Date | null => (v ? new Date(v as any) : null);
    const minimo = (campo: string) => cartoes.map((c) => data(c[campo])).filter((d): d is Date => !!d && !Number.isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const maximo = (campo: string) => cartoes.map((c) => data(c[campo])).filter((d): d is Date => !!d && !Number.isNaN(d.getTime())).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const etapas: EtapaDoPedido[] = [
      { etapa: 'chegou', em: data(pe?.criadoEm) ?? minimo('criadoEm') },
      ...(pe ? [{ etapa: 'aceito', em: data(pe.confirmadoEm) }] : []),
      { etapa: 'entrou na cozinha', em: minimo('criadoEm') },
      { etapa: 'começou a ser feito', em: minimo('iniciadoEm') },
      { etapa: 'ficou pronto', em: data(pe?.prontoEm) ?? (cartoes.length && cartoes.every((c) => c.prontoEm || c.status === 'entregue') ? maximo('prontoEm') : null) },
      ...(pe ? [{ etapa: 'saiu para entrega', em: data(pe.despachadoEm) }, { etapa: 'entregue', em: data(pe.entregueEm) ?? data(pe.concluidoEm) }] : []),
    ];
    const conta = ondeDemorou(etapas);
    const naCozinhaAgora = cartoes.filter((c) => c.status === 'recebido' || c.status === 'preparo');

    return {
      ok: true,
      dados: {
        loja: loja.nome,
        pedido: pe
          ? {
              comoAparece: pedidoComoNoQuadro(pe),
              ...(cartoes.length && cartoes[0].senha ? { senhaNaCozinha: String(cartoes[0].senha) } : {}),
              canal: String(pe.canal ?? ''),
              numero: String(pe.displayId ?? pe.numero ?? ''),
              tipo: pe.tipo === 'retirada' ? 'retirada' : 'entrega',
              situacao: SITUACAO_DO_PEDIDO[String(pe.status)] ?? String(pe.status),
              ...(pe.status === 'cancelado' ? { cancelado: quando(pe.canceladoEm), motivo: pe.motivo ? String(pe.motivo) : 'sem motivo anotado' } : {}),
            }
          : { comoAparece: `venda do balcão, senha ${String(cartoesPelaSenha[0].senha ?? '')}`, origem: String(cartoesPelaSenha[0].plataforma || cartoesPelaSenha[0].origem || 'balcão'), senha: String(cartoesPelaSenha[0].senha ?? '') },
        ...(encomendaPara ? { encomendaPara: quando(encomendaPara), observacao: `É encomenda: na cozinha o tempo só começa ${PREPARO_DA_ENCOMENDA_MIN} minutos antes do horário marcado.` } : {}),
        horarios: etapas.map((x) => ({ etapa: x.etapa, hora: quando(x.em) })),
        tempoEntreAsEtapas: conta.trechos.map((t) => ({ de: t.de, ate: t.ate, minutos: t.minutos })),
        ondeDemorouMais: conta.maior,
        cozinha: cartoes.map((c) => {
          const atraso = c.status === 'recebido' || c.status === 'preparo' ? atrasoNaCozinha({ ...c, encomendaPara }, agora, limites) : null;
          return {
            estacao: String(c.estacao || c.setor || 'cozinha'),
            situacao: SITUACAO_DA_COZINHA[String(c.status)] ?? (c.status === 'entregue' ? 'entregue' : String(c.status)),
            entrou: quando(c.criadoEm),
            comecou: quando(c.iniciadoEm),
            pronto: quando(c.prontoEm),
            tempoDePreparoPrevistoMin: Number(c.tempoPreparoMin) > 0 ? Number(c.tempoPreparoMin) : null,
            passouAntesPor: lerEstacoes(c.estacoes).map((x) => ({ estacao: nomes.get(x.kds) ?? 'outra estação', prontoAs: quando(x.pronto), ...(x.forcado ? { encerradoNaMao: true } : {}) })),
            ...(atraso ? { atrasadoAgora: { haMinutos: atraso.minutos, porque: atraso.motivo === 'passou_do_preparo' ? `passou do tempo de preparo (${atraso.limiteMin} min)` : `passou do vermelho do KDS (${atraso.limiteMin} min)` } } : {}),
          };
        }),
        ...(cartoes.length ? {} : { semCozinha: 'Este pedido não passou por nenhum KDS (foi só impresso, ou a cozinha não usa o KDS).' }),
        limitesDoKds: { verdeAteMin: limites.verdeAteMin, amareloAteMin: limites.amareloAteMin },
        ...(naCozinhaAgora.length ? { aindaNaCozinha: true } : {}),
      },
    };
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
        ...(aberto
          ? {
              abertoHaHoras: minutos === null ? null : Math.round(minutos / 6) / 10,
              ...(minutos !== null && minutos >= 48 * 60 ? { abertoHaDias: Math.floor(minutos / 1440) } : {}),
              // A regra do caixa (`common/turno.ts`): passou de 24 h, o Regem pede o fechamento (não trava a venda).
              passouDe24Horas: idadeDoTurno(t.abertaEm, agora).passouDoLimite,
            }
          : { fechadoPor: String(t.fechadaPor ?? ''), fechadoEm: dataHoraCurta(t.fechadaEm) }),
        abertura: reais(t.abertura),
        vendas: reais(t.vendas),
        sangrias: reais(t.sangrias),
        suprimentos: reais(t.suprimentos),
        ...(aberto ? {} : { esperado: reais(t.esperado), informado: reais(t.informado), diferenca: reais(t.diferenca) }),
      };
    };
    // Abertos AGORA, de qualquer idade: o relatório lista o turno pelo dia em que ABRIU, então a janela começa no dia do
    // caixa aberto mais antigo da loja (um caixa esquecido há meses tem de aparecer — ERR-462).
    const [maisAntigo] = linhas(
      await this.db.execute(sql`
        select to_char(min(aberta_em) at time zone ${FUSO_SQL}, 'YYYY-MM-DD') as dia
          from caixa_sessao where tenant_id = ${e.tenantId}::uuid and status = 'aberta' ${sqlUnidade('unidade_id', loja.atual)}`),
    );
    const desde = maisAntigo?.dia ? String(maisAntigo.dia) : null;
    const recentes: any = desde ? await this.relatorios.turnos(e.tenantId, desde < hoje ? desde : hoje, hoje, e.verValores, loja.atual) : { turnos: [] };
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
