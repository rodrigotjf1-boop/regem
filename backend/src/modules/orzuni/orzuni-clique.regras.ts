import { createHash, randomBytes } from 'crypto';

// O CLIQUE REGEM → ORZUNI (plano "Clique Regem → Orzuni", parte R2; mig 416) — as peças sem banco.
//
// O Regem é quem PEDE: empurra o pedido ao Orzuni (`POST /v1/dms-id/autorizacao/pedido`, RFC 9126, com o token do DMS
// ID do aplicativo), abre a página do Orzuni com o número do pedido, e na volta troca o código pela ligação
// (`POST /v1/dms-id/autorizacao/token`, com o verificador do PKCE). O `state` e o verificador nunca vão para log,
// mensagem de erro nem banco (do state, só o SHA-256; o verificador, cifrado).

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

/** Minutos que o pedido vale aqui (o Orzuni vence o dele no mesmo prazo). */
export const VALIDADE_DO_PEDIDO_MS = 10 * 60_000;

const FORMATO_DO_ESTADO = /^[A-Za-z0-9_-]{43}$/;
const FORMATO_DO_CODIGO = /^orz_ac_[A-Za-z0-9_-]{43}$/;
const FORMATO_DO_NUMERO = /^urn:ietf:params:oauth:request_uri:orz_[A-Za-z0-9_-]{43}$/;

export const resumoDoEstado = (estado: string): string => createHash('sha256').update(estado, 'utf8').digest('hex');

/** Um pedido novo: o `state` (43 caracteres), o verificador do PKCE (43) e o desafio S256. */
export function novoPedido(): { estado: string; verificador: string; desafio: string } {
  const estado = randomBytes(32).toString('base64url');
  const verificador = randomBytes(32).toString('base64url');
  return { estado, verificador, desafio: createHash('sha256').update(verificador, 'ascii').digest('base64url') };
}

export const estadoValido = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_ESTADO.test(v);
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
  let base = `${String(env.ORZUNI_APP_URL || 'https://app.orzuni.com').trim().replace(/\/+$/, '')}/autorizar`;
  if (typeof devolvido === 'string') {
    try {
      const u = new URL(devolvido);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (!u.username && !u.password && (u.protocol === 'https:' || (local && u.protocol === 'http:'))) base = `${u.origin}${u.pathname}`;
    } catch {
      /* fica o padrão */
    }
  }
  const u = new URL(base);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('request_uri', numero);
  return u.toString();
}

/** O que a volta do Orzuni trouxe na query, sem confiar em nada: só textos. */
export function lerVolta(q: unknown): { code: string | null; state: string | null; iss: string | null; error: string | null } {
  const o = (q !== null && typeof q === 'object' ? q : {}) as Record<string, unknown>;
  const t = (v: unknown) => (typeof v === 'string' && v.length <= 400 ? v : null);
  return { code: t(o.code), state: t(o.state), iss: t(o.iss), error: t(o.error) };
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
