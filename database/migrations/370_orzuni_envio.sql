-- @cloud-only
-- 370 — iFood pelo Orzuni, R2a: a LIGAÇÃO de cada loja com o Orzuni e a FILA do envio (a 369 trouxe os campos).
--
-- O Regem consome a porta MCP do Orzuni (Padrão DMS; o Orzuni gerencia o cardápio do iFood). Quando o preço no iFood
-- de um produto ou de uma opção muda, ou quando o item é pausado/reativado, o Regem manda ao Orzuni NA HORA (regra do
-- dono: nada de consultar o iFood de tempos em tempos). Decisões do dono (06/11/2026, "seguir as recomendadas"):
--   • pausam no iFood: o "Ativo no iFood" do produto (`canais_pausados` com 'ifood'), o "esgotado" por estoque (o da
--     loja vai só ao iFood DELA; o de todas as lojas, a todas) e o "Em falta" da opção. O "Ocultar" do cardápio
--     próprio do Regem não mexe no iFood;
--   • a ligação da loja é registrada pela DISTRIBUIÇÃO no console (a chave `orz_live_` nunca passa pela tela do
--     lojista); o segredo da ligação fica só aqui, cifrado.
--
-- orzuni_ligacao — uma ligação viva por loja. `segredo_cifrado` = o `dms_lg_orzuni_…` que o Orzuni entrega UMA vez,
--   cifrado com a `SEGREDOS_CHAVE` da nuvem (`common/cifra-segredo.ts`). Repetir a troca no Orzuni GIRA o segredo:
--   registrar de novo revoga a anterior aqui.
-- orzuni_envio — a fila E o último resultado, UMA linha por (loja, tipo, alvo): uma mudança nova sobe a `versao` e
--   volta a linha para "pendente" (edições seguidas viram um envio só, com o valor mais novo, lido na hora de mandar).
--   A `versao` vai na chave de idempotência: a mesma tentativa repetida não grava duas vezes no iFood, e 30 → 35 → 30
--   são três envios diferentes. `resultado`/`resposta` guardam o que a porta FEZ (aplicado, sem mudança, não
--   encontrado, recusado com o código), sem segredo.
--
-- QUEM ENFILEIRA: gatilhos AQUI no banco (produto, produto_pausa_estoque, opcao). Assim a edição feita na tela da
-- nuvem e a que chega do servidor da loja pelo sincronismo entram do mesmo jeito, na MESMA transação da mudança —
-- sem `.zip`. Só enfileiram para empresa com o direito `ifood_pelo_orzuni` ligado e loja com ligação viva: as outras
-- empresas pagam só a conferência (duas leituras por índice) e só quando um campo do iFood muda. `pg_notify` acorda
-- o despacho na API (`orzuni-envio.service.ts`); sem LISTEN, a rotina dele pega a fila em até 15 s.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as duas tabelas ficam em SO_NUVEM no sync-daemon).
-- ⚠️ Pelo MCP do Supabase: nada que apague objeto (gatilho por `create or replace trigger`, LIC-171). Idempotente.
-- RLS ligada e SEM política nas duas (como a 342/356/366): fora do alcance da API REST anônima do Supabase.
set local lock_timeout = '5s';

create table if not exists orzuni_ligacao (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references empresa(id) on delete cascade,
  unidade_id       uuid not null references unidade(id) on delete cascade,
  segredo_cifrado  text not null,                 -- dms_lg_orzuni_… cifrado (v1:…); nunca sai da API
  prefixo          text not null,                 -- a parte visível do segredo, para reconhecer no console
  conta_orzuni     text,                          -- conta_id no Orzuni (devolvido na troca)
  loja_ifood       text,                          -- merchantId do iFood (devolvido na troca)
  permissoes       jsonb not null default '[]'::jsonb,
  criada_em        timestamptz not null default now(),
  criada_por       text,                          -- quem registrou no console da distribuição
  segredo_em       timestamptz not null default now(),
  ultimo_uso_em    timestamptz,
  revogada_em      timestamptz,
  revogada_por     text,
  revogada_motivo  text,
  constraint ck_orzuni_ligacao_segredo check (segredo_cifrado like 'v1:%')
);
create unique index if not exists uq_orzuni_ligacao_loja_viva on orzuni_ligacao (unidade_id) where revogada_em is null;
create index if not exists idx_orzuni_ligacao_empresa on orzuni_ligacao (tenant_id) where revogada_em is null;
alter table orzuni_ligacao enable row level security;

create table if not exists orzuni_envio (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid not null,                   -- a loja: o envio sai pela ligação viva dela
  tipo           text not null,                   -- preco_item | status_item | preco_opcao | status_opcao
  ref_id         uuid not null,                   -- produto.id (item) ou opcao.id (opção)
  versao         integer not null default 1,      -- sobe a cada mudança; entra na chave de idempotência
  situacao       text not null default 'pendente',-- pendente | enviando | feito | desistiu
  tentativas     integer not null default 0,
  proxima_em     timestamptz not null default now(),
  reservado_ate  timestamptz,                     -- "enviando" vencido volta à fila (processo morto no meio)
  marcado_em     timestamptz not null default clock_timestamp(),
  enviado_em     timestamptz,
  resultado      text,                            -- aplicado | sem_mudanca | nao_encontrado | parcial | recusado | dispensado
  resposta       jsonb,                           -- o que a porta devolveu (situação, antes, depois, código) ou o motivo
  ultimo_erro    text,
  constraint ck_orzuni_envio_tipo check (tipo in ('preco_item', 'status_item', 'preco_opcao', 'status_opcao')),
  constraint ck_orzuni_envio_situacao check (situacao in ('pendente', 'enviando', 'feito', 'desistiu'))
);
create unique index if not exists uq_orzuni_envio_alvo on orzuni_envio (unidade_id, tipo, ref_id);
-- A fila: só o que pode sair (a condição do despacho no índice — V84, LIC-113).
create index if not exists idx_orzuni_envio_fila on orzuni_envio (proxima_em) where situacao in ('pendente', 'enviando');
create index if not exists idx_orzuni_envio_alvo on orzuni_envio (tenant_id, ref_id);
alter table orzuni_envio enable row level security;

