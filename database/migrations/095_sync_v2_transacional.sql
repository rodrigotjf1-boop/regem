-- v2 do sync: as tabelas TRANSACIONAIS (venda/produção/caixa) passam a SUBIR do
-- edge para a nuvem por LWW (last-write-wins). Como elas mudam de estado (comanda
-- fecha, pedido avança), precisam de `updated_at` + gatilho que bumpa em todo
-- UPDATE — assim o daemon reenvia a linha quando o estado muda, e a nuvem aplica
-- se for mais nova. Sem isso, o append-only só capturaria a criação.

alter table comanda         add column if not exists updated_at timestamptz not null default now();
alter table producao_pedido add column if not exists updated_at timestamptz not null default now();
alter table pedido_externo  add column if not exists updated_at timestamptz not null default now();
alter table caixa_sessao    add column if not exists updated_at timestamptz not null default now();
-- comanda_item e producao_pedido_item já têm updated_at.

create or replace function bump_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array[
    'comanda','comanda_item','producao_pedido','producao_pedido_item',
    'pedido_externo','caixa_sessao'
  ] loop
    execute format('drop trigger if exists trg_bump_updated_at on %I', t);
    execute format('create trigger trg_bump_updated_at before update on %I '
                   || 'for each row execute function bump_updated_at()', t);
  end loop;
end $$;
