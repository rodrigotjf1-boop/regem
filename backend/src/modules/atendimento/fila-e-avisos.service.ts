import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ehServidorLocal } from '../../common/modo';
import { exigirBooleano } from '../../common/exigir';
import { AJUSTE_DA_EQUIPE_PADRAO, type AjusteDaEquipe, ajusteDaLinha, inicioDoCasoSql, lerAjusteDaEquipe, recadoAtivoSql } from './horario-da-equipe';
import { type PerfisDoAtendente, perfisDaEmpresa, salvarPerfisDoAtendente } from '../cardapio/perfis-do-atendente';
import { type AssuntosDoAtendente, assuntosDaEmpresa, paraOResponsavelSql, salvarAssuntosDoAtendente } from '../cardapio/assuntos-do-atendente';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** "Avisar o gerente se ninguém pegar o caso em": as opções do protótipo (2, 3, 5, 10 min) e 0 = não avisa. */
export const MINUTOS_DO_AVISO = [0, 2, 3, 5, 10] as const;
/** O padrão (protótipo da central, grupo "Fila e avisos"): 3 min; a posição na fila, dita (como o robô já fazia). */
export const AJUSTE_DA_FILA_PADRAO = { avisarGerenteMin: 3, dizerPosicao: true };
/** Quantos casos a rotina marca por volta (os que sobram ficam para a volta seguinte, um minuto depois). */
export const ESCALAR_POR_VOLTA = 500;

export type AjusteDaFila = { avisarGerenteMin: number; dizerPosicao: boolean };

/**
 * O que a tela mandou para "Fila e avisos", conferido (V16: ausente fica de fora; V15: liga/desliga só com booleano).
 * Pura — a rota confere ANTES de gravar qualquer grupo, para não gravar a 99 e recusar a fila no mesmo salvar.
 */
export function lerAjusteDaFila(dto: unknown): Partial<AjusteDaFila> {
  const d = (dto ?? {}) as { avisarGerenteMin?: unknown; dizerPosicao?: unknown };
  const parcial: Partial<AjusteDaFila> = {};
  if (d.avisarGerenteMin !== undefined) {
    const minutos = typeof d.avisarGerenteMin === 'number' ? d.avisarGerenteMin : NaN;
    if (!(MINUTOS_DO_AVISO as readonly number[]).includes(minutos))
      throw new BadRequestException('Avisar o gerente: escolha 2, 3, 5 ou 10 minutos, ou "Não avisar".');
    parcial.avisarGerenteMin = minutos;
  }
  if (d.dizerPosicao !== undefined) parcial.dizerPosicao = exigirBooleano(d.dizerPosicao, 'dizerPosicao');
  return parcial;
}

