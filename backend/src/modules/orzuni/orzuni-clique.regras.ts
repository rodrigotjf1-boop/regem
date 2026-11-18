import { paginaDeAutorizacao } from '../../common/clique-dms';

// O CLIQUE REGEM → ORZUNI (plano "Clique Regem → Orzuni", parte R2; mig 416) — as peças sem banco.
//
// O Regem é quem PEDE: empurra o pedido ao Orzuni (`POST /v1/dms-id/autorizacao/pedido`, RFC 9126, com o token do DMS
// ID do aplicativo), abre a página do Orzuni com o número do pedido, e na volta troca o código pela ligação
// (`POST /v1/dms-id/autorizacao/token`, com o verificador do PKCE). O `state` e o verificador nunca vão para log,
// mensagem de erro nem banco (do state, só o SHA-256; o verificador, cifrado).
//
// As peças que o clique do DMS Graph (mig 450) usa do mesmo jeito moram em `common/clique-dms.ts` desde a G5a: o pedido,
// o resumo do state, a forma do state e a leitura da volta — reexportadas aqui com os mesmos nomes (nada mudou nelas).
export { VALIDADE_DO_PEDIDO_MS, estadoValido, lerVolta, novoPedido, resumoDoEstado } from '../../common/clique-dms';

/** O que o Regem pede (decisão OZ-3): as necessárias para o preço e a pausa dos itens; as opcionais o dono decide. */
export const NECESSARIAS_DO_CLIQUE = ['catalogo.ler', 'preco.escrever', 'status.escrever'] as const;
export const OPCIONAIS_DO_CLIQUE = ['catalogo.escrever', 'loja.ler', 'loja.escrever'] as const;
export type PermissaoDoClique = (typeof NECESSARIAS_DO_CLIQUE)[number] | (typeof OPCIONAIS_DO_CLIQUE)[number];
const TODAS: readonly string[] = [...NECESSARIAS_DO_CLIQUE, ...OPCIONAIS_DO_CLIQUE];

/** As frases que a janela do Regem mostra (as mesmas palavras do mockup aprovado). */
export const FRASE_DA_PERMISSAO: Readonly<Record<PermissaoDoClique, string>> = {
  'catalogo.ler': 'Ler o cardápio do iFood',
  'preco.escrever': 'Mudar o preço dos itens',
  'status.escrever': 'Pausar e reativar itens',
  'catalogo.escrever': 'Editar nome, descrição e foto',
  'loja.ler': 'Ver se a loja está aberta ou pausada',
  'loja.escrever': 'Pausar a loja inteira no iFood',
};

const FORMATO_DO_CODIGO = /^orz_ac_[A-Za-z0-9_-]{43}$/;
const FORMATO_DO_NUMERO = /^urn:ietf:params:oauth:request_uri:orz_[A-Za-z0-9_-]{43}$/;

export const codigoValido = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_CODIGO.test(v);
export const numeroValido = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_NUMERO.test(v);

/** O endereço de volta do Regem — o mesmo que o Orzuni tem cadastrado (`VOLTAS_PADRAO.regem` lá). V58: `||`. */
export function voltaDoRegem(env: Record<string, string | undefined> = process.env): string {
  return `${String(env.APP_URL || 'https://app.dmsregem.com').trim().replace(/\/+$/, '')}/integracoes/orzuni/volta`;
}

/** A origem do Orzuni (o `iss` que a volta tem de trazer, RFC 9207), tirada do endereço da porta. */
export function emissorDoOrzuni(enderecoDaPorta: string): string {
  return new URL(enderecoDaPorta).origin;
}

/** As permissões do pedido: no modo novo, todas (o dono liga as opcionais lá); no "pedir mais", só as opcionais novas. */
export function permissoesDoPedido(modo: 'novo' | 'mais', jaTem: readonly string[], querMais: unknown): string[] {
  if (modo === 'novo') return [...TODAS];
  const lista = Array.isArray(querMais) ? querMais.filter((x): x is string => typeof x === 'string') : [];
  return OPCIONAIS_DO_CLIQUE.filter((p) => lista.includes(p) && !jaTem.includes(p));
}

/**
 * O endereço da página do Orzuni para o navegador: o que o Orzuni devolveu no pedido, só se for https (ou a própria
 * máquina, em teste); senão o padrão. Leva só o aplicativo e o número do pedido.
 */
export function urlDaPagina(devolvido: unknown, clientId: string, numero: string, env: Record<string, string | undefined> = process.env): string {
  const padrao = `${String(env.ORZUNI_APP_URL || 'https://app.orzuni.com').trim().replace(/\/+$/, '')}/autorizar`;
  return paginaDeAutorizacao(devolvido, padrao, clientId, numero);
}

/** A frase da tela para cada volta sem ligação (mockup aprovado, vista 6). */
export function fraseDaVolta(motivo: 'access_denied' | 'invalid_request_uri' | 'vencido' | 'outra_sessao' | 'emissor' | 'erro'): string {
  switch (motivo) {
    case 'access_denied':
      return 'Você não autorizou no Orzuni. Nada mudou. Se quiser ligar, comece de novo pelo botão "Conectar ao Orzuni".';
    case 'invalid_request_uri':
    case 'vencido':
      return 'O pedido venceu: a página do Orzuni ficou aberta mais de 10 minutos. Comece de novo; nada foi ligado.';
    case 'outra_sessao':
      return 'Este retorno não é de um pedido aberto por você nesta conta. Por segurança, comece de novo por aqui.';
    case 'emissor':
      return 'A volta não veio do Orzuni. Nada foi ligado. Comece de novo pelo botão "Conectar ao Orzuni".';
    default:
      return 'Não foi possível concluir a ligação com o Orzuni agora. Tente de novo em alguns minutos; se continuar, avise o suporte.';
  }
}
