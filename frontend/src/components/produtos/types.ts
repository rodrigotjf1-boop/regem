// Tipos + constantes compartilhados das telas de produto (extraídos de
// app/produtos/page.tsx sem mudança de comportamento).

export type Variacao = {
  nome: string;
  codigo: string;
  precoVenda: string;
  fatorFicha: string;
  tamanho: string;
  cor: string;
};

export type Combo = { componenteProdutoId: string; quantidade: string };

export const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const selectCls =
  'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

export const SELOS = [
  { v: 'mais_pedido', l: '🔥 Mais pedido' },
  { v: 'novo', l: '✨ Novo' },
  { v: 'veg', l: '🌱 Veg' },
  { v: 'sem_gluten', l: '🌾 S/ glúten' },
  { v: 'sem_lactose', l: '🥛 S/ lactose' },
  { v: 'picante', l: '🌶️ Picante' },
  { v: 'promocao', l: '🏷️ Promoção' },
];

export const vazio = () => ({
  codigo: '',
  nome: '',
  descricao: '',
  categoriaId: '',
  fichaId: '',
  tipo: 'simples',
  unidadeMedida: 'un',
  precoVenda: '',
  precoCusto: '',
  controlaEstoque: true,
  validadeDias: '',
  vaiParaProducao: true,
  setorProducaoId: '',
  tempoPreparoMin: '',
  imagemRef: '',
  precoPromocional: '',
  disponivelCardapio: true,
  disponivelBalcao: true,
  destaque: false,
  selos: [] as string[],
  sugestoes: [] as string[],
  duracaoMin: '',
  vendaMultiplo: '',
  ncm: '',
  cfop: '',
  origem: '0',
  csosn: '102',
  cstIcms: '',
  gtin: '',
  cstPis: '',
  aliqPis: '',
  cstCofins: '',
  aliqCofins: '',
  variacoes: [] as Variacao[],
  combo: [] as Combo[],
});
