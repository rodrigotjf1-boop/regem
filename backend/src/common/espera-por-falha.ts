// ESPERA CRESCENTE PARA O QUE FALHA SEMPRE (V84). Rotina que lê "os próximos N" e tenta de novo a cada ciclo o item que
// falhou: se ele nunca vai dar certo, fica na frente do lote para sempre (toma a vez dos outros) e repete o erro no log a
// cada volta. Aqui o item que falha seguidas vezes sai da consulta por um tempo que CRESCE — sem atrasar a falha
// passageira: as primeiras tentativas seguem imediatas.
//
// Guarda só em memória (por processo): reiniciou, recomeça — o pior caso é tentar de novo o que já falhava.
// Puro: sem banco, sem relógio próprio (o `agora` entra por parâmetro nos testes).

export class EsperaPorFalha {
  private readonly falhas = new Map<string, { n: number; ate: number; em: number }>();

  /**
   * @param imediatas quantas falhas seguidas ainda tentam de novo no ciclo seguinte (sem espera)
   * @param passoMs   a espera da primeira falha além das imediatas; cresce um passo a cada nova falha
   * @param tetoMs    a maior espera
   */
  constructor(
    private readonly imediatas = 2,
    private readonly passoMs = 2 * 60_000,
    private readonly tetoMs = 10 * 60_000,
  ) {}

  /** Anota a falha e devolve quanto o item espera (ms): 0 = tenta de novo no próximo ciclo. */
  falhou(id: string, agora = Date.now()): number {
    const n = (this.falhas.get(id)?.n ?? 0) + 1;
    const espera = n <= this.imediatas ? 0 : Math.min(this.tetoMs, this.passoMs * (n - this.imediatas));
    this.falhas.set(id, { n, ate: agora + espera, em: agora });
    return espera;
  }

  /** Deu certo (ou saiu da fila por outro caminho): esquece as falhas dele. */
  deuCerto(id: string): void {
    this.falhas.delete(id);
  }

  /** Quantas vezes seguidas falhou (0 = nunca, ou já deu certo). */
  vezes(id: string): number {
    return this.falhas.get(id)?.n ?? 0;
  }

  /** Os ids que ainda estão esperando: ficam FORA da consulta deste ciclo. Limpa o que não falha há mais de 1 h. */
  emEspera(agora = Date.now()): string[] {
    const fora: string[] = [];
    for (const [id, f] of this.falhas) {
      if (f.ate > agora) fora.push(id);
      else if (agora - f.em > 3_600_000) this.falhas.delete(id);
    }
    return fora;
  }
}
