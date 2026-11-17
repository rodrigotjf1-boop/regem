import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { EscopoDoMister, MisterFerramentasService } from './mister-ferramentas.service';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { PREFIXO_DO_RELATORIO, PedidoDoRelatorio, lerBotaoDoPdf } from './insumo-vendido';

/* eslint-disable @typescript-eslint/no-explicit-any */

// M3c.2 — O QUE A RESPOSTA LEVA ALÉM DO TEXTO: o PDF do relatório por insumo. Sai de dois jeitos, sempre refeito NO
// ESCOPO de quem pede (a permissão, a loja e as datas conferidas de novo — o botão não carrega nada que valha por si):
//   • a pessoa pediu "manda em PDF" na conversa → o agente chama `enviarPdfDoInsumo` depois da resposta;
//   • a pessoa tocou em "PDF" no balão da resposta (só pela API oficial) → o toque chega aqui, pelo prefixo `rel:`.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const mascarar = (t: string) => (t.length > 4 ? `***${t.slice(-4)}` : '***');

export const TEXTOS_DO_ANEXO = {
  falhou: 'Não consegui gerar o PDF agora. Peça de novo em instantes.',
  semAcesso: 'Este WhatsApp não tem mais acesso a este relatório.',
  naoDisponivel: 'Este relatório não está mais disponível para você.',
} as const;

/** Gera e manda o PDF do relatório. Nunca lança: o que não deu vira uma frase na conversa (e o motivo vai ao log). */
export async function enviarPdfDoInsumo(
  ferramentas: Pick<MisterFerramentasService, 'pdfDoInsumo'>,
  numero: Pick<MisterNumeroService, 'enviar' | 'enviarDocumento'>,
  escopo: EscopoDoMister,
  pedido: PedidoDoRelatorio,
  telefone: string,
  logger: Logger,
): Promise<boolean> {
  try {
    const r = await ferramentas.pdfDoInsumo(escopo, pedido);
    if ('erro' in r) {
      await numero.enviar(telefone, { texto: r.erro });
      return false;
    }
    await numero.enviarDocumento(telefone, r.pdf, r.nome, r.legenda);
    return true;
  } catch (e: any) {
    const motivo = e instanceof FalhaDoEnvioDoMister ? `${e.motivo}${e.status ? ` ${e.status}` : ''}` : String(e?.message ?? e);
    logger.warn(`mister: o PDF do relatório não saiu para ${mascarar(telefone)} (${motivo})`);
    await numero.enviar(telefone, { texto: TEXTOS_DO_ANEXO.falhou }).catch(() => undefined);
    return false;
  }
}

@Injectable()
export class MisterAnexosService implements OnModuleInit {
  private readonly logger = new Logger(MisterAnexosService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ferramentas: MisterFerramentasService,
    private readonly numero: MisterNumeroService,
    @Optional() private readonly entrada?: MisterEntradaService,
  ) {}

  onModuleInit(): void {
    this.entrada?.registrarBotao(PREFIXO_DO_RELATORIO, (botaoId, quem) => this.tocou(botaoId, quem));
  }

  /** O toque em "PDF": a empresa é a do insumo, entre os vínculos de quem tocou; o escopo é o dela, refeito agora. */
  async tocou(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const pedido = lerBotaoDoPdf(botaoId);
    if (!pedido) return false;
    const empresas = [...new Set(quem.vinculos.map((v) => v.tenantId))];
    const [dono] = empresas.length
      ? linhas(
          await this.db.execute(sql`
            select tenant_id::text as "tenantId" from item_estoque
             where id = ${pedido.insumoId}::uuid and tenant_id in (${sql.join(
               empresas.map((t) => sql`${t}::uuid`),
               sql`, `,
             )})`),
        )
      : [];
    const vinculo = dono ? quem.vinculos.find((v) => v.tenantId === dono.tenantId) : undefined;
    if (!vinculo) {
      await this.numero.enviar(quem.telefone, { texto: TEXTOS_DO_ANEXO.naoDisponivel }).catch(() => undefined);
      return true;
    }
    const escopo = await this.ferramentas.escopo(vinculo.tenantId, vinculo.colaboradorId, quem.telefone);
    if (!escopo) {
      await this.numero.enviar(quem.telefone, { texto: TEXTOS_DO_ANEXO.semAcesso }).catch(() => undefined);
      return true;
    }
    await enviarPdfDoInsumo(this.ferramentas, this.numero, escopo, pedido, quem.telefone, this.logger);
    return true;
  }
}
