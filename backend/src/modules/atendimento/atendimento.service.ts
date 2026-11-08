import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { atendimentoChamado, cardapioConfig } from '../../db/schema';
import { DeliveryService } from '../delivery/delivery.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import {
  AVISO_DO_ENDERECO_VALE_MIN,
  type Distancia,
  type MudancaDoEndereco,
  enderecoEmUmaLinha,
  estadoDaMudancaDoEndereco,
  idDaMudancaDoCaso,
  lerEnderecoDoCaso,
  taxaEscolhida,
  textoDoEnderecoAtualizado,
} from './endereco-depois-que-saiu';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthUser } from '../../auth/auth-user';
import { lerItensDaPerda } from '../vendas/itens-da-perda';
import { classificacaoGravada, lerOQueAconteceu } from './numeros';
import { sqlUnidadeOuRede } from '../../common/filtro-unidade';
import { instanteDe } from '../../common/fuso-sql';
import { hojeISO } from '../../common/data';
import { exigirBooleano } from '../../common/exigir';
import {
  DadosDoChamado,
  JANELA_DO_MESMO_CHAMADO_H,
  type OpcoesDaSimulacao,
  Prioridade,
  type Simulacao,
  abrirChamado,
  abrirChamadoPeloRobo,
  juntarMensagem,
  simularChamadoPeloRobo,
} from './abrir-chamado';
import { canalDoCaso, posicoes, situacaoDo } from './fila';
import { lerRecado, recadoAtivoSql, situacaoDaEquipe } from './horario-da-equipe';
import { lerResponsavel, responsavelNaEsperaSql, soDaGestaoSql } from '../cardapio/assuntos-do-atendente';
import { ehGestor } from '../../auth/niveis';
import { PRESENCA_VALE_MIN } from './presenca';
import { FilaEAvisosService } from './fila-e-avisos.service';
import { ehServidorLocal } from '../../common/modo';

/**
 * O RECADO PARA A ABERTURA na fila (mig 379): recado ativo e ninguém com ele (sem responsável, sem esperar o cliente) — a
 * situação 'abertura'. O que alguém pegou de madrugada é um caso comum (com alguém / aguardando).
 */
const RECADO_NA_ESPERA = sql`(${recadoAtivoSql('c')} and c.responsavel_id is null and c.aguardando_desde is null)`;

/**
 * O RECADO PARA O RESPONSÁVEL na fila (mig 381): assunto que não é pedido (fornecedor, vaga, parceria) e ninguém com ele —
 * a situação 'responsavel'. Nunca está na fila da equipe nem nas contagens de agora; só a gestão o vê.
 */
const RESPONSAVEL_NA_ESPERA = responsavelNaEsperaSql('c');

/**
 * O que a pessoa NÃO vê (RBAC no servidor, mig 381): quem não é gerente nem presidente (nem o suporte da distribuição,
 * tratado como gerente) não recebe recado para o responsável — salvo o que está com ela (passaram o caso para ela).
 */
const foraDoPerfil = (user: AuthUser) => (ehGestor(user.categoria) ? sql`` : sql`and not ${soDaGestaoSql('c', user.colaboradorId)}`);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quantos casos a fila devolve de uma vez. As contagens da tela vêm do banco, não desta lista. */
export const LIMITE_DA_FILA = 300;

// A MUDANÇA DE ENDEREÇO DO CASO (PR 3b-2): a alteração do pedido que a equipe fez pelo caso, pela chave (o id anotado em
// `detalhe.endereco.mudado`). O que aconteceu com ela (a loja aplicou ou recusou; o cliente recebeu o aviso) mora na
// alteração — que sobe e desce com a decisão do servidor da loja —, não no caso.
const JUNTA_A_MUDANCA_DO_ENDERECO = sql`
        left join pedido_alteracao pa
          on pa.tenant_id = c.tenant_id
         and pa.id = (case when c.detalhe #>> '{endereco,mudado,alteracaoId}' ~ '^[0-9a-fA-F-]{36}$'
                           then (c.detalhe #>> '{endereco,mudado,alteracaoId}')::uuid end)`;
const COLUNAS_DA_MUDANCA_DO_ENDERECO = sql`pa.situacao as "mudancaSituacao", pa.motivo as "mudancaMotivo",
             pa.created_at as "mudancaCriadaEm", pa.pedido -> 'avisoAoCliente' as "mudancaAviso"`;

/**
 * As alterações "depois que saiu" já aplicadas que esperam o "Endereço atualizado!" (a rotina da nuvem), com o caso pela
 * chave. O `where` é o MESMO do índice parcial da mig 364 — sem ele igual, o Postgres varre o histórico inteiro a cada
 * 20 s (o teste confere o plano). Até 50 por volta, a mais antiga primeiro.
 */
export function consultaDosAvisosDoEndereco(soAlteracao?: string) {
  return sql`
      select a.id, a.tenant_id, a.pedido,
             a.created_at < now() - make_interval(mins => ${AVISO_DO_ENDERECO_VALE_MIN}) as velha,
             c.id as chamado_id, c.telefone, c.detalhe #>> '{endereco,via}' as via
        from pedido_alteracao a
        left join atendimento_chamado c
          on c.tenant_id = a.tenant_id
         and c.id = (case when a.pedido ->> 'chamadoId' ~ '^[0-9a-fA-F-]{36}$' then (a.pedido ->> 'chamadoId')::uuid end)
       where a.situacao = 'aplicada'
         and (a.pedido ->> 'depoisQueSaiu') = 'true'
         and not (a.pedido ? 'avisoAoCliente')
         ${soAlteracao && UUID_RE.test(soAlteracao) ? sql`and a.id = ${soAlteracao}` : sql``}
       order by a.created_at
       limit 50`;
}

