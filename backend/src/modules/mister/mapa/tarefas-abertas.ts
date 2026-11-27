// AS TAREFAS QUE O MISTER FAZ PELO MAPA (versão 10, fase C4 — "fazer qualquer tarefa", aberta POR ÁREA; `docs/plano-mister.md`
// § "C4a"). Cada linha é uma função de escrita do mapa (`botao` ou `pin`), escolhida e revisada uma a uma, com os CAMPOS que a IA
// pode mandar — o contrato da API descreve o corpo de poucas rotas, e o que não está aqui não vai no corpo. A conferência do
// pedido (`mister-tarefas.ts`) exige o tipo certo, os obrigatórios e nenhum campo a mais; o campo `loja` o Regem preenche com a
// loja da conversa (nunca a IA).
//
// C4a (26/11/2026): os pedidos de manutenção, os cadastros simples e o alerta do estoque — nenhuma exclusão, nada de dinheiro,
// nota, ficha técnica, pessoa ou canal. As 43 ações prontas (`propor_acao`) continuam primeiro: têm conferências próprias.

// C4 Onda 1 (27/11/2026): a rotina da loja — estoque, pedidos de compra, recebimento, fornecedores, fichas técnicas, contagem,
// tarefas, checklists, manutenção, desperdício, ocorrências, vistorias, calendário, dias especiais, picos, setores, turnos e
// funções. Entram a EXCLUSÃO (`DELETE`, corpo `{}`), o número com casas, o sim/não e a LISTA de itens (cada item com os seus
// campos, conferidos como os de fora). A marca do mapa diz se confirma com o botão ou com o PIN.

import { UNIDADES_ESTOQUE } from '../../estoque/unidades';

export type TipoDoCampo = 'texto' | 'inteiro' | 'numero' | 'booleano' | 'data' | 'hora' | 'id' | 'ids' | 'opcao' | 'lista' | 'loja';

export interface CampoDaTarefa {
  /** O nome no corpo da rota. */
  nome: string;
  tipo: TipoDoCampo;
  /** Como aparece no "Vou fazer" e na descrição à IA. */
  rotulo: string;
  obrigatorio?: boolean;
  /** `opcao`: os valores aceitos (e o rótulo de cada um, para o "Vou fazer"). */
  opcoes?: Readonly<Record<string, string>>;
  /** `inteiro` e `numero`: o mínimo e o máximo. */
  min?: number;
  max?: number;
  /** `texto`: o tamanho máximo (padrão 300). */
  maxLetras?: number;
  /** `lista`: os campos de cada item (sem `lista` dentro de `lista` nem `loja`). */
  itens?: readonly CampoDaTarefa[];
  /** `lista` e `ids`: quantos itens no máximo (padrão 50). */
  maxItens?: number;
}

export interface TarefaAberta {
  /** A rota, como no mapa ("POST /api/v1/manutencao"). */
  rota: string;
  campos: readonly CampoDaTarefa[];
}

const PRIORIDADES = { baixa: 'baixa', normal: 'normal', alta: 'alta', critica: 'crítica' } as const;
const SITUACOES_DA_MANUTENCAO = { aberto: 'aberto', em_andamento: 'em andamento', concluido_parcial: 'concluído em parte', concluido: 'concluído', cancelado: 'cancelado' } as const;
const TIPOS_DE_DIA = { feriado: 'feriado', ferias: 'férias', evento: 'evento', folga: 'folga', outro: 'outro' } as const;

