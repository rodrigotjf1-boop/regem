import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { FUSO_OPERACAO, dataNoFuso, hojeISO, horaNoFuso, somarDias } from '../../common/data';
import { instanteDe } from '../../common/fuso-sql';
import { podeAcessar } from '../../auth/permissoes';
import { ModuloService } from '../modulo/modulo.service';
import { RAMO_DA_EMPRESA_COM_BOLETIM, RAMO_DO_REGEM, type BoletimDoRamo } from '../pulso/pulso.regras';
import { paginaPadrao } from '../vagas/vagas';
import { TEXTOS_DO_AGENTE, filtrarSaida, fraseDoMotivo, semValoresNoTexto } from './mister-agente.regras';
import { MisterAgenteService } from './mister-agente.service';
import { dentroDaJanelaDoWhatsapp } from './mister-avisos.regras';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { MisterFerramentasService } from './mister-ferramentas.service';
import { MODELO_DO_RESUMO, parametrosDoResumo } from './mister-modelos';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { MisterRelatoriosConfigService } from './mister-relatorios-config.service';
import { MisterResumoArquivoService } from './mister-resumo-arquivo.service';
import type { TipoDoResumo } from './grafico/plano-do-resumo';
import {
  AgoraNaOperacao,
  FICHAS_NO_RESUMO_MAX,
  RECURSO_DO_RELATORIO,
  RELATORIO_INTERROMPIDO_MIN,
  RegraDoRelatorio,
  RelatorioDevido,
  TipoDeRelatorio,
  janelaDasFichas,
  perguntaDoRelatorio,
  regraDoRelatorioQueVale,
  relatorioDevido,
  soAoPresidente,
  temConviteOpcional,
  textoDasFichasNovas,
  textoDoBoletim,
} from './mister-relatorios.regras';
import { lerDiaDaAgenda } from './mister-clima-eventos.leitura';
import type { EscopoDoMister } from './mister-ferramentas.service';
import {
  BOTAO_DA_VESPERA,
  type DaVespera,
  PERGUNTA_DO_ESTOQUE,
  TEXTO_DEIXA_ASSIM,
  botoesDaVespera,
  lerBotaoDaVespera,
  linhaDeAmanha,
  oQueAvisar,
  textoDaVespera,
} from './mister-vespera';
import { pessoaVale } from './mister-vinculo.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS RELATÓRIOS DO MISTER (mig 420): o resumo do dia e o da semana, no horário que a empresa escolheu.
//
//  • A rotina (a cada 5 minutos, só na nuvem) acha os relatórios LIGADOS que vencem agora (`relatorioDevido`: do horário
//    até 3 horas depois) e, para cada pessoa que recebe os avisos do Mister (presidente e gerente ligados, sem PARAR
//    AVISOS), faz UM resumo no escopo dela — o presidente, a empresa; o gerente, a loja dele.
//  • A vez de fazer é a linha de `mister_relatorio` (única por empresa, tipo, referência e pessoa): quem insere primeiro
//    faz; a volta repetida e a réplica a mais caem no `on conflict` e não chamam a IA de novo.
//  • Antes da IA, a janela de 24 h da Meta: fora dela a mensagem livre não chega. Vai o CONVITE pelo modelo aprovado
//    ("Seu resumo de … está pronto. Toque no botão para receber.") e a linha fica "não enviado / convite_enviado". Nada se
//    gasta com IA até a pessoa tocar em "Ver resumo": aí o resumo é feito para o mesmo período (`entregarPeloToque`).
//    Sem o modelo aprovado, fica "fora da janela e sem modelo". Sem a chave de IA, não sai, com o motivo.
//  • O texto sai pelo MESMO agente das perguntas (as consultas, os tetos, o filtro de saída), com o recurso do relatório
//    no medidor ("Uso da IA"). Nada daqui lança para a rotina: cada falha vira o motivo da linha e o log.
//  • FICHAS NOVAS (F4c das vagas): sem a IA. Antes de pegar a vez, confere se a pessoa pode ver os candidatos (presidente
//    ou a permissão Candidatos), quais lojas dela têm o módulo de vagas e se chegou ficha na janela (da véspera no horário
//    marcado até hoje nesse horário). Sem ficha, não sai nada nem fica linha — "só nos dias em que chegou ficha". O texto
//    leva o primeiro nome e a inicial, a função, a escala e a distância: telefone e endereço ficam no Regem. Fora das 24
//    horas, o mesmo convite dos resumos; no toque, a lista é lida de novo para a mesma janela.
//  • BOLETIM DO RAMO (fase N2 das Notícias do ramo): sem a IA, da cópia do Pulso. Vai ao presidente e ao gerente com a
//    permissão, só nos dias com destaque ou novidade. Fora das 24 horas o padrão é não gastar: a linha fica "não enviado /
//    fora das 24 horas" e a pessoa lê na tela. O convite pago só sai se a empresa escolheu (`convidarFora`, mig 496).

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.code === '42703';
/** Só o resumo do dia e o da semana têm o PDF e os gráficos (M5e); as ideias da semana (C8) vão só por escrito. */
const temArquivoDoResumo = (t: TipoDeRelatorio): boolean => t === 'resumo_dia' || t === 'resumo_semana';

/** O endereço da tela de Candidatos na nuvem (vai no fim do resumo das fichas). */
export function linkDosCandidatos(): string {
  return `${String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '')}/candidatos`;
}

