import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { FUSO_OPERACAO, dataNoFuso, horaNoFuso } from '../../common/data';
import { instanteDe } from '../../common/fuso-sql';
import { podeAcessar } from '../../auth/permissoes';
import { ModuloService } from '../modulo/modulo.service';
import { paginaPadrao } from '../vagas/vagas';
import { TEXTOS_DO_AGENTE, filtrarSaida, fraseDoMotivo } from './mister-agente.regras';
import { MisterAgenteService } from './mister-agente.service';
import { dentroDaJanelaDoWhatsapp } from './mister-avisos.regras';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { MisterFerramentasService } from './mister-ferramentas.service';
import { MODELO_DO_RESUMO, parametrosDoResumo } from './mister-modelos';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { MisterRelatoriosConfigService } from './mister-relatorios-config.service';
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
  relatorioDevido,
  textoDasFichasNovas,
} from './mister-relatorios.regras';
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

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.code === '42703';

/** O endereço da tela de Candidatos na nuvem (vai no fim do resumo das fichas). */
export function linkDosCandidatos(): string {
  return `${String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '')}/candidatos`;
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
  ) {}

  /** O toque em "Ver resumo" chega pela entrada do WhatsApp, que mora no módulo de baixo: ela chama este serviço. */
  onModuleInit(): void {
    this.entrada?.registrarToque('resumo', (id, quem) => this.entregarPeloToque(id, quem));
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
    _regra: RegraDoRelatorio,
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
      const escopo = await this.ferramentas.escopo(tenantId, pessoa.colaboradorId, pessoa.telefone);
      if (!escopo || escopo.semLoja) return await naoSaiu('sem_acesso');
      const fim = await this.agente.responder(escopo, [], perguntaDoRelatorio(tipo, devido), { recurso: RECURSO_DO_RELATORIO[tipo] });
      if (fim.motivo) return await naoSaiu(fim.motivo, { trilha: fim.trilha });
      const saida = filtrarSaida(fim.texto, fim.resultados);
      const trilha = { ...fim.trilha, conferencia: saida.notas };
      try {
        await this.numero.enviar(pessoa.telefone, { texto: saida.texto });
      } catch (e: any) {
        return await naoSaiu(e instanceof FalhaDoEnvioDoMister ? `envio: ${e.motivo}` : 'envio', { texto: saida.texto, trilha });
      }
      await this.concluir(vez.id, 'enviado', null, { texto: saida.texto, trilha });
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
    const [vez] = linhas(
      await this.db.execute(sql`
        update mister_relatorio r
           set motivo = ${FAZENDO_NO_TOQUE}, concluido_em = clock_timestamp()
         where r.id = ${id}::uuid and r.situacao = 'nao_enviado'
           and (r.motivo = ${CONVITE_ENVIADO}
                or (r.motivo = ${FAZENDO_NO_TOQUE} and r.concluido_em < clock_timestamp() - make_interval(mins => ${RELATORIO_INTERROMPIDO_MIN})))
           and (r.tenant_id, r.colaborador_id) in (${donos})
        returning r.id::text as id, r.tenant_id::text as "tenantId", r.colaborador_id::text as "colaboradorId", r.tipo, r.trilha`),
    );
    if (!vez) {
      // Toque repetido: o resumo já feito vai de novo; o que está sendo feito agora não manda nada.
      const [l] = linhas(
        await this.db.execute(sql`
          select id::text as id, situacao, motivo, texto from mister_relatorio r
           where r.id = ${id}::uuid and (r.tenant_id, r.colaborador_id) in (${donos})`),
      );
      if (!l) return false;
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
    try {
      const escopo = /^\d{4}-\d{2}-\d{2}$/.test(devido.referencia) && /^\d{4}-\d{2}-\d{2}$/.test(devido.ate)
        ? await this.ferramentas.escopo(vez.tenantId, vez.colaboradorId, quem.telefone)
        : null;
      if (!escopo || escopo.semLoja) {
        await this.db.execute(sql`update mister_relatorio set motivo = 'sem_acesso', concluido_em = clock_timestamp() where id = ${vez.id}::uuid and motivo = ${FAZENDO_NO_TOQUE}`);
        return false;
      }
      if (quem.wamid) this.numero.mostrarDigitando(quem.wamid);
      const fim = await this.agente.responder(escopo, [], perguntaDoRelatorio(tipo, devido), { recurso: RECURSO_DO_RELATORIO[tipo] });
      if (fim.motivo) {
        await voltarAoConvite();
        await this.dizer(quem.telefone, fraseDoMotivo(fim.motivo, escopo.nivel) ?? TEXTOS_DO_AGENTE.passageira);
        return true;
      }
      const saida = filtrarSaida(fim.texto, fim.resultados);
      const trilha = { ...(vez.trilha ?? {}), ...fim.trilha, conferencia: saida.notas };
      const saiu = await this.dizer(quem.telefone, saida.texto);
      await this.db.execute(sql`
        update mister_relatorio
           set situacao = ${saiu ? 'enviado' : 'nao_enviado'}, motivo = ${saiu ? null : 'envio'}, texto = ${saida.texto},
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
