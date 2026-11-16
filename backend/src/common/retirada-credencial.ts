import { Logger } from '@nestjs/common';

/**
 * O ANÚNCIO DA RETIRADA DAS CREDENCIAIS ANTIGAS (Hub DMS F6, plano "Fim das portas antigas", decisões P-1 e P-3).
 *
 * Toda resposta à credencial antiga — o token colado `rgm_it_` e, na nuvem, o caminho antigo do totem (`X-Sync-Token`
 * com a marca `X-Integrador: gogem`) — leva os cabeçalhos do Padrão DMS §12:
 *   - `Deprecation: @<segundos>` (RFC 9745): o dia A, em que a retirada foi anunciada;
 *   - `Sunset: <data HTTP>` (RFC 8594): o dia em que a credencial deixa de valer (A + 90 dias, no mínimo);
 *   - `Link: <endereço>; rel="deprecation"`, quando houver a página que explica o caminho novo.
 * A ligação do clique nunca leva os cabeçalhos, e o servidor da loja também não (o `X-Sync-Token` fica lá, P-6).
 *
 * Nasce DESLIGADO: sem `INTEGRACAO_ANTIGA_ANUNCIO`, nada muda. Data torta, ou `Sunset` a menos de 90 dias do anúncio,
 * não liga (o motivo vai ao log uma vez): anunciar errado é pior que não anunciar. A recusa da credencial depois do
 * `Sunset` é outra peça (P-4: uma chave da distribuição, sem deploy), que não está aqui.
 */

/** O Padrão DMS §12: entre o anúncio e o fim, no mínimo 90 dias. */
export const DIAS_MINIMOS_ATE_O_SUNSET = 90;

const DIA_MS = 86_400_000;

export type RetiradaDaCredencialAntiga =
  | { ligada: true; anuncio: Date; sunset: Date; cabecalhos: Record<string, string> }
  | { ligada: false; motivo: string | null };

/** `YYYY-MM-DD` como o começo do dia em UTC; outra coisa (ou data que não existe) = `null`. */
function dataDoDia(valor: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia ? d : null;
}

/** O endereço do `Link`: só https, sem usuário, senha nem fragmento. */
function enderecoDoLink(valor: string): string | null {
  try {
    const u = new URL(valor);
    if (u.protocol !== 'https:' || u.username || u.password || u.hash) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * A retirada, lida do ambiente (a distribuição configura no EasyPanel; nada disso é da loja):
 * - `INTEGRACAO_ANTIGA_ANUNCIO` = o dia A (`YYYY-MM-DD`); sem ele, desligado;
 * - `INTEGRACAO_ANTIGA_SUNSET` = o último dia (`YYYY-MM-DD`); vazio = A + 90 dias;
 * - `INTEGRACAO_ANTIGA_LINK` = a página que explica o caminho do clique (opcional, https).
 */
export function lerRetiradaDaCredencialAntiga(env: Record<string, string | undefined>): RetiradaDaCredencialAntiga {
  const anuncioBruto = (env.INTEGRACAO_ANTIGA_ANUNCIO ?? '').trim();
  if (!anuncioBruto) return { ligada: false, motivo: null };
  const anuncio = dataDoDia(anuncioBruto);
  if (!anuncio) return { ligada: false, motivo: 'INTEGRACAO_ANTIGA_ANUNCIO precisa ser uma data AAAA-MM-DD' };

  // `||` e não `??`: variável vazia no painel = o padrão (V58).
  const sunsetBruto = (env.INTEGRACAO_ANTIGA_SUNSET || '').trim();
  const sunset = sunsetBruto ? dataDoDia(sunsetBruto) : new Date(anuncio.getTime() + DIAS_MINIMOS_ATE_O_SUNSET * DIA_MS);
  if (!sunset) return { ligada: false, motivo: 'INTEGRACAO_ANTIGA_SUNSET precisa ser uma data AAAA-MM-DD' };
  const dias = Math.round((sunset.getTime() - anuncio.getTime()) / DIA_MS);
  if (dias < DIAS_MINIMOS_ATE_O_SUNSET) {
    return {
      ligada: false,
      motivo: `INTEGRACAO_ANTIGA_SUNSET está a ${dias} dias do anúncio; o Padrão DMS pede no mínimo ${DIAS_MINIMOS_ATE_O_SUNSET}`,
    };
  }

  const linkBruto = (env.INTEGRACAO_ANTIGA_LINK || '').trim();
  const link = linkBruto ? enderecoDoLink(linkBruto) : null;
  if (linkBruto && !link) return { ligada: false, motivo: 'INTEGRACAO_ANTIGA_LINK precisa ser um endereço https' };

  const cabecalhos: Record<string, string> = {
    Deprecation: `@${Math.floor(anuncio.getTime() / 1000)}`,
    Sunset: sunset.toUTCString(),
  };
  if (link) cabecalhos.Link = `<${link}>; rel="deprecation"`;
  return { ligada: true, anuncio, sunset, cabecalhos };
}

const logger = new Logger('RetiradaDaCredencialAntiga');
let lido: { chave: string; valor: RetiradaDaCredencialAntiga } | null = null;

/** A retirada deste processo (relida só quando o ambiente muda); o motivo de configuração torta vai ao log uma vez. */
export function retiradaDaCredencialAntiga(env: Record<string, string | undefined> = process.env): RetiradaDaCredencialAntiga {
  const chave = [env.INTEGRACAO_ANTIGA_ANUNCIO, env.INTEGRACAO_ANTIGA_SUNSET, env.INTEGRACAO_ANTIGA_LINK].join('\n');
  if (lido?.chave !== chave) {
    const valor = lerRetiradaDaCredencialAntiga(env);
    if (!valor.ligada && valor.motivo) logger.error(`Anúncio da retirada desligado: ${valor.motivo}`);
    lido = { chave, valor };
  }
  return lido.valor;
}

/** Põe os cabeçalhos do anúncio na resposta (nada, se desligado). Nunca derruba a chamada. */
export function anunciarRetiradaNaResposta(res: { setHeader?: (nome: string, valor: string) => unknown } | undefined): void {
  const r = retiradaDaCredencialAntiga();
  if (!r.ligada || typeof res?.setHeader !== 'function') return;
  for (const [nome, valor] of Object.entries(r.cabecalhos)) res.setHeader(nome, valor);
}

/** Só para os testes: esquece a leitura guardada. */
export function esquecerRetiradaLida(): void {
  lido = null;
}
