-- 409 — Os alertas cadastrados do KDS: para QUAIS KDS e quanto tempo ficam (auditoria do KDS de 11/11/2026, onda 2 —
-- A9 e A7; protótipo aprovado pelo dono, `mockups/regem-kds-cozinha.html`, aba 5 "Alertas cadastrados").
--
-- • `kds_ids` — os KDS que recebem o alerta (ex.: a troca do óleo só na "Fritadeira"). NULO = todos os KDS da loja do
--   alerta (o que valia até aqui). Lista vazia não vale (a tela e o serviço recusam). Antes, o alerta gravava a loja mas
--   ia para todas as telas (A9).
-- • `ate_ciente` — o alerta fica no rodapé até alguém tocar em "Ciente", em vez de sair depois de `duracao_seg` (A7: um
--   urgente de 1 h ocupava o rodapé por 1 h sem como dispensar).
--
-- NÃO é @cloud-only: `kds_alerta_config` sincroniza, e o servidor da loja também dispara os alertas. O sync copia só as
-- colunas que existem dos dois lados: a loja ainda sem esta migration (antes do `.zip`) manda o alerta para todos os KDS
-- da loja e pelo tempo, como antes. ⚠️ Aplicar na NUVEM ANTES do merge: o cadastro passa a ler e gravar as colunas.
-- Idempotente, sem `drop`.

alter table kds_alerta_config add column if not exists kds_ids jsonb;
alter table kds_alerta_config add column if not exists ate_ciente boolean not null default false;

comment on column kds_alerta_config.kds_ids is
  'Os KDS (equipamento.id) que recebem o alerta; nulo = todos os KDS da loja do alerta (mig 409).';
comment on column kds_alerta_config.ate_ciente is
  'O alerta fica no rodapé do KDS até alguém tocar em Ciente, em vez de sair depois de duracao_seg (mig 409).';
