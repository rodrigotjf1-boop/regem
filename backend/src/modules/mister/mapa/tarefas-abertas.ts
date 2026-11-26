// AS TAREFAS QUE O MISTER FAZ PELO MAPA (versão 10, fase C4 — "fazer qualquer tarefa", aberta POR ÁREA; `docs/plano-mister.md`
// § "C4a"). Cada linha é uma função de escrita do mapa (`botao` ou `pin`), escolhida e revisada uma a uma, com os CAMPOS que a IA
// pode mandar — o contrato da API descreve o corpo de poucas rotas, e o que não está aqui não vai no corpo. A conferência do
// pedido (`mister-tarefas.ts`) exige o tipo certo, os obrigatórios e nenhum campo a mais; o campo `loja` o Regem preenche com a
// loja da conversa (nunca a IA).
//
// C4a (26/11/2026): os pedidos de manutenção, os cadastros simples e o alerta do estoque — nenhuma exclusão, nada de dinheiro,
// nota, ficha técnica, pessoa ou canal. As 43 ações prontas (`propor_acao`) continuam primeiro: têm conferências próprias.

export type TipoDoCampo = 'texto' | 'inteiro' | 'data' | 'hora' | 'id' | 'opcao' | 'loja';

export interface CampoDaTarefa {
  /** O nome no corpo da rota. */
  nome: string;
  tipo: TipoDoCampo;
  /** Como aparece no "Vou fazer" e na descrição à IA. */
  rotulo: string;
  obrigatorio?: boolean;
  /** `opcao`: os valores aceitos (e o rótulo de cada um, para o "Vou fazer"). */
  opcoes?: Readonly<Record<string, string>>;
  /** `inteiro`: o mínimo e o máximo. */
  min?: number;
  max?: number;
  /** `texto`: o tamanho máximo (padrão 300). */
  maxLetras?: number;
}

export interface TarefaAberta {
  /** A rota, como no mapa ("POST /api/v1/manutencao"). */
  rota: string;
  campos: readonly CampoDaTarefa[];
}

const PRIORIDADES = { baixa: 'baixa', normal: 'normal', alta: 'alta', critica: 'crítica' } as const;
const SITUACOES_DA_MANUTENCAO = { aberto: 'aberto', em_andamento: 'em andamento', concluido_parcial: 'concluído em parte', concluido: 'concluído', cancelado: 'cancelado' } as const;
const TIPOS_DE_DIA = { feriado: 'feriado', ferias: 'férias', evento: 'evento', folga: 'folga', outro: 'outro' } as const;

export const TAREFAS_ABERTAS: readonly TarefaAberta[] = [
  {
    rota: 'POST /api/v1/manutencao',
    campos: [
      { nome: 'titulo', tipo: 'texto', rotulo: 'O que está com defeito', obrigatorio: true, maxLetras: 120 },
      { nome: 'descricao', tipo: 'texto', rotulo: 'Detalhes', maxLetras: 500 },
      { nome: 'prioridade', tipo: 'opcao', rotulo: 'Prioridade', opcoes: PRIORIDADES },
    ],
  },
  {
    rota: 'POST /api/v1/manutencao/{id}/status',
    campos: [
      { nome: 'status', tipo: 'opcao', rotulo: 'Situação nova', obrigatorio: true, opcoes: SITUACOES_DA_MANUTENCAO },
      { nome: 'motivo', tipo: 'texto', rotulo: 'Motivo', maxLetras: 300 },
    ],
  },
  {
    rota: 'POST /api/v1/setores',
    campos: [
      { nome: 'unidadeId', tipo: 'loja', rotulo: 'Loja', obrigatorio: true },
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome do setor', obrigatorio: true, maxLetras: 60 },
    ],
  },
  {
    rota: 'POST /api/v1/turnos',
    campos: [
      { nome: 'unidadeId', tipo: 'loja', rotulo: 'Loja', obrigatorio: true },
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome do turno', obrigatorio: true, maxLetras: 60 },
      { nome: 'horaInicio', tipo: 'hora', rotulo: 'Começa', obrigatorio: true },
      { nome: 'horaFim', tipo: 'hora', rotulo: 'Termina', obrigatorio: true },
      { nome: 'setorId', tipo: 'id', rotulo: 'Setor' },
    ],
  },
  {
    rota: 'POST /api/v1/dias-especiais',
    campos: [
      { nome: 'unidadeId', tipo: 'loja', rotulo: 'Loja' },
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome', obrigatorio: true, maxLetras: 80 },
      { nome: 'data', tipo: 'data', rotulo: 'Data', obrigatorio: true },
      { nome: 'dataFim', tipo: 'data', rotulo: 'Até' },
      { nome: 'tipo', tipo: 'opcao', rotulo: 'Tipo', opcoes: TIPOS_DE_DIA },
      { nome: 'descricao', tipo: 'texto', rotulo: 'Detalhes', maxLetras: 300 },
    ],
  },
  {
    rota: 'POST /api/v1/janelas-pico',
    campos: [
      { nome: 'unidadeId', tipo: 'loja', rotulo: 'Loja', obrigatorio: true },
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome', obrigatorio: true, maxLetras: 60 },
      { nome: 'diaSemana', tipo: 'inteiro', rotulo: 'Dia da semana (0 = domingo)', min: 0, max: 6 },
      { nome: 'diaSemanaFim', tipo: 'inteiro', rotulo: 'Até o dia da semana', min: 0, max: 6 },
      { nome: 'horaInicio', tipo: 'hora', rotulo: 'Começa', obrigatorio: true },
      { nome: 'horaFim', tipo: 'hora', rotulo: 'Termina', obrigatorio: true },
    ],
  },
  {
    rota: 'POST /api/v1/estoque/categorias-item',
    campos: [{ nome: 'nome', tipo: 'texto', rotulo: 'Nome da categoria', obrigatorio: true, maxLetras: 60 }],
  },
  {
    rota: 'POST /api/v1/estoque/alertas/{id}/resolver',
    campos: [],
  },
];

/** A tarefa aberta da rota pedida, ou undefined. */
export const tarefaAberta = (rota: unknown): TarefaAberta | undefined => (typeof rota === 'string' ? TAREFAS_ABERTAS.find((t) => t.rota === rota.trim()) : undefined);
