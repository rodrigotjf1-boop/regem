// Pacotes por ramo — semeiam a estrutura operacional de uma unidade.
// Snapshot instanciado na config do tenant (editável depois).

export type RamoTemplate = {
  setores: {
    nome: string;
    icone: string;
    funcoes: { nome: string; categoria: string; sigla: string }[];
  }[];
  tipos: { nome: string; sinal: string; pontos: number }[];
  itens: { nome: string; unidadeMedida: string; estoqueMinimo: number }[];
};

export const TEMPLATES: Record<string, RamoTemplate> = {
  food_service: {
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
};
