-- 231_encomenda_corte_intervalo.sql — corte de encomenda por INTERVALO.
-- Hoje só existe encomenda_corte (hora de FIM). Adiciona a hora de INÍCIO para permitir
-- uma janela (início <= agora <= fim) em vez de só um horário limite. Aditivo/idempotente.

alter table cardapio_config add column if not exists encomenda_corte_inicio time;
  -- início da janela de corte (null = sem início; mantém o comportamento atual do encomenda_corte como só-fim)