-- Marca o alvo para as lojas ligadas da empresa (`p_unidade` nulo = todas). Nada acontece sem o direito ligado.
create or replace function orzuni_marcar(p_tenant uuid, p_unidade uuid, p_tipo text, p_ref uuid) returns void
language plpgsql as $$
declare
  n integer;
begin
  if not exists (select 1 from entitlement e
                  where e.tenant_id = p_tenant and e.modulo = 'ifood_pelo_orzuni' and e.ativo) then
    return;
  end if;
  insert into orzuni_envio (tenant_id, unidade_id, tipo, ref_id)
  select l.tenant_id, l.unidade_id, p_tipo, p_ref
    from orzuni_ligacao l
   where l.tenant_id = p_tenant and l.revogada_em is null
     and (p_unidade is null or l.unidade_id = p_unidade)
  on conflict (unidade_id, tipo, ref_id) do update
     set versao = orzuni_envio.versao + 1,
         -- Em envio agora: segue "enviando"; o despacho, ao terminar, vê a versão nova e devolve à fila.
         situacao = case when orzuni_envio.situacao = 'enviando' then 'enviando' else 'pendente' end,
         tentativas = 0,
         proxima_em = now(),
         marcado_em = clock_timestamp(),
         ultimo_erro = null;
  get diagnostics n = row_count;
  if n > 0 then
    perform pg_notify('orzuni_envio', p_tenant::text);
  end if;
end $$;

-- Produto: o preço no iFood (mudou, ou passou a valer) e o status (o "Ativo no iFood" e o esgotado de todas as lojas).
create or replace function orzuni_produto_mudou() returns trigger
language plpgsql as $$
declare
  vale boolean := new.no_ifood and coalesce(new.codigo, '') <> '' and new.deleted_at is null;
begin
  if not vale then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if new.preco_ifood is not null then
      perform orzuni_marcar(new.tenant_id, new.unidade_id, 'preco_item', new.id);
    end if;
    return null;
  end if;
  if new.preco_ifood is not null
     and (new.preco_ifood is distinct from old.preco_ifood or not old.no_ifood
          or new.codigo is distinct from old.codigo or old.deleted_at is not null) then
    perform orzuni_marcar(new.tenant_id, new.unidade_id, 'preco_item', new.id);
  end if;
  if jsonb_exists(coalesce(new.canais_pausados, '[]'::jsonb), 'ifood')
       is distinct from jsonb_exists(coalesce(old.canais_pausados, '[]'::jsonb), 'ifood')
     or new.pausado_estoque is distinct from old.pausado_estoque then
    perform orzuni_marcar(new.tenant_id, new.unidade_id, 'status_item', new.id);
  end if;
  return null;
end $$;

create or replace trigger trg_orzuni_produto
  after insert or update of preco_ifood, no_ifood, codigo, canais_pausados, pausado_estoque, deleted_at on produto
  for each row execute function orzuni_produto_mudou();

-- Esgotado por estoque DA LOJA (mig 260): vai só ao iFood daquela loja.
create or replace function orzuni_pausa_loja_mudou() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' and not new.pausado then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.pausado is not distinct from old.pausado
     and new.deleted_at is not distinct from old.deleted_at then
    return null;
  end if;
  if exists (select 1 from produto p
              where p.id = new.produto_id and p.no_ifood and coalesce(p.codigo, '') <> '' and p.deleted_at is null) then
    perform orzuni_marcar(new.tenant_id, new.unidade_id, 'status_item', new.produto_id);
  end if;
  return null;
end $$;

create or replace trigger trg_orzuni_pausa_loja
  after insert or update of pausado, deleted_at on produto_pausa_estoque
  for each row execute function orzuni_pausa_loja_mudou();

-- Opção do catálogo: o preço no iFood (um por código PDV) e o "Em falta" (`esgotado`).
create or replace function orzuni_opcao_mudou() returns trigger
language plpgsql as $$
begin
  if coalesce(new.codigo_pdv, '') = '' or new.deleted_at is not null then
    return null;
  end if;
  if new.preco_ifood is not null
     and (tg_op = 'INSERT' or new.preco_ifood is distinct from old.preco_ifood
          or new.codigo_pdv is distinct from old.codigo_pdv or old.deleted_at is not null) then
    perform orzuni_marcar(new.tenant_id, null, 'preco_opcao', new.id);
  end if;
  if tg_op = 'UPDATE' and new.esgotado is distinct from old.esgotado then
    perform orzuni_marcar(new.tenant_id, null, 'status_opcao', new.id);
  end if;
  return null;
end $$;

create or replace trigger trg_orzuni_opcao
  after insert or update of preco_ifood, codigo_pdv, esgotado, deleted_at on opcao
  for each row execute function orzuni_opcao_mudou();

-- Conferência (no mesmo Run): as duas tabelas e os três gatilhos.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname in ('orzuni_ligacao', 'orzuni_envio')
union all
select 'gatilho', t.tgname, null
  from pg_trigger t
 where t.tgname in ('trg_orzuni_produto', 'trg_orzuni_pausa_loja', 'trg_orzuni_opcao') and not t.tgisinternal
 order by 1, 2;
