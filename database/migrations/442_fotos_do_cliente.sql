-- @cloud-only
-- 442 · FOTOS DO CLIENTE NO ATENDENTE VIRTUAL (protótipo `mockups/regem-atendente-alergenos-agendado.html`, parte 3,
-- aprovado pelo dono em 16/11/2026 com as recomendadas F1–F7; "pode prosseguir, tudo aprovado" em 17/11). Só NUVEM, como a
-- 342 (robo_config) e a 388: a leitura da foto e o robô moram na nuvem; a loja não tem estas tabelas.
--
-- O que entra:
--   robo_config.fotos_ler — "Ler as fotos que o cliente manda" (Delivery › Configurações › Atendimento › grupo "Fotos do
--     cliente"). NASCE DESLIGADO. Ligado (e a distribuição com a leitura liberada — ROBO_FOTOS_IA), a foto que chega no
--     WhatsApp é descrita pela IA da empresa e a descrição vai ao atendente.
--   robo_config.print_ajuda — "Mandar print de ajuda" (decisão F4: liga/desliga próprio, separado da leitura). NASCE
--     DESLIGADO. A coluna entra agora (os dois ajustes do grupo numa migration só, como o protótipo pede); o uso vem na
--     entrega do print.
--   robo_foto_lida — uma linha por cliente e por dia DA LOJA: quantas fotos dele a IA leu (decisão F7: até 5 por dia; a
--     vaga é reservada na MESMA instrução que confere o teto — V98) e a ÚLTIMA descrição, que o caso aberto em seguida
--     mostra em "O que a foto mostra" (decisão F5). Decisão F1: o Regem guarda só a descrição em texto, nunca a foto. As
--     linhas de mais de 3 dias saem na própria reserva (a descrição que importa já foi para o caso).
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Colunas com padrão em tabela pequena (uma
-- linha por empresa) e tabela nova vazia; o `lock_timeout` desiste em vez de enfileirar escrita atrás dela.
set local lock_timeout = '5s';

alter table robo_config add column if not exists fotos_ler boolean not null default false;
alter table robo_config add column if not exists print_ajuda boolean not null default false;

create table if not exists robo_foto_lida (
  tenant_id         uuid not null references empresa(id) on delete cascade,
  telefone_chave    text not null,
  dia               date not null,
  lidas             smallint not null default 0,
  ultima_tipo       text,
  ultima_descricao  text,
  ultima_em         timestamptz,
  primary key (tenant_id, telefone_chave, dia)
);

-- A descrição é dado do cliente: fora do alcance da API REST anônima do Supabase (RLS ligada e SEM política, como a
-- 342, a 347 e a 388 — o app usa um papel que atravessa a RLS).
alter table robo_foto_lida enable row level security;

-- Conferência no MESMO Run: as quatro linhas têm de vir com `ok = true`.
select 'robo_config.fotos_ler' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'robo_config'
                  and column_name = 'fotos_ler' and column_default = 'false') as ok
union all
select 'robo_config.print_ajuda',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'robo_config'
                  and column_name = 'print_ajuda' and column_default = 'false')
union all
-- Pelo catálogo (pg_constraint), não pelo information_schema (a conexão de leitura não vê a tabela pelo outro — 10/11).
select 'tabela robo_foto_lida com a chave (empresa, telefone, dia)',
       exists (select 1 from pg_constraint c
                where c.conrelid = to_regclass(current_schema() || '.robo_foto_lida') and c.contype = 'p'
                  and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (tenant_id, telefone_chave, dia)')
union all
select 'RLS ligada em robo_foto_lida',
       coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass(current_schema() || '.robo_foto_lida')), false);