// C4 Onda 1: as opções de cada rota, como os DTOs as aceitam (nomes exatos).
/** A lista fechada de unidades do estoque (`estoque/unidades.ts`): a mesma que o serviço confere. */
const UNIDADES: Readonly<Record<string, string>> = Object.fromEntries(UNIDADES_ESTOQUE.map((u) => [u, u]));
const DIVERGENCIAS = { ok: 'veio certo', parcial: 'veio em parte', nao_veio: 'não veio', danificado: 'veio danificado', excedente: 'veio a mais' } as const;
const RECORRENCIAS_DA_CONTAGEM = { diaria: 'todo dia', semanal: 'toda semana', mensal: 'todo mês', avulsa: 'só uma vez' } as const;
const DECISOES_DA_MANUTENCAO = { manter: 'manter aberto', concluir: 'concluir', excluir: 'descartar' } as const;
const MOTIVOS_DO_DESPERDICIO = { Validade: 'validade', Preparo: 'preparo', Queda: 'queda', Transporte: 'transporte', Cancelamento: 'cancelamento', Outro: 'outro' } as const;
const SINAIS_DA_OCORRENCIA = { positiva: 'a favor', negativa: 'contra' } as const;
const TIPOS_DE_VISTORIA = { abertura: 'abertura', fechamento: 'fechamento', padrao: 'padrão' } as const;
const TIPOS_DE_EVENTO = { show: 'show', promocao: 'promoção', feriado_municipal: 'feriado municipal', jogo_time: 'jogo do time', outro: 'outro' } as const;
const REPETE_O_EVENTO = { nao: 'não repete', semana: 'toda semana', ano: 'todo ano' } as const;
const NIVEIS_DA_FUNCAO = { presidente: 'presidente', gerente: 'gerente', supervisao: 'supervisão', execucao: 'execução' } as const;
/** Um ingrediente da ficha (`CreateIngredienteDto`), sem a ordem. */
const INGREDIENTE: readonly CampoDaTarefa[] = [
  { nome: 'insumoNome', tipo: 'texto', rotulo: 'Ingrediente', obrigatorio: true, maxLetras: 120 },
  { nome: 'quantidade', tipo: 'numero', rotulo: 'Quantidade', min: 0, max: 100000 },
  { nome: 'unidade', tipo: 'opcao', rotulo: 'Unidade', opcoes: UNIDADES },
  { nome: 'fatorCorrecao', tipo: 'numero', rotulo: 'Fator de correção', min: 0.01, max: 100 },
  { nome: 'custoUnitario', tipo: 'numero', rotulo: 'Custo de cada', min: 0, max: 1000000 },
  { nome: 'itemId', tipo: 'id', rotulo: 'Insumo do estoque' },
  { nome: 'subFichaId', tipo: 'id', rotulo: 'Ficha usada dentro' },
  { nome: 'somenteDelivery', tipo: 'booleano', rotulo: 'Só no delivery' },
  { nome: 'somenteBalcao', tipo: 'booleano', rotulo: 'Só no balcão' },
];

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
      { nome: 'pausaInicio', tipo: 'hora', rotulo: 'Pausa começa' },
      { nome: 'pausaFim', tipo: 'hora', rotulo: 'Pausa termina' },
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

  // ───────────── C4 Onda 1 (27/11/2026): a rotina da loja ─────────────
  // Fora desta onda, de propósito: o que já tem AÇÃO PRONTA com conferência própria (cadastrar e mudar insumo e fornecedor,
  // movimentar e contar o estoque, o pedido de compra pela lista, marcar enviado, informar validade, excluir pedido de compra,
  // criar e concluir tarefa); as alterações que ZERAM o que não vem (a tela manda o formulário inteiro: lista de contagem, dia
  // especial, função, pico, turno, evento do calendário, tarefa do dia); o que pede um colaborador (ocorrência, delegar
  // manutenção, o responsável da tarefa — dado de pessoa não vai à IA, V10-4); o "submeter checklist" (só a supervisão); e
  // os campos de FOTO (o Mister não manda foto por estas rotas).

  // Estoque
  { rota: 'DELETE /api/v1/estoque/categorias-item/{id}', campos: [] },
  // PIN (a revisão da C4): apaga o insumo do cadastro — a rota recusa com saldo, ficha ou cardápio.
  { rota: 'DELETE /api/v1/estoque/itens/{id}', campos: [] },

  // Pedidos de compra e recebimento
  {
    rota: 'POST /api/v1/compras/listas/{id}/faltante',
    campos: [{ nome: 'dataRecebimento', tipo: 'data', rotulo: 'Para quando' }],
  },
  {
    rota: 'POST /api/v1/compras/listas/{id}/receber',
    campos: [
      { nome: 'notaRef', tipo: 'texto', rotulo: 'Número da nota', maxLetras: 60 },
      { nome: 'vencimento', tipo: 'data', rotulo: 'Vencimento da conta' },
      {
        nome: 'itens',
        tipo: 'lista',
        rotulo: 'O que chegou',
        obrigatorio: true,
        maxItens: 80,
        itens: [
          { nome: 'compraItemId', tipo: 'id', rotulo: 'Item do pedido', obrigatorio: true },
          { nome: 'qtdRecebida', tipo: 'numero', rotulo: 'Quanto chegou (na unidade do pedido; 0 = não veio)', obrigatorio: true, min: 0, max: 100000 },
          { nome: 'custoUnitario', tipo: 'numero', rotulo: 'Custo de cada', min: 0, max: 1000000 },
          { nome: 'validade', tipo: 'data', rotulo: 'Validade' },
          { nome: 'validadeIndefinida', tipo: 'booleano', rotulo: 'Sem validade' },
          { nome: 'validadePendente', tipo: 'booleano', rotulo: 'Validade a informar depois' },
          { nome: 'divergencia', tipo: 'opcao', rotulo: 'Como veio', opcoes: DIVERGENCIAS },
        ],
      },
    ],
  },
  { rota: 'POST /api/v1/recebimentos/{id}/confirmar', campos: [] },
  // PIN (a revisão da C4): apaga o fornecedor que tem notas e pedidos.
  { rota: 'DELETE /api/v1/fornecedores/{id}', campos: [] },

  // Fichas técnicas
  {
    rota: 'POST /api/v1/fichas',
    campos: [
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome da ficha', obrigatorio: true, maxLetras: 120 },
      { nome: 'categoria', tipo: 'texto', rotulo: 'Categoria', maxLetras: 60 },
      { nome: 'rendimento', tipo: 'numero', rotulo: 'Rendimento', min: 0.0001, max: 100000 },
      { nome: 'rendimentoUnidade', tipo: 'opcao', rotulo: 'Unidade do rendimento', opcoes: UNIDADES },
      { nome: 'porcaoTamanho', tipo: 'numero', rotulo: 'Tamanho da porção', min: 0, max: 100000 },
      { nome: 'porcaoUnidade', tipo: 'opcao', rotulo: 'Unidade da porção', opcoes: UNIDADES },
      { nome: 'precoVenda', tipo: 'numero', rotulo: 'Preço de venda', min: 0, max: 100000 },
      { nome: 'metaCmv', tipo: 'numero', rotulo: 'Meta de CMV (%)', min: 0, max: 100 },
      { nome: 'margemPerda', tipo: 'numero', rotulo: 'Margem de perda (%)', min: 0, max: 100 },
      { nome: 'setorId', tipo: 'id', rotulo: 'Setor' },
      { nome: 'ingredientes', tipo: 'lista', rotulo: 'Ingredientes', maxItens: 60, itens: INGREDIENTE },
    ],
  },
  { rota: 'DELETE /api/v1/fichas/{id}', campos: [] },
  {
    // Só os campos simples: os ingredientes e as conversões, se viessem, trocariam a lista inteira (vão por "acrescentar
    // ingrediente" e "excluir ingrediente").
    rota: 'PATCH /api/v1/fichas/{id}',
    campos: [
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome da ficha', maxLetras: 120 },
      { nome: 'categoria', tipo: 'texto', rotulo: 'Categoria', maxLetras: 60 },
      { nome: 'rendimento', tipo: 'numero', rotulo: 'Rendimento', min: 0.0001, max: 100000 },
      { nome: 'rendimentoUnidade', tipo: 'opcao', rotulo: 'Unidade do rendimento', opcoes: UNIDADES },
      { nome: 'porcaoTamanho', tipo: 'numero', rotulo: 'Tamanho da porção', min: 0, max: 100000 },
      { nome: 'porcaoUnidade', tipo: 'opcao', rotulo: 'Unidade da porção', opcoes: UNIDADES },
      { nome: 'precoVenda', tipo: 'numero', rotulo: 'Preço de venda', min: 0, max: 100000 },
      { nome: 'metaCmv', tipo: 'numero', rotulo: 'Meta de CMV (%)', min: 0, max: 100 },
      { nome: 'margemPerda', tipo: 'numero', rotulo: 'Margem de perda (%)', min: 0, max: 100 },
      { nome: 'ativo', tipo: 'booleano', rotulo: 'Ativa' },
    ],
  },
  { rota: 'POST /api/v1/fichas/{id}/ingredientes', campos: INGREDIENTE },
  {
    // Vale para a empresa inteira: muda o custo e a baixa do estoque de todas as fichas.
    rota: 'POST /api/v1/fichas/embalagem',
    campos: [{ nome: 'mesmaEmbalagem', tipo: 'booleano', rotulo: 'A mesma embalagem no balcão e no delivery', obrigatorio: true }],
  },
  { rota: 'DELETE /api/v1/fichas/ingredientes/{id}', campos: [] },

  // Contagem
  {
    rota: 'POST /api/v1/contagem/listas',
    campos: [
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome da lista', obrigatorio: true, maxLetras: 80 },
      { nome: 'recorrencia', tipo: 'opcao', rotulo: 'Repete', opcoes: RECORRENCIAS_DA_CONTAGEM },
      { nome: 'diaSemana', tipo: 'inteiro', rotulo: 'Dia da semana (0 = domingo)', min: 0, max: 6 },
      { nome: 'diaMes', tipo: 'inteiro', rotulo: 'Dia do mês', min: 1, max: 31 },
      { nome: 'hora', tipo: 'hora', rotulo: 'Hora' },
      { nome: 'enviarKds', tipo: 'booleano', rotulo: 'Avisar no KDS' },
      { nome: 'enviarDashboard', tipo: 'booleano', rotulo: 'Avisar no painel' },
      { nome: 'itemIds', tipo: 'ids', rotulo: 'Insumos', obrigatorio: true, maxItens: 200 },
    ],
  },
  { rota: 'DELETE /api/v1/contagem/listas/{id}', campos: [] },
  { rota: 'POST /api/v1/contagem/listas/{id}/iniciar', campos: [] },

  // Tarefas do dia e checklists
  {
    rota: 'DELETE /api/v1/tarefas-instancias/{id}',
    campos: [{ nome: 'motivo', tipo: 'texto', rotulo: 'Motivo', obrigatorio: true, maxLetras: 300 }],
  },
  {
    // Sem o responsável (dado de pessoa): a tarefa nasce "em aberto" e a escala resolve quem faz.
    rota: 'POST /api/v1/tarefas-instancias/instanciar',
    campos: [
      { nome: 'tarefaDefId', tipo: 'id', rotulo: 'Tarefa', obrigatorio: true },
      { nome: 'data', tipo: 'data', rotulo: 'Dia', obrigatorio: true },
    ],
  },
  {
    rota: 'POST /api/v1/checklists',
    campos: [
      { nome: 'unidadeId', tipo: 'loja', rotulo: 'Loja', obrigatorio: true },
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome do checklist', obrigatorio: true, maxLetras: 120 },
      { nome: 'setorId', tipo: 'id', rotulo: 'Setor' },
    ],
  },
  {
    rota: 'POST /api/v1/checklists/{id}/itens',
    campos: [
      { nome: 'descricao', tipo: 'texto', rotulo: 'O que conferir', obrigatorio: true, maxLetras: 300 },
      { nome: 'procedimento', tipo: 'texto', rotulo: 'Como fazer', maxLetras: 1000 },
      { nome: 'ordem', tipo: 'inteiro', rotulo: 'Ordem', min: 0, max: 1000 },
    ],
  },
  { rota: 'POST /api/v1/checklists/{id}/publicar', campos: [] },
  { rota: 'DELETE /api/v1/checklists/itens/{itemId}', campos: [] },

  // Manutenção, desperdício, ocorrência e vistoria
  {
    rota: 'POST /api/v1/manutencao/{id}/decisao-15d',
    campos: [{ nome: 'decisao', tipo: 'opcao', rotulo: 'Decisão', obrigatorio: true, opcoes: DECISOES_DA_MANUTENCAO }],
  },
  {
    rota: 'POST /api/v1/manutencao/{id}/excluir',
    campos: [{ nome: 'motivo', tipo: 'texto', rotulo: 'Motivo', obrigatorio: true, maxLetras: 300 }],
  },
  {
    rota: 'POST /api/v1/desperdicios',
    campos: [
      { nome: 'unidadeId', tipo: 'loja', rotulo: 'Loja' },
      { nome: 'descricao', tipo: 'texto', rotulo: 'O que foi perdido', obrigatorio: true, maxLetras: 200 },
      { nome: 'itemId', tipo: 'id', rotulo: 'Insumo' },
      { nome: 'quantidade', tipo: 'numero', rotulo: 'Quantidade', min: 0.0001, max: 100000 },
      { nome: 'unidadeMedida', tipo: 'opcao', rotulo: 'Unidade', opcoes: UNIDADES },
      { nome: 'motivo', tipo: 'opcao', rotulo: 'Motivo', opcoes: MOTIVOS_DO_DESPERDICIO },
      { nome: 'setorId', tipo: 'id', rotulo: 'Setor' },
      { nome: 'data', tipo: 'data', rotulo: 'Dia' },
    ],
  },
  {
    rota: 'POST /api/v1/tipos-ocorrencia',
    campos: [
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome do tipo', obrigatorio: true, maxLetras: 80 },
      { nome: 'sinal', tipo: 'opcao', rotulo: 'Conta a favor ou contra', obrigatorio: true, opcoes: SINAIS_DA_OCORRENCIA },
      { nome: 'pontos', tipo: 'inteiro', rotulo: 'Pontos', min: 0, max: 1000 },
    ],
  },
  {
    rota: 'POST /api/v1/vistorias',
    campos: [
      { nome: 'unidadeId', tipo: 'loja', rotulo: 'Loja' },
      { nome: 'tipo', tipo: 'opcao', rotulo: 'Tipo', obrigatorio: true, opcoes: TIPOS_DE_VISTORIA },
      { nome: 'setorId', tipo: 'id', rotulo: 'Setor' },
      { nome: 'observacao', tipo: 'texto', rotulo: 'Observação', maxLetras: 500 },
      { nome: 'data', tipo: 'data', rotulo: 'Dia' },
    ],
  },

  // Calendário da loja, dias especiais, picos, setores, turnos e funções
  {
    rota: 'POST /api/v1/calendario-da-loja/eventos',
    campos: [
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome do evento', obrigatorio: true, maxLetras: 80 },
      { nome: 'tipo', tipo: 'opcao', rotulo: 'Tipo', obrigatorio: true, opcoes: TIPOS_DE_EVENTO },
      { nome: 'dia', tipo: 'data', rotulo: 'Dia', obrigatorio: true },
      { nome: 'hora', tipo: 'hora', rotulo: 'Hora' },
      { nome: 'repete', tipo: 'opcao', rotulo: 'Repete', opcoes: REPETE_O_EVENTO },
    ],
  },
  { rota: 'DELETE /api/v1/calendario-da-loja/eventos/{id}', campos: [] },
  { rota: 'DELETE /api/v1/dias-especiais/{id}', campos: [] },
  { rota: 'DELETE /api/v1/janelas-pico/{id}', campos: [] },
  { rota: 'DELETE /api/v1/setores/{id}', campos: [] },
  {
    // A rota grava só o que vier: o nome muda, o resto fica.
    rota: 'PATCH /api/v1/setores/{id}',
    campos: [{ nome: 'nome', tipo: 'texto', rotulo: 'Nome do setor', obrigatorio: true, maxLetras: 60 }],
  },
  { rota: 'DELETE /api/v1/turnos/{id}', campos: [] },
  {
    rota: 'POST /api/v1/funcoes',
    campos: [
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome da função', obrigatorio: true, maxLetras: 60 },
      { nome: 'categoria', tipo: 'opcao', rotulo: 'Nível de acesso', opcoes: NIVEIS_DA_FUNCAO },
      { nome: 'setorId', tipo: 'id', rotulo: 'Setor' },
      { nome: 'sigla', tipo: 'texto', rotulo: 'Sigla', maxLetras: 6 },
      { nome: 'gerarEtiqueta', tipo: 'booleano', rotulo: 'Imprime etiqueta' },
    ],
  },
  { rota: 'DELETE /api/v1/funcoes/{id}', campos: [] },
];

/** A tarefa aberta da rota pedida, ou undefined. */
export const tarefaAberta = (rota: unknown): TarefaAberta | undefined => (typeof rota === 'string' ? TAREFAS_ABERTAS.find((t) => t.rota === rota.trim()) : undefined);
