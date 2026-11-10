-- 393 — A pausa dos pedidos, F2: o aviso antes de reabrir (protótipo `mockups/regem-pausa.html`, aprovado em 10/11/2026).
--
-- Cada canal pausado ganha no painel do Delivery o CONTADOR REGRESSIVO até a reabertura; quando falta pouco, o painel toca
-- o aviso e a faixa fica vermelha (o gestor reabre ou estende). Os dois ajustes da loja, em Delivery › Configurações ›
-- Operação › Atendimento, grupo "Pausa dos pedidos":
--   • `pausa_aviso_min` — quantos minutos antes de reabrir o painel avisa: 1, 3, 5 (padrão) ou 10; 0 = não avisar;
--   • `pausa_som` — o som do aviso: 'bipe' (padrão) ou 'campainha' (toca com o "🔔 Som on" do painel ligado).
--
-- Moram no `cardapio_config` da LOJA EM USO (sem linha dela, a da empresa — a mesma herança do "Cheguei", mig 354): essa
-- config já sincroniza nos dois sentidos e o painel do servidor da loja já a lê. Sem `check` nos valores de propósito (a
-- linha de uma versão mais nova não trava o sync de um servidor mais antigo): o serviço confere.
--
-- NÃO é @cloud-only. ⚠️ Aplicar na NUVEM ANTES do merge: o estado das pausas (`GET /delivery/pausas`) passa a ler as
-- colunas. Idempotente.

alter table cardapio_config add column if not exists pausa_aviso_min integer not null default 5;
alter table cardapio_config add column if not exists pausa_som text not null default 'bipe';

-- ===== Conferência (no mesmo Run): as duas linhas têm de vir com `ok = true` =====
select 'colunas pausa_aviso_min e pausa_som' as objeto,
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'cardapio_config'
           and column_name in ('pausa_aviso_min', 'pausa_som')) = 2 as ok
union all
select 'padrões (5 min, bipe)',
       (select bool_and(column_default like '5%' or column_default like '''bipe''%') from information_schema.columns
         where table_schema = current_schema() and table_name = 'cardapio_config'
           and column_name in ('pausa_aviso_min', 'pausa_som'));
