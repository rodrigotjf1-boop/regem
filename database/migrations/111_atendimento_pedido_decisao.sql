-- Chamado de atendimento: liga ao pedido (para o cliente pedir cancelamento/alteração
-- pelo cardápio) e registra a decisão da equipe (aceitou/recusou o cancelamento).
-- Aditiva: não altera dados existentes.
alter table atendimento_chamado add column if not exists pedido_id uuid;
alter table atendimento_chamado add column if not exists decisao text; -- aceito | recusado | null
