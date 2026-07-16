// Constantes + tipos da tela de Cadastros (extraídos de app/cadastros/page.tsx).

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Lists = {
  unidades: any[];
  setores: any[];
  funcoes: any[];
  colaboradores: any[];
  turnos: any[];
  etiquetas: any[];
  janelasPico: any[];
  fornecedores: any[];
  diasEspeciais: any[];
};

export const CATEGORIAS = [
  { value: 'execucao', label: 'Execução' },
  { value: 'supervisao', label: 'Supervisão' },
  { value: 'gerente', label: 'Gerente' },
  { value: 'presidente', label: 'Presidente' },
];

export const VINCULOS = [
  { value: 'clt', label: 'CLT' },
  { value: 'diarista', label: 'Diarista' },
  { value: 'horista', label: 'Horista' },
  { value: 'pj', label: 'Prestador de serviço' },
  { value: 'autonomo', label: 'Autônomo' },
];

// Tipo de escala/jornada do colaborador (regras CLT na montagem da escala).
export const JORNADAS = [
  { value: 'outro', label: 'Outro / não definido' },
  { value: '5x2', label: '5x2 (5 dias, 2 folgas)' },
  { value: '6x1', label: '6x1 (6 dias, 1 folga)' },
  { value: '5x1', label: '5x1 (5 dias, 1 folga)' },
  { value: '12x36', label: '12x36 (12h, folga 36h)' },
  { value: '4x3', label: '4x3 (4 dias, 3 folgas)' },
  { value: 'horista', label: 'Horista' },
];

export const DIAS_SEMANA = [
  { value: '', label: 'Todos os dias' },
  { value: '0', label: 'Domingo' },
  { value: '1', label: 'Segunda' },
  { value: '2', label: 'Terça' },
  { value: '3', label: 'Quarta' },
  { value: '4', label: 'Quinta' },
  { value: '5', label: 'Sexta' },
  { value: '6', label: 'Sábado' },
];

export const DIA_ABREV: Record<string, string> = {
  '0': 'dom',
  '1': 'seg',
  '2': 'ter',
  '3': 'qua',
  '4': 'qui',
  '5': 'sex',
  '6': 'sáb',
};

// Metadados visuais por seção (passo na ordem de dependência + ícone + dica de vazio).
export const META: Record<string, { step: number; icon: string; nudge?: string }> = {
  unidade: { step: 1, icon: '🏪' },
  setor: { step: 2, icon: '🧩' },
  funcao: { step: 3, icon: '🎯' },
  colaborador: { step: 4, icon: '👥' },
  turno: { step: 5, icon: '🕐' },
  pico: {
    step: 6,
    icon: '🔥',
    nudge:
      'Cadastre os horários de pico (ex.: almoço 11:30–14:30) para o KDS disparar alertas e a escala de limpeza sugerir as janelas certas.',
  },
  fornecedor: {
    step: 7,
    icon: '📦',
    nudge:
      'Com fornecedores cadastrados, cada recebimento alimenta o histórico de preços e o índice de faltas automaticamente.',
  },
  etiqueta: { step: 8, icon: '🏷️' },
};
