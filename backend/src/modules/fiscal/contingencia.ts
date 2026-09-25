/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, HttpException } from '@nestjs/common';
import { SefazInalcancavel, SefazRecusouChamada } from './sefaz/soap';

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

/**
 * A SEFAZ calou e a contingência também não tem como sair (UF só com QR v2, certificado
 * ausente). Classe própria — e ainda um 400 para quem só olha o HTTP — porque o totem precisa
 * distinguir isto de um erro de configuração: aqui a SEFAZ PODE ter recebido a nota.
 */
export class ContingenciaIndisponivel extends BadRequestException {}

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

// ===== A FILA DA NUVEM TEM NOTAS DE MUITAS LOJAS (ERR-105) =====
//
// No servidor da loja a fila é de UMA loja: "a SEFAZ não respondeu" quer dizer que não adianta
// insistir nas outras notas. Na nuvem a mesma fila tem as notas de todas as lojas, e o erro de uma
// delas — o certificado que não abre, o certificado vencido, a conexão DELA que caiu — não diz nada
// sobre as outras. O ciclo parava no primeiro erro; e como a nota travada nunca sai da fila e era a
// mais antiga, ela vinha SEMPRE primeiro: uma loja travava a transmissão de todas, para sempre.

/** O que o botão "transmitir agora" limita: as empresas (e, havendo, a loja em uso). */
export interface EscopoContingencia {
  tenantIds: string[];
  unidadeId?: string | null;
}

/** O ponto de emissão (empresa + loja). Na fila, cada um tem a sua vez. */
export function pontoDeEmissao(tenantId: string, unidadeId?: string | null): string {
  return `${tenantId}/${unidadeId ?? '-'}`;
}

/**
 * Quem responde pela nota: a SEFAZ autorizadora da UF, num ambiente. Na chave de acesso, os dois
 * primeiros dígitos são o código IBGE da UF do emitente.
 */
export function autorizador(codigoUf: unknown, ambiente: unknown): string {
  const uf = String(codigoUf ?? '').replace(/\D/g, '').slice(0, 2).padStart(2, '0');
  return `${uf}/${String(ambiente ?? '').trim() === '1' ? '1' : '2'}`;
}

/**
 * Quem ficou sem resposta NESTE ciclo.
 *
 * O silêncio tira do ciclo só a LOJA que o recebeu: pode ser a conexão dela, ou o certificado dela
 * derrubando o TLS — e isso não é motivo para as outras esperarem. A SEFAZ de uma UF só é dada
 * como fora do ar quando DUAS lojas diferentes dela ficaram sem resposta; aí a terceira não precisa
 * esperar os mesmos 30 segundos para descobrir. No servidor da loja (uma loja só), o primeiro
 * silêncio encerra o ciclo — como sempre foi.
 */
export class SilencioDoCiclo {
  static readonly LOJAS_PARA_CONCLUIR = 2;
  private readonly lojas = new Set<string>();
  private readonly porAutorizador = new Map<string, Set<string>>();

  registrar(loja: string, autorizadorDaLoja: string): void {
    this.lojas.add(loja);
    const mudas = this.porAutorizador.get(autorizadorDaLoja) ?? new Set<string>();
    mudas.add(loja);
    this.porAutorizador.set(autorizadorDaLoja, mudas);
  }

  /** Esta loja fica para o próximo ciclo? */
  pular(loja: string, autorizadorDaLoja: string): boolean {
    if (this.lojas.has(loja)) return true;
    return (this.porAutorizador.get(autorizadorDaLoja)?.size ?? 0) >= SilencioDoCiclo.LOJAS_PARA_CONCLUIR;
  }

  /** As SEFAZ dadas como fora do ar neste ciclo — para o log. */
  foraDoAr(): string[] {
    return [...this.porAutorizador]
      .filter(([, mudas]) => mudas.size >= SilencioDoCiclo.LOJAS_PARA_CONCLUIR)
      .map(([quem]) => quem);
  }
}

/**
 * O problema é da LOJA — configuração, credencial, certificado —, não da SEFAZ nem da nota: as
 * outras notas dela falhariam do mesmo jeito neste ciclo, e as das outras lojas não têm nada com
 * isso. A mensagem é a que a loja lê na fila; a `causa` é para o log.
 */
export class FalhaDaLoja extends Error {
  constructor(
    mensagem: string,
    public readonly causa?: unknown,
  ) {
    super(mensagem);
    this.name = 'FalhaDaLoja';
  }
}

/**
 * O que fica escrito na nota quando ela não saiu por um ERRO (a rejeição da SEFAZ tem o próprio
 * texto). Erro que não foi escrito para a loja ler — um defeito nosso — não vai para a tela da
 * loja: fica no log.
 */
export function motivoDaFalha(e: unknown): string {
  const escritoParaALoja =
    e instanceof FalhaDaLoja ||
    e instanceof SefazInalcancavel ||
    e instanceof SefazRecusouChamada ||
    e instanceof HttpException;
  const texto = escritoParaALoja
    ? (e as Error).message
    : 'falha interna ao transmitir (o detalhe ficou no log do servidor)';
  return `Contingencia nao transmitida: ${texto}`.slice(0, 400);
}
