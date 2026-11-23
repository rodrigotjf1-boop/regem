-- @cloud-only
-- 494 · NOTÍCIAS DO RAMO (fase N1 do protótipo `mockups/regem-noticias-do-ramo.html`, aprovado em 22/11/2026). A nuvem lê o
-- boletim diário do Pulso (`GET /v1/ramo/boletim`) e guarda UMA cópia por dia para todas as lojas: abrir a tela não chama o
-- Pulso. Dado da DISTRIBUIÇÃO, sem empresa nem loja: são fatos públicos, com título, crédito e link de cada notícia.
--
-- pulso_boletim — a cópia de cada dia (90 dias). `corpo` é o boletim já conferido por `lerBoletimDaPorta`.
-- pulso_estado.boletim_lido_em — a reserva da leitura entre réplicas (V98) e o relógio no banco (V104).
--
-- `clock_timestamp()` nos carimbos (V9). RLS ligada e SEM política. Sem instrução destrutiva (MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

create table if not exists pulso_boletim (
  ramo        text not null,
  dia         date not null,
  corpo       jsonb not null,
  lido_em     timestamptz not null default clock_timestamp(),
  primary key (ramo, dia)
);
alter table pulso_boletim enable row level security;

alter table pulso_estado add column if not exists boletim_lido_em timestamptz;
