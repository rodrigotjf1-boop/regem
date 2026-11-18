import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { horaNoFuso } from '../../common/data';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { PontoService } from '../ponto/ponto.service';
import { enderecoDoApp } from './link-de-conferencia';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { MisterNumeroService } from './mister-numero.service';
import { PREFIXO_DO_PONTO_DO_MES, TEXTOS_DO_PONTO_DO_MES, lerBotaoDoPontoDoMes } from './mister-ponto-do-mes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// M3e parte 2 — OS BOTÕES DO ARQUIVO DO PONTO DO MÊS (versão 3 do protótipo `mockups/regem-mister.html`, conversa 20).
// O aviso "Arquivo do ponto do mês" vai ao presidente com "Enviar ao contador" e "Ver antes" (prefixo `pmes:`):
//  • "Enviar ao contador" manda o espelho pelo MESMO envio da tela (`PontoService.enviarEspelhoContador`: o WhatsApp da
//    loja, o fechamento marcado como enviado e a auditoria). A reserva fica no próprio aviso (`dados.envioEm`, que a
//    renovação dos avisos preserva): o toque duplo, ou a réplica a mais, não manda duas vezes. A reserva velha (mais de 3
//    minutos, o envio que morreu no meio) não segura o toque seguinte.
//  • "Ver antes" diz onde conferir (Pessoas › Gerenciamento de ponto), com o link para o Regem.
// Só o presidente da empresa do aviso; só com o aviso aberto. Só na nuvem (o módulo do agente só sobe lá).

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => ['42P01', '42703'].includes(e?.code) || ['42P01', '42703'].includes(e?.cause?.code);
/** Depois de quantos minutos a reserva do envio deixa de segurar o toque seguinte (o envio que morreu no meio). */
const RESERVA_VALE_MIN = 3;

