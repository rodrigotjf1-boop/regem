import { AppError } from './errors/app-error';
import { ErrorCodes } from './errors/error-codes';
import { causaDeRede } from './causa-de-rede';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Quanto tempo o canal pode ficar sem responder antes de virar ERRO na telemetria. */
export const POLLER_ERRO_APOS_MS = 5 * 60 * 1000;
/** Enquanto continua sem responder, o erro se repete a cada tanto (o console vê que segue). */
export const POLLER_REPETE_ERRO_MS = 30 * 60 * 1000;

/**
 * A falha é de REDE (o canal não respondeu a tempo ou a conexão caiu)? É a que passa sozinha: a
 * próxima volta do poller (30 s) tenta de novo. Erro de código, de banco ou resposta recusada não é.
 */
export function ehFalhaDeRede(e: unknown): boolean {
  for (let x: any = e, i = 0; x && i < 5; x = x.cause, i++) {
    if (x?.name === 'TimeoutError' || x?.name === 'AbortError') return true;
    if (x instanceof AppError && x.code === ErrorCodes.EXTERNAL_SERVICE_TIMEOUT) return true;
    // Pelo nome, não por `instanceof`: o TypeError do fetch nasce no contexto interno do Node (no
    // jest, outro "realm"), e o `instanceof TypeError` do nosso código dá falso.
    if (x?.name === 'TypeError' && x.message === 'fetch failed') return true;
  }
  return false;
}

type Registro = { error(m: string, stack?: string): void; warn(m: string): void; log(m: string): void };
type Seguidas = { inicio: number; vezes: number; erroEm: number | null };

/**
 * O que o poller de um canal (iFood, 99Food, Anota AI…) faz com a falha de uma loja.
 *
 * Antes, todo `catch` virava `logger.error` com o stack: o console da distribuição mostrava como
 * erro o iFood que demorou 10 s numa volta e respondeu 30 s depois, sem dizer o porquê ("Falha de
 * rede ao falar com o serviço externo.", 6 vezes). Agora (ERR-244):
 *  - falha de REDE → aviso com o motivo ("tempo esgotado", "ECONNRESET host"), que fica no log;
 *  - a mesma loja sem resposta há 5 min → ERRO na telemetria, repetido a cada 30 min enquanto durar;
 *  - voltou a responder → uma linha dizendo depois de quantas falhas;
 *  - qualquer outra falha → o ERRO de sempre, com o stack, na hora.
 * O estado é deste processo e por loja: um poller por canal, uma volta por vez.
 */
export class FalhasDoPoller {
  private readonly seguidas = new Map<string, Seguidas>();

  constructor(private readonly registro: Registro) {}

  falhou(chave: string, prefixo: string, e: any, agora = Date.now()): void {
    const mensagem = e?.message ?? String(e);
    if (!ehFalhaDeRede(e)) {
      this.registro.error(`${prefixo}: ${mensagem}`, e?.stack);
      return;
    }
    const s = this.seguidas.get(chave) ?? { inicio: agora, vezes: 0, erroEm: null };
    s.vezes++;
    this.seguidas.set(chave, s);
    const causa = causaDeRede(e);
    const motivo = causa ? `${mensagem} (${causa})` : mensagem;
    const durando = agora - s.inicio;
    const repetir = s.erroEm === null ? durando >= POLLER_ERRO_APOS_MS : agora - s.erroEm >= POLLER_REPETE_ERRO_MS;
    if (repetir) {
      s.erroEm = agora;
      this.registro.error(`${prefixo}: sem resposta há ${Math.floor(durando / 60000)} min (${s.vezes} tentativas seguidas) — ${motivo}`);
      return;
    }
    this.registro.warn(`${prefixo}: falha passageira (${s.vezes}ª seguida; tenta de novo na próxima volta) — ${motivo}`);
  }

  funcionou(chave: string, prefixo: string, agora = Date.now()): void {
    const s = this.seguidas.get(chave);
    if (!s) return;
    this.seguidas.delete(chave);
    this.registro.log(`${prefixo}: voltou a responder depois de ${s.vezes} falha(s) seguida(s) em ${Math.round((agora - s.inicio) / 1000)} s`);
  }
}
