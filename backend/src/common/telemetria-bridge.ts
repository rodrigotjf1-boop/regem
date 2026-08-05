/* Ponte estática entre o logger/filtro (criados ANTES do DI, em main.ts) e o serviço
   que grava a telemetria no banco (EdgeService.registrarTelemetria). Só é armada na
   NUVEM — no edge a telemetria continua indo por HTTP. reportar() nunca lança, para
   não interferir no fluxo que gerou o erro. */

export type TelemetriaDto = {
  origem: string; // api | backend | sync | impressao | pg | update | outro
  nivel: 'warn' | 'error' | 'fatal';
  tipo?: string | null;
  mensagem: string;
  stack?: string | null;
  contexto?: Record<string, unknown>;
  versao?: string | null;
  unidadeId?: string | null;
};

type Sink = (tenantId: string | null, dto: TelemetriaDto) => void;

export class TelemetriaBridge {
  private static sink: Sink | null = null;

  static registrar(fn: Sink) {
    TelemetriaBridge.sink = fn;
  }

  static get ativo(): boolean {
    return TelemetriaBridge.sink != null;
  }

  static reportar(tenantId: string | null, dto: TelemetriaDto) {
    try {
      TelemetriaBridge.sink?.(tenantId, dto);
    } catch {
      /* telemetria nunca quebra o fluxo que a chamou */
    }
  }
}
