import { cnpjValido } from '../../common/validadores-br';
import { pareceConversa } from '../../common/duvida-da-nota';
import { normalizarUnidade } from '../estoque/unidades';

// O CADASTRO PELA CONVERSA (versão 9, fase O3; `docs/plano-mister.md` § "Versão 9", decisão V9-5). Cadastrar e mudar insumo,
// cadastrar fornecedor e excluir um pedido de compra ainda não recebido: tudo PROPOSTO, com o botão "Autorizar", e feito pelo MESMO
// serviço da tela (Estoque › Produtos, Fornecedores, Estoque › Pedidos). Aqui só a conferência do que a IA mandou; sem banco.

export type ParametrosDeCadastro =
  | { acao: 'cadastrar_insumo'; nome: string; unidade: string; minimo: number | null; fornecedor: string | null; nomeComercial: string | null }
  | {
      acao: 'alterar_insumo';
      item: string;
      novoNome: string | null;
      nomeComercial: string | null;
      minimo: number | null;
      conversao: { unidade: string; quantas: number } | null;
      fornecedor: string | null;
    }
  | { acao: 'cadastrar_fornecedor'; nome: string; cnpj: string | null; telefone: string | null; contato: string | null }
  | { acao: 'excluir_pedido_compra'; pedido: string };

const MAX_MINIMO = 1_000_000;
const MAX_QUANTAS = 100_000;
const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const opcional = (v: unknown, max: number): string | null => {
  const t = texto(v);
  return t ? t.slice(0, max) : null;
};
/** Nome de produto ou de fornecedor: tem letra e não é uma frase da conversa ("confirmado", "pode cadastrar"). */
const nomeValido = (t: string) => t.length >= 2 && t.length <= 80 && /\p{L}/u.test(t) && !pareceConversa(t);
const numero = (v: unknown): number | null | 'ruim' => {
  if (v === undefined || v === null || v === '') return null;
  return typeof v === 'number' && Number.isFinite(v) ? v : 'ruim';
};
const quantidade = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

