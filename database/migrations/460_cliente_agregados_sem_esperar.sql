-- 460 — O recálculo dos totais do cliente (mig 458) NÃO ESPERA a trava do cadastro (ERR-539).
--
-- Depois da 458, o CI acusou `deadlock detected` duas vezes (no da main logo depois do #1172 e no do #1174), sempre no
-- teste do pedido agendado pelo robô — o fluxo que cancela o pedido fora da janela (o caso que dispara o gatilho). O
-- gatilho rodava DENTRO da transação que muda o pedido e esperava a trava da linha do `cliente`; outra transação com o
-- cadastro travado (a gravação de um pedido do mesmo cliente: o cadastro e o `vincularCliente`) fechava o ciclo.
--
-- Agora a função pega a linha do cliente com `skip locked`: se outra transação está com ela, o recálculo desta vez é
-- pulado — quem está com a trava é, quase sempre, a gravação de um pedido do mesmo cliente, que recalcula os totais no
-- `vincularCliente`; e o próximo cancelamento recalcula de novo. Esperar, nunca.
-- Só a função muda (`create or replace`); os gatilhos da 458 seguem os mesmos. Nos dois lados. Sem instrução destrutiva.
set local lock_timeout = '5s';

create or replace function cliente_recalcula_agregados(p_tenant uuid, p_cliente uuid) returns void
language plpgsql as $$
begin
  if p_cliente is null then
    return;
  end if;
  -- Não espera: com o cadastro travado por outra transação, pula (ver o cabeçalho).
  perform 1 from cliente where id = p_cliente and tenant_id = p_tenant for no key update skip locked;
  if not found then
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

-- Conferência (no mesmo Run): a função nova tem o `skip locked`.
select position('skip locked' in pg_get_functiondef('cliente_recalcula_agregados(uuid, uuid)'::regprocedure)) > 0 as nao_espera;
