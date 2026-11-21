-- @cloud-only
-- 484 — MISTER: a conferência do aparelho, ainda SÓ OBSERVANDO (versão 6, fase M6b, peça A1.0 do `docs/plano-mister.md`;
-- protótipo `mockups/regem-mister-v6.html`, "Segurança").
--
-- A Meta tem o recurso "Identity change check": ligado no número, cada mensagem que chega traz um hash do aparelho da
-- pessoa. A doc não diz quais ações mudam o hash (reinstalar, celular novo, WhatsApp Web): a A1.0 mede isso com um celular
-- de teste ANTES de qualquer bloqueio. Esta migration só guarda o que se viu; NINGUÉM deixa de ser atendido por causa dela.
--   mister_numero.conferir_aparelho(_em, _por) — o recurso ligado na Meta por este console. A Meta não devolve a situação
--     dele na leitura de `/settings`, por isso quem ligou e quando ficam aqui. Nasce DESLIGADO.
--   mister_vinculo.aparelho_hash / aparelho_visto_em — o hash da última mensagem da pessoa e quando chegou.
--   mister_vinculo.aparelho_anterior_hash / aparelho_mudou_em — o hash de antes e quando mudou.
--
-- ⚠️ SÓ NUVEM (o Mister roda na nuvem; as duas tabelas são só da nuvem). Idempotente; só colunas novas, nada que apague
-- objeto (LIC-171).
set local lock_timeout = '5s';

alter table mister_numero add column if not exists conferir_aparelho boolean not null default false;
alter table mister_numero add column if not exists conferir_aparelho_em timestamptz;
alter table mister_numero add column if not exists conferir_aparelho_por text;
alter table mister_vinculo add column if not exists aparelho_hash text;
alter table mister_vinculo add column if not exists aparelho_visto_em timestamptz;
alter table mister_vinculo add column if not exists aparelho_anterior_hash text;
alter table mister_vinculo add column if not exists aparelho_mudou_em timestamptz;

comment on column mister_numero.conferir_aparelho is 'Mister v6 (mig 484): o recurso de identidade da Meta ligado neste número (só observa, A1.0)';
comment on column mister_vinculo.aparelho_hash is 'Mister v6 (mig 484): o hash do aparelho da última mensagem (contacts[].identity_key_hash); nunca sai na API';
comment on column mister_vinculo.aparelho_mudou_em is 'Mister v6 (mig 484): quando o hash do aparelho mudou pela última vez';

-- Conferência (no mesmo Run): as sete colunas.
select table_name || '.' || column_name as coluna, data_type as tipo
  from information_schema.columns
 where table_schema = current_schema()
   and ((table_name = 'mister_numero' and column_name in ('conferir_aparelho', 'conferir_aparelho_em', 'conferir_aparelho_por'))
     or (table_name = 'mister_vinculo' and column_name in ('aparelho_hash', 'aparelho_visto_em', 'aparelho_anterior_hash', 'aparelho_mudou_em')))
 order by 1;
