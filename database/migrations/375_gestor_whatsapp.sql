-- @cloud-only
-- 375 · GERENTE NO WHATSAPP (item 5 do checkpoint da Central de atendimento, 06/11/2026; protótipo
-- `mockups/regem-central-atendimento.html`, versão 4: aba "WhatsApp do gerente" e o grupo "Gerente no WhatsApp"). O que
-- pede uma decisão (disputa do iFood, cancelamento e reembolso da 99, cancelamento pedido no cardápio) e o caso que
-- ninguém pegou chegam ao WhatsApp de quem decide, pelo WhatsApp principal da loja. Só NUVEM, como a 353/366/373: os
-- webhooks do WhatsApp, a fila e os avisos moram nela (a loja não tem estas tabelas).
--
-- gestor_whatsapp — o WhatsApp LIGADO a um gestor (gerente ou presidente). Cada um liga o PRÓPRIO: o Regem mostra um
--   código de 6 dígitos que vale `codigo_expira_em` (10 min) e uma vez só; o gestor manda "REGEM 123456" do celular dele
--   ao WhatsApp da loja e o número que mandou fica em `telefone` (a forma que o provedor entrega — é a mesma que volta
--   nas próximas mensagens dele). O número NÃO vem do cadastro do colaborador: quem edita o cadastro não pode dar a
--   outra pessoa a porta de decisão de um gerente. `pausado_em` = "PARAR AVISOS" (VOLTAR AVISOS limpa).
--   `ultima_entrada_em` = a última mensagem dele ao Regem (a janela de 24 h da API oficial).
--   Únicos: uma linha por gestor; um número liga uma pessoa só na empresa; um código aberto por empresa.
-- aviso_gestor_whatsapp — UM aviso por (caso, gestor, tipo): `id` = chave de negócio (V42), então duas réplicas da API
--   e a rotina repetida não mandam em dobro. Tipos: `decisao` (os 4 tipos de caso acima) e `ninguem_pegou` (a marca
--   `escalado` da fila). Situações: `enviando` (a réplica que pegou a vez) → `enviado` (o texto saiu) ou `modelo` (fora
--   da janela de 24 h da API oficial: saiu o modelo "Atendimento"; o toque em "Ver por aqui" manda o texto) ou `falhou`
--   (o motivo em `erro`, sem segredo; a rotina tenta de novo até 3 vezes enquanto o caso vale). `escolha`/`decisao`/
--   `respondido_em`/`codigo` ficam para os botões (parte 5b).
-- robo_config.gestor_wa_* — os ajustes do grupo (da empresa). Nasce DESLIGADO (`gestor_wa_ligado`). O limite de
--   "Aceitar pelo WhatsApp até" (centavos; null = sem limite; 0 = não aceitar pelo WhatsApp) já entra aqui para a 5b não
--   precisar de outra migration; padrão R$ 100,00.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

create table if not exists gestor_whatsapp (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  colaborador_id     uuid not null references colaborador(id) on delete cascade,
  telefone           text,                                -- só dígitos, como o provedor entrega; null enquanto não liga
  ligado_em          timestamptz,
  pausado_em         timestamptz,                         -- "PARAR AVISOS"
  codigo             text,                                -- o código de ligar (6 dígitos), uma vez só
  codigo_expira_em   timestamptz,
  ultima_entrada_em  timestamptz,                         -- a última mensagem do gestor (janela de 24 h da API oficial)
  criado_em          timestamptz not null default clock_timestamp(),
  atualizado_em      timestamptz not null default clock_timestamp(),
  constraint uq_gestor_whatsapp_colaborador unique (tenant_id, colaborador_id),
  constraint ck_gestor_whatsapp_codigo check (codigo is null or codigo ~ '^[0-9]{6}$')
);
create unique index if not exists uq_gestor_whatsapp_telefone on gestor_whatsapp (tenant_id, telefone)
  where telefone is not null;
create unique index if not exists uq_gestor_whatsapp_codigo on gestor_whatsapp (tenant_id, codigo)
  where codigo is not null;
alter table gestor_whatsapp enable row level security;

create table if not exists aviso_gestor_whatsapp (
  id                 uuid primary key,                    -- chave de negócio: caso + gestor + tipo (V42)
  tenant_id          uuid not null references empresa(id) on delete cascade,
  unidade_id         uuid,
  chamado_id         uuid not null references atendimento_chamado(id) on delete cascade,
  colaborador_id     uuid not null references colaborador(id) on delete cascade,
  telefone           text not null,                       -- para onde saiu (o número ligado na hora)
  tipo               text not null,
  situacao           text not null default 'enviando',
  codigo             text,                                -- 5b: o número curto do caso na enquete
  escolha            text,                                -- 5b: a opção tocada que espera a confirmação
  escolha_em         timestamptz,
  decisao            text,                                -- 5b
  respondido_em      timestamptz,
  erro               text,
  tentativas         integer not null default 1,          -- a falha passageira tenta de novo, até 3
  enviado_em         timestamptz,
  criado_em          timestamptz not null default clock_timestamp(),
  atualizado_em      timestamptz not null default clock_timestamp(),
  constraint ck_aviso_gestor_whatsapp_tipo check (tipo in ('decisao', 'ninguem_pegou')),
  constraint ck_aviso_gestor_whatsapp_situacao check (situacao in
    ('enviando', 'enviado', 'modelo', 'falhou', 'respondido', 'expirado'))
);
-- "Ver por aqui" e a rotina leem os avisos de um gestor que ainda esperam o toque.
create index if not exists idx_aviso_gestor_whatsapp_gestor on aviso_gestor_whatsapp (tenant_id, colaborador_id, situacao);
alter table aviso_gestor_whatsapp enable row level security;

alter table robo_config add column if not exists gestor_wa_ligado boolean not null default false;
alter table robo_config add column if not exists gestor_wa_decisoes boolean not null default true;
alter table robo_config add column if not exists gestor_wa_ninguem_pegou boolean not null default true;
alter table robo_config add column if not exists gestor_wa_limite_centavos integer default 10000;
do $$
begin
  if not exists (select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
                  join pg_namespace n on n.oid = t.relnamespace
                 where c.conname = 'ck_robo_config_gestor_wa_limite' and n.nspname = current_schema()) then
    alter table robo_config add constraint ck_robo_config_gestor_wa_limite
      check (gestor_wa_limite_centavos is null or gestor_wa_limite_centavos in (0, 3000, 5000, 10000, 20000));
  end if;
end $$;

-- Conferência (no mesmo Run): as tabelas (com RLS), os índices e as colunas.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity::text as ok
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname in ('gestor_whatsapp', 'aviso_gestor_whatsapp')
union all
select 'indice', i.indexname, 'true'
  from pg_indexes i
 where i.schemaname = current_schema()
   and i.indexname in ('uq_gestor_whatsapp_telefone', 'uq_gestor_whatsapp_codigo', 'idx_aviso_gestor_whatsapp_gestor')
union all
select 'coluna', 'robo_config.' || column_name, data_type
  from information_schema.columns
 where table_schema = current_schema() and table_name = 'robo_config'
   and column_name in ('gestor_wa_ligado', 'gestor_wa_decisoes', 'gestor_wa_ninguem_pegou', 'gestor_wa_limite_centavos')
 order by 1, 2;
