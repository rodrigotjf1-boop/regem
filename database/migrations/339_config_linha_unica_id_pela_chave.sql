-- 339 — Configuração de LINHA ÚNICA por empresa/loja: o id passa a nascer da chave de negócio (fase 3A-2 do pedido de
-- 22–23/10/2026: "mudanças de config no modo local não alcançam a nuvem"; "cabeçalho e rodapé cadastrados não saem").
--
-- O PROBLEMA
-- `delivery_config` (cabeçalho, rodapé e modelos de cupom), `tef_config`, `kds_cor_config` (uma linha por empresa e
-- loja; sem loja = a da empresa) e `entitlement` (um liga/desliga por empresa e módulo) sincronizam nos dois sentidos,
-- mas nasciam com id ALEATÓRIO. Quando a nuvem e o servidor da loja criavam, cada um, a linha da mesma chave, o
-- sincronismo — que casa a linha pelo id — tentava inserir a do outro lado e batia no índice único da chave (23505):
-- recusada em silêncio, nos dois sentidos, para sempre (o cursor anda e ninguém reenvia). O que se salvava de um lado
-- nunca chegava ao outro. A própria migration 332 semeou `kds_cor_config` nos dois bancos, cada um com o seu id.
--
-- A CORREÇÃO (mesma regra da pausa por estoque, da tarefa, da escala e da série fiscal — migs 260, 277, 278)
-- 1) O id vira md5(tabela || empresa || loja)::uuid (entitlement: md5('entitlement' || empresa || módulo)::uuid) — a
--    MESMA conta de `idConfigDaLoja`/`idEntitlement` (common/id-deterministico.ts). Os dois lados chegam ao mesmo id e
--    o sincronismo concilia pela data (a mais nova vence). O código passa a criar a linha já com esse id.
-- 2) A data (`updated_at`) é PRESERVADA: a reescrita roda com `regem.sync = on` (o gatilho de carimbo não troca a data).
--    Sem isso, o lado que aplicasse a migration por último "venceria" com uma data falsa.
-- 3) Só no banco do SERVIDOR DA LOJA (onde o daemon guarda os cursores, `sync_state`): zera o cursor de envio e o de
--    recebimento destas quatro tabelas. Na volta, o servidor manda as linhas delas e recebe as da nuvem UMA vez — sem
--    isso, a linha que foi recusada antes já ficou para trás do cursor e nunca seria reenviada. Na nuvem a tabela
--    `sync_state` não existe e esta parte não faz nada. (O recebimento recomeça do zero porque as quatro estão em
--    TABELAS_DESDE_ZERO, no sync-config.) UMA vez só: o executor da loja reaplica TODAS as migrations a cada
--    atualização por `.zip`; a marca `mig339_config_linha_unica` impede de zerar de novo.
--
-- Idempotente: a segunda vez não muda nada (o id já é o da chave; a marca já está no `sync_state`).
-- Sem FK apontando para o id destas tabelas. A chave de negócio é única nas quatro (índices das migs 034, 039, 040 e da
-- fundação), então o id novo não colide.
-- Tudo num bloco só: a marca `regem.sync` (local à transação) vale para todas as reescritas, inclusive quando o
-- arquivo é aplicado por uma ferramenta que não abre transação em volta.

do $$
begin
  perform set_config('regem.sync', 'on', true);

  update delivery_config
     set id = md5('delivery_config' || tenant_id::text || coalesce(unidade_id::text, ''))::uuid
   where id <> md5('delivery_config' || tenant_id::text || coalesce(unidade_id::text, ''))::uuid;

  update tef_config
     set id = md5('tef_config' || tenant_id::text || coalesce(unidade_id::text, ''))::uuid
   where id <> md5('tef_config' || tenant_id::text || coalesce(unidade_id::text, ''))::uuid;

  update kds_cor_config
     set id = md5('kds_cor_config' || tenant_id::text || coalesce(unidade_id::text, ''))::uuid
   where id <> md5('kds_cor_config' || tenant_id::text || coalesce(unidade_id::text, ''))::uuid;

  update entitlement
     set id = md5('entitlement' || tenant_id::text || modulo)::uuid
   where id <> md5('entitlement' || tenant_id::text || modulo)::uuid;

  -- Só existe no servidor da loja (o daemon cria): recomeça o envio e o recebimento destas quatro tabelas, UMA vez.
  -- (Dois `if`: a consulta à `sync_state` só é montada quando a tabela existe.)
  if to_regclass('sync_state') is not null then
    if not exists (select 1 from sync_state where chave = 'mig339_config_linha_unica') then
      delete from sync_state
       where chave in ('push_delivery_config', 'push_delivery_config__id',
                       'push_tef_config', 'push_tef_config__id',
                       'push_kds_cor_config', 'push_kds_cor_config__id',
                       'push_entitlement', 'push_entitlement__id');
      update sync_state
         set valor = ((valor::jsonb) - 'delivery_config' - 'tef_config' - 'kds_cor_config' - 'entitlement')::text
       where chave = 'pull_cursores'
         and valor ~ '^\s*\{'
         and (valor::jsonb) ?| array['delivery_config', 'tef_config', 'kds_cor_config', 'entitlement'];
      insert into sync_state (chave, valor) values ('mig339_config_linha_unica', now()::text);
    end if;
  end if;
end $$;