/** O endereço da tela de Notícias do ramo (vai no fim do boletim). */
export function linkDasNoticias(): string {
  return `${String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '')}/noticias-do-ramo`;
}

/** O relógio da operação agora: o dia, a hora e o dia da semana (1 = segunda … 7 = domingo). */
export function agoraNaOperacao(agora: Date = new Date()): AgoraNaOperacao {
  const curto = agora.toLocaleDateString('en-US', { timeZone: FUSO_OPERACAO, weekday: 'short' });
  const ordem = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(curto);
  return { dia: dataNoFuso(agora), hora: horaNoFuso(agora), diaSemana: ordem + 1 };
}

export interface ResultadoDaVoltaDosRelatorios {
  devidos: number;
  feitos: number;
  enviados: number;
  naoEnviados: number;
  /** Fora das 24 horas: o convite pelo modelo saiu e o resumo espera o toque. */
  convites: number;
}

/** O motivo da linha cujo convite saiu e espera o toque; e o da que está sendo feita agora, depois do toque. */
export const CONVITE_ENVIADO = 'convite_enviado';
const FAZENDO_NO_TOQUE = 'fazendo_no_toque';
/** MIS-H-08: quantas vezes o toque no convite pode tentar o resumo com IA (o que falha reabre o convite até aqui). */
export const TOQUES_NO_CONVITE = 3;
export const TOQUES_ESGOTADOS = 'Tentei fazer esse resumo 3 vezes e a IA não respondeu. Ele fica de fora; o próximo chega no horário de sempre.';
/** O boletim fora das 24 horas, com a empresa sem o convite: não sai e não custa nada; a pessoa lê na tela. */
export const FORA_SEM_CONVITE = 'fora_da_janela_sem_convite';

