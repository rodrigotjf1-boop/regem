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
//
// C4 Onda 2 (27/11/2026): delivery e cardápio — estender a pausa, o Pix prioritário, categorias, produtos (excluir com PIN,
// duplicar, vender sem saldo) e as opções reutilizáveis (pausa e preço por canal, preço na etapa, excluir, custo em massa).
//
// C4 Onda 3 (27/11/2026): cozinha e ponto — as ordens de produção (criar, liberar, iniciar, cancelar com PIN), limpar a fila
// da cozinha (PIN, só de uma loja) e o fechamento do ponto do mês (o tipo `mes`, AAAA-MM).
//
// C4 Onda 4 (27/11/2026): dinheiro e fiscal, tudo com PIN — cancelar e estornar a conta, ativar a forma de pagamento,
// transmitir a contingência fiscal e encerrar os planos de fidelidade e cashback.

import { UNIDADES_ESTOQUE } from '../../estoque/unidades';

export type TipoDoCampo = 'texto' | 'inteiro' | 'numero' | 'booleano' | 'data' | 'hora' | 'mes' | 'id' | 'ids' | 'opcao' | 'lista' | 'loja';

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
  /**
   * Rodada 7, MIS-D-06 (ERR-655): o rótulo na linha de um ITEM de lista no "Vou fazer" (que agora mostra todos): curto, para a
   * lista caber numa mensagem; vazio = só o valor ("Bacon · chegou: 2,5 · custo: 39,9"). Sem ele, vale o `rotulo`.
   */
  curto?: string;
}

export interface TarefaAberta {
  /** A rota, como no mapa ("POST /api/v1/manutencao"). */
  rota: string;
  campos: readonly CampoDaTarefa[];
  /**
   * Rodada 7, MIS-C-08 (ERR-650): `empresa` = vale para a empresa inteira, qualquer que seja a loja da conversa (o fechamento do
   * ponto, o Pix prioritário, a embalagem das fichas). O "Vou fazer" diz isso na empresa de mais de uma loja; as outras tarefas
   * mostram a loja em que valem.
   */
  alcance?: 'empresa';
}

