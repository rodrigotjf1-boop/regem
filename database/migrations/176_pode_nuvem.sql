-- 176_pode_nuvem.sql — RBAC de modo (S2 do sync espelhado + modos).
-- Quem pode logar no MODO NUVEM (app online). No SERVIDOR LOCAL (edge) qualquer
-- perfil entra; a nuvem é uso do presidente, e ele libera quem mais pode entrar online.
--
-- NÃO é @cloud-only: a coluna vive em `colaborador` (tabela que existe no edge e na
-- nuvem) e o SELECT do login lê `pode_nuvem` dos dois lados. Default false (só local).
alter table colaborador add column if not exists pode_nuvem boolean not null default false;

-- Presidentes/C&O já podem acessar a nuvem (deriva do nível do perfil de acesso e,
-- como rede de segurança, da categoria da função principal).
update colaborador c set pode_nuvem = true
  from perfil_acesso p
  where c.perfil_acesso_id = p.id and p.nivel = 'presidente' and c.pode_nuvem = false;

update colaborador c set pode_nuvem = true
  from funcao f
  where c.funcao_id = f.id and f.categoria = 'presidente' and c.pode_nuvem = false;
