import { normalizarUnidade } from '../estoque/unidades';

// A CONTAGEM DO ESTOQUE PELA CONVERSA (versão 9, fase O3; o catálogo do protótipo `mockups/regem-mister-v9.html`: "Estoque —
// contagem, com botão"). "Contei: bacon 12 kg, batata 30 caixas" vira a contagem de uma lista de Estoque › Contagem, pelo MESMO
// serviço da tela: abre a execução e salva com o ajuste. Só os itens ditos são contados (e ajustados); os outros da lista ficam
// sem contar. Aqui só a conferência do que a IA mandou; sem banco.

export interface ContadoDito {
  insumo: string;
  quantidade: number;
  medida: string | null;
}
export interface ParametrosDaContagem {
  acao: 'contar_estoque';
  lista: string | null;
  contados: ContadoDito[];
}

export const MAX_CONTADOS = 30;
const MAX_QUANTIDADE = 1_000_000;
const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export function conferirContagem(en: Record<string, unknown>): { parametros: ParametrosDaContagem; resumo: string } | { erro: string } {
  const entrada = en.contados;
  if (!Array.isArray(entrada) || !entrada.length) return { erro: 'Diga o que foi contado: cada insumo com a quantidade.' };
  if (entrada.length > MAX_CONTADOS) return { erro: `No máximo ${MAX_CONTADOS} itens por vez.` };
  const contados: ContadoDito[] = [];
  const vistos = new Set<string>();
  for (const c of entrada as any[]) {
    const insumo = texto(c?.insumo).slice(0, 80);
    if (insumo.length < 2) return { erro: 'Cada item contado precisa do nome do insumo.' };
    const q = c?.quantidade;
    if (typeof q !== 'number' || !Number.isFinite(q) || q < 0 || q > MAX_QUANTIDADE) return { erro: `"${insumo}": a quantidade contada é um número (0 ou mais).` };
    const medidaDita = texto(c?.medida);
    const medida = medidaDita ? normalizarUnidade(medidaDita) : null;
    if (medidaDita && !medida) return { erro: `"${insumo}": não conheço a medida "${medidaDita}".` };
    const chave = semAcento(insumo);
    if (vistos.has(chave)) return { erro: `"${insumo}" veio duas vezes: diga a quantidade uma vez só.` };
    vistos.add(chave);
    contados.push({ insumo, quantidade: Math.round(q * 1000) / 1000, medida });
  }
  const lista = texto(en.listaDeContagem).slice(0, 80) || null;
  return { parametros: { acao: 'contar_estoque', lista, contados }, resumo: '' };
}

/** O que vai acontecer, com cada item achado na lista: o contado, o que o sistema tem agora e o ajuste que sai disso. */
export function resumoDaContagem(lista: string, itens: Array<{ nome: string; unidade: string; contado: number; saldo: number }>, naLista: number): string {
  const linhas = itens.map((i) => {
    const diff = Math.round((i.contado - i.saldo) * 1000) / 1000;
    const ajuste = Math.abs(diff) < 1e-9 ? 'sem ajuste' : `ajuste de ${diff > 0 ? '+' : '−'}${qtd(Math.abs(diff))} ${i.unidade}`;
    return `• ${i.nome}: ${qtd(i.contado)} ${i.unidade} (o sistema tem ${qtd(i.saldo)} ${i.unidade}: ${ajuste})`;
  });
  const fora = naLista - itens.length;
  return (
    `Lançar a contagem "${lista}" em Estoque › Contagem:\n${linhas.join('\n')}\n` +
    `${fora === 1 ? 'O outro item da lista fica sem contar. ' : fora > 1 ? `Os outros ${fora} itens da lista ficam sem contar. ` : ''}O ajuste vale pela diferença para o que o sistema tiver na hora de lançar.`
  );
}
