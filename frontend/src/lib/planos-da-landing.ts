// Os planos que a landing pública mostra (`app/page.tsx`). A FONTE é o catálogo do servidor —
// `backend/src/modules/licenca/planos.ts`, o mesmo da página de assinatura —, que a landing não pode ler: a rota
// `/planos` pede login. O `npm run check:landing` confere que esta lista é a mesma de lá (nome, descrição, módulos,
// preço mensal e destaque): mudou um, muda o outro. Decisão do dono (12/11/2026): a landing mostra os preços da tabela
// do app, nunca outros.
export type PlanoDaLanding = {
  chave: string;
  nome: string;
  desc: string;
  modulos: string[];
  mensal: number;
  destaque?: boolean;
};

export const PLANOS_DA_LANDING: PlanoDaLanding[] = [
  {
    chave: 'balcao',
    nome: 'Balcão',
    desc: 'Para lanchonete e food truck',
    modulos: ['Pedidos', 'Estoque', 'Fichas técnicas', 'Documentos'],
    mensal: 129,
  },
  {
    chave: 'salao',
    nome: 'Salão',
    desc: 'Restaurante com cozinha e equipe',
    modulos: ['Tudo do Balcão', 'KDS', 'Ponto', 'App do colaborador'],
    mensal: 199,
    destaque: true,
  },
  {
    chave: 'completo',
    nome: 'Completo',
    desc: 'Delivery e marketing no automático',
    modulos: ['Tudo do Salão', 'Integrações (iFood/marketplaces)', 'Bot WhatsApp', 'Fidelidade', 'Cashback'],
    mensal: 299,
  },
];
