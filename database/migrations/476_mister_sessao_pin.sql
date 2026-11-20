-- @cloud-only
-- 476 — MISTER: a sessão com PIN (versão 6, fase M6d; plano aprovado em 20/11/2026, `docs/plano-mister.md` § "Versão 6",
-- peça A2; protótipo `mockups/regem-mister-v6.html`, "Segurança" e Mister › Regras › "Segurança · só o presidente muda").
-- A 475 é a da lista de compras (M6g); a 477 é de outra sessão (o Clube).
--
-- O ajuste do presidente: com ele ligado, os valores em reais, os dados de pessoas e as ações de botão pedem o PIN pelo
-- link (o mesmo da F4.2a) — depois do PIN, vale pelo tempo escolhido (6, 12 ou 24 horas). Nasce DESLIGADO.
--   mister_conversa_config.pin_a_cada_h  — 6 | 12 | 24 horas, ou null (desligado; o padrão). Sem CHECK: o serviço confere.
--   mister_vinculo.pin_ate               — até quando o PIN desta pessoa vale (null = ainda não confirmou).
--
-- ⚠️ SÓ NUVEM (o Mister roda na nuvem; as duas tabelas são só da nuvem). Idempotente; só colunas novas, nada que apague
-- objeto (LIC-171).
set local lock_timeout = '5s';

alter table mister_conversa_config add column if not exists pin_a_cada_h integer;
alter table mister_vinculo add column if not exists pin_ate timestamptz;

comment on column mister_conversa_config.pin_a_cada_h is 'Mister v6 (mig 476): a sessão com PIN — 6, 12 ou 24 horas; null = desligado';
comment on column mister_vinculo.pin_ate is 'Mister v6 (mig 476): até quando o PIN desta pessoa vale para valores, dados de pessoas e ações de botão';

-- Conferência (no mesmo Run): as duas colunas.
select table_name || '.' || column_name as coluna, data_type as tipo
  from information_schema.columns
 where table_schema = current_schema()
   and ((table_name = 'mister_conversa_config' and column_name = 'pin_a_cada_h') or (table_name = 'mister_vinculo' and column_name = 'pin_ate'))
 order by 1;
