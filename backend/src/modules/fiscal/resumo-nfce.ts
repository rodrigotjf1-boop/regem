// F1 — o que a NFC-e precisa entregar a quem vai IMPRIMIR o DANFE (hoje, o totem).
//
// Antes a venda devolvia só `{status, chave, numero}` — dava para dizer "saiu nota", mas não
// para imprimir o documento. O DANFE exige o QR (a URL já pronta, com o CSC), o protocolo de
// autorização, número E série, e a data de emissão.
//
// Dois campos existem para PROTEGER o cliente, não para enfeitar:
//  • `simulada` — o Regem marca nota emitida em modo simulado. Ela NÃO é documento fiscal, e
//    quem imprime precisa saber disso para não entregar um papel com cara de nota;
//  • `contingencia` — off-line exige a mensagem "EMITIDA EM CONTINGÊNCIA" no DANFE
//    (Manual do DANFE NFC-e v6.0 / Anexo IV), e sem este campo o totem não teria como saber.
//
// O XML fica de fora de propósito: a guarda dos 5 anos é do emitente (o Regem), e mandá-lo para
// um aparelho de sala seria espalhar documento fiscal sem necessidade.
export type ResumoNfce = {
  status: string;
  chave: string | null;
  numero: number | null;
  serie: number | null;
  protocolo: string | null;
  qrcode: string | null;
  /** '1' produção · '2' homologação. Nota de homologação não vale como documento. */
  ambiente: string;
  simulada: boolean;
  contingencia: boolean;
  emitidaEm: string | null;
  /**
   * K6 — o DANFE já montado pelo EMITENTE, pronto para o papel (marcador `@QR:` na linha do
   * QR Code). Vai montado daqui porque o aparelho que imprime não tem — nem deve ter — os
   * dados do emitente, os tributos nem a URL de consulta; e porque um segundo montador de
   * DANFE no app seria uma segunda versão do documento para corrigir a cada mudança de norma.
   * `null` quando a nota não autorizou (não há documento a imprimir).
   */
  danfe: string | null;
};

export function resumoNfce(nota: any): ResumoNfce | null {
  if (!nota) return null;
  const status = String(nota.status ?? 'pendente');
  return {
    status,
    chave: nota.chave ?? null,
    numero: nota.numero ?? null,
    serie: nota.serie ?? null,
    protocolo: nota.protocolo ?? null,
    qrcode: nota.qrcode ?? null,
    ambiente: String(nota.ambiente ?? '2'),
    simulada: nota.simulada === true,
    contingencia: status === 'contingencia',
    emitidaEm:
      nota.emitidaEm instanceof Date
        ? nota.emitidaEm.toISOString()
        : (nota.emitidaEm ?? null),
    danfe: nota.danfeTexto ?? null,
  };
}
