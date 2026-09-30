-- @cloud-only
-- 300_marketing_consentimento.sql — HISTÓRICO do consentimento de marketing por telefone: quem
-- aceitou receber promoções, quem recusou, quem pediu para sair e quem voltou — e quando, por
-- onde e com qual texto. Base do aceite do cardápio (caixinha desmarcada) e do opt-out que o
-- RegemCast lê pela API de integração.
--
-- O QUE ENTRA
--   1. `marketing_consentimento`: um EVENTO por linha, só inserção (nunca se altera nem se apaga
--      um evento — exceto o "Excluir conta" da LGPD, que apaga os eventos daquele cadastro). O
--      estado de hoje de um número é o ÚLTIMO evento dele. `marketing_optout` continua sendo a
--      lista que BLOQUEIA o envio; antes o VOLTAR apagava a linha dela sem deixar rastro.
--   2. `regem_telefone_chave(text)`: a chave de comparação do telefone brasileiro — a MESMA de
--      `backend/src/common/telefone-chave.ts` (`chaveTelefone`), conferida por teste contra este
--      banco. Iguala "com e sem 55", formatação e o celular antigo sem o nono dígito (o WhatsApp
--      manda muitos `wa_id` sem o 9 — ERR-134). Nunca é o número a discar.
--   3. O histórico começa com a lista de exclusão de hoje (cada linha vira um evento "saida" com
--      a data em que entrou). Rodar de novo não duplica.
--
-- Sem chave estrangeira para `cliente` (tabela quente que sincroniza com a loja — a FK poria
-- trava nela a cada evento); o "Excluir conta" apaga os eventos do cadastro no mesmo passo.
-- ⚠️ SÓ NUVEM: campanha, WhatsApp e cardápio rodam só na nuvem. O servidor da loja pula o
--    arquivo inteiro; a tabela não existe lá e não entra no sincronismo.
-- ⚠️ Aplicar na NUVEM ANTES do merge. Não trava tabela de venda nem de cliente (a tabela é nova;
--    o histórico inicial só LÊ `marketing_optout`).
-- Idempotente (if not exists / create or replace / not exists no histórico inicial).
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.marketing_optout') is null then
    raise exception 'A 300 depende da 226 (lista de exclusão de marketing): aplique-a antes.';
  end if;
end $$;

-- Chave de comparação do telefone (espelho de `chaveTelefone`; vazio → nulo, nunca casa).
create or replace function regem_telefone_chave(t text) returns text
language sql immutable parallel safe as $$
  select nullif(case when d1 ~ '^[1-9][0-9][6-9][0-9]{7}$'
                     then substr(d1, 1, 2) || '9' || substr(d1, 3)
                     else d1 end, '')
    from (select case when d0 like '0055%' then substr(d0, 5)
                      when d0 like '55%' and length(d0) in (12, 13) then substr(d0, 3)
                      when d0 like '0%' then substr(d0, 2)
                      else d0 end as d1
            from (select regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g') as d0) a) b
$$;

create table if not exists marketing_consentimento (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  cliente_id     uuid,                        -- cadastro, quando se sabe (sem FK: ver acima)
  telefone       text not null,               -- só dígitos (o do cadastro, ou como chegou do WhatsApp)
  telefone_chave text not null,               -- regem_telefone_chave(telefone)
  acao           text not null,               -- aceite | recusa | saida | volta
  origem         text not null,               -- cardapio_checkout | cardapio_perfil | whatsapp | painel | integracao | lista_inicial
  texto          text,                        -- o texto EXATO mostrado a quem aceitou/recusou
  autor_id       uuid,                        -- quem da loja registrou (painel); nulo = o próprio cliente
  em             timestamptz not null default now(),
  constraint ck_marketing_consentimento_acao check (acao in ('aceite', 'recusa', 'saida', 'volta')),
  constraint ck_marketing_consentimento_chave check (telefone_chave <> '')
);
-- O último evento de um número (estado de hoje) e o histórico dele.
create index if not exists idx_marketing_consentimento_tel
  on marketing_consentimento (tenant_id, telefone_chave, em desc);
-- Os eventos de um cadastro (perfil do cardápio, "Excluir conta").
create index if not exists idx_marketing_consentimento_cliente
  on marketing_consentimento (tenant_id, cliente_id)
  where cliente_id is not null;

-- Dado pessoal: fora da API REST anônima (o app usa um papel que atravessa a RLS).
alter table marketing_consentimento enable row level security;

-- Histórico inicial: quem está na lista de exclusão hoje "saiu" na data em que entrou nela.
insert into marketing_consentimento (tenant_id, cliente_id, telefone, telefone_chave, acao, origem, em)
select mo.tenant_id, mo.cliente_id, mo.telefone, regem_telefone_chave(mo.telefone), 'saida', 'lista_inicial',
       mo.criado_em
  from marketing_optout mo
 where regem_telefone_chave(mo.telefone) is not null
   and not exists (select 1 from marketing_consentimento h
                    where h.tenant_id = mo.tenant_id and h.origem = 'lista_inicial'
                      and h.telefone = mo.telefone and h.em = mo.criado_em);

-- Conferência no MESMO Run: todas as linhas têm de vir com `ok = true`.
select 'tabela marketing_consentimento' as objeto,
       to_regclass(current_schema() || '.marketing_consentimento') is not null as ok
union all
select 'colunas da marketing_consentimento (10)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'marketing_consentimento') = 10
union all
select 'chave do telefone (sem 55, sem formatação, com o nono dígito)',
       regem_telefone_chave('+55 (21) 9999-8888') = '21999998888'
       and regem_telefone_chave('21999998888') = '21999998888'
       and regem_telefone_chave('2133334444') = '2133334444'
       and regem_telefone_chave('') is null
union all
select 'índices do histórico',
       (select count(*) from pg_indexes
         where schemaname = current_schema() and tablename = 'marketing_consentimento'
           and indexname in ('idx_marketing_consentimento_tel', 'idx_marketing_consentimento_cliente')) = 2
union all
select 'lista de exclusão toda no histórico',
       not exists (select 1 from marketing_optout mo
                    where regem_telefone_chave(mo.telefone) is not null
                      and not exists (select 1 from marketing_consentimento h
                                       where h.tenant_id = mo.tenant_id and h.origem = 'lista_inicial'
                                         and h.telefone = mo.telefone and h.em = mo.criado_em))
union all
select 'RLS ligada',
       exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                where s.nspname = current_schema() and c.relname = 'marketing_consentimento'
                  and c.relrowsecurity)
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true);
