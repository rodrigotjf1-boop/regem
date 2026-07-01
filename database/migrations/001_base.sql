-- 001_base.sql
-- Extensões e convenções base do Regen.
-- Convenção: toda tabela sincronizável tem id uuid, timestamps e soft delete.

create extension if not exists pgcrypto;  -- fornece gen_random_uuid()

-- Atualiza updated_at automaticamente em UPDATE.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
