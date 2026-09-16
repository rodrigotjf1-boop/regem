-- 250_empresa_snapshot_hora.sql — Hora em que a empresa considera o dia FECHADO para o
-- snapshot de estoque (base do CMV real). Editável pelo presidente/C&O.
--
-- ⚠️ NÃO é @cloud-only: `empresa` existe no edge e desce da nuvem.
-- ⚠️ ADICIONA COLUNA EM `empresa` — o Drizzle nomeia todas as colunas no `select`, e a
--    empresa é lida em praticamente toda requisição. Sem esta migration na nuvem ANTES do
--    merge, a API inteira responde 42703 (incidente da mig 239). Nuvem primeiro.
--
-- POR QUÊ (auditoria #15)
-- O snapshot diário rodava às 02:00 fixas e fotografava o dia ATUAL — um dia que mal
-- tinha começado. O CMV usava esse snapshot como estoque FINAL do período e perdia o
-- movimento inteiro do último dia. A correção é fotografar o dia ANTERIOR, já fechado.
--
-- Por que a hora é configurável e não fixa: o snapshot do dia D soma os movimentos com
-- data <= D, então rodar mais tarde não muda o resultado — dá TEMPO. Tempo para o
-- servidor local da loja sincronizar as vendas da noite, e para o custo médio gravado
-- ser o mais próximo possível do fechamento. Cada operação fecha num horário: decisão do
-- dono, padrão 06:00 e o presidente ajusta.

alter table empresa add column if not exists snapshot_hora time not null default '06:00';
