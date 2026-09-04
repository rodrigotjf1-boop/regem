-- F9 (D) — o presidente pode conceder ACESSO TOTAL ao suporte (senão o suporte
-- recebe só o pacote mínimo de config). Lido pelo guard a cada request (server-side),
-- de forma que revogar/conceder vale ao vivo (~30s de cache). Coluna em `empresa`
-- (tabela compartilhada edge↔nuvem): NÃO cloud-only.
alter table empresa
  add column if not exists suporte_acesso_total boolean not null default false;
