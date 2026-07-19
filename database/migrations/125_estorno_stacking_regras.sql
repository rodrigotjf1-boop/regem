-- 125_estorno_stacking_regras.sql — correção do estorno no cancelamento + regras
-- configuráveis de empilhamento de desconto (cupom × cashback × fidelidade) +
-- intervalo mínimo de pontuação + contrato de soft-delete do pedido_externo.
-- Idempotente. Aplica na nuvem E no edge (cardapio_config é bidirecional).

-- ── Config por loja (cardapio_config) — defaults seguros/atuais ──────────────
-- Cancelamento devolve o cashback GASTO ao cliente? (true = devolve; a loja decide)
alter table cardapio_config add column if not exists cancelamento_estorna_cashback boolean not null default true;
-- Cupom não pode ser usado em pedido que tenha resgate de fidelidade?
alter table cardapio_config add column if not exists cupom_bloqueia_com_resgate boolean not null default false;
-- Nega cupom quando o cashback USADO no pedido passa deste teto (centavos). null = sem limite.
alter table cardapio_config add column if not exists cupom_max_cashback_cent integer;
-- Intervalo mínimo (horas) entre pedidos que pontuam na fidelidade (anti-abuso). Padrão 3h.
alter table cardapio_config add column if not exists fidelidade_intervalo_horas integer not null default 3;

-- ── Liga o prêmio de fidelidade GERADO ao pedido que o gerou ────────────────
-- Sem isso não dá para localizar/remover o prêmio no cancelamento (rollback da meta).
alter table fidelidade_resgate add column if not exists gerado_por_pedido_id uuid;
create index if not exists idx_fid_resgate_gerado_pedido on fidelidade_resgate (gerado_por_pedido_id);

-- ── Contrato do sync bidirecional do pedido_externo ─────────────────────────
-- pedido_externo é 'ambos'; na prática só muda de status para 'cancelado' (nunca
-- hard-delete), mas o contrato de soft-delete do sync exige a coluna para propagar.
alter table pedido_externo add column if not exists deleted_at timestamptz;

-- ── Contador atômico da senha do cardápio (corrige colisão do count(*)+1) ────
-- Um upsert "on conflict do update set ultimo = ultimo + 1 returning" é atômico:
-- dois pedidos simultâneos nunca recebem a mesma senha. Operacional (não sincroniza).
create table if not exists cardapio_senha_seq (
  tenant_id uuid not null,
  canal text not null default 'cardapio',
  ultimo integer not null default 0,
  primary key (tenant_id, canal)
);
