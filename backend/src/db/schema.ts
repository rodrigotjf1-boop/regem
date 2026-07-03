import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  numeric,
  timestamp,
  date,
  time,
  jsonb,
  unique,
} from 'drizzle-orm/pg-core';

// Espelha as tabelas das migrations (Fase 0). Cresce por fatia,
// conforme cada módulo passa a ser implementado.

export const empresa = pgTable('empresa', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: text('nome').notNull(),
  cnpj: text('cnpj').unique(),
  ramo: text('ramo').notNull().default('food_service'),
  plano: text('plano').notNull().default('basico'),
  status: text('status').notNull().default('ativo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const unidade = pgTable('unidade', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  endereco: text('endereco'),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const entitlement = pgTable(
  'entitlement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => empresa.id, { onDelete: 'cascade' }),
    modulo: text('modulo').notNull(),
    ativo: boolean('ativo').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqTenantModulo: unique().on(t.tenantId, t.modulo),
  }),
);

export const funcao = pgTable('funcao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  categoria: text('categoria').notNull().default('execucao'),
  setorId: uuid('setor_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const colaborador = pgTable('colaborador', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  fotoRef: text('foto_ref'),
  funcaoId: uuid('funcao_id').references(() => funcao.id),
  vinculo: text('vinculo').notNull().default('clt'),
  pinHash: text('pin_hash'),
  email: text('email'),
  senhaHash: text('senha_hash'),
  status: text('status').notNull().default('ativo'),
  matricula: text('matricula'),
  consentimentoLgpd: boolean('consentimento_lgpd').notNull().default(false),
  dataConsentimento: date('data_consentimento'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const setor = pgTable('setor', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id')
    .notNull()
    .references(() => unidade.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  icone: text('icone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const turno = pgTable('turno', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id')
    .notNull()
    .references(() => unidade.id, { onDelete: 'cascade' }),
  setorId: uuid('setor_id'),
  nome: text('nome').notNull(),
  horaInicio: time('hora_inicio').notNull(),
  horaFim: time('hora_fim').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Espelha a tabela pré-existente (fundação) + coluna `nome` da migration 011.
export const janelaPico = pgTable('janela_pico', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id')
    .notNull()
    .references(() => unidade.id, { onDelete: 'cascade' }),
  setorId: uuid('setor_id'), // override por setor (pós-MVP); null = unidade toda
  nome: text('nome'),
  diaSemana: integer('dia_semana'), // 0=domingo .. 6=sábado; null = todos
  horaInicio: time('hora_inicio').notNull(),
  horaFim: time('hora_fim').notNull(),
  intensidade: text('intensidade'), // baixa|media|alta (uso futuro)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const etiqueta = pgTable('etiqueta', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id')
    .notNull()
    .references(() => unidade.id, { onDelete: 'cascade' }),
  setorId: uuid('setor_id')
    .notNull()
    .references(() => setor.id, { onDelete: 'cascade' }),
  funcaoId: uuid('funcao_id')
    .notNull()
    .references(() => funcao.id),
  sigla: text('sigla').notNull(),
  contador: integer('contador').notNull().default(1),
  cor: text('cor'),
  icone: text('icone'),
  titularPadraoColaboradorId: uuid('titular_padrao_colaborador_id').references(
    () => colaborador.id,
  ),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const escalaAlocacao = pgTable('escala_alocacao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id')
    .notNull()
    .references(() => unidade.id, { onDelete: 'cascade' }),
  data: date('data').notNull(),
  turnoId: uuid('turno_id')
    .notNull()
    .references(() => turno.id),
  etiquetaId: uuid('etiqueta_id')
    .notNull()
    .references(() => etiqueta.id, { onDelete: 'cascade' }),
  colaboradorId: uuid('colaborador_id').references(() => colaborador.id),
  tipo: text('tipo').notNull().default('titular'),
  status: text('status').notNull().default('ativa'),
  observacao: text('observacao'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const tarefaDef = pgTable('tarefa_def', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id')
    .notNull()
    .references(() => unidade.id, { onDelete: 'cascade' }),
  setorId: uuid('setor_id'),
  origem: text('origem').notNull().default('avulsa'),
  checklistId: uuid('checklist_id'),
  titulo: text('titulo').notNull(),
  descricao: text('descricao'),
  etiquetaId: uuid('etiqueta_id').references(() => etiqueta.id),
  colaboradorOverrideId: uuid('colaborador_override_id').references(
    () => colaborador.id,
  ),
  recorrenciaTipo: text('recorrencia_tipo').notNull().default('avulsa'),
  recorrenciaConfig: jsonb('recorrencia_config'),
  horario: time('horario'),
  janelaTurnoId: uuid('janela_turno_id'),
  proibidaNoPico: boolean('proibida_no_pico').notNull().default(false),
  antecipavel: boolean('antecipavel').notNull().default(false),
  popId: uuid('pop_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const tarefaInstancia = pgTable('tarefa_instancia', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id')
    .notNull()
    .references(() => unidade.id, { onDelete: 'cascade' }),
  tarefaDefId: uuid('tarefa_def_id').references(() => tarefaDef.id),
  data: date('data').notNull(),
  etiquetaId: uuid('etiqueta_id').references(() => etiqueta.id),
  colaboradorResolvidoId: uuid('colaborador_resolvido_id').references(
    () => colaborador.id,
  ),
  estado: text('estado').notNull().default('pendente'),
  motivo: text('motivo'),
  fotoRef: text('foto_ref'),
  concluidoPorId: uuid('concluido_por_id').references(() => colaborador.id),
  concluidoEm: timestamp('concluido_em', { withTimezone: true }),
  conclusaoEmMassa: boolean('conclusao_em_massa').notNull().default(false),
  justificativaPico: text('justificativa_pico'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const checklist = pgTable('checklist', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id')
    .notNull()
    .references(() => unidade.id, { onDelete: 'cascade' }),
  setorId: uuid('setor_id'),
  nome: text('nome').notNull(),
  versao: integer('versao').notNull().default(1),
  estado: text('estado').notNull().default('rascunho'),
  autorId: uuid('autor_id').references(() => colaborador.id),
  aprovadorId: uuid('aprovador_id').references(() => colaborador.id),
  aprovadoEm: timestamp('aprovado_em', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const checklistItem = pgTable('checklist_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  checklistId: uuid('checklist_id')
    .notNull()
    .references(() => checklist.id, { onDelete: 'cascade' }),
  ordem: integer('ordem').notNull().default(0),
  descricao: text('descricao').notNull(),
  procedimento: text('procedimento'),
  fotoRef: text('foto_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pop = pgTable('pop', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  checklistId: uuid('checklist_id')
    .notNull()
    .references(() => checklist.id, { onDelete: 'cascade' }),
  versao: integer('versao').notNull(),
  conteudoSnapshot: jsonb('conteudo_snapshot'),
  publicadoEm: timestamp('publicado_em', { withTimezone: true }).notNull().defaultNow(),
  pdfRef: text('pdf_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documentoControlado = pgTable('documento_controlado', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id').references(() => unidade.id, {
    onDelete: 'cascade',
  }),
  tipo: text('tipo').notNull(),
  titulo: text('titulo').notNull(),
  escopo: text('escopo'),
  versao: integer('versao').notNull().default(1),
  estado: text('estado').notNull().default('rascunho'),
  conteudo: jsonb('conteudo'),
  publicadoEm: timestamp('publicado_em', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const ciencia = pgTable('ciencia', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  colaboradorId: uuid('colaborador_id')
    .notNull()
    .references(() => colaborador.id, { onDelete: 'cascade' }),
  documentoId: uuid('documento_id')
    .notNull()
    .references(() => documentoControlado.id, { onDelete: 'cascade' }),
  versao: integer('versao').notNull(),
  data: timestamp('data', { withTimezone: true }).notNull().defaultNow(),
  assinaturaRef: text('assinatura_ref'),
});

export const desperdicio = pgTable('desperdicio', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  setorId: uuid('setor_id'),
  colaboradorId: uuid('colaborador_id'),
  descricao: text('descricao').notNull(),
  quantidade: numeric('quantidade'),
  unidadeMedida: text('unidade_medida'),
  motivo: text('motivo'),
  fotoRef: text('foto_ref'),
  data: date('data').notNull().default(sql`current_date`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const vistoria = pgTable('vistoria', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  setorId: uuid('setor_id'),
  colaboradorId: uuid('colaborador_id'),
  tipo: text('tipo').notNull().default('padrao'),
  data: date('data').notNull().default(sql`current_date`),
  observacao: text('observacao'),
  fotoRef: text('foto_ref'),
  status: text('status').notNull().default('concluida'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const itemEstoque = pgTable('item_estoque', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  nome: text('nome').notNull(),
  unidadeMedida: text('unidade_medida').notNull().default('un'),
  estoqueMinimo: numeric('estoque_minimo').notNull().default('0'),
  custoMedio: numeric('custo_medio').notNull().default('0'),
  categoria: text('categoria'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const tipoOcorrencia = pgTable('tipo_ocorrencia', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  sinal: text('sinal').notNull(),
  pontos: integer('pontos').notNull().default(0),
  ativo: boolean('ativo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const ocorrencia = pgTable('ocorrencia', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  colaboradorId: uuid('colaborador_id')
    .notNull()
    .references(() => colaborador.id, { onDelete: 'cascade' }),
  tipoId: uuid('tipo_id'),
  autorId: uuid('autor_id'),
  sinal: text('sinal').notNull(),
  pontos: integer('pontos').notNull().default(0),
  gravidade: text('gravidade').notNull().default('leve'),
  descricao: text('descricao'),
  fotoRef: text('foto_ref'),
  setorId: uuid('setor_id'),
  status: text('status').notNull().default('vigente'),
  data: date('data').notNull().default(sql`current_date`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const movimentoEstoque = pgTable('movimento_estoque', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => itemEstoque.id, { onDelete: 'cascade' }),
  tipo: text('tipo').notNull(),
  quantidade: numeric('quantidade').notNull(),
  custoUnitario: numeric('custo_unitario'),
  motivo: text('motivo'),
  data: date('data').notNull().default(sql`current_date`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Equipamento (device): KDS ou Terminal de Ponto. Base de device-auth (WebSocket),
// do NSR por equipamento (Portaria 671) e dos módulos ativáveis por unidade.
export const equipamento = pgTable('equipamento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  tipo: text('tipo').notNull(), // kds | terminal_ponto
  nome: text('nome').notNull(),
  token: text('token').notNull().unique(),
  mac: text('mac'),
  padrao: boolean('padrao').notNull().default(false),
  ativo: boolean('ativo').notNull().default(true),
  ultimoPing: timestamp('ultimo_ping', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pontoMarcacao = pgTable('ponto_marcacao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  equipamentoId: uuid('equipamento_id'),
  colaboradorId: uuid('colaborador_id')
    .notNull()
    .references(() => colaborador.id, { onDelete: 'cascade' }),
  nsr: bigint('nsr', { mode: 'number' }).notNull(),
  tipo: text('tipo').notNull(),
  marcadoEm: timestamp('marcado_em', { withTimezone: true }).notNull().defaultNow(),
  origem: text('origem').notNull().default('web'),
  registradoPorId: uuid('registrado_por_id'),
  hash: text('hash'),
  obs: text('obs'),
  fotoRef: text('foto_ref'),
  consentimentoLgpd: boolean('consentimento_lgpd').notNull().default(false),
  dataExpurgo: date('data_expurgo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pontoAjuste = pgTable('ponto_ajuste', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  colaboradorId: uuid('colaborador_id')
    .notNull()
    .references(() => colaborador.id, { onDelete: 'cascade' }),
  data: date('data').notNull(),
  tipo: text('tipo').notNull(), // desconsideracao|abono|atestado|justificativa
  marcacaoId: uuid('marcacao_id'),
  minutos: integer('minutos'),
  justificativa: text('justificativa').notNull(),
  atestadoRef: text('atestado_ref'),
  autorId: uuid('autor_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Título financeiro (a pagar/receber) — obrigação/direito com vencimento.
export const tituloFinanceiro = pgTable('titulo_financeiro', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  tipo: text('tipo').notNull(), // pagar | receber
  descricao: text('descricao').notNull(),
  categoria: text('categoria'),
  fornecedorId: uuid('fornecedor_id'),
  valor: numeric('valor').notNull().default('0'),
  vencimento: date('vencimento'),
  recorrencia: text('recorrencia').notNull().default('nenhuma'), // nenhuma|semanal|quinzenal|mensal
  status: text('status').notNull().default('aberto'), // aberto|pago|cancelado
  origem: text('origem').notNull().default('manual'), // recebimento|manual|venda
  origemId: uuid('origem_id'),
  fotoRef: text('foto_ref'),
  criadoPorId: uuid('criado_por_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Lançamento de caixa — ledger append-only do dinheiro. Estorno = lançamento inverso.
export const lancamentoCaixa = pgTable('lancamento_caixa', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  tituloId: uuid('titulo_id'),
  tipo: text('tipo').notNull(), // entrada | saida
  valor: numeric('valor').notNull(),
  data: date('data').notNull().default(sql`current_date`),
  categoria: text('categoria'),
  forma: text('forma'), // dinheiro|pix|cartao|transferencia
  descricao: text('descricao'),
  estornoDe: uuid('estorno_de'),
  criadoPorId: uuid('criado_por_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fornecedor = pgTable('fornecedor', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  cnpj: text('cnpj'),
  contato: text('contato'),
  telefone: text('telefone'),
  email: text('email'),
  obs: text('obs'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const recebimento = pgTable('recebimento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  fornecedorId: uuid('fornecedor_id'),
  data: date('data').notNull().default(sql`current_date`),
  vencimento: date('vencimento'),
  notaRef: text('nota_ref'),
  notaFotoRef: text('nota_foto_ref'),
  status: text('status').notNull().default('aberto'),
  obs: text('obs'),
  conferidoEm: timestamp('conferido_em', { withTimezone: true }),
  conferidoPorId: uuid('conferido_por_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const recebimentoItem = pgTable('recebimento_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  recebimentoId: uuid('recebimento_id')
    .notNull()
    .references(() => recebimento.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => itemEstoque.id),
  qtdEsperada: numeric('qtd_esperada').notNull().default('0'),
  qtdRecebida: numeric('qtd_recebida').notNull().default('0'),
  custoUnitario: numeric('custo_unitario'),
  divergencia: text('divergencia').notNull().default('ok'),
  validade: date('validade'),
  fotoRef: text('foto_ref'),
  obs: text('obs'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const lote = pgTable('lote', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => itemEstoque.id, { onDelete: 'cascade' }),
  recebimentoId: uuid('recebimento_id'),
  validade: date('validade'),
  quantidade: numeric('quantidade').notNull().default('0'),
  custoUnitario: numeric('custo_unitario'),
  entrada: date('entrada').notNull().default(sql`current_date`),
  esgotado: boolean('esgotado').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const fichaTecnica = pgTable('ficha_tecnica', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  setorId: uuid('setor_id'),
  popId: uuid('pop_id'),
  nome: text('nome').notNull(),
  categoria: text('categoria').notNull().default('base'),
  rendimento: numeric('rendimento').notNull().default('1'),
  rendimentoUnidade: text('rendimento_unidade'),
  validade: text('validade'),
  precoVenda: numeric('preco_venda'),
  metaCmv: numeric('meta_cmv').notNull().default('31.5'),
  ativo: boolean('ativo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const fichaIngrediente = pgTable('ficha_ingrediente', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  fichaId: uuid('ficha_id')
    .notNull()
    .references(() => fichaTecnica.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id'),
  insumoNome: text('insumo_nome').notNull(),
  quantidade: numeric('quantidade').notNull().default('0'),
  unidade: text('unidade'),
  fatorCorrecao: numeric('fator_correcao').notNull().default('1'),
  custoUnitario: numeric('custo_unitario').notNull().default('0'),
  ordem: integer('ordem').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const guia = pgTable('guia', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  setorId: uuid('setor_id'),
  funcaoId: uuid('funcao_id'),
  codigo: text('codigo'),
  titulo: text('titulo').notNull(),
  descricao: text('descricao'),
  ramo: text('ramo'),
  frequencia: text('frequencia').notNull().default('diaria'),
  estado: text('estado').notNull().default('rascunho'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const guiaPasso = pgTable('guia_passo', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  guiaId: uuid('guia_id')
    .notNull()
    .references(() => guia.id, { onDelete: 'cascade' }),
  ordem: integer('ordem').notNull().default(0),
  descricao: text('descricao').notNull(),
  mediaRef: text('media_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// audit_log: criada na 002 e estendida na 010 (actor_perfil, tipo, origem). Append-only.
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  actorTipo: text('actor_tipo').notNull().default('usuario'),
  actorId: uuid('actor_id'),
  actorPerfil: text('actor_perfil'),
  tipo: text('tipo'),
  acao: text('acao').notNull(),
  entidadeTipo: text('entidade_tipo'),
  entidadeId: uuid('entidade_id'),
  detalhe: jsonb('detalhe'),
  origem: text('origem').notNull().default('web'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