@Injectable()
export class MisterPontoDoMesService implements OnModuleInit {
  private readonly logger = new Logger('MisterPontoDoMes');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly ponto?: PontoService,
    @Optional() private readonly entrada?: MisterEntradaService,
    @Optional() private readonly numero?: MisterNumeroService,
  ) {}

  onModuleInit(): void {
    this.entrada?.registrarBotao(PREFIXO_DO_PONTO_DO_MES, (botaoId, quem) => this.tocou(botaoId, quem));
  }

  /** O toque em "Enviar ao contador" ou "Ver antes". `false` = o botão não é deste serviço (ou o aviso não é de quem tocou). */
  async tocou(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const b = lerBotaoDoPontoDoMes(botaoId);
    if (!b) return false;
    const empresas = quem.vinculos.map((v) => v.tenantId);
    if (!empresas.length) return false;
    let a: any;
    try {
      [a] = linhas(
        await this.db.execute(sql`
          select id::text as id, tenant_id::text as "tenantId", situacao, dados
            from mister_aviso
           where id = ${b.avisoId}::uuid and tipo = 'ponto_do_mes'
             and tenant_id in (${sql.join(empresas.map((t) => sql`${t}::uuid`), sql`, `)})`),
      );
    } catch (e: any) {
      if (semTabela(e)) return false;
      throw e;
    }
    if (!a) return false;
    const v = quem.vinculos.find((x) => x.tenantId === a.tenantId)!;
    const competencia = String(a.dados?.competencia ?? '');
    if (v.nivel !== 'presidente') return this.dizer(quem.telefone, TEXTOS_DO_PONTO_DO_MES.soPresidente);

    if (b.acao === 'ver') {
      await this.dizerComLink(quem.telefone, TEXTOS_DO_PONTO_DO_MES.verAntes(competencia), `${enderecoDoApp()}/pessoas`);
      return true;
    }

    if (a.situacao !== 'aberto') return this.dizer(quem.telefone, (await this.fraseDoEnviado(a.tenantId, competencia)) ?? TEXTOS_DO_PONTO_DO_MES.naoVale);
    // A reserva: uma gravação condicional no próprio aviso (a reserva velha não segura).
    const [reservado] = linhas(
      await this.db.execute(sql`
        update mister_aviso set dados = coalesce(dados, '{}'::jsonb) || jsonb_build_object('envioEm', clock_timestamp())
         where id = ${a.id}::uuid and situacao = 'aberto'
           and (not (coalesce(dados, '{}'::jsonb) ? 'envioEm')
                or (dados ->> 'envioEm')::timestamptz < clock_timestamp() - make_interval(mins => ${RESERVA_VALE_MIN}::int))
        returning id::text as id`),
    );
    if (!reservado) return this.dizer(quem.telefone, (await this.fraseDoEnviado(a.tenantId, competencia)) ?? TEXTOS_DO_PONTO_DO_MES.enviando);
    // Já mandado pela tela (o aviso ainda não fechou porque a volta não passou): não manda de novo.
    const jaFoi = await this.fraseDoEnviado(a.tenantId, competencia);
    if (jaFoi) return this.dizer(quem.telefone, jaFoi);
    const soltar = () =>
      this.db
        .execute(sql`update mister_aviso set dados = coalesce(dados, '{}'::jsonb) - 'envioEm' where id = ${a.id}::uuid`)
        .catch((e: any) => this.logger.warn(`a reserva do aviso ${a.id} não saiu — ${e?.message ?? e}`));
    let r: any;
    try {
      if (!this.ponto) throw new Error('o serviço do ponto não está neste servidor');
      // O MESMO envio da tela, em nome do presidente que tocou (a auditoria do ponto registra quem mandou).
      r = await this.ponto.enviarEspelhoContador(a.tenantId, v.colaboradorId, competencia);
    } catch (e: any) {
      this.logger.error(`o ponto de ${competencia} da empresa ${a.tenantId} não foi mandado à contabilidade — ${e?.message ?? e}`, e?.stack);
      await soltar();
      return this.dizer(quem.telefone, TEXTOS_DO_PONTO_DO_MES.falhou);
    }
    if (r?.precisaResponsavel) {
      await soltar();
      return this.dizer(quem.telefone, TEXTOS_DO_PONTO_DO_MES.semContador);
    }
    return this.dizer(quem.telefone, (await this.fraseDoEnviado(a.tenantId, competencia, true)) ?? TEXTOS_DO_PONTO_DO_MES.falhou);
  }

  /**
   * `agora` = o envio que acabou de acontecer: "Enviado às 06:04 para Juliana Prado…". Senão (mandado antes, pela tela ou
   * por outro toque): "já foi enviado, às…". null = ainda não foi.
   */
  private async fraseDoEnviado(tenantId: string, competencia: string, agora = false): Promise<string | null> {
    if (!/^\d{4}-\d{2}-01$/.test(competencia)) return null;
    const [f] = linhas(
      await this.db.execute(sql`
        select f.enviado_em as "enviadoEm", c.nome
          from ponto_fechamento f
          left join contador c on c.id = f.enviado_contador_id and c.tenant_id = f.tenant_id
         where f.tenant_id = ${tenantId}::uuid and f.competencia = ${competencia}::date and f.status = 'enviado'`),
    );
    if (!f?.enviadoEm) return null;
    const hora = horaNoFuso(new Date(f.enviadoEm));
    return agora && f.nome ? TEXTOS_DO_PONTO_DO_MES.enviado(String(f.nome), hora, competencia) : TEXTOS_DO_PONTO_DO_MES.jaEnviado(hora, competencia);
  }

  /** Manda a frase. Devolve `true` (o toque foi tratado), para o `return` de quem chama. */
  private async dizer(telefone: string, texto: string): Promise<boolean> {
    try {
      await this.numero?.enviar(telefone, { texto });
    } catch (e: any) {
      this.logger.warn(`a resposta do ponto do mês não saiu (${e?.motivo ?? e?.message ?? e})`);
    }
    return true;
  }

  private async dizerComLink(telefone: string, texto: string, url: string): Promise<void> {
    try {
      await this.numero?.enviar(telefone, { texto, link: { titulo: 'Abrir no Regem', url } });
    } catch (e: any) {
      this.logger.warn(`a resposta do ponto do mês não saiu (${e?.motivo ?? e?.message ?? e})`);
    }
  }
}
