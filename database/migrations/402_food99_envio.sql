-- @cloud-only
-- 402 — A FILA do envio à 99, item a item (R3 da Gestão do catálogo, fase F2; a 401 trouxe os campos).
--
-- Quando o preço na 99 de um produto muda, quando ele é pausado ou reativado na 99 (ou esgota pelo estoque), ou quando o
-- nome e a descrição mudam num produto que já está na 99, o Regem manda à 99 NA HORA (regra do dono: nada de consultar
-- a 99 de tempos em tempos), pela API da 99 (doc 1967 "Update One Item" e 1969 "Update Item Status"). A ligação é pelo
-- código PDV (`app_item_id` = `produto.codigo`, o mesmo do "Exportar catálogo" da 99). O código NÃO muda na 99 por aqui (a
-- 99 não deixa trocar o `app_item_id`): produto com código novo passa a ligar ao item da 99 com esse código.
--
-- food99_envio — a fila E o último resultado, UMA linha por (integração da 99 = loja na 99, tipo, produto): uma mudança
--   nova sobe a `versao` e volta a linha para "pendente" (edições seguidas viram um envio só, com o valor mais novo,
--   lido na hora de mandar). `dados` (cadastro_item) = os campos que mudaram ({"nome": true, "descricao": true}),
--   somados enquanto o envio anterior não terminou — nenhuma mudança se perde se ele falhar. `resultado`/`resposta`
--   guardam o que a 99 FEZ (aplicado, não encontrado, recusado com o errno), sem segredo.
--
-- QUEM ENFILEIRA: gatilhos AQUI no banco (produto, produto_pausa_estoque), como os do iFood (mig 370/400). Assim a edição
-- feita na tela da nuvem e a que chega do servidor da loja pelo sincronismo entram do mesmo jeito, na MESMA transação da
-- mudança. Só enfileiram para empresa com o direito `precos_na_99` ligado e integração da 99 ativa; produto fora da 99
-- (`na_99` falso) volta na primeira linha, sem ler nada. `pg_notify` acorda o despacho na API
-- (`food99-catalogo-envio.service.ts`); sem LISTEN, a rotina dele pega a fila em até 15 s.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela fica em SO_NUVEM no sync-daemon).
-- ⚠️ Pelo MCP do Supabase: nada que apague objeto (gatilho por `create or replace trigger`, LIC-171). Idempotente.
-- RLS ligada e SEM política (como a 370): fora do alcance da API REST anônima do Supabase.
set local lock_timeout = '5s';

create table if not exists food99_envio (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  integracao_id  uuid not null references integracao(id) on delete cascade, -- a loja na 99 (o auth_token dela)
  tipo           text not null,                   -- preco_item | status_item | cadastro_item
  ref_id         uuid not null,                   -- produto.id
  versao         integer not null default 1,      -- sobe a cada mudança
  situacao       text not null default 'pendente',-- pendente | enviando | feito | desistiu
  tentativas     integer not null default 0,
  proxima_em     timestamptz not null default now(),
  reservado_ate  timestamptz,                     -- "enviando" vencido volta à fila (processo morto no meio)
  marcado_em     timestamptz not null default clock_timestamp(),
  enviado_em     timestamptz,
  dados          jsonb,                           -- cadastro_item: os campos que mudaram
  resultado      text,                            -- aplicado | nao_encontrado | recusado | dispensado | erro
  resposta       jsonb,                           -- o que a 99 devolveu (errno, mensagem, antes, depois) ou o motivo
  ultimo_erro    text,
  constraint ck_food99_envio_tipo check (tipo in ('preco_item', 'status_item', 'cadastro_item')),
  constraint ck_food99_envio_situacao check (situacao in ('pendente', 'enviando', 'feito', 'desistiu'))
);
create unique index if not exists uq_food99_envio_alvo on food99_envio (integracao_id, tipo, ref_id);
-- A fila: só o que pode sair (a condição do despacho no índice — V84, LIC-113).
create index if not exists idx_food99_envio_fila on food99_envio (proxima_em) where situacao in ('pendente', 'enviando');
create index if not exists idx_food99_envio_alvo on food99_envio (tenant_id, ref_id);
alter table food99_envio enable row level security;

-- Marca o produto para as lojas da empresa ligadas à 99 (`p_unidade` nulo = todas; integração sem loja = vale para
-- todas). Nada acontece sem o direito ligado.
create or replace function food99_marcar(p_tenant uuid, p_unidade uuid, p_tipo text, p_ref uuid, p_dados jsonb default null)
returns void
language plpgsql as $$
declare
  n integer;
