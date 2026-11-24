import { pareceConversa } from '../../common/duvida-da-nota';
import { normalizarUnidade } from '../estoque/unidades';
import { PREFIXO_DA_LISTA, quantidadeNoEstoque, type LinhaDaLista } from './mister-lista';

// A LISTA DE COMPRAS PELA IA E PELA CONVERSA (versão 9, fase O4; `docs/plano-mister.md` § "Versão 9"). A lista da foto passa pela
// MESMA ligação pela IA do cupom (O1), com as dúvidas juntas numa mensagem e o "Aceitar as sugestões"; a resposta em frase vai
// pela ferramenta (acao "alterar"); "repete o último pedido do Felipão" monta a lista já ligada. Só regras, sem banco.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** O "Aceitar as sugestões" da lista: `lc:<lista>:ia`. */
export const botaoDasSugestoes = (listaId: string) => ({ id: `${PREFIXO_DA_LISTA}${listaId}:ia`, titulo: 'Aceitar as sugestões' });
export function lerBotaoDasSugestoes(botaoId: unknown): string | null {
  const m = new RegExp(`^lc:(${UUID}):ia$`, 'i').exec(String(botaoId ?? ''));
  return m ? m[1].toLowerCase() : null;
}

/** A lista foi ligada pela IA: as dúvidas vão juntas, não uma por vez. */
export const listaPelaIa = (linhas: LinhaDaLista[]): boolean => linhas.some((l) => l.pelaIa || l.propostaDaIa);

const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const quanto = (l: Pick<LinhaDaLista, 'quantidade' | 'unidade'>) => `${qtd(l.quantidade)}${l.unidade ? ` ${l.unidade}` : ''}`;

/** As dúvidas da lista numa mensagem, cada uma com o número da linha (o que a pessoa e o agente usam). */
export function perguntasJuntas(listaId: string, linhas: LinhaDaLista[]): { texto: string; botoes: { id: string; titulo: string }[] } {
  const pendentes = linhas.map((l, i) => ({ l, i })).filter(({ l }) => l.estado === 'item' || l.estado === 'fator' || l.estado === 'marca');
  const ligadas = linhas.filter((l) => l.estado === 'ligado').length;
  const frase = ({ l, i }: { l: LinhaDaLista; i: number }) => {
    const nome = `Linha ${i + 1} · "${l.texto}" (${quanto(l)})`;
    if (l.estado === 'marca') return `• ${nome}: o ${l.itemNome} tem as marcas ${l.marcas.join(', ')}. Qual vai?`;
    if (l.estado === 'fator') {
      if (l.fatorProposto != null) return `• ${nome}: é o ${l.itemNome}. Fica ${qtd(quantidadeNoEstoque({ quantidade: l.quantidade, fator: l.fatorProposto }))} ${l.unidadeDoEstoque}, certo?`;
      return `• ${nome}: é o ${l.itemNome}, contado em ${l.unidadeDoEstoque}. Quanto do estoque vem em 1 ${l.unidade ?? 'unidade'}?`;
    }
    const [a, b] = l.opcoes;
    if (l.propostaDaIa && a) return `• ${nome}: é o *${a.nome}*?${b ? ` Ou o ${b.nome}?` : ''}`;
    if (a) return `• ${nome}: não tenho certeza. Pode ser o *${a.nome}*${b ? ` ou o ${b.nome}` : ''}.`;
    return `• ${nome}: não achei no estoque. ${l.nomeNovo ? `Cadastro *${l.nomeNovo}*, ou é outro nome?` : 'Cadastro um novo, ou é outro nome?'}`;
  };
  const mostradas = pendentes.slice(0, 10).map(frase);
  const mais = pendentes.length > 10 ? `\n• e mais ${pendentes.length - 10}` : '';
  const temProposta = pendentes.some(({ l }) => (l.estado === 'item' && l.propostaDaIa && l.opcoes[0]) || (l.estado === 'fator' && l.fatorProposto != null));
  return {
    texto:
      `Liguei ${ligadas} de ${linhas.length} linhas ao seu estoque. ${pendentes.length} ${pendentes.length === 1 ? 'precisa' : 'precisam'} de você:\n\n${mostradas.join('\n')}${mais}\n\n` +
      'Responda numa frase (ex.: "3 sim, o 5 são 20 pacotes, tira o 7") ou toque em "Aceitar as sugestões". Nada foi pedido.',
    botoes: [...(temProposta ? [botaoDasSugestoes(listaId)] : []), { id: `${PREFIXO_DA_LISTA}${listaId}:cancelar`, titulo: 'Cancelar' }],
  };
}

