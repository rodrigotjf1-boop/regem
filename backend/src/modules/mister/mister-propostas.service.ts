import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash, randomBytes } from 'crypto';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { horaNoFuso } from '../../common/data';
import { enfileirarComandoEdge } from '../../common/edge-comando';
import { PIN_INVALIDO, autorizarPorPinDoUsuario } from '../../common/autorizacao-gestor';
import { uuidDeChave } from '../../common/id-deterministico';
import { pagoNoPixOnline } from '../../common/prazo-estorno-pix';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { DeliveryService } from '../delivery/delivery.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ModuloService } from '../modulo/modulo.service';
import { CANAL_NA_TELA, pedidoComoNoQuadro } from './mister-agente.regras';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { pessoaVale } from './mister-vinculo.service';
import {
  CANAIS_DE_FORA,
  EstadoDoLink,
  PIN_TENTATIVAS,
  PREFIXO_DO_BOTAO,
  PROCEDIMENTOS,
  PROVEDOR_NA_TELA,
  PedidoDoCancelamento,
  ProcedimentoDoMister,
  TEXTOS_DA_PROPOSTA,
  TEXTOS_DO_CANCELAMENTO,
  TEXTOS_DO_LINK,
  TEXTOS_DO_REINICIO,
  apresentacaoDaProposta,
  apresentacaoDoCancelamento,
  nomeCurtoDoCliente,
  botoesDaProposta,
  caminhoDoLink,
  ehCodigoDoLink,
  ehPinValido,
  estadoDoLink,
  lerBotao,
  perguntaDaProposta,
  propostaDoAviso,
  reinicioServe,
  resultadoDaConsulta,
  servidorDoAviso,
  tentativasQueRestam,
  textoDoDesfecho,
  TEXTOS_DA_SESSAO,
} from './mister-procedimentos';
import { estadoDaSessao } from './mister-sessao';
import { apresentacaoDaConta, apresentacaoDoCupom } from './mister-acoes-loja';
import { apresentacaoDaClassificacao } from './mister-acoes-banco';
import { ACOES_DE_PIN, TEXTOS_DAS_ACOES, apresentacaoDaBaixa, apresentacaoDoHorario, apresentacaoDoPreco, ehAcaoDoMister, ehDadoInformado } from './mister-acoes';
import { PROCEDIMENTO_DO_PLANO, RESULTADO_DO_PLANO_TROCADO, TEXTOS_DO_PLANO } from './mister-plano';

/* eslint-disable @typescript-eslint/no-explicit-any */

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';
/** O comando do servidor da loja de cada procedimento da impressora. */
const COMANDO_DA_IMPRESSORA = { imprimir_teste: 'testar_impressora', reiniciar_impressao: 'reiniciar_impressao' } as const;

/** A proposta pendente de um aviso, pronta para ir com ele: a pergunta e os botões. */
export interface PropostaPendente {
  id: string;
  procedimento: ProcedimentoDoMister;
  /** botao: vai com "Autorizar" e "Não agora"; pin (F4.2): vai com o link "Abrir no Regem" (`enviarLink`), sem botões. */
  nivel: 'botao' | 'pin';
  pergunta: string;
  botoes: { id: string; titulo: string }[];
}

/** O pedido que a proposta de cancelamento quer cancelar, como o banco o tem agora (F4.2b). */
interface PedidoLido extends PedidoDoCancelamento {
  id: string;
  status: string;
  /** A linha do estorno do Pix (só nuvem), quando já existe: pendente | processando | feito | falhou. */
  estorno: string | null;
  estornoErro: string | null;
}

/** O que a página do link (`/m/<código>`, F4.2a) mostra — decidido no servidor; a página nunca sabe o PIN certo. */
export interface VistaDoLink {
  estado: EstadoDoLink;
  empresa: string;
  titulo: string;
  itens: string[];
  detalhe: string | null;
  valor: number | null;
  /** O rótulo do botão de autorizar ("Autorizar o cancelamento"). */
  botao: string;
  /** "Pedido pelo Mister às 21:02, para Ana (presidente)." */
  pedidoPor: string;
  valeAte: string;
  valeAteHora: string;
  /** As tentativas de PIN que ainda restam neste link. */
  restam: number;
  resultado: string | null;
  /** A hora em que a proposta terminou (feita, não deu, recusada, bloqueada). */
  concluidaHora: string | null;
  /** Quem respondeu e quando (os 4 últimos dígitos do telefone, nunca o número inteiro). */
  respondida: { hora: string; nome: string; final: string | null } | null;
  /** A frase do PIN errado, na resposta de "Autorizar". */
  erro: string | null;
}

/** O resumo do código do link: o banco guarda só ele (o código inteiro nunca fica guardado). */
const resumoDoCodigo = (codigo: string) => createHash('sha256').update(codigo).digest('hex');
const baseDoApp = () => String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');
const primeiroNome = (nome: unknown) => String(nome ?? '').trim().split(/\s+/)[0] || 'quem recebeu';

/**
 * AS PROPOSTAS DO MISTER (F4.1, mig 428). Nasce com o aviso que um procedimento do catálogo resolve; vai ao presidente com
 * "Autorizar" e "Não agora"; o toque autoriza UMA vez dentro do prazo (gravação condicional); a execução passa pelo serviço
 * da tela; a conferência diz "feito" só com o efeito visto. Tudo da nuvem.
 */
