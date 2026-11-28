-- @cloud-only
-- 518 — MISTER: o mesmo boleto não vira duas contas a pagar (rodada 7 de segurança, MIS-F-08, ERR-658).
--
-- O documento por foto era único só pelo id da mensagem (`wamid`): a mesma cobrança mandada em duas mensagens (a foto e depois
-- o PDF, ou um encaminhamento, que tem outro id) virava DUAS contas a pagar no modo "sozinho". Agora o código de barras do
-- documento LANÇADO é único na empresa: a segunda passagem para "lancado" bate no índice (23505) e o Mister responde que o
-- boleto já está nas contas a pagar. O desfeito sai do índice (pode ser lançado de novo); o pago continua "lancado" (a mesma
-- cobrança não entra outra vez).
--
-- Conferido na nuvem, só lendo, antes de aplicar (28/11/2026): 6 lançados com código, nenhum repetido.
--
-- ⚠️ SÓ NUVEM: `mister_documento` é SO_NUVEM no sync-daemon, e o servidor da loja pula o arquivo. Sem instrução destrutiva: vai
-- pelo MCP (LIC-171). Idempotente; não apaga dado.
set local lock_timeout = '5s';

create unique index if not exists uq_mister_documento_codigo_lancado
  on mister_documento (tenant_id, codigo_barras)
  where situacao = 'lancado' and codigo_barras is not null;

comment on index uq_mister_documento_codigo_lancado is
  'Rodada 7, MIS-F-08: o mesmo código de barras lançado uma vez por empresa (a segunda passagem para "lancado" dá 23505).';

-- Conferência (no mesmo Run): o índice existe, é único e parcial.
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = current_schema() and tablename = 'mister_documento' and indexname = 'uq_mister_documento_codigo_lancado'
       and indexdef ilike '%unique%' and indexdef ilike '%situacao%'
  ) then
    raise exception 'mig 518: falta o índice único do código de barras lançado em mister_documento';
  end if;
end $$;
