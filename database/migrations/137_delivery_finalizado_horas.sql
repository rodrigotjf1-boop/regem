-- 137_delivery_finalizado_horas.sql — quanto tempo (horas) um pedido finalizado
-- (concluído/cancelado) permanece visível na coluna "Finalizado" do quadro de
-- entregas. Configurável pelo usuário (Delivery → Configurações). Padrão 5h. Idempotente.

alter table delivery_config add column if not exists finalizado_horas integer not null default 5;
