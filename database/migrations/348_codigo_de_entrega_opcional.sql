-- 348_codigo_de_entrega_opcional.sql — a loja escolhe NÃO usar o código de entrega (pedido do dono, 01/11/2026).
--
-- O código de 4 dígitos nasce com todo pedido pelo valor padrão da coluna (migs 209/212) e o resto do sistema já trata
-- "pedido sem código" em todo lugar (o app do entregador não pede, o cliente não recebe, o rastreio e a conta do
-- cardápio não mostram). Então "não usar o código" = o pedido NOVO nasce sem ele. Ligado de padrão.
--
-- Quem decide é um gatilho, e não cada caminho que cria pedido (cardápio, robô, pedido manual, encomenda, servidor da
-- loja…): um caminho novo nunca esquece. Vale só para o pedido que NASCE neste banco — a gravação do sync (marca
-- `regem.sync = on`, mig 259) é o pedido que só está viajando entre a nuvem e a loja, e chega como nasceu: se a loja
-- desligasse o código entre o pedido nascer e descer, ele perderia o código de um lado só. Pedido em andamento não muda.
--
-- O ajuste é o da LOJA do pedido; sem linha da loja, o da empresa (a mesma herança do `configRaw`). Não é só-nuvem: o
-- servidor da loja também cria pedido (o ajuste `cardapio_config` já sincroniza nos dois sentidos).
-- Aditiva e idempotente; o gatilho vai com `create or replace` (sem `drop`, V9).

alter table cardapio_config add column if not exists usar_codigo_entrega boolean not null default true;

create or replace function pedido_sem_codigo_se_a_loja_nao_usa() returns trigger
language plpgsql as $$
declare
  usa boolean;
begin
  if coalesce(current_setting('regem.sync', true), '') = 'on' then
    return new;
  end if;
  if new.codigo_entrega is null then
    return new;
  end if;
  select c.usar_codigo_entrega into usa
    from cardapio_config c
   where c.tenant_id = new.tenant_id
     and (c.unidade_id = new.unidade_id or c.unidade_id is null)
   order by (c.unidade_id is null), c.id
   limit 1;
  if usa is false then
    new.codigo_entrega := null;
  end if;
  return new;
end;
$$;

create or replace trigger pedido_sem_codigo_se_a_loja_nao_usa
  before insert on pedido_externo
  for each row execute function pedido_sem_codigo_se_a_loja_nao_usa();
