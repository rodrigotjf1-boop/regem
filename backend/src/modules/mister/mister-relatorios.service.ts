import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { FUSO_OPERACAO, dataNoFuso, horaNoFuso } from '../../common/data';
import { filtrarSaida } from './mister-agente.regras';
import { MisterAgenteService } from './mister-agente.service';
import { dentroDaJanelaDoWhatsapp } from './mister-avisos.regras';
import { MisterFerramentasService } from './mister-ferramentas.service';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { MisterRelatoriosConfigService } from './mister-relatorios-config.service';
import {
  AgoraNaOperacao,
  RECURSO_DO_RELATORIO,
  RELATORIO_INTERROMPIDO_MIN,
  RegraDoRelatorio,
  TipoDeRelatorio,
  perguntaDoRelatorio,
  relatorioDevido,
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
//  • Antes da IA, a janela de 24 h da Meta: fora dela a mensagem livre não chega, então nada se gasta — a linha fica "não
//    enviado / fora da janela" (o modelo de mensagem aprovado pela Meta é a parte 2). Sem a chave de IA, idem, com o motivo.
//  • O texto sai pelo MESMO agente das perguntas (as consultas, os tetos, o filtro de saída), com o recurso do relatório
//    no medidor ("Uso da IA"). Nada daqui lança para a rotina: cada falha vira o motivo da linha e o log.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.code === '42703';

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
}

@Injectable()
export class MisterRelatoriosService {
  private readonly logger = new Logger('MisterRelatorios');
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly config: MisterRelatoriosConfigService,
    private readonly agente: MisterAgenteService,
    private readonly ferramentas: MisterFerramentasService,
    private readonly numero: MisterNumeroService,
  ) {}

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
    const fim: ResultadoDaVoltaDosRelatorios = { devidos: 0, feitos: 0, enviados: 0, naoEnviados: 0 };
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
        if (r) fim.enviados++;
        else fim.naoEnviados++;
      }
    }
    return fim;
  }

  /** O presidente e os gerentes ligados ao Mister, sem PARAR AVISOS (a mesma régua dos avisos). */
  private async quemRecebe(tenantId: string): Promise<Array<{ colaboradorId: string; telefone: string; ultimaEntrada: Date | null }>> {
    return linhas(
      await this.db.execute(sql`
        select g.colaborador_id::text as "colaboradorId", g.telefone, g.ultima_entrada_em as "ultimaEntrada"
          from mister_vinculo g
          join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = g.tenant_id
         where g.tenant_id = ${tenantId}::uuid and g.ligado_em is not null and g.telefone is not null and g.pausado_em is null and ${pessoaVale()}
         order by g.ligado_em`),
    ).map((l) => ({ colaboradorId: l.colaboradorId, telefone: String(l.telefone), ultimaEntrada: l.ultimaEntrada ? new Date(l.ultimaEntrada) : null }));
  }

  /**
   * Um relatório para uma pessoa. Devolve null quando outra volta já o fez (a vez é da linha), true quando saiu e false
   * quando não saiu (o motivo fica na linha).
   */
  private async fazer(
    tenantId: string,
    tipo: TipoDeRelatorio,
    _regra: RegraDoRelatorio,
    devido: { referencia: string; ate: string },
    pessoa: { colaboradorId: string; telefone: string; ultimaEntrada: Date | null },
    agora: Date,
  ): Promise<boolean | null> {
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
      // Fora da janela de 24 h da Meta a mensagem livre não chega: nada se gasta (o modelo aprovado é a parte 2).
      if (!dentroDaJanelaDoWhatsapp(pessoa.ultimaEntrada, agora.getTime())) return await naoSaiu('fora_da_janela_de_24h');
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