export type AlteracaoDaLista =
  | { linha: number; tipo: 'ligar'; insumo: string }
  | { linha: number; tipo: 'quantidade'; quantidade: number; medida: string | null }
  | { linha: number; tipo: 'fora' }
  | { linha: number; tipo: 'cadastrar'; nome: string | null; medida: string | null }
  | { linha: number; tipo: 'marca'; marca: string }
  | { linha: number; tipo: 'conversao'; quantoNoEstoque: number };

const MAX_ALTERACOES = 20;
const MAX_QUANTIDADE = 100_000;
const emTexto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const positivo = (v: unknown, teto: number): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= teto;

/** O que o agente pediu para mudar na lista aberta, conferido inteiro antes de qualquer gravação. */
export function lerAlteracoesDaLista(entrada: unknown): { alteracoes: AlteracaoDaLista[] } | { erro: string } {
  if (!Array.isArray(entrada) || !entrada.length) return { erro: 'Diga o que mudar: alteracoes, cada uma com a linha e o tipo.' };
  if (entrada.length > MAX_ALTERACOES) return { erro: `No máximo ${MAX_ALTERACOES} linhas de uma vez.` };
  const r: AlteracaoDaLista[] = [];
  for (const a of entrada as any[]) {
    const linha = Number(a?.linha);
    if (!Number.isInteger(linha) || linha < 1 || linha > 40) return { erro: 'Cada alteração precisa do número da linha da lista.' };
    if (a?.tipo === 'fora') r.push({ linha, tipo: 'fora' });
    else if (a?.tipo === 'ligar') {
      const insumo = emTexto(a.insumo).slice(0, 120);
      if (insumo.length < 2) return { erro: `Linha ${linha}: diga o insumo como está no estoque.` };
      r.push({ linha, tipo: 'ligar', insumo });
    } else if (a?.tipo === 'quantidade') {
      if (!positivo(a.quantidade, MAX_QUANTIDADE)) return { erro: `Linha ${linha}: a quantidade não é válida.` };
      const medida = emTexto(a.medida) ? normalizarUnidade(emTexto(a.medida)) : null;
      if (emTexto(a.medida) && !medida) return { erro: `Linha ${linha}: não conheço a medida "${emTexto(a.medida)}".` };
      r.push({ linha, tipo: 'quantidade', quantidade: Math.round(a.quantidade * 1000) / 1000, medida });
    } else if (a?.tipo === 'cadastrar') {
      const nome = emTexto(a.nome) || null;
      if (nome && (nome.length < 2 || nome.length > 80 || !/\p{L}/u.test(nome) || pareceConversa(nome))) return { erro: `Linha ${linha}: isso não parece o nome de um produto.` };
      const medida = emTexto(a.medida) ? normalizarUnidade(emTexto(a.medida)) : null;
      if (emTexto(a.medida) && !medida) return { erro: `Linha ${linha}: não conheço a medida "${emTexto(a.medida)}".` };
      r.push({ linha, tipo: 'cadastrar', nome, medida });
    } else if (a?.tipo === 'marca') {
      const marca = emTexto(a.marca).slice(0, 60);
      if (marca.length < 1) return { erro: `Linha ${linha}: diga a marca.` };
      r.push({ linha, tipo: 'marca', marca });
    } else if (a?.tipo === 'conversao') {
      if (!positivo(a.quanto_no_estoque, MAX_QUANTIDADE)) return { erro: `Linha ${linha}: diga quanto do estoque vem em 1 da unidade pedida.` };
      r.push({ linha, tipo: 'conversao', quantoNoEstoque: a.quanto_no_estoque });
    } else return { erro: 'tipo precisa ser ligar, quantidade, fora, cadastrar, marca ou conversao.' };
  }
  return { alteracoes: r };
}
