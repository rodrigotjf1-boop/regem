-- 284 — EVENTOS da NFC-e: cancelamento por substituição (P20).
--
-- ⚠️ NÃO é @cloud-only: a loja emite as próprias notas e é ela quem precisa cancelar a
--    duplicidade que a própria emissão criou.
-- ⚠️ Aplicar ANTES do merge. Idempotente (roda de novo sem efeito).
-- Depende das funções `bump_updated_at` e `registrar_exclusao_sync` (mig 262) e
-- `marcar_mudanca_sync` (mig 264) — os gatilhos vão JUNTO, nesta migration, para não repetir
-- o que aconteceu com a 282/283 (tabela criada num arquivo e gatilhos em outro).
--
-- POR QUE EXISTE
--
-- O MOC 7.0 (§3.5) descreve exatamente o nosso caso e dá nome a ele: "a emissão em duplicidade
-- ocorre quando um contribuinte solicita a autorização de uso de uma NFC-e (NFC-e 1), porém,
-- por algum motivo, não obtém a resposta a esta solicitação. Para acobertar a operação e
-- fornecer o DANFE NFC-e para o consumidor, emite uma outra NFC-e (NFC-e 2)… Ao se
-- restabelecer a comunicação, verifica-se que a 'NFC-e 1' havia sido regularmente autorizada".
--
-- Ou seja: a consulta disse "não consta" (217), emitimos a segunda nota, e a primeira aparece
-- autorizada depois. Ficam DUAS notas para a mesma venda. A saída legal é o evento 110112 —
-- cancelar a que NÃO acobertou a operação, referenciando a que a substituiu, em no máximo
-- 168 horas da autorização (Ajuste SINIEF 19/16, cl. 15ª-A; MOC, regra 2P12-18).
--
-- A tabela guarda o pedido e o comprovante (procEventoNFe). Serve para o 110112 de agora e
-- para os eventos que vierem (cancelamento comum, carta de correção): por isso `tp_evento`.

create table if not exists fiscal_evento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  unidade_id uuid,
  nota_id uuid,                        -- a nota que o evento afeta (quando é nossa)
  chave text not null,                 -- chave de acesso da nota do evento
  tp_evento text not null,             -- 110112 = cancelamento por substituição
  n_seq integer not null default 1,
  justificativa text,
  chave_ref text,                      -- NFC-e SUBSTITUTA (exclusivo do 110112)
  status text not null default 'pendente', -- pendente|registrado|rejeitado
  cstat text,
  motivo text,
  protocolo text,
  ambiente text not null default '2',
  xml text,                            -- procEventoNFe (evento + retorno): o comprovante
  solicitado_por_id uuid,
  registrado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fiscal_evento_nota on fiscal_evento (tenant_id, nota_id);
create index if not exists idx_fiscal_evento_chave on fiscal_evento (tenant_id, chave);

-- O mesmo evento, para a mesma nota, não se pede duas vezes: a SEFAZ devolveria "evento já
-- registrado" e ficariam dois comprovantes para o mesmo fato. Rejeitado não conta (pode-se
-- tentar de novo depois de corrigir).
create unique index if not exists uq_fiscal_evento_nota
  on fiscal_evento (tenant_id, chave, tp_evento, n_seq)
  where status <> 'rejeitado';

-- ── Sincronismo: carimbo, marcador e exclusão (mesma receita das migs 262/264/272) ────────
drop trigger if exists trg_bump_fiscal_evento on fiscal_evento;
create trigger trg_bump_fiscal_evento
  before update on fiscal_evento
  for each row execute function bump_updated_at();

do $$
declare t text;
begin
  foreach t in array array['fiscal_evento'] loop
    if exists (select 1 from information_schema.tables
                where table_schema = current_schema() and table_name = t) then
      execute format('drop trigger if exists trg_sync_marcador_ins on %I', t);
      execute format('drop trigger if exists trg_sync_marcador_upd on %I', t);
      execute format('drop trigger if exists trg_sync_marcador_del on %I', t);
      execute format('create trigger trg_sync_marcador_ins after insert on %I '
                     || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
      execute format('create trigger trg_sync_marcador_upd after update on %I '
                     || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
      execute format('create trigger trg_sync_marcador_del after delete on %I '
                     || 'referencing old table as removidas for each statement execute function marcar_mudanca_sync()', t);
      execute format('drop trigger if exists trg_sync_exclusao on %I', t);
      execute format('create trigger trg_sync_exclusao after delete on %I '
                     || 'for each row execute function registrar_exclusao_sync()', t);
    end if;
  end loop;
end $$;