const PRIORIDADES = { baixa: 'baixa', normal: 'normal', alta: 'alta', critica: 'crítica' } as const;
const SITUACOES_DA_MANUTENCAO = { aberto: 'aberto', em_andamento: 'em andamento', concluido_parcial: 'concluído em parte', concluido: 'concluído', cancelado: 'cancelado' } as const;
const TIPOS_DE_DIA = { feriado: 'feriado', ferias: 'férias', evento: 'evento', folga: 'folga', outro: 'outro' } as const;
// O dia especial do horário (H2b): os nomes exatos que `conferirDiaEspecial` aceita.
const COMO_A_LOJA_FICA = { fechada: 'fechada o dia todo', horario: 'outro horário', normal: 'horário normal (só confirma)' } as const;
const VALE_PARA = { todos: 'delivery e retirada', entrega: 'só o delivery', retirada: 'só a retirada' } as const;
function camposDoDiaEspecial(criar: boolean): readonly CampoDaTarefa[] {
  return [
    { nome: 'data', tipo: 'data', rotulo: 'Dia', obrigatorio: criar },
    { nome: 'dataFim', tipo: 'data', rotulo: 'Até (para um período)' },
    { nome: 'nome', tipo: 'texto', rotulo: 'Nome que o cliente vê', obrigatorio: criar, maxLetras: 40 },
    { nome: 'funcionamento', tipo: 'opcao', rotulo: 'Como a loja fica', obrigatorio: criar, opcoes: COMO_A_LOJA_FICA },
    { nome: 'abre', tipo: 'hora', rotulo: 'Abre às' },
    { nome: 'fecha', tipo: 'hora', rotulo: 'Fecha às' },
    { nome: 'conjunto', tipo: 'opcao', rotulo: 'Vale para', opcoes: VALE_PARA },
    { nome: 'avisoAntes', tipo: 'booleano', rotulo: 'Avisar no cardápio 3 dias antes' },
    { nome: 'feriadoChave', tipo: 'texto', rotulo: 'Feriado respondido (a chave da lista "sem resposta")', maxLetras: 80 },
  ];
}

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
// Rodada 7, MIS-C-03 (ERR-650): pela conversa, só a função de operação. A função de gestão (presidente, gerente) dá acesso a quem a
// receber: nasce pela tela.
const NIVEIS_DA_FUNCAO = { supervisao: 'supervisão', execucao: 'execução' } as const;
// C4 Onda 2: os valores que os serviços conferem (`common/pausa-do-canal.ts`, `produto/produto-canais.ts`, `setPixPrioritario`).
const CANAIS_DA_PAUSA = { cardapio: 'cardápio digital', ifood: 'iFood', food99: '99' } as const;
const GATEWAYS_DO_PIX = { mercadopago: 'Mercado Pago', pagseguro: 'PagBank', rede: 'Rede' } as const;
const CANAIS_DA_OPCAO = { regem: 'Regem', ifood: 'iFood', '99food': '99' } as const;
const APPS_DO_PRECO = { ifood: 'iFood', '99food': '99' } as const;
/** Um ingrediente da ficha (`CreateIngredienteDto`), sem a ordem. */
const INGREDIENTE: readonly CampoDaTarefa[] = [
  { nome: 'insumoNome', tipo: 'texto', rotulo: 'Ingrediente', obrigatorio: true, maxLetras: 120, curto: '' },
  { nome: 'quantidade', tipo: 'numero', rotulo: 'Quantidade', min: 0, max: 100000, curto: '' },
  { nome: 'unidade', tipo: 'opcao', rotulo: 'Unidade', opcoes: UNIDADES, curto: '' },
  { nome: 'fatorCorrecao', tipo: 'numero', rotulo: 'Fator de correção', min: 0.01, max: 100, curto: 'fator' },
  { nome: 'custoUnitario', tipo: 'numero', rotulo: 'Custo de cada', min: 0, max: 1000000, curto: 'custo' },
  { nome: 'itemId', tipo: 'id', rotulo: 'Insumo do estoque', curto: 'insumo' },
  { nome: 'subFichaId', tipo: 'id', rotulo: 'Ficha usada dentro', curto: 'ficha' },
  { nome: 'somenteDelivery', tipo: 'booleano', rotulo: 'Só no delivery', curto: 'só delivery' },
  { nome: 'somenteBalcao', tipo: 'booleano', rotulo: 'Só no balcão', curto: 'só balcão' },
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
  // O DIA ESPECIAL DO HORÁRIO DA LOJA (H2b dos dias especiais, mig 512; protótipo `regem-dias-especiais.html`, "No Mister" —
  // decisão 8: PIN no mapa, como mudar o horário da semana, porque fechar a loja tira venda). Diferente do de cima (o da
  // Escala). SEM o campo da loja: é o dia do cardápio da empresa, o mesmo que Delivery › Configurações › Horários grava e
  // lista. Mudar manda só o que muda (o serviço mantém o resto — V16). Os ids e as chaves dos feriados vêm das leituras
  // `GET cardapio/dias-especiais` e `.../sem-resposta`. A pausa do iFood e da 99 é da H3.
  { rota: 'POST /api/v1/cardapio/dias-especiais', campos: camposDoDiaEspecial(true) },
  { rota: 'PATCH /api/v1/cardapio/dias-especiais/{id}', campos: camposDoDiaEspecial(false) },
  { rota: 'DELETE /api/v1/cardapio/dias-especiais/{id}', campos: [] },
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
    // PIN no mapa (rodada 7, MIS-C-01): o recebimento cria a conta a pagar do fornecedor.
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
          { nome: 'compraItemId', tipo: 'id', rotulo: 'Item do pedido', obrigatorio: true, curto: '' },
          { nome: 'qtdRecebida', tipo: 'numero', rotulo: 'Quanto chegou (na unidade do pedido; 0 = não veio)', obrigatorio: true, min: 0, max: 100000, curto: 'chegou' },
          { nome: 'custoUnitario', tipo: 'numero', rotulo: 'Custo de cada', min: 0, max: 1000000, curto: 'custo' },
          { nome: 'validade', tipo: 'data', rotulo: 'Validade', curto: 'validade' },
          { nome: 'validadeIndefinida', tipo: 'booleano', rotulo: 'Sem validade', curto: 'sem validade' },
          { nome: 'validadePendente', tipo: 'booleano', rotulo: 'Validade a informar depois', curto: 'validade depois' },
          { nome: 'divergencia', tipo: 'opcao', rotulo: 'Como veio', opcoes: DIVERGENCIAS, curto: '' },
        ],
      },
    ],
  },
  // PIN no mapa (rodada 7, MIS-C-01): confirmar o recebimento cria a conta a pagar.
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
    alcance: 'empresa',
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
  // Os itens mudam só no checklist ainda não aprovado: o vigente (com o POP publicado) a rota recusa (rodada 7, MIS-C-07, ERR-650).
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

  // ───────────── C4 Onda 2 (27/11/2026): delivery e cardápio ─────────────
  // Fora desta onda, de propósito: o que já tem AÇÃO PRONTA (pausar e reabrir canal, aceitar, pronto e despachar pedido,
  // pausar e reativar produto, mudar o preço do produto, criar categoria e produto, promoção, mudar o produto); as mudanças de
  // situação do PEDIDO (o id só vem pela lista de pedidos, que tem dado de cliente — o caminho é a ação pronta pelo número); o
  // pedido manual (dado de cliente, V10-4); as rotas que TROCAM a lista inteira (faixas, direcionamento, os complementos do
  // produto, reordenar categorias); criar e editar complemento e opção (o código PDV, o estoque e a ligação andam juntos, V49);
  // a troca de códigos PDV em massa (V57); a configuração do delivery (formulário inteiro); a conferência com os apps.
  // Delivery
  {
    rota: 'POST /api/v1/delivery/pausas/estender',
    campos: [
      { nome: 'canal', tipo: 'opcao', rotulo: 'Canal', obrigatorio: true, opcoes: CANAIS_DA_PAUSA },
      // 10 ou 30 minutos (a 99 também 20): a rota recusa os outros com o motivo.
      { nome: 'minutos', tipo: 'inteiro', rotulo: 'Mais minutos', obrigatorio: true, min: 10, max: 30 },
    ],
  },
  {
    // PIN no mapa (rodada 7, MIS-C-02): ordena por onde saem as cobranças Pix da empresa inteira.
    rota: 'PATCH /api/v1/delivery/pix-prioritario',
    campos: [{ nome: 'gateway', tipo: 'opcao', rotulo: 'Pix pelo', obrigatorio: true, opcoes: GATEWAYS_DO_PIX }],
    alcance: 'empresa',
  },
  // Cardápio: categorias e produtos (os ids vêm das leituras "Produtos do cardápio" e "As categorias do cardápio").
  {
    // A rota grava só o que vier.
    rota: 'PATCH /api/v1/produtos/categorias/{id}',
    campos: [
      { nome: 'nome', tipo: 'texto', rotulo: 'Nome da categoria', maxLetras: 80 },
      { nome: 'descricao', tipo: 'texto', rotulo: 'Descrição', maxLetras: 300 },
      { nome: 'ativo', tipo: 'booleano', rotulo: 'No ar' },
    ],
  },
  // Solta os produtos da categoria (eles ficam sem categoria) e tira a categoria.
  { rota: 'DELETE /api/v1/produtos/categorias/{id}', campos: [] },
  // PIN (a revisão da C4): apaga o produto que vende nos canais.
  { rota: 'DELETE /api/v1/produtos/{id}', campos: [] },
  // A cópia nasce "(cópia)", sem código PDV e fora do iFood e da 99.
  { rota: 'POST /api/v1/produtos/{id}/duplicar', campos: [] },
  {
    // Ligado: vende sem saldo (a contagem fica negativa) e sai da pausa por estoque; desligado: volta ao controle normal.
    rota: 'POST /api/v1/produtos/{id}/permite-negativo',
    campos: [{ nome: 'ativo', tipo: 'booleano', rotulo: 'Vender sem saldo', obrigatorio: true }],
  },
  // Cardápio: as opções reutilizáveis e as etapas (os ids vêm de "As opções reutilizáveis" e "As etapas de complementos").
  {
    rota: 'PUT /api/v1/produtos/opcoes/{id}/pausa-canal',
    campos: [
      { nome: 'canal', tipo: 'opcao', rotulo: 'Canal', obrigatorio: true, opcoes: CANAIS_DA_OPCAO },
      { nome: 'pausado', tipo: 'booleano', rotulo: 'Pausado', obrigatorio: true },
    ],
  },
  {
    // PIN no mapa: o preço do complemento no app.
    rota: 'PUT /api/v1/produtos/opcoes/{id}/preco-canal',
    campos: [
      { nome: 'canal', tipo: 'opcao', rotulo: 'App', obrigatorio: true, opcoes: APPS_DO_PRECO },
      { nome: 'valor', tipo: 'numero', rotulo: 'Preço no app', obrigatorio: true, min: 0, max: 999999.99 },
    ],
  },
  {
    // PIN no mapa: o preço da opção dentro de uma etapa (o do Regem).
    rota: 'PUT /api/v1/produtos/complementos-catalogo/{id}/opcoes/{opcaoId}/preco',
    campos: [{ nome: 'valor', tipo: 'numero', rotulo: 'Preço na etapa', obrigatorio: true, min: 0, max: 999999.99 }],
  },
  { rota: 'DELETE /api/v1/produtos/opcoes/{id}', campos: [] },
  { rota: 'POST /api/v1/produtos/opcoes/massa/excluir', campos: [{ nome: 'ids', tipo: 'ids', rotulo: 'Opções', obrigatorio: true, maxItens: 50 }] },
  {
    // PIN no mapa: o custo de várias opções de uma vez.
    rota: 'PATCH /api/v1/produtos/opcoes/massa/preco',
    campos: [
      { nome: 'ids', tipo: 'ids', rotulo: 'Opções', obrigatorio: true, maxItens: 50 },
      { nome: 'precoCusto', tipo: 'numero', rotulo: 'Custo', obrigatorio: true, min: 0, max: 999999.99 },
    ],
  },
  { rota: 'DELETE /api/v1/produtos/complementos-catalogo/{id}', campos: [] },

  // ───────────── C4 Onda 3 (27/11/2026): cozinha e ponto ─────────────
  // Fora desta onda, de propósito: a ESCALA e os ajustes e marcações do PONTO (cada um é de uma pessoa — V10-4; trocar turno,
  // folga e a marcação esquecida já são ações prontas); os CANDIDATOS das vagas (dado de pessoa) e os QR das vagas (a lista
  // deles tem dado de pessoa); a configuração do KDS (cores, avisos, fluxo, produtos, rota, destinos, senha — trocam a lista
  // inteira); avançar e "visto" no cartão da cozinha (são do KDS, na tela da cozinha); CONCLUIR a ordem (pede o PIN de quem
  // produziu, a assinatura); cancelar o pedido em produção (pede a senha de um gestor); a recorrência da ordem; classificar
  // o lançamento do banco (já é ação pronta).
  // Ordens de produção (os ids vêm de "Ordens de produção"; a ficha, de "Fichas técnicas").
  {
    rota: 'POST /api/v1/ordens-producao',
    campos: [
      { nome: 'fichaId', tipo: 'id', rotulo: 'Ficha técnica', obrigatorio: true },
      { nome: 'quantidadePlanejada', tipo: 'numero', rotulo: 'Quantidade', obrigatorio: true, min: 0.001, max: 100000 },
      { nome: 'unidade', tipo: 'opcao', rotulo: 'Unidade', opcoes: UNIDADES },
      { nome: 'dataProducao', tipo: 'data', rotulo: 'Dia da produção', obrigatorio: true },
      { nome: 'horaInicio', tipo: 'hora', rotulo: 'Começa às' },
      { nome: 'horaFim', tipo: 'hora', rotulo: 'Termina às' },
      { nome: 'setorId', tipo: 'id', rotulo: 'Setor' },
      { nome: 'itemSaidaId', tipo: 'id', rotulo: 'Produto que sai' },
      { nome: 'liberar', tipo: 'booleano', rotulo: 'Já liberada para a cozinha' },
      { nome: 'obs', tipo: 'texto', rotulo: 'Observação', maxLetras: 300 },
      { nome: 'unidadeId', tipo: 'loja', rotulo: 'Loja' },
    ],
  },
  { rota: 'POST /api/v1/ordens-producao/{id}/liberar', campos: [] },
  { rota: 'POST /api/v1/ordens-producao/{id}/iniciar', campos: [] },
  {
    // PIN no mapa. O motivo a rota não exige; o Mister pede, para a auditoria dizer por quê.
    rota: 'POST /api/v1/ordens-producao/{id}/cancelar',
    campos: [{ nome: 'motivo', tipo: 'texto', rotulo: 'Motivo', obrigatorio: true, maxLetras: 200 }],
  },
  {
    // A cozinha: tira da tela do KDS todos os cartões de agora (manda "pronto" aos canais) — PIN no mapa. A loja é OBRIGATÓRIA:
    // sem ela, a rota limparia a fila de todas as lojas.
    rota: 'POST /api/v1/producao/fila/limpar',
    campos: [
      { nome: 'setorId', tipo: 'id', rotulo: 'Só o setor' },
      { nome: 'unidadeId', tipo: 'loja', rotulo: 'Loja', obrigatorio: true },
    ],
  },
  // Ponto: o fechamento do mês (as pendências de todos; o espelho vai pela tela). É da empresa inteira, e o já enviado ao contador
  // fica como foi enviado (ERR-650).
  {
    rota: 'POST /api/v1/ponto/fechamentos/gerar',
    campos: [{ nome: 'competencia', tipo: 'mes', rotulo: 'Mês', obrigatorio: true }],
    alcance: 'empresa',
  },

  // ───────────── C4 Onda 4 (27/11/2026): dinheiro e fiscal — tudo com PIN ─────────────
  // Só o que DESFAZ ou ENCERRA com trava no serviço, e a contingência fiscal. Fora, de propósito: o que já é ação pronta
  // (lançar e pagar conta, fechar o caixa, sangria, cupom, pagar o entregador); o CAIXA do terminal (abrir, movimentar,
  // reconciliar — o caixa é o do terminal, V7) e a venda do PDV (comandas, mesas, balcão, acertos: a operação é no balcão);
  // as PESSOAS e os ACESSOS (colaboradores, perfis, contadores — dado de pessoa e quem acessa o quê ficam na tela); as LOJAS e
  // a configuração da empresa; criar e mudar forma de pagamento, conta e plano (formulários com regras de cada tela); EMITIR,
  // CANCELAR e INUTILIZAR nota (efeito fiscal na hora); a consulta da SEFAZ e da nota (consulta com PIN não vale a pena; a
  // lista de notas tem dado de cliente); o prêmio de desculpas e o cancelamento do atendimento (são do caso, na Central).
  // Contas (os ids vêm de "Contas a pagar e a receber").
  // Só a conta EM ABERTO (a rota recusa a paga: estorne antes).
  { rota: 'DELETE /api/v1/financeiro/titulos/{id}', campos: [] },
  // Só a conta PAGA volta a aberta, com o lançamento inverso — uma vez só (a troca condicional vem antes do lançamento).
  { rota: 'POST /api/v1/financeiro/titulos/{id}/estornar', campos: [] },
  // Formas de pagamento (os ids vêm de "As formas de pagamento cadastradas").
  {
    rota: 'POST /api/v1/financeiro/formas-pagamento/{id}/ativa',
    campos: [{ nome: 'ativo', tipo: 'booleano', rotulo: 'Ativa', obrigatorio: true }],
  },
  // Fiscal: manda à SEFAZ as notas que saíram em contingência (offline) — da loja da conversa, ou de todas.
  { rota: 'POST /api/v1/fiscal/contingencia/transmitir', campos: [] },
  // Fidelidade e cashback: o plano passa a "finalizando" (para de juntar; os ids vêm dos planos de cada um).
  { rota: 'POST /api/v1/fidelidade/planos/{id}/finalizar', campos: [] },
  { rota: 'POST /api/v1/cashback/planos/{id}/finalizar', campos: [] },
];

/** A tarefa aberta da rota pedida, ou undefined. */
export const tarefaAberta = (rota: unknown): TarefaAberta | undefined => (typeof rota === 'string' ? TAREFAS_ABERTAS.find((t) => t.rota === rota.trim()) : undefined);
