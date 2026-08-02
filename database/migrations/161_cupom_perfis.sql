-- 161 — Perfis de cupom (Fase 1 do construtor de cupons). Guarda só os OVERRIDES por
-- perfil (caixa/entregador/producao): visível/negrito/alinhamento/ordem por campo.
-- Vazio = usa os perfis padrão (CUPOM_PERFIS_PADRAO no código). Cabeçalho e rodapé
-- continuam em cupom_layout (preenchimento livre do cliente).
alter table cardapio_config add column if not exists cupom_perfis jsonb not null default '{}'::jsonb;
