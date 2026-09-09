-- @cloud-only — campanhas vivem só na nuvem (worker pula em EDGE_MODE).
--
-- 228_campanha_ab_cliques.sql — Fase 5b: teste A/B (2 mensagens) + rastreio de CLIQUE
-- no link. Cada destinatário recebe a variante A ou B; o link vai por um redirect
-- rastreado (/publico/campanha/r/:envioId) que marca o clique e redireciona. Aditivo.

alter table campanha add column if not exists mensagem_b text;              -- variante B (null = sem A/B)
alter table campanha add column if not exists cliques integer not null default 0; -- total de cliques no link

alter table campanha_envio add column if not exists variante text;          -- 'A' | 'B' | null
alter table campanha_envio add column if not exists clicou boolean not null default false;
alter table campanha_envio add column if not exists clicado_em timestamptz;
