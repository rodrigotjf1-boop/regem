/* eslint-disable @typescript-eslint/no-explicit-any */

// CONTINGÊNCIA OFF-LINE DA NFC-e (`tpEmis=9`) — as regras que não dependem do banco.
//
// O caixa não pode parar porque a SEFAZ não respondeu: o cliente está no balcão, com a
// mercadoria na mão. O Ajuste SINIEF 19/16 (cl. 11ª) e o MOC 7.0 (Anexo IV) preveem
// exatamente isso — a nota é gerada, assinada e IMPRESSA sem autorização prévia, e
// transmitida depois.
//
// Três fatos que mandam no desenho, e que não são intuitivos:
//
//  1. **O gatilho é o SILÊNCIO, nunca a rejeição.** Rejeição quer dizer que a SEFAZ respondeu,
//     e respondeu não — inclusive quando o problema é a loja (781, "emissor não habilitado").
//     No RJ, documento emitido com IE desativada é INIDÔNEO *inclusive em contingência*: entrar
//     em contingência nessa hora só produziria papel sem valor.
//  2. **Número emitido em contingência não se inutiliza** — Ajuste 19/16, cl. 11ª, §2º, II é
//     literal. Ele tem de ser transmitido, nem que seja corrigido e reenviado com o mesmo
//     número e série (MOC 7.0, Anexo IV, §5). Por isso a nota de contingência nunca vira
//     "rejeitada" no nosso banco: ela continua na fila até ser autorizada.
//  3. **O número já usado numa nota NORMAL não volta.** A mesma cláusula veda reutilizar, em
//     contingência, número de NFC-e transmitida como normal — e o Anexo IV recomenda avançar
//     um número ao entrar. Como a nossa numeração só anda para a frente, isso já acontece.
//
// Prazo: **até o fim do primeiro dia útil subsequente** à emissão (Ajuste 19/16, cl. 11ª, §1º,
// II, "a"; MOC 7.0 Anexo IV §2 e §4; e o manual da SEFAZ-RJ de 16/07/2026 repete). Não são 24
// horas — o título de uma pergunta do manual do RJ ficou velho dizendo isso.

/** Justificativa padrão da entrada (xJust, B29): 15 a 256 caracteres, obrigatória (557). */
export const JUSTIFICATIVA_PADRAO = 'Falha de comunicacao com a SEFAZ na autorizacao da NFC-e';

export const XJUST_MIN = 15;
export const XJUST_MAX = 256;

/** A justificativa que vai no XML, saneada. Texto curto demais seria rejeição 557. */
export function justificativaValida(texto?: string | null): string {
  const t = String(texto ?? '').trim().replace(/\s+/g, ' ');
  if (t.length < XJUST_MIN) return JUSTIFICATIVA_PADRAO;
  return t.slice(0, XJUST_MAX);
}

/**
 * Fim do prazo de transmissão: o ÚLTIMO instante do primeiro dia útil subsequente à emissão.
 *
 * ⚠️ Considera apenas sábado e domingo. Feriado nacional, estadual ou municipal **não** entra —
 * e isso é de propósito: sem tabela de feriados confiável, errar para MENOS adianta o aviso
 * (avisamos antes do prazo real), enquanto errar para mais deixaria passar. No RJ, transmitir
 * fora do prazo é multa de 100 UFIR-RJ por obrigação (RICMS, art. 62-C, XIII).
 *
 * Recebe e devolve o instante em UTC; o "dia" é lido no fuso já aplicado pelo chamador
 * (`dhEmiSefaz`), porque é o dia da OPERAÇÃO que conta, não o do servidor.
 */
export function prazoTransmissao(emissao: Date): Date {
  const d = new Date(emissao.getTime());
  d.setUTCHours(0, 0, 0, 0);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); // 0 domingo, 6 sábado
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/** Horas que ainda faltam para o prazo. Negativo = já venceu. */
export function horasAteOPrazo(emissao: Date, agora: Date): number {
  return Math.round(((prazoTransmissao(emissao).getTime() - agora.getTime()) / 3_600_000) * 10) / 10;
}

export function prazoVencido(emissao: Date, agora: Date): boolean {
  return agora.getTime() > prazoTransmissao(emissao).getTime();
}

/**
 * A falha da transmissão foi SILÊNCIO (não sei o que aconteceu) ou RESPOSTA (sei que não foi)?
 * Só o silêncio autoriza a contingência. `status` é o que ficou gravado na nota.
 */
export function silencioDaSefaz(status: string | null | undefined): boolean {
  return String(status ?? '') === 'pendente';
}
