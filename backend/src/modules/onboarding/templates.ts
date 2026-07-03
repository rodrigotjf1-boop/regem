// Pacotes por ramo — semeiam a estrutura operacional de uma unidade.
// Snapshot instanciado na config do tenant (editável depois).

export type RamoTemplate = {
  label: string; // rótulo exibido no card do wizard
  emoji: string;
  setores: {
    nome: string;
    icone: string;
    funcoes: { nome: string; categoria: string; sigla: string }[];
  }[];
  tipos: { nome: string; sinal: string; pontos: number }[];
  itens: { nome: string; unidadeMedida: string; estoqueMinimo: number }[];
};

// Modelos de escala oferecidos no passo 4 (informativos — o usuário marca os que usa).
export const ESCALAS = ['6x1', '5x2', '12x36', '4x3', 'Horistas', 'Diaristas', 'PJ', 'Autônomos'];

export const TEMPLATES: Record<string, RamoTemplate> = {
  food_service: {
    label: 'Restaurante / Food Service',
    emoji: '🍽️',
    setores: [
      {
        nome: 'Cozinha',
        icone: 'cozinha',
        funcoes: [
          { nome: 'Chef Executivo', categoria: 'supervisao', sigla: 'CHEF' },
          { nome: 'Sous-chef', categoria: 'supervisao', sigla: 'SOUS' },
          { nome: 'Cozinheiro', categoria: 'execucao', sigla: 'COZ' },
          { nome: 'Auxiliar de Cozinha', categoria: 'execucao', sigla: 'AUXC' },
          { nome: 'Copeiro', categoria: 'execucao', sigla: 'COP' },
        ],
      },
      {
        nome: 'Salão',
        icone: 'salao',
        funcoes: [
          { nome: 'Maître', categoria: 'supervisao', sigla: 'MAIT' },
          { nome: 'Recepcionista', categoria: 'execucao', sigla: 'RECP' },
          { nome: 'Garçom', categoria: 'execucao', sigla: 'GAR' },
          { nome: 'Commis', categoria: 'execucao', sigla: 'AUXG' },
        ],
      },
      {
        nome: 'Bar',
        icone: 'bar',
        funcoes: [
          { nome: 'Chefe de Bar', categoria: 'supervisao', sigla: 'CHB' },
          { nome: 'Bartender', categoria: 'execucao', sigla: 'BTND' },
          { nome: 'Auxiliar de Bar', categoria: 'execucao', sigla: 'AUXB' },
        ],
      },
    ],
    tipos: [
      { nome: 'Boa ação', sinal: 'positiva', pontos: 10 },
      { nome: 'Elogio de cliente', sinal: 'positiva', pontos: 15 },
      { nome: 'Atraso', sinal: 'negativa', pontos: 5 },
      { nome: 'Erro de padrão', sinal: 'negativa', pontos: 10 },
    ],
    itens: [
      { nome: 'Tomate', unidadeMedida: 'kg', estoqueMinimo: 5 },
      { nome: 'Óleo', unidadeMedida: 'L', estoqueMinimo: 3 },
      { nome: 'Farinha', unidadeMedida: 'kg', estoqueMinimo: 10 },
    ],
  },

  varejo: {
    label: 'Varejo',
    emoji: '🛍️',
    setores: [
      {
        nome: 'Vendas',
        icone: 'vendas',
        funcoes: [
          { nome: 'Fiscal de Loja', categoria: 'supervisao', sigla: 'FISC' },
          { nome: 'Vendedor', categoria: 'execucao', sigla: 'VEND' },
        ],
      },
      {
        nome: 'Caixa',
        icone: 'caixa',
        funcoes: [{ nome: 'Operador de Caixa', categoria: 'execucao', sigla: 'CAIX' }],
      },
      {
        nome: 'Estoque',
        icone: 'estoque',
        funcoes: [{ nome: 'Estoquista', categoria: 'execucao', sigla: 'ESTQ' }],
      },
      {
        nome: 'Reposição',
        icone: 'reposicao',
        funcoes: [{ nome: 'Repositor', categoria: 'execucao', sigla: 'REPO' }],
      },
    ],
    tipos: [],
    itens: [],
  },

  industria_leve: {
    label: 'Indústria leve',
    emoji: '🏭',
    setores: [
      {
        nome: 'Produção',
        icone: 'producao',
        funcoes: [
          { nome: 'Líder de Linha', categoria: 'supervisao', sigla: 'LIDL' },
          { nome: 'Operador de Produção', categoria: 'execucao', sigla: 'OPRD' },
        ],
      },
      {
        nome: 'Qualidade',
        icone: 'qualidade',
        funcoes: [{ nome: 'Inspetor de Qualidade', categoria: 'execucao', sigla: 'INSQ' }],
      },
      {
        nome: 'Expedição',
        icone: 'expedicao',
        funcoes: [{ nome: 'Conferente', categoria: 'execucao', sigla: 'CONF' }],
      },
      {
        nome: 'Almoxarifado',
        icone: 'almoxarifado',
        funcoes: [{ nome: 'Almoxarife', categoria: 'execucao', sigla: 'ALMX' }],
      },
    ],
    tipos: [],
    itens: [],
  },

  servicos: {
    label: 'Serviços',
    emoji: '🧰',
    setores: [
      {
        nome: 'Atendimento',
        icone: 'atendimento',
        funcoes: [
          { nome: 'Coordenador', categoria: 'supervisao', sigla: 'COOR' },
          { nome: 'Atendente', categoria: 'execucao', sigla: 'ATEN' },
        ],
      },
      {
        nome: 'Operação em Campo',
        icone: 'campo',
        funcoes: [{ nome: 'Técnico de Campo', categoria: 'execucao', sigla: 'TECC' }],
      },
      {
        nome: 'Administrativo',
        icone: 'admin',
        funcoes: [{ nome: 'Auxiliar Administrativo', categoria: 'execucao', sigla: 'AUXA' }],
      },
    ],
    tipos: [],
    itens: [],
  },
};