@Injectable()
export class MisterRelatoriosService implements OnModuleInit {
  private readonly logger = new Logger('MisterRelatorios');
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly config: MisterRelatoriosConfigService,
    private readonly agente: MisterAgenteService,
    private readonly ferramentas: MisterFerramentasService,
    private readonly numero: MisterNumeroService,
    @Optional() private readonly entrada?: MisterEntradaService,
    // F4c: o módulo de vagas de cada loja. Sem ele (os testes antigos não o montam), as fichas novas não saem.
    @Optional() private readonly modulos?: ModuloService,
    // Versão 5, M5e: o resumo com os botões "📄 PDF" e "📊 Ver gráficos" (ou o PDF/link junto). Sem ele, só o texto.
    @Optional() private readonly arquivo?: MisterResumoArquivoService,
  ) {}

  /** O toque em "Ver resumo" chega pela entrada do WhatsApp, que mora no módulo de baixo: ela chama este serviço. */
  onModuleInit(): void {
    this.entrada?.registrarToque('resumo', (id, quem) => this.entregarPeloToque(id, quem));
    this.entrada?.registrarBotao(BOTAO_DA_VESPERA, (botaoId, quem) => this.tocouNaVespera(botaoId, quem));
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async rotina(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      await this.volta();
    } catch (e: any) {
      if (!semTabela(e)) this.logger.error(`a volta dos relatórios falhou — ${e?.message ?? e}`, e?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /** Uma volta: fecha o que ficou "fazendo" (interrompido) e faz o que vence agora. */
  async volta(agora: Date = new Date(), soEmpresas?: string[]): Promise<ResultadoDaVoltaDosRelatorios> {
    const fim: ResultadoDaVoltaDosRelatorios = { devidos: 0, feitos: 0, enviados: 0, naoEnviados: 0, convites: 0 };
    await this.fecharInterrompidos();
    const ligadas = (await this.config.ligadas()).filter((l) => !soEmpresas || soEmpresas.includes(l.tenantId));
    const relogio = agoraNaOperacao(agora);
    const devidas = ligadas.map((l) => ({ ...l, devido: relatorioDevido(l.tipo, l.regra, relogio) })).filter((l) => l.devido);
    if (!devidas.length) return fim;
    // A chave geral do número do Mister: desligada, nada sai (e nada se gasta).
    if (!(await this.numero.ler()).ligado) return fim;
    for (const d of devidas) {
      fim.devidos++;
      for (const pessoa of await this.quemRecebe(d.tenantId)) {
        const r = await this.fazer(d.tenantId, d.tipo, d.regra, d.devido!, pessoa, agora);
        if (r === null) continue;
        fim.feitos++;
        if (r === 'convite') fim.convites++;
        else if (r) fim.enviados++;
        else fim.naoEnviados++;
      }
    }
    return fim;
  }

  /** O presidente e os gerentes ligados ao Mister, sem PARAR AVISOS (a mesma régua dos avisos). */
  private async quemRecebe(tenantId: string): Promise<Array<{ colaboradorId: string; telefone: string; ultimaEntrada: Date | null; empresa: string }>> {
    return linhas(
      await this.db.execute(sql`
        select g.colaborador_id::text as "colaboradorId", g.telefone, g.ultima_entrada_em as "ultimaEntrada", emp.nome as empresa
          from mister_vinculo g
          join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = g.tenant_id
         where g.tenant_id = ${tenantId}::uuid and g.ligado_em is not null and g.telefone is not null and g.pausado_em is null and ${pessoaVale()}
         order by g.ligado_em`),
    ).map((l) => ({ colaboradorId: l.colaboradorId, telefone: String(l.telefone), ultimaEntrada: l.ultimaEntrada ? new Date(l.ultimaEntrada) : null, empresa: String(l.empresa ?? '') }));
  }

  /**
   * Um relatório para uma pessoa. Devolve null quando outra volta já o fez (a vez é da linha), true quando saiu, false
   * quando não saiu (o motivo fica na linha) e 'convite' quando, fora das 24 horas, o convite pelo modelo saiu.
   */
  private async fazer(
    tenantId: string,
    tipo: TipoDeRelatorio,
    regra: RegraDoRelatorio,
    devido: RelatorioDevido,
    pessoa: { colaboradorId: string; telefone: string; ultimaEntrada: Date | null; empresa: string },
    agora: Date,
  ): Promise<boolean | 'convite' | null> {
    // Fichas novas: antes da vez, se a pessoa vê candidatos e se chegou ficha. Nada a dizer = nada sai e nada fica.
    let fichas: { texto: string; total: number } | null = null;
    if (tipo === 'fichas_novas') {
      try {
        fichas = await this.fichasDaPessoa(tenantId, pessoa.colaboradorId, pessoa.telefone, devido);
      } catch (e: any) {
        this.logger.error(`as fichas novas de ${devido.referencia} (empresa ${tenantId}) não foram lidas — ${e?.message ?? e}`, e?.stack);
        return null;
      }
      if (!fichas) return null;
    }
    // Boletim do ramo: antes da vez, se a pessoa pode ver e se o dia tem novidade. Sem cópia ainda, a volta seguinte tenta.
    let boletim: { texto: string } | null = null;
    if (tipo === 'boletim_ramo') {
      try {
        boletim = await this.boletimDaPessoa(tenantId, pessoa.colaboradorId, pessoa.telefone, devido);
      } catch (e: any) {
        this.logger.error(`o boletim de ${devido.referencia} (empresa ${tenantId}) não foi lido — ${e?.message ?? e}`, e?.stack);
        return null;
      }
      if (!boletim) return null;
    }
    // A véspera (versão 8, E3): antes da vez, se amanhã tem algo para dizer. Dia comum = nada sai e nada fica.
    let vespera: { texto: string } | null = null;
    if (tipo === 'vespera') {
      try {
        vespera = await this.vesperaDaPessoa(tenantId, pessoa.colaboradorId, pessoa.telefone, devido);
      } catch (e: any) {
        this.logger.error(`a véspera de ${devido.referencia} (empresa ${tenantId}) não foi lida — ${e?.message ?? e}`, e?.stack);
        return null;
      }
      if (!vespera) return null;
    }
    // Versão 10, C8: as ideias da semana são só do presidente (o gerente que recebe os resumos não recebe as ideias). Antes da
    // vez: para o gerente não sai nada e não fica linha.
    if (soAoPresidente(tipo)) {
      const e = await this.ferramentas.escopo(tenantId, pessoa.colaboradorId, pessoa.telefone).catch(() => null);
      if (!e || e.nivel !== 'presidente') return null;
    }
    const [vez] = linhas(
      await this.db.execute(sql`
        insert into mister_relatorio (tenant_id, tipo, referencia, colaborador_id, final_do_telefone)
        values (${tenantId}::uuid, ${tipo}, ${devido.referencia}::date, ${pessoa.colaboradorId}::uuid, ${pessoa.telefone.slice(-4)})
        on conflict (tenant_id, tipo, referencia, colaborador_id) do nothing
        returning id`),
    );
    if (!vez) return null;
    const naoSaiu = async (motivo: string, extra: { texto?: string; trilha?: unknown } = {}) => {
      await this.concluir(vez.id, 'nao_enviado', motivo, extra);
      return false;
    };
    try {
      // Fora da janela de 24 h da Meta a mensagem livre não chega: vai o convite pelo modelo, e nada se gasta com IA até
      // a pessoa tocar em "Ver resumo". O período fica na trilha (o toque faz o resumo do MESMO período, mesmo dias depois).
      // Q1 (mig 436): pelo Evolution não há janela — o resumo vai direto.
      if (!(await this.numero.semJanela()) && !dentroDaJanelaDoWhatsapp(pessoa.ultimaEntrada, agora.getTime())) {
        // O boletim e a véspera só gastam com o convite se a empresa escolheu (decisões N7 e V8-9).
        if (temConviteOpcional(tipo) && !regra.convidarFora) return await naoSaiu(FORA_SEM_CONVITE);
        try {
          await this.numero.enviarModelo(pessoa.telefone, MODELO_DO_RESUMO, parametrosDoResumo(tipo, devido, pessoa.empresa), { tipo: 'resumo', id: vez.id });
        } catch (e: any) {
          const m = e instanceof FalhaDoEnvioDoMister ? e.motivo : 'erro';
          return await naoSaiu(m === 'modelo_nao_aprovado' ? 'fora_da_janela_e_sem_modelo' : `convite: ${m}`);
        }
        await this.concluir(vez.id, 'nao_enviado', CONVITE_ENVIADO, {
          trilha: { convite: { referencia: devido.referencia, ate: devido.ate, ...(devido.hora ? { hora: devido.hora } : {}) }, ...(fichas ? { fichas: fichas.total } : {}) },
        });
        return 'convite';
      }
      if (tipo === 'fichas_novas') {
        const texto = fichas!.texto;
        try {
          await this.numero.enviar(pessoa.telefone, { texto });
        } catch (e: any) {
          return await naoSaiu(e instanceof FalhaDoEnvioDoMister ? `envio: ${e.motivo}` : 'envio', { texto, trilha: { fichas: fichas!.total } });
        }
        await this.concluir(vez.id, 'enviado', null, { texto, trilha: { fichas: fichas!.total } });
        return true;
      }
      if (tipo === 'boletim_ramo') {
        const texto = boletim!.texto;
        try {
          await this.numero.enviar(pessoa.telefone, { texto });
        } catch (e: any) {
          return await naoSaiu(e instanceof FalhaDoEnvioDoMister ? `envio: ${e.motivo}` : 'envio', { texto });
        }
        await this.concluir(vez.id, 'enviado', null, { texto });
        return true;
      }
      if (tipo === 'vespera') {
        const texto = vespera!.texto;
        try {
          await this.mandarVespera(pessoa.telefone, String(vez.id), texto);
        } catch (e: any) {
          return await naoSaiu(e instanceof FalhaDoEnvioDoMister ? `envio: ${e.motivo}` : 'envio', { texto });
        }
        await this.concluir(vez.id, 'enviado', null, { texto });
        return true;
      }
      const escopo = await this.ferramentas.escopo(tenantId, pessoa.colaboradorId, pessoa.telefone);
      if (!escopo || escopo.semLoja) return await naoSaiu('sem_acesso');
      // Rodada 7, MIS-H-08 (ERR-660): a trava de emergência das perguntas para também o relatório com IA.
      if (process.env.MISTER_PERGUNTAS_DESLIGADAS === '1') return await naoSaiu('manutencao');
      const fim = await this.agente.responder(escopo, [], perguntaDoRelatorio(tipo, devido), { recurso: RECURSO_DO_RELATORIO[tipo] });
      if (fim.motivo) return await naoSaiu(fim.motivo, { trilha: fim.trilha });
      const saida = filtrarSaida(fim.texto, fim.resultados);
      // Rodada 7, MIS-E-10 (ERR-656): quem não vê valores não recebe R$ no relatório.
      if (!escopo.verValores || escopo.pinPendente) saida.texto = semValoresNoTexto(saida.texto);
      const textoFinal = tipo === 'resumo_dia' && regra.linhaAmanha ? await this.comLinhaDeAmanha(escopo, devido.referencia, saida.texto) : saida.texto;
      const trilha: Record<string, unknown> = { ...fim.trilha, conferencia: saida.notas };
      try {
        // Versão 5, M5e: o texto e o que vai junto ("Como mandar o resumo"); sem o serviço, só o texto, como antes.
        // As ideias da semana (C8) vão só por escrito: não têm PDF nem gráficos.
        if (this.arquivo && temArquivoDoResumo(tipo))
          trilha.entrega = await this.arquivo.entregar({ tenantId, colaboradorId: pessoa.colaboradorId, telefone: pessoa.telefone }, escopo, String(vez.id), tipo as TipoDoResumo, devido.referencia, textoFinal);
        else await this.numero.enviar(pessoa.telefone, { texto: textoFinal });
      } catch (e: any) {
        return await naoSaiu(e instanceof FalhaDoEnvioDoMister ? `envio: ${e.motivo}` : 'envio', { texto: textoFinal, trilha });
      }
      await this.concluir(vez.id, 'enviado', null, { texto: textoFinal, trilha });
      return true;
    } catch (e: any) {
      this.logger.error(`o relatório ${tipo} de ${devido.referencia} (empresa ${tenantId}) não foi feito — ${e?.message ?? e}`, e?.stack);
      return await naoSaiu('erro').catch(() => false);
    }
  }

  /**
   * O toque em "Ver resumo": o convite saiu fora das 24 horas e agora a janela abriu.
   *  • Só vale para a pessoa do convite: a linha é da empresa e do colaborador de um vínculo deste telefone.
   *  • A gravação condicional pega a vez: dois toques não fazem dois resumos. A vez presa há mais de 10 minutos (o
   *    servidor reiniciou no meio) pode ser pega de novo.
   *  • O resumo é do período do convite, pelo mesmo agente e com o mesmo recurso no medidor.
   *  • A IA não respondeu: a linha volta a esperar o toque, e a pessoa recebe a frase do motivo.
   *  • Toque repetido: o resumo já feito vai de novo.
   * Devolve false quando a linha não é desta pessoa (a entrada responde "não achei").
   */
  async entregarPeloToque(id: string, quem: QuemTocou): Promise<boolean> {
    if (!quem.vinculos.length) return false;
    const donos = sql.join(
      quem.vinculos.map((v) => sql`(${v.tenantId}::uuid, ${v.colaboradorId}::uuid)`),
      sql`, `,
    );
    // Rodada 7, MIS-H-08 (ERR-660): cada toque que pega a vez CONTA (na mesma gravação que confere o teto — V98); a IA que falha
    // reabria o convite sem limite, e cada toque pagava até 6 voltas.
    const [vez] = linhas(
      await this.db.execute(sql`
        update mister_relatorio r
           set motivo = ${FAZENDO_NO_TOQUE}, concluido_em = clock_timestamp(),
               trilha = jsonb_set(coalesce(r.trilha, '{}'::jsonb), '{toques}', to_jsonb(coalesce((r.trilha ->> 'toques')::int, 0) + 1))
         where r.id = ${id}::uuid and r.situacao = 'nao_enviado'
           and (r.motivo = ${CONVITE_ENVIADO}
                or (r.motivo = ${FAZENDO_NO_TOQUE} and r.concluido_em < clock_timestamp() - make_interval(mins => ${RELATORIO_INTERROMPIDO_MIN})))
           and coalesce((r.trilha ->> 'toques')::int, 0) < ${TOQUES_NO_CONVITE}
           and (r.tenant_id, r.colaborador_id) in (${donos})
        returning r.id::text as id, r.tenant_id::text as "tenantId", r.colaborador_id::text as "colaboradorId", r.tipo, r.trilha`),
    );
    if (!vez) {
      // Toque repetido: o resumo já feito vai de novo; o que está sendo feito agora não manda nada.
      const [l] = linhas(
        await this.db.execute(sql`
          select id::text as id, situacao, motivo, texto, trilha from mister_relatorio r
           where r.id = ${id}::uuid and (r.tenant_id, r.colaborador_id) in (${donos})`),
      );
      if (!l) return false;
      // MIS-H-08: as tentativas acabaram — a pessoa sabe, em vez do silêncio.
      if (!l.texto && l.motivo === CONVITE_ENVIADO && Number(l.trilha?.toques ?? 0) >= TOQUES_NO_CONVITE) {
        await this.dizer(quem.telefone, TOQUES_ESGOTADOS);
        return true;
      }
      if (l.texto && (await this.dizer(quem.telefone, String(l.texto))) && l.situacao !== 'enviado')
        await this.db.execute(sql`update mister_relatorio set situacao = 'enviado', motivo = null, concluido_em = clock_timestamp() where id = ${l.id}::uuid and situacao = 'nao_enviado'`);
      return true;
    }
    const tipo = vez.tipo as TipoDeRelatorio;
    const convite = vez.trilha?.convite ?? {};
    const devido: RelatorioDevido = {
      referencia: String(convite.referencia ?? ''),
      ate: String(convite.ate ?? ''),
      ...(typeof convite.hora === 'string' ? { hora: convite.hora } : {}),
    };
    const voltarAoConvite = () =>
      this.db.execute(sql`update mister_relatorio set motivo = ${CONVITE_ENVIADO} where id = ${vez.id}::uuid and motivo = ${FAZENDO_NO_TOQUE}`);
    if (tipo === 'fichas_novas') {
      // Sem a IA: a lista da MESMA janela, lida de novo (a ficha apagada desde o convite não aparece).
      try {
        const fichas = await this.fichasDaPessoa(vez.tenantId, vez.colaboradorId, quem.telefone, devido);
        const texto = fichas?.texto ?? 'As fichas desse resumo não estão mais na Página de vagas, ou você não vê mais os candidatos dessa loja.';
        const saiu = await this.dizer(quem.telefone, texto);
        await this.db.execute(sql`
          update mister_relatorio
             set situacao = ${saiu && fichas ? 'enviado' : 'nao_enviado'}, motivo = ${!fichas ? 'sem_fichas' : saiu ? null : 'envio'},
                 texto = ${fichas ? texto : null}, concluido_em = clock_timestamp()
           where id = ${vez.id}::uuid and motivo = ${FAZENDO_NO_TOQUE}`);
        return true;
      } catch (e: any) {
        this.logger.error(`o resumo das fichas ${vez.id} não foi feito no toque — ${e?.message ?? e}`, e?.stack);
        await voltarAoConvite().catch(() => undefined);
        await this.dizer(quem.telefone, TEXTOS_DO_AGENTE.passageira);
        return true;
      }
    }
    if (tipo === 'boletim_ramo') {
      // Sem a IA: o boletim do MESMO dia, lido de novo (a notícia tirada desde o convite não aparece).
      try {
        const lido = await this.boletimDaPessoa(vez.tenantId, vez.colaboradorId, quem.telefone, devido);
        const texto = lido?.texto ?? 'O boletim desse dia não está mais disponível, ou você não tem mais acesso às Notícias do ramo.';
        const saiu = await this.dizer(quem.telefone, texto);
        await this.db.execute(sql`
          update mister_relatorio
             set situacao = ${saiu && lido ? 'enviado' : 'nao_enviado'}, motivo = ${!lido ? 'sem_boletim' : saiu ? null : 'envio'},
                 texto = ${lido ? texto : null}, concluido_em = clock_timestamp()
           where id = ${vez.id}::uuid and motivo = ${FAZENDO_NO_TOQUE}`);
        return true;
      } catch (e: any) {
        this.logger.error(`o boletim ${vez.id} não foi enviado no toque — ${e?.message ?? e}`, e?.stack);
        await voltarAoConvite().catch(() => undefined);
        await this.dizer(quem.telefone, TEXTOS_DO_AGENTE.passageira);
        return true;
      }
    }
    if (tipo === 'vespera') {
      // Sem a IA: o dia lido de novo, porque a previsão pode ter mudado desde o convite. Dia que já passou não vira aviso.
      try {
        const hoje = hojeISO();
        const dia = /^\d{4}-\d{2}-\d{2}$/.test(devido.referencia) ? somarDias(devido.referencia, 1) : '';
        const lido = dia && hoje <= dia ? await this.vesperaDaPessoa(vez.tenantId, vez.colaboradorId, quem.telefone, devido, hoje === dia ? 'Hoje' : 'Amanhã') : null;
        const saiu = lido
          ? await this.mandarVespera(quem.telefone, String(vez.id), lido.texto).then(
              () => true,
              () => false,
            )
          : await this.dizer(quem.telefone, 'Esse aviso já passou, ou não há mais nada para avisar desse dia.');
        await this.db.execute(sql`
          update mister_relatorio
             set situacao = ${saiu && lido ? 'enviado' : 'nao_enviado'}, motivo = ${!lido ? 'sem_aviso' : saiu ? null : 'envio'},
                 texto = ${lido ? lido.texto : null}, concluido_em = clock_timestamp()
           where id = ${vez.id}::uuid and motivo = ${FAZENDO_NO_TOQUE}`);
        return true;
      } catch (e: any) {
        this.logger.error(`a véspera ${vez.id} não foi enviada no toque — ${e?.message ?? e}`, e?.stack);
        await voltarAoConvite().catch(() => undefined);
        await this.dizer(quem.telefone, TEXTOS_DO_AGENTE.passageira);
        return true;
      }
    }
    try {
      const escopo = /^\d{4}-\d{2}-\d{2}$/.test(devido.referencia) && /^\d{4}-\d{2}-\d{2}$/.test(devido.ate)
        ? await this.ferramentas.escopo(vez.tenantId, vez.colaboradorId, quem.telefone)
        : null;
      // C8: quem deixou de ser presidente desde o convite não recebe as ideias.
      if (!escopo || escopo.semLoja || (soAoPresidente(tipo) && escopo.nivel !== 'presidente')) {
        await this.db.execute(sql`update mister_relatorio set motivo = 'sem_acesso', concluido_em = clock_timestamp() where id = ${vez.id}::uuid and motivo = ${FAZENDO_NO_TOQUE}`);
        return false;
      }
      // MIS-H-08: a trava de emergência das perguntas vale também aqui.
      if (process.env.MISTER_PERGUNTAS_DESLIGADAS === '1') {
        await voltarAoConvite();
        await this.dizer(quem.telefone, TEXTOS_DO_AGENTE.emManutencao);
        return true;
      }
      if (quem.wamid) this.numero.mostrarDigitando(quem.wamid);
      const fim = await this.agente.responder(escopo, [], perguntaDoRelatorio(tipo, devido), { recurso: RECURSO_DO_RELATORIO[tipo] });
      if (fim.motivo) {
        await voltarAoConvite();
        await this.dizer(quem.telefone, fraseDoMotivo(fim.motivo, escopo.nivel) ?? TEXTOS_DO_AGENTE.passageira);
        return true;
      }
      const saida = filtrarSaida(fim.texto, fim.resultados);
      if (!escopo.verValores || escopo.pinPendente) saida.texto = semValoresNoTexto(saida.texto); // MIS-E-10 (ERR-656)
      // A linha "Amanhã" só vale se o resumo sai antes do dia seguinte ter passado.
      const regraAgora = regraDoRelatorioQueVale(tipo, (await this.config.salvas(vez.tenantId)).get(tipo));
      const aindaVale = tipo === 'resumo_dia' && regraAgora.linhaAmanha && hojeISO() <= somarDias(devido.referencia, 1);
      const textoFinal = aindaVale ? await this.comLinhaDeAmanha(escopo, devido.referencia, saida.texto) : saida.texto;
      const trilha: Record<string, unknown> = { ...(vez.trilha ?? {}), ...fim.trilha, conferencia: saida.notas };
      // Versão 5, M5e: o texto e o que vai junto, como na rotina.
      let saiu: boolean;
      if (this.arquivo && temArquivoDoResumo(tipo)) {
        saiu = await this.arquivo
          .entregar({ tenantId: vez.tenantId, colaboradorId: vez.colaboradorId, telefone: quem.telefone }, escopo, String(vez.id), tipo as TipoDoResumo, devido.referencia, textoFinal)
          .then(
            (entrega) => ((trilha.entrega = entrega), true),
            () => false,
          );
      } else saiu = await this.dizer(quem.telefone, textoFinal);
      await this.db.execute(sql`
        update mister_relatorio
           set situacao = ${saiu ? 'enviado' : 'nao_enviado'}, motivo = ${saiu ? null : 'envio'}, texto = ${textoFinal},
               trilha = ${JSON.stringify(trilha)}::jsonb, concluido_em = clock_timestamp()
         where id = ${vez.id}::uuid and motivo = ${FAZENDO_NO_TOQUE}`);
      return true;
    } catch (e: any) {
      this.logger.error(`o resumo ${vez.id} não foi feito no toque — ${e?.message ?? e}`, e?.stack);
      await voltarAoConvite().catch(() => undefined);
      await this.dizer(quem.telefone, TEXTOS_DO_AGENTE.passageira);
      return true;
    }
  }

  /**
   * O resumo das fichas novas de uma pessoa — ou null quando não há o que dizer. A régua da tela de Candidatos: presidente
   * ou a permissão Candidatos (`podeAcessar`), as lojas que ela vê (o escopo do Mister) com o módulo de vagas ligado. As
   * fichas recebidas na janela, até o teto, com o total (`count(*) over ()`, antes do `limit`). O nome da função pela
   * página da loja; sem ela, o nome de fábrica; sem os dois, o código.
   */
  async fichasDaPessoa(tenantId: string, colaboradorId: string, telefone: string, devido: RelatorioDevido): Promise<{ texto: string; total: number } | null> {
    const janela = janelaDasFichas(devido);
    if (!janela || !this.modulos) return null;
    const escopo = await this.ferramentas.escopo(tenantId, colaboradorId, telefone);
    if (!escopo || escopo.semLoja) return null;
    if (escopo.nivel !== 'presidente' && !podeAcessar(escopo.permissoes, 'candidatos')) return null;
    const lojas: Array<{ id: string; nome: string }> = [];
    for (const l of escopo.lojas) if (await this.modulos.ativo(tenantId, l.id, 'vagas')) lojas.push(l);
    if (!lojas.length) return null;
    const ids = sql.join(
      lojas.map((l) => sql`${l.id}::uuid`),
      sql`, `,
    );
    const lidas = linhas(
      await this.db.execute(sql`
        select c.nome, c.funcoes, c.tipo_vaga as "tipoVaga", c.escala, c.distancia_km::float8 as "distanciaKm", c.comeca,
               c.unidade_id::text as "unidadeId", count(*) over () as total
          from candidato c
         where c.tenant_id = ${tenantId}::uuid and c.unidade_id in (${ids})
           and c.recebido_em >= ${instanteDe(janela.desde)} and c.recebido_em < ${instanteDe(janela.ate)}
         order by c.recebido_em, c.id
         limit ${FICHAS_NO_RESUMO_MAX}`),
    );
    if (!lidas.length) return null;
    const paginas = linhas(
      await this.db.execute(sql`select unidade_id::text as "unidadeId", funcoes from vaga_pagina where tenant_id = ${tenantId}::uuid and unidade_id in (${ids})`),
    );
    const deFabrica = new Map(paginaPadrao().funcoes.map((f) => [f.codigo, f.nome]));
    const nomeDaFuncao = (unidadeId: string, codigo: string): string => {
      const daLoja = ((paginas.find((p) => p.unidadeId === unidadeId)?.funcoes ?? []) as any[]).find((f) => f?.codigo === codigo);
      return String(daLoja?.nome ?? deFabrica.get(codigo) ?? codigo);
    };
    const nomeDaLoja = new Map(lojas.map((l) => [l.id, l.nome]));
    const total = Number(lidas[0].total);
    const texto = textoDasFichasNovas({
      nome: escopo.nome,
      hora: devido.hora!,
      total,
      link: linkDosCandidatos(),
      fichas: lidas.map((l) => ({
        nome: String(l.nome ?? ''),
        funcoes: ((l.funcoes ?? []) as string[]).map((c) => nomeDaFuncao(l.unidadeId, c)),
        tipoVaga: String(l.tipoVaga ?? ''),
        escala: l.escala ?? null,
        distanciaKm: l.distanciaKm === null || l.distanciaKm === undefined ? null : Number(l.distanciaKm),
        comeca: String(l.comeca ?? ''),
        loja: nomeDaLoja.get(l.unidadeId) ?? '',
      })),
    });
    return { texto, total };
  }

  /**
   * O boletim de uma pessoa — ou null quando não há o que dizer. A régua da tela: presidente ou a permissão Notícias do ramo,
   * e só a empresa de bares e restaurantes. O texto sai da cópia que a nuvem guardou do Pulso, sem a IA.
   */
  async boletimDaPessoa(tenantId: string, colaboradorId: string, telefone: string, devido: RelatorioDevido): Promise<{ texto: string } | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(devido.referencia)) return null;
    const escopo = await this.ferramentas.escopo(tenantId, colaboradorId, telefone);
    if (!escopo || escopo.semLoja) return null;
    if (escopo.nivel !== 'presidente' && !podeAcessar(escopo.permissoes, 'noticias_ramo')) return null;
    const [e] = linhas(await this.db.execute(sql`select ramo from empresa where id = ${tenantId}::uuid`));
    if (e?.ramo !== RAMO_DA_EMPRESA_COM_BOLETIM) return null;
    const [l] = linhas(await this.db.execute(sql`select corpo from pulso_boletim where ramo = ${RAMO_DO_REGEM} and dia = ${devido.referencia}::date`));
    if (!l?.corpo) return null;
    const texto = textoDoBoletim(l.corpo as BoletimDoRamo, linkDasNoticias());
    return texto ? { texto } : null;
  }

  // ───────────────────────────── versão 8, E3: a véspera ─────────────────────────────

  /** O que vale avisar de um dia em cada loja da pessoa (até 10), no mesmo recorte do "o que vem aí". */
  private async doDiaNasLojas(escopo: EscopoDoMister, dia: string, hoje: string): Promise<DaVespera[]> {
    const fora: DaVespera[] = [];
    for (const l of escopo.lojas.slice(0, 10)) {
      const v = oQueAvisar(l.nome, await lerDiaDaAgenda(this.db, escopo.tenantId, l, dia, hoje));
      if (v) fora.push(v);
    }
    return fora;
  }

  /** O aviso da véspera de uma pessoa — ou null, quando o dia seguinte não tem nada para dizer. */
  async vesperaDaPessoa(tenantId: string, colaboradorId: string, telefone: string, devido: RelatorioDevido, quando: 'Amanhã' | 'Hoje' = 'Amanhã'): Promise<{ texto: string } | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(devido.referencia)) return null;
    const escopo = await this.ferramentas.escopo(tenantId, colaboradorId, telefone);
    if (!escopo || escopo.semLoja) return null;
    const texto = textoDaVespera(await this.doDiaNasLojas(escopo, somarDias(devido.referencia, 1), devido.referencia), quando);
    return texto ? { texto } : null;
  }

  /** O WhatsApp corta o texto com botões em 1024 letras: o aviso longo vai antes, e os botões vêm numa mensagem curta. */
  private async mandarVespera(telefone: string, id: string, texto: string): Promise<void> {
    const botoes = botoesDaVespera(id);
    if (texto.length <= 1000) {
      await this.numero.enviar(telefone, { texto, botoes });
      return;
    }
    await this.numero.enviar(telefone, { texto });
    await this.numero.enviar(telefone, { texto: 'Quer que eu confira o estoque para amanhã?', botoes });
  }

  /** O resumo com a linha "Amanhã". A leitura que falha não segura o resumo: ele sai sem a linha. */
  private async comLinhaDeAmanha(escopo: EscopoDoMister, referencia: string, texto: string): Promise<string> {
    try {
      const linha = linhaDeAmanha(await this.doDiaNasLojas(escopo, somarDias(referencia, 1), referencia));
      return linha ? `${texto}\n\n${linha}` : texto;
    } catch (e: any) {
      this.logger.warn(`a linha "Amanhã" do resumo não foi lida — ${e?.message ?? e}`);
      return texto;
    }
  }

  /** Os botões do aviso: "Deixa assim" só responde; "Conferir o estoque" pergunta ao agente uma vez, com as consultas de sempre. */
  async tocouNaVespera(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const b = lerBotaoDaVespera(botaoId);
    if (!b || !quem.vinculos.length) return false;
    const donos = sql.join(
      quem.vinculos.map((v) => sql`(${v.tenantId}::uuid, ${v.colaboradorId}::uuid)`),
      sql`, `,
    );
    const [l] = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", colaborador_id::text as "colaboradorId"
          from mister_relatorio r where r.id = ${b.id}::uuid and r.tipo = 'vespera' and (r.tenant_id, r.colaborador_id) in (${donos})`),
    );
    if (!l) return false;
    if (b.acao === 'ok') {
      await this.dizer(quem.telefone, TEXTO_DEIXA_ASSIM);
      return true;
    }
    // A gravação condicional: dois toques não fazem duas consultas com IA.
    const [vez] = linhas(
      await this.db.execute(sql`
        update mister_relatorio set trilha = coalesce(trilha, '{}'::jsonb) || '{"conferiuEstoque": true}'::jsonb
         where id = ${l.id}::uuid and coalesce((trilha ->> 'conferiuEstoque')::boolean, false) = false
        returning id`),
    );
    if (!vez) {
      await this.dizer(quem.telefone, 'Já conferi o estoque deste aviso. Se quiser de novo, é só me pedir.');
      return true;
    }
    try {
      const escopo = await this.ferramentas.escopo(l.tenantId, l.colaboradorId, quem.telefone);
      if (!escopo || escopo.semLoja) {
        await this.dizer(quem.telefone, TEXTOS_DO_AGENTE.passageira);
        return true;
      }
      if (quem.wamid) this.numero.mostrarDigitando(quem.wamid);
      const fim = await this.agente.responder(escopo, [], PERGUNTA_DO_ESTOQUE);
      await this.dizer(quem.telefone, fim.motivo ? (fraseDoMotivo(fim.motivo, escopo.nivel) ?? TEXTOS_DO_AGENTE.passageira) : filtrarSaida(fim.texto, fim.resultados).texto);
    } catch (e: any) {
      this.logger.error(`a conferência do estoque da véspera ${l.id} falhou — ${e?.message ?? e}`, e?.stack);
      await this.db.execute(sql`update mister_relatorio set trilha = trilha - 'conferiuEstoque' where id = ${l.id}::uuid`).catch(() => undefined);
      await this.dizer(quem.telefone, TEXTOS_DO_AGENTE.passageira);
    }
    return true;
  }

  /** Manda um texto pelo número do Mister. Devolve se saiu; a falha fica no log, com o motivo. */
  private async dizer(telefone: string, texto: string): Promise<boolean> {
    try {
      await this.numero.enviar(telefone, { texto });
      return true;
    } catch (e: any) {
      this.logger.warn(`o resumo não saiu no toque (${e instanceof FalhaDoEnvioDoMister ? e.motivo : (e?.message ?? e)})`);
      return false;
    }
  }

  private async concluir(id: string, situacao: 'enviado' | 'nao_enviado', motivo: string | null, extra: { texto?: string; trilha?: unknown }) {
    await this.db.execute(sql`
      update mister_relatorio
         set situacao = ${situacao}, motivo = ${motivo}, texto = ${extra.texto ?? null},
             trilha = ${extra.trilha === undefined ? null : JSON.stringify(extra.trilha)}::jsonb, concluido_em = clock_timestamp()
       where id = ${id}::uuid and situacao = 'fazendo'`);
  }

  /** A linha "fazendo" velha foi interrompida (o servidor reiniciou no meio): vira "não enviado", sem refazer. */
  private async fecharInterrompidos(): Promise<void> {
    await this.db.execute(sql`
      update mister_relatorio set situacao = 'nao_enviado', motivo = 'interrompido', concluido_em = clock_timestamp()
       where situacao = 'fazendo' and criado_em < clock_timestamp() - make_interval(mins => ${RELATORIO_INTERROMPIDO_MIN})`);
  }
}
