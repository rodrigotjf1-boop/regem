import { palavrasDaDescricao, type ItemNoMister } from '../../common/nota-por-foto';

// OS MODELOS DE COMPRA E OS APELIDOS (versão 9, fase O2; não confundir com `mister-modelos.ts`, os modelos de mensagem da Meta; `docs/plano-mister.md` § "Versão 9", decisão V9-4; protótipo
// `mockups/regem-mister-v9.html`, "O próximo cupom do mesmo fornecedor" e "Na loja › Modelos de compra"; mig 503). O modelo é a
// memória do fornecedor que já existia (mig 441: este produto deste fornecedor é tal insumo), agora com a última quantidade e o
// último preço; o apelido é o nome que a empresa usa para um insumo, para qualquer fornecedor ("carne 120" = Carne 120gr).
// Só regras, sem banco: quem lê e grava é o `MisterModelosService`.

/** A chave do apelido: as palavras do nome como o achador da nota compara (sem acento, minúsculas, a medida num token só). */
export function chaveDoApelido(texto: unknown): string | null {
  const chave = palavrasDaDescricao(texto).join(' ').slice(0, 120);
  return chave.length >= 2 && /[a-z]/.test(chave) ? chave : null;
}

/**
 * Vira apelido quando a pessoa confirmou um nome DIFERENTE do cadastro: o nome igual ao do insumo (ou ao nome comercial) já é
 * achado pelas palavras e não ensina nada.
 */
export function viraApelido(texto: string, insumo: { nome: string; nomeComercial?: string | null }): string | null {
  const chave = chaveDoApelido(texto);
  if (!chave || String(texto).length > 80) return null;
  if (chave === chaveDoApelido(insumo.nome) || (insumo.nomeComercial && chave === chaveDoApelido(insumo.nomeComercial))) return null;
  return chave;
}

/** O que a memória do fornecedor guardou de um produto na última nota lançada. */
export interface UltimaVez {
  ultimaQuantidade: number | null;
  ultimoPrecoCentavos: number | null;
}

const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const reais = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nomeCurto = (it: Pick<ItemNoMister, 'insumoNome' | 'descricao'>) => String(it.insumoNome ?? it.descricao).replace(/\s+/g, ' ').trim().slice(0, 40);

/**
 * O que mudou desde a última nota do mesmo fornecedor, nos produtos que o modelo conhecia: a quantidade e o preço unitário
 * ("Carne 56gr de 120 para 100 UN", "Coca lata de R$ 38,28 para R$ 39,90"). Diferença de centavo arredondado não conta.
 */
export function mudancasDoModelo(itens: Array<Pick<ItemNoMister, 'insumoNome' | 'descricao' | 'quantidade' | 'unidade' | 'valorUnitarioCentavos'> & { ultima?: UltimaVez | null }>): string[] {
  const r: string[] = [];
  for (const it of itens) {
    const u = it.ultima;
    if (!u) continue;
    if (u.ultimaQuantidade != null && Math.abs(Number(u.ultimaQuantidade) - it.quantidade) > 1e-9)
      r.push(`${nomeCurto(it)} de ${qtd(Number(u.ultimaQuantidade))} para ${qtd(it.quantidade)}${it.unidade ? ` ${it.unidade}` : ''}`);
    if (u.ultimoPrecoCentavos != null && it.valorUnitarioCentavos != null && Math.abs(Number(u.ultimoPrecoCentavos) - it.valorUnitarioCentavos) >= 1)
      r.push(`${nomeCurto(it)} de ${reais(Number(u.ultimoPrecoCentavos))} para ${reais(it.valorUnitarioCentavos)}`);
  }
  return r;
}
