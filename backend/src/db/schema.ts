import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
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