begin
  if not exists (select 1 from entitlement e
                  where e.tenant_id = p_tenant and e.modulo = 'precos_na_99' and e.ativo) then
    return;
  end if;
  insert into food99_envio (tenant_id, integracao_id, tipo, ref_id, dados)
  select i.tenant_id, i.id, p_tipo, p_ref, p_dados
    from integracao i
   where i.tenant_id = p_tenant and i.canal = '99food' and i.ativo
     and (p_unidade is null or i.unidade_id is null or i.unidade_id = p_unidade)
  on conflict (integracao_id, tipo, ref_id) do update
     set versao = food99_envio.versao + 1,
         -- Em envio agora: segue "enviando"; o despacho, ao terminar, vê a versão nova e devolve à fila.
         situacao = case when food99_envio.situacao = 'enviando' then 'enviando' else 'pendente' end,
         -- Os campos que mudaram se SOMAM até o envio terminar (se o de agora falhar, nada se perde); depois de
         -- terminado, recomeça do que mudou agora.
         dados = case when food99_envio.situacao in ('feito', 'desistiu') or food99_envio.dados is null then excluded.dados
                      else food99_envio.dados || coalesce(excluded.dados, '{}'::jsonb) end,
         tentativas = 0,
         proxima_em = now(),
         marcado_em = clock_timestamp(),
         ultimo_erro = null;
  get diagnostics n = row_count;
  if n > 0 then
    perform pg_notify('food99_envio', p_tenant::text);
  end if;
end $$;

-- Produto: o preço na 99, a situação (o "Pausado na 99", o esgotado de todas as lojas, sair da 99) e o nome/descrição.
create or replace function food99_produto_mudou() returns trigger
language plpgsql as $$
declare
  vale boolean := new.na_99 and coalesce(new.codigo, '') <> '' and new.deleted_at is null;
  campos jsonb := '{}'::jsonb;
begin
  -- Saiu do cardápio da 99: a situação vai, e o despacho pausa o item lá (o Regem não apaga item da 99).
  if tg_op = 'UPDATE' and old.na_99 and not new.na_99
     and coalesce(new.codigo, '') <> '' and new.deleted_at is null then
    perform food99_marcar(new.tenant_id, new.unidade_id, 'status_item', new.id);
    return null;
  end if;
  if not vale then
    return null;
  end if;
  if tg_op = 'INSERT' then
    if new.preco_99 is not null then
      perform food99_marcar(new.tenant_id, new.unidade_id, 'preco_item', new.id);
    end if;
    if jsonb_exists(coalesce(new.canais_pausados, '[]'::jsonb), '99food') or new.pausado_estoque then
      perform food99_marcar(new.tenant_id, new.unidade_id, 'status_item', new.id);
    end if;
    return null;
  end if;
  -- O nome ou a descrição mudaram num produto que já estava na 99 com o MESMO código: só os campos que mudaram vão.
  -- (Com o código novo, o produto passa a ligar a outro item da 99 — como entrar na 99, o nome de lá fica como está.)
  if old.na_99 and old.deleted_at is null and new.codigo is not distinct from old.codigo then
    if new.nome is distinct from old.nome then campos := campos || '{"nome": true}'::jsonb; end if;
    if new.descricao is distinct from old.descricao then campos := campos || '{"descricao": true}'::jsonb; end if;
    if campos <> '{}'::jsonb then
      perform food99_marcar(new.tenant_id, new.unidade_id, 'cadastro_item', new.id, campos);
    end if;
  end if;
  if new.preco_99 is not null
     and (new.preco_99 is distinct from old.preco_99 or not old.na_99
          or new.codigo is distinct from old.codigo or old.deleted_at is not null) then
    perform food99_marcar(new.tenant_id, new.unidade_id, 'preco_item', new.id);
  end if;
  if jsonb_exists(coalesce(new.canais_pausados, '[]'::jsonb), '99food')
       is distinct from jsonb_exists(coalesce(old.canais_pausados, '[]'::jsonb), '99food')
     or new.pausado_estoque is distinct from old.pausado_estoque
     or not old.na_99
     or new.codigo is distinct from old.codigo
     or old.deleted_at is not null then
    perform food99_marcar(new.tenant_id, new.unidade_id, 'status_item', new.id);
  end if;
  return null;
end $$;

create or replace trigger trg_food99_produto
  after insert or update of preco_99, na_99, codigo, canais_pausados, pausado_estoque, deleted_at, nome, descricao
  on produto
  for each row execute function food99_produto_mudou();

-- Esgotado por estoque DA LOJA (mig 260): vai só à 99 daquela loja.
create or replace function food99_pausa_loja_mudou() returns trigger
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
              where p.id = new.produto_id and p.na_99 and coalesce(p.codigo, '') <> '' and p.deleted_at is null) then
    perform food99_marcar(new.tenant_id, new.unidade_id, 'status_item', new.produto_id);
  end if;
  return null;
end $$;

create or replace trigger trg_food99_pausa_loja
  after insert or update of pausado, deleted_at on produto_pausa_estoque
  for each row execute function food99_pausa_loja_mudou();

-- Conferência (no mesmo Run): 4 linhas, todas `ok = true`.
select 'a fila food99_envio com RLS' as objeto,
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = current_schema() and c.relname = 'food99_envio'), false) as ok
union all
select 'a função food99_marcar (5 argumentos)',
       exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
                where f.proname = 'food99_marcar' and n.nspname = current_schema() and f.pronargs = 5)
union all
select 'o gatilho do produto (preço, situação, nome e descrição)',
       coalesce((select pg_get_triggerdef(t.oid) like '%preco_99%' and pg_get_triggerdef(t.oid) like '%descricao%'
                   from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                  where t.tgname = 'trg_food99_produto' and not t.tgisinternal and n.nspname = current_schema()), false)
union all
select 'o gatilho do esgotado por loja',
       exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                where t.tgname = 'trg_food99_pausa_loja' and not t.tgisinternal and n.nspname = current_schema());
