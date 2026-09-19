-- @cloud-only  (altera edge_release, criada pela 124 que é cloud-only → só na nuvem;
-- no edge esta migration é PULADA.)
-- 270 — distribuição ESCALONADA e segura dos releases do servidor local.
--
-- Antes: o update-check entregava o ÚLTIMO release publicado a TODAS as lojas ao mesmo
-- tempo, sem piloto, sem pausa e sem como recolher uma versão ruim (ERR-051).
-- Agora cada release tem:
--   percentual   0..100 — fatia das lojas que recebe (sorteio estável por loja+versão)
--   lojas_piloto empresas que recebem antes de todo mundo (independe do percentual)
--   pausado      para de oferecer (quem já instalou fica; ninguém novo recebe)
--   recolhido    versão retirada: nunca mais é oferecida
--   assinatura_v2 + expira_em — assinatura nova (com validade) de
--                 "regem-edge-v2|versao|sha256|url|expira_em"; a antiga (v1) continua
--                 na coluna `assinatura` para os servidores ainda na versão anterior.
-- Aditiva e idempotente. Os releases que já existem ficam em 100% (comportamento atual).
alter table edge_release add column if not exists percentual smallint not null default 100;
alter table edge_release add column if not exists lojas_piloto uuid[] not null default '{}';
alter table edge_release add column if not exists pausado boolean not null default false;
alter table edge_release add column if not exists recolhido boolean not null default false;
alter table edge_release add column if not exists assinatura_v2 text;
alter table edge_release add column if not exists expira_em timestamptz;
alter table edge_release add column if not exists atualizado_em timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'edge_release_percentual_chk'
      and conrelid = 'edge_release'::regclass
  ) then
    alter table edge_release
      add constraint edge_release_percentual_chk check (percentual between 0 and 100);
  end if;
end $$;
