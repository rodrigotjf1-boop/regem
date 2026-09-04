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

// Sessão de SUPORTE (F9, mig 170): técnico da distribuição acessa uma loja por
// tempo limitado, escopado e auditado. Cloud-only.
export const suporteSessao = pgTable('suporte_sessao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  tecnicoId: uuid('tecnico_id').notNull(), // usuario_distribuicao.id
  tecnicoNome: text('tecnico_nome'),
  motivo: text('motivo'),
  ip: text('ip'),
  iniciadaEm: timestamp('iniciada_em', { withTimezone: true }).notNull().defaultNow(),
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  encerradaEm: timestamp('encerrada_em', { withTimezone: true }),
  encerradaPor: text('encerrada_por'), // 'expirou' | 'tecnico' | 'loja'
});

export const empresa = pgTable('empresa', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: text('nome').notNull(),
  cnpj: text('cnpj').unique(),
  ramo: text('ramo').notNull().default('food_service'),
  plano: text('plano').notNull().default('basico'),
  status: text('status').notNull().default('ativo'),
  // Trial da conta na nuvem (G-1): NULL = sem limite (legado/assinatura); data = fim do teste.
  trialAte: timestamp('trial_ate', { withTimezone: true }),
  // Distribuidor (DMS/revenda): só true acessa o /frota (emitir licença/ativação).
  isDistribuidor: boolean('is_distribuidor').notNull().default(false),
  // Consentimento de suporte (F9): true = a loja BLOQUEIA acesso de técnico (mig 170).
  suporteBloqueado: boolean('suporte_bloqueado').notNull().default(false),
  // F9 (D) — o presidente concede ACESSO TOTAL ao suporte (senão só o pacote mínimo
  // de config). Server-authoritative: lido pelo guard a cada request (mig 224).
  suporteAcessoTotal: boolean('suporte_acesso_total').notNull().default(false),
  // Assinatura Stripe (G-6b). O "válido até" fica no trial_ate (fim do período pago).
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  assinaturaStatus: text('assinatura_status'), // active|trialing|past_due|canceled|null
  // Janela (dias) que o SERVIDOR LOCAL puxa das transacionais pesadas da nuvem no sync
  // espelhado (mig 175). Config no Financeiro (presidente). Nuvem mantém histórico integral.
  mirrorDias: integer('mirror_dias').notNull().default(60),
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
  tipo: text('tipo').notNull().default('filial'), // matriz | filial
  endereco: text('endereco'),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  // Diferença de caixa (em reais) acima da qual o fechamento gera ocorrência.
  limiteDiferencaCaixa: numeric('limite_diferenca_caixa').notNull().default('5'),
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
  setorId: uuid('setor_id'), // setor PRIMÁRIO (onboarding/geração de etiqueta)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Função ↔ setor N:N (uma função pode servir vários setores). Ver migration 102.
export const funcaoSetor = pgTable('funcao_setor', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  funcaoId: uuid('funcao_id')
    .notNull()
    .references(() => funcao.id, { onDelete: 'cascade' }),
  setorId: uuid('setor_id')
    .notNull()
    .references(() => setor.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const colaborador = pgTable('colaborador', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  fotoRef: text('foto_ref'),
  unidadeId: uuid('unidade_id'), // loja do colaborador (escopo do mural, etc.)
  funcaoId: uuid('funcao_id').references(() => funcao.id),
  telefone: text('telefone'), // contato (ex.: entregador em rota)
  vinculo: text('vinculo').notNull().default('clt'),
  jornadaTipo: text('jornada_tipo').notNull().default('outro'), // 5x2|6x1|5x1|12x36|4x3|horista|outro
  pinHash: text('pin_hash'),
  email: text('email'),
  // Apelido de login (mig 141): único DENTRO da empresa, então o atendente entra
  // sem precisar de e-mail. O e-mail segue valendo para quem já usa.
  usuario: text('usuario'),
  senhaHash: text('senha_hash'),
  status: text('status').notNull().default('ativo'), // ativo | bloqueado
  perfilAcessoId: uuid('perfil_acesso_id'), // perfil de acesso (RBAC configurável)
  appHabilitado: boolean('app_habilitado').notNull().default(false), // libera o PIN do app do colaborador
  // RBAC de modo (mig 176): pode logar no MODO NUVEM (app online). No edge todos
  // entram; a nuvem é uso do presidente, que libera quem mais pode acessar online.
  podeNuvem: boolean('pode_nuvem').notNull().default(false),
  matricula: text('matricula'),
  consentimentoLgpd: boolean('consentimento_lgpd').notNull().default(false),
  dataConsentimento: date('data_consentimento'),
  uiPrefs: jsonb('ui_prefs').notNull().default({}), // prefs de UI (shell)
  // Desligamento (mig 135) — status ganha 'desligado' quando efetivado
  desligamentoTipo: text('desligamento_tipo'), // sem_justa_causa|justa_causa|pedido_demissao|acordo|experiencia
  avisoInicio: date('aviso_inicio'), // início do aviso prévio trabalhado
  avisoOpcao: text('aviso_opcao'), // '2h' | '7dias'
  avisoFim: date('aviso_fim'), // fim do aviso (30d + proporcional, teto 90)
  desligamentoData: date('desligamento_data'),
  desligamentoMotivo: text('desligamento_motivo'),
  desligamentoPorId: uuid('desligamento_por_id'),
  desligadoEm: timestamp('desligado_em', { withTimezone: true }),
  pontoEnviadoEm: timestamp('ponto_enviado_em', { withTimezone: true }),
  pontoEnviadoContadorId: uuid('ponto_enviado_contador_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// N:N colaborador↔função: um operador cobre várias funções; uma função tem 0..N.
export const colaboradorFuncao = pgTable('colaborador_funcao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  colaboradorId: uuid('colaborador_id')
    .notNull()
    .references(() => colaborador.id, { onDelete: 'cascade' }),
  funcaoId: uuid('funcao_id')
    .notNull()
    .references(() => funcao.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Perfil de acesso (RBAC configurável): o presidente edita as permissões e associa
// ao colaborador. `nivel` casa com a categoria da hierarquia; `login_web` decide se
// o perfil entra por e-mail+senha (execução = só PIN). `permissoes` é o pacote de toggles.
export const perfilAcesso = pgTable('perfil_acesso', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  nivel: text('nivel').notNull(), // presidente | gerente | supervisao | execucao
  loginWeb: boolean('login_web').notNull().default(false),
  permissoes: jsonb('permissoes').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Módulos ativáveis (CLAUDE.md): presidente liga/desliga por rede (unidade_id nulo)
// ou por loja. Desativar corta o acesso (checado no servidor) + audita.
export const moduloAtivacao = pgTable('modulo_ativacao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'), // null = padrão da rede
  modulo: text('modulo').notNull(), // app_colaborador | kds | terminal_ponto | bot
  ativo: boolean('ativo').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
  cor: text('cor'), // cor própria do setor (cabeçalho da grade de escala)
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
  pausaInicio: time('pausa_inicio'), // intervalo intrajornada (timeline + CLT)
  pausaFim: time('pausa_fim'),
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
  diaSemanaFim: integer('dia_semana_fim'), // fim do intervalo (inclusive); null = dia único
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
  // Escala recorrente: regra que gerou a alocação + overrides de horário/pausa do dia.
  regraId: uuid('regra_id'),
  horaInicioOverride: time('hora_inicio_override'),
  horaFimOverride: time('hora_fim_override'),
  pausaInicioOverride: time('pausa_inicio_override'),
  pausaFimOverride: time('pausa_fim_override'),
  // Presença: prevista | presente | falta_justificada | falta_injustificada.
  presenca: text('presenca').notNull().default('prevista'),
  comprovanteRef: text('comprovante_ref'),
  presencaObs: text('presenca_obs'),
  presencaEm: timestamp('presenca_em', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Regra de recorrência da escala (o "evento recorrente"). Ver migration 101.
export const escalaRegra = pgTable('escala_regra', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id')
    .notNull()
    .references(() => unidade.id, { onDelete: 'cascade' }),
  colaboradorId: uuid('colaborador_id')
    .notNull()
    .references(() => colaborador.id, { onDelete: 'cascade' }),
  etiquetaId: uuid('etiqueta_id')
    .notNull()
    .references(() => etiqueta.id, { onDelete: 'cascade' }),
  turnoId: uuid('turno_id')
    .notNull()
    .references(() => turno.id),
  jornadaTipo: text('jornada_tipo').notNull(),
  folgasSemana: jsonb('folgas_semana').notNull().default('[]'),
  dataInicio: date('data_inicio').notNull(),
  dataFim: date('data_fim').notNull(),
  feriadosFechar: boolean('feriados_fechar').notNull().default(true),
  ativo: boolean('ativo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Dias importantes: feriado/férias/evento. unidade null = rede toda;
// colaborador preenchido = férias/folga de uma pessoa; data_fim = período.
export const diaEspecial = pgTable('dia_especial', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id').references(() => unidade.id, { onDelete: 'cascade' }),
  colaboradorId: uuid('colaborador_id').references(() => colaborador.id, {
    onDelete: 'cascade',
  }),
  data: date('data').notNull(),
  dataFim: date('data_fim'),
  tipo: text('tipo').notNull().default('evento'), // feriado|ferias|evento|folga|outro
  nome: text('nome').notNull(),
  descricao: text('descricao'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
  funcaoId: uuid('funcao_id'), // função-alvo da tarefa (cadastro por setor+função)
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
  funcaoId: uuid('funcao_id'), // snapshot da função-alvo
  setorId: uuid('setor_id'), // snapshot do setor (opcional)
  colaboradorResolvidoId: uuid('colaborador_resolvido_id').references(
    () => colaborador.id,
  ),
  estado: text('estado').notNull().default('pendente'),
  motivo: text('motivo'),
  fotoRef: text('foto_ref'),
  fotos: jsonb('fotos').notNull().default('[]'), // comprovação (até 3); expurgo em 30d
  dataExpurgo: date('data_expurgo'), // LGPD: expurgo das fotos da tarefa
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
  itemId: uuid('item_id'),
  custoUnitario: numeric('custo_unitario'),
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
  validade: date('validade'), // data de validade opcional do insumo (mig 149)
  validadeAbertoDias: integer('validade_aberto_dias'), // dias de validade após aberto (mig 182)
  diasSeguranca: integer('dias_seguranca').notNull().default(2),
  classeAbc: text('classe_abc'),
  categoria: text('categoria'), // texto livre (compat); ver categoriaItemId
  // Fornecedor PRINCIPAL (compat). A lista completa fica em item_fornecedor (mig 178).
  fornecedorId: uuid('fornecedor_id').references(() => fornecedor.id),
  categoriaItemId: uuid('categoria_item_id').references(() => categoriaItem.id),
  setorId: uuid('setor_id'), // setor de estoque onde o insumo fica guardado (mig 178)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Fornecedores de um insumo (N:N — mig 178). item_estoque.fornecedor_id segue como principal.
export const itemFornecedor = pgTable('item_fornecedor', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => itemEstoque.id, { onDelete: 'cascade' }),
  fornecedorId: uuid('fornecedor_id')
    .notNull()
    .references(() => fornecedor.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Categoria de insumo (cadastro próprio). Usada p/ filtro/agrupamento no estoque.
export const categoriaItem = pgTable('categoria_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  cor: text('cor'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Conversões personalizadas: 1 <unidadeDe> = <fator> <unidadePara>.
export const itemConversao = pgTable('item_conversao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => itemEstoque.id, { onDelete: 'cascade' }),
  unidadeDe: text('unidade_de').notNull(),
  fator: numeric('fator').notNull(),
  unidadePara: text('unidade_para').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ----- Contagem de estoque (E2) -----
export const contagemLista = pgTable('contagem_lista', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id').references(() => unidade.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  recorrencia: text('recorrencia').notNull().default('semanal'), // diaria|semanal|mensal|avulsa
  diaSemana: integer('dia_semana'),
  diaMes: integer('dia_mes'),
  hora: time('hora'),
  delegadoId: uuid('delegado_id').references(() => colaborador.id, { onDelete: 'set null' }),
  enviarKds: boolean('enviar_kds').notNull().default(true),
  enviarDashboard: boolean('enviar_dashboard').notNull().default(true),
  ativo: boolean('ativo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const contagemListaItem = pgTable('contagem_lista_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  listaId: uuid('lista_id')
    .notNull()
    .references(() => contagemLista.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => itemEstoque.id, { onDelete: 'cascade' }),
});

export const contagemExecucao = pgTable('contagem_execucao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  listaId: uuid('lista_id')
    .notNull()
    .references(() => contagemLista.id, { onDelete: 'cascade' }),
  data: date('data').notNull().default(sql`current_date`),
  status: text('status').notNull().default('aberta'), // aberta|concluida
  delegadoId: uuid('delegado_id').references(() => colaborador.id, { onDelete: 'set null' }),
  criadaPorId: uuid('criada_por_id').references(() => colaborador.id, { onDelete: 'set null' }),
  concluidaEm: timestamp('concluida_em', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const contagemItem = pgTable('contagem_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  execucaoId: uuid('execucao_id')
    .notNull()
    .references(() => contagemExecucao.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => itemEstoque.id, { onDelete: 'cascade' }),
  saldoSistema: numeric('saldo_sistema').notNull().default('0'),
  contado: numeric('contado'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ----- Lista de compras (E3) -----
export const compraLista = pgTable('compra_lista', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id').references(() => unidade.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  fornecedorId: uuid('fornecedor_id').references(() => fornecedor.id, { onDelete: 'set null' }),
  dataRecebimento: date('data_recebimento'),
  delegadoId: uuid('delegado_id').references(() => colaborador.id, { onDelete: 'set null' }),
  enviarKds: boolean('enviar_kds').notNull().default(true),
  enviarDashboard: boolean('enviar_dashboard').notNull().default(true),
  status: text('status').notNull().default('aberta'), // aberta|recebida|cancelada
  recebidaEm: timestamp('recebida_em', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const compraItem = pgTable('compra_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  listaId: uuid('lista_id')
    .notNull()
    .references(() => compraLista.id, { onDelete: 'cascade' }),
  itemId: uuid('item_id')
    .notNull()
    .references(() => itemEstoque.id, { onDelete: 'cascade' }),
  quantidade: numeric('quantidade').notNull().default('0'),
  custoUnitario: numeric('custo_unitario'),
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
  refTipo: text('ref_tipo'), // venda|producao|recebimento|desperdicio|ajuste|estorno
  refId: uuid('ref_id'),
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
  tipo: text('tipo').notNull(), // kds | terminal_ponto | servidor_local | impressora
  nome: text('nome').notNull(),
  token: text('token').notNull().unique(),
  mac: text('mac'),
  padrao: boolean('padrao').notNull().default(false),
  ativo: boolean('ativo').notNull().default(true),
  fingerprint: text('fingerprint'), // impressão da máquina do dispositivo (anti-clone, mig 155)
  lastPushSeq: integer('last_push_seq'), // último seq de push aceito (anti-omissão de sync, mig 154)
  lastPushTs: timestamp('last_push_ts', { withTimezone: true }), // maior ts de push visto (anti-rollback de relógio, mig 157)
  escopo: text('escopo').notNull().default('producao'), // KDS: producao | avisos | entrega
  papel: text('papel'), // impressora: producao | cupom (compat; roteamento usa os flags abaixo — mig 167)
  fazCupom: boolean('faz_cupom').notNull().default(false), // imprime a via do cliente (cupom) — mig 167
  fazProducao: boolean('faz_producao').notNull().default(false), // imprime produção (cozinha/setores) — mig 167
  fazEtiqueta: boolean('faz_etiqueta').notNull().default(false), // imprime etiquetas de validade (RDC 216) — mig 179
  linguagemEtiqueta: text('linguagem_etiqueta').notNull().default('escpos'), // escpos | zpl | epl (etiquetadora) — mig 180
  setorId: uuid('setor_id'), // KDS/impressora vinculado a um setor de produção
  conexao: text('conexao').notNull().default('rede'), // impressora: 'rede' (IP:porta) | 'local' (USB/Windows)
  host: text('host'), // IP da impressora de rede (conexao='rede')
  porta: integer('porta'), // porta ESC/POS (padrão 9100)
  dispositivo: text('dispositivo'), // nome da impressora no Windows (conexao='local')
  largura: integer('largura').notNull().default(80), // 58 | 80 (mm) — impressora
  setoresAtendidos: jsonb('setores_atendidos').notNull().default('[]'), // [setor_id,...] (impressora)
  vias: integer('vias').notNull().default(1), // nº de vias (impressora) — legado/fallback
  viasCliente: integer('vias_cliente'), // nº de vias do cupom do cliente (mig 168); null = herda `vias`
  viasProducao: integer('vias_producao'), // nº de vias da produção (mig 168); null = herda `vias`
  impressoraPadraoId: uuid('impressora_padrao_id'), // terminal PDV: impressora de cupom amarrada
  // KDS — impressão guiada por etapa (mig 129): o ticket só sai quando o pedido
  // AVANÇA para `imprimeNoStatus` neste KDS, indo para `impressoraDestinoId`.
  imprimeAoAvancar: boolean('imprime_ao_avancar').notNull().default(false),
  imprimeNoStatus: text('imprime_no_status').notNull().default('pronto'),
  impressoraDestinoId: uuid('impressora_destino_id'),
  proximoKdsId: uuid('proximo_kds_id'), // roteamento entre KDS ao avançar (mig 159, Fase E)

  pdvMainId: uuid('pdv_main_id'), // sub-PDV salão (tipo='salao'): caixa principal a que pertence (mig 133)

  // Pareamento do PC (mig 142): código de uso único → segredo do device.
  pareamentoCodigo: text('pareamento_codigo'),
  pareamentoExpiraEm: timestamp('pareamento_expira_em', { withTimezone: true }),
  segredoHash: text('segredo_hash'), // só o hash; o valor sai uma vez para o PC
  pareadoEm: timestamp('pareado_em', { withTimezone: true }),
  ultimoUsoEm: timestamp('ultimo_uso_em', { withTimezone: true }),
  revogadoEm: timestamp('revogado_em', { withTimezone: true }), // PC roubado/trocado

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

// Fechamento mensal de ponto (Épico #2 / espelho de ponto — RH). Um registro por
// (tenant, competência = 1º dia do mês fechado). O job mensal detecta pendências
// (batida faltando/incompleta) e materializa aqui; alimenta o alerta em
// Gerenciamento de ponto e o encaminhamento do espelho ao contador. Mig 164.
export const pontoFechamento = pgTable('ponto_fechamento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  competencia: date('competencia').notNull(), // 1º dia do mês fechado
  status: text('status').notNull().default('pendente'), // pendente|ok|enviado
  totalColaboradores: integer('total_colaboradores').notNull().default(0),
  totalPendencias: integer('total_pendencias').notNull().default(0),
  pendencias: jsonb('pendencias').notNull().default('[]'), // [{colaboradorId,nome,dias:[{data,motivo}]}]
  pdfRef: text('pdf_ref'),
  enviadoEm: timestamp('enviado_em', { withTimezone: true }),
  enviadoContadorId: uuid('enviado_contador_id'),
  enviadoPorId: uuid('enviado_por_id'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
  sessaoId: uuid('sessao_id'),
  comandaId: uuid('comanda_id'), // venda que originou (p/ estorno no cancelamento)
  criadoPorId: uuid('criado_por_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Sessão de caixa (abertura → fechamento cego). Fase J/J5.
export const caixaSessao = pgTable('caixa_sessao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  terminalId: uuid('terminal_id'), // terminal de PDV (equipamento tipo='pdv') dono da sessão; null p/ delivery
  origem: text('origem').notNull().default('pdv'), // pdv | delivery (gaveta separada)
  status: text('status').notNull().default('aberta'), // aberta | fechada
  turnoNumero: integer('turno_numero'), // nº do turno (sequencial por dia)
  valorAbertura: numeric('valor_abertura').notNull().default('0'),
  abertaEm: timestamp('aberta_em', { withTimezone: true }).notNull().defaultNow(),
  abertaPorId: uuid('aberta_por_id'),
  valorInformado: numeric('valor_informado'),
  valorEsperado: numeric('valor_esperado'),
  diferenca: numeric('diferenca'),
  valoresInformados: jsonb('valores_informados'), // contado por forma {dinheiro,cartao,pix,...}
  esperadoPorForma: jsonb('esperado_por_forma'),
  diferencaPorForma: jsonb('diferenca_por_forma'),
  fechadaEm: timestamp('fechada_em', { withTimezone: true }),
  fechadaPorId: uuid('fechada_por_id'),
  obs: text('obs'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), // sync v2 (LWW)
});

export const formaPagamento = pgTable('forma_pagamento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  tipo: text('tipo').notNull().default('outro'), // dinheiro|pix|credito|debito|vr|outro
  ativo: boolean('ativo').notNull().default(true),
  ordem: integer('ordem').notNull().default(0),
  cardapio: boolean('cardapio').notNull().default(false), // aparece no cardápio digital
  tiposPedido: jsonb('tipos_pedido').notNull().default('["delivery","retirada","balcao"]'),
  taxaExtra: numeric('taxa_extra'), // taxa extra R$ (null = não informado)
  obs: text('obs'),
  bandeiras: jsonb('bandeiras').notNull().default('[]'), // bandeiras de cartão aceitas
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const comandaPagamento = pgTable('comanda_pagamento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  comandaId: uuid('comanda_id')
    .notNull()
    .references(() => comanda.id, { onDelete: 'cascade' }),
  forma: text('forma').notNull(),
  formaPagamentoId: uuid('forma_pagamento_id'),
  valor: numeric('valor').notNull().default('0'),
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
  leadTimeDias: integer('lead_time_dias').notNull().default(2),
  prazoPagamentoDias: integer('prazo_pagamento_dias').notNull().default(28),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Snapshot de estoque (fechamento) — CMV real O(1). Ver logica-negocio §1.3.
export const estoqueSnapshot = pgTable('estoque_snapshot', {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  itemId: uuid('item_id')
    .notNull()
    .references(() => itemEstoque.id, { onDelete: 'cascade' }),
  data: date('data').notNull(),
  saldo: numeric('saldo').notNull().default('0'),
  custoMedio: numeric('custo_medio').notNull().default('0'),
});

// Feriados por tenant/unidade (jornada §3).
export const feriado = pgTable('feriado', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  data: date('data').notNull(),
  nome: text('nome').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
  porcaoTamanho: numeric('porcao_tamanho'), // rende N porções = rendimento / porcaoTamanho (mig 130)
  porcaoUnidade: text('porcao_unidade'),
  validade: text('validade'),
  validadeDias: integer('validade_dias'), // etiqueta: shelf-life do manipulado (mig 136)
  validadeAbertoDias: integer('validade_aberto_dias'), // etiqueta: validade após aberto (mig 136)
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
  subFichaId: uuid('sub_ficha_id'), // ingrediente = outra ficha (sub-receita)
  insumoNome: text('insumo_nome').notNull(),
  quantidade: numeric('quantidade').notNull().default('0'),
  unidade: text('unidade'),
  fatorCorrecao: numeric('fator_correcao').notNull().default('1'),
  custoUnitario: numeric('custo_unitario').notNull().default('0'),
  // Linha só contabilizada em pedido EXTERNO (delivery): embalagens etc. (mig 147).
  somenteDelivery: boolean('somente_delivery').notNull().default(false),
  ordem: integer('ordem').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== Ordem de produção (mig 130) — pedido de produção interna a partir de ficha.
// O PLANO; a execução (baixa insumos + entrada do produzido) é o `produzir()`,
// disparado na conclusão com a quantidade REAL.
export const ordemProducao = pgTable('ordem_producao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  fichaId: uuid('ficha_id')
    .notNull()
    .references(() => fichaTecnica.id, { onDelete: 'cascade' }),
  itemSaidaId: uuid('item_saida_id'),
  quantidadePlanejada: numeric('quantidade_planejada').notNull().default('1'),
  quantidadeProduzida: numeric('quantidade_produzida'),
  unidade: text('unidade').notNull().default('un'),
  dataProducao: date('data_producao').notNull(),
  horaInicio: time('hora_inicio'),
  horaFim: time('hora_fim'),
  setorId: uuid('setor_id'),
  funcaoId: uuid('funcao_id'),
  colaboradorId: uuid('colaborador_id'),
  // planejada | liberada | em_producao | concluida_total | concluida_parcial
  // | nao_concluida | aguardando_lancamento | pendencia_critica | cancelada
  status: text('status').notNull().default('planejada'),
  iniciadaEm: timestamp('iniciada_em', { withTimezone: true }),
  concluidaEm: timestamp('concluida_em', { withTimezone: true }),
  concluidaPorId: uuid('concluida_por_id'), // assinatura digital (PIN)
  motivo: text('motivo'),
  obs: text('obs'),
  refId: uuid('ref_id'), // idempotência do produzir()
  // Encomenda de atacado (mig 185): amarra a ordem à venda que a originou.
  comandaId: uuid('comanda_id'),
  origem: text('origem'), // ex.: 'encomenda_atacado'
  dataEntrega: date('data_entrega'), // data combinada de entrega/retirada
  canais: jsonb('canais').notNull().default('[]'), // ["app","kds","linha_tempo","impressao"]
  kdsEquipamentoId: uuid('kds_equipamento_id'),
  impressoraId: uuid('impressora_id'),
  tarefaInstanciaId: uuid('tarefa_instancia_id'),
  tarefaDefId: uuid('tarefa_def_id'), // recorrência (mig 130, fase 3)
  criadoPorId: uuid('criado_por_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ===== Catálogo de produtos (Fase J) — o que se vende no PDV =====
export const categoriaProduto = pgTable('categoria_produto', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  parentId: uuid('parent_id'), // null = categoria; preenchido = subcategoria
  ordem: integer('ordem').notNull().default(0),
  ativo: boolean('ativo').notNull().default(true),
  imagemRef: text('imagem_ref'), // foto da categoria (Fase 1 catálogo)
  descricao: text('descricao'),
  // Janelas de disponibilidade [{ dias:[0..6], inicio:'HH:MM', fim:'HH:MM' }]; vazio = sempre.
  disponibilidade: jsonb('disponibilidade').notNull().default('[]'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), // LWW no sync bidirecional (P3)
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // soft-delete p/ sync (P3)
});

export const produto = pgTable('produto', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  codigo: text('codigo'), // SKU / índice p/ integrações
  nome: text('nome').notNull(),
  descricao: text('descricao'),
  categoriaId: uuid('categoria_id'),
  fichaId: uuid('ficha_id'), // baixa por explosão (null = sem baixa)
  // Item de estoque de revenda (industrializado): fonte de custo (custo médio) e
  // baixa direta na venda. null = não é revenda vinculada (mig 148).
  itemId: uuid('item_id'),
  tipo: text('tipo').notNull().default('simples'), // simples | variavel | combo
  unidadeMedida: text('unidade_medida').notNull().default('un'),
  precoVenda: numeric('preco_venda').notNull().default('0'),
  // Fonte de custo (prioridade): preco_custo (override) → ficha → item de estoque.
  precoCusto: numeric('preco_custo'), // null = usa custo da ficha / custo médio
  controlaEstoque: boolean('controla_estoque').notNull().default(true),
  validadeDias: integer('validade_dias'),
  // Etiquetas de validade (mig 136) — fonte do rótulo RDC 216
  controlaValidade: boolean('controla_validade').notNull().default(false),
  validadeFechadoDias: integer('validade_fechado_dias'), // shelf-life fechado
  validadeAbertoDias: integer('validade_aberto_dias'), // validade após aberto (≤30)
  vaiParaProducao: boolean('vai_para_producao').notNull().default(true),
  setorProducaoId: uuid('setor_producao_id'), // roteamento KDS (fallback do setor)
  tempoPreparoMin: integer('tempo_preparo_min'), // p/ cores do KDS
  // Loja / cardápio (Fase L1)
  precoPromocional: numeric('preco_promocional'),
  selos: jsonb('selos').notNull().default('[]'),
  // Canais de integração (delivery) em que o produto está pausado/oculto (mig 150).
  // Ex.: ['ifood','99food']. Vazio = disponível em todos os canais ativos.
  canaisPausados: jsonb('canais_pausados').notNull().default('[]'),
  disponivelCardapio: boolean('disponivel_cardapio').notNull().default(true),
  pausadoEstoque: boolean('pausado_estoque').notNull().default(false), // auto-pausa por estoque
  pausaMotivo: text('pausa_motivo'), // motivo do "esgotado" (aparece no aviso geral)
  permiteNegativo: boolean('permite_negativo').notNull().default(false), // reativado sem estoque (contagem negativa)
  disponivelBalcao: boolean('disponivel_balcao').notNull().default(true), // canal PDV
  destaque: boolean('destaque').notNull().default(false), // upsell "peça também"
  atacadoAtivo: boolean('atacado_ativo').notNull().default(false), // liga faixas de atacado (mig 184)
  vendaMultiplo: integer('venda_multiplo'),
  duracaoMin: integer('duracao_min'),
  gtin: text('gtin'),
  cstPis: text('cst_pis'),
  aliqPis: numeric('aliq_pis'),
  cstCofins: text('cst_cofins'),
  aliqCofins: numeric('aliq_cofins'),
  // Fiscais (Fase G) — Simples usa csosn; Normal usa cstIcms.
  ncm: text('ncm'),
  cfop: text('cfop'),
  cest: text('cest'),
  origem: text('origem').default('0'),
  csosn: text('csosn').default('102'),
  cstIcms: text('cst_icms'),
  unidadeTrib: text('unidade_trib'),
  aliqIcms: numeric('aliq_icms'),
  imagemRef: text('imagem_ref'),
  ativo: boolean('ativo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// "Peça também": sugestões vinculadas ao produto (cadastro). Prioridade sobre a
// sugestão automática (mais vendidos) no cardápio público.
export const produtoSugestao = pgTable('produto_sugestao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  produtoId: uuid('produto_id')
    .notNull()
    .references(() => produto.id, { onDelete: 'cascade' }),
  sugeridoId: uuid('sugerido_id')
    .notNull()
    .references(() => produto.id, { onDelete: 'cascade' }),
  ordem: integer('ordem').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const produtoVariacao = pgTable('produto_variacao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  produtoId: uuid('produto_id')
    .notNull()
    .references(() => produto.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  codigo: text('codigo'),
  precoVenda: numeric('preco_venda').notNull().default('0'),
  fatorFicha: numeric('fator_ficha').notNull().default('1'),
  atributos: jsonb('atributos').notNull().default('{}'), // grade: {tamanho, cor} (L4)
  ativo: boolean('ativo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const produtoComboItem = pgTable('produto_combo_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  comboProdutoId: uuid('combo_produto_id')
    .notNull()
    .references(() => produto.id, { onDelete: 'cascade' }),
  componenteProdutoId: uuid('componente_produto_id')
    .notNull()
    .references(() => produto.id, { onDelete: 'cascade' }),
  quantidade: numeric('quantidade').notNull().default('1'),
});

// ===== Vendas & comandas (Fase J) =====
// Mesa (Fase F2) — agrupa comandas; dono = colaborador/PDV que abriu.
export const mesa = pgTable('mesa', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  numero: text('numero').notNull(),
  nome: text('nome'),
  status: text('status').notNull().default('aberta'), // aberta | fechada
  modo: text('modo').notNull().default('mesa'), // mesa (1 comanda) | comandas (por cliente)
  donoId: uuid('dono_id'), // PDV/colaborador que abriu (roteia o garçom)
  equipamentoId: uuid('equipamento_id'), // ponto de salão (sub-PDV) que abriu a mesa (mig 133)
  abertaEm: timestamp('aberta_em', { withTimezone: true }).notNull().defaultNow(),
  abertaPorId: uuid('aberta_por_id'),
  fechadaEm: timestamp('fechada_em', { withTimezone: true }),
  fechadaPorId: uuid('fechada_por_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const comanda = pgTable('comanda', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  mesa: text('mesa'),
  senha: integer('senha'), // senha sequencial central (Fase F4) — via do cliente
  mesaId: uuid('mesa_id'), // agrupador (Fase F2) — comanda pertence a uma mesa
  identificador: text('identificador'), // cliente/pulseira/nº da comanda na mesa
  cliente: text('cliente'),
  status: text('status').notNull().default('aberta'), // aberta|fechada|cancelada
  idempotencyKey: text('idempotency_key'), // dedup de venda balcão (offline-first)
  cpf: text('cpf'), // CPF na nota (venda de totem/externa — L-VEN-1)
  consumo: text('consumo'), // 'local' (comer aqui) | 'viagem' — totem/externa (mig 151)
  taxaServicoPct: numeric('taxa_servico_pct').notNull().default('0'),
  abertaEm: timestamp('aberta_em', { withTimezone: true }).notNull().defaultNow(),
  fechadaEm: timestamp('fechada_em', { withTimezone: true }),
  abertaPorId: uuid('aberta_por_id'),
  obs: text('obs'),
  total: numeric('total'), // snapshot do total (cupom)
  forma: text('forma'), // forma de pagamento (cupom)
  origemEquipamentoId: uuid('origem_equipamento_id'), // ponto de salão que abriu (cabeçalho cozinha, mig 133)
  canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
  canceladaPorId: uuid('cancelada_por_id'),
  motivoCancelamento: text('motivo_cancelamento'),
  estoqueReaproveitado: boolean('estoque_reaproveitado'), // cancelamento: null=n/a, true=reaproveitado, false=perda (mig 128)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), // sync v2 (LWW)
});

export const comandaItem = pgTable('comanda_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  comandaId: uuid('comanda_id')
    .notNull()
    .references(() => comanda.id, { onDelete: 'cascade' }),
  produtoId: uuid('produto_id'),
  variacaoId: uuid('variacao_id'),
  fichaId: uuid('ficha_id'),
  descricao: text('descricao').notNull(),
  quantidade: numeric('quantidade').notNull().default('1'),
  precoUnitario: numeric('preco_unitario').notNull().default('0'),
  observacao: text('observacao'), // obs por item (Fase F4): "sem sal", "bem passado"
  origemEquipamentoId: uuid('origem_equipamento_id'), // ponto de salão que lançou (cabeçalho cozinha, mig 133)
  criadoPorId: uuid('criado_por_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), // LWW sync (mig 121; gatilho mig 095)
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
  descricao: text('descricao'), // objetivo
  alcance: text('alcance'),
  responsavelExecuta: text('responsavel_executa'),
  responsavelSupervisiona: text('responsavel_supervisiona'),
  materiais: text('materiais'),
  revisaoMeses: integer('revisao_meses').default(12),
  logoRef: text('logo_ref'),
  formato: text('formato').notNull().default('listado'), // listado | ilustrado
  estiloIlustracao: text('estilo_ilustracao'), // profissional, dinamico, …
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
  // Cadeia à prova de adulteração (mig 153): seq monotônico por tenant + hash
  // encadeado (hash = sha256(prev_hash | registro canônico)). Remover/alterar um
  // registro quebra a cadeia — detectável por `verificarCadeia`.
  seq: integer('seq'),
  prevHash: text('prev_hash'),
  hash: text('hash'),
});

// ── Mural & Clima (migration 026) ────────────────────────────────────────────
export const comunicado = pgTable('comunicado', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  setorId: uuid('setor_id'),
  autorColaboradorId: uuid('autor_colaborador_id').references(() => colaborador.id),
  titulo: text('titulo').notNull(),
  corpo: text('corpo'),
  audiencia: text('audiencia').notNull().default('loja'), // 'loja' | 'setor'
  fixado: boolean('fixado').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const comunicadoLeitura = pgTable(
  'comunicado_leitura',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => empresa.id, { onDelete: 'cascade' }),
    comunicadoId: uuid('comunicado_id')
      .notNull()
      .references(() => comunicado.id, { onDelete: 'cascade' }),
    colaboradorId: uuid('colaborador_id')
      .notNull()
      .references(() => colaborador.id, { onDelete: 'cascade' }),
    lidoEm: timestamp('lido_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uqLeitura: unique().on(t.comunicadoId, t.colaboradorId) }),
);

export const climaPesquisa = pgTable('clima_pesquisa', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  titulo: text('titulo').notNull(),
  aberta: boolean('aberta').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Resposta ANÔNIMA: sem colaborador_id de propósito (LGPD).
export const climaResposta = pgTable('clima_resposta', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  pesquisaId: uuid('pesquisa_id')
    .notNull()
    .references(() => climaPesquisa.id, { onDelete: 'cascade' }),
  humor: integer('humor').notNull(), // 1..5
  comentario: text('comentario'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Participação: só marca QUE respondeu (contagem + trava voto duplo), sem tocar no conteúdo.
export const climaParticipacao = pgTable(
  'clima_participacao',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => empresa.id, { onDelete: 'cascade' }),
    pesquisaId: uuid('pesquisa_id')
      .notNull()
      .references(() => climaPesquisa.id, { onDelete: 'cascade' }),
    colaboradorId: uuid('colaborador_id')
      .notNull()
      .references(() => colaborador.id, { onDelete: 'cascade' }),
    respondeuEm: timestamp('respondeu_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uqParticipacao: unique().on(t.pesquisaId, t.colaboradorId) }),
);

// ── Bot de Suporte (migration 027) ───────────────────────────────────────────
export const botRegra = pgTable('bot_regra', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  tipo: text('tipo').notNull(),
  gatilhos: text('gatilhos').notNull(), // palavras-chave separadas por vírgula
  resposta: text('resposta').notNull(),
  escala: text('escala').notNull().default('nunca'), // nunca|sempre|condicional
  escalaCondicao: text('escala_condicao'),
  ativa: boolean('ativa').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const alertaEstoque = pgTable('alerta_estoque', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  tipo: text('tipo').notNull(), // ponto_pedido | validade
  titulo: text('titulo').notNull(),
  detalhe: text('detalhe'),
  prioridade: text('prioridade').notNull().default('alta'), // alta | danger
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  resolvidoEm: timestamp('resolvido_em', { withTimezone: true }),
  resolvidoPor: uuid('resolvido_por'),
});

export const botAtendimento = pgTable('bot_atendimento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  colaboradorId: uuid('colaborador_id').references(() => colaborador.id),
  pergunta: text('pergunta').notNull(),
  regraId: uuid('regra_id').references(() => botRegra.id, { onDelete: 'set null' }),
  escalado: boolean('escalado').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Opção reutilizável do catálogo (Fase 2, migration 114) ────────────────────
// tipo: simples (produto simples) | ficha (preparado c/ ficha) | insumo (comprado pronto).
export const opcao = pgTable('opcao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  codigoPdv: text('codigo_pdv'),
  descricao: text('descricao'),
  imagemRef: text('imagem_ref'),
  tipo: text('tipo').notNull().default('simples'), // simples | ficha | insumo
  precoCusto: numeric('preco_custo').notNull().default('0'),
  controlaEstoque: boolean('controla_estoque').notNull().default(false),
  fichaId: uuid('ficha_id'),
  itemId: uuid('item_id'),
  produtoRefId: uuid('produto_ref_id'),
  padraoMarcada: boolean('padrao_marcada').notNull().default(false), // pré-selecionada (ex.: Talheres? Sim) — mig 126
  ativo: boolean('ativo').notNull().default(true), // invisível = false
  esgotado: boolean('esgotado').notNull().default(false), // pausa/esgotado
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // soft-delete p/ sync (P3)
});

// ── Complemento reutilizável (etapa) do catálogo (Fase 3, migration 115) ──────
export const complemento = pgTable('complemento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  regra: text('regra').notNull().default('uma'), // uma | varias_sem_repeticao | varias_com_repeticao
  obrigatorio: boolean('obrigatorio').notNull().default(false),
  min: integer('min').notNull().default(0),
  max: integer('max'),
  canais: jsonb('canais').notNull().default('["delivery","balcao","mesa_publico","mesa_interno"]'),
  ativo: boolean('ativo').notNull().default(true),
  imprimeEtiqueta: boolean('imprime_etiqueta').notNull().default(false), // gera etiqueta do item (mig 168, Fase 5)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // soft-delete p/ sync (P3)
});

export const complementoItem = pgTable('complemento_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  complementoId: uuid('complemento_id').notNull(),
  opcaoId: uuid('opcao_id').notNull(),
  preco: numeric('preco').notNull().default('0'),
  padraoMarcada: boolean('padrao_marcada').notNull().default(false), // pré-selecionada — mig 126
  ordem: integer('ordem').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), // LWW sync (P3)
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // soft-delete p/ sync (P3)
});

// Produto ↔ complemento reutilizável (etapas do produto), materializado no motor. (Fase 4)
export const produtoComplemento = pgTable('produto_complemento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  produtoId: uuid('produto_id').notNull(),
  complementoId: uuid('complemento_id').notNull(),
  ordem: integer('ordem').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), // LWW sync (P3)
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // soft-delete p/ sync (P3)
});

// ── Complementos de produto (opcionais/adicionais) — migration 032 ────────────
export const complementoGrupo = pgTable('complemento_grupo', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  produtoId: uuid('produto_id').notNull(),
  nome: text('nome').notNull(),
  tipo: text('tipo').notNull(), // remover | adicionar
  min: integer('min').notNull().default(0),
  max: integer('max'),
  obrigatorio: boolean('obrigatorio').notNull().default(false),
  ordem: integer('ordem').notNull().default(0),
  origemComplementoId: uuid('origem_complemento_id'), // materializado do complemento reutilizável (Fase 4)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), // LWW/push sync (P3)
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // soft-delete p/ sync ao edge (P2)
});

export const complementoOpcao = pgTable('complemento_opcao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  grupoId: uuid('grupo_id').notNull(),
  nome: text('nome').notNull(),
  precoDelta: numeric('preco_delta').notNull().default('0'),
  produtoRefId: uuid('produto_ref_id'), // 'escolha': opção que é um produto (ex.: bebida)
  fichaIngredienteId: uuid('ficha_ingrediente_id'), // 'remover': ingrediente a NÃO baixar
  itemId: uuid('item_id'), // 'adicionar': item de estoque a baixar
  quantidade: numeric('quantidade').notNull().default('1'),
  // mig 126 — discriminador no MOTOR: sem codigo_pdv => informativa (nota, sem estoque/preço).
  codigoPdv: text('codigo_pdv'),
  controlaEstoque: boolean('controla_estoque').notNull().default(false),
  padraoMarcada: boolean('padrao_marcada').notNull().default(false),
  ordem: integer('ordem').notNull().default(0),
  origemOpcaoId: uuid('origem_opcao_id'), // materializado da opção reutilizável (Fase 4)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), // LWW/push sync (P3)
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // soft-delete p/ sync ao edge (P2)
});

export const comandaItemComplemento = pgTable('comanda_item_complemento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  comandaItemId: uuid('comanda_item_id').notNull(),
  opcaoId: uuid('opcao_id'),
  tipo: text('tipo').notNull(),
  nome: text('nome').notNull(),
  precoDelta: numeric('preco_delta').notNull().default('0'),
  fichaIngredienteId: uuid('ficha_ingrediente_id'),
  itemId: uuid('item_id'),
  produtoRefId: uuid('produto_ref_id'), // combo por etapa (L5): produto a explodir
  quantidade: numeric('quantidade').notNull().default('1'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== Produção (Fase F1) — roteamento + pedidos duráveis =====
// Destinos de produção por produto (N:N) — cada destino é um equipamento (KDS/impressora).
export const produtoDestinoProducao = pgTable('produto_destino_producao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  produtoId: uuid('produto_id')
    .notNull()
    .references(() => produto.id, { onDelete: 'cascade' }),
  equipamentoId: uuid('equipamento_id')
    .notNull()
    .references(() => equipamento.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Padrão do setor — herdado quando o produto não define destino próprio.
export const setorDestinoProducao = pgTable('setor_destino_producao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  setorId: uuid('setor_id')
    .notNull()
    .references(() => setor.id, { onDelete: 'cascade' }),
  equipamentoId: uuid('equipamento_id')
    .notNull()
    .references(() => equipamento.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Destino próprio de COMPLEMENTO (etapa) e OPÇÃO (mig 127). Vazio = herda do produto.
export const complementoDestinoProducao = pgTable('complemento_destino_producao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  complementoId: uuid('complemento_id')
    .notNull()
    .references(() => complemento.id, { onDelete: 'cascade' }),
  equipamentoId: uuid('equipamento_id')
    .notNull()
    .references(() => equipamento.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const opcaoDestinoProducao = pgTable('opcao_destino_producao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  opcaoId: uuid('opcao_id')
    .notNull()
    .references(() => opcao.id, { onDelete: 'cascade' }),
  equipamentoId: uuid('equipamento_id')
    .notNull()
    .references(() => equipamento.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Pedido de produção durável — um por (comanda, destino). PDV é dono do ciclo.
export const producaoPedido = pgTable('producao_pedido', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  comandaId: uuid('comanda_id'),
  destinoEquipamentoId: uuid('destino_equipamento_id'),
  destinoTipo: text('destino_tipo').notNull().default('kds'), // kds | impressora
  setorId: uuid('setor_id'),
  numero: integer('numero'),
  senha: integer('senha'), // senha da comanda/venda (Fase F4) — exibida no KDS/entrega
  origem: text('origem').notNull().default('balcao'), // balcao|mesa|comanda|garcom|delivery
  plataforma: text('plataforma'), // origem externa (ex.: "Cardápio", "iFood")
  senhaPlataforma: text('senha_plataforma'), // senha/nº do pedido na plataforma
  mesa: text('mesa'),
  status: text('status').notNull().default('recebido'), // recebido|preparo|pronto|entregue|cancelado
  tempoPreparoMin: integer('tempo_preparo_min'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  iniciadoEm: timestamp('iniciado_em', { withTimezone: true }),
  prontoEm: timestamp('pronto_em', { withTimezone: true }),
  entregueEm: timestamp('entregue_em', { withTimezone: true }),
  canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
  canceladoPorId: uuid('cancelado_por_id'),
  obs: text('obs'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), // sync v2 (LWW)
});

export const producaoPedidoItem = pgTable('producao_pedido_item', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  pedidoId: uuid('pedido_id')
    .notNull()
    .references(() => producaoPedido.id, { onDelete: 'cascade' }),
  comandaItemId: uuid('comanda_item_id'),
  descricao: text('descricao').notNull(),
  quantidade: numeric('quantidade').notNull().default('1'),
  complementosTexto: text('complementos_texto'),
  observacao: text('observacao'), // obs do item (Fase F4)
  status: text('status').notNull().default('ok'), // ok | alterado | removido
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), // LWW sync (mig 121; gatilho mig 095)
});

// Job de impressão térmica (Fase F3) — puxado pelo worker do edge (servidor_local).
export const impressaoJob = pgTable('impressao_job', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  equipamentoId: uuid('equipamento_id'),
  pedidoId: uuid('pedido_id'),
  comandaId: uuid('comanda_id'), // venda de origem (mig 177) — idempotência do materializador do edge
  via: text('via').notNull().default('producao'), // producao | conferencia
  conteudo: text('conteudo').notNull(),
  status: text('status').notNull().default('pendente'), // pendente | enviando | impresso | erro
  tentativas: integer('tentativas').notNull().default(0),
  erro: text('erro'),
  // Reserva atômica anti-duplo-print (mig 221, P0): o worker seta 'enviando' + claim_ate antes
  // de imprimir; outro worker/poll só re-pega se a lease (claim_ate) venceu.
  claimPor: text('claim_por'),
  claimAte: timestamp('claim_ate', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  impressoEm: timestamp('impresso_em', { withTimezone: true }),
});

// Marcador edge-local (mig 177): comandas que o materializador de impressão do edge
// já processou — evita reimprimir a cada ciclo. NÃO entra no sync (edge-only).
export const impressaoEdgeFeito = pgTable('impressao_edge_feito', {
  comandaId: uuid('comanda_id').primaryKey(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Limiares de cor do KDS por unidade (minutos): <=verde, <=amarelo, acima=vermelho.
export const kdsCorConfig = pgTable('kds_cor_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  verdeAteMin: integer('verde_ate_min').notNull().default(5),
  amareloAteMin: integer('amarelo_ate_min').notNull().default(10),
  usaPreparo: boolean('usa_preparo').notNull().default(true), // etapa "preparo" opcional
  usaEntregue: boolean('usa_entregue').notNull().default(true), // etapa "entregue" opcional
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Motor de alertas do KDS (mig 158) — cadastrados pelo presidente/C&O/gerente,
// exibidos no RODAPÉ do KDS. tipo=agendado (horários+dias) | condicional (limiar).
export const kdsAlertaConfig = pgTable('kds_alerta_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  titulo: text('titulo').notNull(),
  detalhe: text('detalhe'),
  prioridade: text('prioridade').notNull().default('alta'), // danger|alta|info|ok
  tipo: text('tipo').notNull().default('agendado'), // agendado | condicional
  horarios: jsonb('horarios').notNull().default('[]'), // ["11:00","15:00"]
  diasSemana: jsonb('dias_semana').notNull().default('[0,1,2,3,4,5,6]'), // 0=dom..6=sáb
  condicao: jsonb('condicao'), // { fonte, operador, limiar }
  duracaoSeg: integer('duracao_seg').notNull().default(60),
  ativo: boolean('ativo').notNull().default(true),
  criadoPor: uuid('criado_por'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Contador central de senha por unidade (Fase F4) — atômico, com reset.
export const senhaContador = pgTable('senha_contador', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  valor: integer('valor').notNull().default(0),
  periodo: text('periodo').notNull().default('diario'), // diario | semanal | nunca
  ultimoReset: date('ultimo_reset').notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== Fiscal (Fase G) — NFC-e modelo 65 =====
export const fiscalConfig = pgTable('fiscal_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  ativo: boolean('ativo').notNull().default(false),
  ambiente: text('ambiente').notNull().default('2'), // 1 produção | 2 homologação
  regime: text('regime').notNull().default('simples'), // simples | normal
  crt: integer('crt').notNull().default(1),
  serie: integer('serie').notNull().default(1),
  proximoNumero: integer('proximo_numero').notNull().default(1),
  cnpj: text('cnpj'),
  razaoSocial: text('razao_social'),
  nomeFantasia: text('nome_fantasia'),
  ie: text('ie'),
  uf: text('uf'),
  codigoUf: integer('codigo_uf'),
  codigoMunicipio: integer('codigo_municipio'),
  endereco: text('endereco'),
  cscId: text('csc_id'),
  cscToken: text('csc_token'),
  certRef: text('cert_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notaFiscal = pgTable('nota_fiscal', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  comandaId: uuid('comanda_id'),
  modelo: text('modelo').notNull().default('65'),
  serie: integer('serie').notNull(),
  numero: integer('numero').notNull(),
  chave: text('chave'),
  ambiente: text('ambiente').notNull().default('2'),
  status: text('status').notNull().default('pendente'), // pendente|autorizada|rejeitada|cancelada|contingencia
  protocolo: text('protocolo'),
  motivo: text('motivo'),
  qrcode: text('qrcode'),
  xml: text('xml'),
  valorTotal: numeric('valor_total').notNull().default('0'),
  emitidaPorId: uuid('emitida_por_id'),
  emitidaEm: timestamp('emitida_em', { withTimezone: true }),
  canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
  canceladaPorId: uuid('cancelada_por_id'),
  justificativaCancelamento: text('justificativa_cancelamento'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== Delivery / canais externos (Fase H) =====
export const deliveryConfig = pgTable('delivery_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  ativo: boolean('ativo').notNull().default(false),
  autoAceitar: boolean('auto_aceitar').notNull().default(false),
  merchantId: text('merchant_id'),
  // Visibilidade das colunas do kanban: { chegada, producao, rota, finalizado }.
  colunas: jsonb('colunas')
    .notNull()
    .default('{"chegada":true,"producao":true,"pronto":true,"rota":true,"finalizado":true}'),
  // Horas que um pedido finalizado (concluído/cancelado) fica visível no quadro (mig 137).
  finalizadoHoras: integer('finalizado_horas').notNull().default(5),
  // Layout do cupom (via do cliente) nas térmicas — toggles + cabeçalho/rodapé.
  // Vazio = comportamento padrão. Ver renderViaCliente (mig 131).
  cupomLayout: jsonb('cupom_layout').notNull().default('{}'),
  // Perfis de cupom (mig 161, Fase 1): overrides por perfil (caixa/entregador/producao)
  // — { caixa: { campos: [{key,visivel,negrito,alinhamento}...] }, ... }. Vazio = padrão
  // (CUPOM_PERFIS_PADRAO). Cabeçalho/rodapé continuam livres (cupom_layout).
  cupomPerfis: jsonb('cupom_perfis').notNull().default('{}'),
  // Adiar a via de produção até o pedido avançar no KDS (mig 169, Fase 6): em vez
  // de imprimir no registro, imprime só ao avançar num KDS com imprime_ao_avancar.
  adiarProducaoAteKds: boolean('adiar_producao_ate_kds').notNull().default(false),
  // QR de despacho: ligado, o entregador lê o QR do cupom e despacha sozinho;
  // desligado, o AVANÇAR abre o modal de seleção de entregador (mig 165).
  qrDespacho: boolean('qr_despacho').notNull().default(false),
  // Imprimir o QR de despacho já na 1ª via do caixa dos pedidos EXTERNOS (delivery):
  // ligado (padrão), a comanda do caixa sai com o QR — o entregador escaneia direto
  // dela, dispensando o cupom do entregador separado (mig 211, aditiva, edge lê).
  imprimirQrComanda: boolean('imprimir_qr_comanda').notNull().default(true),
  // Pausa temporária (reativa sozinha ao passar de pausado_ate).
  pausadoAte: timestamp('pausado_ate', { withTimezone: true }),
  pausaMotivo: text('pausa_motivo'),
  // Faixas de tempo de preparo (min–max) por tipo.
  prepBalcaoMin: integer('prep_balcao_min').notNull().default(15),
  prepBalcaoMax: integer('prep_balcao_max').notNull().default(25),
  prepDeliveryMin: integer('prep_delivery_min').notNull().default(45),
  prepDeliveryMax: integer('prep_delivery_max').notNull().default(55),
  setorId: uuid('setor_id'), // setor de produção do delivery (opcional)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pedidoExterno = pgTable('pedido_externo', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  canal: text('canal').notNull().default('ifood'),
  externalId: text('external_id'),
  clientRef: text('client_ref'), // idempotência do pedido público (UUID do cliente)
  displayId: text('display_id'),
  clienteNome: text('cliente_nome'),
  clienteTelefone: text('cliente_telefone'),
  clienteTelefone2: text('cliente_telefone2'),
  tipo: text('tipo').notNull().default('entrega'),
  endereco: text('endereco'),
  enderecoRua: text('endereco_rua'),
  enderecoNumero: text('endereco_numero'),
  enderecoReferencia: text('endereco_referencia'),
  enderecoBairro: text('endereco_bairro'),
  itens: jsonb('itens').notNull().default('[]'),
  total: numeric('total').notNull().default('0'),
  formaPagamento: text('forma_pagamento'),
  status: text('status').notNull().default('novo'),
  comandaId: uuid('comanda_id'),
  clienteId: uuid('cliente_id'), // cliente identificado (link mágico) — histórico

  raw: jsonb('raw'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  confirmadoEm: timestamp('confirmado_em', { withTimezone: true }),
  prontoEm: timestamp('pronto_em', { withTimezone: true }),
  despachadoEm: timestamp('despachado_em', { withTimezone: true }),
  concluidoEm: timestamp('concluido_em', { withTimezone: true }),
  canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
  motivoCancelamento: text('motivo_cancelamento'),
  // Checkout da Loja (Fase L3)
  taxaEntrega: numeric('taxa_entrega').notNull().default('0'),
  cupom: text('cupom'),
  desconto: numeric('desconto').notNull().default('0'),
  trocoPara: numeric('troco_para'),
  pago: boolean('pago').notNull().default(false),
  statusPagamento: text('status_pagamento').notNull().default('na_entrega'), // na_entrega|aguardando|aprovado|orcamento
  gatewayPaymentId: text('gateway_payment_id'), // id do pagamento no gateway (Mercado Pago) p/ webhook
  gatewayProvider: text('gateway_provider'), // 'mercadopago' | null — qual API o webhook consulta

  agendamento: timestamp('agendamento', { withTimezone: true }), // serviços (L4)
  profissional: text('profissional'),
  cnpj: text('cnpj'), // indústria (faturamento)
  bandeira: text('bandeira'), // forma de cartão escolhida (rótulo livre)
  numero: integer('numero'), // sequencial do dia (o "#284" do card)
  entregadorId: uuid('entregador_id'), // atribuído no despacho
  entregadorNome: text('entregador_nome'),
  entregadorTelefone: text('entregador_telefone'), // snapshot no despacho
  despachoToken: text('despacho_token'), // QR do entregador (mig 162, Fase 4)
  autoAceiteFalhou: boolean('auto_aceite_falhou').notNull().default(false),
  alterado: boolean('alterado').notNull().default(false),
  alteradoEm: timestamp('alterado_em', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }), // soft-delete p/ contrato do sync 'ambos' (mig 125); na prática só cancela por status
  estoqueReaproveitado: boolean('estoque_reaproveitado'), // cancelamento: null=n/a, true=reaproveitado (estorna baixa), false=perda (mig 128)
  // Hub PDV "Retirada / Encomendas" (mig 132)
  pagoOnline: boolean('pago_online').notNull().default(false), // já pago no online (só entregar)
  retiradaTipo: text('retirada_tipo'), // retirada | encomenda | null(entrega/local)
  // Sinal (entrada) da encomenda (mig 188) — cobrado via PIX reaproveitando gateway_payment_id.
  sinalPct: numeric('sinal_pct'),
  sinalValor: numeric('sinal_valor'),
  sinalStatus: text('sinal_status'), // null/'nao' | pendente | pago | reembolsado | perdido
  cancelavelAte: timestamp('cancelavel_ate', { withTimezone: true }), // limite p/ cancelar com reembolso
  avisadoCancelamentoEm: timestamp('avisado_cancelamento_em', { withTimezone: true }), // lembrete de prazo enviado (mig 189)
  recorrenciaId: uuid('recorrencia_id'), // ocorrência gerada por uma recorrência (mig 190)
  caixaSessaoId: uuid('caixa_sessao_id'), // caixa (turno) onde o a-pagar entrou
  atendenteId: uuid('atendente_id'), // quem cobrou/entregou no balcão
  entregueEm: timestamp('entregue_em', { withTimezone: true }),
  entregadorFechamentoId: uuid('entregador_fechamento_id'), // pedido já acertado no fechamento (mig 207, cloud-only)
  codigoEntrega: text('codigo_entrega'), // código de 4 díg. do cliente p/ confirmar entrega própria (mig 209, cloud-only)
  saidaId: uuid('saida_id'), // saída/roteiro multi-parada (mig 210, cloud-only)
  ordemParada: integer('ordem_parada'), // ordem da parada na saída (1..N)
  reservadoEm: timestamp('reservado_em', { withTimezone: true }), // batch do entregador antes de "Iniciar" (mig 223)
  rastreioToken: text('rastreio_token'), // token público do link de rastreio do cliente (mig 210, cloud-only)
  avisadoProntoEm: timestamp('avisado_pronto_em', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(), // sync v2 (LWW)
});

// Cliente do cardápio (link mágico assinado): perfil por telefone, endereços
// salvos e histórico (via pedido_externo.cliente_id). LGPD: consentimento.
export const cliente = pgTable('cliente', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome'),
  // nullable (mig 204): cliente de canal-proxy (iFood) não tem nº real → identidade
  // por (origem, origemId), não por telefone.
  telefone: text('telefone'),
  origem: text('origem'), // null = base própria (telefone); ex.: 'ifood'
  origemId: text('origem_id'), // id do cliente no canal de origem
  consentimentoLgpd: boolean('consentimento_lgpd').notNull().default(false),
  // Agregados de CRM (mig 194) — recência/frequência/valor materializados p/
  // segmentação rápida; mantidos pelo ingest (todos os canais) + backfill. Uso interno.
  primeiroPedidoEm: timestamp('primeiro_pedido_em', { withTimezone: true }),
  ultimoPedidoEm: timestamp('ultimo_pedido_em', { withTimezone: true }),
  totalPedidos: integer('total_pedidos').notNull().default(0),
  totalGasto: numeric('total_gasto').notNull().default('0'),
  optOutMarketing: boolean('opt_out_marketing').notNull().default(false),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

// OTP do cliente (confirmação de telefone via WhatsApp — webhook n8n).
export const clienteOtp = pgTable('cliente_otp', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  telefone: text('telefone').notNull(),
  codigo: text('codigo'), // legado (nullable) — não gravamos mais o texto puro
  codigoHash: text('codigo_hash'), // SHA-256 do código (o que confere no confirmar)
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  tentativas: integer('tentativas').notNull().default(0),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const clienteEndereco = pgTable('cliente_endereco', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  clienteId: uuid('cliente_id')
    .notNull()
    .references(() => cliente.id, { onDelete: 'cascade' }),
  apelido: text('apelido'),
  cep: text('cep'),
  logradouro: text('logradouro'),
  numero: text('numero'),
  complemento: text('complemento'),
  bairro: text('bairro'),
  bairroId: uuid('bairro_id'), // área de atendimento (cardapio_bairro) → frete
  cidade: text('cidade'),
  referencia: text('referencia'),
  lat: numeric('lat'), // geolocalização (frete por raio)
  lng: numeric('lng'),
  principal: boolean('principal').notNull().default(false),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Link curto por cliente (slug) — URL do robô sem token JWT longo.
export const clienteLink = pgTable('cliente_link', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  clienteId: uuid('cliente_id')
    .notNull()
    .references(() => cliente.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull().unique(),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// ===== Campanhas de WhatsApp por segmento (F5) — uso interno do lojista, só nuvem =====
export const campanha = pgTable('campanha', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  criadoPor: uuid('criado_por'),
  segmento: text('segmento').notNull(),
  mensagem: text('mensagem').notNull(),
  intervaloSeg: integer('intervalo_seg').notNull().default(7), // pausa entre envios (anti-ban)
  tetoDia: integer('teto_dia'), // limite de envios/dia (null = sem teto)
  total: integer('total').notNull().default(0),
  enviados: integer('enviados').notNull().default(0),
  falhas: integer('falhas').notNull().default(0),
  status: text('status').notNull().default('enviando'), // enviando | concluida | pausada
  instanciaTipo: text('instancia_tipo').notNull().default('loja'), // loja | marketing (F5b)
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});
export const campanhaEnvio = pgTable('campanha_envio', {
  id: uuid('id').primaryKey().defaultRandom(),
  campanhaId: uuid('campanha_id')
    .notNull()
    .references(() => campanha.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull(),
  clienteId: uuid('cliente_id'),
  telefone: text('telefone').notNull(),
  status: text('status').notNull().default('pendente'), // pendente | enviado | falha | pulado
  erro: text('erro'),
  enviadoEm: timestamp('enviado_em', { withTimezone: true }),
});

// Funil de visita do cardápio (F4) — eventos ANÔNIMOS (sessão gerada no cliente,
// sem PII) p/ medir conversão. Só nuvem; por tenant. Alto volume → expurgo por retenção.
export const cardapioEvento = pgTable('cardapio_evento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  token: text('token').notNull(),
  sessao: text('sessao').notNull(),
  tipo: text('tipo').notNull(), // view_menu | add_carrinho | checkout | pagamento | pedido
  meta: jsonb('meta'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// App do Entregador (E0) — token de push (FCM) do aparelho do entregador. Só nuvem.
export const entregadorDispositivo = pgTable('entregador_dispositivo', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  colaboradorId: uuid('colaborador_id').notNull(),
  fcmToken: text('fcm_token').notNull(),
  plataforma: text('plataforma'), // android | ios
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

// App do Entregador (E4 auto) — cache das coords do pedido + flag do alerta de chegada.
export const entregadorChegada = pgTable('entregador_chegada', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  pedidoId: uuid('pedido_id').notNull().unique(),
  lat: numeric('lat'),
  lng: numeric('lng'),
  avisada: boolean('avisada').notNull().default(false),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// App do Entregador (E2) — pings de GPS durante entrega ativa. Só nuvem.
export const entregadorLocalizacao = pgTable('entregador_localizacao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  colaboradorId: uuid('colaborador_id').notNull(),
  lat: numeric('lat').notNull(),
  lng: numeric('lng').notNull(),
  precisao: numeric('precisao'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Rastreio "latest-only" (mig 222): 1 linha por entregador, UPSERTada a cada ping — substitui o
// INSERT-por-ping da entregador_localizacao (que crescia). Todos os usos leem só a última posição.
export const entregadorPosicao = pgTable('entregador_posicao', {
  colaboradorId: uuid('colaborador_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  lat: numeric('lat').notNull(),
  lng: numeric('lng').notNull(),
  precisao: numeric('precisao'),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Fila de entregadores por unidade (mig 223, Frente 2). Só o 1º 'aguardando' puxa pedido; ao
// iniciar as entregas vira 'em_entrega'; ao concluir todas, re-entra na fila.
export const entregadorFila = pgTable('entregador_fila', {
  colaboradorId: uuid('colaborador_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  unidadeId: uuid('unidade_id'),
  status: text('status').notNull().default('aguardando'), // aguardando | em_entrega
  entrouEm: timestamp('entrou_em', { withTimezone: true }).notNull().defaultNow(),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

// App do Entregador (E5) — modelo de pagamento por loja (1 por tenant). Só nuvem.
// modelo: diaria_taxas | so_diaria | so_taxas | so_taxa_fixa | diaria_taxas_fixas
export const entregadorConfig = pgTable('entregador_config', {
  tenantId: uuid('tenant_id').primaryKey(),
  modelo: text('modelo').notNull().default('diaria_taxas'),
  diariaCentavos: integer('diaria_centavos').notNull().default(0),
  taxaEntregaCentavos: integer('taxa_entrega_centavos').notNull().default(0),
  taxaFixaCentavos: integer('taxa_fixa_centavos').notNull().default(0),
  baseTaxa: text('base_taxa').notNull().default('real'), // real (taxa do pedido) | fixa (mig 207)
  periodicidade: text('periodicidade').notNull().default('dia'), // dia | semana | quinzena (mig 207)
  maxPedidosEntregador: integer('max_pedidos_entregador').notNull().default(1), // lote da saída multi-parada (mig 210)
  raioChegadaM: integer('raio_chegada_m').notNull().default(70), // geofence do aviso de chegada
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Saída / roteiro (mig 210) — lote de pedidos atribuído a um entregador numa viagem,
// com paradas em ordem otimizada. Só nuvem.
export const entregadorSaida = pgTable('entregador_saida', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  colaboradorId: uuid('colaborador_id').notNull(),
  status: text('status').notNull().default('em_rota'), // montando | em_rota | concluida
  totalParadas: integer('total_paradas').notNull().default(0),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  concluidaEm: timestamp('concluida_em', { withTimezone: true }),
});

// App do Entregador (E5) — fechamento de pagamento por entregador/dia (append-only).
export const entregadorFechamento = pgTable('entregador_fechamento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  colaboradorId: uuid('colaborador_id').notNull(),
  dataRef: text('data_ref').notNull(), // YYYY-MM-DD (dia de referência)
  modelo: text('modelo').notNull(),
  entregas: integer('entregas').notNull().default(0),
  diariaCentavos: integer('diaria_centavos').notNull().default(0),
  taxasCentavos: integer('taxas_centavos').notNull().default(0),
  totalCentavos: integer('total_centavos').notNull().default(0),
  periodoInicio: date('periodo_inicio'), // fechamento por período (mig 207)
  periodoFim: date('periodo_fim'),
  baseTaxa: text('base_taxa'), // real | fixa (mig 207)
  lancamentoCaixaId: uuid('lancamento_caixa_id'), // a sangria gerada no pagamento (mig 207)
  criadoPor: uuid('criado_por'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// App do Entregador (E5) — perfil de pagamento POR entregador (colaborador).
// Sobrepõe o padrão da loja (entregadorConfig). Só nuvem.
export const entregadorPerfilPagamento = pgTable('entregador_perfil_pagamento', {
  tenantId: uuid('tenant_id').notNull(),
  colaboradorId: uuid('colaborador_id').primaryKey(),
  modelo: text('modelo').notNull().default('diaria_taxas'),
  diariaCentavos: integer('diaria_centavos').notNull().default(0),
  taxaEntregaCentavos: integer('taxa_entrega_centavos').notNull().default(0),
  taxaFixaCentavos: integer('taxa_fixa_centavos').notNull().default(0),
  baseTaxa: text('base_taxa').notNull().default('real'), // real | fixa (mig 207)
  periodicidade: text('periodicidade').notNull().default('dia'), // dia | semana | quinzena (mig 207)
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

// App do Entregador (Fase 4) — preferência do PRÓPRIO entregador (opt-in): compartilhar
// o nome/contato dele no aviso de chegada ao cliente. Só nuvem. Default = não compartilha.
export const entregadorPreferencia = pgTable('entregador_preferencia', {
  colaboradorId: uuid('colaborador_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  compartilhaContato: boolean('compartilha_contato').notNull().default(false),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

// ===== Licença / revenda / frota (edge appliance) =====
export const revenda = pgTable('revenda', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: text('nome').notNull(),
  ativo: boolean('ativo').notNull().default(true),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Ativação/licença por loja: o token que a revenda emite; base do lease assinado.
export const ativacao = pgTable('ativacao', {
  id: uuid('id').primaryKey().defaultRandom(),
  revendaId: uuid('revenda_id'),
  tenantId: uuid('tenant_id'),
  tokenHash: text('token_hash').notNull().unique(),
  ramo: text('ramo').notNull().default('food_service'),
  plano: text('plano').notNull().default('basico'),
  modulos: jsonb('modulos').notNull().default('[]'),
  trial: boolean('trial').notNull().default(false),
  validadeAte: timestamp('validade_ate', { withTimezone: true }),
  status: text('status').notNull().default('emitido'), // emitido | ativado | suspenso | revogado
  deviceFingerprint: text('device_fingerprint'),
  // Controle de instalação anti-clone (F3, mig 220) — CLOUD-ONLY (ativacao não sincroniza):
  reauthAtivo: boolean('reauth_ativo').notNull().default(false), // trava opt-in
  reauthMetodo: text('reauth_metodo').notNull().default('email'), // 'email' | 'totp'
  reauthTotpSecret: text('reauth_totp_secret'), // base32 do app; null = não enrolado
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  ativadoEm: timestamp('ativado_em', { withTimezone: true }),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Pedidos de re-autorização de instalação (F3, mig 220) — mover o edge p/ máquina nova
// exige 2º fator (código e-mail OU TOTP). CLOUD-ONLY.
export const reautorizacaoEdge = pgTable('reautorizacao_edge', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  unidadeId: uuid('unidade_id'),
  fingerprintNovo: text('fingerprint_novo').notNull(),
  metodo: text('metodo').notNull().default('email'), // 'email' | 'totp'
  codigoHash: text('codigo_hash'),
  expiraEm: timestamp('expira_em', { withTimezone: true }),
  tentativas: integer('tentativas').notNull().default(0),
  status: text('status').notNull().default('pendente'), // pendente | aprovada | expirada
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  confirmadoEm: timestamp('confirmado_em', { withTimezone: true }),
});

// Token de integração POR LOJA (auto-atendimento GoGeM/Orzuni/Farol) — desacoplado
// do edge. Guarda só o HASH do token; escopos por token; sincroniza (edge+nuvem, LWW).
export const integracaoToken = pgTable('integracao_token', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  unidadeId: uuid('unidade_id'), // loja; null = todas as lojas do tenant
  tokenHash: text('token_hash').notNull().unique(),
  nome: text('nome'),
  escopos: text('escopos').array().notNull().default(sql`'{}'::text[]`),
  ativo: boolean('ativo').notNull().default(true),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  revogadoEm: timestamp('revogado_em', { withTimezone: true }),
  ultimoUsoEm: timestamp('ultimo_uso_em', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Cadastro pendente de verificação de e-mail (landing). A conta real só nasce após
// confirmar o código de 6 dígitos → e-mail inválido não queima o CNPJ (mig 193).
export const cadastroPendente = pgTable('cadastro_pendente', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  cnpj: text('cnpj').notNull(),
  codigoHash: text('codigo_hash').notNull(),
  payload: jsonb('payload').notNull(),
  tentativas: integer('tentativas').notNull().default(0),
  expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
  reenviadoEm: timestamp('reenviado_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Telemetria da frota: heartbeat do edge → painel da revenda.
export const edgeHeartbeat = pgTable('edge_heartbeat', {
  id: uuid('id').primaryKey().defaultRandom(),
  ativacaoId: uuid('ativacao_id'),
  tenantId: uuid('tenant_id'),
  unidadeId: uuid('unidade_id'), // saúde POR LOJA (matriz≠filial) — mig 219
  versao: text('versao'),
  estado: text('estado'),
  ultimoSync: timestamp('ultimo_sync', { withTimezone: true }),
  discoLivreMb: integer('disco_livre_mb'),
  clientes: integer('clientes'),
  fingerprint: text('fingerprint'), // hash do MachineGuid — base do controle de instalação (F3)
  saude: jsonb('saude'), // status dos 5 serviços + uptime + restore + impressora + ram — mig 219
  erro: text('erro'),
  recebidoEm: timestamp('recebido_em', { withTimezone: true }).notNull().defaultNow(),
});

// ===== TEF — pagamento integrado (Fase I) =====
export const tefConfig = pgTable('tef_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  ativo: boolean('ativo').notNull().default(false),
  provedor: text('provedor').notNull().default('mock'), // mock | sitef | paygo | stone
  terminalId: text('terminal_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pagamentoTef = pgTable('pagamento_tef', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  comandaId: uuid('comanda_id'),
  valor: numeric('valor').notNull().default('0'),
  forma: text('forma').notNull().default('credito'), // credito | debito | pix
  parcelas: integer('parcelas').notNull().default(1),
  status: text('status').notNull().default('pendente'), // pendente | aprovado | negado | cancelado
  nsu: text('nsu'),
  autorizacao: text('autorizacao'),
  bandeira: text('bandeira'),
  provedor: text('provedor'),
  mensagem: text('mensagem'),
  criadoPorId: uuid('criado_por_id'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  processadoEm: timestamp('processado_em', { withTimezone: true }),
  canceladoEm: timestamp('cancelado_em', { withTimezone: true }),
});

// ===== Cardápio digital / QR (Fase J) =====
export const cardapioConfig = pgTable('cardapio_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  token: text('token').notNull().unique(),
  ativo: boolean('ativo').notNull().default(false),
  modo: text('modo').notNull().default('mesa'), // mesa | retirada | totem
  nomePublico: text('nome_publico'),
  tema: text('tema').notNull().default('claro'), // claro | escuro | auto (Etapa 5)
  menuTheme: text('menu_theme').notNull().default('classic'), // layout: classic | fastfood | grid
  // Personalização do tema (botão "Editar tema"): { corPrimaria, mostrarDestaques,
  // mostrarBanner, mostrarUltimos, bannerIntervalo }. Vazio = defaults no código.
  temaConfig: jsonb('tema_config').notNull().default('{}'),
  // Loja / tema (Fase L2)
  ramo: text('ramo').notNull().default('food'), // food|varejo|industria|servicos
  logoEmoji: text('logo_emoji'),
  subtitulo: text('subtitulo'),
  aberto: boolean('aberto').notNull().default(true),
  tempoEntregaMin: integer('tempo_entrega_min'),
  tempoRetiradaMin: integer('tempo_retirada_min'), // estimativa de preparo p/ retirada
  pedidoMinimo: numeric('pedido_minimo'),
  avaliacao: numeric('avaliacao'),
  freteGratisAcima: numeric('frete_gratis_acima'),
  pagamentos: jsonb('pagamentos').notNull().default('[]'),
  // PIX: gateway primário (o outro é fallback). null = mercadopago (mig 173).
  pixGatewayPrioritario: text('pix_gateway_prioritario'), // 'mercadopago' | 'pagseguro' | null
  fidelidadeAtiva: boolean('fidelidade_ativa').notNull().default(false),
  whatsapp: text('whatsapp'),
  parcelasMax: integer('parcelas_max'), // varejo (L4)
  autoKds: boolean('auto_kds').notNull().default(true), // envia pedido direto ao KDS
  formasCartao: jsonb('formas_cartao').notNull().default('[]'), // rótulos de cartão aceitos
  // Loja / contatos (Fase config)
  logoRef: text('logo_ref'),
  documento: text('documento'), // cpf/cnpj
  responsavelNome: text('responsavel_nome'),
  responsavelContato: text('responsavel_contato'),
  contatoLoja: text('contato_loja'),
  instagram: text('instagram'),
  site: text('site'),
  // Endereço da loja
  endCep: text('end_cep'),
  endRua: text('end_rua'),
  endNumero: text('end_numero'),
  endBairro: text('end_bairro'),
  endCidade: text('end_cidade'),
  endEstado: text('end_estado'),
  endReferencia: text('end_referencia'),
  endComplemento: text('end_complemento'),
  endLat: numeric('end_lat'),
  endLng: numeric('end_lng'),
  // Área de atendimento: 'bairro' | 'raio' (exclusivos) + faixas de raio
  areaModo: text('area_modo').notNull().default('bairro'),
  raios: jsonb('raios').notNull().default('[]'), // [{ateKm, taxa}]
  // Tipos de pedido (independentes)
  tipoDelivery: boolean('tipo_delivery').notNull().default(true),
  tipoRetirada: boolean('tipo_retirada').notNull().default(false),
  tipoLocal: boolean('tipo_local').notNull().default(false),
  // Horários de funcionamento (jsonb). horarioUnico=true: `horarios` vale p/ os dois
  // tipos; false: retirada/local usa `horariosRetirada` (mig 160).
  horarios: jsonb('horarios').notNull().default('[]'),
  horariosRetirada: jsonb('horarios_retirada').notNull().default('[]'),
  horarioUnico: boolean('horario_unico').notNull().default(true),
  // Robô de auto atendimento (mensagens; IA depois)
  roboAtivo: boolean('robo_ativo').notNull().default(false),
  roboSaudacao: text('robo_saudacao'),
  roboAusencia: text('robo_ausencia'),
  roboPrompt: text('robo_prompt'), // base de conhecimento (futuro LLM)
  roboMensagens: jsonb('robo_mensagens').notNull().default('[]'), // [{gatilho, resposta}]
  roboPausados: jsonb('robo_pausados').notNull().default('[]'), // números com robô pausado (humano assumiu) — mig 138
  evolutionInstancia: text('evolution_instancia'), // instância WhatsApp (chave do bot multi-tenant)
  marketingInstancia: text('marketing_instancia'), // 2º WhatsApp p/ campanhas (F5b) — só envio, sem bot
  evolutionNumero: text('evolution_numero'), // número conectado (quando pareado)
  // Provedor de WhatsApp DESTA loja (mig 214). 'evolution' = pareamento por QR (nao
  // oficial); 'cloud' = API oficial da Meta. Default mantem toda loja existente como
  // esta. As colunas wa_cloud_* so valem quando provedor='cloud'.
  provedor: text('provedor').notNull().default('evolution'), // evolution | cloud
  // Phone Number ID da Meta: CHAVE MULTI-TENANT do webhook (a URL de callback e uma so
  // para todas as lojas; quem desambigua e o metadata.phone_number_id do payload).
  waCloudPhoneId: text('wa_cloud_phone_id'),
  waCloudWabaId: text('wa_cloud_waba_id'), // WABA dona do numero (Cenario B: e do lojista)
  waCloudNumero: text('wa_cloud_numero'), // numero em si, para exibir na tela
  // Regras de estorno/empilhamento de desconto (mig 125) — a loja configura.
  cancelamentoEstornaCashback: boolean('cancelamento_estorna_cashback').notNull().default(true),
  cupomBloqueiaComResgate: boolean('cupom_bloqueia_com_resgate').notNull().default(false),
  cupomMaxCashbackCent: integer('cupom_max_cashback_cent'), // null = sem limite
  fidelidadeIntervaloHoras: integer('fidelidade_intervalo_horas').notNull().default(3),
  // Modo Encomenda (mig 186) — OPT-IN: pedido para data futura + regras.
  encomendaAtiva: boolean('encomenda_ativa').notNull().default(false),
  encomendaAntecedenciaHoras: integer('encomenda_antecedencia_horas').notNull().default(24),
  encomendaHorizonteDias: integer('encomenda_horizonte_dias').notNull().default(30),
  encomendaCorte: time('encomenda_corte'), // hora de corte (opcional)
  encomendaCapacidadeDia: integer('encomenda_capacidade_dia'), // máx./dia (null = ilimitado)
  // Sinal + cancelamento da encomenda — regra BASE (mig 187). Faixas por qtd em
  // encomenda_regra_sinal sobrepõem esta base.
  encomendaExigeSinal: boolean('encomenda_exige_sinal').notNull().default(false),
  encomendaSinalPct: numeric('encomenda_sinal_pct'), // % do sinal (base)
  encomendaCancelHoras: integer('encomenda_cancel_horas'), // horas p/ cancelar com reembolso (base)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== Sinal da encomenda — regras por faixa de quantidade (mig 187) =====
export const encomendaRegraSinal = pgTable('encomenda_regra_sinal', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  minItens: integer('min_itens').notNull().default(1),
  maxItens: integer('max_itens'), // null = sem teto
  exigeSinal: boolean('exige_sinal').notNull().default(true),
  sinalPct: numeric('sinal_pct').notNull().default('50'),
  cancelHoras: integer('cancel_horas'), // prazo de cancelamento com reembolso (horas)
  ordem: integer('ordem').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== Recorrência leve de encomenda (mig 190) =====
export const encomendaRecorrencia = pgTable('encomenda_recorrencia', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  clienteId: uuid('cliente_id'),
  tipo: text('tipo').notNull().default('retirada'), // retirada | entrega
  endereco: jsonb('endereco'), // snapshot do endereço (entrega)
  formaPagamento: text('forma_pagamento'),
  itens: jsonb('itens').notNull().default('[]'), // snapshot dos itens
  dias: jsonb('dias').notNull().default('[]'), // dias da semana [0..6]
  hora: text('hora'), // 'HH:MM'
  inicio: date('inicio'),
  fim: date('fim'), // null = sem fim
  antecedenciaDias: integer('antecedencia_dias').notNull().default(2),
  status: text('status').notNull().default('ativa'), // ativa | pausada | cancelada
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== Faixa de preço por volume (B2B, Fase L1) =====
export const produtoFaixaPreco = pgTable('produto_faixa_preco', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  produtoId: uuid('produto_id')
    .notNull()
    .references(() => produto.id, { onDelete: 'cascade' }),
  qtdMin: integer('qtd_min').notNull().default(1),
  preco: numeric('preco').notNull().default('0'), // legado (mig 042); não usado no modo %
  descontoPct: numeric('desconto_pct'), // % de desconto da faixa (mig 184)
  ordem: integer('ordem').notNull().default(0),
});

// ===== Loja checkout (Fase L3) =====
export const cardapioBairro = pgTable('cardapio_bairro', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  nome: text('nome').notNull(),
  taxa: numeric('taxa').notNull().default('0'),
  ativo: boolean('ativo').notNull().default(true),
  ordem: integer('ordem').notNull().default(0),
});

// ===== Integrações com apps externos (credenciais por canal) =====
export const integracao = pgTable('integracao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  canal: text('canal').notNull(), // ifood | ubereats | rappi | 99food | outro
  ativo: boolean('ativo').notNull().default(false),
  merchantId: text('merchant_id'),
  clientId: text('client_id'),
  clientSecret: text('client_secret'), // secret — não retorna no GET
  token: text('token'), // secret — não retorna no GET
  config: jsonb('config').notNull().default('{}'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== Chamados de atendimento (handoff robô → humano) =====
export const atendimentoChamado = pgTable('atendimento_chamado', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  tipo: text('tipo').notNull().default('humano'), // mudanca | erro | humano | outro
  cliente: text('cliente'),
  telefone: text('telefone'),
  pedidoNumero: text('pedido_numero'),
  pedidoId: uuid('pedido_id'), // pedido ligado (cancelamento/alteração pelo cardápio)
  mensagem: text('mensagem'),
  status: text('status').notNull().default('aberto'), // aberto | resolvido
  decisao: text('decisao'), // aceito | recusado | null (veredito do cancelamento)
  resolvidoPorId: uuid('resolvido_por_id'),
  resolvidoEm: timestamp('resolvido_em', { withTimezone: true }),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// ===== Banners do cardápio digital =====
export const banner = pgTable('banner', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  imagemRef: text('imagem_ref').notNull(),
  titulo: text('titulo'),
  link: text('link'),
  ordem: integer('ordem').notNull().default(0),
  ativo: boolean('ativo').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const cupom = pgTable('cupom', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  codigo: text('codigo').notNull(),
  tipo: text('tipo').notNull().default('percentual'), // percentual | valor | fretegratis
  valor: numeric('valor').notNull().default('0'),
  tetoDesconto: numeric('teto_desconto'), // teto R$ do desconto percentual (null = sem teto)
  minimo: numeric('minimo'),
  ativo: boolean('ativo').notNull().default(true),
  validade: date('validade'),
  // Condicionais de uso (opcionais)
  somenteNovos: boolean('somente_novos').notNull().default(false), // só cliente sem pedido anterior
  maxPorCliente: integer('max_por_cliente'), // nº máx. de usos por cliente (null = ilimitado)
  minDiasSemCompra: integer('min_dias_sem_compra'), // cliente há > N dias sem comprar
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Uso do cupom por cliente (enforce max_por_cliente + histórico).
export const cupomUso = pgTable('cupom_uso', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  cupomId: uuid('cupom_id')
    .notNull()
    .references(() => cupom.id, { onDelete: 'cascade' }),
  clienteId: uuid('cliente_id'),
  telefone: text('telefone'),
  pedidoId: uuid('pedido_id'),
  usadoEm: timestamp('usado_em', { withTimezone: true }).notNull().defaultNow(),
});

// ===== Fidelidade (L5) =====
// Definição do plano: regra (qualificador) + meta + prêmio + prazo.
export const fidelidadePlano = pgTable('fidelidade_plano', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  nome: text('nome').notNull(),
  ativo: boolean('ativo').notNull().default(true),
  status: text('status').notNull().default('ativo'), // ativo | finalizando | encerrado
  qualificadorTipo: text('qualificador_tipo').notNull().default('qualquer'), // qualquer | categoria | produto
  qualificadorId: uuid('qualificador_id'), // categoria_produto.id ou produto.id
  pontosMeta: integer('pontos_meta').notNull().default(10),
  recompensaTipo: text('recompensa_tipo').notNull().default('percentual_proximo'), // percentual_proximo | percentual_produtos | valor_fixo
  recompensaValor: numeric('recompensa_valor').notNull().default('0'),
  recompensaProdutos: jsonb('recompensa_produtos').notNull().default('[]'),
  prazoResgateDias: integer('prazo_resgate_dias'), // null = indeterminado
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Saldo de pontos por plano por cliente (telefone).
export const fidelidadeCliente = pgTable('fidelidade_cliente', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  planoId: uuid('plano_id'),
  clienteId: uuid('cliente_id'),
  telefone: text('telefone').notNull(),
  nome: text('nome'),
  pontos: integer('pontos').notNull().default(0),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Dedupe: um pedido pontua no máx. 1 vez por plano.
export const fidelidadePonto = pgTable('fidelidade_ponto', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  planoId: uuid('plano_id')
    .notNull()
    .references(() => fidelidadePlano.id, { onDelete: 'cascade' }),
  telefone: text('telefone').notNull(),
  clienteId: uuid('cliente_id'),
  pedidoId: uuid('pedido_id'),
  estornado: boolean('estornado').notNull().default(false), // pedido cancelado
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Prêmio conquistado / resgatado (base do relatório).
export const fidelidadeResgate = pgTable('fidelidade_resgate', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  planoId: uuid('plano_id')
    .notNull()
    .references(() => fidelidadePlano.id, { onDelete: 'cascade' }),
  telefone: text('telefone').notNull(),
  clienteId: uuid('cliente_id'),
  ganhoEm: timestamp('ganho_em', { withTimezone: true }).notNull().defaultNow(),
  prazoEm: timestamp('prazo_em', { withTimezone: true }),
  resgatadoEm: timestamp('resgatado_em', { withTimezone: true }),
  pedidoId: uuid('pedido_id'), // pedido em que o prêmio foi USADO
  geradoPorPedidoId: uuid('gerado_por_pedido_id'), // pedido que GEROU o prêmio (rollback no cancelamento, mig 125)
  status: text('status').notNull().default('disponivel'), // disponivel | resgatado | usado | expirado
});

// ===== Cashback (concorre com Fidelidade) =====
export const cashbackPlano = pgTable('cashback_plano', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  tipo: text('tipo').notNull(), // valor | pontos
  ativo: boolean('ativo').notNull().default(true),
  status: text('status').notNull().default('ativo'), // ativo | finalizando | encerrado
  percentual: numeric('percentual'), // tipo valor
  base: text('base').notNull().default('total'), // total | sem_frete
  regras: jsonb('regras').notNull().default('[]'), // tipo pontos: [{ reais, pontos }]
  prazoResgateDias: integer('prazo_resgate_dias'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Valor em pontos de cada produto (resgate no tipo pontos).
export const cashbackProdutoValor = pgTable('cashback_produto_valor', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  planoId: uuid('plano_id')
    .notNull()
    .references(() => cashbackPlano.id, { onDelete: 'cascade' }),
  produtoId: uuid('produto_id').notNull(),
  pontos: integer('pontos').notNull().default(0),
});

// Saldo do cliente por tipo (valor R$ ou pontos).
export const cashbackSaldo = pgTable('cashback_saldo', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  telefone: text('telefone').notNull(),
  clienteId: uuid('cliente_id'),
  tipo: text('tipo').notNull(), // valor | pontos
  saldo: numeric('saldo').notNull().default('0'),
  expiraEm: timestamp('expira_em', { withTimezone: true }),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Razão (ledger) — integridade/estorno.
export const cashbackMovimento = pgTable('cashback_movimento', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  telefone: text('telefone').notNull(),
  clienteId: uuid('cliente_id'),
  tipo: text('tipo').notNull(), // valor | pontos
  delta: numeric('delta').notNull(), // + crédito | - resgate/estorno
  origem: text('origem').notNull(), // credito | resgate | estorno | expiracao
  planoId: uuid('plano_id'),
  pedidoId: uuid('pedido_id'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Vale de produto resgatado por pontos (abate no próximo pedido).
export const cashbackVale = pgTable('cashback_vale', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  telefone: text('telefone').notNull(),
  clienteId: uuid('cliente_id'),
  produtoId: uuid('produto_id'),
  descricao: text('descricao'),
  valor: numeric('valor').notNull().default('0'), // desconto equivalente
  status: text('status').notNull().default('disponivel'), // disponivel | usado
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  pedidoId: uuid('pedido_id'),
});

// ─── Pedidos de manutenção (mig 134) — equipamento com defeito / lâmpada etc. ───
export const pedidoManutencao = pgTable('pedido_manutencao', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  equipamentoId: uuid('equipamento_id'), // opcional: aponta p/ equipamento cadastrado
  equipamentoRef: text('equipamento_ref'), // texto livre quando não há cadastro
  titulo: text('titulo').notNull(),
  descricao: text('descricao'),
  fotos: jsonb('fotos').notNull().default('[]'), // refs de mídia (máx 3)
  prioridade: text('prioridade').notNull().default('normal'), // baixa|normal|alta|critica
  status: text('status').notNull().default('aberto'), // aberto|em_andamento|concluido_parcial|concluido|cancelado
  criadoPorId: uuid('criado_por_id'),
  responsavelId: uuid('responsavel_id'), // gerente delegado pelo C&O
  delegadoEm: timestamp('delegado_em', { withTimezone: true }),
  prazo15d: date('prazo_15d'), // criado + 15 dias
  alerta15dEm: timestamp('alerta_15d_em', { withTimezone: true }),
  decisao15d: text('decisao_15d'), // manter | concluir | excluir
  resolvidoEm: timestamp('resolvido_em', { withTimezone: true }),
  resolvidoPorId: uuid('resolvido_por_id'),
  motivo: text('motivo'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ─── Contador do tenant (mig 135) — destino do relatório de ponto no desligamento ─
export const contador = pgTable('contador', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  whatsapp: text('whatsapp').notNull(),
  email: text('email'),
  ativo: boolean('ativo').notNull().default(true),
  cadastradoPorId: uuid('cadastrado_por_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Etiquetas de validade (mig 136) — RDC 216: manipulados/insumos abertos ───
export const etiquetaTemplate = pgTable('etiqueta_template', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  nome: text('nome').notNull().default('Padrão'),
  // [{campo:'produto',visivel:true,negrito:true}, ...]
  // campos: loja, produto, unidade, fabricacao, compra, status, validade, responsavel, lote
  campos: jsonb('campos').notNull().default('[]'),
  tamanho: text('tamanho').notNull().default('40x40'), // 40x40 | 60x40 | 40x25 (mm)
  codigoTipo: text('codigo_tipo').notNull().default('code128'), // nenhum | ean13 | code128 | qr
  padrao: boolean('padrao').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const etiquetaValidade = pgTable('etiqueta_validade', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  unidadeId: uuid('unidade_id'),
  produtoId: uuid('produto_id'),
  fichaId: uuid('ficha_id'),
  itemId: uuid('item_id'), // insumo de origem (mig 182) — p/ recalcular validade ao abrir
  substituidaPorId: uuid('substituida_por_id'), // etiqueta nova que a sobrepôs (mig 183)
  templateId: uuid('template_id'),
  descricao: text('descricao').notNull(), // snapshot do nome
  unidadeMedida: text('unidade_medida'),
  tipo: text('tipo').notNull().default('novo'), // novo (fechado) | usado (aberto)
  status: text('status').notNull().default('fechado'), // fechado | em_uso | baixado | vencido
  fabricacao: date('fabricacao'),
  compra: date('compra'),
  abertura: timestamp('abertura', { withTimezone: true }),
  validade: date('validade').notNull(),
  codigo: text('codigo'), // payload do código de barras/QR
  impressaEm: timestamp('impressa_em', { withTimezone: true }),
  baixadoEm: timestamp('baixado_em', { withTimezone: true }),
  baixadoPorId: uuid('baixado_por_id'),
  virouPerda: boolean('virou_perda'),
  desperdicioId: uuid('desperdicio_id'),
  criadoPorId: uuid('criado_por_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Acerto de contas do sub-PDV de salão (mig 143).
// O sub-PDV funciona como app de garçom: abre a mesa, lança os itens (que já vão
// para a produção) e recebe o pagamento ali. O valor NÃO entra sozinho no caixa —
// fica pendente até o garçom levar o dinheiro ao caixa responsável, que confere e
// dá baixa. Mesmo fluxo do entregador que volta com a comanda e o dinheiro.
export const acertoSubpdv = pgTable('acerto_subpdv', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  unidadeId: uuid('unidade_id'),
  comandaId: uuid('comanda_id'),
  mesaId: uuid('mesa_id'),
  subPdvId: uuid('sub_pdv_id'), // quem fechou (ponto de salão)
  caixaDestinoId: uuid('caixa_destino_id'), // a quem deve prestar contas
  valorCentavos: integer('valor_centavos').notNull().default(0),
  forma: text('forma'),
  recebidoCentavos: integer('recebido_centavos'), // o que o caixa conferiu
  diferencaCentavos: integer('diferenca_centavos').notNull().default(0),
  status: text('status').notNull().default('pendente'), // pendente | baixado | cancelado
  fechadoPorId: uuid('fechado_por_id'),
  fechadoEm: timestamp('fechado_em', { withTimezone: true }).notNull().defaultNow(),
  baixadoPorId: uuid('baixado_por_id'),
  baixadoEm: timestamp('baixado_em', { withTimezone: true }),
  caixaSessaoId: uuid('caixa_sessao_id'),
  observacao: text('observacao'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Histórico das conversas de WhatsApp na API OFICIAL (mig 215, @cloud-only).
// A Meta não guarda histórico — entrega o evento uma vez e esquece. Sem esta tabela
// a loja migrada para o oficial perderia o chat do /delivery, que é onde o atendente
// assume a conversa. No Evolution isso não é preciso: ele mesmo guarda.
export const whatsappMensagem = pgTable('whatsapp_mensagem', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => empresa.id, { onDelete: 'cascade' }),
  telefone: text('telefone').notNull(), // só dígitos (cliente)
  direcao: text('direcao').notNull(), // entrada | saida
  tipo: text('tipo').notNull().default('text'),
  texto: text('texto'),
  midiaId: text('midia_id'), // id da mídia na Meta (baixável pelo proxy)
  wamid: text('wamid'), // id da mensagem na Meta — único por tenant (idempotência)
  status: text('status'), // só saída: accepted | sent | delivered | read | failed
  nomeContato: text('nome_contato'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});
