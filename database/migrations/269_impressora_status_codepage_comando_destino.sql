-- 269_impressora_status_codepage_comando_destino.sql — Impressão: estado de cada impressora,
-- acentos por impressora e comandos remotos com DESTINO e DADOS.
--
-- ⚠️ NÃO é @cloud-only: `impressora_status` e `equipamento.codepage` existem nos dois bancos.
--    A parte de `edge_comando` (tabela só-nuvem) é guardada — no servidor local não faz nada.
-- ⚠️ ADITIVA e independente do código: pode ir para a nuvem ANTES do deploy.

-- 1) ESTADO DE CADA IMPRESSORA
-- Hoje o sistema só descobre que uma impressora está desligada/sem papel quando um job falha, e
-- o painel mostra a fila, não a impressora. O worker do servidor local e a nuvem (confirmações
-- do agente dos caixas) passam a gravar aqui a última impressão certa e a última falha. É
-- estado de OPERAÇÃO, uma linha por impressora, atualizada a cada job — NÃO entra no sync (não
-- carimba `equipamento`, que sincroniza: gravar lá a cada ticket geraria tráfego à toa).
create table if not exists impressora_status (
  equipamento_id uuid primary key,
  tenant_id uuid not null,
  unidade_id uuid,
  ultimo_ok_em timestamptz,
  ultima_falha_em timestamptz,
  ultimo_erro text,
  falhas_seguidas integer not null default 0,
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_impressora_status_tenant on impressora_status (tenant_id);

-- 2) ACENTOS POR IMPRESSORA
-- O conversor troca acento por letra sem acento (seguro em qualquer impressora). Com a página
-- de código configurada, o ticket sai acentuado. NULL = sem acento (comportamento de sempre).
--   'cp860' (português) | 'cp850' (multilíngue)
alter table equipamento add column if not exists codepage text;

-- 3) COMANDOS REMOTOS COM DESTINO E DADOS (tabela só-nuvem → guard)
-- `edge_comando` era por EMPRESA: numa rede com duas lojas, o primeiro servidor local que
-- buscava executava e confirmava — o outro nunca recebia (vale para "testar impressora" e para
-- o rollback da distribuição). Agora cada comando pode mirar UM servidor (`equipamento_id`); o
-- código grava uma linha por servidor. `dados` leva o conteúdo (ex.: o texto da DANFE de uma
-- nota emitida na nuvem para a loja que imprime pelo servidor local). Linha antiga, sem
-- destino, continua valendo para qualquer servidor da empresa (comportamento de antes).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = current_schema() and table_name = 'edge_comando') then
    alter table edge_comando add column if not exists equipamento_id uuid;
    alter table edge_comando add column if not exists unidade_id uuid;
    alter table edge_comando add column if not exists dados jsonb;
    create index if not exists idx_edge_comando_destino on edge_comando (tenant_id, status, equipamento_id);
  end if;
end $$;
