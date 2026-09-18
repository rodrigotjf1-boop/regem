-- 265_expurgo_inicial_sync.sql — Primeira limpeza das tabelas que crescem sem fim.
--
-- ⚠️ NÃO é @cloud-only. ⚠️ ADITIVA no sentido de não mexer em dado de negócio: só apaga
-- telemetria e registros de exclusão VELHOS. Pode ir para a nuvem AGORA, antes do código.
--
-- POR QUÊ
--  • `edge_heartbeat` recebe uma linha por batida, duas por ciclo de um minuto. Em 5.000 lojas
--    são 14,4 milhões de linhas por dia (~14 GB/dia pela medida atual de ~1 KB por linha). O
--    código novo passa a manter o status em `edge_status` e só amostra o histórico, mas o que
--    já está acumulado precisa sair.
--  • `sync_exclusao` (mig 262) nunca era limpa. O mercado trata isso como JANELA DECLARADA:
--    o Sync Gateway do Couchbase expurga tombstone em 3 dias por padrão (e avisa que cliente
--    offline além disso PERDE a exclusão), o AppSync usa TTL na tabela delta e o SQL Data Sync
--    da Azure guarda 45 dias e obriga a reprovisionar quem passar disso.
--    Adotamos **30 dias**: o servidor local que ficar mais de 30 dias sem sincronizar passa a
--    ser mandado para a restauração por arquivo pelo código novo, em vez de seguir com
--    exclusões perdidas em silêncio.
--
-- Rodar de novo é inofensivo (só apaga o que já passou da janela).

-- `edge_heartbeat` é só-nuvem: no servidor local a tabela não existe e, sem o guard, o arquivo
-- INTEIRO era pulado na instalação (junto com a limpeza de `sync_exclusao`, que existe lá).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'edge_heartbeat') then
    delete from edge_heartbeat where recebido_em < now() - interval '30 days';
  end if;
end $$;
delete from sync_exclusao where created_at < now() - interval '30 days';

-- `edge_telemetria` (erros do servidor local) tem o mesmo perfil: guardar 90 dias basta para
-- investigar incidente. A tabela é só-nuvem; o guard evita erro no edge.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'edge_telemetria') then
    delete from edge_telemetria where criado_em < now() - interval '90 days';
  end if;
end $$;
