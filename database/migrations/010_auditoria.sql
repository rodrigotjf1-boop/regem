-- 010_auditoria.sql — Estende a audit_log já criada na 002 para o contrato §4.9.
-- (A tabela existe: id, tenant_id, unidade_id, actor_tipo, actor_id, acao,
--  entidade_tipo, entidade_id, detalhe, created_at.) Aditivo/não-destrutivo.

alter table audit_log add column if not exists actor_perfil text;   -- presidente|gerente|supervisao|execucao|sistema
alter table audit_log add column if not exists tipo text;           -- escala|ponto|recebimento|checklist|modulos|vistoria|bot|mural|tarefa|ficha|guia|cadastro
alter table audit_log add column if not exists origem text not null default 'web'; -- web|mobile|app_colaborador|kds|terminal

create index if not exists idx_audit_tenant_tipo on audit_log (tenant_id, tipo);
