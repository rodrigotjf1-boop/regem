import { AppError } from './errors/app-error';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O porquê de uma falha de rede, em texto curto, para o log e para a mensagem ao gestor
 * ("ENOTFOUND api-stg.gogem.com.br", "ECONNREFUSED 10.0.0.5:443", "tempo esgotado").
 *
 * O `fetch` do Node (undici) lança só "fetch failed": o motivo está em `err.cause` (`code`,
 * `message` e às vezes `hostname`/`address`/`port`) — e, quando a chamada passa pelo
 * `fetchExterno`, um nível abaixo (AppError → TypeError → causa). Sem isto o "Publicar no GoGeM"
 * mostrou só "fetch failed" e o motivo real (a env apontando para um host que não existe) ficou
 * escondido (ERR-239; V11 / LIC-003).
 *
 * Nunca leva cabeçalho, token nem a URL: só o código e o host/endereço — ou a mensagem da causa,
 * sem nada que pareça query e cortada. `null` = não há causa de rede para contar.
 */
export function causaDeRede(e: unknown): string | null {
  const cadeia: any[] = [];
  for (let atual: any = e, i = 0; atual && i < 5; atual = atual.cause, i++) cadeia.push(atual);
  const esgotou = cadeia.some(
    (x) => x?.name === 'TimeoutError' || x?.name === 'AbortError' || (x instanceof AppError && x.code === 'EXTERNAL_SERVICE_TIMEOUT'),
  );
  // A causa mais funda que não é nossa (o AppError só embrulha).
  const causa = [...cadeia].reverse().find((x) => x && typeof x === 'object' && !(x instanceof AppError) && (x.code || x.message));
  const codigo = typeof causa?.code === 'string' ? causa.code : null;
  const mensagem = typeof causa?.message === 'string' ? limpar(causa.message) : '';
  if (codigo) {
    const alvo =
      (typeof causa.hostname === 'string' && causa.hostname) ||
      (typeof causa.address === 'string' && `${causa.address}${causa.port ? `:${causa.port}` : ''}`) ||
      mensagem.match(new RegExp(`\\b${codigo}\\s+(\\S+)`))?.[1] ||
      '';
    return alvo ? `${codigo} ${alvo}` : mensagem && mensagem !== 'fetch failed' ? `${codigo}: ${mensagem}` : codigo;
  }
  if (esgotou) return 'tempo esgotado';
  // Sem código: a mensagem da causa só conta se diz mais que o próprio erro.
  if (causa && causa !== e && mensagem && mensagem !== 'fetch failed') return mensagem;
  return null;
}

/** Sem query de URL (pode levar token) e no máximo 160 caracteres. */
function limpar(t: string): string {
  return t.replace(/\?\S*/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}
