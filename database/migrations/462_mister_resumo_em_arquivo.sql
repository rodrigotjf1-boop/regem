-- @cloud-only
-- 462 — MISTER: O RESUMO EM ARQUIVO E NO LINK (versão 5, M5e; protótipo `mockups/regem-mister-ouve-ve-mostra.html`,
-- aprovado pelo dono em 19/11/2026 — conversas 7 e 8, aba "Arquivo e link" e a decisão 8: "o resumo é texto com os botões
-- 📄 PDF e 📊 Ver gráficos; o link abre sem login por 7 dias e só mostra aquele resumo, pelo mecanismo do link para
-- encaminhar (mig 443)").
--
-- mister_link_publico.tipo — passa a aceitar 'resumo' (o "📊 Ver gráficos" do resumo do dia e da semana) e 'grafico' (o
--   "🔗 Ver no link" do gráfico da conversa). O link do resumo e o do gráfico valem enquanto quem os pediu (presidente
--   ou gerente) seguir ativo; o do insumo continua só do presidente (a régua fica no código).
-- mister_conversa_config.resumo_entrega — "Como mandar o resumo" (Mister › Avisos e relatórios › Relatórios): os botões
--   (o padrão do protótipo), o PDF junto, o link junto ou só o texto. O texto vai sempre. Só vale com a versão 5 ligada na
--   instalação (`MISTER_MIDIA`): desligada, o resumo segue só por escrito, como hoje.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as duas tabelas são só da nuvem).
-- ⚠️ TEM `drop constraint` (a restrição do tipo só se alarga trocando-a): vai pelo SQL Editor do Supabase, pelo dono —
--    o MCP recusa `drop` (LIC-171). Idempotente: o `drop … if exists` seguido do `add` refaz a mesma restrição.
set local lock_timeout = '5s';

alter table mister_link_publico drop constraint if exists ck_mister_link_publico_tipo;
alter table mister_link_publico add constraint ck_mister_link_publico_tipo check (tipo in ('insumo', 'resumo', 'grafico'));

alter table mister_conversa_config add column if not exists resumo_entrega text not null default 'botoes';
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.mister_conversa_config')
                    and conname = 'ck_mister_conversa_config_resumo_entrega') then
    alter table mister_conversa_config add constraint ck_mister_conversa_config_resumo_entrega
      check (resumo_entrega in ('botoes', 'pdf', 'link', 'texto'));
  end if;
end $$;

-- A conferência no MESMO arquivo: tudo tem de vir com `ok = true`.
select 'o tipo resumo cabe em mister_link_publico' as objeto,
       coalesce((select pg_get_constraintdef(c.oid) like '%resumo%' and pg_get_constraintdef(c.oid) like '%grafico%'
                   from pg_constraint c
                  where c.conrelid = to_regclass(current_schema() || '.mister_link_publico') and c.conname = 'ck_mister_link_publico_tipo'), false) as ok
union all
select 'a coluna resumo_entrega em mister_conversa_config',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'mister_conversa_config' and column_name = 'resumo_entrega'
                  and column_default like '%botoes%' and is_nullable = 'NO')
union all
select 'a restrição das formas de mandar o resumo',
       exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.mister_conversa_config')
                  and conname = 'ck_mister_conversa_config_resumo_entrega');
