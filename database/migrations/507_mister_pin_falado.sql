-- @cloud-only
-- 507 — MISTER: falar o PIN (versão 10, fase C5; aprovada pelo dono em 25/11/2026 — `docs/plano-mister.md` § "Versão 10",
-- decisão V10-5; protótipo `mockups/regem-mister-v10.html`, "No celular" › "ligar e usar o PIN falado" e "Na loja" › Mister ›
-- Pessoas com a coluna do PIN falado).
--
--   mister_vinculo.pin_falado_em  quando a pessoa ligou o PIN falado para si (confirmando o PIN uma vez, pela página do PIN);
--     null = o PIN só digitado. Com ele ligado e uma proposta de PIN esperando, o áudio DELA (não encaminhado) é transcrito e os
--     números são conferidos pelo código, antes da fila, da IA e da memória; nada é guardado. O presidente desliga em Mister ›
--     Pessoas. Nasce desligado também na distribuição (`MISTER_PIN_FALADO=1`, depois do teste com 20 áudios).
--
-- ⚠️ SÓ NUVEM: `mister_vinculo` é SO_NUVEM no sync-daemon, e o servidor da loja pula o arquivo. Sem instrução destrutiva: vai pelo
-- MCP (LIC-171). Idempotente; não apaga dado.
set local lock_timeout = '5s';

alter table mister_vinculo add column if not exists pin_falado_em timestamptz;

comment on column mister_vinculo.pin_falado_em is
  'Versão 10, C5: quando a pessoa ligou o PIN falado (null = só digitado). O presidente desliga em Mister › Pessoas.';

-- Conferência (no mesmo Run): a coluna existe.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = current_schema() and table_name = 'mister_vinculo' and column_name = 'pin_falado_em'
  ) then
    raise exception 'mig 507: falta a coluna mister_vinculo.pin_falado_em';
  end if;
end $$;
