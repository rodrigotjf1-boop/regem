-- @cloud-only
-- 475 — MISTER: a lista de compras pela conversa (versão 6, fase M6g; plano aprovado em 20/11/2026, `docs/plano-mister.md`
-- § "Versão 6", Frente C; protótipo `mockups/regem-mister-v6.html`, "Ações e apresentação" — "lista de compras pela foto e
-- pela planilha"). A 474 é de outra sessão (o Clube).
--
-- O presidente (ou o gerente com "criar" no Estoque) pede pelo WhatsApp — por texto, áudio, a foto de uma lista ou uma
-- planilha, ou "faz a lista do que está abaixo do mínimo" — e o Mister monta a lista: cada linha vai a um insumo do
-- estoque (a dúvida vira botão), a marca quando o insumo tem duas ou mais (a lista exige), o fornecedor; no fim, o resumo
-- e "Criar o pedido", que cria a lista pelo MESMO serviço da tela (Estoque › Pedidos, `ComprasService.createLista`).
--
-- mister_lista_compra — a lista EM MONTAGEM de uma pessoa (uma por vez: a nova descarta a anterior que ficou pela metade).
--   situacao  montando (falta responder alguma linha) | confirmar (o resumo com "Criar o pedido") | criada | descartada
--   origem    conversa (texto, áudio ou foto lida) | planilha | minimo (abaixo do mínimo)
--   itens     as linhas, na ordem: o texto, a quantidade e a unidade como vieram, o insumo, o fator, a marca e o estado
--   fornecedor_id / fornecedor_escolhido / opcoes_fornecedor  o passo do fornecedor (o escolhido, se já foi, e as opções
--             dos botões, para o toque achar o mesmo fornecedor que viu)
--   compra_lista_id  a lista criada em Estoque › Pedidos
-- A proposta que ninguém responde vence (`vence_em`, 24 h) e some da conversa.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (SO_NUVEM no sync-daemon). Idempotente; nada que apague objeto
-- (LIC-171). RLS ligada e SEM política: fora do alcance da API REST anônima.
set local lock_timeout = '5s';

create table if not exists mister_lista_compra (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references empresa(id) on delete cascade,
  unidade_id       uuid,
  colaborador_id   uuid not null references colaborador(id) on delete cascade,
  telefone_final   text,
  origem           text not null,
  situacao         text not null default 'montando',
  itens            jsonb not null default '[]'::jsonb,
  fornecedor_id    uuid,
  fornecedor_escolhido boolean not null default false,    -- o passo do fornecedor já foi (com um, ou "sem fornecedor")
  opcoes_fornecedor jsonb not null default '[]'::jsonb,   -- os fornecedores mostrados nos botões, na ordem
  compra_lista_id  uuid,
  vence_em         timestamptz not null default (clock_timestamp() + interval '24 hours'),
  criada_em        timestamptz not null default clock_timestamp(),
  atualizada_em    timestamptz not null default clock_timestamp(),
  constraint ck_mister_lista_compra_situacao check (situacao in ('montando', 'confirmar', 'criada', 'descartada')),
  constraint ck_mister_lista_compra_origem check (origem in ('conversa', 'planilha', 'minimo')),
  constraint ck_mister_lista_compra_itens check (jsonb_typeof(itens) = 'array')
);
-- A lista aberta de uma pessoa (a que a resposta continua).
create index if not exists idx_mister_lista_compra_aberta on mister_lista_compra (tenant_id, colaborador_id) where situacao in ('montando', 'confirmar');
alter table mister_lista_compra enable row level security;

comment on table mister_lista_compra is 'Mister v6 (mig 475): a lista de compras montada pela conversa, até virar o pedido em Estoque › Pedidos — só nuvem';

-- Conferência (no mesmo Run): a tabela (com RLS), as travas e o índice.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity::text as detalhe
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname = 'mister_lista_compra' and c.relkind = 'r'
union all
select 'trava', conname, null from pg_constraint
 where conname in ('ck_mister_lista_compra_situacao', 'ck_mister_lista_compra_origem', 'ck_mister_lista_compra_itens')
union all
select 'indice', indexname, null from pg_indexes where schemaname = current_schema() and indexname = 'idx_mister_lista_compra_aberta'
 order by 1, 2;