@Injectable()
export class MisterPropostasService implements OnModuleInit {
  private readonly logger = new Logger('MisterPropostas');
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly numero: MisterNumeroService,
    @Optional() private readonly entrada?: MisterEntradaService,
    // O tipo é a classe (o Nest injeta pelo tipo refletido; um `Pick` viraria `Object` e nada seria injetado).
    @Optional() private readonly fiscal?: FiscalService,
    @Optional() private readonly auditoria?: AuditoriaService,
    // F4.2a: o link só vale com o módulo Mister ligado na loja da proposta (desligar corta na hora).
    @Optional() private readonly modulos?: ModuloService,
    // F4.2b: o cancelamento é o MESMO do botão "Cancelar" do painel do Delivery.
    @Optional() private readonly delivery?: DeliveryService,
  ) {}

  // Versão 6, M6j: as ações da porta `propor_acao` moram no `MisterAcoesService`, que se apresenta (nenhum injeta o outro
  // nos dois sentidos). Ele executa pelo serviço da tela, confere o efeito e devolve o desfecho — o "feito" sai daqui.
  private acao: ((p: { id: string; tenantId: string; unidadeId: string | null; procedimento: string; parametros: any; autorizadaPor: string | null }) => Promise<{ feita: boolean; texto: string }>) | null = null;
  registrarAcao(f: (p: { id: string; tenantId: string; unidadeId: string | null; procedimento: string; parametros: any; autorizadaPor: string | null }) => Promise<{ feita: boolean; texto: string }>): void {
    this.acao = f;
  }

  // Versão 7, V7c: o plano (várias ações num botão) mora no `MisterPlanosService`, que se apresenta como as ações. Aqui passam
  // o toque no plano e o fim de cada passo; a execução de cada passo continua sendo o `executar` daqui.
  private plano: ((id: string) => Promise<void>) | null = null;
  registrarPlano(f: (id: string) => Promise<void>): void {
    this.plano = f;
  }
  /** Um passo do plano terminou (feito, não deu, recusado ou vencido): o plano segue. Não segura quem chamou. */
  private planoAndou(planoId: unknown): void {
    if (typeof planoId !== 'string' || !this.plano) return;
    void this.plano(planoId).catch((e) => this.logger.error(`o plano ${planoId} não andou — ${e?.message ?? e}`));
  }

  /** O toque num botão de proposta chega pela entrada do WhatsApp, que mora no módulo de baixo. */
  onModuleInit(): void {
    this.entrada?.registrarBotao(PREFIXO_DO_BOTAO, (botaoId, quem) => this.responder(botaoId, quem));
  }

  // ───────────────────────────── propor ─────────────────────────────

  /**
   * A proposta de um aviso aberto, se um procedimento do catálogo o resolve. Uma por aviso e procedimento (índice único):
   * a volta repetida devolve a mesma. A que VENCEU sem resposta renova quando o aviso vai de novo a quem autoriza (o
   * toque no modelo horas depois, a escalada) — a respondida nunca renova. Só devolve a que espera resposta.
   */
  async propor(a: { id: string; tenantId: string; unidadeId: string | null; tipo: string; chave: string }): Promise<PropostaPendente | null> {
    const p = propostaDoAviso(a, { reinicioServe: await this.reinicioServe(a) });
    if (!p) return null;
    const proc = PROCEDIMENTOS[p.procedimento];
    try {
      await this.db.execute(sql`
        insert into mister_proposta (tenant_id, unidade_id, aviso_id, procedimento, parametros, nivel, vence_em)
        values (${a.tenantId}::uuid, ${a.unidadeId}::uuid, ${a.id}::uuid, ${p.procedimento}, ${JSON.stringify(p.parametros)}::jsonb, ${proc.nivel},
                clock_timestamp() + make_interval(mins => ${proc.prazoMin}::int))
        on conflict (aviso_id, procedimento) do update
          set situacao = 'proposta', vence_em = excluded.vence_em, concluida_em = null, resultado = null
          where mister_proposta.situacao = 'vencida' or (mister_proposta.situacao = 'proposta' and mister_proposta.vence_em <= now())`);
      return await this.pendenteDoAviso(a.id);
    } catch (e: any) {
      if (!semTabela(e)) this.logger.warn(`a proposta do aviso ${a.id} não foi criada — ${e?.message ?? e}`);
      return null;
    }
  }

  /**
   * F4.4: o aviso da impressora pede o reinício do serviço de impressão? Pelo motivo do vigia (a que parou de responder)
   * e pela versão que o servidor da loja do aviso informou por último (`edge_status`). Sem a tabela (o banco do servidor
   * da loja) ou sem a versão, não: fica a via de teste.
   */
  private async reinicioServe(a: { id: string; tenantId: string; tipo: string; chave: string }): Promise<boolean> {
    const servidor = servidorDoAviso(a);
    if (!servidor) return false;
    try {
      const [l] = linhas(
        await this.db.execute(sql`
          select (select dados ->> 'motivo' from mister_aviso where id = ${a.id}::uuid) as motivo,
                 (select versao from edge_status where equipamento_id = ${servidor}::uuid and tenant_id = ${a.tenantId}::uuid) as versao`),
      );
      return reinicioServe({ motivo: l?.motivo, versao: l?.versao });
    } catch (e: any) {
      if (!semTabela(e) && e?.code !== '42703') this.logger.warn(`a versão do servidor do aviso ${a.id} não foi lida — ${e?.message ?? e}`);
      return false;
    }
  }

  /** A proposta do aviso que ainda espera resposta (no prazo); null quando não há. */
  async pendenteDoAviso(avisoId: string): Promise<PropostaPendente | null> {
    const [p] = linhas(
      await this.db.execute(sql`
        select id::text as id, procedimento from mister_proposta
         where aviso_id = ${avisoId}::uuid and situacao = 'proposta' and vence_em > now() and nivel = 'botao'
         order by criada_em limit 1`),
    );
    if (!p || !(p.procedimento in PROCEDIMENTOS)) return null;
    return { id: p.id, procedimento: p.procedimento, nivel: 'botao', pergunta: perguntaDaProposta(p.procedimento), botoes: botoesDaProposta(p.id) };
  }

  /**
   * F4.2b: a proposta de cancelar um pedido (nasce da pergunta, F4.3 — não de aviso). Uma por pedido: o "aviso" da linha é
   * um id fixo do pedido (`uuidDeChave`), e o índice único da 428 não deixa duas. Renova a que acabou sem cancelar
   * (vencida, não autorizada, bloqueada, não deu) e devolve a que ainda espera — a autorizada, a executando e a feita
   * nunca renovam. A mensagem vai com o link (`enviarLink`), nunca com botões.
   */
  async proporCancelamento(a: { tenantId: string; unidadeId: string | null; pedidoId: string }, pedido: PedidoDoCancelamento): Promise<PropostaPendente | null> {
    const proc = PROCEDIMENTOS.cancelar_pedido;
    const avisoId = uuidDeChave('mister:cancelar_pedido:', a.tenantId, ':', a.pedidoId);
    try {
      await this.db.execute(sql`
        insert into mister_proposta (tenant_id, unidade_id, aviso_id, procedimento, parametros, nivel, vence_em)
        values (${a.tenantId}::uuid, ${a.unidadeId}::uuid, ${avisoId}::uuid, 'cancelar_pedido', ${JSON.stringify({ pedidoId: a.pedidoId })}::jsonb, ${proc.nivel},
                clock_timestamp() + make_interval(mins => ${proc.prazoMin}::int))
        on conflict (aviso_id, procedimento) do update
          set situacao = 'proposta', criada_em = clock_timestamp(), vence_em = excluded.vence_em, respondida_em = null, autorizada_por = null,
              telefone_final = null, executada_em = null, conferir_ate = null, concluida_em = null, resultado = null,
              link_hash = null, link_para = null, link_criado_em = null, link_aberto_em = null, pin_erros = 0, bloqueada_em = null
          where mister_proposta.situacao in ('vencida', 'recusada', 'nao_deu')
             or (mister_proposta.situacao = 'proposta' and mister_proposta.vence_em <= now())`);
      const [p] = linhas(
        await this.db.execute(sql`
          select id::text as id, vence_em as "venceEm" from mister_proposta
           where aviso_id = ${avisoId}::uuid and procedimento = 'cancelar_pedido' and situacao = 'proposta' and vence_em > now()`),
      );
      if (!p) return null;
      return { id: p.id, procedimento: 'cancelar_pedido', nivel: 'pin', pergunta: TEXTOS_DO_CANCELAMENTO.link(pedido, horaNoFuso(new Date(p.venceEm))), botoes: [] };
    } catch (e: any) {
      if (!semTabela(e)) this.logger.warn(`a proposta de cancelar o pedido ${a.pedidoId} não foi criada — ${e?.message ?? e}`);
      return null;
    }
  }

  /**
   * Versão 6, M6d (mig 476): a proposta da SESSÃO COM PIN de uma pessoa (presidente ou gerente) — uma por pessoa (o id fixo
   * pela chave), renovada quando acabou (vencida, não autorizada, bloqueada, não deu ou já feita — a sessão anterior passou).
   * `nova` = criada ou renovada agora (quem chama manda o link só então: a pergunta seguinte, com o link ainda valendo, não
   * manda outro). A mensagem vai com o link (`enviarLink`), nunca com botões.
   */
  async proporSessao(tenantId: string, colaboradorId: string, horas: number): Promise<{ p: PropostaPendente; nova: boolean } | null> {
    const proc = PROCEDIMENTOS.abrir_sessao;
    const avisoId = uuidDeChave('mister:abrir_sessao:', tenantId, ':', colaboradorId);
    try {
      const mudou = linhas(
        await this.db.execute(sql`
          insert into mister_proposta (tenant_id, unidade_id, aviso_id, procedimento, parametros, nivel, vence_em)
          values (${tenantId}::uuid, null, ${avisoId}::uuid, 'abrir_sessao', ${JSON.stringify({ colaboradorId, horas })}::jsonb, ${proc.nivel},
                  clock_timestamp() + make_interval(mins => ${proc.prazoMin}::int))
          on conflict (aviso_id, procedimento) do update
            set situacao = 'proposta', criada_em = clock_timestamp(), vence_em = excluded.vence_em, parametros = excluded.parametros,
                respondida_em = null, autorizada_por = null, telefone_final = null, executada_em = null, conferir_ate = null,
                concluida_em = null, resultado = null, link_hash = null, link_para = null, link_criado_em = null, link_aberto_em = null,
                pin_erros = 0, bloqueada_em = null
            where mister_proposta.situacao in ('vencida', 'recusada', 'nao_deu', 'feita')
               or (mister_proposta.situacao = 'proposta' and mister_proposta.vence_em <= now())
          returning id`),
      );
      const [p] = linhas(
        await this.db.execute(sql`
          select id::text as id, vence_em as "venceEm" from mister_proposta
           where aviso_id = ${avisoId}::uuid and procedimento = 'abrir_sessao' and situacao = 'proposta' and vence_em > now()`),
      );
      if (!p) return null;
      return { p: { id: p.id, procedimento: 'abrir_sessao', nivel: 'pin', pergunta: TEXTOS_DA_SESSAO.link(horas, horaNoFuso(new Date(p.venceEm))), botoes: [] }, nova: mudou.length > 0 };
    } catch (e: any) {
      if (!semTabela(e)) this.logger.warn(`a proposta da sessão com PIN não foi criada — ${e?.message ?? e}`);
      return null;
    }
  }

  /** O pedido como o banco o tem agora, com o estorno do Pix quando já existe (a tabela é só da nuvem). */
  async lerPedido(tenantId: string, pedidoId: unknown): Promise<PedidoLido | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(pedidoId ?? ''))) return null;
    const [pe] = linhas(
      await this.db.execute(sql`
        select pe.id::text as id, pe.canal, pe.numero, pe.display_id as "displayId", pe.cliente_nome as cliente, pe.total, pe.status, pe.pago,
               pe.status_pagamento as "statusPagamento", pe.gateway_payment_id as "gatewayPaymentId", pe.gateway_provider as "gatewayProvider",
               pe.sinal_status as "sinalStatus"
          from pedido_externo pe
         where pe.tenant_id = ${tenantId}::uuid and pe.id = ${String(pedidoId)}::uuid`),
    );
    if (!pe) return null;
    let estorno: { situacao: string | null; erro: string | null } = { situacao: null, erro: null };
    try {
      const [e] = linhas(await this.db.execute(sql`select situacao, erro from pedido_estorno where pedido_id = ${pe.id}::uuid`));
      if (e) estorno = { situacao: e.situacao ?? null, erro: e.erro ?? null };
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }
    return {
      id: pe.id,
      status: String(pe.status ?? ''),
      nome: pedidoComoNoQuadro(pe),
      canal: CANAL_NA_TELA[String(pe.canal ?? '')] ?? String(pe.canal ?? ''),
      canalExterno: CANAIS_DE_FORA.includes(String(pe.canal ?? '')),
      cliente: nomeCurtoDoCliente(pe.cliente),
      total: Number(pe.total) || 0,
      pagoNoPix: pagoNoPixOnline(pe),
      provedor: PROVEDOR_NA_TELA[String(pe.gatewayProvider ?? '')] ?? null,
      estorno: estorno.situacao,
      estornoErro: estorno.erro,
    };
  }

  // ───────────────────────────── a resposta ─────────────────────────────

  /**
   * O toque em "Autorizar" ou "Não agora". Devolve false só quando a proposta não é de nenhuma empresa deste telefone (a
   * entrada responde "não achei"). Gerente não autoriza (até o perfil de permissões); vencida e já respondida têm a frase.
   */
  async responder(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const b = lerBotao(botaoId);
    const empresas = quem.vinculos.map((v) => v.tenantId);
    if (!b || !empresas.length) return false;
    const [p] = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", procedimento, situacao, vence_em as "venceEm", nivel, parametros, resultado
          from mister_proposta
         where id = ${b.propostaId}::uuid and tenant_id in (${sql.join(empresas.map((t) => sql`${t}::uuid`), sql`, `)})`),
    );
    if (!p) return false;
    const v = quem.vinculos.find((x) => x.tenantId === p.tenantId)!;
    // A proposta de PIN (F4.2a) nunca se autoriza por botão — nem com o id montado à mão: só pela página do link.
    if (p.nivel === 'pin') {
      const [c] = linhas(await this.db.execute(sql`select nome from colaborador where id = ${v.colaboradorId}::uuid and tenant_id = ${p.tenantId}::uuid`));
      await this.falar(quem.telefone, TEXTOS_DO_LINK.soPeloLink(primeiroNome(c?.nome)));
      return true;
    }
    // Versão 6, M6j: a ação da porta `propor_acao` é de QUEM pediu — só essa pessoa autoriza (o presidente ou o gerente com
    // a permissão do perfil, conferida ao propor e de novo ao executar). As outras propostas seguem só do presidente.
    // V7c: o plano é, como a ação, de quem pediu.
    const plano = p.procedimento === PROCEDIMENTO_DO_PLANO;
    const acao = ehAcaoDoMister(p.procedimento) || plano;
    if (acao && v.colaboradorId !== String(p.parametros?.colaboradorId ?? '')) {
      await this.falar(quem.telefone, TEXTOS_DAS_ACOES.naoDisponivel);
      return true;
    }
    if (!acao && v.nivel !== 'presidente') {
      await this.falar(quem.telefone, TEXTOS_DA_PROPOSTA.soPresidente);
      return true;
    }
    // Versão 6, M6d: com a sessão com PIN ligada e o PIN desta pessoa vencido, a ação de botão espera o PIN — a proposta
    // continua pendente (no prazo dela) e o link da sessão vai agora.
    if (b.autorizar && (await this.sessaoPendente(p.tenantId, v.colaboradorId, quem.telefone))) return true;
    const final = quem.telefone.slice(-4);
    // A gravação condicional: só a proposta ainda pendente e no prazo muda (o segundo toque e o de outro aparelho não).
    const [mudou] = linhas(
      await this.db.execute(sql`
        update mister_proposta
           set situacao = ${b.autorizar ? 'autorizada' : 'recusada'}, respondida_em = now(), autorizada_por = ${v.colaboradorId}::uuid,
               telefone_final = ${final}, concluida_em = case when ${b.autorizar} then null else now() end,
               resultado = case when ${b.autorizar} then null else ${acao ? 'não autorizada por quem pediu' : 'recusada pelo presidente'} end
         where id = ${p.id}::uuid and situacao = 'proposta' and vence_em > now() and nivel = 'botao'
        returning id`),
    );
    if (!mudou) {
      if (plano && p.situacao === 'recusada' && p.resultado === RESULTADO_DO_PLANO_TROCADO) {
        await this.falar(quem.telefone, TEXTOS_DO_PLANO.trocado);
        return true;
      }
      const vencida = p.situacao === 'vencida' || (p.situacao === 'proposta' && new Date(p.venceEm).getTime() <= Date.now());
      await this.falar(quem.telefone, vencida ? TEXTOS_DA_PROPOSTA.vencida(horaNoFuso(new Date(p.venceEm))) : TEXTOS_DA_PROPOSTA.jaRespondida);
      return true;
    }
    await this.auditar(p.tenantId, v.colaboradorId, b.autorizar ? 'mister_proposta_autorizada' : 'mister_proposta_recusada', p.id, { procedimento: p.procedimento, final }, 'whatsapp', v.nivel);
    const resposta = plano
      ? b.autorizar
        ? TEXTOS_DO_PLANO.autorizado
        : TEXTOS_DO_PLANO.mudar
      : b.autorizar
        ? TEXTOS_DA_PROPOSTA.autorizada(p.procedimento)
        : p.procedimento === 'criar_imagem'
          ? TEXTOS_DAS_ACOES.imagemMudar
          : ehDadoInformado(p.procedimento)
          ? TEXTOS_DAS_ACOES.dadoCorrigir
          : acao
            ? TEXTOS_DA_PROPOSTA.recusadaAcao
            : TEXTOS_DA_PROPOSTA.recusada;
    await this.falar(quem.telefone, resposta);
    // A execução não segura a resposta ao WhatsApp: segue sozinha (e a rotina pega a que ficar para trás).
    if (b.autorizar) void this.executar(p.id).catch((e) => this.logger.error(`a proposta ${p.id} não executou — ${e?.message ?? e}`));
    return true;
  }

  /**
   * A sessão com PIN desta pessoa está vencida? Então o toque espera: o link da sessão vai agora e a proposta continua
   * pendente. A mesma régua para o "Autorizar" e para o "Tentar de novo" do plano.
   */
  async sessaoPendente(tenantId: string, colaboradorId: string, telefone: string): Promise<boolean> {
    const s = await estadoDaSessao(this.db, tenantId, colaboradorId);
    if (!s.exigida || s.valida) return false;
    const sessao = await this.proporSessao(tenantId, colaboradorId, s.horas!);
    await this.falar(telefone, TEXTOS_DA_SESSAO.botaoPedePin);
    if (sessao) await this.enviarLink(sessao.p.id, colaboradorId, telefone, sessao.p.pergunta);
    return true;
  }

  // ───────────────────────────── executar e conferir ─────────────────────────────

  /**
   * Executa a proposta autorizada pelo serviço da tela. Uma vez só: a passagem de "autorizada" para "executando" é
   * condicional (a resposta e a rotina podem chegar juntas). A consulta da nota confere na hora; a via de teste confere
   * depois, na rotina. Devolve a situação em que a proposta ficou (ou null se outra execução já a pegou).
   */
  async executar(id: string): Promise<string | null> {
    const [p] = linhas(
      await this.db.execute(sql`
        update mister_proposta p
           set situacao = 'executando', executada_em = now(),
               conferir_ate = now() + make_interval(mins => case p.procedimento
                 when 'imprimir_teste' then ${PROCEDIMENTOS.imprimir_teste.conferirMin}::int
                 when 'reiniciar_impressao' then ${PROCEDIMENTOS.reiniciar_impressao.conferirMin}::int
                 when 'cancelar_pedido' then ${PROCEDIMENTOS.cancelar_pedido.conferirMin}::int
                 when 'abrir_sessao' then ${PROCEDIMENTOS.abrir_sessao.conferirMin}::int
                 else ${PROCEDIMENTOS.consultar_nota.conferirMin}::int end)
         where id = ${id}::uuid and situacao = 'autorizada'
        returning id::text as id, tenant_id::text as "tenantId", unidade_id::text as "unidadeId", procedimento, parametros,
                  autorizada_por::text as "autorizadaPor"`),
    );
    if (!p) return null;
    await this.auditar(p.tenantId, p.autorizadaPor, 'mister_proposta_executada', p.id, { procedimento: p.procedimento }, 'whatsapp', perfilDe(p));
    // V7c: o plano anda passo a passo no serviço dele; cada passo volta a este `executar`, como uma proposta qualquer.
    if (p.procedimento === PROCEDIMENTO_DO_PLANO) {
      if (!this.plano) return this.concluir(p, false, 'os planos não estão disponíveis agora. Nada foi feito.');
      await this.plano(p.id);
      return 'executando';
    }
    if (ehAcaoDoMister(p.procedimento)) {
      // M6j: pelo serviço da tela, com a permissão conferida de novo; a frase diz o que foi FEITO (o efeito conferido).
      if (!this.acao) return this.concluir(p, false, 'as ações do Mister não estão disponíveis agora. Nada foi feito.');
      try {
        const r = await this.acao(p);
        return this.concluir(p, r.feita, r.texto);
      } catch (e: any) {
        this.logger.error(`a ação ${p.procedimento} da proposta ${p.id} falhou — ${e?.message ?? e}`, e?.stack);
        return this.concluir(p, false, 'a ação falhou no Regem. Confira no painel do Delivery.');
      }
    }
    if (p.procedimento === 'consultar_nota') {
      if (!this.fiscal) return this.concluir(p, false, 'a consulta à SEFAZ não está disponível agora. Consulte pelo Regem.');
      try {
        const r: any = await this.fiscal.consultarNota(p.tenantId, String(p.parametros?.notaId ?? ''), p.autorizadaPor);
        const res = resultadoDaConsulta(r ?? {});
        return this.concluir(p, res.feita, res.texto);
      } catch (e: any) {
        // As recusas da consulta (a espera da SEFAZ entre consultas da mesma nota, nota sem chave, SEFAZ fora do ar) vêm
        // com a frase pronta para a pessoa.
        const motivo = String(e?.response?.message ?? e?.message ?? 'a consulta falhou').slice(0, 300);
        return this.concluir(p, false, motivo.charAt(0).toLowerCase() + motivo.slice(1));
      }
    }
    if (p.procedimento === 'imprimir_teste') {
      // O "Imprimir teste" da tela com a loja que tem servidor: o comando vai para o servidor da loja da impressora.
      await enfileirarComandoEdge(this.db, p.tenantId, 'testar_impressora', {
        unidadeId: p.unidadeId,
        solicitadoPor: 'mister',
        dados: { equipamentoId: String(p.parametros?.impressoraId ?? ''), propostaId: p.id },
      });
      return 'executando';
    }
    if (p.procedimento === 'reiniciar_impressao') {
      // F4.4: o comando vai SÓ ao servidor do aviso (se ele saiu da empresa, aos da loja); quem reinicia é o `sync-daemon`.
      await enfileirarComandoEdge(this.db, p.tenantId, 'reiniciar_impressao', {
        unidadeId: p.unidadeId,
        equipamentoId: String(p.parametros?.servidorId ?? ''),
        solicitadoPor: 'mister',
        dados: { propostaId: p.id },
      });
      return 'executando';
    }
    if (p.procedimento === 'cancelar_pedido') {
      // F4.2b: o MESMO cancelamento do botão "Cancelar" do painel do Delivery (o canal, a venda, o estoque como "devolvido"
      // — o padrão do painel —, os benefícios, a cozinha e o estorno do Pix pela rotina da nuvem), com o presidente que
      // conferiu o PIN no lugar da senha (como o gerente no WhatsApp).
      const ped = await this.lerPedido(p.tenantId, p.parametros?.pedidoId);
      if (!ped) return this.concluir(p, false, 'o pedido não foi encontrado. Nada foi feito.');
      if (!this.delivery) return this.concluir(p, false, 'o cancelamento não está disponível agora. Nada foi feito: cancele em Delivery › Painel.');
      const [quem] = linhas(await this.db.execute(sql`select nome from colaborador where id = ${p.autorizadaPor}::uuid and tenant_id = ${p.tenantId}::uuid`));
      try {
        await this.delivery.cancelar(p.tenantId, p.autorizadaPor, 'presidente', ped.id, 'Cancelado pelo Mister, autorizado com o PIN', undefined, true, null, null, {
          id: p.autorizadaPor,
          nome: String(quem?.nome ?? 'o presidente'),
        });
      } catch (e: any) {
        // A recusa do serviço (já cancelado, concluído, o prazo do Pix) vem antes de mudar qualquer coisa. Se o pedido ficou
        // cancelado mesmo assim, segue para a conferência — a frase diz o que foi FEITO, não o que se supõe.
        const depois = await this.lerPedido(p.tenantId, ped.id);
        if (depois?.status !== 'cancelado') {
          const motivo = String(e?.response?.message ?? e?.message ?? 'o cancelamento falhou.').slice(0, 300);
          return this.concluir(p, false, TEXTOS_DO_CANCELAMENTO.recusado(motivo));
        }
        this.logger.warn(`o cancelamento do pedido ${ped.id} pela proposta ${p.id} reclamou, mas o pedido ficou cancelado — ${e?.message ?? e}`);
      }
      return (await this.conferirCancelamento(p, false)) ?? 'executando';
    }
    if (p.procedimento === 'abrir_sessao') {
      // M6d: o PIN de QUEM pediu (a própria pessoa — o link vai só a ela) libera a sessão pelas horas da empresa.
      const horas = [6, 12, 24].includes(Number(p.parametros?.horas)) ? Number(p.parametros.horas) : 12;
      if (!p.autorizadaPor || p.autorizadaPor !== String(p.parametros?.colaboradorId ?? '')) return this.concluir(p, false, 'o PIN não é de quem pediu. Nada foi liberado.');
      const [v] = linhas(
        await this.db.execute(sql`
          update mister_vinculo set pin_ate = clock_timestamp() + make_interval(hours => ${horas}::int), atualizado_em = now()
           where tenant_id = ${p.tenantId}::uuid and colaborador_id = ${p.autorizadaPor}::uuid
          returning pin_ate as "pinAte"`),
      );
      if (!v) return this.concluir(p, false, 'o WhatsApp desta pessoa não está mais ligado ao Mister. Nada foi liberado.');
      return this.concluir(p, true, TEXTOS_DA_SESSAO.liberada(horaNoFuso(new Date(v.pinAte))));
    }
    return this.concluir(p, false, 'esse procedimento não existe mais.');
  }

  /**
   * A conferência do cancelamento (F4.2b): "feito" só com o pedido cancelado e, se foi pago no Pix pelo Regem, com o
   * estorno feito no gateway (`pedido_estorno`). O estorno que falhou na 3ª tentativa já abriu um caso urgente em
   * Atendimento: "não deu", dizendo isso. Antes do prazo, espera (null); passado, "não deu" com o que falta.
   */
  private async conferirCancelamento(p: { id: string; tenantId: string; autorizadaPor: string | null; parametros: any }, prazoPassou: boolean): Promise<string | null> {
    const ped = await this.lerPedido(p.tenantId, p.parametros?.pedidoId);
    if (!ped) return this.concluir(p, false, 'o pedido não foi encontrado.');
    if (ped.status !== 'cancelado') return prazoPassou ? this.concluir(p, false, TEXTOS_DO_CANCELAMENTO.naoCancelou(ped)) : null;
    // Depois do estorno, o pedido pode deixar de parecer "pago no Pix": a linha do estorno também conta.
    const comPix = { ...ped, pagoNoPix: ped.pagoNoPix || !!ped.estorno };
    if (!comPix.pagoNoPix || ped.estorno === 'feito') return this.concluir(p, true, TEXTOS_DO_CANCELAMENTO.feito(comPix));
    if (ped.estorno === 'falhou') return this.concluir(p, false, TEXTOS_DO_CANCELAMENTO.estornoFalhou(comPix, ped.estornoErro));
    return prazoPassou ? this.concluir(p, false, TEXTOS_DO_CANCELAMENTO.estornoNaFila(comPix)) : null;
  }

  /**
   * A conferência da via de teste: feita quando o servidor da loja pegou o pedido E o aviso da impressora fechou (ela
   * voltou a responder). Passado o prazo, "não deu" com o que faltou. Devolve quantas concluiu.
   */
  async conferir(): Promise<number> {
    const abertas = linhas(
      await this.db.execute(sql`
        select p.id::text as id, p.tenant_id::text as "tenantId", p.procedimento, p.autorizada_por::text as "autorizadaPor",
               p.conferir_ate as "conferirAte", a.situacao as aviso,
               exists (select 1 from edge_comando c
                        where c.tenant_id = p.tenant_id and c.comando = ${COMANDO_DA_IMPRESSORA.imprimir_teste} and c.status = 'executado'
                          and c.dados ->> 'propostaId' = p.id::text) as executado,
               -- F4.4: o retorno do reinício (o do servidor que respondeu por último).
               r.status as "statusDoReinicio", r.resultado as "retornoDoReinicio"
          from mister_proposta p
          left join mister_aviso a on a.id = p.aviso_id
          left join lateral (
            select c.status, c.resultado from edge_comando c
             where c.tenant_id = p.tenant_id and c.comando = ${COMANDO_DA_IMPRESSORA.reiniciar_impressao}
               and c.dados ->> 'propostaId' = p.id::text and c.status <> 'pendente'
             order by c.executado_em desc nulls last limit 1
          ) r on p.procedimento = 'reiniciar_impressao'
         where p.situacao = 'executando' and p.procedimento in ('imprimir_teste', 'reiniciar_impressao')`),
    );
    let n = 0;
    for (const p of abertas) {
      if (p.procedimento === 'reiniciar_impressao') {
        if (await this.conferirReinicio(p)) n++;
        continue;
      }
      if (p.executado && p.aviso === 'resolvido') {
        if (await this.concluir(p, true, 'A impressora recebeu a via de teste e voltou a responder.')) n++;
      } else if (new Date(p.conferirAte).getTime() <= Date.now()) {
        const motivo = p.executado
          ? 'o servidor da loja mandou a via de teste, mas a impressora ainda não responde. Confira se ela está ligada, com papel e no cabo ou na rede.'
          : 'o servidor da loja não pegou o pedido. Confira se o computador do servidor está ligado e com internet.';
        if (await this.concluir(p, false, motivo)) n++;
      }
    }
    // F4.2b: os cancelamentos que esperam o estorno do Pix.
    const cancelamentos = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", autorizada_por::text as "autorizadaPor", parametros, conferir_ate as "conferirAte"
          from mister_proposta where situacao = 'executando' and procedimento = 'cancelar_pedido'`),
    );
    for (const p of cancelamentos) if (await this.conferirCancelamento(p, new Date(p.conferirAte).getTime() <= Date.now())) n++;
    return n;
  }

  /**
   * F4.4: a conferência do reinício do serviço de impressão. O servidor que não conseguiu (o retorno "erro") e o que ainda
   * não conhece o comando ("ignorado", sem a versão nova) dizem "não deu" na hora; "feito" só com o reinício confirmado E
   * a impressora respondendo (o aviso fechou). Passado o prazo, "não deu" com o que faltou. Devolve a situação final, ou
   * null enquanto espera.
   */
  private async conferirReinicio(p: {
    id: string;
    tenantId: string;
    autorizadaPor: string | null;
    conferirAte: string | Date;
    aviso: string | null;
    statusDoReinicio: string | null;
    retornoDoReinicio: string | null;
  }): Promise<string | null> {
    const retorno = String(p.retornoDoReinicio ?? '').trim();
    if (p.statusDoReinicio === 'erro') return this.concluir(p, false, TEXTOS_DO_REINICIO.naoReiniciou(retorno || 'sem detalhe'));
    const reiniciou = p.statusDoReinicio === 'executado' && retorno !== 'ignorado';
    if (p.statusDoReinicio === 'executado' && !reiniciou) return this.concluir(p, false, TEXTOS_DO_REINICIO.semVersao);
    if (reiniciou && p.aviso === 'resolvido') return this.concluir(p, true, TEXTOS_DO_REINICIO.feito);
    if (new Date(p.conferirAte).getTime() > Date.now()) return null;
    return this.concluir(p, false, reiniciou ? TEXTOS_DO_REINICIO.impressoraNaoVoltou : TEXTOS_DO_REINICIO.servidorNaoPegou);
  }

  /**
   * Fecha a proposta que está executando (condicional: uma vez só) e avisa quem autorizou. Devolve a situação final, ou
   * null quando outra volta já fechou.
   */
  private async concluir(p: { id: string; tenantId: string; autorizadaPor: string | null; parametros?: any }, feita: boolean, resultado: string): Promise<string | null> {
    const situacao = feita ? 'feita' : 'nao_deu';
    const [fechou] = linhas(
      await this.db.execute(sql`
        update mister_proposta set situacao = ${situacao}, resultado = ${resultado.slice(0, 400)}, concluida_em = now()
         where id = ${p.id}::uuid and situacao = 'executando'
        returning concluida_em as "concluidaEm"`),
    );
    if (!fechou) return null;
    await this.auditar(p.tenantId, p.autorizadaPor, feita ? 'mister_proposta_feita' : 'mister_proposta_nao_deu', p.id, { resultado: resultado.slice(0, 200) }, 'whatsapp', perfilDe(p));
    // V7c: o passo de um plano não fala sozinho: o plano diz tudo numa mensagem só, no fim.
    if (p.parametros?.planoId) {
      this.planoAndou(p.parametros.planoId);
      return situacao;
    }
    const [quem] = p.autorizadaPor
      ? linhas(
          await this.db.execute(sql`
            select telefone from mister_vinculo
             where tenant_id = ${p.tenantId}::uuid and colaborador_id = ${p.autorizadaPor}::uuid and ligado_em is not null and telefone is not null`),
        )
      : [];
    if (quem?.telefone) await this.falar(quem.telefone, textoDoDesfecho(feita, resultado, horaNoFuso(new Date(fechou.concluidaEm))));
    return situacao;
  }

  /**
   * As propostas sem resposta no prazo vencem. A de PIN cujo link saiu avisa quem o recebeu (a conversa 6, parte 4: "venceu
   * sem resposta, nada foi feito"); a de botão vence calada, como na F4.1. Devolve quantas venceram.
   */
  async vencer(): Promise<number> {
    const vencidas = linhas(
      await this.db.execute(sql`
        update mister_proposta set situacao = 'vencida', concluida_em = now(), resultado = 'ninguém respondeu no prazo'
         where situacao = 'proposta' and vence_em <= now()
        returning id::text as id, tenant_id::text as "tenantId", nivel, procedimento, parametros, link_para::text as "linkPara", vence_em as "venceEm"`),
    );
    for (const v of vencidas) {
      // V7c: o PIN de um passo venceu: o plano fecha dizendo o que entrou.
      this.planoAndou(v.parametros?.planoId);
      if (v.nivel !== 'pin' || !v.linkPara) continue;
      const [quem] = linhas(
        await this.db.execute(sql`
          select telefone from mister_vinculo
           where tenant_id = ${v.tenantId}::uuid and colaborador_id = ${v.linkPara}::uuid and ligado_em is not null and telefone is not null`),
      );
      if (!quem?.telefone) continue;
      let oQue = `para ${(PROCEDIMENTOS as Record<string, { nome: string } | undefined>)[v.procedimento]?.nome ?? 'um procedimento'}`;
      if (v.procedimento === 'cancelar_pedido') oQue = TEXTOS_DO_CANCELAMENTO.doCancelamento((await this.lerPedido(v.tenantId, v.parametros?.pedidoId))?.nome ?? '');
      await this.falar(quem.telefone, TEXTOS_DO_LINK.vencida(oQue.trim(), horaNoFuso(new Date(v.venceEm))));
    }
    return vencidas.length;
  }

  /**
   * A rotina: vence as sem resposta, executa as autorizadas que ficaram para trás (a execução logo depois do toque é o
   * caminho de sempre) e confere as que esperam o efeito. Só na nuvem.
   */
  @Cron('*/30 * * * * *')
  async rotina(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      await this.vencer();
      const paraTras = linhas(
        await this.db.execute(sql`
          select id::text as id from mister_proposta where situacao = 'autorizada' and respondida_em < now() - interval '20 seconds'
           order by respondida_em limit 20`),
      );
      for (const p of paraTras) await this.executar(p.id).catch((e) => this.logger.warn(`a proposta ${p.id} não executou — ${e?.message ?? e}`));
      await this.conferir();
    } catch (e: any) {
      if (!semTabela(e)) this.logger.warn(`a rotina das propostas falhou — ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }

  // ───────────────────────────── o link com PIN (F4.2a, mig 433) ─────────────────────────────

  /**
   * Manda a proposta de PIN a quem autoriza, com o botão "Abrir no Regem". Um código NOVO a cada envio (o anterior para de
   * valer: só o resumo do novo fica no banco) e as tentativas recomeçam. Só a proposta de PIN ainda pendente e no prazo.
   * Devolve o endereço (para o teste), ou null quando a proposta não aceita link. O endereço nunca vai para log nem trilha.
   */
  async enviarLink(propostaId: string, colaboradorId: string, telefone: string, texto: string): Promise<string | null> {
    const codigo = randomBytes(24).toString('base64url');
    const [p] = linhas(
      await this.db.execute(sql`
        update mister_proposta
           set link_hash = ${resumoDoCodigo(codigo)}, link_para = ${colaboradorId}::uuid, link_criado_em = now(), link_aberto_em = null, pin_erros = 0
         where id = ${propostaId}::uuid and nivel = 'pin' and situacao = 'proposta' and vence_em > now()
        returning tenant_id::text as "tenantId"`),
    );
    if (!p) return null;
    const url = `${baseDoApp()}${caminhoDoLink(codigo)}`;
    await this.auditar(p.tenantId, colaboradorId, 'mister_proposta_link_enviado', propostaId, {}, 'whatsapp');
    try {
      await this.numero.enviar(telefone, { texto, link: { titulo: TEXTOS_DO_LINK.botao, url } });
    } catch (e: any) {
      this.logger.warn(`o link da proposta ${propostaId} não saiu — ${e instanceof FalhaDoEnvioDoMister ? e.motivo : (e?.message ?? e)}`);
    }
    return url;
  }

  /**
   * A proposta do link, com a régua de "acesso vale" da conversa (V75): a empresa viva, quem recebeu ainda presidente e
   * ativo, o telefone dele ainda ligado ao Mister e o módulo ligado na loja da proposta. Código que não é de link, que não
   * existe (ou foi trocado por um novo envio) ou acesso que não vale: 404 com a mesma frase — a página não diz qual.
   */
  private async linhaDoLink(codigo: unknown): Promise<any> {
    if (!ehCodigoDoLink(codigo)) throw new NotFoundException(TEXTOS_DO_LINK.naoVale);
    let p: any;
    try {
      [p] = linhas(
        await this.db.execute(sql`
          select mp.id::text as id, mp.tenant_id::text as "tenantId", mp.unidade_id::text as "unidadeId", mp.procedimento, mp.parametros,
                 mp.situacao, mp.criada_em as "criadaEm", mp.vence_em as "venceEm", mp.respondida_em as "respondidaEm",
                 mp.telefone_final as "telefoneFinal", mp.resultado, mp.concluida_em as "concluidaEm", mp.link_para::text as "linkPara",
                 mp.link_aberto_em as "linkAbertoEm",
                 mp.pin_erros as "pinErros", mp.bloqueada_em as "bloqueadaEm", c.nome as "paraNome", emp.nome as empresa, v.telefone,
                 coalesce(p.nivel, f.categoria::text) as "paraNivel"
            from mister_proposta mp
            join empresa emp on emp.id = mp.tenant_id
            join colaborador c on c.id = mp.link_para and c.tenant_id = mp.tenant_id
            left join funcao f on f.id = c.funcao_id
            left join perfil_acesso p on p.id = c.perfil_acesso_id
            join mister_vinculo v on v.tenant_id = mp.tenant_id and v.colaborador_id = mp.link_para and v.ligado_em is not null and v.telefone is not null
           where mp.link_hash = ${resumoDoCodigo(codigo)} and mp.nivel = 'pin'
             and ${pessoaVale()}
             -- M6d e M6j: a sessão com PIN e as ações de PIN são da própria pessoa (o gerente também); o resto, só o presidente.
             and (coalesce(p.nivel, f.categoria::text) = 'presidente'
                  or (coalesce(p.nivel, f.categoria::text) = 'gerente'
                      and mp.procedimento in (${sql.join(PROCEDIMENTOS_DO_GERENTE.map((x) => sql`${x}`), sql`, `)})))`),
      );
    } catch (e: any) {
      if (semTabela(e) || e?.code === '42703' || e?.cause?.code === '42703') throw new NotFoundException(TEXTOS_DO_LINK.naoVale);
      throw e;
    }
    if (!p) throw new NotFoundException(TEXTOS_DO_LINK.naoVale);
    if (this.modulos && !(await this.modulos.ativo(p.tenantId, p.unidadeId ?? null, 'mister'))) throw new NotFoundException(TEXTOS_DO_LINK.naoVale);
    return p;
  }

  private async vistaDoLink(p: any, erro: string | null = null): Promise<VistaDoLink> {
    const nome = primeiroNome(p.paraNome);
    // F4.2b: o cancelamento mostra o pedido como o banco o tem AGORA (o canal, o cliente curto, o valor, o Pix).
    let apresentacao = apresentacaoDaProposta(p.procedimento);
    if (p.procedimento === 'cancelar_pedido') {
      const ped = await this.lerPedido(p.tenantId, p.parametros?.pedidoId);
      if (ped) apresentacao = apresentacaoDoCancelamento(ped);
    }
    if (p.procedimento === 'mudar_preco' && p.parametros?.mudanca) apresentacao = apresentacaoDoPreco(p.parametros.mudanca);
    if (p.procedimento === 'mudar_horario' && p.parametros?.mudancaDeHorario) apresentacao = apresentacaoDoHorario(p.parametros.mudancaDeHorario);
    if (p.procedimento === 'pagar_conta' && p.parametros?.baixa) apresentacao = apresentacaoDaBaixa(p.parametros.baixa);
    // Versão 9, O5: o cupom e a conta a pagar.
    if (p.procedimento === 'criar_cupom' && p.parametros?.codigo) apresentacao = apresentacaoDoCupom(p.parametros);
    if (p.procedimento === 'lancar_conta' && p.parametros?.descricao) apresentacao = apresentacaoDaConta(p.parametros);
    if (p.procedimento === 'classificar_banco' && p.parametros?.lancamentoId) apresentacao = apresentacaoDaClassificacao(p.parametros);
    return {
      estado: estadoDoLink(p),
      empresa: String(p.empresa ?? ''),
      ...apresentacao,
      pedidoPor: `Pedido pelo Mister às ${horaNoFuso(new Date(p.criadaEm))}, para ${nome}${p.procedimento === 'abrir_sessao' || ehAcaoDoMister(p.procedimento) ? '' : ' (presidente)'}.`,
      valeAte: new Date(p.venceEm).toISOString(),
      valeAteHora: horaNoFuso(new Date(p.venceEm)),
      restam: tentativasQueRestam(p.pinErros),
      resultado: p.resultado ?? null,
      concluidaHora: p.concluidaEm ? horaNoFuso(new Date(p.concluidaEm)) : null,
      respondida: p.respondidaEm ? { hora: horaNoFuso(new Date(p.respondidaEm)), nome, final: p.telefoneFinal ?? null } : null,
      erro,
    };
  }

  /** A página abriu: a proposta como está. A primeira abertura deste link fica na auditoria. */
  async verPeloLink(codigo: unknown): Promise<VistaDoLink> {
    const p = await this.linhaDoLink(codigo);
    if (!p.linkAbertoEm) {
      const [primeira] = linhas(
        await this.db.execute(sql`update mister_proposta set link_aberto_em = now() where id = ${p.id}::uuid and link_aberto_em is null returning id`),
      );
      if (primeira) await this.auditar(p.tenantId, p.linkPara, 'mister_proposta_link_aberto', p.id, { procedimento: p.procedimento }, 'link', p.paraNivel);
    }
    return this.vistaDoLink(p);
  }

  /**
   * "Autorizar" com o PIN. A tentativa é RESERVADA antes de conferir (gravação condicional com `pin_erros < 5`): nem
   * toques em paralelo conferem mais de 5 PIN por link. PIN errado gasta a tentativa (a quinta bloqueia o link e fecha a
   * proposta); PIN certo devolve a reservada e autoriza UMA vez, e a execução segue sozinha pelo serviço da tela.
   * O PIN nunca vai para a auditoria nem para log.
   */
  async autorizarPeloLink(codigo: unknown, pin: unknown): Promise<VistaDoLink> {
    const p = await this.linhaDoLink(codigo);
    if (!ehPinValido(pin)) throw new BadRequestException(TEXTOS_DO_LINK.pinFormato);
    // A proposta de preço pode ser trocada por um pedido novo: o resumo do código na gravação garante que este PIN vale só
    // para o que ESTE link mostrou.
    const hashDoLink = resumoDoCodigo(String(codigo));
    const [reservada] = linhas(
      await this.db.execute(sql`
        update mister_proposta set pin_erros = pin_erros + 1
         where id = ${p.id}::uuid and link_hash = ${hashDoLink} and situacao = 'proposta' and vence_em > now() and bloqueada_em is null and pin_erros < ${PIN_TENTATIVAS}
        returning pin_erros as "pinErros"`),
    );
    // Vencida, já respondida ou bloqueada: a página mostra o estado.
    if (!reservada) return this.vistaDoLink(await this.linhaDoLink(codigo));
    try {
      // M6d e M6j: a sessão e as ações de PIN são da própria pessoa — o gerente também confirma as dele.
      await autorizarPorPinDoUsuario(this.db, p.tenantId, p.linkPara, pin, PROCEDIMENTOS_DO_GERENTE.includes(p.procedimento) ? ['presidente', 'gerente'] : ['presidente']);
    } catch (e: any) {
      if (e?.message !== PIN_INVALIDO) {
        // Não foi o PIN (o acesso mudou entre a leitura e a conferência): a tentativa volta e o link não vale.
        await this.db.execute(sql`update mister_proposta set pin_erros = greatest(pin_erros - 1, 0) where id = ${p.id}::uuid`);
        throw new NotFoundException(TEXTOS_DO_LINK.naoVale);
      }
      const restam = tentativasQueRestam(reservada.pinErros);
      await this.auditar(p.tenantId, p.linkPara, 'mister_proposta_pin_errado', p.id, { restam }, 'link', p.paraNivel);
      if (restam > 0) return this.vistaDoLink(await this.linhaDoLink(codigo), TEXTOS_DO_LINK.pinErrado(restam));
      const [bloqueou] = linhas(
        await this.db.execute(sql`
          update mister_proposta
             set situacao = 'recusada', bloqueada_em = now(), concluida_em = now(), resultado = ${`link bloqueado: o PIN errado ${PIN_TENTATIVAS} vezes`}
           where id = ${p.id}::uuid and link_hash = ${hashDoLink} and situacao = 'proposta' and bloqueada_em is null
          returning id`),
      );
      if (bloqueou) {
        await this.auditar(p.tenantId, p.linkPara, 'mister_proposta_bloqueada', p.id, { procedimento: p.procedimento }, 'link', p.paraNivel);
        await this.falar(p.telefone, TEXTOS_DO_LINK.bloqueada);
        this.planoAndou(p.parametros?.planoId);
      }
      return this.vistaDoLink(await this.linhaDoLink(codigo));
    }
    const final = String(p.telefone ?? '').slice(-4);
    const [mudou] = linhas(
      await this.db.execute(sql`
        update mister_proposta
           set situacao = 'autorizada', respondida_em = now(), autorizada_por = link_para, telefone_final = ${final},
               pin_erros = greatest(pin_erros - 1, 0)
         where id = ${p.id}::uuid and link_hash = ${hashDoLink} and situacao = 'proposta' and vence_em > now() and bloqueada_em is null
        returning id`),
    );
    if (mudou) {
      await this.auditar(p.tenantId, p.linkPara, 'mister_proposta_autorizada', p.id, { procedimento: p.procedimento, final }, 'link', p.paraNivel);
      await this.falar(p.telefone, TEXTOS_DO_LINK.autorizada);
      void this.executar(p.id).catch((e) => this.logger.error(`a proposta ${p.id} não executou — ${e?.message ?? e}`));
    }
    return this.vistaDoLink(await this.linhaDoLink(codigo));
  }

  /** "Não autorizar": fecha a proposta (o link não serve mais) e avisa na conversa. Não pede o PIN: não faz nada. */
  async naoAutorizarPeloLink(codigo: unknown): Promise<VistaDoLink> {
    const p = await this.linhaDoLink(codigo);
    const final = String(p.telefone ?? '').slice(-4);
    const [mudou] = linhas(
      await this.db.execute(sql`
        update mister_proposta
           set situacao = 'recusada', respondida_em = now(), autorizada_por = link_para, telefone_final = ${final},
               concluida_em = now(), resultado = 'não autorizada no Regem'
         where id = ${p.id}::uuid and link_hash = ${resumoDoCodigo(String(codigo))} and situacao = 'proposta' and vence_em > now() and bloqueada_em is null
        returning id`),
    );
    if (mudou) {
      await this.auditar(p.tenantId, p.linkPara, 'mister_proposta_recusada', p.id, { procedimento: p.procedimento, final }, 'link', p.paraNivel);
      await this.falar(p.telefone, TEXTOS_DO_LINK.recusada);
      this.planoAndou(p.parametros?.planoId);
    }
    return this.vistaDoLink(await this.linhaDoLink(codigo));
  }

  // ───────────────────────────── apoio ─────────────────────────────

  private async falar(telefone: string, texto: string): Promise<void> {
    try {
      await this.numero.enviar(telefone, { texto });
    } catch (e: any) {
      this.logger.warn(`a resposta da proposta não saiu — ${e instanceof FalhaDoEnvioDoMister ? e.motivo : (e?.message ?? e)}`);
    }
  }

  private async auditar(
    tenantId: string,
    atorId: string | null,
    acao: string,
    propostaId: string,
    detalhe: Record<string, unknown>,
    // F4.2a: 'link' = pela página `/m/<código>` com o PIN.
    origem: 'whatsapp' | 'link' = 'whatsapp',
    // M6j: o perfil de quem autorizou (o gerente nas ações dele); as outras propostas são do presidente.
    atorPerfil: string = 'presidente',
  ): Promise<void> {
    await this.auditoria
      ?.registrar({ tenantId, atorId, atorPerfil, tipo: 'mister', acao, entidadeTipo: 'mister_proposta', entidadeId: propostaId, detalhe, origem } as any)
      .catch((e: any) => this.logger.warn(`a auditoria da proposta ${propostaId} falhou — ${e?.message ?? e}`));
  }
}

/** Os procedimentos de PIN que o gerente autoriza, com o PIN dele: a sessão e as ações de PIN que ele mesmo pediu. */
const PROCEDIMENTOS_DO_GERENTE: readonly string[] = ['abrir_sessao', ...ACOES_DE_PIN];

/** M6j: o perfil gravado com a ação (quem pediu); as outras propostas são do presidente. */
const perfilDe = (p: { parametros?: any }): string => (p.parametros?.nivel === 'gerente' ? 'gerente' : 'presidente');
