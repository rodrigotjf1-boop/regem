-- 267_impressao_agente_maquina_fila.sql — Impressão: impressora USB presa à MÁQUINA do agente
-- e índice da fila que as consultas de fato usam.
--
-- ⚠️ NÃO é @cloud-only: `equipamento` e `impressao_job` existem nos dois bancos.
-- ⚠️ ADITIVA e independente do código: pode ir para a nuvem ANTES do deploy.
--
-- 1) equipamento.agente_maquina
--    Numa loja em modo nuvem com DOIS caixas, cada um com o seu agente de impressão, os dois
--    agentes usam o mesmo token da loja e a fila entregava qualquer job a qualquer agente.
--    Medido: 60 jobs, 2 agentes — nenhum saiu duplicado, mas 20 dos 30 jobs de impressora USB
--    foram para o agente da OUTRA máquina (lá a impressora não existe → 5 tentativas → erro, ou,
--    com o mesmo nome no Windows, sai no balcão errado).
--    Aqui fica o nome da máquina dona da impressora USB. O código preenche sozinho na primeira
--    impressão confirmada (sem configuração da loja) e só entrega o job USB para essa máquina.
--    NULL = ainda não aprendida: vale a lista de impressoras instaladas que o agente informa.
alter table equipamento add column if not exists agente_maquina text;

-- 2) Índice da fila
--    `idx_impressao_claim (status, claim_ate)` (mig 221) não aparece em nenhum plano: a consulta
--    da nuvem entra pelo tenant e a do servidor local pela ordem de chegada. Ele só custava
--    em cada gravação. O parcial abaixo cobre as duas consultas (filtra os vivos e já entrega
--    na ordem de `criado_em`) e fica pequeno — só os jobs que ainda não saíram.
drop index if exists idx_impressao_claim;
create index if not exists idx_impressao_fila_viva
  on impressao_job (tenant_id, criado_em)
  where status in ('pendente', 'enviando');
