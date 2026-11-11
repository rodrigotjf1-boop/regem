-- @cloud-only
-- 403 — A pausa do COMPLEMENTO por canal no envio ao iFood, e o aviso de catálogo que não dispara à toa (R3 da Gestão do
-- catálogo, fase F3a; protótipo `mockups/regem-conciliacao-ifood.html`, decisão 14). A 401 trouxe `opcao.canais_pausados`.
--
-- 1. iFood: o complemento fica PAUSADO no iFood quando está "Em falta" (`opcao.esgotado`, como sempre foi — em falta é em
--    todos os canais) OU quando a loja o pausou só no iFood (`'ifood'` em `opcao.canais_pausados`). O gatilho da 370
--    passa a acordar também com a lista dos canais: a mudança do `'ifood'` nela enfileira a situação (`status_opcao`); o
--    despacho (`orzuni-envio.service.ts`) lê as duas coisas e manda `complemento_pausar` ou `complemento_reativar`.
--    A pausa só no Regem (`'regem'`) e só na 99 (`'99food'`) NÃO mexem no iFood (decisão 1: cada canal no seu botão).
-- 2. O aviso de catálogo aos integradores (mig 316) ignora as colunas que a porta de integração NÃO devolve: na opção,
--    a pausa por canal e o preço na 99 (como já ignorava o "Em falta"); no produto, o preço na 99 e o "está na 99" (mig
--    401). Sem isto, cada pausa ou preço da 99 mandava aos parceiros um "o cardápio mudou" que não muda nada para eles.
--    Os gatilhos são os MESMOS da 316 (mesmos nomes, mesma função), só com a lista de ignorar maior.
--
-- ⚠️ SÓ NUVEM (o servidor da loja pula o arquivo). ⚠️ Pelo MCP do Supabase: nada que apague objeto (`create or replace`,
-- LIC-171). Cada parte só roda se a migration de que depende já está no banco (a 370 e a 316) — o banco de testes de cada
-- spec monta só as que usa. Idempotente.
set local lock_timeout = '5s';

-- ── 1. A pausa do complemento no iFood ─────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('orzuni_marcar(uuid, uuid, text, uuid)') is null then
    raise notice '403: sem a fila do Orzuni (mig 370) neste banco — a parte do iFood fica de fora';
    return;
  end if;
  execute $f$
    create or replace function orzuni_opcao_mudou() returns trigger
    language plpgsql as $b$
    begin
      if coalesce(new.codigo_pdv, '') = '' or new.deleted_at is not null then
        return null;
      end if;
      if new.preco_ifood is not null
         and (tg_op = 'INSERT' or new.preco_ifood is distinct from old.preco_ifood
              or new.codigo_pdv is distinct from old.codigo_pdv or old.deleted_at is not null) then
        perform orzuni_marcar(new.tenant_id, null, 'preco_opcao', new.id);
      end if;
      -- A situação no iFood: o "Em falta" (todos os canais) ou a pausa só do iFood.
      if tg_op = 'UPDATE'
         and (new.esgotado is distinct from old.esgotado
              or jsonb_exists(coalesce(new.canais_pausados, '[]'::jsonb), 'ifood')
                 is distinct from jsonb_exists(coalesce(old.canais_pausados, '[]'::jsonb), 'ifood')) then
        perform orzuni_marcar(new.tenant_id, null, 'status_opcao', new.id);
      end if;
      return null;
    end $b$
  $f$;
  execute $t$
    create or replace trigger trg_orzuni_opcao
      after insert or update of preco_ifood, codigo_pdv, esgotado, canais_pausados, deleted_at on opcao
      for each row execute function orzuni_opcao_mudou()
  $t$;
end $$;

-- ── 2. O aviso de catálogo ignora o que a porta não devolve ────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  if to_regprocedure('integracao_retrato_mudou()') is null then
    raise notice '403: sem o aviso de catálogo (mig 316) neste banco — a parte do aviso fica de fora';
    return;
  end if;
  for r in
    select * from (values
      ('produto', 'catalogo', 'propria', '', 'updated_at,pausado_estoque,pausa_motivo,preco_venda,preco_custo,preco_promocional,preco_99,na_99'),
      ('opcao',   'catalogo', 'rede',    '', 'updated_at,preco_custo,esgotado,canais_pausados,preco_99')
    ) as v(tabela, tipo, modo, pai, ignorar)
  loop
    execute format(
      'create or replace trigger trg_integracao_retrato_ins after insert on %I referencing new table as novas '
      'for each statement execute function integracao_retrato_mudou(%L, %L, %L, %L)',
      r.tabela, r.tipo, r.modo, r.pai, r.ignorar);
    execute format(
      'create or replace trigger trg_integracao_retrato_upd after update on %I referencing old table as antigas new table as novas '
      'for each statement execute function integracao_retrato_mudou(%L, %L, %L, %L)',
      r.tabela, r.tipo, r.modo, r.pai, r.ignorar);
    execute format(
      'create or replace trigger trg_integracao_retrato_del after delete on %I referencing old table as antigas '
      'for each statement execute function integracao_retrato_mudou(%L, %L, %L, %L)',
      r.tabela, r.tipo, r.modo, r.pai, r.ignorar);
  end loop;
end $$;

-- Conferência (no mesmo Run): 3 linhas, todas `ok = true` (na nuvem as duas dependências existem).
select 'o gatilho da opção acorda com a pausa por canal' as objeto,
       coalesce((select pg_get_triggerdef(t.oid) like '%canais_pausados%'
                   from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                  where t.tgname = 'trg_orzuni_opcao' and not t.tgisinternal and n.nspname = current_schema()), false) as ok
union all
select 'o aviso de catálogo da opção ignora a pausa por canal e o preço na 99',
       coalesce((select pg_get_triggerdef(t.oid) like '%canais_pausados,preco_99%'
                   from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                  where t.tgname = 'trg_integracao_retrato_upd' and c.relname = 'opcao' and not t.tgisinternal
                    and n.nspname = current_schema()), false)
union all
select 'o aviso de catálogo do produto ignora o preço na 99 e o "está na 99"',
       coalesce((select pg_get_triggerdef(t.oid) like '%preco_99,na_99%'
                   from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                  where t.tgname = 'trg_integracao_retrato_upd' and c.relname = 'produto' and not t.tgisinternal
                    and n.nspname = current_schema()), false);
