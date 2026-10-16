-- 326 — Estação de impressão: a fila ANTIGA espera a decisão de quem está no PC (fase 1, PR 4a).
--
-- Decisão do dono (15/10/2026): quando a impressora ou o PC volta depois de muito tempo, o cupom
-- com até 10 minutos sai sozinho; o mais antigo espera a decisão no painel da estação ("Imprimir
-- todos / Escolher quais / Descartar") — imprimir agora um pedido que já foi feito à mão repete o
-- pedido na cozinha.
--
--  • `liberado_em`: quem está no PC mandou imprimir mesmo antigo. A estação só recebe o cupom com
--    mais de 10 minutos quando ele foi liberado.
--  • "Descartar" usa a situação nova `descartado` (o texto de `status` não tem restrição) — o
--    expurgo a apaga em 14 dias, como as que falharam.
--
-- A fila (`impressao_job`) é de cada banco e NÃO sincroniza: coluna nova, sem nada a classificar
-- no sync-daemon. NÃO é @cloud-only: existe nos dois bancos (a estação fala com o servidor da loja
-- ou com a nuvem). Idempotente.
set local lock_timeout = '5s';

alter table impressao_job add column if not exists liberado_em timestamptz;

-- Conferência no MESMO Run: a linha tem de vir com `ok = true`.
select 'impressao_job.liberado_em (timestamptz, opcional)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'impressao_job'
                  and column_name = 'liberado_em' and data_type = 'timestamp with time zone'
                  and is_nullable = 'YES') as ok;
