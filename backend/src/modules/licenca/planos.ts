// Catálogo de planos (G-6a). Preços em BRL/mês — placeholders, ajuste à vontade
// (a distribuição define). semestral/anual são o valor MENSAL já com desconto.
// Quando o gateway (Asaas) entrar na G-6b, cada plano/ciclo vira um preço lá.
export interface PlanoCatalogo {
  chave: string;
  nome: string;
  desc: string;
  modulos: string[];
  mensal: number;
  semestral: number; // por mês, cobrado 6 em 6
  anual: number; // por mês, cobrado 12 em 12
  destaque?: boolean;
}

export const PLANOS: PlanoCatalogo[] = [
  {
    chave: 'balcao',
    nome: 'Balcão',
    desc: 'Para lanchonete e food truck',
    modulos: ['Pedidos', 'Estoque', 'Fichas técnicas', 'Documentos'],
    mensal: 129,
    semestral: 116,
    anual: 103,
  },
  {
    chave: 'salao',
    nome: 'Salão',
    desc: 'Restaurante com cozinha e equipe',
    modulos: ['Tudo do Balcão', 'KDS', 'Ponto', 'App do colaborador'],
    mensal: 199,
    semestral: 179,
    anual: 159,
    destaque: true,
  },
  {
    chave: 'completo',
    nome: 'Completo',
    desc: 'Delivery e marketing no automático',
    modulos: ['Tudo do Salão', 'Integrações (iFood/marketplaces)', 'Bot WhatsApp', 'Fidelidade', 'Cashback'],
    mensal: 299,
    semestral: 269,
    anual: 239,
  },
];
