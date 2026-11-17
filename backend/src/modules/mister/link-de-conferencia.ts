// M3c.5 — O LINK DE CONFERÊNCIA (conversa 18 da versão 3 do protótipo: "manda pro Carlos o link da contagem de estoque de
// hoje"). O presidente pede; o Mister manda a outra pessoa da empresa, ligada a ele, o resumo e o botão "Abrir no Regem",
// que abre a tela COM O USUÁRIO DELA (o link não vale por si). Só o que é puro: o catálogo, achar a pessoa e a mensagem.

/** O que dá para mandar conferir (catálogo fixo: a IA escolhe daqui, nunca um endereço). */
export const ASSUNTOS_DO_LINK = ['contagem_de_hoje'] as const;
export type AssuntoDoLink = (typeof ASSUNTOS_DO_LINK)[number];

/** A tela de cada assunto: o caminho no app, o caminho do menu (conferido no `shell.tsx` — V65) e a permissão. */
export const TELA_DO_ASSUNTO: Record<AssuntoDoLink, { caminho: string; onde: string; permissao: 'estoque' }> = {
  contagem_de_hoje: { caminho: '/operacao?aba=contagem', onde: 'Estoque › Contagem', permissao: 'estoque' },
};

/** O endereço do Regem (o mesmo do "Abrir no Regem" das propostas). */
export const enderecoDoApp = () => String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');

const normal = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const primeiroNome = (nome: string) => String(nome ?? '').trim().split(/\s+/)[0] ?? '';

export type PessoaAchada<T> = { tipo: 'achou'; pessoa: T } | { tipo: 'escolher'; opcoes: string[] } | { tipo: 'nenhum' };

/**
 * A pessoa que o presidente disse ("o Carlos", "carlos lima", "pro Dani"): o nome inteiro igual vence; senão, cada palavra
 * dita tem de começar uma palavra do nome. Mais de uma → as opções, para o Mister perguntar; nenhuma → nada.
 */
export function acharPessoa<T extends { nome: string }>(dito: unknown, pessoas: T[]): PessoaAchada<T> {
  const d = normal(dito)
    .split(' ')
    .filter((w) => w && !['o', 'a', 'pro', 'pra', 'para', 'do', 'da', 'de'].includes(w));
  if (!d.length) return { tipo: 'nenhum' };
  const iguais = pessoas.filter((p) => normal(p.nome) === d.join(' '));
  if (iguais.length === 1) return { tipo: 'achou', pessoa: iguais[0] };
  const casam = pessoas.filter((p) => {
    const palavras = normal(p.nome).split(' ');
    return d.every((w) => palavras.some((x) => x.startsWith(w)));
  });
  if (casam.length === 1) return { tipo: 'achou', pessoa: casam[0] };
  if (casam.length > 1) return { tipo: 'escolher', opcoes: casam.map((p) => p.nome).slice(0, 5) };
  return { tipo: 'nenhum' };
}

/** "42 itens, 3 com diferença" (o protótipo); com item ainda sem contar, quantos foram contados. */
export function resumoDaContagem(c: { itens: number; contados: number; comDiferenca: number }): string {
  const itens = `${c.itens} ${c.itens === 1 ? 'item' : 'itens'}`;
  const contados = c.contados < c.itens ? ` (${c.contados} contados)` : '';
  return `${itens}${contados}, ${c.comDiferenca} com diferença`;
}

/** A mensagem a quem recebe: quem pediu, o quê, de quando, onde, o resumo e onde abre. */
export function mensagemDoLink(o: { quemPediu: string; assunto: AssuntoDoLink; dia: string; loja: string; resumo: string }): string {
  const onde = o.loja === 'todas as lojas' ? 'em todas as lojas' : `na ${o.loja}`;
  const tela = TELA_DO_ASSUNTO[o.assunto];
  return `📋 ${primeiroNome(o.quemPediu)} pediu para você conferir a contagem de estoque de hoje, ${o.dia}, ${onde}: ${o.resumo}. Abre em ${tela.onde}, com o seu usuário.`;
}
