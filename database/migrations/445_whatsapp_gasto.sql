-- @cloud-only
-- 445 — O GASTO DO WHATSAPP OFICIAL (G1 do protótipo `mockups/regem-whatsapp-gasto.html`, aprovado pelo dono em
-- 18/11/2026 com as oito decisões recomendadas). A Meta cobra a loja direto por mensagem entregue (desde 01/10/2026 também
-- o atendimento depois de 1.000 por mês em cada número); o Regem LÊ o que a Meta informa e mostra em WhatsApp › Uso e gasto.
--
-- whatsapp_gasto — o gasto por dia (no fuso da loja), por conta (WABA), número, categoria e tipo de preço, como a consulta
--   de preço da Meta (`pricing_analytics`) devolve: mensagens entregues e o custo aproximado, na moeda da conta. A rotina
--   da nuvem lê a cada 30 minutos e REESCREVE os dias que leu (apaga o intervalo e grava de novo, numa transação).
-- whatsapp_gasto_modelo — o gasto por dia e por modelo (`template_analytics`): o "De onde veio" da tela.
-- whatsapp_gasto_leitura — a situação da leitura de cada conta: a última que deu certo, a última tentativa, o motivo da
--   falha, a moeda e até onde os meses anteriores já foram lidos (a carga dos 12 meses é uma vez).
--
-- ⚠️ SÓ NUVEM: quem lê a Meta é a nuvem; o servidor da loja pula o arquivo inteiro (as três em SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como as do Mister).
set local lock_timeout = '5s';

create table if not exists whatsapp_gasto (
  tenant_id          uuid not null references empresa(id) on delete cascade,
  waba_id            text not null,
  numero             text not null default '',            -- o número como a Meta devolve (só dígitos); '' = sem número
  dia                date not null,                        -- o dia no fuso da loja
  categoria          text not null,                        -- MARKETING | UTILITY | SERVICE | AUTHENTICATION | …
  tipo               text not null,                        -- REGULAR (cobrada) | FREE_CUSTOMER_SERVICE | FREE_ENTRY_POINT
  mensagens          integer not null default 0,
  custo              numeric(14,4) not null default 0,
  lido_em            timestamptz not null default now(),
  primary key (tenant_id, waba_id, numero, dia, categoria, tipo)
);
alter table whatsapp_gasto enable row level security;
-- A tela e os alertas leem por empresa e período (o filtro de conta e de número vem depois).
create index if not exists ix_whatsapp_gasto_dia on whatsapp_gasto (tenant_id, dia);

create table if not exists whatsapp_gasto_modelo (
  tenant_id          uuid not null references empresa(id) on delete cascade,
  waba_id            text not null,
  dia                date not null,
  modelo_id          text not null,                        -- o id do modelo na Meta
  modelo_nome        text not null,
  categoria          text,                                 -- MARKETING | UTILITY | AUTHENTICATION
  mensagens          integer not null default 0,           -- entregues
  custo              numeric(14,4) not null default 0,
  lido_em            timestamptz not null default now(),
  primary key (tenant_id, waba_id, dia, modelo_id)
);
alter table whatsapp_gasto_modelo enable row level security;
create index if not exists ix_whatsapp_gasto_modelo_dia on whatsapp_gasto_modelo (tenant_id, dia);

create table if not exists whatsapp_gasto_leitura (
  tenant_id          uuid not null references empresa(id) on delete cascade,
  waba_id            text not null,
  lido_em            timestamptz,                          -- a última leitura que deu certo
  tentou_em          timestamptz,                          -- a última tentativa
  erro               text,                                 -- o motivo da última falha (NULL = a última deu certo)
  moeda              text,
  historico_ate      date,                                 -- os meses anteriores já lidos (NULL = falta a carga inicial)
  modelos_lidos_em   timestamptz,                          -- a última leitura do gasto por modelo
  primary key (tenant_id, waba_id)
);
alter table whatsapp_gasto_leitura enable row level security;

comment on table whatsapp_gasto is 'Gasto do WhatsApp oficial (mig 445): o que a Meta informa por dia, conta, número, categoria e tipo — só nuvem';
comment on table whatsapp_gasto_modelo is 'Gasto do WhatsApp oficial (mig 445): por dia e por modelo — só nuvem';
comment on table whatsapp_gasto_leitura is 'Gasto do WhatsApp oficial (mig 445): a situação da leitura de cada conta — só nuvem';

-- Conferência (no mesmo Run).
select 'whatsapp_gasto' as objeto, to_regclass(current_schema() || '.whatsapp_gasto') is not null as ok
union all select 'whatsapp_gasto_modelo', to_regclass(current_schema() || '.whatsapp_gasto_modelo') is not null
union all select 'whatsapp_gasto_leitura', to_regclass(current_schema() || '.whatsapp_gasto_leitura') is not null
union all select 'ix_whatsapp_gasto_dia', to_regclass(current_schema() || '.ix_whatsapp_gasto_dia') is not null
union all select 'whatsapp_gasto.custo numeric', exists (select 1 from information_schema.columns
  where table_schema = current_schema() and table_name = 'whatsapp_gasto' and column_name = 'custo' and data_type = 'numeric');