export function conferirCadastro(acao: ParametrosDeCadastro['acao'], en: Record<string, unknown>): { parametros: ParametrosDeCadastro; resumo: string } | { erro: string } {
  if (acao === 'cadastrar_insumo') {
    const nome = texto(en.nome);
    if (!nomeValido(nome)) return { erro: 'Diga o nome do insumo novo, como vai aparecer em Estoque › Produtos.' };
    const unidade = normalizarUnidade(texto(en.medidaDoEstoque));
    if (!unidade) return { erro: 'Diga a unidade em que o insumo é contado no estoque: kg, unidade, caixa, pacote, litro, fardo…' };
    const minimo = numero(en.minimo);
    if (minimo === 'ruim' || (minimo !== null && (minimo < 0 || minimo > MAX_MINIMO))) return { erro: 'O estoque mínimo é um número (0 ou mais).' };
    const fornecedor = opcional(en.fornecedor, 80);
    const nomeComercial = opcional(en.nomeComercial, 80);
    const partes = [`em ${unidade}`, ...(minimo !== null ? [`mínimo de ${quantidade(minimo)}`] : []), ...(fornecedor ? [`fornecedor ${fornecedor}`] : []), ...(nomeComercial ? [`nome comercial "${nomeComercial}"`] : [])];
    return { parametros: { acao, nome, unidade, minimo, fornecedor, nomeComercial }, resumo: `Cadastrar o insumo "${nome}" ${partes.join(', ')}.` };
  }
  if (acao === 'alterar_insumo') {
    const item = texto(en.item);
    if (item.length < 2 || item.length > 80) return { erro: 'Diga o insumo como aparece em Estoque › Produtos.' };
    const novoNome = opcional(en.novoNome, 80);
    if (novoNome !== null && !nomeValido(novoNome)) return { erro: 'Isso não parece o nome de um produto.' };
    const nomeComercial = opcional(en.nomeComercial, 80);
    const minimo = numero(en.minimo);
    if (minimo === 'ruim' || (minimo !== null && (minimo < 0 || minimo > MAX_MINIMO))) return { erro: 'O estoque mínimo é um número (0 ou mais).' };
    let conversao: { unidade: string; quantas: number } | null = null;
    if (en.conversaoDe !== undefined || en.conversaoQuantas !== undefined) {
      const unidade = normalizarUnidade(texto(en.conversaoDe));
      const quantas = numero(en.conversaoQuantas);
      if (!unidade || quantas === null || quantas === 'ruim' || quantas <= 0 || quantas > MAX_QUANTAS)
        return { erro: 'A conversão vai assim: conversaoDe (caixa, fardo, pacote…) e conversaoQuantas = quanto do estoque vem em 1 dela.' };
      conversao = { unidade, quantas };
    }
    const fornecedor = opcional(en.fornecedor, 80);
    if (novoNome === null && nomeComercial === null && minimo === null && conversao === null && fornecedor === null)
      return { erro: 'Diga o que muda no insumo: o nome, o nome comercial, o mínimo, a conversão ou o fornecedor.' };
    const partes = [
      ...(novoNome ? [`o nome passa a ser "${novoNome}"`] : []),
      ...(nomeComercial ? [`o nome comercial passa a ser "${nomeComercial}"`] : []),
      ...(minimo !== null ? [`o mínimo passa a ser ${quantidade(minimo)}`] : []),
      ...(conversao ? [`1 ${conversao.unidade} = ${quantidade(conversao.quantas)} da unidade do estoque`] : []),
      ...(fornecedor ? [`o fornecedor ${fornecedor} entra na lista`] : []),
    ];
    return { parametros: { acao, item, novoNome, nomeComercial, minimo, conversao, fornecedor }, resumo: `Mudar o insumo "${item}": ${partes.join('; ')}.` };
  }
  if (acao === 'cadastrar_fornecedor') {
    const nome = texto(en.nome);
    if (!nomeValido(nome)) return { erro: 'Diga o nome do fornecedor.' };
    const cnpjDito = texto(en.cnpj).replace(/\D/g, '');
    if (cnpjDito && (cnpjDito.length !== 14 || !cnpjValido(cnpjDito))) return { erro: 'Esse CNPJ não confere. Diga os 14 números de novo, ou cadastre sem ele.' };
    const telefone = texto(en.foneDoFornecedor).replace(/\D/g, '');
    if (telefone && (telefone.length < 10 || telefone.length > 13)) return { erro: 'O telefone vai com o DDD (10 ou 11 números).' };
    const contato = opcional(en.contato, 60);
    const partes = [...(cnpjDito ? [`CNPJ ${cnpjDito.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}`] : []), ...(contato ? [`contato ${contato}`] : []), ...(telefone ? ['com o telefone'] : [])];
    return {
      parametros: { acao, nome, cnpj: cnpjDito || null, telefone: telefone || null, contato },
      resumo: `Cadastrar o fornecedor "${nome}"${partes.length ? `, ${partes.join(', ')}` : ''}.`,
    };
  }
  const pedido = texto(en.pedidoDeCompra);
  if (pedido.length < 2 || pedido.length > 80) return { erro: 'Diga o pedido de compra pelo nome ou pelo fornecedor, como aparece em Estoque › Pedidos.' };
  return { parametros: { acao: 'excluir_pedido_compra', pedido }, resumo: `Excluir o pedido de compra "${pedido}".` };
}

/**
 * Rodada 7, MIS-E-04 (ERR-656): o insumo NOVO pedido pela nota ou pela lista não é criado pela ferramenta do documento — vai pela
 * ação `cadastrar_insumo` (o "Vou fazer" e o botão), como no protótipo v9 ("Cadastro pela conversa": mostra antes de gravar).
 */
export const TEXTOS_DO_CADASTRO_NA_CONVERSA = {
  antesDoBotao: (linha: number, nome: string, unidade: string) =>
    `Linha ${linha}: "${nome}" ainda não está em Estoque › Produtos. Cadastro novo mostra antes de gravar: proponha com propor_acao (acao cadastrar_insumo, nome "${nome}", unidade "${unidade}") — a pessoa autoriza no botão — e, depois do "feito", ligue esta linha a ele. Nada foi cadastrado.`,
} as const;
