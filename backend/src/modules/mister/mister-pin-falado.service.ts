import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { MisterEntradaService, type MidiaDoMister, type QuemMandou } from './mister-entrada.service';
import { MisterFerramentasService, type EscopoDoMister, type ResultadoDaFerramenta } from './mister-ferramentas.service';
import { MisterMidiaService } from './mister-midia.service';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { TEXTOS_DO_PIN_FALADO, pinFaladoLigado, pinNoTexto } from './mister-pin-falado';
import { MisterPropostasService } from './mister-propostas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// FALAR O PIN (Mister, versão 10, fase C5; `mister-pin-falado.ts`, mig 507). Duas portas:
//  • a ferramenta `pin_falado` (ligar: a proposta de PIN "ligar o PIN falado", o link vai depois da resposta; desligar: na hora);
//  • o áudio que chega com uma proposta de PIN esperando ESTA pessoa e o PIN falado ligado: transcrito, os números conferidos
//    pelo código e nada segue para a fila, a IA ou a memória.

const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });

@Injectable()
export class MisterPinFaladoService implements OnModuleInit {
  private readonly logger = new Logger('MisterPinFalado');

  constructor(
    private readonly ferramentas: MisterFerramentasService,
    private readonly propostas: MisterPropostasService,
    private readonly numero: MisterNumeroService,
    @Optional() private readonly midia?: MisterMidiaService,
    @Optional() private readonly entrada?: MisterEntradaService,
  ) {}

  onModuleInit(): void {
    this.ferramentas.registrarPinFalado((e, en) => this.ferramenta(e, en));
    this.entrada?.registrarPinFalado((quem, midia, wamid) => this.ouvirOPin(quem, midia, wamid));
  }

  /** A ferramenta `pin_falado`: ligar (pela página do PIN, com o aviso do risco) ou desligar (na hora). */
  async ferramenta(e: EscopoDoMister, en: Record<string, unknown>): Promise<ResultadoDaFerramenta> {
    if (!pinFaladoLigado()) return recusa(TEXTOS_DO_PIN_FALADO.desligadoNaDistribuicao);
    const acao = String(en.acao ?? '').trim();
    if (acao === 'desligar') {
      const estava = await this.propostas.desligarPinFalado(e.tenantId, e.colaboradorId);
      return { ok: true, dados: { desligado: true, siga: estava ? TEXTOS_DO_PIN_FALADO.desligado : TEXTOS_DO_PIN_FALADO.naoEstavaLigado } };
    }
    if (acao !== 'ligar') return recusa('Diga se é para ligar ou desligar o PIN falado.');
    if (await this.propostas.pinFaladoDe(e.tenantId, e.colaboradorId)) return { ok: true, dados: { jaLigado: true, siga: TEXTOS_DO_PIN_FALADO.jaLigado } };
    const proposta = await this.propostas.proporPinFalado(e.tenantId, e.colaboradorId);
    if (!proposta) return recusa('Não consegui preparar o link do PIN agora. Tente de novo daqui a pouco.');
    return { ok: true, dados: { siga: TEXTOS_DO_PIN_FALADO.sigaDoLigar }, proposta };
  }

  /**
   * O áudio é o PIN? Só com o PIN falado ligado na distribuição e PARA ESTA PESSOA e uma proposta de PIN esperando por ela.
   * Encaminhado não vale. A transcrição vira só os números (`pinNoTexto`); não entendido não conta como erro. A conferência e
   * o bloqueio são os da página (`autorizarPelaVoz`). Depois, o pedido para apagar o áudio.
   */
  async ouvirOPin(quem: QuemMandou, midia: MidiaDoMister, wamid: string | null): Promise<'tratado' | null> {
    if (!pinFaladoLigado() || midia.tipo !== 'audio' || !this.midia) return null;
    if (!(await this.propostas.pinFaladoDe(quem.tenantId, quem.colaboradorId))) return null;
    if (!(await this.propostas.temPinEsperando(quem.tenantId, quem.colaboradorId))) return null;
    if (midia.encaminhada) {
      await this.falar(quem.telefone, TEXTOS_DO_PIN_FALADO.encaminhado);
      return 'tratado';
    }
    const texto = await this.midia.transcreverParaOPin(quem.tenantId, midia, wamid);
    if (texto === null) {
      await this.falar(quem.telefone, TEXTOS_DO_PIN_FALADO.naoOuvi);
      return 'tratado';
    }
    const pin = pinNoTexto(texto);
    if (!pin) {
      await this.falar(quem.telefone, TEXTOS_DO_PIN_FALADO.naoEntendi);
      return 'tratado';
    }
    const r = await this.propostas.autorizarPelaVoz(quem.tenantId, quem.colaboradorId, quem.telefone, pin);
    if (r.r === 'sem_proposta') return null;
    await this.falar(quem.telefone, r.r === 'feito' ? TEXTOS_DO_PIN_FALADO.autorizado : r.r === 'errado' ? TEXTOS_DO_PIN_FALADO.errado(r.restam ?? 0) : TEXTOS_DO_PIN_FALADO.bloqueado);
    await this.falar(quem.telefone, TEXTOS_DO_PIN_FALADO.apagueOAudio);
    return 'tratado';
  }

  private async falar(telefone: string, texto: string): Promise<void> {
    try {
      await this.numero.enviar(telefone, { texto });
    } catch (e: any) {
      this.logger.warn(`a resposta do PIN falado não saiu — ${e instanceof FalhaDoEnvioDoMister ? e.motivo : (e?.message ?? e)}`);
    }
  }
}
