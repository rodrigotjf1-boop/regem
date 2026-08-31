-- @cloud-only
-- 220: Controle de instalacao anti-clone (F3). Bloqueia o cenario "senha vazada +
-- rodar o .exe em outra maquina": hoje o self-service REGRAVA o fingerprint
-- incondicionalmente (licenca.service instalarSelfService) e o clone "assume".
--
-- Config + segredo TOTP ficam na ATIVACAO (que ja e @cloud-only, mig 082) — NUNCA na
-- empresa, que sincroniza pro edge (o segredo vazaria). Todo este arquivo e @cloud-only
-- (realm da distribuicao); o edge PULA por EDGE_MODE=true. Idempotente.

-- Config de re-autorizacao POR LOJA (na ativacao = cloud-only):
--  reauth_ativo       liga/desliga a trava (opt-in; rollout seguro — codigo atras do flag).
--  reauth_metodo      metodo preferido do 2o fator: 'email' | 'totp'.
--  reauth_totp_secret segredo base32 do app autenticador (null = TOTP nao enrolado).
alter table ativacao add column if not exists reauth_ativo boolean not null default false;
alter table ativacao add column if not exists reauth_metodo text not null default 'email';
alter table ativacao add column if not exists reauth_totp_secret text;

-- Pedidos de re-autorizacao (mover o edge p/ outra maquina). Um fingerprint novo tenta
-- instalar numa loja que ja tem outro fingerprint bound -> cria o pedido, exige o 2o
-- fator (codigo por e-mail OU TOTP) e, so ao aprovar, rebinda + rotaciona o token (mata a
-- maquina antiga em 401).
create table if not exists reautorizacao_edge (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  unidade_id uuid,
  fingerprint_novo text not null,      -- fingerprint da maquina nova pedindo o move
  metodo text not null default 'email',-- 'email' | 'totp'
  codigo_hash text,                    -- hash do codigo (so p/ e-mail; TOTP verifica pelo secret)
  expira_em timestamptz,               -- validade do codigo (e-mail)
  tentativas integer not null default 0,
  status text not null default 'pendente', -- 'pendente' | 'aprovada' | 'expirada'
  criado_em timestamptz not null default now(),
  confirmado_em timestamptz
);
create index if not exists idx_reautorizacao_edge_tenant on reautorizacao_edge (tenant_id, criado_em desc);