/** O caso da fila com o estado da mudança de endereço (`mudancaDoEndereco`) no lugar das colunas da alteração. */
function comAMudancaDoEndereco(c: any) {
  const { mudancaSituacao, mudancaMotivo, mudancaCriadaEm, mudancaAviso, ...resto } = c;
  const estado = estadoDaMudancaDoEndereco({ situacao: mudancaSituacao, motivo: mudancaMotivo, criadaEm: mudancaCriadaEm, aviso: mudancaAviso });
  return estado ? { ...resto, mudancaDoEndereco: estado } : resto;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export type { Prioridade };

/** A prioridade pedida: só `prioridade: 'urgente'` ou `urgente: true` mudam o padrão. Todo o resto é 'normal'. */
export function prioridadeDe(dto: { prioridade?: unknown; urgente?: unknown } | null | undefined): Prioridade {
  if (dto?.prioridade === 'urgente') return 'urgente';
  return dto?.urgente === true || dto?.urgente === 'true' ? 'urgente' : 'normal';
}

// A abertura de chamado mora em `abrir-chamado.ts` (o WhatsApp também abre — Bloco 4); estes nomes continuam valendo daqui.
export { juntarMensagem, JANELA_DO_MESMO_CHAMADO_H };

@Injectable()
export class AtendimentoService {
  private readonly logger = new Logger('Atendimento');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
    private readonly delivery: DeliveryService,
    // Quem passou o caso para quem fica na auditoria. Opcional: os testes montam o serviço sem ela.
    @Optional() private readonly auditoria?: AuditoriaService,
    // O ajuste "Dizer ao cliente a posição na fila" (mig 353). Opcional: sem ele, o robô recebe a posição (o padrão).
    @Optional() private readonly filaEAvisos?: FilaEAvisosService,
    // "Endereço atualizado!" ao cliente (PR 3b-2), pela via da conversa do caso: a API oficial ou a Evolution. Só a nuvem
    // manda (a rotina não roda no servidor da loja). Opcionais: os testes montam o serviço sem elas.
    @Optional() private readonly cloud?: WhatsappCloudService,
    @Optional() private readonly evolution?: WhatsappService,
  ) {}

  // Abre um chamado (handoff do robô → humano). Dispara alerta em tempo real.
  async abrir(tenantId: string, unidadeId: string | null, dto: DadosDoChamado) {
    return abrirChamado(this.db, (ev, p) => this.events.emit(ev, p), tenantId, unidadeId, dto);
  }

  /**
   * Chamado aberto PELO ROBÔ. Se o mesmo cliente (pela chave do telefone: com/sem 55 e nono dígito) já tem um chamado
   * aberto nas últimas 12 h, é o mesmo pedido de ajuda: não abre outro (a IA às vezes chama duas vezes na mesma
   * resposta). O que chega é somado ao aberto: a mensagem nova vai junto, e `urgente` SOBE a prioridade (nunca desce) —
   * aí a tela é avisada de novo, porque mudou o que a equipe precisa ver.
   * Exceção: um pedido de CANCELAMENTO ou MUDANÇA ligado a um pedido, quando o aberto é de outro tipo, abre o seu
   * próprio chamado — o botão "Aceitar cancelamento" depende do tipo e do pedido do chamado.
   * Sem telefone, abre sempre (não há como saber se é o mesmo cliente). Duas chamadas no mesmo instante ainda podem abrir
   * dois — nenhum índice impede; o pior caso é um chamado a mais no painel.
   */
  async abrirPeloRobo(tenantId: string, unidadeId: string | null, dto: DadosDoChamado) {
    const r = await abrirChamadoPeloRobo(this.db, (ev, p) => this.events.emit(ev, p), tenantId, unidadeId, dto);
    return this.comAPosicaoDoAjuste(tenantId, r);
  }

  /**
   * O "chamar atendente" da conversa de TESTE do atendente (F4, mig 382): o que o caminho de verdade faria, sem gravar caso,
   * sem pausar o robô e sem avisar ninguém (`abrir-chamado.ts` › `simularChamadoPeloRobo`) — com o mesmo "dizer a posição".
   */
  async simularPeloRobo(tenantId: string, unidadeId: string | null, dto: DadosDoChamado, opcoes: OpcoesDaSimulacao): Promise<Simulacao> {
    const s = await simularChamadoPeloRobo(this.db, tenantId, unidadeId, dto, opcoes);
    return { ...s, resposta: await this.comAPosicaoDoAjuste(tenantId, s.resposta) };
  }

  // "Dizer ao cliente a posição na fila" desligado (Configurações › Atendimento, mig 353): o robô não recebe o lugar do
  // cliente — e não o diz. "Já tem alguém com o seu caso" (comAlguem) não é posição: segue.
  private async comAPosicaoDoAjuste<T extends { posicao: number | null }>(tenantId: string, r: T): Promise<T> {
    if (r.posicao != null && this.filaEAvisos && !(await this.filaEAvisos.dizPosicao(tenantId))) return { ...r, posicao: null };
    return r;
  }

  // Urgente primeiro (cliente irritado espera menos); dentro de cada grupo, o mais novo em cima — como sempre foi.
  // `user` (mig 381): quem não é da gestão não recebe o recado para o responsável que não está com ele (RBAC no servidor).
  listar(tenantId: string, status = 'aberto', user?: AuthUser) {
    const soGestao = user && !ehGestor(user.categoria) ? sql`not ${soDaGestaoSql('atendimento_chamado', user.colaboradorId)}` : undefined;
    return this.db
      .select()
      .from(atendimentoChamado)
      .where(and(eq(atendimentoChamado.tenantId, tenantId), eq(atendimentoChamado.status, status), soGestao))
      .orderBy(sql`(${atendimentoChamado.prioridade} = 'urgente') desc`, desc(atendimentoChamado.criadoEm))
      .limit(100);
  }

  /**
   * Resolve o caso. `dto.oQueAconteceu` (opcional, Números do atendimento): o motivo e os produtos que a equipe marcou —
   * conferidos ANTES de gravar (V86) e gravados na MESMA troca, só na chave `classificacao` do `detalhe` (V82).
   */
  async resolver(tenantId: string, id: string, atorId: string, dto?: { oQueAconteceu?: unknown } | null, atorNome?: string | null) {
    let marca: Record<string, unknown> | null = null;
    if (dto?.oQueAconteceu !== undefined && dto?.oQueAconteceu !== null) {
      const lido = lerOQueAconteceu(dto.oQueAconteceu);
      if (!lido.ok) throw new BadRequestException(lido.erro);
      if (lido.valor) marca = classificacaoGravada(lido.valor, { colaboradorId: atorId, nome: atorNome ?? null });
    }
    const [row] = await this.db
      .update(atendimentoChamado)
      .set({
        status: 'resolvido',
        resolvidoPorId: atorId,
        resolvidoEm: new Date(),
        aguardandoDesde: null,
        ...(marca
          ? { detalhe: sql`coalesce(${atendimentoChamado.detalhe}, '{}'::jsonb) || jsonb_build_object('classificacao', ${JSON.stringify(marca)}::jsonb)` }
          : {}),
      })
      .where(and(eq(atendimentoChamado.tenantId, tenantId), eq(atendimentoChamado.id, id)))
      .returning();
    if (!row) throw new NotFoundException('Chamado não encontrado');
    this.avisar(tenantId, id, 'resolveu');
    return { ok: true };
  }

  // ===================== A FILA (central de atendimento, Onda 1) =====================

  /** Avisa as telas (tempo real): o caso mudou — elas relêem a fila. */
  private avisar(tenantId: string, id: string, motivo: string) {
    this.events.emit('atendimento.mudou', { tenantId, id, motivo });
  }

  /**
   * A FILA da central: os casos ABERTOS da loja em uso (e os sem loja — o robô do WhatsApp atende a empresa toda), na
   * ordem da fila (prazo vencendo, urgente, quem espera há mais tempo), com a posição de quem espera uma pessoa e o
   * pedido ligado (situação e o número na plataforma). As CONTAGENS vêm do banco, não da lista (que tem limite — V39).
   * HORÁRIO DA EQUIPE (mig 379): o RECADO que espera a abertura (sem ninguém com ele) é a situação 'abertura' — só vem
   * com `comRecados` (a tela nova pede; o app Android e as telas antigas não recebem, para não tocar de madrugada) e fica
   * fora das contagens de agora (`contagens.paraAbertura` conta os dele, sempre). Todo caso traz `recado` ({ ate, em })
   * quando tem a marca — também depois do `ate`, para o selo "Recado das 02:14". `equipe`: se a equipe da loja em uso
   * está agora e quando volta (a faixa "Fora do horário da equipe").
   * ASSUNTOS QUE NÃO SÃO PEDIDO (mig 381): o RECADO PARA O RESPONSÁVEL sem ninguém com ele é a situação 'responsavel' — só
   * vem com `comRecados` E para a gestão (gerente, presidente e o suporte); quem não é da gestão nem recebe recado para o
   * responsável (salvo o que passaram para ele). Fica fora das contagens de agora (`contagens.paraOResponsavel` conta os
   * que esperam — 0 para quem não é da gestão). Todo caso traz `responsavel` ({ assunto, em }) quando tem a marca.
   */
  async fila(user: AuthUser, unidadeAtual: string | null, opcoes: { comRecados?: boolean } = {}) {
    const loja = sqlUnidadeOuRede('c.unidade_id', unidadeAtual);
    const recadosDoResponsavel = !!opcoes.comRecados && ehGestor(user.categoria);
    const r: any = await this.db.execute(sql`
      select c.id, c.tipo, c.canal, c.cliente, c.telefone, c.mensagem, c.prioridade, c.status, c.decisao,
             c.pedido_id as "pedidoId", c.pedido_numero as "pedidoNumero", c.unidade_id as "unidadeId",
             c.responsavel_id as "responsavelId", c.pego_em as "pegoEm", c.aguardando_desde as "aguardandoDesde",
             c.prazo_em as "prazoEm", c.criado_em as "criadoEm", c.detalhe, c.externo_id as "externoId",
             r.nome as "responsavelNome",
             p.canal as "pedidoCanal", p.status as "pedidoStatus", p.display_id as "pedidoNaPlataforma",
             p.cliente_nome as "pedidoCliente", ${COLUNAS_DA_MUDANCA_DO_ENDERECO},
             ${recadoAtivoSql('c')} as "recadoAtivo"
        from atendimento_chamado c
        left join colaborador r on r.id = c.responsavel_id and r.tenant_id = c.tenant_id
        left join pedido_externo p on p.id = c.pedido_id and p.tenant_id = c.tenant_id
        ${JUNTA_A_MUDANCA_DO_ENDERECO}
       where c.tenant_id = ${user.tenantId} and c.status = 'aberto' ${loja}
             ${opcoes.comRecados ? sql`` : sql`and not ${RECADO_NA_ESPERA}`}
             ${recadosDoResponsavel ? sql`` : sql`and not ${RESPONSAVEL_NA_ESPERA}`}
             ${foraDoPerfil(user)}
       order by (c.prazo_em is null), c.prazo_em, (c.prioridade = 'urgente') desc, c.criado_em
       limit ${LIMITE_DA_FILA}`);
    const casos = posicoes((r.rows ?? r) as any[]).map(({ recadoAtivo, ...c }) => ({
      ...comAMudancaDoEndereco(c),
      canal: canalDoCaso(c),
      situacao: situacaoDo({ ...c, recadoAtivo }),
      recado: lerRecado(c.detalhe),
      responsavel: lerResponsavel(c.detalhe),
    }));
    const [contagens, equipe] = await Promise.all([this.contagens(user, loja), situacaoDaEquipe(this.db, user.tenantId, { unidadeId: unidadeAtual })]);
    // `eu`: quem pediu a fila — a tela marca "Comigo" e "você" sem ler o token (na nuvem a sessão é um cookie httpOnly).
    return {
      casos,
      contagens,
      limite: LIMITE_DA_FILA,
      eu: user.colaboradorId ?? null,
      equipe: {
        modo: equipe.modo,
        atendendo: equipe.atendendo,
        voltaEm: equipe.voltaEm ? equipe.voltaEm.toISOString() : null,
        voltaTexto: equipe.voltaTexto,
      },
    };
  }

  /** Os casos resolvidos HOJE (dia da operação, não da sessão do banco — ERR-120), os mais recentes primeiro. */
  async resolvidosHoje(user: AuthUser, unidadeAtual: string | null) {
    const loja = sqlUnidadeOuRede('c.unidade_id', unidadeAtual);
    const r: any = await this.db.execute(sql`
      select c.id, c.tipo, c.canal, c.cliente, c.telefone, c.mensagem, c.prioridade, c.status, c.decisao,
             c.pedido_id as "pedidoId", c.pedido_numero as "pedidoNumero", c.criado_em as "criadoEm",
             c.resolvido_em as "resolvidoEm", q.nome as "resolvidoPorNome", c.detalhe, c.externo_id as "externoId",
             p.canal as "pedidoCanal", p.status as "pedidoStatus", p.display_id as "pedidoNaPlataforma",
             ${COLUNAS_DA_MUDANCA_DO_ENDERECO}
        from atendimento_chamado c
        left join colaborador q on q.id = c.resolvido_por_id and q.tenant_id = c.tenant_id
        left join pedido_externo p on p.id = c.pedido_id and p.tenant_id = c.tenant_id
        ${JUNTA_A_MUDANCA_DO_ENDERECO}
       where c.tenant_id = ${user.tenantId} and c.status = 'resolvido' ${loja}
         and c.resolvido_em >= ${instanteDe(hojeISO())}
         ${foraDoPerfil(user)}
       order by c.resolvido_em desc
       limit ${LIMITE_DA_FILA}`);
    return ((r.rows ?? r) as any[]).map((c) => ({
      ...comAMudancaDoEndereco(c),
      canal: canalDoCaso(c),
      situacao: 'resolvido' as const,
      recado: lerRecado(c.detalhe), // o selo "Recado das 02:14" (mig 379)
      responsavel: lerResponsavel(c.detalhe), // o recado para o responsável (mig 381) — só a gestão recebe
    }));
  }

  /**
   * A EQUIPE para "Passar o caso": as pessoas ATIVAS da loja em uso (e as sem loja), só id e nome — o mínimo, para quem
   * atende sem a permissão do cadastro de colaboradores. O presidente na rede vê todas. Em ordem de nome.
   * Na nuvem, com a situação de quem está no app de atendimento agora (mig 353: "Bruno · disponível", "Carla · ocupada:
   * caixa"); quem não está no app vem com `presenca: null`. No servidor da loja a tabela não existe — só os nomes.
   */
  async equipe(user: AuthUser, unidadeAtual: string | null) {
    const naNuvem = !ehServidorLocal();
    const r: any = await this.db.execute(sql`
      select c.id, c.nome ${naNuvem ? sql`, p.estado, p.motivo` : sql``}
        from colaborador c
        ${
          naNuvem
            ? sql`left join atendimento_presenca p on p.colaborador_id = c.id and p.tenant_id = c.tenant_id
                   and p.atualizado_em > now() - interval '${sql.raw(String(PRESENCA_VALE_MIN))} minutes'`
            : sql``
        }
       where c.tenant_id = ${user.tenantId} and c.status = 'ativo' and c.deleted_at is null
             ${sqlUnidadeOuRede('c.unidade_id', unidadeAtual)}
       order by c.nome
       limit ${LIMITE_DA_FILA}`);
    return ((r.rows ?? r) as Array<{ id: string; nome: string; estado?: string | null; motivo?: string | null }>).map((p) => ({
      id: p.id,
      nome: p.nome,
      eu: p.id === user.colaboradorId,
      presenca: p.estado ? { estado: p.estado, motivo: p.motivo ?? null } : null,
    }));
  }

  /**
   * As contagens da fila. O recado para o responsável que espera (mig 381) fica fora de "abertos" e "na fila" e conta em
   * `paraOResponsavel` — 0 para quem não é da gestão, que também não conta recado nenhum que não está com ele (RBAC).
   */
  private async contagens(user: AuthUser, loja: ReturnType<typeof sqlUnidadeOuRede>) {
    const desdeHoje = instanteDe(hojeISO());
    const r: any = await this.db.execute(sql`
      select count(*) filter (where c.status = 'aberto' and not ${RECADO_NA_ESPERA} and not ${RESPONSAVEL_NA_ESPERA})::int as abertos,
             count(*) filter (where c.status = 'aberto' and c.prazo_em is not null)::int as "comPrazo",
             count(*) filter (where c.status = 'aberto' and c.prazo_em is null and c.responsavel_id is null
                                and c.aguardando_desde is null and not ${RECADO_NA_ESPERA} and not ${RESPONSAVEL_NA_ESPERA})::int as "naFila",
             count(*) filter (where c.status = 'aberto' and c.responsavel_id = ${user.colaboradorId ?? null})::int as comigo,
             count(*) filter (where c.status = 'aberto' and c.aguardando_desde is not null)::int as aguardando,
             count(*) filter (where c.status = 'resolvido')::int as "resolvidosHoje",
             count(*) filter (where c.status = 'aberto' and ${RECADO_NA_ESPERA})::int as "paraAbertura",
             count(*) filter (where c.status = 'aberto' and ${RESPONSAVEL_NA_ESPERA})::int as "paraOResponsavel"
        from atendimento_chamado c
       where c.tenant_id = ${user.tenantId} ${loja}
         and (c.status = 'aberto' or c.resolvido_em >= ${desdeHoje})
         ${foraDoPerfil(user)}`);
    const contagens = (r.rows ?? r)[0];
    return { ...contagens, paraOResponsavel: ehGestor(user.categoria) ? contagens.paraOResponsavel : 0 };
  }

  /** Por que o caso não mudou: sumiu (404), já foi resolvido (409) ou outra pessoa pegou (409, com o nome). */
  private async motivoDeNaoMexer(tenantId: string, id: string) {
    const r: any = await this.db.execute(sql`
      select c.status, r.nome from atendimento_chamado c
        left join colaborador r on r.id = c.responsavel_id and r.tenant_id = c.tenant_id
       where c.tenant_id = ${tenantId} and c.id = ${id}`);
    const c = (r.rows ?? r)[0];
    if (!c) return new NotFoundException('Caso não encontrado.');
    if (c.status !== 'aberto') return new ConflictException('Este caso já foi resolvido.');
    return new ConflictException(`${c.nome ?? 'Outra pessoa'} já pegou este caso.`);
  }

  /**
   * PEGAR o caso para mim. Só o que está aberto e sem ninguém (ou já meu — repetir não muda a hora em que peguei). Duas
   * pessoas no mesmo instante: a gravação é condicional, só uma pega; a outra recebe "Fulano já pegou este caso".
   */
  async pegar(user: AuthUser, id: string) {
    const eu = user.colaboradorId;
    if (!eu) throw new ForbiddenException('Entre com o seu usuário para pegar o caso.');
    if (!UUID_RE.test(String(id))) throw new NotFoundException('Caso não encontrado.');
    const [row] = await this.db
      .update(atendimentoChamado)
      .set({
        responsavelId: eu,
        pegoEm: sql`case when ${atendimentoChamado.responsavelId} = ${eu} then ${atendimentoChamado.pegoEm} else now() end` as any,
      })
      .where(
        and(
          eq(atendimentoChamado.tenantId, user.tenantId),
          eq(atendimentoChamado.id, id),
          eq(atendimentoChamado.status, 'aberto'),
          or(isNull(atendimentoChamado.responsavelId), eq(atendimentoChamado.responsavelId, eu)),
        ),
      )
      .returning();
    if (!row) throw await this.motivoDeNaoMexer(user.tenantId, id);
    this.avisar(user.tenantId, id, 'pegou');
    return { ok: true, id, responsavelId: eu };
  }

  /**
   * PASSAR o caso para outra pessoa da equipe (ativa) ou de volta para a fila (`para` vazio). A execução só passa o que
   * é dela ou está sem ninguém; a gestão passa qualquer um. Gravação condicional: se o caso mudou de mãos enquanto a
   * pessoa escolhia, nada muda (409). Fica na auditoria (de quem → para quem).
   */
  async passar(user: AuthUser, id: string, dto: { para?: string | null } | null | undefined) {
    if (!UUID_RE.test(String(id))) throw new NotFoundException('Caso não encontrado.');
    const para = dto?.para ? String(dto.para) : null;
    if (para && !UUID_RE.test(para)) throw new BadRequestException('Escolha para quem passar o caso.');
    const [caso] = await this.db
      .select()
      .from(atendimentoChamado)
      .where(and(eq(atendimentoChamado.tenantId, user.tenantId), eq(atendimentoChamado.id, id)));
    if (!caso) throw new NotFoundException('Caso não encontrado.');
    if (caso.status !== 'aberto') throw new ConflictException('Este caso já foi resolvido.');
    if (user.categoria === 'execucao' && caso.responsavelId && caso.responsavelId !== user.colaboradorId)
      throw new ForbiddenException('Só a gestão passa o caso de outra pessoa.');
    if (para) {
      const ok: any = await this.db.execute(sql`
        select 1 from colaborador
         where id = ${para} and tenant_id = ${user.tenantId} and status = 'ativo' and deleted_at is null`);
      if (!(ok.rows ?? ok).length) throw new BadRequestException('Essa pessoa não está ativa na equipe.');
    }
    const [row] = await this.db
      .update(atendimentoChamado)
      .set({ responsavelId: para, pegoEm: para ? new Date() : null })
      .where(
        and(
          eq(atendimentoChamado.tenantId, user.tenantId),
          eq(atendimentoChamado.id, id),
          eq(atendimentoChamado.status, 'aberto'),
          caso.responsavelId ? eq(atendimentoChamado.responsavelId, caso.responsavelId) : isNull(atendimentoChamado.responsavelId),
        ),
      )
      .returning();
    if (!row) throw new ConflictException('O caso mudou enquanto você passava. Abra de novo e tente.');
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      unidadeId: caso.unidadeId ?? null,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'atendimento',
      acao: para ? 'passou_caso' : 'devolveu_caso_para_fila',
      entidadeTipo: 'atendimento_chamado',
      entidadeId: id,
      detalhe: { de: caso.responsavelId ?? null, para },
      origem: 'web',
    });
    this.avisar(user.tenantId, id, 'passou');
    return { ok: true, id, responsavelId: para };
  }

  /**
   * "AGUARDANDO O CLIENTE" (ou não). Quem marca fica com o caso, se ninguém tinha. Quando o cliente responde no WhatsApp,
   * o caso volta sozinho para a fila (`clienteRespondeu`, na entrada da mensagem).
   */
  async aguardar(user: AuthUser, id: string, dto: { aguardando?: unknown } | null | undefined) {
    const aguardando = exigirBooleano(dto?.aguardando, 'aguardando');
    if (!UUID_RE.test(String(id))) throw new NotFoundException('Caso não encontrado.');
    const eu = user.colaboradorId ?? null;
    const set: Record<string, unknown> = aguardando
      ? {
          aguardandoDesde: new Date(),
          responsavelId: sql`coalesce(${atendimentoChamado.responsavelId}, ${eu}::uuid)`,
          pegoEm: sql`coalesce(${atendimentoChamado.pegoEm}, now())`,
        }
      : { aguardandoDesde: null };
    const [row] = await this.db
      .update(atendimentoChamado)
      .set(set as any)
      .where(and(eq(atendimentoChamado.tenantId, user.tenantId), eq(atendimentoChamado.id, id), eq(atendimentoChamado.status, 'aberto')))
      .returning();
    if (!row) throw await this.motivoDeNaoMexer(user.tenantId, id);
    this.avisar(user.tenantId, id, aguardando ? 'aguardando' : 'voltou_para_fila');
    return { ok: true, id, aguardando };
  }

  // Veredito do cancelamento pedido pelo cliente. `aceita` cancela o pedido de
  // fato (delegando ao Delivery, que exige senha de gestor); senão só encerra o
  // chamado marcando a decisão como recusada.
  async decidirCancelamento(
    user: AuthUser,
    id: string,
    dto: { aceita?: boolean; senha?: string; motivo?: string; reaproveitado?: boolean; perdaItens?: unknown },
    terminalId: string | null = null,
    // Pelo WhatsApp do gestor (Gerente no WhatsApp, parte 5b): quem decide já foi conferido pela rotina do WhatsApp (o
    // número ligado, o nível e o acesso na hora) — vai no lugar da senha. A tela nunca passa isto.
    autorizadoPor: { id: string; nome: string } | null = null,
  ) {
    const [row] = await this.db
      .select()
      .from(atendimentoChamado)
      .where(and(eq(atendimentoChamado.tenantId, user.tenantId), eq(atendimentoChamado.id, id)));
    if (!row) throw new NotFoundException('Chamado não encontrado');
    if (row.tipo !== 'cancelamento') {
      throw new BadRequestException('Este chamado não é um pedido de cancelamento.');
    }

    let comprovante: { enfileirados: number; aviso: string | null } | undefined;
    if (dto.aceita) {
      if (!row.pedidoId) throw new BadRequestException('Chamado sem pedido vinculado.');
      // Delega ao Delivery (valida a senha do gestor, estorna financeiro/fidelidade, imprime o comprovante). O destino
      // dos insumos vem da tela, como no cancelamento do painel (ERR-339): antes ia `true` fixo — todo cancelamento pelo
      // chamado gravava "reaproveitado" e escondia o "Registrar perda" depois.
      const cancelado: any = await this.delivery.cancelar(
        user.tenantId,
        user.colaboradorId,
        user.categoria,
        row.pedidoId,
        String(dto.motivo ?? '').trim() || 'Cancelamento solicitado pelo cliente',
        dto.senha,
        dto.reaproveitado !== false,
        terminalId,
        lerItensDaPerda(dto.perdaItens),
        autorizadoPor,
      );
      comprovante = cancelado?.comprovante;
    }

    await this.db
      .update(atendimentoChamado)
      .set({
        status: 'resolvido',
        decisao: dto.aceita ? 'aceito' : 'recusado',
        resolvidoPorId: user.colaboradorId,
        resolvidoEm: new Date(),
        aguardandoDesde: null,
      })
      .where(eq(atendimentoChamado.id, id));
    this.avisar(user.tenantId, id, 'resolveu');
    return { ok: true, decisao: dto.aceita ? 'aceito' : 'recusado', ...(comprovante ? { comprovante } : {}) };
  }

  // ===================== ENDEREÇO DEPOIS QUE O PEDIDO SAIU (PR 3b-2, decisão 8) =====================

  /** A distância entre os dois endereços, medida pelo robô depois de abrir o caso (null = não deu para medir). */
  async anotarDistanciaDoEndereco(tenantId: string, id: string, distancia: Distancia | null) {
    const r: any = await this.db.execute(sql`
      update atendimento_chamado
         set detalhe = jsonb_set(detalhe, '{endereco,distancia}', ${JSON.stringify(distancia ?? null)}::jsonb, true)
       where tenant_id = ${tenantId} and id = ${id} and detalhe ? 'endereco'
      returning id`);
    if ((r.rows ?? r).length) this.avisar(tenantId, id, 'distancia');
  }

  /**
   * "MUDAR O ENDEREÇO E AVISAR O ENTREGADOR" — o caso urgente que o robô abriu quando o cliente pediu outro endereço com o
   * pedido JÁ NA RUA. Muda pelo MESMO `DeliveryService.alterar` da equipe, com `depoisQueSaiu` (só o endereço — sem
   * cozinha e sem via; a posição do endereço antigo sai e o app do entregador refaz o caminho pelo novo) e a taxa que a
   * equipe escolheu entre as duas que o Regem calculou ("manter" ou "nova" — nunca um valor digitado). O id da alteração é
   * do caso: o "Mudar" repetido, ou em dois computadores, muda uma vez. Na nuvem de loja com servidor ligado, vai como
   * "pedida" e o servidor da loja aplica. "Endereço atualizado!" sai ao cliente pela rotina da nuvem quando a mudança vale.
   * Quem toca fica com o caso, se ninguém tinha.
   */
  async mudarEnderecoDepoisQueSaiu(user: AuthUser, id: string, dto: { taxa?: unknown } | null | undefined) {
    if (!UUID_RE.test(String(id))) throw new NotFoundException('Caso não encontrado.');
    const [caso] = await this.db
      .select()
      .from(atendimentoChamado)
      .where(and(eq(atendimentoChamado.tenantId, user.tenantId), eq(atendimentoChamado.id, id)));
    if (!caso) throw new NotFoundException('Caso não encontrado.');
    if (caso.status !== 'aberto') throw new ConflictException('Este caso já foi resolvido.');
    const e = lerEnderecoDoCaso(caso.detalhe);
    if (caso.tipo !== 'mudanca' || !e) throw new BadRequestException('Este caso não tem um endereço novo para o pedido.');
    // Já mudou (ou está com o servidor da loja): o "Mudar" repetido não muda de novo. Recusada ou vencida: tenta outra vez.
    if (e.mudado) {
      const atual = await this.estadoDaAlteracao(user.tenantId, e.mudado.alteracaoId);
      if (atual !== 'recusada' && atual !== 'vencida') return { ok: true, id, mudado: e.mudado, repetido: true };
    }
    const t = taxaEscolhida(e, dto?.taxa);
    if (!t.ok) throw new BadRequestException(t.mensagem);
    const alteracaoId = idDaMudancaDoCaso(id, e.em, e.mudado?.alteracaoId ?? null);
    const ref = e.para.referencia ? ` (${e.para.referencia})` : '';
    let r: any;
    try {
      r = await this.delivery.alterar(
        user,
        e.pedidoId,
        {
          idAlteracao: alteracaoId,
          endereco: {
            rua: e.para.rua ?? '',
            numero: e.para.numero ?? '',
            bairro: e.para.bairro ?? '',
            ...(e.para.bairroId ? { bairroId: e.para.bairroId } : {}),
            referencia: e.para.referencia ?? '',
            taxa: t.taxa,
          },
          origem: 'equipe',
          pedidoDoCliente: `Entregar em ${enderecoEmUmaLinha(e.para)}${ref}`,
        },
        { depoisQueSaiu: true, precoInformado: true, chamadoId: id },
      );
    } catch (err: any) {
      // O servidor da loja numa versão que ainda não aplica a mudança pedida pela nuvem: a frase certa para este caso.
      const resp: any = err instanceof HttpException ? err.getResponse() : null;
      if (resp?.code === 'LOJA_COM_SERVIDOR')
        throw new ConflictException({
          statusCode: 409,
          code: 'LOJA_COM_SERVIDOR',
          message:
            'O servidor desta loja ainda não muda o endereço do pedido que já saiu (falta atualizá-lo): avise o entregador pelo WhatsApp dele e responda ao cliente.',
        });
      throw err;
    }
    const mudado: MudancaDoEndereco = {
      em: new Date().toISOString(),
      porId: user.colaboradorId ?? null,
      porNome: r?.alteracao?.porNome ?? user.nome ?? null,
      taxa: t.taxa,
      alteracaoId,
    };
    await this.db.execute(sql`
      update atendimento_chamado
         set detalhe = jsonb_set(detalhe, '{endereco,mudado}', ${JSON.stringify(mudado)}::jsonb, true),
             responsavel_id = coalesce(responsavel_id, ${user.colaboradorId ?? null}::uuid),
             pego_em = coalesce(pego_em, now())
       where tenant_id = ${user.tenantId} and id = ${id}`);
    const situacao = r?.alteracao?.situacao ?? 'aplicada';
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      unidadeId: caso.unidadeId ?? null,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'atendimento',
      acao: 'mudou_endereco_depois_que_saiu',
      entidadeTipo: 'atendimento_chamado',
      entidadeId: id,
      detalhe: { pedido: e.numero, pedidoId: e.pedidoId, alteracao: alteracaoId, situacao, taxa: t.taxa, para: enderecoEmUmaLinha(e.para) },
      origem: 'web',
    });
    this.avisar(user.tenantId, id, 'endereco_mudado');
    // Mudou na hora AQUI na nuvem: o cliente recebe já (a rotina cobre o resto — a pedida e a mudança feita na loja).
    if (situacao === 'aplicada' && !ehServidorLocal())
      void this.avisarEnderecosMudados(alteracaoId).catch((x: any) => this.logger.warn(`aviso do endereço ${alteracaoId}: ${x?.message ?? x}`));
    return { ok: true, id, mudado, situacao };
  }

  /** A situação da alteração (null = ainda não chegou a este banco); a "pedida" passada da validade é "vencida" (V80). */
  private async estadoDaAlteracao(tenantId: string, alteracaoId: string): Promise<string | null> {
    if (!UUID_RE.test(alteracaoId)) return null;
    const r: any = await this.db.execute(sql`
      select situacao, motivo, created_at as "criadaEm" from pedido_alteracao where tenant_id = ${tenantId} and id = ${alteracaoId}`);
    const x = (r.rows ?? r)[0];
    return x ? (estadoDaMudancaDoEndereco(x)?.situacao ?? null) : null;
  }

  /**
   * "ENDEREÇO ATUALIZADO!" AO CLIENTE (rotina da nuvem — `AvisoDoEnderecoProcessor`, e logo depois do "Mudar" quando a
   * nuvem aplica na hora): a alteração "depois que saiu" que VALEU — na hora, ou aplicada pelo servidor da loja e subida
   * pelo sincronismo. Uma vez só por alteração: a marca `pedido.avisoAoCliente` é gravada ANTES do envio, numa troca
   * condicional (duas réplicas nunca mandam duas vezes — V24/V42); na alteração, e não no caso, porque o caso é mexido dos
   * dois lados e a cópia da loja apagaria a marca. Passou do prazo (a loja ficou sem internet): marca sem mandar —
   * "endereço atualizado" uma hora depois só confunde. Pela via da conversa do caso. Até 50 por volta, todas as lojas numa
   * consulta (o índice parcial da mig 364 — a MESMA condição).
   */
  async avisarEnderecosMudados(soAlteracao?: string): Promise<number> {
    const r: any = await this.db.execute(consultaDosAvisosDoEndereco(soAlteracao));
    let n = 0;
    for (const x of (r.rows ?? r) as any[]) {
      try {
        const manda = !x.velha && !!x.telefone;
        const marca = { em: new Date().toISOString(), ...(x.velha ? { expirou: true } : !x.telefone ? { semTelefone: true } : {}) };
        const marcou: any = await this.db.execute(sql`
          update pedido_alteracao
             set pedido = coalesce(pedido, '{}'::jsonb) || jsonb_build_object('avisoAoCliente', ${JSON.stringify(marca)}::jsonb),
                 updated_at = now()
           where id = ${x.id} and not (coalesce(pedido, '{}'::jsonb) ? 'avisoAoCliente')
          returning id`);
        if (!(marcou.rows ?? marcou).length) continue; // outra volta (ou réplica) já avisou
        if (manda) {
          try {
            await this.mandarAoCliente(String(x.tenant_id), String(x.telefone), textoDoEnderecoAtualizado(x.pedido?.endereco ?? {}), x.via ?? null);
            n++;
          } catch (e: any) {
            const motivo = String(e?.message ?? e).slice(0, 200);
            this.logger.warn(`aviso do endereço ${x.id}: não saiu ao cliente — ${motivo}`);
            await this.db.execute(sql`
              update pedido_alteracao
                 set pedido = jsonb_set(pedido, '{avisoAoCliente,falhou}', to_jsonb(${motivo}::text), true), updated_at = now()
               where id = ${x.id}`);
          }
        }
        if (x.chamado_id) this.avisar(String(x.tenant_id), String(x.chamado_id), 'cliente_avisado');
      } catch (e: any) {
        this.logger.warn(`aviso do endereço ${x?.id}: a volta falhou — ${e?.message ?? e}`);
      }
    }
    return n;
  }

  /** A mensagem ao cliente pela via da conversa (`via`); sem ela, a do cardápio da empresa. Falha = lança. */
  private async mandarAoCliente(tenantId: string, telefone: string, texto: string, via: string | null) {
    let provedor = via === 'cloud' || via === 'evolution' ? via : null;
    if (!provedor) {
      const [cfg] = await this.db
        .select({ provedor: cardapioConfig.provedor })
        .from(cardapioConfig)
        .where(and(eq(cardapioConfig.tenantId, tenantId), sql`unidade_id is null`));
      provedor = cfg?.provedor === 'cloud' ? 'cloud' : 'evolution';
    }
    if (provedor === 'cloud') {
      if (!this.cloud) throw new Error('o WhatsApp oficial não está disponível aqui');
      await this.cloud.enviarTexto(tenantId, telefone, texto);
    } else {
      if (!this.evolution) throw new Error('o WhatsApp não está disponível aqui');
      await this.evolution.enviar(tenantId, telefone, texto);
    }
  }
}
