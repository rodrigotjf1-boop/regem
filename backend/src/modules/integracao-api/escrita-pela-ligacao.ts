import type { EscopoIntegracao } from './escopos';

// A ESCRITA SAI DOS TOKENS ANTIGOS (Hub DMS, F5 parte E; decisão F5-8). O que um produto da DMS grava na loja passa a ir
// SÓ pela ligação da loja (a via do DMS ID, F3): ali a pessoa da loja autorizou com um clique, e o Regem confere a
// ligação a cada chamada. Assim, a recusa por falta de aprovação não se contorna pelo token antigo.
//
// Com a chave da distribuição `LIAME_ESCRITA_SO_PELA_LIGACAO=true`, o `rgm_it_` do Liame continua lendo, mas perde o
// criar e o desativar cupom (`cupons.criar`); a ligação não muda. O GoGeM segue gravando pelo `rgm_it_` (a venda e a
// pausa do totem) até a F6 (decisão F3-1). Nasce desligada: liga-se depois de o Liame gravar pela ligação
// (`REGEM_PELA_LIGACAO` no Liame, ligada em 11/11/2026) e de a loja ter a ligação com a permissão de criar cupom.

/** A escrita que sai do token antigo de cada aplicativo (o resto do token segue valendo). */
export const ESCRITA_QUE_SAI_DO_TOKEN: Readonly<Record<string, readonly EscopoIntegracao[]>> = {
  liame: ['cupons.criar'],
};

/** A chave da distribuição. Só o texto `true` liga; ausente, vazia ou torta = desligada. */
export function escritaSoPelaLigacaoLigada(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LIAME_ESCRITA_SO_PELA_LIGACAO === 'true';
}

/**
 * O que esta credencial NÃO pode mais usar: a escrita do aplicativo, quando ela chega pelo `rgm_it_` e a chave está
 * ligada. Vazio pela ligação, com a chave desligada e para o aplicativo que não está na lista.
 */
export function escritaForaDoToken(
  cliente: string,
  via: 'ligacao' | undefined,
  env: NodeJS.ProcessEnv = process.env,
): readonly EscopoIntegracao[] {
  if (via === 'ligacao' || !escritaSoPelaLigacaoLigada(env)) return [];
  return Object.prototype.hasOwnProperty.call(ESCRITA_QUE_SAI_DO_TOKEN, cliente) ? ESCRITA_QUE_SAI_DO_TOKEN[cliente]! : [];
}

/** A recusa da escrita pelo token antigo: diz por onde ela vai agora. */
export function fraseEscritaSoPelaLigacao(escopos: readonly string[]): string {
  return (
    `Este token só lê: ${escopos.join(', ')} vai só pela ligação da loja (Hub DMS). ` +
    'Grave pela ligação, com o token do DMS ID e o segredo no cabeçalho DMS-Ligacao.'
  );
}