// FILA E AVISOS (Onda 2 da central de atendimento, mig 353; protótipo, grupo "Fila e avisos" dos ajustes):
//  • AVISO AO GERENTE — o caso que espera uma pessoa (sem ninguém com ele, sem esperar o cliente e sem prazo de
//    plataforma) e passou do tempo do ajuste ganha a marca `detalhe.escalado` ({ em, minutos }). O app de quem é gerente
//    ou presidente toca por ela; a tela mostra. UMA vez por caso, set-based (V39), na nuvem (o robô e o app falam com
//    ela). A gravação é condicional ("ainda sem a marca"): duas réplicas da API ao mesmo tempo marcam uma vez só.
//  • DIZER A POSIÇÃO — desligado, o robô não recebe o lugar do cliente na fila (e não o diz).
//  Os dois ajustes moram na `robo_config` da empresa; sem linha, valem os padrões.
@Injectable()
export class FilaEAvisosService {
  private readonly logger = new Logger('FilaEAvisos');
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
    // Quem mudou o ajuste fica na auditoria. Opcional: os testes montam o serviço sem ela.
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  @Interval(60_000)
  async tick() {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      await this.escalar();
    } catch (e: any) {
      this.logger.warn(`aviso ao gerente: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Marca os casos que ninguém pegou no tempo do ajuste. Devolve quantos marcou nesta volta. `soEmpresas`: só para o
   * teste — a rotina passa por todas, e no CI as specs dividem o banco (a de outra spec não pode ganhar a marca daqui).
   * As condições do caso estão DENTRO da seleção (para o limite da volta só pegar quem vale — senão os casos antigos já
   * avisados enchem o limite e os novos nunca são avisados) e DE NOVO na gravação (vale o caso como está na hora: alguém
   * pode ter pegado entre a seleção e a gravação). `limite`: o teste do "não emperra" usa um pequeno.
   * HORÁRIO DA EQUIPE (mig 379): o RECADO que ainda espera a equipe não é marcado (fora do horário ninguém é avisado —
   * nem o gerente, nem o "Gerente no WhatsApp", que depende desta marca); depois do `ate`, o tempo conta DALI (a volta
   * da equipe), não da criação — o recado das 02:14 não vira "ninguém pegou" no primeiro minuto da abertura. O
   * `criado_em <= …` fica (o recado acaba sempre depois de criado): a volta usa o índice da criação como antes.
   * ASSUNTOS QUE NÃO SÃO PEDIDO (mig 381): o RECADO PARA O RESPONSÁVEL nunca é marcado (não está na fila da equipe, não
   * avisa ninguém). A condição vai DENTRO da seleção (V84: senão os recados, que nunca ganham a marca, enchem o limite) e
   * de novo na gravação.
   */
  async escalar(soEmpresas?: string[], limite: number = ESCALAR_POR_VOLTA): Promise<number> {
    const empresas = soEmpresas?.length ? sql`and c2.tenant_id in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;
    const prazo = sql`now() - make_interval(mins => coalesce(rc.avisar_gerente_min, ${AJUSTE_DA_FILA_PADRAO.avisarGerenteMin}))`;
    const r: any = await this.db.execute(sql`
      update atendimento_chamado c
         set detalhe = coalesce(c.detalhe, '{}'::jsonb)
                       || jsonb_build_object('escalado', jsonb_build_object('em', now(), 'minutos', alvo.minutos))
        from (
          select c2.id, coalesce(rc.avisar_gerente_min, ${AJUSTE_DA_FILA_PADRAO.avisarGerenteMin}) as minutos
            from atendimento_chamado c2
            left join robo_config rc on rc.tenant_id = c2.tenant_id
           where c2.status = 'aberto' and c2.responsavel_id is null and c2.aguardando_desde is null and c2.prazo_em is null
             and coalesce(rc.avisar_gerente_min, ${AJUSTE_DA_FILA_PADRAO.avisarGerenteMin}) > 0
             and c2.criado_em <= ${prazo}
             and ${inicioDoCasoSql('c2')} <= ${prazo}
             and c2.detalhe -> 'escalado' is null
             and not ${paraOResponsavelSql('c2')}
             ${empresas}
           order by c2.criado_em
           limit ${limite}
        ) alvo
       where c.id = alvo.id and c.status = 'aberto' and c.responsavel_id is null and c.detalhe -> 'escalado' is null
         and not ${recadoAtivoSql('c')} and not ${paraOResponsavelSql('c')}
      returning c.tenant_id as "tenantId", c.id`);
    const linhas = (r.rows ?? r) as Array<{ tenantId: string; id: string }>;
    for (const l of linhas) this.events.emit('atendimento.mudou', { tenantId: l.tenantId, id: l.id, motivo: 'escalou' });
    return linhas.length;
  }

  /** Os ajustes "Fila e avisos" da empresa (sem linha, os padrões). */
  async ajustes(tenantId: string): Promise<AjusteDaFila> {
    const r: any = await this.db.execute(sql`
      select avisar_gerente_min as "avisarGerenteMin", dizer_posicao as "dizerPosicao" from robo_config where tenant_id = ${tenantId}::uuid`);
    const row = (r.rows ?? r)[0];
    return {
      avisarGerenteMin: row?.avisarGerenteMin ?? AJUSTE_DA_FILA_PADRAO.avisarGerenteMin,
      dizerPosicao: row?.dizerPosicao ?? AJUSTE_DA_FILA_PADRAO.dizerPosicao,
    };
  }

  /**
   * Salva o que veio (V16: ausente mantém; V15: liga/desliga só com booleano). Grava SÓ as próprias colunas da
   * `robo_config` — o ajuste do robô (pausa, avisos) é de outro escritor (V82). Cada mudança fica na auditoria.
   */
  async salvar(user: AuthUser, dto: unknown): Promise<AjusteDaFila> {
    const parcial = lerAjusteDaFila(dto);
    const antes = await this.ajustes(user.tenantId);
    if (!Object.keys(parcial).length) return antes;
    const depois: AjusteDaFila = { ...antes, ...parcial };
    await this.db.execute(sql`
      insert into robo_config (tenant_id, avisar_gerente_min, dizer_posicao, atualizado_por)
      values (${user.tenantId}::uuid, ${depois.avisarGerenteMin}, ${depois.dizerPosicao}, ${user.colaboradorId}::uuid)
      on conflict (tenant_id) do update
         set avisar_gerente_min = excluded.avisar_gerente_min, dizer_posicao = excluded.dizer_posicao,
             atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
    const registrar = (acao: string, detalhe: Record<string, unknown>) =>
      this.auditoria?.registrar({
        tenantId: user.tenantId,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria,
        tipo: 'config',
        acao,
        entidadeTipo: 'robo_config',
        entidadeId: user.tenantId,
        detalhe,
      });
    if (antes.avisarGerenteMin !== depois.avisarGerenteMin)
      await registrar('aviso_ao_gerente_alterado', { de: antes.avisarGerenteMin, para: depois.avisarGerenteMin });
    if (antes.dizerPosicao !== depois.dizerPosicao) await registrar(depois.dizerPosicao ? 'dizer_posicao_ligado' : 'dizer_posicao_desligado', {});
    return this.ajustes(user.tenantId);
  }

  /**
   * "Horário da equipe" (mig 379; protótipo versão 10): a equipe atende sempre ou no horário da loja, a folga antes de
   * abrir e depois de fechar, e o que o robô diz fora do horário. Da empresa; sem linha, os padrões (nasce em "Sempre").
   * Num banco sem a 379 (ou sem a `robo_config`), os padrões: o resto dos ajustes não cai por causa deste grupo.
   */
  async ajusteDaEquipe(tenantId: string): Promise<AjusteDaEquipe> {
    try {
      const r: any = await this.db.execute(sql`
        select equipe_atende as atende, equipe_antes_min as "antesMin", equipe_depois_min as "depoisMin",
               equipe_fora_texto as "textoFora"
          from robo_config where tenant_id = ${tenantId}::uuid`);
      return ajusteDaLinha((r.rows ?? r)[0]);
    } catch (e: any) {
      if (e?.code === '42703' || e?.code === '42P01') return { ...AJUSTE_DA_EQUIPE_PADRAO }; // banco sem a 379
      throw e;
    }
  }

  /**
   * Salva o que veio de "Horário da equipe" (V16: ausente mantém; cada escolha só entre as opções; texto vazio = o
   * padrão). Grava SÓ as colunas que vieram — as outras da `robo_config` têm outros donos, e dois salvamentos ao mesmo
   * tempo não desfazem um ao outro (V82). Cada mudança fica na auditoria.
   */
  async salvarEquipe(user: AuthUser, dto: unknown): Promise<AjusteDaEquipe> {
    const parcial = lerAjusteDaEquipe(dto);
    const antes = await this.ajusteDaEquipe(user.tenantId);
    const mudou = (Object.keys(parcial) as Array<keyof AjusteDaEquipe>).filter((k) => parcial[k] !== antes[k]);
    if (!mudou.length) return antes;
    const depois: AjusteDaEquipe = { ...antes, ...parcial };
    const coluna: Record<keyof AjusteDaEquipe, string> = {
      atende: 'equipe_atende',
      antesMin: 'equipe_antes_min',
      depoisMin: 'equipe_depois_min',
      textoFora: 'equipe_fora_texto',
    };
    const atualizar = sql.join(
      mudou.map((k) => sql.raw(`${coluna[k]} = excluded.${coluna[k]}`)),
      sql`, `,
    );
    await this.db.execute(sql`
      insert into robo_config (tenant_id, equipe_atende, equipe_antes_min, equipe_depois_min, equipe_fora_texto, atualizado_por)
      values (${user.tenantId}::uuid, ${depois.atende}, ${depois.antesMin}, ${depois.depoisMin}, ${depois.textoFora}::text,
              ${user.colaboradorId}::uuid)
      on conflict (tenant_id) do update
         set ${atualizar}, atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
    const acao: Record<keyof AjusteDaEquipe, string> = {
      atende: 'equipe_atende_alterado',
      antesMin: 'equipe_comeca_alterado',
      depoisMin: 'equipe_para_alterado',
      textoFora: 'equipe_texto_fora_alterado',
    };
    for (const k of mudou)
      await this.auditoria?.registrar({
        tenantId: user.tenantId,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria,
        tipo: 'config',
        acao: acao[k],
        entidadeTipo: 'robo_config',
        entidadeId: user.tenantId,
        detalhe: { de: antes[k], para: depois[k] },
      });
    return this.ajusteDaEquipe(user.tenantId);
  }

  /**
   * "Perfil do atendente virtual" (mig 380; protótipo versão 11): o perfil de cada canal (WhatsApp, Direct e — F5 — o chat do
   * iFood e da 99), o de fora do horário da equipe e o jeito da loja. Da empresa; sempre os três canais, com os padrões
   * ("Como hoje") no que faltar —
   * num banco sem a 380 (ou sem a `robo_config`), os padrões: o resto dos ajustes não cai por causa deste grupo.
   */
  perfisDoAtendente(tenantId: string): Promise<PerfisDoAtendente> {
    return perfisDaEmpresa(this.db, tenantId);
  }

  /**
   * Salva o que veio de "Perfil do atendente virtual" (V16: ausente mantém; cada escolha só entre as opções). Grava SÓ os
   * campos que mudaram, mesclados dentro do jsonb (V82); cada mudança fica na auditoria (`atendente_perfil_alterado`).
   */
  salvarPerfis(user: AuthUser, dto: unknown): Promise<PerfisDoAtendente> {
    return salvarPerfisDoAtendente(this.db, user, dto, this.auditoria ? (e) => this.auditoria!.registrar(e as any) : undefined);
  }

  /**
   * "Assuntos que não são pedido" (mig 381; protótipo versão 12): o que o robô faz com fornecedor, vaga de emprego e
   * parceria (como hoje · recado para o responsável · não é por aqui) e o que ele diz. Da empresa; sempre os três, com os
   * padrões ("Como hoje") no que faltar — num banco sem a 381 (ou sem a `robo_config`), os padrões.
   */
  assuntosDoAtendente(tenantId: string): Promise<AssuntosDoAtendente> {
    return assuntosDaEmpresa(this.db, tenantId);
  }

  /**
   * Salva o que veio de "Assuntos que não são pedido" (V16: ausente mantém; cada escolha só entre as opções). Grava SÓ os
   * campos que mudaram, mesclados dentro do jsonb (V82); cada mudança fica na auditoria (`atendente_assunto_alterado`).
   */
  salvarAssuntos(user: AuthUser, dto: unknown): Promise<AssuntosDoAtendente> {
    return salvarAssuntosDoAtendente(this.db, user, dto, this.auditoria ? (e) => this.auditoria!.registrar(e as any) : undefined);
  }

  /**
   * "O robô faz mudanças simples" (mig 363; grupo "Pedido alterado" dos ajustes — `mockups/regem-alteracao-pedido.html`):
   * nasce LIGADO (decisão 3A); sem linha (ou banco sem a 363), ligado. Vale para a empresa toda (o robô é um só).
   */
  async roboMudaPedido(tenantId: string): Promise<boolean> {
    try {
      const r: any = await this.db.execute(sql`select muda_pedido from robo_config where tenant_id = ${tenantId}::uuid`);
      const l = (r.rows ?? r)[0];
      return l ? l.muda_pedido !== false : true;
    } catch (e: any) {
      if (e?.code === '42703' || e?.code === '42P01') return true; // banco sem a 363 (ou sem o robô): como nasce
      throw e;
    }
  }

  /** Grava SÓ a coluna dele (`muda_pedido`) — as outras da `robo_config` têm outros donos (V82); a mudança vai à auditoria. */
  async salvarRoboMudaPedido(user: AuthUser, ligado: boolean): Promise<boolean> {
    const antes = await this.roboMudaPedido(user.tenantId);
    if (antes === ligado) return antes;
    await this.db.execute(sql`
      insert into robo_config (tenant_id, muda_pedido, atualizado_por)
      values (${user.tenantId}::uuid, ${ligado}, ${user.colaboradorId}::uuid)
      on conflict (tenant_id) do update
         set muda_pedido = excluded.muda_pedido, atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: ligado ? 'robo_muda_pedido_ligado' : 'robo_muda_pedido_desligado',
      entidadeTipo: 'robo_config',
      entidadeId: user.tenantId,
      detalhe: {},
    });
    return this.roboMudaPedido(user.tenantId);
  }

  /**
   * "O robô cobra no Pix o item posto em pedido já pago" (mig 373; grupo "Pedido alterado"): nasce DESLIGADO — o dono liga.
   * Sem linha (ou banco sem a 373), desligado. Vale para a empresa toda (o robô é um só).
   */
  async roboCobraAdicionalPix(tenantId: string): Promise<boolean> {
    try {
      const r: any = await this.db.execute(sql`select cobra_adicional_pix from robo_config where tenant_id = ${tenantId}::uuid`);
      return (r.rows ?? r)[0]?.cobra_adicional_pix === true;
    } catch (e: any) {
      if (e?.code === '42703' || e?.code === '42P01') return false; // banco sem a 373
      throw e;
    }
  }

  /** Grava SÓ a coluna dele (`cobra_adicional_pix` — V82); a mudança vai à auditoria. */
  async salvarRoboCobraAdicionalPix(user: AuthUser, ligado: boolean): Promise<boolean> {
    const antes = await this.roboCobraAdicionalPix(user.tenantId);
    if (antes === ligado) return antes;
    await this.db.execute(sql`
      insert into robo_config (tenant_id, cobra_adicional_pix, atualizado_por)
      values (${user.tenantId}::uuid, ${ligado}, ${user.colaboradorId}::uuid)
      on conflict (tenant_id) do update
         set cobra_adicional_pix = excluded.cobra_adicional_pix, atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: ligado ? 'robo_cobra_adicional_pix_ligado' : 'robo_cobra_adicional_pix_desligado',
      entidadeTipo: 'robo_config',
      entidadeId: user.tenantId,
      detalhe: {},
    });
    return this.roboCobraAdicionalPix(user.tenantId);
  }

  /**
   * O robô diz ao cliente o lugar dele na fila? Na dúvida (leitura falhou), diz — é o padrão e o que ele sempre fez.
   * No servidor da loja não há robô nem a tabela: diz.
   */
  async dizPosicao(tenantId: string): Promise<boolean> {
    if (ehServidorLocal()) return true;
    try {
      return (await this.ajustes(tenantId)).dizerPosicao;
    } catch {
      return true;
    }
  }
}
