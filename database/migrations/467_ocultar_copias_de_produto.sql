-- @cloud-only
-- 467 — Esconder as cópias de produto que a importação do Cardápio Web duplicou (decisão do dono em 20/11/2026: "Esconder
-- as cópias", depois da análise do "seu de sempre" — F8 do docs/plano-perfil-cliente.md; já recomendado em 21/10/2026).
--
-- A importação do Cardápio Web criou uma CÓPIA de produtos que já existiam com o código PDV dos canais (mig 331) — uma por
-- categoria, com o código "cw…". O cardápio online, o balcão e o totem mostravam os dois; a venda se dividia entre eles
-- (90 dias: as cópias com 10, 30 e 5 vendas no balcão; os originais, com 688, 1.004 e 465). Aqui as cópias ficam
-- INATIVAS e fora do cardápio digital e do balcão (o totem segue o balcão — `catalogo-gogem.ts`). Inativas porque, no
-- cardápio online, "fora do cardápio digital" é PAUSA (o produto aparece como esgotado — `cardapio.service` `menu`); só o
-- inativo some de lá (a 1ª versão desta migration, aplicada às 04h40 de 20/11, desligou só as duas chaves — a 2ª aplicação
-- completa; nenhum canal manda pedido com esses códigos "cw…", conferido na nuvem):
--   • NÃO apaga, NÃO troca código, NÃO mexe em categoria nem em preço; relatórios e vendas antigas ficam como estão, e o
--     dono religa em Cadastros › Cardápio se quiser;
--   • NÃO mexe no iFood nem na 99: desde a mig 399, o gatilho deles não acorda com `disponivel_balcao`/`disponivel_cardapio`;
--   • `updated_at` anda para a mudança descer ao servidor da loja pela sincronização do cadastro (produto: 'ambos', LWW).
-- Só o id dos produtos fica aqui (nome de produto e de loja fora do repositório — regra de dado sensível). O antes de cada
-- um fica na auditoria (detalhe `trocas`), para desfazer se preciso. Idempotente: o que já está escondido não muda e a
-- segunda execução não audita de novo. Produto excluído ou que não existe fica de fora (fora da nuvem de produção, nada
-- muda). Uma linha de auditoria por empresa, encadeada como o AuditoriaService faz (o mesmo molde da 331).
set local lock_timeout = '5s';

do $$
declare
  c_criterio constant text := 'cópia do Cardápio Web de produto que já existe com o código PDV dos canais (decisão do dono em 20/11/2026)';
  v_alvo jsonb;
  r record;
  v_ult record;
  v_seq integer;
  v_prev text;
  v_canon text;
begin
  -- Servidor da loja: não tem `edge_status`; a mudança chega pela sincronização do cadastro.
  if to_regclass(current_schema() || '.edge_status') is null then
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id::text, 'tenant', p.tenant_id::text, 'ativo', p.ativo,
                                               'balcao', p.disponivel_balcao, 'cardapio', p.disponivel_cardapio)
                            order by p.tenant_id, p.id), '[]'::jsonb)
    into v_alvo
    from produto p
    join (values
      ('3e10d3b5-6c57-4c8d-ac3f-1095337e29a7'::uuid),
      ('eca94041-ed1a-499b-85e1-dc7d5e9342a6'::uuid),
      ('c9b22e1e-ece4-4204-9a78-1e62bf12711b'::uuid)
    ) as l(produto_id) on l.produto_id = p.id
   where p.deleted_at is null
     and (p.ativo or p.disponivel_balcao or p.disponivel_cardapio);

  if jsonb_array_length(v_alvo) = 0 then
    return;
  end if;

  update produto p
     set ativo = false,
         disponivel_balcao = false,
         disponivel_cardapio = false,
         updated_at = now()
    from jsonb_array_elements(v_alvo) e
   where p.id = (e->>'id')::uuid;

  -- Auditoria: uma linha por empresa, com o antes de cada produto (`trocas`, para desfazer se preciso).
  for r in
    select e->>'tenant' as tenant_id,
           count(*)::int as n,
           jsonb_agg(jsonb_build_object('ativo', (e->>'ativo')::boolean, 'balcao', (e->>'balcao')::boolean,
                                        'cardapio', (e->>'cardapio')::boolean, 'id', e->>'id')
                     order by e->>'id') as trocas,
           '[' || string_agg('{"ativo":' || (e->>'ativo') || ',"balcao":' || (e->>'balcao') || ',"cardapio":' || (e->>'cardapio')
                             || ',"id":' || to_json(e->>'id')::text || '}', ',' order by e->>'id') || ']' as trocas_txt
      from jsonb_array_elements(v_alvo) e
     group by e->>'tenant'
     order by 1
  loop
    perform pg_advisory_xact_lock(hashtext(r.tenant_id), 0);
    select a.seq, a.hash into v_ult
      from audit_log a
     where a.tenant_id = r.tenant_id::uuid and a.seq is not null
     order by a.seq desc
     limit 1;
    v_seq := coalesce(v_ult.seq, 0) + 1;
    v_prev := coalesce(v_ult.hash, '');
    -- Forma canônica do AuditoriaService (chaves em ordem em todos os níveis; `at` entra porque o ator não é 'usuario').
    v_canon := '{"ac":' || to_json('ocultou_copia_de_produto'::text)::text
            || ',"ai":null'
            || ',"ap":' || to_json('servico'::text)::text
            || ',"at":' || to_json('distribuicao'::text)::text
            || ',"d":{"criterio":' || to_json(c_criterio)::text
            ||       ',"migration":' || to_json('467'::text)::text
            ||       ',"produtos":' || r.n::text
            ||       ',"trocas":' || r.trocas_txt || '}'
            || ',"ei":null'
            || ',"et":' || to_json('produto'::text)::text
            || ',"o":' || to_json('migracao'::text)::text
            || ',"s":' || v_seq::text
            || ',"t":' || to_json(r.tenant_id)::text
            || ',"ti":' || to_json('cadastro'::text)::text
            || ',"u":null'
            || '}';
    insert into audit_log (tenant_id, unidade_id, actor_tipo, actor_id, actor_perfil, tipo, acao, entidade_tipo,
                           entidade_id, detalhe, origem, seq, prev_hash, hash)
    values (r.tenant_id::uuid, null, 'distribuicao', null, 'servico', 'cadastro', 'ocultou_copia_de_produto', 'produto', null,
            jsonb_build_object('criterio', c_criterio, 'migration', '467', 'produtos', r.n, 'trocas', r.trocas),
            'migracao', v_seq, v_prev,
            encode(sha256(convert_to(v_prev || '|' || v_canon, 'UTF8')), 'hex'));
  end loop;
end
$$;

-- Conferência no MESMO Run: `ok` tem de vir true — na nuvem, todo produto da lista que existe (e não foi excluído) está
-- inativo e fora do balcão e do cardápio digital. Em banco sem esses produtos, dá 0 = 0; no servidor da loja (sem `edge_status`) não se aplica.
select (not x.nuvem or x.produtos_na_lista = x.escondidos) as ok, x.*
  from (
    select
      to_regclass(current_schema() || '.edge_status') is not null as nuvem,
      count(p.id) as produtos_na_lista,
      count(p.id) filter (where not p.ativo and not p.disponivel_balcao and not p.disponivel_cardapio) as escondidos,
      (select count(*) from audit_log where acao = 'ocultou_copia_de_produto') as auditoria
    from (values
      ('3e10d3b5-6c57-4c8d-ac3f-1095337e29a7'::uuid),
      ('eca94041-ed1a-499b-85e1-dc7d5e9342a6'::uuid),
      ('c9b22e1e-ece4-4204-9a78-1e62bf12711b'::uuid)
    ) as l(produto_id)
    left join produto p on p.id = l.produto_id and p.deleted_at is null
  ) x;
