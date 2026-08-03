-- 161 — Perfis de cupom (Fase 1 do construtor de cupons). Guarda só os OVERRIDES por
-- perfil (caixa/entregador/producao): visível/negrito/alinhamento/ordem por campo.
-- Vazio = usa os perfis padrão (CUPOM_PERFIS_PADRAO no código). Cabeçalho e rodapé
-- continuam em cupom_layout (preenchimento livre do cliente).
-- ATENÇÃO: a coluna vive em delivery_config (é onde deliveryConfig/configRaw lê), NÃO em
-- cardapio_config. A versão original apontava para cardapio_config (tabela errada) e
-- derrubava /delivery com 500 "column cupom_perfis does not exist" (corrigido; ver mig 163).
alter table delivery_config add column if not exists cupom_perfis jsonb not null default '{}'::jsonb;
