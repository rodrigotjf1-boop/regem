-- @cloud-only
-- 304_integracao_webhook.sql — Avisos (webhooks) da API de integração para o sistema conectado
-- (trilha C, C3b — PR6; contrato do Liame `docs/integracoes/regem.md` §3).
--
-- O sistema conectado (o Liame) lê as vendas e os cupons por cursor, de 15 em 15 minutos. O aviso
-- encurta essa espera: quando algo publicado muda (venda, cupom, uso de cupom, cliente
-- anonimizado), o Regem manda um POST assinado (Standard Webhooks) para o endereço que a própria
-- integração registrou com o token da loja (`PUT /api/v1/integracao/webhook`). O aviso é SÓ
-- gatilho: quem recebe lê pela rota com cursor. Perdido, repetido ou fora de ordem, não muda nada.
--
-- POR QUE NÃO A FILA `aviso_integracao` (mig 289)
-- Aquela fila carrega pedido de ESTORNO (dinheiro do cliente): um aviso por venda, entrega
-- garantida, e trava a reinstalação do servidor da loja. Aviso de frescor é o oposto: muito volume,
-- pode perder, e dez mudanças seguidas valem UM aviso. Misturar os dois faria uma loja movimentada
-- atrasar um estorno. Aqui não há fila: é UMA linha por token, com "até onde já avisei"
-- (`avisado_ate`). O job compara com o carimbo mais novo da `integracao_versao` (mig 296) e manda
-- um aviso por loja, no máximo um por minuto.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro; a tabela nunca existe lá e não entra no
--    sincronismo. O job que a usa mora no módulo da API de integração, que não sobe na loja.
-- ⚠️ DEPENDE da 295 (tokens por loja) e da 296 (versões). Aplicar na NUVEM ANTES do merge: a rota
--    de registro grava aqui e o job lê a cada 15 s (sem a tabela ele espera 10 min e avisa no log).
-- ⚠️ O segredo da assinatura fica CIFRADO (`common/cifra-segredo.ts`, chave `SEGREDOS_CHAVE` da
--    nuvem): o Regem precisa dele para assinar, então não dá para guardar só o hash.
-- Idempotente. A chave estrangeira aponta para `integracao_token_loja` (poucas escritas); o
-- `lock_timeout` faz a migration desistir em vez de enfileirar escrita atrás dela.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null
     or to_regclass(current_schema() || '.integracao_versao') is null then
    raise exception 'A 304 depende da 295 (integracao_token_loja) e da 296 (integracao_versao): aplique-as antes.';
  end if;
end $$;

create table if not exists integracao_webhook (
  token_id               uuid primary key references integracao_token_loja(id) on delete cascade,
  tenant_id              uuid not null,
  unidade_id             uuid,                              -- a loja do token (nulo = token da empresa)
  cliente                text not null,                     -- 'liame'
  url                    text not null,                     -- conferida na entrada contra a lista do cliente
  segredo_cifrado        text not null,                     -- 'v1:…' (AES-256-GCM); nunca em texto puro
  criado_em              timestamptz not null default now(),
  registrado_em          timestamptz not null default now(),-- o último PUT (o cliente repete uma vez por dia)
  -- Até que carimbo (`integracao_versao.atualizado_em`) esta loja já foi avisada.
  avisado_ate            timestamptz not null default now(),
  -- Quando o job olha esta linha de novo (intervalo normal, recuo depois de falha, reserva do envio).
  proxima_verificacao_em timestamptz not null default now(),
  falhas_seguidas        integer not null default 0,
  primeira_falha_em      timestamptz,                       -- começo da sequência de falhas (para pausar)
  ultimo_envio_em        timestamptz,
  ultimo_status_http     integer,
  ultimo_erro            text,
  entregues              bigint not null default 0,
  -- Pausado: falhou por dias, ou o destino respondeu que a conexão não existe mais. Um PUT novo religa.
  pausado_em             timestamptz,
  motivo_pausa           text,
  constraint ck_integracao_webhook_url check (url ~ '^https?://' and length(url) <= 500),
  constraint ck_integracao_webhook_segredo check (left(segredo_cifrado, 3) = 'v1:')
);

-- A fila do job: só o que está ligado, na ordem da próxima verificação.
create index if not exists idx_integracao_webhook_fila
  on integracao_webhook (proxima_verificacao_em)
  where pausado_em is null;

-- Segredo (cifrado) e endereço da integração: fora do alcance da API REST anônima do Supabase. RLS
-- ligada e SEM política, como a 295 (o app usa um papel que atravessa a RLS).
alter table integracao_webhook enable row level security;

-- Conferência no MESMO Run: as cinco linhas têm de vir com `ok = true`.
select 'tabela integracao_webhook' as objeto,
       to_regclass(current_schema() || '.integracao_webhook') is not null as ok
union all
select 'chave estrangeira para o token (apaga junto)',
       exists (select 1 from pg_constraint c
                where c.conrelid = to_regclass(current_schema() || '.integracao_webhook')
                  and c.contype = 'f' and c.confdeltype = 'c'
                  and c.confrelid = to_regclass(current_schema() || '.integracao_token_loja'))
union all
select 'índice da fila',
       to_regclass(current_schema() || '.idx_integracao_webhook_fila') is not null
union all
select 'RLS ligada',
       coalesce((select c.relrowsecurity from pg_class c
                  where c.oid = to_regclass(current_schema() || '.integracao_webhook')), false)
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true);
