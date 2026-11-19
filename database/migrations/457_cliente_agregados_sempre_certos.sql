-- 457 — Os totais do cliente (pedidos, gasto, primeiro e último pedido) acompanham o cancelamento, a troca de cliente
-- do pedido e a exclusão do pedido (ERR-536; F1-0 do docs/plano-perfil-cliente.md, plano aprovado pelo dono em 19/11/2026).
--
-- Os agregados da mig 194 (`cliente.total_pedidos`, `total_gasto`, `primeiro_pedido_em`, `ultimo_pedido_em`) só eram
-- recalculados quando um pedido ENTRAVA (`DeliveryService.vincularCliente`). Medido na nuvem em 19/11/2026: 79 clientes
-- com o total diferente dos pedidos — 71 com pedido cancelado depois (o cancelado continuava contando) e 8 cujo pedido
-- passou para outro cadastro ou foi apagado. Esses totais alimentam os segmentos do CRM e das campanhas e, a seguir, o
-- perfil do cliente.
--
-- O que esta migration faz:
--  1. função `cliente_recalcula_agregados(tenant, cliente)` — a MESMA conta do `vincularCliente` (ignora cancelados).
--  2. gatilho `trg_pedido_externo_agregados_cliente`, por linha, depois de mudar a situação (só quando entra ou sai de
--     'cancelado') ou o cliente do pedido (de um cliente para outro — o primeiro vínculo, de vazio para um cliente, o
--     `vincularCliente` já recalcula); e `trg_pedido_externo_agregados_cliente_del` depois de apagar um pedido ligado.
--     Vale para todos os caminhos: painel, canais, robô, cardápio e a sincronização.
--  3. SÓ NA NUVEM, uma vez: recalcula os clientes cujos totais guardados diferem dos pedidos. O servidor da loja não
--     recalcula de uma vez (ele só tem os pedidos da loja dele; a nuvem tem os de todas as lojas da empresa).
-- Idempotente; função e gatilhos por `create or replace` (Postgres 14+); não apaga nada.
set local lock_timeout = '5s';

create or replace function cliente_recalcula_agregados(p_tenant uuid, p_cliente uuid) returns void
language plpgsql as $$
begin
  if p_cliente is null then
    return;
  end if;
  update cliente c set
    total_pedidos      = sub.n,
    total_gasto        = sub.gasto,
    primeiro_pedido_em = sub.primeiro,
    ultimo_pedido_em   = sub.ultimo,
    atualizado_em      = now()
  from (
    select count(*)::int as n,
           coalesce(sum(p.total::numeric), 0) as gasto,
           min(p.criado_em) as primeiro,
           max(p.criado_em) as ultimo
      from pedido_externo p
     where p.tenant_id = p_tenant and p.cliente_id = p_cliente and p.status <> 'cancelado'
  ) sub
  where c.id = p_cliente and c.tenant_id = p_tenant
    and (c.total_pedidos is distinct from sub.n
         or c.total_gasto is distinct from sub.gasto
         or c.primeiro_pedido_em is distinct from sub.primeiro
         or c.ultimo_pedido_em is distinct from sub.ultimo);
end;
$$;

create or replace function pedido_externo_agregados_cliente() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform cliente_recalcula_agregados(old.tenant_id, old.cliente_id);
    return null;
  end if;
  if old.cliente_id is distinct from new.cliente_id then
    perform cliente_recalcula_agregados(old.tenant_id, old.cliente_id);
  end if;
  perform cliente_recalcula_agregados(new.tenant_id, new.cliente_id);
  return null;
end;
$$;

create or replace trigger trg_pedido_externo_agregados_cliente
  after update of status, cliente_id on pedido_externo
  for each row
  when ((old.status is distinct from new.status and (old.status = 'cancelado' or new.status = 'cancelado'))
        or (old.cliente_id is not null and old.cliente_id is distinct from new.cliente_id))
  execute function pedido_externo_agregados_cliente();

create or replace trigger trg_pedido_externo_agregados_cliente_del
  after delete on pedido_externo
  for each row
  when (old.cliente_id is not null and old.status <> 'cancelado')
  execute function pedido_externo_agregados_cliente();

do $$
begin
  -- Servidor da loja: não tem `edge_status`; os totais certos chegam pela sincronização do cadastro.
  if to_regclass(current_schema() || '.edge_status') is null then
    return;
  end if;
  update cliente c set
    total_pedidos      = coalesce(sub.n, 0),
    total_gasto        = coalesce(sub.gasto, 0),
    primeiro_pedido_em = sub.primeiro,
    ultimo_pedido_em   = sub.ultimo,
    atualizado_em      = now()
  from cliente c2
  left join lateral (
    select count(*)::int as n,
           coalesce(sum(p.total::numeric), 0) as gasto,
           min(p.criado_em) as primeiro,
           max(p.criado_em) as ultimo
      from pedido_externo p
     where p.tenant_id = c2.tenant_id and p.cliente_id = c2.id and p.status <> 'cancelado'
  ) sub on true
  where c.id = c2.id
    and (coalesce(c2.total_pedidos, 0) > 0 or sub.n > 0)
    and (c2.total_pedidos is distinct from coalesce(sub.n, 0)
         or c2.total_gasto is distinct from coalesce(sub.gasto, 0));
end;
$$;
