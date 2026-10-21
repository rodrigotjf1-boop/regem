-- 332 — O período da senha passa a morar no ajuste do KDS, que sincroniza (auditoria do KDS de 20/10/2026; decisão do
-- dono: "ajustes valendo na loja").
--
-- O período da senha (diário, semanal ou nunca) ficava numa linha do contador (`senha_contador`), que é de cada máquina
-- e não sincroniza: o que a tela gravava na nuvem nunca chegava ao contador do servidor da loja — nem ao contador da
-- loja na própria nuvem (a tela grava sem loja, e cada contador lia só a sua linha). Agora o período mora em
-- `kds_cor_config` (sincroniza nos dois sentidos), com a regra "o da loja; sem ele, o da empresa; sem nenhum, o do
-- contador". Quem já tinha escolhido semanal ou nunca na linha sem loja leva a escolha para o ajuste da empresa.
-- Idempotente; não apaga nada; roda nos dois lados (a coluna precisa existir na loja para a sincronização trazê-la).
set local lock_timeout = '5s';

alter table kds_cor_config add column if not exists senha_periodo text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'ck_kds_cor_config_senha_periodo'
                    and conrelid = to_regclass(current_schema() || '.kds_cor_config')) then
    alter table kds_cor_config
      add constraint ck_kds_cor_config_senha_periodo
      check (senha_periodo is null or senha_periodo in ('diario', 'semanal', 'nunca'));
  end if;
end
$$;

-- A escolha que já existia (linha do contador sem loja, período diferente do diário) vai para o ajuste da empresa, sem
-- passar por cima de um período já gravado ali.
insert into kds_cor_config (tenant_id, unidade_id, senha_periodo)
select distinct on (s.tenant_id) s.tenant_id, null::uuid, s.periodo
  from senha_contador s
 where s.unidade_id is null and s.periodo in ('semanal', 'nunca')
 order by s.tenant_id, s.updated_at desc
on conflict (tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid))
do update set senha_periodo = excluded.senha_periodo, updated_at = now()
 where kds_cor_config.senha_periodo is null;

-- Conferência no MESMO Run: `ok` tem de vir true — a coluna existe e toda escolha antiga (semanal ou nunca, sem loja)
-- chegou ao ajuste da empresa.
select (x.coluna and x.escolhas_sem_ajuste = 0) as ok, x.*
  from (
    select
      exists (select 1 from information_schema.columns
               where table_schema = current_schema() and table_name = 'kds_cor_config'
                 and column_name = 'senha_periodo') as coluna,
      (select count(distinct s.tenant_id) from senha_contador s
        where s.unidade_id is null and s.periodo in ('semanal', 'nunca')
          and not exists (select 1 from kds_cor_config k
                           where k.tenant_id = s.tenant_id and k.unidade_id is null
                             and k.senha_periodo is not null)) as escolhas_sem_ajuste
  ) x;
